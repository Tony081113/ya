import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,  ModalActionRowComponentBuilder,
  Message
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('bind')
  .setDescription('將您的 Discord 帳號綁定到您的 Pterodactyl 帳號')
  .addStringOption(option =>
    option.setName('method')
      .setDescription('綁定方式')
      .setRequired(true)
      .addChoices(
        { name: 'API 金鑰（推薦）', value: 'api_key' },
        { name: '電子郵件 + API 金鑰', value: 'email_api' },
        { name: '使用者名稱 + API 金鑰', value: 'username_api' }
      )
  )
  .addStringOption(option =>
    option.setName('api_key')
      .setDescription('您的 Pterodactyl 客戶端 API 金鑰')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('identifier')
      .setDescription('您的電子郵件或使用者名稱（僅在使用電子郵件/使用者名稱方式時需要）')
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  try {
    await interaction.deferReply({ ephemeral: true });

    // 檢查使用者是否已綁定
    const isAlreadyBound = await authService.isUserBound(interaction.user.id);
    if (isAlreadyBound) {
      const currentUser = await authService.getBoundUser(interaction.user.id);
      const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⚠️ 帳號已綁定')
        .setDescription('您的 Discord 帳號已綁定到 Pterodactyl 帳號！')
        .addFields(
          { 
            name: '📋 目前綁定資訊', 
            value: `**使用者 ID：** ${currentUser?.pterodactyl_user_id}\n**API 金鑰：** \`${currentUser?.pterodactyl_api_key.substring(0, 8)}...\``, 
            inline: false 
          },
          {
            name: '🔄 綁定其他帳號',
            value: '您必須先使用 `/unbind` 解除目前帳號的綁定，再使用 `/bind` 以新的憑證重新綁定。',
            inline: false
          },
          {
            name: '📊 查看目前狀態',
            value: '使用 `/status` 查看您目前的綁定資訊。',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const method = interaction.options.getString('method', true);
    const apiKey = interaction.options.getString('api_key', true);
    const identifier = interaction.options.getString('identifier');

    // 驗證 API 金鑰是否有效並取得使用者資訊
    pterodactylService.setUserApiKey(apiKey);
    
    let userInfo;
    try {
      // 嘗試從客戶端 API 取得使用者資訊
      userInfo = await pterodactylService.getClientUserInfo();
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 無效的 API 金鑰')
        .setDescription('提供的 API 金鑰無效或已過期，請檢查您的 API 金鑰後再試一次。')
        .addFields(
          { 
            name: '如何取得您的 API 金鑰：', 
            value: '1. 前往您的 Pterodactyl 面板\n2. 點擊您的帳號（右上角）\n3. 前往「API 憑證」\n4. 建立新的 API 金鑰\n5. 複製金鑰並在此使用',
            inline: false 
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    let pterodactylUserId: number;

    switch (method) {
      case 'api_key':
        // 使用 API 金鑰取得的使用者資訊（最可靠的方法）
        pterodactylUserId = userInfo.id;
        break;

      case 'email_api':
        if (!identifier) {
          const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ 缺少電子郵件')
            .setDescription('使用電子郵件 + API 金鑰方式時，必須提供電子郵件。')
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        // 驗證電子郵件是否與 API 金鑰擁有者相符
        if (userInfo.email.toLowerCase() !== identifier.toLowerCase()) {
          const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ 電子郵件不符')
            .setDescription('提供的電子郵件與 API 金鑰擁有者不符。')
            .addFields(
              { name: '預期電子郵件', value: userInfo.email, inline: true },
              { name: '提供的電子郵件', value: identifier, inline: true }
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }
        pterodactylUserId = userInfo.id;
        break;

      case 'username_api':
        if (!identifier) {
          const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ 缺少使用者名稱')
            .setDescription('使用使用者名稱 + API 金鑰方式時，必須提供使用者名稱。')
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        // 驗證使用者名稱是否與 API 金鑰擁有者相符
        if (userInfo.username.toLowerCase() !== identifier.toLowerCase()) {
          const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ 使用者名稱不符')
            .setDescription('提供的使用者名稱與 API 金鑰擁有者不符。')
            .addFields(
              { name: '預期使用者名稱', value: userInfo.username, inline: true },
              { name: '提供的使用者名稱', value: identifier, inline: true }
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }        pterodactylUserId = userInfo.id;
        break;

      default:
        throw new Error('無效的綁定方式');
    }

    // 檢查此 Pterodactyl 帳號是否已綁定到其他 Discord 帳號
    const pterodactylBinding = await authService.isPterodactylUserBound(pterodactylUserId);
    if (pterodactylBinding.isBound) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ Pterodactyl 帳號已被綁定')
        .setDescription('此 Pterodactyl 帳號已被綁定到其他 Discord 帳號！')
        .addFields(
          { 
            name: '🔗 目前綁定資訊', 
            value: `**Pterodactyl 使用者 ID：** ${pterodactylUserId}\n**已綁定的 Discord ID：** \`${pterodactylBinding.discordId}\``, 
            inline: false 
          },
          {
            name: '💡 您可以採取的行動：',
            value: '• 若此為您在其他 Discord 上的帳號，請先解除綁定\n• 若此非您的帳號，您可能使用了錯誤的 API 金鑰\n• 若您認為這是錯誤，請聯繫管理員',
            inline: false
          },
          {
            name: '🔑 安全提示',
            value: '基於安全考量，每個 Pterodactyl 帳號一次只能綁定一個 Discord 帳號。',
            inline: false
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 綁定使用者
    await authService.bindUser(interaction.user.id, pterodactylUserId, apiKey);

    const embed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 帳號綁定成功')
      .setDescription(`您的 Discord 帳號已成功綁定到您的 Pterodactyl 帳號！`)
      .addFields(
        { name: '👤 Pterodactyl 使用者', value: userInfo.username, inline: true },
        { name: '📧 電子郵件', value: userInfo.email, inline: true },
        { name: '🆔 使用者 ID', value: pterodactylUserId.toString(), inline: true },
        { name: '🎯 綁定方式', value: method === 'api_key' ? '僅 API 金鑰' : method === 'email_api' ? '電子郵件 + API 金鑰' : '使用者名稱 + API 金鑰', inline: true },
        { name: '🎮 可用指令', value: '`/servers` - 查看您的伺服器\n`/create-server` - 建立新伺服器\n`/status` - 查看綁定狀態', inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    Logger.info(`使用者 ${interaction.user.tag} 已將帳號綁定至 Pterodactyl 使用者 ${userInfo.username} (${pterodactylUserId})`);

  } catch (error) {
    Logger.error('bind 指令發生錯誤：', error);
    
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription('綁定帳號時發生錯誤，請稍後再試。')
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
    // 檢查使用者是否已綁定
    const isAlreadyBound = await authService.isUserBound(message.author.id);
    if (isAlreadyBound) {
      const currentUser = await authService.getBoundUser(message.author.id);
      const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⚠️ 帳號已綁定')
        .setDescription('您的 Discord 帳號已綁定到 Pterodactyl 帳號！')
        .addFields(
          { 
            name: '📋 目前綁定資訊', 
            value: `**使用者 ID：** ${currentUser?.pterodactyl_user_id}\n**API 金鑰：** \`${currentUser?.pterodactyl_api_key.substring(0, 8)}...\``, 
            inline: false 
          },
          {
            name: '🔄 綁定其他帳號',
            value: '您必須先使用 `!unbind` 解除目前帳號的綁定，再使用 `!bind` 以新的憑證重新綁定。',
            inline: false
          },
          {
            name: '📊 查看目前狀態',
            value: '使用 `!status` 查看您目前的綁定資訊。',
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
    if (args.length < 1) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 無效的用法')
        .setDescription('您需要提供 Pterodactyl API 金鑰來綁定帳號。')
        .addFields(
          { 
            name: '用法選項：', 
            value: '• `!bind <api_key>` - 僅使用 API 金鑰綁定（推薦）\n• `!bind <api_key> email <您的電子郵件>` - 使用電子郵件驗證綁定\n• `!bind <api_key> username <您的使用者名稱>` - 使用使用者名稱驗證綁定',
            inline: false 
          },
          { 
            name: '範例：', 
            value: '`!bind ptlc_your_api_key_here`',
            inline: false 
          },
          {
            name: '如何取得您的 API 金鑰：',
            value: '1. 前往您的 Pterodactyl 面板\n2. 點擊您的帳號（右上角）\n3. 前往「API 憑證」\n4. 建立新的 API 金鑰\n5. 複製金鑰並在此使用',
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

    const apiKey = args[0];
    let method = 'api_key';
    let identifier: string | undefined;

    // 解析方法和識別符的額外引數
    if (args.length >= 3) {
      const methodArg = args[1].toLowerCase();
      if (methodArg === 'email') {
        method = 'email_api';
        identifier = args[2];
      } else if (methodArg === 'username') {
        method = 'username_api';
        identifier = args[2];
      }
    }

    const reply = await message.reply({ 
      content: '🔄 綁定帳號中...',
      allowedMentions: { repliedUser: false }
    });

    // 驗證 API 金鑰是否有效並取得使用者資訊
    pterodactylService.setUserApiKey(apiKey);
    
    let userInfo;
    try {
      // 嘗試從客戶端 API 取得使用者資訊
      userInfo = await pterodactylService.getClientUserInfo();
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 無效的 API 金鑰')
        .setDescription('提供的 API 金鑰無效或已過期，請檢查您的 API 金鑰後再試一次。')
        .addFields(
          { 
            name: '如何取得您的 API 金鑰：', 
            value: '1. 前往您的 Pterodactyl 面板\n2. 點擊您的帳號（右上角）\n3. 前往「API 憑證」\n4. 建立新的 API 金鑰\n5. 複製金鑰並在此使用',
            inline: false 
          }
        )
        .setTimestamp();

      await reply.edit({ content: '', embeds: [embed] });
      return;
    }

    let pterodactylUserId: number;

    switch (method) {
      case 'api_key':
        // 使用 API 金鑰取得的使用者資訊（最可靠的方法）
        pterodactylUserId = userInfo.id;
        break;

      case 'email_api':
        if (!identifier) {
          const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ 缺少電子郵件')
            .setDescription('使用電子郵件 + API 金鑰方式時，必須提供電子郵件。')
            .setTimestamp();

          await reply.edit({ content: '', embeds: [embed] });
          return;
        }

        // 驗證電子郵件是否與 API 金鑰擁有者相符
        if (userInfo.email.toLowerCase() !== identifier.toLowerCase()) {
          const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ 電子郵件不符')
            .setDescription('提供的電子郵件與 API 金鑰擁有者不符。')
            .addFields(
              { name: '預期電子郵件', value: userInfo.email, inline: true },
              { name: '提供的電子郵件', value: identifier, inline: true }
            )
            .setTimestamp();

          await reply.edit({ content: '', embeds: [embed] });
          return;
        }
        pterodactylUserId = userInfo.id;
        break;

      case 'username_api':
        if (!identifier) {
          const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ 缺少使用者名稱')
            .setDescription('使用使用者名稱 + API 金鑰方式時，必須提供使用者名稱。')
            .setTimestamp();

          await reply.edit({ content: '', embeds: [embed] });
          return;
        }

        // 驗證使用者名稱是否與 API 金鑰擁有者相符
        if (userInfo.username.toLowerCase() !== identifier.toLowerCase()) {
          const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('❌ 使用者名稱不符')
            .setDescription('提供的使用者名稱與 API 金鑰擁有者不符。')
            .addFields(
              { name: '預期使用者名稱', value: userInfo.username, inline: true },
              { name: '提供的使用者名稱', value: identifier, inline: true }
            )
            .setTimestamp();

          await reply.edit({ content: '', embeds: [embed] });
          return;
        }        pterodactylUserId = userInfo.id;
        break;

      default:
        throw new Error('無效的綁定方式');
    }

    // 檢查此 Pterodactyl 帳號是否已綁定到其他 Discord 帳號
    const pterodactylBinding = await authService.isPterodactylUserBound(pterodactylUserId);
    if (pterodactylBinding.isBound) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ Pterodactyl 帳號已被綁定')
        .setDescription('此 Pterodactyl 帳號已被綁定到其他 Discord 帳號！')
        .addFields(
          { 
            name: '🔗 目前綁定資訊', 
            value: `**Pterodactyl 使用者 ID：** ${pterodactylUserId}\n**已綁定的 Discord ID：** \`${pterodactylBinding.discordId}\``, 
            inline: false 
          },
          {
            name: '💡 您可以採取的行動：',
            value: '• 若此為您在其他 Discord 上的帳號，請先解除綁定\n• 若此非您的帳號，您可能使用了錯誤的 API 金鑰\n• 若您認為這是錯誤，請聯繫管理員',
            inline: false
          },
          {
            name: '🔑 安全提示',
            value: '基於安全考量，每個 Pterodactyl 帳號一次只能綁定一個 Discord 帳號。',
            inline: false
          }
        )
        .setTimestamp();

      await reply.edit({ content: '', embeds: [embed] });
      return;
    }

    // 綁定使用者
    await authService.bindUser(message.author.id, pterodactylUserId, apiKey);

    const embed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 帳號綁定成功')
      .setDescription(`您的 Discord 帳號已成功綁定到您的 Pterodactyl 帳號！`)
      .addFields(
        { name: '👤 Pterodactyl 使用者', value: userInfo.username, inline: true },
        { name: '📧 電子郵件', value: userInfo.email, inline: true },
        { name: '🆔 使用者 ID', value: pterodactylUserId.toString(), inline: true },
        { name: '🎯 綁定方式', value: method === 'api_key' ? '僅 API 金鑰' : method === 'email_api' ? '電子郵件 + API 金鑰' : '使用者名稱 + API 金鑰', inline: true },
        { name: '🎮 可用指令', value: '`/servers` 或 `!servers` - 查看您的伺服器\n`/create-server` 或 `!create-server` - 建立新伺服器\n`/status` 或 `!status` - 查看綁定狀態', inline: false }
      )
      .setTimestamp();

    await reply.edit({ content: '', embeds: [embed] });
    Logger.info(`使用者 ${message.author.tag} 已將帳號綁定至 Pterodactyl 使用者 ${userInfo.username} (${pterodactylUserId})`);

  } catch (error) {
    Logger.error('bind 指令發生錯誤：', error);
    
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription('綁定帳號時發生錯誤，請稍後再試。')
      .setTimestamp();

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  }
}
