import { 
  Client, 
  GatewayIntentBits, 
  Collection, 
  Events, 
  REST, 
  Routes,
  ChatInputCommandInteraction,
  ButtonInteraction,
  AutocompleteInteraction,
  ComponentType,
  ActivityType
} from 'discord.js';
import { config } from 'dotenv';
import { DatabaseConnection } from './database/connection';
import { AuthService } from './services/auth';
import { PterodactylService } from './services/pterodactyl';
import { Logger } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// 載入環境變數
config();

// 介面定義
interface Command {
  data: any;
  execute: (interaction: ChatInputCommandInteraction, ...args: any[]) => Promise<void>;
  executePrefix?: (message: any, args: string[], authService: any, pterodactylService: any) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction, ...args: any[]) => Promise<void>;
}

class PterodactylBot {  private client: Client;
  private commands: Collection<string, Command>;
  private database: DatabaseConnection;
  private authService: AuthService;
  private pterodactylService: PterodactylService;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.commands = new Collection();
    this.database = new DatabaseConnection();
    this.authService = new AuthService(this.database);
    this.pterodactylService = new PterodactylService();

    this.setupEventHandlers();
  }  private async loadCommands(): Promise<void> {
    const commandsPath = path.join(__dirname, 'commands');
    
    // 在正式環境（已編譯）中，只尋找 .js 檔案（不含 .d.ts 或 .js.map）
    // 在開發環境（ts-node）中，只尋找 .ts 檔案（不含 .d.ts）
    const isProduction = __filename.endsWith('.js');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => {
      if (isProduction) {
        // 只包含 .js 檔案，排除 .d.ts 和 .js.map 檔案
        return file.endsWith('.js') && !file.includes('.d.') && !file.includes('.map');
      } else {
        // 只包含 .ts 檔案，排除 .d.ts 檔案
        return file.endsWith('.ts') && !file.includes('.d.');
      }
    });

    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsPath, file);
        const command = await import(filePath);
        
        if ('data' in command && 'execute' in command) {
          this.commands.set(command.data.name, command);
          Logger.info(`已載入指令：${command.data.name}`);
        } else {
          Logger.warn(`位於 ${filePath} 的指令缺少必要的 "data" 或 "execute" 屬性。`);
        }
      } catch (error) {
        Logger.error(`載入指令 ${file} 失敗：`, error);
      }
    }
  }

  private async deployCommands(): Promise<void> {
    const commands = [];
    for (const [, command] of this.commands) {
      commands.push(command.data.toJSON());
    }

    const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

    try {
      Logger.info(`開始重新整理 ${commands.length} 個應用程式 (/) 指令。`);

      const data = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID!),
        { body: commands },
      );

      Logger.info(`已成功重新載入 ${(data as any).length} 個應用程式 (/) 指令。`);
    } catch (error) {
      Logger.error('部署指令時發生錯誤：', error);
    }
  }  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, async (readyClient) => {
      Logger.info(`機器人已就緒！已以 ${readyClient.user.tag} 身份登入`);
      Logger.info(`已連線至 ${readyClient.guilds.cache.size} 個伺服器`);
      
      // 稍作延遲後設定機器人狀態，確保客戶端已完全就緒
      setTimeout(async () => {
        await this.updateBotPresence();
      }, 1000);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isAutocomplete()) {
        await this.handleAutocomplete(interaction);
      } else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      }
    });

    this.client.on(Events.MessageCreate, async (message) => {
      await this.handlePrefixCommand(message);
    });

    this.client.on(Events.Error, (error) => {
      Logger.error('Discord 客戶端錯誤：', error);
    });

    this.client.on(Events.Warn, (warning) => {
      Logger.warn('Discord 客戶端警告：', warning);
    });
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      Logger.error(`找不到符合 ${interaction.commandName} 的指令。`);
      return;
    }

    try {
      await command.execute(interaction, this.authService, this.pterodactylService);
    } catch (error) {
      Logger.error(`執行指令 ${interaction.commandName} 時發生錯誤：`, error);
      
      const errorMessage = {
        content: '執行此指令時發生錯誤！',
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  }

  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command || !command.autocomplete) {
      return;
    }

    try {
      await command.autocomplete(interaction, this.pterodactylService);
    } catch (error) {
      Logger.error(`處理 ${interaction.commandName} 自動補全時發生錯誤：`, error);
    }
  }
  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    try {
      const [action, subAction, serverUuid] = interaction.customId.split('_');      // 略過前綴與斜線指令按鈕 — 由各自的指令處理
      if (action === 'prefix' || action === 'slash') {
        return;
      }      if (action === 'confirm' && subAction === 'delete') {
        await interaction.deferUpdate();

        // 確認使用者已通過驗證（不需要管理員 — 伺服器所有權由指令驗證）
        const context = await this.authService.requireAuth(interaction.user, interaction.member as any);
        
        // 設定使用者 API 金鑰，確保使用者只能刪除自己的伺服器
        this.pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
        
        // 透過確認使用者是否能存取來驗證伺服器所有權
        const userServers = await this.pterodactylService.getUserServers();
        const server = userServers.find(s => s.uuid === serverUuid);
        
        if (!server) {
          const embed = {
            color: 0xff0000,
            title: '❌ 存取被拒',
            description: `您沒有權限刪除此伺服器。`,
            timestamp: new Date().toISOString(),
          };
          await interaction.editReply({ embeds: [embed], components: [] });
          return;
        }
        
        // 刪除伺服器
        await this.pterodactylService.deleteServer(serverUuid);// 從資料庫移除
        this.database.removeUserServer(interaction.user.id, serverUuid);

        const embed = {
          color: 0x00ff00,
          title: '✅ 伺服器已成功刪除',
          description: `UUID 為 **${serverUuid}** 的伺服器已永久刪除。`,
          timestamp: new Date().toISOString(),
        };

        await interaction.editReply({ embeds: [embed], components: [] });
        Logger.info(`使用者 ${interaction.user.tag} 確認刪除伺服器：${serverUuid}`);

      } else if (action === 'cancel' && subAction === 'delete') {
        await interaction.deferUpdate();

        const embed = {
          color: 0xffa500,
          title: '❌ 刪除已取消',
          description: '伺服器刪除操作已取消。',
          timestamp: new Date().toISOString(),
        };

        await interaction.editReply({ embeds: [embed], components: [] });
      }

    } catch (error) {
      Logger.error('處理按鈕互動時發生錯誤：', error);
        const errorEmbed = {
        color: 0xff0000,
        title: '❌ 錯誤',
        description: error instanceof Error ? error.message : '處理此操作時發生錯誤。',
        timestamp: new Date().toISOString(),
      };

      if (interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed], components: [] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  }

  private async handlePrefixCommand(message: any): Promise<void> {
    // 忽略機器人的訊息
    if (message.author.bot) return;

    const prefix = process.env.PREFIX || '!';

    // 檢查訊息是否以前綴開頭
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    // 尋找指令
    const command = this.commands.get(commandName);
    if (!command) return;

    // 檢查指令是否支援前綴
    if (!command.executePrefix) {
      const availableCommands = Array.from(this.commands.keys())
        .filter(name => this.commands.get(name)?.executePrefix)
        .map(name => `\`${prefix}${name}\``)
        .join(', ');

      await message.reply({
        content: `❌ 此指令僅支援斜線指令形式，請改用 \`/${commandName}\`。\n\n**可用的前綴指令：** ${availableCommands || '無'}`,
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    try {
      await command.executePrefix(message, args, this.authService, this.pterodactylService);
    } catch (error) {
      Logger.error(`執行前綴指令 ${commandName} 時發生錯誤：`, error);
      await message.reply({
        content: '❌ 執行此指令時發生錯誤！',
        allowedMentions: { repliedUser: false }
      });
    }
  }
  private async updateBotPresence(): Promise<void> {
    if (!this.client.user) return;

    try {
      const guildCount = this.client.guilds.cache.size;
      
      await this.client.user.setPresence({
        activities: [{
          name: `Pterodactyl Panel | ${guildCount} server${guildCount !== 1 ? 's' : ''}`,
          type: ActivityType.Playing,
        }],
        status: 'online',
      });

      Logger.info(`機器人狀態已設定為「正在遊玩 Pterodactyl Panel | ${guildCount} server${guildCount !== 1 ? 's' : ''}」`);
    } catch (error) {
      Logger.error('更新機器人狀態失敗：', error);
    }
  }

  public async start(): Promise<void> {
    try {
      // 驗證環境變數
      if (!process.env.DISCORD_TOKEN) {
        throw new Error('DISCORD_TOKEN 為必填項目');
      }
      if (!process.env.CLIENT_ID) {
        throw new Error('CLIENT_ID 為必填項目');
      }
      if (!process.env.PTERODACTYL_URL) {
        throw new Error('PTERODACTYL_URL 為必填項目');
      }
      if (!process.env.PTERODACTYL_API_KEY) {
        throw new Error('PTERODACTYL_API_KEY 為必填項目');
      }

      // 載入並部署指令
      await this.loadCommands();
      await this.deployCommands();

      // 登入 Discord
      await this.client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
      Logger.error('啟動機器人時發生錯誤：', error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    Logger.info('正在關閉機器人…');
    this.database.close();
    this.client.destroy();
  }
}

// 建立並啟動機器人
const bot = new PterodactylBot();

// 處理優雅關閉
process.on('SIGINT', async () => {
  Logger.info('收到 SIGINT，正在優雅地關閉…');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  Logger.info('收到 SIGTERM，正在優雅地關閉…');
  await bot.stop();
  process.exit(0);
});

// 啟動機器人
bot.start().catch((error) => {
  Logger.error('啟動機器人失敗：', error);
  process.exit(1);
});
