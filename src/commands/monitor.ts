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

export const data = new SlashCommandBuilder()
  .setName('monitor')
  .setDescription('查看您伺服器的當前資源使用狀況')
  .addStringOption(option =>
    option.setName('server_id')
      .setDescription('伺服器 UUID 或名稱（選填 - 若未提供將顯示選擇選單）')
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
    
    const serverId = interaction.options.getString('server_id');

    if (serverId) {
      // 直接資源監控
      await showServerResources(interaction, serverId, context, pterodactylService);
    } else {
      // 顯示伺服器選擇
      await showServerSelection(interaction, context, pterodactylService);
    }

  } catch (error) {
    Logger.error('monitor 指令發生錯誤：', error);
    
    let errorMessage = '監控伺服器資源時發生錯誤。';
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

async function showServerResources(
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
          value: '請不帶參數使用 `/monitor` 來查看您的可用伺服器。',
          inline: false 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 顯示載入訊息
  const loadingEmbed = new EmbedBuilder()
    .setColor('Yellow')
    .setTitle('📊 載入資源資料中...')
    .setDescription(`正在取得伺服器 **${server.name}** 的資源使用狀況...`)
    .setTimestamp();
  await interaction.editReply({ embeds: [loadingEmbed] });

  try {    // 取得伺服器詳情與資源使用狀況
    const [serverDetails, resourceUsage] = await Promise.all([
      pterodactylService.getServerDetails(server.uuid),
      pterodactylService.getServerResourceUsage(server.uuid)
    ]);
    
    // 從巢狀結構中提取資源
    const resources = resourceUsage.resources || {};
    // 從資源使用狀況取得狀態（比伺服器詳情更準確）
    const serverStatus = resourceUsage.current_state || serverDetails.status || 'unknown';

    // 格式化資源資料
    const resourceEmbed = new EmbedBuilder()
      .setColor(getResourceColor(resources))
      .setTitle('📊 伺服器資源監控')
      .setDescription(`**${server.name}** 的當前資源使用狀況（執行時擷取）`)
      .addFields(
        { 
          name: '🏷️ 伺服器資訊', 
          value: `**名稱：** ${server.name}\n**狀態：** ${getStatusEmoji(serverStatus)} ${serverStatus}\n**UUID：** \`${server.uuid.substring(0, 8)}...\``,
          inline: false 
        },
        { 
          name: '💾 記憶體使用量', 
          value: formatMemoryUsage(resources.memory_bytes, server.limits?.memory),
          inline: true 
        },
        { 
          name: '⚡ CPU 使用量', 
          value: formatCpuUsage(resources.cpu_absolute, server.limits?.cpu),
          inline: true 
        },
        { 
          name: '💽 磁碟使用量', 
          value: formatDiskUsage(resources.disk_bytes, server.limits?.disk),
          inline: true 
        },
        { 
          name: '🌐 網路 I/O', 
          value: `**↗️ TX:** ${formatBytes(resources.network_tx_bytes)}\n**↙️ RX:** ${formatBytes(resources.network_rx_bytes)}`,
          inline: true 
        },
        { 
          name: '💿 磁碟 I/O', 
          value: `**📤 寫入：** ${formatBytes(resources.disk_io_write_bytes || 0)}\n**📥 讀取：** ${formatBytes(resources.disk_io_read_bytes || 0)}`,
          inline: true 
        },
        { 
          name: '🔄 運行時間', 
          value: formatUptime(resources.uptime),
          inline: true 
        }
      )
      .setTimestamp()
      .setFooter({ text: '資料已更新' });

    await interaction.editReply({ embeds: [resourceEmbed] });

    Logger.info(`使用者 ${interaction.user.tag} 監控了伺服器資源：${server.name} (${server.uuid})`);

  } catch (error) {
    Logger.error('取得伺服器資源時發生錯誤：', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 資源監控失敗')
      .setDescription(`無法取得伺服器 **${server.name}** 的資源資料。`)
      .addFields(
        { 
          name: '🔍 錯誤詳情', 
          value: error instanceof Error ? error.message : '發生未知錯誤',
          inline: false 
        },
        {
          name: '💡 可能原因',
          value: '• 伺服器已離線\n• 資源監控不可用\n• API 連線問題',
          inline: false
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
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
      .setDescription('您沒有任何可監控的伺服器。')
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 為伺服器建立選擇選單
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_server_monitor')
    .setPlaceholder('選擇要監控的伺服器')
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
    .setTitle('📊 伺服器資源監控')
    .setDescription('選擇伺服器以查看其資源使用狀況：')
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
    await showServerResources(interaction, selectedServerUuid, context, pterodactylService);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('time')) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ 選擇逾時')
        .setDescription('伺服器監控選擇因逾時已取消。')
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
    
    if (args.length === 0) {      // 顯示用法資訊
      const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('📊 伺服器資源監控')
        .setDescription('監控您伺服器的當前資源使用狀況（於指令執行時擷取）。')
        .addFields(
          { 
            name: '用法', 
            value: '`!monitor <server_id>`\nor\n`!monitor` (to select server)',
            inline: false 
          },
          { 
            name: '監控資源', 
            value: '• 💾 記憶體（RAM）使用量\n• ⚡ CPU 使用量\n• 💽 磁碟使用量\n• 🌐 網路 I/O\n• 💿 磁碟 I/O\n• 🔄 伺服器運行時間',
            inline: false 
          },
          { 
            name: '範例', 
            value: '`!monitor MyServer`\n`!monitor 7500bf8a`\n`!monitor` (shows server list)',
            inline: false 
          },
          {
            name: '💡 注意',
            value: '顯示執行時的當前使用狀況，並非即時更新資料。',
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

    // 已提供伺服器 ID
    const serverId = args.join(' '); // 合併以防伺服器名稱含空格
    await executePrefixMonitoring(message, serverId, context, pterodactylService);

  } catch (error) {
    Logger.error('monitor 指令發生錯誤（前綴）：', error);
    
    const errorMessage = error instanceof Error ? error.message : '監控伺服器資源時發生錯誤。';
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

async function executePrefixMonitoring(
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
          value: '請不帶參數使用 `!monitor` 查看用法說明，或使用 `!servers` 列出所有伺服器。',
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

  // 顯示載入訊息
  const loadingEmbed = new EmbedBuilder()
    .setColor('Yellow')
    .setTitle('📊 載入資源資料中...')
    .setDescription(`正在取得伺服器 **${server.name}** 的資源使用狀況...`)
    .setTimestamp();

  const loadingMessage = await message.reply({ 
    embeds: [loadingEmbed],
    allowedMentions: { repliedUser: false }
  });
  try {    // 取得伺服器詳情與資源使用狀況
    const [serverDetails, resourceUsage] = await Promise.all([
      pterodactylService.getServerDetails(server.uuid),
      pterodactylService.getServerResourceUsage(server.uuid)
    ]);

    // 從巢狀結構中提取資源
    const resources = resourceUsage.resources || {};
    // 從資源使用狀況取得狀態（比伺服器詳情更準確）
    const serverStatus = resourceUsage.current_state || serverDetails.status || 'unknown';

    // 格式化資源資料
    const resourceEmbed = new EmbedBuilder()
      .setColor(getResourceColor(resources))
      .setTitle('📊 伺服器資源監控')
      .setDescription(`**${server.name}** 的當前資源使用狀況（執行時擷取）`)
      .addFields(
        { 
          name: '🏷️ 伺服器資訊', 
          value: `**名稱：** ${server.name}\n**狀態：** ${getStatusEmoji(serverStatus)} ${serverStatus}\n**UUID：** \`${server.uuid.substring(0, 8)}...\``,
          inline: false 
        },
        { 
          name: '💾 記憶體使用量', 
          value: formatMemoryUsage(resources.memory_bytes, server.limits?.memory),
          inline: true 
        },
        { 
          name: '⚡ CPU 使用量', 
          value: formatCpuUsage(resources.cpu_absolute, server.limits?.cpu),
          inline: true 
        },
        { 
          name: '💽 磁碟使用量', 
          value: formatDiskUsage(resources.disk_bytes, server.limits?.disk),
          inline: true 
        },
        { 
          name: '🌐 網路 I/O', 
          value: `**↗️ TX:** ${formatBytes(resources.network_tx_bytes)}\n**↙️ RX:** ${formatBytes(resources.network_rx_bytes)}`,
          inline: true 
        },
        { 
          name: '💿 磁碟 I/O', 
          value: `**📤 寫入：** ${formatBytes(resources.disk_io_write_bytes || 0)}\n**📥 讀取：** ${formatBytes(resources.disk_io_read_bytes || 0)}`,
          inline: true 
        },
        { 
          name: '🔄 運行時間', 
          value: formatUptime(resources.uptime),
          inline: true 
        }
      )
      .setTimestamp()
      .setFooter({ text: '資料已更新' });

    await loadingMessage.edit({ embeds: [resourceEmbed] });

    Logger.info(`使用者 ${message.author.tag} 監控了伺服器資源：${server.name} (${server.uuid})`);

  } catch (error) {
    Logger.error('取得伺服器資源時發生錯誤：', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 資源監控失敗')
      .setDescription(`無法取得伺服器 **${server.name}** 的資源資料。`)
      .addFields(
        { 
          name: '🔍 錯誤詳情', 
          value: error instanceof Error ? error.message : '發生未知錯誤',
          inline: false 
        },
        {
          name: '💡 可能原因',
          value: '• 伺服器已離線\n• 資源監控不可用\n• API 連線問題',
          inline: false
        }
      )
      .setTimestamp();

    await loadingMessage.edit({ embeds: [errorEmbed] });
  }
}

// 工具函式
function formatMemoryUsage(usedBytes: number, limitMB?: number): string {
  if (!usedBytes && usedBytes !== 0) {
    return '無資料';
  }
  
  const usedMB = Math.round(usedBytes / 1024 / 1024);
  
  // 根據大小使用適當單位
  let usedDisplay: string;
  if (usedMB < 1024) {
    usedDisplay = `${usedMB}MiB`;
  } else {
    const usedGB = (usedBytes / 1024 / 1024 / 1024).toFixed(1);
    usedDisplay = `${usedGB}GiB`;
  }
  
  if (!limitMB || limitMB === 0) {
    return `${usedDisplay} / 無限制\n\`∞ 無限制\``;
  }
  
  const percentage = Math.round((usedMB / limitMB) * 100);
  
  // 以適當單位格式化上限
  let limitDisplay: string;
  if (limitMB < 1024) {
    limitDisplay = `${limitMB}MiB`;
  } else {
    const limitGB = (limitMB / 1024).toFixed(1);
    limitDisplay = `${limitGB}GiB`;
  }
  
  return `${usedDisplay} / ${limitDisplay}\n\`已使用 ${percentage}%\` ${getUsageBar(percentage)}`;
}

function formatCpuUsage(cpuUsage: number, limitPercent?: number): string {
  if (!cpuUsage && cpuUsage !== 0) {
    return '無資料';
  }
  
  const currentPercent = Math.round(cpuUsage);
  
  if (!limitPercent || limitPercent === 0) {
    return `${currentPercent}% / 無限制\n\`∞ 無限制\``;
  }
  
  const usagePercent = Math.round((cpuUsage / limitPercent) * 100);
  
  return `${currentPercent}% / ${limitPercent}%\n\`佔上限 ${usagePercent}%\` ${getUsageBar(usagePercent)}`;
}

function formatDiskUsage(usedBytes: number, limitMB?: number): string {
  if (!usedBytes && usedBytes !== 0) {
    return '無資料';
  }
  
  const usedMB = Math.round(usedBytes / 1024 / 1024);
  
  // 根據大小使用適當單位
  let usedDisplay: string;
  if (usedMB < 1024) {
    usedDisplay = `${usedMB}MiB`;
  } else {
    const usedGB = (usedBytes / 1024 / 1024 / 1024).toFixed(1);
    usedDisplay = `${usedGB}GiB`;
  }
  
  if (!limitMB || limitMB === 0) {
    return `${usedDisplay} / 無限制\n\`∞ 無限制\``;
  }
  
  const percentage = Math.round((usedMB / limitMB) * 100);
  
  // 以適當單位格式化上限
  let limitDisplay: string;
  if (limitMB < 1024) {
    limitDisplay = `${limitMB}MiB`;
  } else {
    const limitGB = (limitMB / 1024).toFixed(1);
    limitDisplay = `${limitGB}GiB`;
  }
  
  return `${usedDisplay} / ${limitDisplay}\n\`已使用 ${percentage}%\` ${getUsageBar(percentage)}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
  
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))}${sizes[i]}`;
}

function formatUptime(milliseconds: number): string {
  if (milliseconds === 0) return '離線';
  
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function getUsageBar(percentage: number): string {
  const filled = Math.round(percentage / 10);
  const empty = 10 - filled;
  
  let bar = '';
  for (let i = 0; i < filled; i++) {
    bar += '█';
  }
  for (let i = 0; i < empty; i++) {
    bar += '░';
  }
  
  return bar;
}

function getResourceColor(resources: any): number {
  // 若無法判斷使用量等級，預設為藍色
  let maxUsage = 0;
  
  // 若有可用的記憶體使用量則檢查
  if (resources.memory_bytes && resources.memory_limit) {
    maxUsage = Math.max(maxUsage, (resources.memory_bytes / resources.memory_limit) * 100);
  }
  
  // 若有可用的 CPU 使用量則檢查
  if (resources.cpu_absolute) {
    maxUsage = Math.max(maxUsage, resources.cpu_absolute);
  }
  
  // 根據最高使用量回傳顏色
  if (maxUsage >= 90) return 0xFF0000; // 紅色 - 危急
  if (maxUsage >= 75) return 0xFFA500; // 橘色 - 高
  if (maxUsage >= 50) return 0xFFFF00; // 黃色 - 中等
  return 0x00FF00; // 綠色 - 低/良好
}

function getStatusEmoji(status: string): string {
  if (!status) {
    return '❓'; // 未知狀態
  }
  
  switch (status.toLowerCase()) {
    case 'running': return '🟢';
    case 'offline': return '🔴';
    case 'starting': return '🟡';
    case 'stopping': return '🟠';
    case 'stopped': return '🔴';
    case 'unknown': return '❓';
    default: return '⚫';
  }
}
