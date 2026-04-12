import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ComponentType,
  Message,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('create-server')
  .setDescription('建立一台新的 Pterodactyl 伺服器')
  .addStringOption(option =>
    option.setName('name')
      .setDescription('伺服器名稱')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('memory')
      .setDescription('記憶體大小（MB），例如：1024')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('disk')
      .setDescription('磁碟空間（MB），例如：5120')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('cpu')
      .setDescription('CPU 使用率百分比，例如：100')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('description')
      .setDescription('伺服器描述')
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  try {
    await interaction.deferReply();

    // 檢查使用者是否已驗證
    const context = await authService.requireAuth(interaction.user, interaction.member as any);
    
    const name = interaction.options.getString('name', true);
    const description = interaction.options.getString('description') || '';
    const memory = interaction.options.getInteger('memory', true);
    const disk = interaction.options.getInteger('disk', true);
    const cpu = interaction.options.getInteger('cpu', true);

    // 設定管理員 API 金鑰以取得 egg 和節點資訊
    pterodactylService.setAdminApiKey();    // 取得可用的 egg 和節點
    let eggs, nodes;
    try {
      [eggs, nodes] = await Promise.all([
        pterodactylService.getEggs(),
        pterodactylService.getNodes()
      ]);
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 錯誤')
        .setDescription('無法取得可用的伺服器選項，請稍後再試。')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 過濾掉未定義或不完整的 egg
    const validEggs = eggs.filter(
      (egg: any) => egg && egg.id && egg.name && egg.nest_name
    );

    if (validEggs.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 目前沒有可用的伺服器類型')
        .setDescription('目前沒有任何有效的伺服器類型可供使用。')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (nodes.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 沒有可用的節點')
        .setDescription('目前沒有任何節點可用於部署伺服器。')
        .setTimestamp();      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 步驟一：選擇節點
    const nodeSelectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_node')
      .setPlaceholder('選擇節點／位置')      .addOptions(
        nodes.filter(node => node && (node.name || node.attributes?.name) && (node.id || node.attributes?.id)).slice(0, 25).map(node => ({
          label: `${node.name || node.attributes?.name} (${node.location_id || node.attributes?.location_id})`,
          description: `${(node.memory || node.attributes?.memory) - ((node.allocated_resources?.memory || node.attributes?.allocated_resources?.memory) || 0)}MB 可用 RAM`,
          value: (node.id || node.attributes?.id).toString(),
        }))
      );

    const nodeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(nodeSelectMenu);

    const nodeEmbed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle('🌍 選擇節點／位置')
      .setDescription('請選擇要部署伺服器的節點：')
      .addFields(
        { name: '伺服器名稱', value: name, inline: true },
        { name: '記憶體', value: `${memory} MB`, inline: true },
        { name: '磁碟', value: `${disk} MB`, inline: true },
        { name: 'CPU', value: `${cpu}%`, inline: true }
      )
      .setTimestamp();

    const nodeResponse = await interaction.editReply({
      embeds: [nodeEmbed],
      components: [nodeRow]
    });

    let selectedNodeId: number;

    try {
      const nodeInteraction = await nodeResponse.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === interaction.user.id,
        time: 60000
      });

      await nodeInteraction.deferUpdate();
      selectedNodeId = parseInt(nodeInteraction.values[0]);

      // 步驟二：選擇 Egg
      const eggSelectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_egg')
        .setPlaceholder('選擇伺服器類型')
        .addOptions(
          validEggs.slice(0, 25).map(egg => ({
            label: `${egg.name} (${egg.nest_name})`,
            description: egg.description?.substring(0, 80) || `來自 ${egg.nest_name} 巢`,
            value: egg.id.toString(),
          }))
        );

      const eggRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eggSelectMenu);

      const eggEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('🥚 選擇伺服器類型')
        .setDescription('請從下拉選單中選擇伺服器類型：')
        .addFields(
          { name: '伺服器名稱', value: name, inline: true },          { name: '記憶體', value: `${memory} MB`, inline: true },
          { name: '磁碟', value: `${disk} MB`, inline: true },
          { name: 'CPU', value: `${cpu}%`, inline: true },
          { name: '節點', value: nodes.find(n => (n.id || n.attributes?.id) === selectedNodeId)?.name || nodes.find(n => (n.id || n.attributes?.id) === selectedNodeId)?.attributes?.name || '未知', inline: true }
        )
        .setTimestamp();

      await nodeInteraction.editReply({
        embeds: [eggEmbed],
        components: [eggRow]
      });      const eggInteraction = await nodeResponse.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === interaction.user.id,
        time: 60000
      });      const selectedEggId = parseInt(eggInteraction.values[0]);
      const selectedNode = nodes.find(n => (n.id || n.attributes?.id) === selectedNodeId);
      const selectedEgg = validEggs.find(e => e.id === selectedEggId);

      // 延遲互動以建立伺服器
      await eggInteraction.deferUpdate();

      // 建立伺服器（服務層自動處理預設值）
      const server = await pterodactylService.createServer({
        name,
        description,
        memory,
        disk,
        cpu,
        egg: selectedEggId,
        location: selectedNode?.location_id || selectedNode?.attributes?.location_id || 1,
        allocation: selectedNode?.id || selectedNode?.attributes?.id || 1,
        user: context.user.pterodactyl_user_id
      });

      // 新增至資料庫
      (authService as any).db.addUserServer(interaction.user.id, server.uuid, server.name);

      const successEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ 伺服器已成功建立')
        .setDescription(`您的伺服器 **${server.name}** 已建立！`)
        .addFields(
          { name: '🆔 伺服器 ID', value: server.uuid, inline: true },
          { name: '📊 狀態', value: server.status || '安裝中', inline: true },
          { name: '💾 記憶體', value: `${server.limits.memory} MB`, inline: true },
          { name: '💿 磁碟', value: `${server.limits.disk} MB`, inline: true },
          { name: '⚡ CPU', value: `${server.limits.cpu}%`, inline: true },
          { name: '🌍 節點', value: selectedNode?.name || selectedNode?.attributes?.name || '未知', inline: true },
          { name: '🥚 類型', value: `${selectedEgg?.name} (${selectedEgg?.nest_name})`, inline: true }
        )
        .setFooter({ text: '伺服器正在安裝中，可能需要幾分鐘。啟動指令已自動設定。' })
        .setTimestamp();

      await eggInteraction.editReply({
        embeds: [successEmbed],
        components: []
      });Logger.info(`使用者 ${interaction.user.tag} 已建立伺服器：${server.name} (${server.uuid})，節點：${selectedNode?.name || selectedNode?.attributes?.name || '未知'}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('time')) {
        const timeoutEmbed = new EmbedBuilder()
          .setColor('Orange')
          .setTitle('⏰ 選擇逾時')
          .setDescription('已因逾時取消建立伺服器。')
          .setTimestamp();

        await interaction.editReply({
          embeds: [timeoutEmbed],
          components: []
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    Logger.error('create-server 指令發生錯誤：', error);
    
    let errorMessage = '建立伺服器時發生錯誤。';
    let title = '❌ 錯誤';
    
    // 針對特定錯誤類型顯示更友善的訊息
    if (error instanceof Error) {
      if (error.message.includes('bind your account first')) {
        title = '🔗 帳號尚未綁定';
        errorMessage = '您需要先將 Discord 帳號與 Pterodactyl 帳號綁定！\n\n請使用 `/bind <您的_api_key>` 開始綁定。';
      } else if (error.message.includes('Invalid API key')) {
        title = '🔑 無效的 API 金鑰';
        errorMessage = '您的 API 金鑰似乎無效或已過期，請使用 `/bind` 重新綁定新的 API 金鑰。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title = '🔌 連線錯誤';
        errorMessage = '無法連線至 Pterodactyl 面板，請稍後再試。';
      } else if (error.message.includes('Validation failed')) {
        title = '⚠️ 伺服器設定無效';
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
) {
  try {
    // 檢查使用者是否已驗證
    const context = await authService.requireAuth(message.author, message.member as any);
    
    // 檢查必要的參數
    if (args.length < 4) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 用法錯誤')
        .setDescription('缺少必要的參數！')
        .addFields(
          { 
            name: '用法', 
            value: '`!create-server <名稱> <記憶體MB> <磁碟MB> <CPU百分比> [描述]`',
            inline: false 
          },
          { 
            name: '範例', 
            value: '`!create-server MyServer 1024 5120 100 "我的超棒伺服器"`',
            inline: false 
          }
        )
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    const name = args[0];
    const memory = parseInt(args[1]);
    const disk = parseInt(args[2]);
    const cpu = parseInt(args[3]);
    let description = args.slice(4).join(' ') || undefined;

    // 驗證數字輸入
    if (isNaN(memory) || isNaN(disk) || isNaN(cpu)) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 輸入無效')
        .setDescription('記憶體、磁碟與 CPU 必須為有效的數字！')
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    // 設定管理員 API 金鑰以取得 egg 和節點資訊
    pterodactylService.setAdminApiKey();

    // 取得可用的 egg 和節點
    let eggs, nodes;
    try {
      [eggs, nodes] = await Promise.all([
        pterodactylService.getEggs(),
        pterodactylService.getNodes()
      ]);
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 錯誤')
        .setDescription('無法取得可用的伺服器選項，請稍後再試。')
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    // 過濾掉未定義或不完整的 egg
    const validEggs = eggs.filter(
      (egg: any) => egg && egg.id && egg.name && egg.nest_name
    );

    if (validEggs.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 目前沒有可用的伺服器類型')
        .setDescription('目前沒有任何有效的伺服器類型可供使用。')
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    if (nodes.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 沒有可用的節點')
        .setDescription('目前沒有任何節點可用於部署伺服器。')
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    // 步驟一：選擇節點
    const nodeSelectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_node')
      .setPlaceholder('選擇節點／位置')
      .addOptions(
        nodes.filter(node => node && (node.name || node.attributes?.name) && (node.id || node.attributes?.id)).slice(0, 25).map(node => ({
          label: `${node.name || node.attributes?.name} (${node.location_id || node.attributes?.location_id})`,
          description: `${(node.memory || node.attributes?.memory) - ((node.allocated_resources?.memory || node.attributes?.allocated_resources?.memory) || 0)}MB 可用 RAM`,
          value: (node.id || node.attributes?.id).toString(),
        }))
      );

    const nodeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(nodeSelectMenu);

    const nodeEmbed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle('🌍 選擇節點／位置')
      .setDescription('請選擇要部署伺服器的節點：')
      .addFields(
        { name: '伺服器名稱', value: name, inline: true },
        { name: '記憶體', value: `${memory} MB`, inline: true },
        { name: '磁碟', value: `${disk} MB`, inline: true },
        { name: 'CPU', value: `${cpu}%`, inline: true }
      )
      .setTimestamp();

    const nodeResponse = await message.reply({
      embeds: [nodeEmbed],
      components: [nodeRow],
      allowedMentions: { repliedUser: false }
    });

    let selectedNodeId: number;

    try {
      const nodeInteraction = await nodeResponse.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === message.author.id,
        time: 60000
      });

      await nodeInteraction.deferUpdate();
      selectedNodeId = parseInt(nodeInteraction.values[0]);

      // 步驟二：選擇 Egg
      const eggSelectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_egg')
        .setPlaceholder('選擇伺服器類型')
        .addOptions(
          validEggs.slice(0, 25).map(egg => ({
            label: `${egg.name} (${egg.nest_name})`,
            description: egg.description?.substring(0, 80) || `來自 ${egg.nest_name} 巢`,
            value: egg.id.toString(),
          }))
        );

      const eggRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eggSelectMenu);

      const eggEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('🥚 選擇伺服器類型')
        .setDescription('請從下拉選單中選擇伺服器類型：')
        .addFields(
          { name: '伺服器名稱', value: name, inline: true },
          { name: '記憶體', value: `${memory} MB`, inline: true },
          { name: '磁碟', value: `${disk} MB`, inline: true },
          { name: 'CPU', value: `${cpu}%`, inline: true },
          { name: '節點', value: nodes.find(n => (n.id || n.attributes?.id) === selectedNodeId)?.name || nodes.find(n => (n.id || n.attributes?.id) === selectedNodeId)?.attributes?.name || '未知', inline: true }
        )
        .setTimestamp();

      await nodeInteraction.editReply({
        embeds: [eggEmbed],
        components: [eggRow]
      });

      const eggInteraction = await nodeResponse.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === message.author.id,
        time: 60000
      });

      const selectedEggId = parseInt(eggInteraction.values[0]);
      const selectedNode = nodes.find(n => (n.id || n.attributes?.id) === selectedNodeId);
      const selectedEgg = validEggs.find(e => e.id === selectedEggId);

      // 延遲互動以建立伺服器
      await eggInteraction.deferUpdate();

      // 建立伺服器（服務層自動處理預設值）
      const server = await pterodactylService.createServer({
        name,
        description,
        memory,
        disk,
        cpu,
        egg: selectedEggId,
        location: selectedNode?.location_id || selectedNode?.attributes?.location_id || 1,
        allocation: selectedNode?.id || selectedNode?.attributes?.id || 1,
        user: context.user.pterodactyl_user_id
      });

      // 新增至資料庫
      (authService as any).db.addUserServer(message.author.id, server.uuid, server.name);

      const successEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ 伺服器已成功建立')
        .setDescription(`您的伺服器 **${server.name}** 已建立！`)
        .addFields(
          { name: '🆔 伺服器 ID', value: server.uuid, inline: true },
          { name: '📊 狀態', value: server.status || '安裝中', inline: true },
          { name: '💾 記憶體', value: `${server.limits.memory} MB`, inline: true },
          { name: '💿 磁碟', value: `${server.limits.disk} MB`, inline: true },
          { name: '⚡ CPU', value: `${server.limits.cpu}%`, inline: true },
          { name: '🌍 節點', value: selectedNode?.name || selectedNode?.attributes?.name || '未知', inline: true },
          { name: '🥚 類型', value: `${selectedEgg?.name} (${selectedEgg?.nest_name})`, inline: true }
        )
        .setFooter({ text: '伺服器正在安裝中，可能需要幾分鐘。啟動指令已自動設定。' })
        .setTimestamp();

      await eggInteraction.editReply({
        embeds: [successEmbed],
        components: []
      });

      Logger.info(`使用者 ${message.author.tag} 已建立伺服器：${server.name} (${server.uuid})，節點：${selectedNode?.name || selectedNode?.attributes?.name || '未知'}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('time')) {
        const timeoutEmbed = new EmbedBuilder()
          .setColor('Orange')
          .setTitle('⏰ 選擇逾時')
          .setDescription('已因逾時取消建立伺服器。')
          .setTimestamp();

        await nodeResponse.edit({
          embeds: [timeoutEmbed],
          components: []
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    Logger.error('create-server 指令（前綴）發生錯誤：', error);
    
    let errorMessage = '建立伺服器時發生錯誤。';
    let title = '❌ 錯誤';
    
    // 針對特定錯誤類型顯示更友善的訊息
    if (error instanceof Error) {
      if (error.message.includes('bind your account first')) {
        title = '🔗 帳號尚未綁定';
        errorMessage = '您需要先將 Discord 帳號與 Pterodactyl 帳號綁定！\n\n請使用 `!bind <您的_api_key>` 開始綁定。';
      } else if (error.message.includes('Invalid API key')) {
        title = '🔑 無效的 API 金鑰';
        errorMessage = '您的 API 金鑰似乎無效或已過期，請使用 `!bind` 重新綁定新的 API 金鑰。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title = '🔌 連線錯誤';
        errorMessage = '無法連線至 Pterodactyl 面板，請稍後再試。';
      } else if (error.message.includes('Validation failed')) {
        title = '⚠️ 伺服器設定無效';
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

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  }
}
