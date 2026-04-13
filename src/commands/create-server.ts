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
import { UserError } from '../types';

export const data = new SlashCommandBuilder()
  .setName('create-server')
  .setDescription('建立一台新的 Pterodactyl 伺服器')
  .addStringOption(option =>
    option
      .setName('node')
      .setDescription('選擇要部署的節點')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option
      .setName('egg')
      .setDescription('選擇伺服器類型（Egg）；若 .env 已設定 PTERO_EGG_ID 則此選項無效')
      .setRequired(false)
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

/** 自動完成：回傳節點或 Egg 清單供使用者選擇 */
export async function autocomplete(
  interaction: AutocompleteInteraction,
  pterodactylService: PterodactylService
): Promise<void> {
  const focused = interaction.options.getFocused(true);

  pterodactylService.setAdminApiKey();

  if (focused.name === 'node') {
    try {
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
    return;
  }

  if (focused.name === 'egg') {
    // 若 .env 已強制 Egg，仍回傳清單供參考，但 execute 會忽略使用者的選擇
    try {
      const eggs = await pterodactylService.getEggs();
      const query = focused.value.toLowerCase();

      const choices = eggs
        .filter((egg: any) => egg.name.toLowerCase().includes(query) || egg.nest_name?.toLowerCase().includes(query))
        .slice(0, 25)
        .map((egg: any) => ({
          name: `${egg.name} [${egg.nest_name ?? ''}]`,
          // value 格式：nestId:eggId，方便 execute 直接解析
          value: `${egg.nest_id}:${egg.id}`,
        }));

      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
    return;
  }

  await interaction.respond([]);
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
    const eggOption   = interaction.options.getString('egg');          // "nestId:eggId" or null
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

    // 解析 Egg：.env 強制值優先，否則採用使用者選擇
    pterodactylService.setAdminApiKey();
    const forcedEggId  = process.env.PTERO_EGG_ID  ? parseInt(process.env.PTERO_EGG_ID,  10) : undefined;
    const forcedNestId = process.env.PTERO_NEST_ID ? parseInt(process.env.PTERO_NEST_ID, 10) : undefined;

    let nestId: number | undefined;
    let eggId: number | undefined;
    let eggName = '（未知）';

    if (forcedEggId) {
      // .env 強制使用特定 Egg
      eggId  = forcedEggId;
      nestId = forcedNestId;
      if (nestId) {
        try {
          const eggInfo = await pterodactylService.getEgg(nestId, eggId);
          eggName = eggInfo.name ?? eggName;
        } catch { /* 顯示名稱取得失敗不影響主流程 */ }
      }
    } else if (eggOption) {
      // 使用者透過自動完成選擇了 Egg
      const parts = eggOption.split(':');
      nestId = parseInt(parts[0], 10);
      eggId  = parseInt(parts[1], 10);
      if (isNaN(nestId) || isNaN(eggId)) {
        const embed = new EmbedBuilder()
          .setColor('Red')
          .setTitle('❌ 無效的 Egg')
          .setDescription('請從自動完成清單中選擇有效的 Egg 類型。')
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      try {
        const eggInfo = await pterodactylService.getEgg(nestId, eggId);
        eggName = eggInfo.name ?? eggName;
      } catch { /* 顯示名稱取得失敗不影響主流程 */ }
    } else {
      // 未強制且未選擇 → 提示使用者
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 未選擇 Egg')
        .setDescription('請在 `egg` 選項中選擇一個伺服器類型，或請管理員在 `.env` 設定 `PTERO_EGG_ID` 以固定類型。')
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 取得節點名稱（用於顯示）
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
        { name: 'Egg', value: eggName, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [processingEmbed] });

    // 建立伺服器（含自動取得 Allocation）
    const server = await pterodactylService.createServer({
      name,
      description,
      memory,
      disk,
      cpu,
      nodeId,
      nestId,
      eggId,
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
        { name: '🥚 Egg 類型', value: eggName, inline: true },
      )
      .setFooter({ text: '伺服器安裝中，可能需要數分鐘。' })
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed], components: [] });

    Logger.info(
      `使用者 ${interaction.user.tag} 建立伺服器：${server.name} (${server.uuid})，節點：${nodeName}，Egg：${eggName}`
    );
  } catch (error) {
    if (error instanceof UserError) {
      Logger.warn('create-server 指令使用者錯誤：', error);
    } else {
      Logger.error('create-server 指令發生錯誤：', error);
    }

    let title        = '❌ 發生錯誤';
    let errorMessage = '建立伺服器時發生錯誤，請稍後再試。';

    if (error instanceof Error) {
      if (error.message.includes('必須先綁定帳號')) {
        title        = '🔗 尚未綁定帳號';
        errorMessage = '您需要先將 Discord 帳號與 Pterodactyl 帳號綁定！\n\n請使用 `/bind <您的 API 金鑰>` 開始綁定。';
      } else if (error.message.includes('API 金鑰無效')) {
        title        = '🔑 API 金鑰無效';
        errorMessage = '您的 API 金鑰無效或已過期，請使用 `/bind` 重新設定。';
      } else if (error.message.includes('連線被拒絕') || error.message.includes('ECONNREFUSED')) {
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

    pterodactylService.setAdminApiKey();

    // 判斷是否由 .env 強制指定 Egg
    const forcedEggId  = process.env.PTERO_EGG_ID  ? parseInt(process.env.PTERO_EGG_ID,  10) : undefined;
    const forcedNestId = process.env.PTERO_NEST_ID ? parseInt(process.env.PTERO_NEST_ID, 10) : undefined;
    const isEggForced  = !!forcedEggId;

    // 依是否強制 Egg 決定參數順序與最少參數數量
    // 強制 Egg：!create-server <節點ID> <名稱> <記憶體MB> <磁碟MB> <CPU%> [描述]
    // 自選 Egg：!create-server <節點ID> <EggID> <名稱> <記憶體MB> <磁碟MB> <CPU%> [描述]
    const minArgs = isEggForced ? 5 : 6;
    if (args.length < minArgs) {
      const usageLine = isEggForced
        ? '`!create-server <節點ID> <名稱> <記憶體MB> <磁碟MB> <CPU%> [描述]`'
        : '`!create-server <節點ID> <EggID> <名稱> <記憶體MB> <磁碟MB> <CPU%> [描述]`';
      const exampleLine = isEggForced
        ? '`!create-server 1 MyBot 1024 5120 100 "我的 Bot"`'
        : '`!create-server 1 15 MyBot 1024 5120 100 "我的 Bot"`';

      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 參數不足')
        .setDescription('缺少必填參數！')
        .addFields(
          { name: '用法', value: usageLine, inline: false },
          { name: '範例', value: exampleLine, inline: false },
        )
        .setTimestamp();

      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return;
    }

    let nodeId: number;
    let resolvedNestId: number | undefined;
    let resolvedEggId: number | undefined;
    let name: string;
    let memory: number;
    let disk: number;
    let cpu: number;
    let description: string | undefined;
    let eggName = '（未知）';

    if (isEggForced) {
      nodeId      = parseInt(args[0], 10);
      name        = args[1];
      memory      = parseInt(args[2], 10);
      disk        = parseInt(args[3], 10);
      cpu         = parseInt(args[4], 10);
      description = args.slice(5).join(' ') || undefined;
      resolvedEggId  = forcedEggId;
      resolvedNestId = forcedNestId;
      if (resolvedNestId) {
        try {
          const eggInfo = await pterodactylService.getEgg(resolvedNestId, resolvedEggId!);
          eggName = eggInfo.name ?? eggName;
        } catch { /* 顯示名稱取得失敗不影響主流程 */ }
      }
    } else {
      nodeId      = parseInt(args[0], 10);
      const userEggId = parseInt(args[1], 10);
      name        = args[2];
      memory      = parseInt(args[3], 10);
      disk        = parseInt(args[4], 10);
      cpu         = parseInt(args[5], 10);
      description = args.slice(6).join(' ') || undefined;

      if (isNaN(userEggId)) {
        const embed = new EmbedBuilder()
          .setColor('Red')
          .setTitle('❌ 無效的 Egg ID')
          .setDescription('EggID 必須為有效數字。請使用 `/create-server` 透過自動完成查詢可用的 Egg。')
          .setTimestamp();
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        return;
      }

      // 在所有 Nest 中尋找該 Egg
      const foundEgg = await pterodactylService.findEggById(userEggId);
      if (!foundEgg) {
        const embed = new EmbedBuilder()
          .setColor('Red')
          .setTitle('❌ 找不到 Egg')
          .setDescription(`找不到 ID 為 **${userEggId}** 的 Egg。請使用 \`/create-server\` 的自動完成查看所有可用類型。`)
          .setTimestamp();
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        return;
      }

      resolvedEggId  = foundEgg.id;
      resolvedNestId = foundEgg.nest_id;
      eggName        = foundEgg.name ?? eggName;
    }

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
      nestId: resolvedNestId,
      eggId:  resolvedEggId,
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
        { name: '🥚 Egg 類型', value: eggName, inline: true },
      )
      .setFooter({ text: '伺服器安裝中，可能需要數分鐘。' })
      .setTimestamp();

    await processingMsg.edit({ embeds: [successEmbed], components: [] });

    Logger.info(
      `使用者 ${message.author.tag} 建立伺服器：${server.name} (${server.uuid})，節點：${nodeName}，Egg：${eggName}`
    );
  } catch (error) {
    if (error instanceof UserError) {
      Logger.warn('create-server 前綴指令使用者錯誤：', error);
    } else {
      Logger.error('create-server 前綴指令發生錯誤：', error);
    }

    let title        = '❌ 發生錯誤';
    let errorMessage = '建立伺服器時發生錯誤，請稍後再試。';

    if (error instanceof Error) {
      if (error.message.includes('必須先綁定帳號')) {
        title        = '🔗 尚未綁定帳號';
        errorMessage = '您需要先將 Discord 帳號與 Pterodactyl 帳號綁定！\n\n請使用 `!bind <您的 API 金鑰>` 開始綁定。';
      } else if (error.message.includes('API 金鑰無效')) {
        title        = '🔑 API 金鑰無效';
        errorMessage = '您的 API 金鑰無效或已過期，請使用 `!bind` 重新設定。';
      } else if (error.message.includes('連線被拒絕') || error.message.includes('ECONNREFUSED')) {
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
