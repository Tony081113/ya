import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  Message,
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('create-server')
  .setDescription('建立一台新的 Pterodactyl 伺服器（固定 Python 設定）')
  .addStringOption(option =>
    option
      .setName('node')
      .setDescription('選擇要部署的節點')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName('name')
      .setDescription('伺服器名稱')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('memory')
      .setDescription('記憶體（MB，例如 1024）')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('disk')
      .setDescription('磁碟空間（MB，例如 5120）')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('cpu')
      .setDescription('CPU 使用率上限（%，例如 100）')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('description')
      .setDescription('伺服器描述')
      .setRequired(false)
  );

/** 自動完成：回傳節點清單供使用者選擇 */
export async function autocomplete(
  interaction: AutocompleteInteraction,
  pterodactylService: PterodactylService
): Promise<void> {
  const focused = interaction.options.getFocused(true);

  if (focused.name !== 'node') {
    await interaction.respond([]);
    return;
  }

  try {
    pterodactylService.setAdminApiKey();
    const nodes = await pterodactylService.getNodes();
    const query = focused.value.toLowerCase();

    const choices = nodes
      .filter(node => node && node.id && node.name)
      .filter(node => node.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map(node => ({
        name: `${node.name} (ID: ${node.id})`,
        value: node.id.toString(),
      }));

    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
): Promise<void> {
  try {
    await interaction.deferReply();

    // 確認使用者已綁定帳號
    const context = await authService.requireAuth(interaction.user, interaction.member as any);

    const nodeIdStr   = interaction.options.getString('node', true);
    const name        = interaction.options.getString('name', true);
    const description = interaction.options.getString('description') || '';
    const memory      = interaction.options.getInteger('memory', true);
    const disk        = interaction.options.getInteger('disk', true);
    const cpu         = interaction.options.getInteger('cpu', true);

    const nodeId = parseInt(nodeIdStr, 10);
    if (isNaN(nodeId)) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 無效的節點')
        .setDescription('請從自動完成清單中選擇有效的節點。')
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 取得節點名稱（用於顯示）
    pterodactylService.setAdminApiKey();
    let nodeName = `節點 ${nodeId}`;
    try {
      const nodes = await pterodactylService.getNodes();
      const found = nodes.find(n => n.id === nodeId);
      if (found) nodeName = found.name;
    } catch {
      // 顯示名稱取得失敗不影響主流程
    }

    // 顯示建立中的提示
    const processingEmbed = new EmbedBuilder()
      .setColor('Yellow')
      .setTitle('⏳ 建立伺服器中…')
      .setDescription('正在查詢可用 Port 並建立伺服器，請稍候。')
      .addFields(
        { name: '伺服器名稱', value: name, inline: true },
        { name: '記憶體', value: `${memory} MB`, inline: true },
        { name: '磁碟', value: `${disk} MB`, inline: true },
        { name: 'CPU', value: `${cpu}%`, inline: true },
        { name: '節點', value: nodeName, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [processingEmbed] });

    // 建立伺服器（含自動取得 Allocation + 固定 Python 設定）
    const server = await pterodactylService.createServer({
      name,
      description,
      memory,
      disk,
      cpu,
      nodeId,
      user: context.user.pterodactyl_user_id,
    });

    // 寫入資料庫
    (authService as any).db.addUserServer(interaction.user.id, server.uuid, server.name);

    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 伺服器建立成功')
      .setDescription(`您的伺服器 **${server.name}** 已建立！`)
      .addFields(
        { name: '🆔 伺服器 ID', value: server.uuid, inline: true },
        { name: '📊 狀態', value: server.status || '安裝中', inline: true },
        { name: '💾 記憶體', value: `${server.limits.memory} MB`, inline: true },
        { name: '💿 磁碟', value: `${server.limits.disk} MB`, inline: true },
        { name: '⚡ CPU', value: `${server.limits.cpu}%`, inline: true },
        { name: '🌍 節點', value: nodeName, inline: true },
        { name: '🐍 類型', value: 'Python（固定設定）', inline: true },
      )
      .setFooter({ text: '伺服器安裝中，可能需要數分鐘。啟動指令已自動設定為 Python 環境。' })
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed], components: [] });

    Logger.info(
      `使用者 ${interaction.user.tag} 建立伺服器：${server.name} (${server.uuid})，節點：${nodeName}`
    );
  } catch (error) {
    Logger.error('create-server 指令發生錯誤：', error);

    let title        = '❌ 發生錯誤';
    let errorMessage = '建立伺服器時發生錯誤，請稍後再試。';

    if (error instanceof Error) {
      if (error.message.includes('bind your account first')) {
        title        = '🔗 尚未綁定帳號';
        errorMessage = '您需要先將 Discord 帳號與 Pterodactyl 帳號綁定！\n\n請使用 `/bind <您的 API 金鑰>` 開始綁定。';
      } else if (error.message.includes('Invalid API key')) {
        title        = '🔑 API 金鑰無效';
        errorMessage = '您的 API 金鑰無效或已過期，請使用 `/bind` 重新設定。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title        = '🔌 連線錯誤';
        errorMessage = '無法連線至 Pterodactyl 面板，請稍後再試。';
      } else if (error.message.includes('已無可用的 Port') || error.message.includes('無法取得節點')) {
        title        = '⚠️ 節點 Port 不足';
        errorMessage = error.message;
      } else if (error.message.includes('資料驗證失敗')) {
        title        = '⚠️ 伺服器設定無效';
        errorMessage = error.message;
      } else {
        errorMessage = error.message;
      }
    }

    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle(title)
      .setDescription(errorMessage)
      .setTimestamp();

    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed], components: [] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

