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
import { Logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('unbind')
  .setDescription('解除您的 Discord 帳號與 Pterodactyl 帳號的綁定');

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    // 檢查使用者是否已綁定
    const isbound = await authService.isUserBound(interaction.user.id);
    
    if (!isbound) {
      const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⚠️ 帳號未綁定')
        .setDescription('您的 Discord 帳號目前未綁定到任何 Pterodactyl 帳號。')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 取得目前使用者資訊以供確認
    const currentUser = await authService.getBoundUser(interaction.user.id);

    // 確認提示
    const confirmEmbed = new EmbedBuilder()
      .setColor('Orange')
      .setTitle('⚠️ 確認解除帳號綁定')
      .setDescription('您確定要解除 Discord 帳號與 Pterodactyl 帳號的綁定嗎？')
      .addFields(
        { 
          name: '📋 目前綁定資訊', 
          value: `**使用者 ID：** ${currentUser?.pterodactyl_user_id}\n**API 金鑰：** \`${currentUser?.pterodactyl_api_key.substring(0, 8)}...\``, 
          inline: false 
        },
        { 
          name: '⚠️ 解除綁定後的影響：', 
          value: '• 您將失去所有伺服器管理指令的存取權\n• 您需要再次使用 `/bind` 才能重新取得存取權\n• 您的伺服器將保留在面板上',
          inline: false 
        }
      )
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId('unbind_confirm')
      .setLabel('✅ 是的，解除綁定')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('unbind_cancel')
      .setLabel('❌ 取消')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, cancelButton);

    const response = await interaction.editReply({ 
      embeds: [confirmEmbed], 
      components: [row] 
    });

    // 等待按鈕互動
    try {
      const buttonInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: 60000
      });

      if (buttonInteraction.customId === 'unbind_cancel') {
        const cancelEmbed = new EmbedBuilder()
          .setColor('Grey')
          .setTitle('❌ 已取消解除綁定')
          .setDescription('已取消解除帳號綁定，您的帳號仍保持綁定狀態。')
          .setTimestamp();

        await buttonInteraction.update({ embeds: [cancelEmbed], components: [] });
        return;
      }

      if (buttonInteraction.customId === 'unbind_confirm') {
        // 執行解除綁定
        await authService.unbindUser(interaction.user.id);

        const successEmbed = new EmbedBuilder()
          .setColor('Green')
          .setTitle('✅ 帳號解除綁定成功')
          .setDescription('您的 Discord 帳號已成功解除與 Pterodactyl 帳號的綁定。')
          .addFields(
            { 
              name: '接下來呢？', 
              value: '您需要再次使用 `/bind` 才能存取伺服器管理功能。',
              inline: false 
            }
          )
          .setTimestamp();

        await buttonInteraction.update({ embeds: [successEmbed], components: [] });
        Logger.info(`使用者 ${interaction.user.tag} 已解除帳號綁定`);
      }

    } catch (error) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ 確認逾時')
        .setDescription('由於逾時，已取消解除帳號綁定。')
        .setTimestamp();

      await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    }

  } catch (error) {
    Logger.error('unbind 指令發生錯誤：', error);
    
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription('解除帳號綁定時發生錯誤，請稍後再試。')
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
  authService: AuthService
) {
  try {
    // 檢查使用者是否已綁定
    const isbound = await authService.isUserBound(message.author.id);
    
    if (!isbound) {
      const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⚠️ 帳號未綁定')
        .setDescription('您的 Discord 帳號目前未綁定到任何 Pterodactyl 帳號。')
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    // 取得目前使用者資訊以供確認
    const currentUser = await authService.getBoundUser(message.author.id);

    // 確認提示
    const confirmEmbed = new EmbedBuilder()
      .setColor('Orange')
      .setTitle('⚠️ 確認解除帳號綁定')
      .setDescription('您確定要解除 Discord 帳號與 Pterodactyl 帳號的綁定嗎？')
      .addFields(
        { 
          name: '📋 目前綁定資訊', 
          value: `**使用者 ID：** ${currentUser?.pterodactyl_user_id}\n**API 金鑰：** \`${currentUser?.pterodactyl_api_key.substring(0, 8)}...\``, 
          inline: false 
        },
        { 
          name: '⚠️ 解除綁定後的影響：', 
          value: '• 您將失去所有伺服器管理指令的存取權\n• 您需要再次使用 `!bind` 才能重新取得存取權\n• 您的伺服器將保留在面板上',
          inline: false 
        }
      )
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId('unbind_confirm_prefix')
      .setLabel('✅ 是的，解除綁定')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('unbind_cancel_prefix')
      .setLabel('❌ 取消')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, cancelButton);

    const confirmMessage = await message.reply({ 
      embeds: [confirmEmbed],
      components: [row],
      allowedMentions: { repliedUser: false }
    });

    // 等待按鈕互動
    try {
      const buttonInteraction = await confirmMessage.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === message.author.id,
        time: 60000
      });

      if (buttonInteraction.customId === 'unbind_cancel_prefix') {
        const cancelEmbed = new EmbedBuilder()
          .setColor('Grey')
          .setTitle('❌ 已取消解除綁定')
          .setDescription('已取消解除帳號綁定，您的帳號仍保持綁定狀態。')
          .setTimestamp();

        await buttonInteraction.update({ embeds: [cancelEmbed], components: [] });
        return;
      }

      if (buttonInteraction.customId === 'unbind_confirm_prefix') {
        // 執行解除綁定
        await authService.unbindUser(message.author.id);

        const successEmbed = new EmbedBuilder()
          .setColor('Green')
          .setTitle('✅ 帳號解除綁定成功')
          .setDescription('您的 Discord 帳號已成功解除與 Pterodactyl 帳號的綁定。')
          .addFields(
            { 
              name: '接下來呢？', 
              value: '您需要再次使用 `!bind` 才能存取伺服器管理功能。',
              inline: false 
            }
          )
          .setTimestamp();

        await buttonInteraction.update({ embeds: [successEmbed], components: [] });
        Logger.info(`使用者 ${message.author.tag} 已解除帳號綁定`);
      }

    } catch (error) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ 確認逾時')
        .setDescription('由於逾時，已取消解除帳號綁定。')
        .setTimestamp();

      await confirmMessage.edit({ embeds: [timeoutEmbed], components: [] });
    }

  } catch (error) {
    Logger.error('unbind 指令（前綴）發生錯誤：', error);
    
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription('解除帳號綁定時發生錯誤，請稍後再試。')
      .setTimestamp();

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  }
}
