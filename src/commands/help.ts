import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  Message
} from 'discord.js';
import { AuthService } from '../services/auth';
import { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('顯示所有可用指令及其說明')
  .addStringOption(option =>
    option.setName('command')
      .setDescription('取得特定指令的詳細說明')
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService
) {
  try {
    await interaction.deferReply();    const specificCommand = interaction.options.getString('command');
    const isUserBound = await authService.isUserBound(interaction.user.id);
    const isAdmin = interaction.member ? authService.isAdmin(interaction.member as any) : false;

    if (specificCommand) {
      // 顯示特定指令的詳細說明
      await showCommandDetails(interaction, specificCommand, isUserBound, isAdmin);
    } else {
      // 顯示所有指令的一般說明
      await showGeneralHelp(interaction, isUserBound, isAdmin);
    }

  } catch (error) {
    Logger.error('help 指令發生錯誤：', error);
    
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription('載入說明資訊時發生錯誤。')
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
  try {    const specificCommand = args[0];
    const isUserBound = await authService.isUserBound(message.author.id);
    const isAdmin = message.member ? authService.isAdmin(message.member as any) : false;

    if (specificCommand) {
      // 顯示特定指令的詳細說明
      await showCommandDetailsPrefix(message, specificCommand, isUserBound, isAdmin);
    } else {
      // 顯示所有指令的一般說明
      await showGeneralHelpPrefix(message, isUserBound, isAdmin);
    }

  } catch (error) {
    Logger.error('help 指令發生錯誤（前綴）：', error);
    
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription('載入說明資訊時發生錯誤。')
      .setTimestamp();

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  }
}

async function getAvailableCommands(): Promise<CommandInfo[]> {
  const commands: CommandInfo[] = [];
  const commandsDir = path.join(__dirname);
  
  try {
    const allFiles = fs.readdirSync(commandsDir);
    
    // 使用與主機器人相同的過濾邏輯
    const isProduction = __filename.endsWith('.js');
    const files = allFiles.filter(file => {
      if (isProduction) {
        // 只包含 .js 檔案，排除 .d.ts 和 .js.map 檔案
        return file.endsWith('.js') && !file.includes('.d.') && !file.includes('.map');
      } else {
        // 只包含 .ts 檔案，排除 .d.ts 檔案
        return file.endsWith('.ts') && !file.includes('.d.');
      }
    });
    
    for (const file of files) {
      const commandName = file.replace(/\.(js|ts)$/, '');
      
      // 跳過 help 指令本身以避免遞迴
      if (commandName === 'help') continue;
      
      try {
        // 動態匯入指令模組
        const commandModule = await import(path.join(commandsDir, file));
        
        if (commandModule.data) {
          const commandData = commandModule.data;
          commands.push({
            name: commandData.name,
            description: commandData.description,
            options: commandData.options || [],
            category: getCommandCategory(commandName)
          });
        }
      } catch (error) {
        Logger.error(`無法載入指令 ${commandName}：`, error);
      }
    }
  } catch (error) {
    Logger.error('無法讀取指令目錄：', error);
  }
  
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

function getCommandCategory(commandName: string): string {
  const categories: { [key: string]: string } = {
    'bind': '驗證',
    'unbind': '驗證',
    'status': '驗證',
    'servers': '伺服器管理',
    'create-server': '伺服器管理',
    'delete-server': '伺服器管理',
    'power': '伺服器管理',
    'monitor': '伺服器管理',
    'ping': '工具',
    'help': '工具'
  };
  
  return categories[commandName] || '一般';
}

async function showGeneralHelp(interaction: ChatInputCommandInteraction, isUserBound: boolean, isAdmin: boolean) {
  const commands = await getAvailableCommands();
  const categories = groupCommandsByCategory(commands);
  
  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('🤖 機器人指令')
    .setDescription('依分類整理的可用指令')
    .setTimestamp();

  // 以整潔格式加入分類
  for (const [category, categoryCommands] of Object.entries(categories)) {
    const commandList = categoryCommands.map(cmd => {
      return `\`/${cmd.name}\` - ${cmd.description}`;
    }).join('\n');
    
    embed.addFields({
      name: `${getCategoryEmoji(category)} ${category}`,
      value: commandList,
      inline: false
    });
  }

  // 簡單頁尾
  embed.setFooter({ 
    text: `${commands.length} 個可用指令` 
  });

  await interaction.editReply({ embeds: [embed] });
}

async function showGeneralHelpPrefix(message: Message, isUserBound: boolean, isAdmin: boolean) {
  const commands = await getAvailableCommands();
  const categories = groupCommandsByCategory(commands);
  
  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('🤖 機器人指令')
    .setDescription('依分類整理的可用指令')
    .setTimestamp();

  // 以整潔格式加入分類
  for (const [category, categoryCommands] of Object.entries(categories)) {
    const commandList = categoryCommands.map(cmd => {
      return `\`!${cmd.name}\` / \`/${cmd.name}\` - ${cmd.description}`;
    }).join('\n');
    
    embed.addFields({
      name: `${getCategoryEmoji(category)} ${category}`,
      value: commandList,
      inline: false
    });
  }

  // 簡單頁尾
  embed.setFooter({ 
    text: `${commands.length} 個可用指令` 
  });

  await message.reply({ 
    embeds: [embed],
    allowedMentions: { repliedUser: false }
  });
}

async function showCommandDetails(interaction: ChatInputCommandInteraction, commandName: string, isUserBound: boolean, isAdmin: boolean) {
  const commands = await getAvailableCommands();
  const command = commands.find(cmd => cmd.name === commandName.toLowerCase());
  
  if (!command) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到指令')
      .setDescription(`找不到指令 \`${commandName}\`。`)
      .addFields({
        name: '💡 可用指令',
        value: commands.map(cmd => `\`${cmd.name}\``).join(', '),
        inline: false
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }
  const detailedInfo = getCommandDetailedInfo(command.name);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle(`📖 指令：/${command.name}`)
    .setDescription(command.description)
    .addFields(
      {
        name: '🏷️ 分類',
        value: command.category,
        inline: true
      }
    );

  if (command.options && command.options.length > 0) {
    const optionsList = command.options.map((opt: any) => {
      const required = opt.required ? '（必填）' : '（選填）';
      return `\`${opt.name}\` ${required} - ${opt.description}`;
    }).join('\n');

    embed.addFields({
      name: '⚙️ 選項',
      value: optionsList,
      inline: false
    });
  }

  if (detailedInfo.usage) {
    embed.addFields({
      name: '💡 使用範例',
      value: detailedInfo.usage,
      inline: false
    });
  }

  if (detailedInfo.notes) {
    embed.addFields({
      name: '📝 備註',
      value: detailedInfo.notes,
      inline: false
    });
  }

  embed.setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}

async function showCommandDetailsPrefix(message: Message, commandName: string, isUserBound: boolean, isAdmin: boolean) {
  const commands = await getAvailableCommands();
  const command = commands.find(cmd => cmd.name === commandName.toLowerCase());
  
  if (!command) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到指令')
      .setDescription(`找不到指令 \`${commandName}\`。`)
      .addFields({
        name: '💡 可用指令',
        value: commands.map(cmd => `\`${cmd.name}\``).join(', '),
        inline: false
      })
      .setTimestamp();

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
    return;
  }
  const detailedInfo = getCommandDetailedInfo(command.name);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle(`📖 指令：${command.name}`)
    .setDescription(command.description)
    .addFields(
      {
        name: '🏷️ 分類',
        value: command.category,
        inline: true
      }
    );

  if (command.options && command.options.length > 0) {
    const optionsList = command.options.map((opt: any) => {
      const required = opt.required ? '（必填）' : '（選填）';
      return `\`${opt.name}\` ${required} - ${opt.description}`;
    }).join('\n');

    embed.addFields({
      name: '⚙️ 選項',
      value: optionsList,
      inline: false
    });
  }

  if (detailedInfo.usage) {
    embed.addFields({
      name: '💡 使用範例',
      value: detailedInfo.usage,
      inline: false
    });
  }

  if (detailedInfo.notes) {
    embed.addFields({
      name: '📝 備註',
      value: detailedInfo.notes,
      inline: false
    });
  }

  embed.setTimestamp();
  await message.reply({ 
    embeds: [embed],
    allowedMentions: { repliedUser: false }
  });
}

function groupCommandsByCategory(commands: CommandInfo[]): { [category: string]: CommandInfo[] } {
  const categories: { [category: string]: CommandInfo[] } = {};
  
  for (const command of commands) {
    if (!categories[command.category]) {
      categories[command.category] = [];
    }
    categories[command.category].push(command);
  }
  
  return categories;
}

function getCategoryEmoji(category: string): string {
  const emojis: { [key: string]: string } = {
    '驗證': '🔐',
    '伺服器管理': '🖥️',
    '工具': '🛠️',
    '一般': '📋'
  };
  
  return emojis[category] || '📋';
}

function getCommandDetailedInfo(commandName: string): { usage?: string; notes?: string } {
  const details: { [key: string]: { usage?: string; notes?: string } } = {
    'bind': {
      usage: '`/bind method:"API Key Only" api_key:您的 API 金鑰`\n`!bind 您的 API 金鑰`',
      notes: '將您的 Discord 帳號連結至 Pterodactyl 帳號。每個 Pterodactyl 帳號只能綁定一個 Discord 帳號。'
    },
    'servers': {
      usage: '`/servers` 或 `!servers`',
      notes: '顯示所有伺服器並支援分頁。點擊按鈕可在頁面間切換。'
    },
    'create-server': {
      usage: '`/create-server` 或 `!create-server`',
      notes: '互動式伺服器建立，可選擇節點與 egg。自動設定智慧啟動指令。'
    },
    'delete-server': {
      usage: '`/delete-server server_id:伺服器名稱` 或 `!delete-server 伺服器名稱`',
      notes: '刪除您擁有的伺服器。刪除前需確認。伺服器資料將永久遺失。'
    },
    'power': {
      usage: '`/power action:start server_id:伺服器名稱` 或 `!power start 伺服器名稱`',
      notes: '可用動作：start、stop、restart、kill。您只能控制自己擁有的伺服器。'
    },
    'monitor': {
      usage: '`/monitor server_id:伺服器名稱` 或 `!monitor 伺服器名稱`',
      notes: '顯示當前資源使用狀況（非即時）。包含記憶體、CPU、磁碟、網路 I/O 及運行時間。'
    },
    'status': {
      usage: '`/status` 或 `!status`',
      notes: '顯示您目前的綁定狀態及根據權限可用的指令。'
    },
    'unbind': {
      usage: '`/unbind` 或 `!unbind`',
      notes: '需要確認。在重新綁定前，您將無法使用伺服器管理指令。'
    },
    'ping': {
      usage: '`/ping` 或 `!ping`',
      notes: '顯示機器人延遲、運行時間及系統資訊。'
    }
  };
  
  return details[commandName] || {};
}

interface CommandInfo {
  name: string;
  description: string;
  options: any[];
  category: string;
}
