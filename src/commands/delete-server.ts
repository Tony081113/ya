import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ComponentType,
  Message,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('delete-server')
  .setDescription('刪除您的其中一台伺服器')
  .addStringOption(option =>
    option.setName('server_id')
      .setDescription('伺服器 UUID（選填 - 若未提供將顯示選單）')
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  try {
    await interaction.deferReply();

    // 檢查使用者是否已驗證（已移除管理員要求 - 使用者可刪除自己的伺服器）
    const context = await authService.requireAuth(interaction.user, interaction.member as any);
    
    const serverId = interaction.options.getString('server_id');    if (serverId) {
      // 刪除前驗證所有權
      pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
      
      // 使用 UUID 與 ID 雙重比對來驗證所有權
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
              value: '使用不帶參數的 `/delete-server` 來查看您的可用伺服器。',
              inline: false 
            }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }// 刪除前顯示確認訊息
      await showSlashConfirmation(interaction, server, pterodactylService, authService);
    } else {
      // 顯示伺服器選單（僅限使用者自己的伺服器）
      await showServerSelection(interaction, context, pterodactylService, authService);
    }  } catch (error) {
    Logger.error('delete-server 指令發生錯誤：', error);
    
    let errorMessage = '刪除伺服器時發生錯誤。';
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
      } else if (error.message.includes('not found')) {
        title = '🔍 找不到伺服器';
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
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

async function showServerSelection(
  interaction: ChatInputCommandInteraction,
  context: any,
  pterodactylService: PterodactylService,
  authService: AuthService
) {
  // 設定使用者 API 金鑰
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);

  // 取得使用者的伺服器列表
  const servers = await pterodactylService.getUserServers();

  if (servers.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle('📋 找不到任何伺服器')
      .setDescription('您目前沒有任何可刪除的伺服器。')
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 建立伺服器選單
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_server_delete')
    .setPlaceholder('選擇要刪除的伺服器')
    .addOptions(
      servers.slice(0, 25).map(server => ({
        label: server.name,
        description: `狀態：${server.status} | UUID：${server.uuid.substring(0, 8)}...`,
        value: server.uuid,
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor('Red')
    .setTitle('🗑️ 刪除伺服器')
    .setDescription(`⚠️ **警告：** 此操作將永久刪除所選伺服器！\n\n請選擇要刪除的伺服器：`)
    .addFields(
      servers.slice(0, 10).map(server => ({
        name: server.name,
        value: `**狀態：** ${server.status}\n**UUID：** \`${server.uuid}\``,
        inline: true
      }))
    )
    .setTimestamp();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row]
  });

  // 等待使用者選擇
  try {
    const selectInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id,
      time: 60000
    });    const selectedServerUuid = selectInteraction.values[0];
    
    // 取得所選 UUID 對應的伺服器資訊
    const selectedServer = servers.find(s => s.uuid === selectedServerUuid);
    
    if (!selectedServer) {
      const errorEmbed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 找不到伺服器')
        .setDescription('找不到所選的伺服器。')
        .setTimestamp();

      await selectInteraction.update({ embeds: [errorEmbed], components: [] });
      return;
    }
    
    // 對所選伺服器顯示確認訊息
    await selectInteraction.deferUpdate();
    await showSlashConfirmation(interaction, selectedServer, pterodactylService, authService);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage === 'Collector received no interactions before ending with reason: time') {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ 選擇逾時')
        .setDescription('已因逾時取消刪除伺服器。')
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

async function showSlashConfirmation(
  interaction: ChatInputCommandInteraction,
  server: any,
  pterodactylService: PterodactylService,
  authService: AuthService
) {
  // 帶有按鈕的確認 embed（與前綴指令相同）
  const confirmEmbed = new EmbedBuilder()
    .setColor('Orange')
    .setTitle('⚠️ 確認刪除伺服器')
    .setDescription(`您確定要刪除此伺服器嗎？**此操作無法復原！**`)
    .addFields(
      { name: '🏷️ 伺服器名稱', value: server.name, inline: true },
      { name: '📊 狀態', value: server.status || '未知', inline: true },
      { name: '🔗 UUID', value: server.uuid.substring(0, 8) + '...', inline: true },
      { name: '⚠️ 警告', value: '**所有伺服器資料將永久遺失！**', inline: false }
    )
    .setTimestamp();

  // 為斜線指令建立帶有唯一 ID 的確認按鈕
  const confirmButton = new ButtonBuilder()
    .setCustomId(`slash_confirm_delete_${server.uuid}`)
    .setLabel('✅ 確認刪除')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`slash_cancel_delete_${server.uuid}`)
    .setLabel('❌ 取消')
    .setStyle(ButtonStyle.Secondary);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

  const response = await interaction.editReply({
    embeds: [confirmEmbed],
    components: [buttonRow]
  });

  // 等待按鈕互動
  try {
    const buttonInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: i => i.user.id === interaction.user.id,
      time: 30000
    });

    if (buttonInteraction.customId === `slash_cancel_delete_${server.uuid}`) {
      const cancelEmbed = new EmbedBuilder()
        .setColor('Grey')
        .setTitle('❌ 已取消刪除')
        .setDescription('刪除伺服器操作已取消。')
        .setTimestamp();

      await buttonInteraction.update({ embeds: [cancelEmbed], components: [] });
      return;
    }

    // 執行刪除（確認按鈕已點擊）
    const deletingEmbed = new EmbedBuilder()
      .setColor('Yellow')
      .setTitle('⏳ 正在刪除伺服器...')
      .setDescription(`正在刪除伺服器 **${server.name}**...`)
      .setTimestamp();

    await buttonInteraction.update({ embeds: [deletingEmbed], components: [] });

    // 刪除伺服器
    await pterodactylService.deleteServer(server.uuid);
    
    // 從資料庫移除
    (authService as any).db.removeUserServer(interaction.user.id, server.uuid);

    // 成功 embed
    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 伺服器已成功刪除')
      .setDescription(`伺服器 **${server.name}** 已永久刪除。`)
      .addFields(
        { name: '🗑️ 已刪除的伺服器', value: server.name, inline: true },
        { name: '🔗 UUID', value: server.uuid.substring(0, 8) + '...', inline: true }
      )
      .setTimestamp();

    await buttonInteraction.editReply({ embeds: [successEmbed], components: [] });

    Logger.info(`使用者 ${interaction.user.tag} 已刪除伺服器：${server.name} (${server.uuid})`);

  } catch (interactionError) {
    const errorMessage = interactionError instanceof Error ? interactionError.message : 'Unknown error';
    if (errorMessage.includes('time')) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ 確認逾時')
        .setDescription('已因逾時取消刪除伺服器。')
        .setTimestamp();

      await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    } else {
      throw interactionError;
    }
  }
}

