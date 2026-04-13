import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';
import { UserError } from '../types';

export const data = new SlashCommandBuilder()
  .setName('create-account')
  .setDescription('在 Pterodactyl 面板建立新使用者帳號（僅限管理員）')
  .addStringOption(option =>
    option
      .setName('username')
      .setDescription('新帳號的使用者名稱')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('email')
      .setDescription('新帳號的電子郵件')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('first_name')
      .setDescription('使用者的名字')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('last_name')
      .setDescription('使用者的姓氏')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('password')
      .setDescription('新帳號的初始密碼')
      .setRequired(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
): Promise<void> {
  try {
    await interaction.deferReply({ ephemeral: true });

    // 確認執行者為管理員
    await authService.requireAdmin(interaction.user, interaction.member as any);

    const username   = interaction.options.getString('username',   true);
    const email      = interaction.options.getString('email',      true);
    const first_name = interaction.options.getString('first_name', true);
    const last_name  = interaction.options.getString('last_name',  true);
    const password   = interaction.options.getString('password',   true);

    pterodactylService.setAdminApiKey();

    const newUser = await pterodactylService.createUser({
      username,
      email,
      first_name,
      last_name,
      password,
    });

    const embed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 帳號建立成功')
      .setDescription(`Pterodactyl 使用者帳號已成功建立！`)
      .addFields(
        { name: '🆔 使用者 ID',    value: newUser.id.toString(),  inline: true },
        { name: '👤 使用者名稱',   value: newUser.username,        inline: true },
        { name: '📧 電子郵件',     value: newUser.email,           inline: true },
        { name: '🪪 姓名',         value: `${newUser.first_name} ${newUser.last_name}`, inline: true },
      )
      .setFooter({ text: '使用者可透過 /bind 將此帳號與 Discord 帳號綁定。' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    Logger.info(
      `管理員 ${interaction.user.tag} 建立了 Pterodactyl 帳號：${newUser.username} (ID: ${newUser.id})`
    );
  } catch (error) {
    if (error instanceof UserError) {
      Logger.warn('create-account 指令使用者錯誤：', error);
    } else {
      Logger.error('create-account 指令發生錯誤：', error);
    }

    let title        = '❌ 發生錯誤';
    let errorMessage = '建立帳號時發生錯誤，請稍後再試。';

    if (error instanceof Error) {
      if (error.message.includes('administrator')) {
        title        = '🚫 權限不足';
        errorMessage = '此指令僅限管理員使用。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title        = '🔌 連線錯誤';
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
): Promise<void> {
  try {
    // 確認執行者為管理員
    await authService.requireAdmin(message.author, message.member as any);

    // 用法：!create-account <使用者名稱> <電子郵件> <名字> <姓氏> <密碼>
    if (args.length < 5) {
      const embed = new EmbedBuilder()
        .setColor('Red')
        .setTitle('❌ 參數不足')
        .setDescription('缺少必填參數！')
        .addFields(
          { name: '用法', value: '`!create-account <使用者名稱> <電子郵件> <名字> <姓氏> <密碼>`', inline: false },
          { name: '範例', value: '`!create-account john john@example.com John Doe P@ssw0rd`', inline: false },
        )
        .setTimestamp();

      await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      return;
    }

    const [username, email, first_name, last_name, password] = args;

    pterodactylService.setAdminApiKey();

    const newUser = await pterodactylService.createUser({
      username,
      email,
      first_name,
      last_name,
      password,
    });

    const embed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ 帳號建立成功')
      .setDescription(`Pterodactyl 使用者帳號已成功建立！`)
      .addFields(
        { name: '🆔 使用者 ID',    value: newUser.id.toString(),  inline: true },
        { name: '👤 使用者名稱',   value: newUser.username,        inline: true },
        { name: '📧 電子郵件',     value: newUser.email,           inline: true },
        { name: '🪪 姓名',         value: `${newUser.first_name} ${newUser.last_name}`, inline: true },
      )
      .setFooter({ text: '使用者可透過 !bind 將此帳號與 Discord 帳號綁定。' })
      .setTimestamp();

    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    Logger.info(
      `管理員 ${message.author.tag} 建立了 Pterodactyl 帳號：${newUser.username} (ID: ${newUser.id})`
    );
  } catch (error) {
    if (error instanceof UserError) {
      Logger.warn('create-account 前綴指令使用者錯誤：', error);
    } else {
      Logger.error('create-account 前綴指令發生錯誤：', error);
    }

    let title        = '❌ 發生錯誤';
    let errorMessage = '建立帳號時發生錯誤，請稍後再試。';

    if (error instanceof Error) {
      if (error.message.includes('administrator')) {
        title        = '🚫 權限不足';
        errorMessage = '此指令僅限管理員使用。';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title        = '🔌 連線錯誤';
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

    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
  }
}
