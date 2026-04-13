import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ComponentType,
  Message
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';
import { UserError } from '../types';

export const data = new SlashCommandBuilder()
  .setName('power')
  .setDescription('控制您伺服器的電源狀態')
  .addStringOption(option =>
    option.setName('server_id')
      .setDescription('伺服器 UUID 或名稱（選填 - 若未提供將顯示選擇選單）')
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName('action')
      .setDescription('要執行的電源動作')
      .setRequired(false)
      .addChoices(
        { name: '🟢 啟動', value: 'start' },
        { name: '🔴 停止', value: 'stop' },
        { name: '🔄 重啟', value: 'restart' },
        { name: '⚡ 強制停止', value: 'kill' }
      )
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
    
    const serverId = interaction.options.getString('server_id');
    const action = interaction.options.getString('action');

    if (serverId && action) {
      // 直接電源動作
      await executePowerAction(interaction, serverId, action, context, pterodactylService);
    } else if (serverId && !action) {
      // 顯示特定伺服器的動作選擇
      await showActionSelection(interaction, serverId, context, pterodactylService);
    } else {
      // 顯示伺服器選擇
      await showServerSelection(interaction, context, pterodactylService);
    }

  } catch (error) {
    if (error instanceof UserError) {
      Logger.warn('Error in power command:', error);
    } else {
      Logger.error('Error in power command:', error);
    }
    
    let errorMessage = '管理伺服器電源時發生錯誤。';
    let title = '❌ 錯誤';
    
    // 處理特定錯誤類型
    if (error instanceof Error) {
      if (error.message.includes('bind your account first')) {
        title = '🔗 帳號未綁定';
        errorMessage = '您需要先將 Discord 帳號綁定至 Pterodactyl 帳號！\n\n請使用 `/bind` 開始設定。';
      } else if (error.message.includes('Invalid API key')) {
        title = '🔑 無效的 API 金鑰';
        errorMessage = '您的 API 金鑰似乎無效或已過期。請使用 `/bind` 重新設定新的 API 金鑰。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title = '🔌 連線錯誤';
        errorMessage = '無法連線至 Pterodactyl 面板。請稍後再試。';
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
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

async function executePowerAction(
  interaction: ChatInputCommandInteraction,
  serverId: string,
  action: string,
  context: any,
  pterodactylService: PterodactylService
) {
  // 設定使用者 API 金鑰
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
  
  // 取得使用者伺服器並驗證所有權
  const userServers = await pterodactylService.getUserServers();
  const server = userServers.find(s => 
    s.uuid === serverId || 
    s.id?.toString() === serverId ||
    s.uuid.startsWith(serverId) || // 部分 UUID 比對
    s.name.toLowerCase() === serverId.toLowerCase() // 名稱比對
  );

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到伺服器')
      .setDescription(`找不到識別碼為 \`${serverId}\` 的伺服器，或該伺服器不屬於您。`)
      .addFields(
        { 
          name: '💡 提示', 
          value: '請不帶參數使用 `/power` 查看您的可用伺服器。',
          inline: false 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }
  // 執行電源動作
  const processingEmbed = new EmbedBuilder()
    .setColor('Yellow')
    .setTitle('⏳ 處理中...')
    .setDescription(`正在對伺服器 **${server.name}** 執行 ${getActionEmoji(action)} **${getActionName(action)}**...`)
    .setTimestamp();

  await interaction.editReply({ embeds: [processingEmbed] });

  try {
    await pterodactylService.sendPowerAction(server.uuid, action as 'start' | 'stop' | 'restart' | 'kill');

    // 取得更新後的伺服器狀態
    const updatedServer = await pterodactylService.getServerDetails(server.uuid);
    
    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 電源動作已完成')
      .setDescription(`已成功對伺服器 **${server.name}** 執行 **${getActionName(action)}**。`)
      .addFields(
        { name: '🏷️ 伺服器名稱', value: server.name, inline: true },
        { name: '📊 狀態', value: getStatusEmoji(updatedServer.status) + ' ' + updatedServer.status, inline: true },
        { name: '⚡ 動作', value: `${getActionEmoji(action)} ${getActionName(action)}`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    Logger.info(`使用者 ${interaction.user.tag} 對伺服器執行了 ${action}：${server.name} (${server.uuid})`);

  } catch (error) {
    Logger.error('執行電源動作時發生錯誤：', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 電源動作失敗')
      .setDescription(`無法對伺服器 **${server.name}** 執行 **${getActionName(action)}**。`)
      .addFields(
        { 
          name: '🔍 錯誤詳情', 
          value: error instanceof Error ? error.message : '發生未知錯誤',
          inline: false 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function showActionSelection(
  interaction: ChatInputCommandInteraction,
  serverId: string,
  context: any,
  pterodactylService: PterodactylService
) {
  // 設定使用者 API 金鑰
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
  
  // 取得使用者伺服器並驗證所有權
  const userServers = await pterodactylService.getUserServers();
  const server = userServers.find(s => 
    s.uuid === serverId || 
    s.id?.toString() === serverId ||
    s.uuid.startsWith(serverId) || 
    s.name.toLowerCase() === serverId.toLowerCase()
  );

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到伺服器')
      .setDescription(`找不到識別碼為 \`${serverId}\` 的伺服器，或該伺服器不屬於您。`)
      .addFields(
        { 
          name: '💡 提示', 
          value: '請不帶參數使用 `/power` 查看您的可用伺服器。',
          inline: false 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 取得當前伺服器狀態
  const serverDetails = await pterodactylService.getServerDetails(server.uuid);

  // 建立動作選擇選單
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_power_action')
    .setPlaceholder('選擇電源動作')
    .addOptions([
      {
        label: '🟢 啟動伺服器',
        description: '若伺服器已停止，則將其啟動',
        value: `start:${server.uuid}`,
      },
      {
        label: '🔴 停止伺服器',
        description: '正常停止伺服器',
        value: `stop:${server.uuid}`,
      },
      {
        label: '🔄 重啟伺服器',
        description: '重啟伺服器',
        value: `restart:${server.uuid}`,
      },
      {
        label: '⚡ 強制停止伺服器',
        description: '立即強制停止伺服器',
        value: `kill:${server.uuid}`,
      }
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('⚡ 伺服器電源控制')
    .setDescription(`請為伺服器 **${server.name}** 選擇電源動作：`)
    .addFields(
      { name: '🏷️ 伺服器名稱', value: server.name, inline: true },
      { name: '📊 當前狀態', value: getStatusEmoji(serverDetails.status) + ' ' + serverDetails.status, inline: true },
      { name: '🔗 UUID', value: server.uuid.substring(0, 8) + '...', inline: true }
    )
    .setTimestamp();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row]
  });

  // 等待選擇
  try {
    const selectInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id,
      time: 60000
    });

    const [action, serverUuid] = selectInteraction.values[0].split(':');
    
    await selectInteraction.deferUpdate();
    await executePowerAction(interaction, serverUuid, action, context, pterodactylService);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('time')) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ 選擇逾時')
        .setDescription('電源動作選擇因逾時已取消。')
        .setTimestamp();

      await interaction.editReply({
        embeds: [timeoutEmbed],
        components: []
      });
    } else {
      throw error;
    }
  }
}

async function showServerSelection(
  interaction: ChatInputCommandInteraction,
  context: any,
  pterodactylService: PterodactylService
) {
  // 設定使用者 API 金鑰
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);

  // 取得使用者伺服器
  const servers = await pterodactylService.getUserServers();

  if (servers.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle('📋 找不到伺服器')
      .setDescription('您沒有任何可管理的伺服器。')
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 為伺服器建立選擇選單
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_server_power')
    .setPlaceholder('選擇要管理的伺服器')
    .addOptions(
      servers.slice(0, 25).map(server => ({
        label: server.name,
        description: `狀態：${server.status} | UUID：${server.uuid.substring(0, 8)}...`,
        value: server.uuid,
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('⚡ 伺服器電源管理')
    .setDescription('選擇伺服器以管理其電源狀態：')
    .addFields(
      servers.slice(0, 10).map(server => ({
        name: server.name,
        value: `**狀態：** ${getStatusEmoji(server.status)} ${server.status}\n**UUID：** \`${server.uuid}\``,
        inline: true
      }))
    )
    .setTimestamp();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row]
  });

  // 等待選擇
  try {
    const selectInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id,
      time: 60000
    });

    const selectedServerUuid = selectInteraction.values[0];
    
    await selectInteraction.deferUpdate();
    await showActionSelection(interaction, selectedServerUuid, context, pterodactylService);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('time')) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ 選擇逾時')
        .setDescription('伺服器選擇因逾時已取消。')
        .setTimestamp();

      await interaction.editReply({
        embeds: [timeoutEmbed],
        components: []
      });
    } else {
      throw error;
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
    
    if (args.length === 0) {
      // 顯示用法資訊
      const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('⚡ 伺服器電源管理')
        .setDescription('控制您伺服器的電源狀態。')
        .addFields(
          { 
            name: '用法', 
            value: '`!power <server_id> <action>`\nor\n`!power <server_id>` (to select action)\nor\n`!power` (to select server)',
            inline: false 
          },
          { 
            name: '可用動作', 
            value: '• `start` - 🟢 啟動伺服器\n• `stop` - 🔴 停止伺服器\n• `restart` - 🔄 重啟伺服器\n• `kill` - ⚡ 強制停止伺服器',
            inline: false 
          },
          { 
            name: '範例', 
            value: '`!power MyServer start`\n`!power 12345678 restart`\n`!power MyServer` (shows action menu)',
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

    if (args.length === 1) {
      // 已提供伺服器 ID，顯示動作選擇
      const serverId = args[0];
      await executePrefixActionSelection(message, serverId, context, pterodactylService);
    } else if (args.length >= 2) {
      // 已提供伺服器 ID 和動作
      const serverId = args[0];
      const action = args[1].toLowerCase();
      
      // 驗證動作
      const validActions = ['start', 'stop', 'restart', 'kill'];
      if (!validActions.includes(action)) {
        const embed = new EmbedBuilder()
          .setColor('Red')
          .setTitle('❌ 無效的動作')
          .setDescription(`無效的電源動作：\`${action}\``)
          .addFields(
            { 
              name: '有效動作', 
              value: validActions.map(a => `• \`${a}\` - ${getActionEmoji(a)} ${getActionName(a)}`).join('\n'),
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

      await executePrefixPowerAction(message, serverId, action, context, pterodactylService);
    }

  } catch (error) {
    if (error instanceof UserError) {
      Logger.warn('Error in power command (prefix):', error);
    } else {
      Logger.error('Error in power command (prefix):', error);
    }
    
    const errorMessage = error instanceof Error ? error.message : '管理伺服器電源時發生錯誤。';
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription(errorMessage)
      .setTimestamp();

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  }
}

async function executePrefixPowerAction(
  message: Message,
  serverId: string,
  action: string,
  context: any,
  pterodactylService: PterodactylService
) {
  // 設定使用者 API 金鑰
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
  
  // 取得使用者伺服器並驗證所有權
  const userServers = await pterodactylService.getUserServers();
  const server = userServers.find(s => 
    s.uuid === serverId || 
    s.id?.toString() === serverId ||
    s.uuid.startsWith(serverId) || 
    s.name.toLowerCase() === serverId.toLowerCase()
  );

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到伺服器')
      .setDescription(`找不到識別碼為 \`${serverId}\` 的伺服器，或該伺服器不屬於您。`)
      .addFields(
        { 
          name: '💡 提示', 
          value: '請不帶參數使用 `!power` 查看您的可用伺服器，或使用 `!servers` 列出所有伺服器。',
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

  // 執行電源動作
  const processingEmbed = new EmbedBuilder()
    .setColor('Yellow')
    .setTitle('⏳ 處理中...')
    .setDescription(`正在對伺服器 **${server.name}** 執行 ${getActionEmoji(action)} **${getActionName(action)}**...`)
    .setTimestamp();
  const processingMessage = await message.reply({ 
    embeds: [processingEmbed],
    allowedMentions: { repliedUser: false }
  });

  try {
    await pterodactylService.sendPowerAction(server.uuid, action as 'start' | 'stop' | 'restart' | 'kill');

    // 取得更新後的伺服器狀態
    const updatedServer = await pterodactylService.getServerDetails(server.uuid);
    
    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 電源動作已完成')
      .setDescription(`已成功對伺服器 **${server.name}** 執行 **${getActionName(action)}**。`)
      .addFields(
        { name: '🏷️ 伺服器名稱', value: server.name, inline: true },
        { name: '📊 狀態', value: getStatusEmoji(updatedServer.status) + ' ' + updatedServer.status, inline: true },
        { name: '⚡ 動作', value: `${getActionEmoji(action)} ${getActionName(action)}`, inline: true }
      )
      .setTimestamp();

    await processingMessage.edit({ embeds: [successEmbed] });

    Logger.info(`使用者 ${message.author.tag} 對伺服器執行了 ${action}：${server.name} (${server.uuid})`);

  } catch (error) {
    Logger.error('執行電源動作時發生錯誤：', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 電源動作失敗')
      .setDescription(`無法對伺服器 **${server.name}** 執行 **${getActionName(action)}**。`)
      .addFields(
        { 
          name: '🔍 錯誤詳情', 
          value: error instanceof Error ? error.message : '發生未知錯誤',
          inline: false 
        }
      )
      .setTimestamp();

    await processingMessage.edit({ embeds: [errorEmbed] });
  }
}

async function executePrefixActionSelection(
  message: Message,
  serverId: string,
  context: any,
  pterodactylService: PterodactylService
) {
  // 設定使用者 API 金鑰
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
  
  // 取得使用者伺服器並驗證所有權
  const userServers = await pterodactylService.getUserServers();
  const server = userServers.find(s => 
    s.uuid === serverId || 
    s.id?.toString() === serverId ||
    s.uuid.startsWith(serverId) || 
    s.name.toLowerCase() === serverId.toLowerCase()
  );

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到伺服器')
      .setDescription(`找不到識別碼為 \`${serverId}\` 的伺服器，或該伺服器不屬於您。`)
      .addFields(
        { 
          name: '💡 提示', 
          value: '請不帶參數使用 `!power` 查看您的可用伺服器，或使用 `!servers` 列出所有伺服器。',
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

  // 取得當前伺服器狀態
  const serverDetails = await pterodactylService.getServerDetails(server.uuid);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('⚡ 伺服器電源控制')
    .setDescription(`請回覆動作名稱以為伺服器 **${server.name}** 選擇電源動作：`)
    .addFields(
      { name: '🏷️ 伺服器名稱', value: server.name, inline: true },
      { name: '📊 當前狀態', value: getStatusEmoji(serverDetails.status) + ' ' + serverDetails.status, inline: true },
      { name: '🔗 UUID', value: server.uuid.substring(0, 8) + '...', inline: true },
      { 
        name: '可用動作', 
        value: '• `start` - 🟢 啟動伺服器\n• `stop` - 🔴 停止伺服器\n• `restart` - 🔄 重啟伺服器\n• `kill` - ⚡ 強制停止伺服器',
        inline: false 
      },
      { 
        name: '用法', 
        value: `\`!power ${serverId} <action>\`\n範例：\`!power ${serverId} start\``,
        inline: false 
      }
    )
    .setTimestamp();

  await message.reply({ 
    embeds: [embed],
    allowedMentions: { repliedUser: false }
  });
}

// 工具函式
function getActionEmoji(action: string): string {
  switch (action) {
    case 'start': return '🟢';
    case 'stop': return '🔴';
    case 'restart': return '🔄';
    case 'kill': return '⚡';
    default: return '❓';
  }
}

function getActionName(action: string): string {
  switch (action) {
    case 'start': return '啟動';
    case 'stop': return '停止';
    case 'restart': return '重啟';
    case 'kill': return '強制停止';
    default: return '未知';
  }
}

function getStatusEmoji(status: string): string {
  switch (status?.toLowerCase()) {
    case 'running': return '🟢';
    case 'offline': return '🔴';
    case 'starting': return '🟡';
    case 'stopping': return '🟠';
    default: return '⚫';
  }
}
