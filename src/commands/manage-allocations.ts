import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ComponentType,
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('manage-allocations')
  .setDescription('管理節點的 Port 配置（僅限管理員）')
  .addSubcommand(sub =>
    sub
      .setName('list')
      .setDescription('列出節點的所有 Port 配置')
      .addIntegerOption(opt =>
        opt.setName('node_id').setDescription('節點 ID').setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('add')
      .setDescription('新增 Port 配置至節點')
      .addIntegerOption(opt =>
        opt.setName('node_id').setDescription('節點 ID').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('ip').setDescription('IP 位址，例如：0.0.0.0').setRequired(true)
      )
      .addStringOption(opt =>
        opt
          .setName('ports')
          .setDescription('Port 或範圍，以逗號分隔，例如：25565,25566-25570')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('delete')
      .setDescription('刪除節點的指定 Port 配置')
      .addIntegerOption(opt =>
        opt.setName('node_id').setDescription('節點 ID').setRequired(true)
      )
      .addIntegerOption(opt =>
        opt.setName('allocation_id').setDescription('配置 ID（選填 - 若未提供將顯示選單）').setRequired(false)
      )
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  try {
    await interaction.deferReply();

    // 管理員驗證
    await authService.requireAdmin(interaction.user, interaction.member as any);

    pterodactylService.setAdminApiKey();

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      await handleList(interaction, pterodactylService);
    } else if (sub === 'add') {
      await handleAdd(interaction, pterodactylService);
    } else if (sub === 'delete') {
      await handleDelete(interaction, pterodactylService);
    }
  } catch (error: any) {
    Logger.error('manage-allocations 指令發生錯誤：', error);

    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 錯誤')
      .setDescription(error instanceof Error ? error.message : '執行指令時發生錯誤。')
      .setTimestamp();

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  pterodactylService: PterodactylService
) {
  const nodeId = interaction.options.getInteger('node_id');

  const nodes = await pterodactylService.getNodes();
  if (nodes.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('Orange')
      .setTitle('⚠️ 無可用節點')
      .setDescription('目前沒有可用的節點。')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 若未提供 node_id，讓使用者從選單選擇
  let targetNodeId = nodeId;
  if (!targetNodeId) {
    if (nodes.length === 1) {
      targetNodeId = nodes[0].id;
    } else {
      const select = new StringSelectMenuBuilder()
        .setCustomId('alloc_list_node')
        .setPlaceholder('選擇一個節點')
        .addOptions(
          nodes.slice(0, 25).map((node: any) => ({
            label: node.name,
            description: `ID: ${node.id}`,
            value: node.id.toString(),
          }))
        );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

      const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('🖥️ 選擇節點')
        .setDescription('請選擇要查看 Port 配置的節點：')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], components: [row] });

      try {
        const collected = await interaction.channel!.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          filter: i => i.customId === 'alloc_list_node' && i.user.id === interaction.user.id,
          time: 30_000,
        });
        targetNodeId = parseInt(collected.values[0], 10);
        await collected.deferUpdate();
      } catch {
        const timeoutEmbed = new EmbedBuilder()
          .setColor('Orange')
          .setTitle('⏰ 操作逾時')
          .setDescription('未在時限內選擇節點，操作已取消。')
          .setTimestamp();
        await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
        return;
      }
    }
  }

  const targetNode = nodes.find((n: any) => n.id === targetNodeId);
  if (!targetNode) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到節點')
      .setDescription(`找不到 ID 為 ${targetNodeId} 的節點。`)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  const allocationData = await pterodactylService.getNodeAllocations(targetNodeId!);
  const allocations = allocationData.map((a: any) => a.attributes);

  if (allocations.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('Orange')
      .setTitle(`📋 ${targetNode.name} 的 Port 配置`)
      .setDescription('此節點目前沒有任何 Port 配置。')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  // 每頁最多顯示 20 筆
  const pageSize = 20;
  const page = allocations.slice(0, pageSize);
  const lines = page.map((a: any) => {
    const status = a.assigned ? '🔴 已使用' : '🟢 可用';
    return `**ID ${a.id}** — \`${a.ip}:${a.port}\` ${status}`;
  });

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle(`📋 ${targetNode.name} 的 Port 配置`)
    .setDescription(lines.join('\n'))
    .setFooter({
      text: `共 ${allocations.length} 筆配置${allocations.length > pageSize ? `（僅顯示前 ${pageSize} 筆）` : ''}`,
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  pterodactylService: PterodactylService
) {
  const nodeId = interaction.options.getInteger('node_id', true);
  const ip = interaction.options.getString('ip', true).trim();
  const portsInput = interaction.options.getString('ports', true).trim();

  // 解析 ports：以逗號分隔，每項可為單一 port 或 port 範圍
  const ports = portsInput
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (ports.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 無效的 Port 格式')
      .setDescription('請提供至少一個 Port 或 Port 範圍，例如：`25565` 或 `25565,25566-25570`。')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const nodes = await pterodactylService.getNodes();
  const targetNode = nodes.find((n: any) => n.id === nodeId);
  if (!targetNode) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到節點')
      .setDescription(`找不到 ID 為 ${nodeId} 的節點。`)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  await pterodactylService.createAllocation(nodeId, ip, ports);

  const embed = new EmbedBuilder()
    .setColor('Green')
    .setTitle('✅ Port 配置新增成功')
    .addFields(
      { name: '🖥️ 節點', value: `${targetNode.name} (ID: ${nodeId})`, inline: true },
      { name: '🌐 IP', value: ip, inline: true },
      { name: '🔌 Ports', value: ports.join(', '), inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  Logger.info(`管理員 ${interaction.user.tag} 在節點 ${nodeId} 新增配置：${ip} [${ports.join(', ')}]`);
}

async function handleDelete(
  interaction: ChatInputCommandInteraction,
  pterodactylService: PterodactylService
) {
  const nodeId = interaction.options.getInteger('node_id', true);
  const allocationId = interaction.options.getInteger('allocation_id');

  const nodes = await pterodactylService.getNodes();
  const targetNode = nodes.find((n: any) => n.id === nodeId);
  if (!targetNode) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ 找不到節點')
      .setDescription(`找不到 ID 為 ${nodeId} 的節點。`)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  let targetAllocationId = allocationId;

  if (!targetAllocationId) {
    // 顯示選單讓管理員選擇要刪除的配置
    const allocationData = await pterodactylService.getNodeAllocations(nodeId);
    const allocations = allocationData.map((a: any) => a.attributes);

    const freeAllocations = allocations.filter((a: any) => !a.assigned);

    if (freeAllocations.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⚠️ 無可刪除的配置')
        .setDescription('此節點沒有可刪除的空閒 Port 配置（已使用中的配置無法刪除）。')
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const options = freeAllocations.slice(0, 25).map((a: any) => ({
      label: `${a.ip}:${a.port}`,
      description: `配置 ID: ${a.id}`,
      value: a.id.toString(),
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('alloc_delete_select')
      .setPlaceholder('選擇要刪除的 Port 配置')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const embed = new EmbedBuilder()
      .setColor('Orange')
      .setTitle(`🗑️ 選擇要刪除的配置`)
      .setDescription(`節點：**${targetNode.name}**\n請選擇要刪除的空閒 Port 配置：`)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [row] });

    try {
      const collected = await interaction.channel!.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: i => i.customId === 'alloc_delete_select' && i.user.id === interaction.user.id,
        time: 30_000,
      });
      targetAllocationId = parseInt(collected.values[0], 10);
      await collected.deferUpdate();
    } catch {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ 操作逾時')
        .setDescription('未在時限內選擇配置，操作已取消。')
        .setTimestamp();
      await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
      return;
    }
  }

  await pterodactylService.deleteAllocation(nodeId, targetAllocationId!);

  const embed = new EmbedBuilder()
    .setColor('Green')
    .setTitle('✅ Port 配置已刪除')
    .addFields(
      { name: '🖥️ 節點', value: `${targetNode.name} (ID: ${nodeId})`, inline: true },
      { name: '🆔 配置 ID', value: targetAllocationId!.toString(), inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed], components: [] });
  Logger.info(`管理員 ${interaction.user.tag} 刪除節點 ${nodeId} 的配置 ID ${targetAllocationId}`);
}
