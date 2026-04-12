import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('servers')
  .setDescription('查看你的伺服器');

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  try {
    await interaction.deferReply();

    // 檢查使用者是否已驗證
    const context = await authService.requireAuth(interaction.user, interaction.member as any);
    
    // 設定使用者 API 金鑰
    pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);    // 取得使用者伺服器列表
    const servers = await pterodactylService.getUserServers();

    if (servers.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('📋 你的伺服器')
        .setDescription('你目前沒有任何伺服器。使用 `/create-server` 來建立一個！')
        .addFields(
          { name: '開始使用', value: '使用 `/create-server` 來建立一台具有自訂規格的新伺服器。', inline: false }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }    // 以分頁方式顯示伺服器列表
    await showServersWithPagination(interaction, servers, 0);
  } catch (error) {
    Logger.error('servers 指令發生錯誤：', error);
    
    let errorMessage = '擷取伺服器時發生錯誤。';
    let title = '❌ 錯誤';
    
    // 針對特定錯誤類型顯示更友善的訊息
    if (error instanceof Error) {
      if (error.message.includes('bind your account first')) {
        title = '🔗 帳號尚未綁定';
        errorMessage = '你需要先將 Discord 帳號綁定到 Pterodactyl 帳號！\n\n請使用 `/bind <your_api_key>` 開始綁定。';
      } else if (error.message.includes('Invalid API key')) {
        title = '🔑 無效的 API 金鑰';
        errorMessage = '你的 API 金鑰似乎無效或已過期。請使用 `/bind` 重新綁定新的 API 金鑰。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title = '🔌 連線錯誤';
        errorMessage = '無法連線至 Pterodactyl 面板，請稍後再試。';
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

export async function executePrefix(
  message: Message,
  args: string[],
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  try {
    // 檢查使用者是否已驗證
    const context = await authService.requireAuth(message.author, message.member as any);
    
    // 設定使用者 API 金鑰
    pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);    // 取得使用者伺服器列表
    const servers = await pterodactylService.getUserServers();

    if (servers.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('📋 你的伺服器')
        .setDescription('你目前沒有任何伺服器。使用 `!create-server` 來建立一個！')
        .addFields(
          { name: '開始使用', value: '使用 `!create-server` 來建立一台具有自訂規格的新伺服器。', inline: false }
        )
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }    // 以分頁方式顯示伺服器列表
    await showServersWithPagination(message, servers, 0);
  } catch (error) {
    Logger.error('servers 指令發生錯誤（前綴模式）：', error);
    
    let errorMessage = '擷取伺服器時發生錯誤。';
    let title = '❌ 錯誤';
    
    // 針對特定錯誤類型顯示更友善的訊息
    if (error instanceof Error) {
      if (error.message.includes('bind your account first')) {
        title = '🔗 帳號尚未綁定';
        errorMessage = '你需要先將 Discord 帳號綁定到 Pterodactyl 帳號！\n\n請使用 `!bind <your_api_key>` 開始綁定。';
      } else if (error.message.includes('Invalid API key')) {
        title = '🔑 無效的 API 金鑰';
        errorMessage = '你的 API 金鑰似乎無效或已過期。請使用 `!bind` 重新綁定新的 API 金鑰。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title = '🔌 連線錯誤';
        errorMessage = '無法連線至 Pterodactyl 面板，請稍後再試。';
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

async function showServersWithPagination(interactionOrMessage: any, servers: any[], page: number) {
  const serversPerPage = 5;
  const totalPages = Math.ceil(servers.length / serversPerPage);
  const startIndex = page * serversPerPage;
  const endIndex = startIndex + serversPerPage;
  const currentServers = servers.slice(startIndex, endIndex);

  // 建立伺服器列表的 embed（非格狀排列）
  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('🎮 你的伺服器')
    .setDescription(`**伺服器總數：** ${servers.length} | **第 ${page + 1} 頁，共 ${totalPages} 頁**\n\n${      currentServers.map((server: any, index: number) => {
        const statusEmoji = getStatusEmoji(server.status);
        return `**${startIndex + index + 1}.** ${statusEmoji} **${server.name}**\n` +
               `└ **狀態：** ${server.status || '未知'}\n` +
               `└ **資源：** ${formatServerResources(server.limits)}\n` +
               `└ **UUID：** \`${server.uuid?.substring(0, 8) || 'N/A'}...\`\n`;
      }).join('\n')
    }`)
    .setTimestamp()
    .setFooter({ text: `顯示 ${currentServers.length} / ${servers.length} 台伺服器` });
  // 建立分頁導覽按鈕
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (totalPages > 1) {
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`servers_prev_${page}`)
          .setLabel('◀ 上一頁')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(`servers_page_${page}`)
          .setLabel(`第 ${page + 1} / ${totalPages} 頁`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`servers_next_${page}`)
          .setLabel('下一頁 ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages - 1)
      );
    components.push(row);
  }
  let response;
  if (interactionOrMessage.editReply) {
    response = await interactionOrMessage.editReply({ embeds: [embed], components });  } else if (interactionOrMessage.reply) {
    response = await interactionOrMessage.reply({ 
      embeds: [embed], 
      components,
      allowedMentions: { repliedUser: false }
    });
  } else {
    return; // 無效的 interaction / message 類型
  }

  // 處理分頁按鈕
  if (totalPages > 1) {
    try {
      const targetResponse = response || (interactionOrMessage.fetchReply ? await interactionOrMessage.fetchReply() : null);
      if (!targetResponse) return;

      const collector = targetResponse.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i: any) => i.user.id === (interactionOrMessage.user?.id || interactionOrMessage.author?.id) && i.customId.startsWith('servers_'),
        time: 300000 // 5 分鐘
      });      collector.on('collect', async (buttonInteraction: any) => {
        const [, action, currentPage] = buttonInteraction.customId.split('_');
        let newPage = parseInt(currentPage);

        if (action === 'prev' && newPage > 0) {
          newPage--;
        } else if (action === 'next' && newPage < totalPages - 1) {
          newPage++;
        }        await buttonInteraction.deferUpdate();
        
        // 為更新後的頁面建立新的 embed 和元件（與初始顯示格式相同）
        const startIndex = newPage * serversPerPage;
        const endIndex = Math.min(startIndex + serversPerPage, servers.length);
        const pageServers = servers.slice(startIndex, endIndex);

        const newEmbed = new EmbedBuilder()
          .setColor('Blue')
          .setTitle('🎮 你的伺服器')
          .setDescription(`**伺服器總數：** ${servers.length} | **第 ${newPage + 1} 頁，共 ${totalPages} 頁**\n\n${            pageServers.map((server: any, index: number) => {
              const statusEmoji = getStatusEmoji(server.status);
              return `**${startIndex + index + 1}.** ${statusEmoji} **${server.name}**\n` +
                     `└ **狀態：** ${server.status || '未知'}\n` +
                     `└ **資源：** ${formatServerResources(server.limits)}\n` +
                     `└ **UUID：** \`${server.uuid?.substring(0, 8) || 'N/A'}...\`\n`;
            }).join('\n')
          }`)
          .setTimestamp()
          .setFooter({ text: `顯示 ${pageServers.length} / ${servers.length} 台伺服器` });

        const newComponents = [];
        if (totalPages > 1) {
          const newRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`servers_prev_${newPage}`)
                .setLabel('◀ 上一頁')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(newPage === 0),
              new ButtonBuilder()
                .setCustomId(`servers_page_${newPage}`)
                .setLabel(`第 ${newPage + 1} / ${totalPages} 頁`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true),
              new ButtonBuilder()
                .setCustomId(`servers_next_${newPage}`)
                .setLabel('下一頁 ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(newPage === totalPages - 1)
            );
          newComponents.push(newRow);
        }

        await buttonInteraction.editReply({ embeds: [newEmbed], components: newComponents });
      });

      collector.on('end', async () => {
        // 收集器結束時停用所有按鈕
        if (components.length > 0) {
          const disabledRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              components[0].components.map((button: any) => 
                ButtonBuilder.from(button).setDisabled(true)
              )
            );
          
          try {
            if (interactionOrMessage.editReply) {
              await interactionOrMessage.editReply({ components: [disabledRow] });
            }
          } catch (error) {
            // 忽略編輯已過期 interaction 時的錯誤
          }
        }
      });
    } catch (error) {
      // 忽略 interaction 處理相關錯誤
    }
  }
}

function getStatusEmoji(status: string): string {
  switch (status?.toLowerCase()) {
    case 'running':
      return '🟢';
    case 'starting':
      return '🟡';
    case 'stopping':
      return '🟠';
    case 'stopped':
      return '🔴';
    case 'offline':
      return '⚫';
    default:
      return '⚪';
  }
}

function formatServerResources(limits: any): string {
  if (!limits) {
    return '∞ RAM • ∞ Disk • ∞ CPU';
  }

  // 格式化記憶體
  let memoryDisplay = '∞';
  if (limits.memory && limits.memory > 0) {
    if (limits.memory < 1024) {
      memoryDisplay = `${limits.memory}MiB`;
    } else {
      const memoryGB = (limits.memory / 1024).toFixed(1);
      memoryDisplay = `${memoryGB}GiB`;
    }
  }

  // 格式化磁碟
  let diskDisplay = '∞';
  if (limits.disk && limits.disk > 0) {
    if (limits.disk < 1024) {
      diskDisplay = `${limits.disk}MiB`;
    } else {
      const diskGB = (limits.disk / 1024).toFixed(1);
      diskDisplay = `${diskGB}GiB`;
    }
  }

  // 格式化 CPU
  let cpuDisplay = '∞';
  if (limits.cpu && limits.cpu > 0) {
    cpuDisplay = `${limits.cpu}%`;
  }

  return `${memoryDisplay} RAM • ${diskDisplay} Disk • ${cpuDisplay} CPU`;
}