export async function executePrefix(
  message: Message,
  args: string[],
  authService: AuthService,
  pterodactylService: PterodactylService
): Promise<void> {
  try {
    // 確認使用者已綁定帳號
    const context = await authService.requireAuth(message.author, message.member as any);

    // 必填：<node_id> <name> <memory_mb> <disk_mb> <cpu_percent> [description]
    if (args.length < 5) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 參數不足')
        .setDescription('缺少必填參數！')
        .addFields(
          {
            name: '用法',
            value: '`!create-server <節點ID> <名稱> <記憶體MB> <磁碟MB> <CPU%> [描述]`',
            inline: false,
          },
          {
            name: '範例',
            value: '`!create-server 1 MyBot 1024 5120 100 "我的 Python Bot"`',
            inline: false,
          },
        )
        .setTimestamp();

      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return;
    }

    const nodeId      = parseInt(args[0], 10);
    const name        = args[1];
    const memory      = parseInt(args[2], 10);
    const disk        = parseInt(args[3], 10);
    const cpu         = parseInt(args[4], 10);
    const description = args.slice(5).join(' ') || undefined;

    if (isNaN(nodeId) || isNaN(memory) || isNaN(disk) || isNaN(cpu)) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 無效的數字')
        .setDescription('節點 ID、記憶體、磁碟與 CPU 必須為有效數字！')
        .setTimestamp();

      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return;
    }

    // 取得節點名稱（用於顯示）
    pterodactylService.setAdminApiKey();
    let nodeName = `節點 ${nodeId}`;
    try {
      const nodes = await pterodactylService.getNodes();
      const found = nodes.find(n => n.id === nodeId);
      if (found) nodeName = found.name;
    } catch {
      // 顯示名稱取得失敗不影響主流程
    }

    const processingMsg = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('Yellow')
          .setTitle('⏳ 建立伺服器中…')
          .setDescription('正在查詢可用 Port 並建立伺服器，請稍候。')
          .setTimestamp(),
      ],
      allowedMentions: { repliedUser: false },
    });

    // 建立伺服器
    const server = await pterodactylService.createServer({
      name,
      description,
      memory,
      disk,
      cpu,
      nodeId,
      user: context.user.pterodactyl_user_id,
    });

    // 寫入資料庫
    (authService as any).db.addUserServer(message.author.id, server.uuid, server.name);

    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 伺服器建立成功')
      .setDescription(`您的伺服器 **${server.name}** 已建立！`)
      .addFields(
        { name: '🆔 伺服器 ID', value: server.uuid, inline: true },
        { name: '📊 狀態', value: server.status || '安裝中', inline: true },
        { name: '💾 記憶體', value: `${server.limits.memory} MB`, inline: true },
        { name: '💿 磁碟', value: `${server.limits.disk} MB`, inline: true },
        { name: '⚡ CPU', value: `${server.limits.cpu}%`, inline: true },
        { name: '🌍 節點', value: nodeName, inline: true },
        { name: '🐍 類型', value: 'Python（固定設定）', inline: true },
      )
      .setFooter({ text: '伺服器安裝中，可能需要數分鐘。啟動指令已自動設定為 Python 環境。' })
      .setTimestamp();

    await processingMsg.edit({ embeds: [successEmbed], components: [] });

    Logger.info(
      `使用者 ${message.author.tag} 建立伺服器：${server.name} (${server.uuid})，節點：${nodeName}`
    );
  } catch (error) {
    Logger.error('create-server 前綴指令發生錯誤：', error);

    let title        = '❌ 發生錯誤';
    let errorMessage = '建立伺服器時發生錯誤，請稍後再試。';

    if (error instanceof Error) {
      if (error.message.includes('bind your account first')) {
        title        = '🔗 尚未綁定帳號';
        errorMessage = '您需要先將 Discord 帳號與 Pterodactyl 帳號綁定！\n\n請使用 `!bind <您的 API 金鑰>` 開始綁定。';
      } else if (error.message.includes('Invalid API key')) {
        title        = '🔑 API 金鑰無效';
        errorMessage = '您的 API 金鑰無效或已過期，請使用 `!bind` 重新設定。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title        = '🔌 連線錯誤';
        errorMessage = '無法連線至 Pterodactyl 面板，請稍後再試。';
      } else if (error.message.includes('已無可用的 Port') || error.message.includes('無法取得節點')) {
        title        = '⚠️ 節點 Port 不足';
        errorMessage = error.message;
      } else if (error.message.includes('資料驗證失敗')) {
        title        = '⚠️ 伺服器設定無效';
        errorMessage = error.message;
      } else {
        errorMessage = error.message;
      }
    }

    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle(title)
      .setDescription(errorMessage)
      .setTimestamp();

    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
  }
}
