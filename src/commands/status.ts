import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  Message
} from 'discord.js';
import { AuthService } from '../services/auth';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('查看您的帳號綁定狀態');

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const boundUser = await authService.getBoundUser(interaction.user.id);
    
    if (boundUser) {
      const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ 帳號狀態')
        .setDescription('您的 Discord 帳號已綁定到 Pterodactyl 帳號。')
        .addFields(
          { name: 'Pterodactyl 使用者 ID', value: boundUser.pterodactyl_user_id.toString(), inline: true },
          { name: '綁定日期', value: new Date(boundUser.bound_at).toLocaleDateString(), inline: true },
          { name: '可用指令', value: '`/servers` - 管理伺服器\n`/create-server` - 建立新伺服器\n`/power` - 控制伺服器電源\n`/monitor` - 監控資源\n`/help` - 顯示所有指令\n`/unbind` - 解除帳號綁定', inline: false }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {      const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⚠️ 帳號狀態')
        .setDescription('您的 Discord 帳號尚未綁定到任何 Pterodactyl 帳號。')
        .addFields(
          { 
            name: '🔗 如何綁定您的帳號', 
            value: '**斜線指令（推薦）：**\n`/bind method:"API Key Only" api_key:your_key_here`\n\n**前綴指令：**\n`!bind your_api_key_here`\n\n只需提供您的 API 金鑰，不需要使用者 ID！', 
            inline: false 
          },
          {
            name: '🔑 取得您的 API 金鑰',
            value: '1. 前往您的 Pterodactyl 面板\n2. 帳號 → API 憑證\n3. 建立新的 API 金鑰\n4. 複製並在 bind 指令中使用',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }

  } catch (error) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription('查看狀態時發生錯誤。')
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
  authService: AuthService
) {
  try {
    const boundUser = await authService.getBoundUser(message.author.id);
    
    if (boundUser) {
      const embed = new EmbedBuilder()
        .setColor('Green')
        .setTitle('✅ 帳號狀態')
        .setDescription('您的 Discord 帳號已綁定到 Pterodactyl 帳號。')
        .addFields(
          { name: 'Pterodactyl 使用者 ID', value: boundUser.pterodactyl_user_id.toString(), inline: true },
          { name: '綁定日期', value: new Date(boundUser.bound_at).toLocaleDateString(), inline: true },
          { name: '可用指令', value: '`/servers` 或 `!servers` - 管理伺服器\n`/create-server` - 建立新伺服器\n`/power` - 控制伺服器電源\n`/monitor` - 監控資源\n`/help` 或 `!help` - 顯示所有指令\n`/unbind` 或 `!unbind` - 解除帳號綁定', inline: false }
        )        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
    } else {const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⚠️ 帳號狀態')
        .setDescription('您的 Discord 帳號尚未綁定到任何 Pterodactyl 帳號。')
        .addFields(
          { 
            name: '🔗 如何綁定您的帳號', 
            value: '**斜線指令（推薦）：**\n`/bind method:"API Key Only" api_key:your_key_here`\n\n**前綴指令：**\n`!bind your_api_key_here`\n\n只需提供您的 API 金鑰，不需要使用者 ID！', 
            inline: false 
          },
          {
            name: '🔑 取得您的 API 金鑰',
            value: '1. 前往您的 Pterodactyl 面板\n2. 帳號 → API 憑證\n3. 建立新的 API 金鑰\n4. 複製並在 bind 指令中使用',
            inline: false          }
        )
        .setTimestamp();

      await message.reply({ 
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });
    }

  } catch (error) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription('查看狀態時發生錯誤。')
      .setTimestamp();

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  }
}