async function handleServerDeletion(
  interaction: any,
  serverId: string,
  pterodactylService: PterodactylService,
  authService: AuthService,
  serverName?: string
) {
  try {
    if (interaction.deferUpdate) {
      await interaction.deferUpdate();
    }

    // 刪除伺服器（使用伺服器 UUID 進行刪除）
    await pterodactylService.deleteServer(serverId);
    
    // 從資料庫移除
    (authService as any).db.removeUserServer(interaction.user.id, serverId);

    const embed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 伺服器已成功刪除')
      .setDescription(`伺服器 **${serverName || serverId}** 已成功刪除。`)
      .addFields(
        { name: '🗑️ 已刪除的伺服器', value: serverName || '未知', inline: true },
        { name: '🔗 UUID', value: serverId.substring(0, 8) + '...', inline: true }
      )
      .setTimestamp();

    if (interaction.editReply) {
      await interaction.editReply({ embeds: [embed], components: [] });
    } else {
      await interaction.reply({ embeds: [embed] });
    }

    Logger.info(`使用者 ${interaction.user.tag} 已刪除伺服器：${serverName || serverId}`);
  } catch (error) {
    Logger.error('刪除伺服器時發生錯誤：', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 刪除失敗')
      .setDescription(`刪除伺服器失敗：${errorMessage}`)
      .setTimestamp();

    if (interaction.editReply) {
      await interaction.editReply({ embeds: [embed], components: [] });
    } else {
      await interaction.reply({ embeds: [embed] });
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
    // 檢查使用者是否已驗證（與斜線指令相同 - 使用者可刪除自己的伺服器）
    const context = await authService.requireAuth(message.author, message.member as any);
    
    if (args.length === 0) {
      // 顯示使用說明
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 用法錯誤')
        .setDescription('您必須提供伺服器 ID 或名稱才能刪除。')
        .addFields(
          { 
            name: '用法', 
            value: '`!delete-server <伺服器ID或名稱>`',
            inline: false 
          },
          { 
            name: '範例', 
            value: '`!delete-server MyServer` 或 `!delete-server 12345678`',
            inline: false 
          },
          {
            name: '⚠️ 警告',
            value: '此操作**不可復原**！請確保您已備份任何重要資料。',
            inline: false          }
        )
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }    const serverIdentifier = args.join(' '); // 若伺服器名稱包含空格則合併

    // 設定使用者 API 金鑰（非管理員）- 與斜線指令相同
    pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);

    // 僅取得使用者自己的伺服器（非全部）
    const servers = await pterodactylService.getUserServers();
    
    // 依 ID、UUID、部分 UUID 或名稱尋找伺服器（與斜線指令邏輯相同）
    const server = servers.find((s: any) => 
      s.uuid === serverIdentifier || 
      s.id?.toString() === serverIdentifier ||
      s.uuid.startsWith(serverIdentifier) || // 部分 UUID 比對
      s.name.toLowerCase() === serverIdentifier.toLowerCase() // 名稱比對
    );    if (!server) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 找不到伺服器')
        .setDescription(`找不到識別碼為 \`${serverIdentifier}\` 的伺服器，或該伺服器不屬於您。`)
        .addFields(
          { 
            name: '💡 提示', 
            value: '使用不帶參數的 `!delete-server` 查看可用伺服器，或使用 `!servers` 列出您所有的伺服器。',
            inline: false 
          }
        )
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }// 帶有按鈕的確認 embed
    const confirmEmbed = new EmbedBuilder()
      .setColor('Orange')
      .setTitle('⚠️ 確認刪除伺服器')
      .setDescription(`您確定要刪除此伺服器嗎？**此操作無法復原！**`)
      .addFields(
        { name: '🏷️ 伺服器名稱', value: server.name, inline: true },
        { name: '📊 狀態', value: server.status || '未知', inline: true },
        { name: '🔗 UUID', value: server.uuid.substring(0, 8) + '...', inline: true },
        { name: '⚠️ 警告', value: '**所有伺服器資料將永久遺失！**', inline: false }
      )
      .setTimestamp();    // 建立帶有唯一 ID 的確認按鈕，避免與全域處理器衝突
    const confirmButton = new ButtonBuilder()
      .setCustomId(`prefix_confirm_delete_${server.uuid}`)
      .setLabel('✅ 確認刪除')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId(`prefix_cancel_delete_${server.uuid}`)
      .setLabel('❌ 取消')
      .setStyle(ButtonStyle.Secondary);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    const confirmMessage = await message.reply({ 
      embeds: [confirmEmbed],
      components: [buttonRow],
      allowedMentions: { repliedUser: false }
    });    // 等待按鈕互動
    try {
      const buttonInteraction = await confirmMessage.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === message.author.id,
        time: 30000
      });

      if (buttonInteraction.customId === `prefix_cancel_delete_${server.uuid}`) {
        const cancelEmbed = new EmbedBuilder()
          .setColor('Grey')
          .setTitle('❌ 已取消刪除')
          .setDescription('刪除伺服器操作已取消。')
          .setTimestamp();

        await buttonInteraction.update({ embeds: [cancelEmbed], components: [] });
        return;
      }

      // 執行刪除（確認按鈕已點擊）
      const deletingEmbed = new EmbedBuilder()
        .setColor('Yellow')
        .setTitle('⏳ 正在刪除伺服器...')
        .setDescription(`正在刪除伺服器 **${server.name}**...`)
        .setTimestamp();

      await buttonInteraction.update({ embeds: [deletingEmbed], components: [] });

      // 刪除伺服器（使用 UUID 進行刪除，與斜線指令相同）
      await pterodactylService.deleteServer(server.uuid);
      
      // 從資料庫移除（與斜線指令相同）
      (authService as any).db.removeUserServer(message.author.id, server.uuid);

      // 成功 embed
      const successEmbed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ 伺服器已成功刪除')
        .setDescription(`伺服器 **${server.name}** 已永久刪除。`)
        .addFields(
          { name: '🗑️ 已刪除的伺服器', value: server.name, inline: true },
          { name: '🔗 UUID', value: server.uuid.substring(0, 8) + '...', inline: true }
        )
        .setTimestamp();

      await buttonInteraction.editReply({ embeds: [successEmbed], components: [] });

      Logger.info(`使用者 ${message.author.tag} 已刪除伺服器：${server.name} (${server.uuid})`);

    } catch (interactionError) {
      const errorMessage = interactionError instanceof Error ? interactionError.message : 'Unknown error';
      if (errorMessage.includes('time')) {
        const timeoutEmbed = new EmbedBuilder()
          .setColor('Orange')
          .setTitle('⏰ 確認逾時')
          .setDescription('已因逾時取消刪除伺服器。')
          .setTimestamp();

        await confirmMessage.edit({ embeds: [timeoutEmbed], components: [] });
      } else {
        throw interactionError;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message?.includes('time')) {
      // 逾時錯誤已在上方處理
      return;
    }

    Logger.error('delete-server 指令（前綴）發生錯誤：', error);
    
    const errorMessage = error instanceof Error ? error.message : '刪除伺服器時發生錯誤。';
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription(errorMessage)      .setTimestamp();

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }    });
  }
}
