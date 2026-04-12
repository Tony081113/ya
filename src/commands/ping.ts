import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  Message
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';

// 格式化運行時間的輔助函式
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('查看機器人的延遲與狀態');

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  const sent = await interaction.deferReply({ fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  const apiLatency = Math.round(interaction.client.ws.ping);
  
  // 計算運行時間
  const uptime = process.uptime();
  const uptimeString = formatUptime(uptime);
  
  // 記憶體使用量
  const memoryUsage = process.memoryUsage();
  const memoryUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('🏓 Pong!')
    .addFields(
      { name: '⚡ 機器人延遲', value: `${latency}ms`, inline: true },
      { name: '🌐 API 延遲', value: `${apiLatency}ms`, inline: true },
      { name: '🟢 狀態', value: '線上', inline: true },
      { name: '⏱️ 運行時間', value: uptimeString, inline: true },
      { name: '💾 記憶體使用量', value: `${memoryUsed} MB`, inline: true },
      { name: '👥 伺服器數量', value: `${interaction.client.guilds.cache.size}`, inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

export async function executePrefix(message: Message): Promise<void> {
  const sent = await message.reply({ 
    content: '🏓 計算延遲中...', 
    allowedMentions: { repliedUser: false } 
  });
  const latency = sent.createdTimestamp - message.createdTimestamp;
  const apiLatency = Math.round(message.client.ws.ping);
  
  // 計算運行時間
  const uptime = process.uptime();
  const uptimeString = formatUptime(uptime);
  
  // 記憶體使用量
  const memoryUsage = process.memoryUsage();
  const memoryUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('🏓 Pong!')
    .addFields(
      { name: '⚡ 機器人延遲', value: `${latency}ms`, inline: true },
      { name: '🌐 API 延遲', value: `${apiLatency}ms`, inline: true },
      { name: '🟢 狀態', value: '線上', inline: true },
      { name: '⏱️ 運行時間', value: uptimeString, inline: true },
      { name: '💾 記憶體使用量', value: `${memoryUsed} MB`, inline: true },
      { name: '👥 伺服器數量', value: `${message.client.guilds.cache.size}`, inline: true }
    )
    .setTimestamp();

  await sent.edit({ content: '', embeds: [embed] });
}
