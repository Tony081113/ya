import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ComponentType,
  Message
} from 'discord.js';
import { AuthService } from '../services/auth';
import { PterodactylService } from '../services/pterodactyl';
import { Logger } from '../utils/logger';
import { UserError } from '../types';

export const data = new SlashCommandBuilder()
  .setName('power')
  .setDescription('Control the power state of your servers')
  .addStringOption(option =>
    option.setName('server_id')
      .setDescription('Server UUID or name (optional - will show selection if not provided)')
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName('action')
      .setDescription('Power action to perform')
      .setRequired(false)
      .addChoices(
        { name: '🟢 Start', value: 'start' },
        { name: '🔴 Stop', value: 'stop' },
        { name: '🔄 Restart', value: 'restart' },
        { name: '⚡ Kill (Force Stop)', value: 'kill' }
      )
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  try {
    await interaction.deferReply();

    // Check if user is authenticated
    const context = await authService.requireAuth(interaction.user, interaction.member as any);
    
    const serverId = interaction.options.getString('server_id');
    const action = interaction.options.getString('action');

    if (serverId && action) {
      // Direct power action
      await executePowerAction(interaction, serverId, action, context, pterodactylService);
    } else if (serverId && !action) {
      // Show action selection for specific server
      await showActionSelection(interaction, serverId, context, pterodactylService);
    } else {
      // Show server selection
      await showServerSelection(interaction, context, pterodactylService);
    }

  } catch (error) {
    if (error instanceof UserError) {
      Logger.warn('Error in power command:', error);
    } else {
      Logger.error('Error in power command:', error);
    }
    
    let errorMessage = 'An error occurred while managing server power.';
    let title = '❌ Error';
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('bind your account first')) {
        title = '🔗 Account Not Bound';
        errorMessage = 'You need to bind your Discord account to your Pterodactyl account first!\n\nUse `/bind` to get started.';
      } else if (error.message.includes('Invalid API key')) {
        title = '🔑 Invalid API Key';
        errorMessage = 'Your API key appears to be invalid or expired. Please use `/bind` with a new API key.';
      } else if (error.message.includes('Connection refused') || error.message.includes('ECONNREFUSED')) {
        title = '🔌 Connection Error';
        errorMessage = 'Unable to connect to the Pterodactyl panel. Please try again later.';
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

async function executePowerAction(
  interaction: ChatInputCommandInteraction,
  serverId: string,
  action: string,
  context: any,
  pterodactylService: PterodactylService
) {
  // Set user API key
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
  
  // Get user's servers and verify ownership
  const userServers = await pterodactylService.getUserServers();
  const server = userServers.find(s => 
    s.uuid === serverId || 
    s.id?.toString() === serverId ||
    s.uuid.startsWith(serverId) || // Partial UUID match
    s.name.toLowerCase() === serverId.toLowerCase() // Name match
  );

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ Server Not Found')
      .setDescription(`Server with identifier \`${serverId}\` was not found or doesn't belong to you.`)
      .addFields(
        { 
          name: '💡 Tip', 
          value: 'Use `/power` without parameters to see your available servers.',
          inline: false 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }
  // Execute power action
  const processingEmbed = new EmbedBuilder()
    .setColor('Yellow')
    .setTitle('⏳ Processing...')
    .setDescription(`Executing ${getActionEmoji(action)} **${getActionName(action)}** on server **${server.name}**...`)
    .setTimestamp();

  await interaction.editReply({ embeds: [processingEmbed] });

  try {
    await pterodactylService.sendPowerAction(server.uuid, action as 'start' | 'stop' | 'restart' | 'kill');

    // Get updated server status
    const updatedServer = await pterodactylService.getServerDetails(server.uuid);
    
    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ Power Action Completed')
      .setDescription(`Successfully executed **${getActionName(action)}** on server **${server.name}**.`)
      .addFields(
        { name: '🏷️ Server Name', value: server.name, inline: true },
        { name: '📊 Status', value: getStatusEmoji(updatedServer.status) + ' ' + updatedServer.status, inline: true },
        { name: '⚡ Action', value: `${getActionEmoji(action)} ${getActionName(action)}`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    Logger.info(`User ${interaction.user.tag} executed ${action} on server: ${server.name} (${server.uuid})`);

  } catch (error) {
    Logger.error('Error executing power action:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ Power Action Failed')
      .setDescription(`Failed to execute **${getActionName(action)}** on server **${server.name}**.`)
      .addFields(
        { 
          name: '🔍 Error Details', 
          value: error instanceof Error ? error.message : 'Unknown error occurred',
          inline: false 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function showActionSelection(
  interaction: ChatInputCommandInteraction,
  serverId: string,
  context: any,
  pterodactylService: PterodactylService
) {
  // Set user API key
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
  
  // Get user's servers and verify ownership
  const userServers = await pterodactylService.getUserServers();
  const server = userServers.find(s => 
    s.uuid === serverId || 
    s.id?.toString() === serverId ||
    s.uuid.startsWith(serverId) || 
    s.name.toLowerCase() === serverId.toLowerCase()
  );

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ Server Not Found')
      .setDescription(`Server with identifier \`${serverId}\` was not found or doesn't belong to you.`)
      .addFields(
        { 
          name: '💡 Tip', 
          value: 'Use `/power` without parameters to see your available servers.',
          inline: false 
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Get current server status
  const serverDetails = await pterodactylService.getServerDetails(server.uuid);

  // Create action selection menu
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_power_action')
    .setPlaceholder('Choose a power action')
    .addOptions([
      {
        label: '🟢 Start Server',
        description: 'Start the server if it\'s stopped',
        value: `start:${server.uuid}`,
      },
      {
        label: '🔴 Stop Server',
        description: 'Gracefully stop the server',
        value: `stop:${server.uuid}`,
      },
      {
        label: '🔄 Restart Server',
        description: 'Restart the server',
        value: `restart:${server.uuid}`,
      },
      {
        label: '⚡ Kill Server',
        description: 'Force stop the server immediately',
        value: `kill:${server.uuid}`,
      }
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('⚡ Server Power Control')
    .setDescription(`Select a power action for server **${server.name}**:`)
    .addFields(
      { name: '🏷️ Server Name', value: server.name, inline: true },
      { name: '📊 Current Status', value: getStatusEmoji(serverDetails.status) + ' ' + serverDetails.status, inline: true },
      { name: '🔗 UUID', value: server.uuid.substring(0, 8) + '...', inline: true }
    )
    .setTimestamp();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row]
  });

  // Wait for selection
  try {
    const selectInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id,
      time: 60000
    });

    const [action, serverUuid] = selectInteraction.values[0].split(':');
    
    await selectInteraction.deferUpdate();
    await executePowerAction(interaction, serverUuid, action, context, pterodactylService);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('time')) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ Selection Timeout')
        .setDescription('Power action selection cancelled due to timeout.')
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

async function showServerSelection(
  interaction: ChatInputCommandInteraction,
  context: any,
  pterodactylService: PterodactylService
) {
  // Set user API key
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);

  // Get user servers
  const servers = await pterodactylService.getUserServers();

  if (servers.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle('📋 No Servers Found')
      .setDescription('You don\'t have any servers to manage.')
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Create select menu for servers
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_server_power')
    .setPlaceholder('Choose a server to manage')
    .addOptions(
      servers.slice(0, 25).map(server => ({
        label: server.name,
        description: `Status: ${server.status} | UUID: ${server.uuid.substring(0, 8)}...`,
        value: server.uuid,
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('⚡ Server Power Management')
    .setDescription('Select a server to manage its power state:')
    .addFields(
      servers.slice(0, 10).map(server => ({
        name: server.name,
        value: `**Status:** ${getStatusEmoji(server.status)} ${server.status}\n**UUID:** \`${server.uuid}\``,
        inline: true
      }))
    )
    .setTimestamp();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row]
  });

  // Wait for selection
  try {
    const selectInteraction = await response.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id,
      time: 60000
    });

    const selectedServerUuid = selectInteraction.values[0];
    
    await selectInteraction.deferUpdate();
    await showActionSelection(interaction, selectedServerUuid, context, pterodactylService);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('time')) {
      const timeoutEmbed = new EmbedBuilder()
        .setColor('Orange')
        .setTitle('⏰ Selection Timeout')
        .setDescription('Server selection cancelled due to timeout.')
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

export async function executePrefix(
  message: Message,
  args: string[],
  authService: AuthService,
  pterodactylService: PterodactylService
) {
  try {
    // Check if user is authenticated
    const context = await authService.requireAuth(message.author, message.member as any);
    
    if (args.length === 0) {
      // Show usage information
      const embed = new EmbedBuilder()
        .setColor('Blue')
        .setTitle('⚡ Server Power Management')
        .setDescription('Control the power state of your servers.')
        .addFields(
          { 
            name: 'Usage', 
            value: '`!power <server_id> <action>`\nor\n`!power <server_id>` (to select action)\nor\n`!power` (to select server)',
            inline: false 
          },
          { 
            name: 'Available Actions', 
            value: '• `start` - 🟢 Start the server\n• `stop` - 🔴 Stop the server\n• `restart` - 🔄 Restart the server\n• `kill` - ⚡ Force stop the server',
            inline: false 
          },
          { 
            name: 'Examples', 
            value: '`!power MyServer start`\n`!power 12345678 restart`\n`!power MyServer` (shows action menu)',
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

    if (args.length === 1) {
      // Server ID provided, show action selection
      const serverId = args[0];
      await executePrefixActionSelection(message, serverId, context, pterodactylService);
    } else if (args.length >= 2) {
      // Both server ID and action provided
      const serverId = args[0];
      const action = args[1].toLowerCase();
      
      // Validate action
      const validActions = ['start', 'stop', 'restart', 'kill'];
      if (!validActions.includes(action)) {
        const embed = new EmbedBuilder()
          .setColor('Red')
          .setTitle('❌ Invalid Action')
          .setDescription(`Invalid power action: \`${action}\``)
          .addFields(
            { 
              name: 'Valid Actions', 
              value: validActions.map(a => `• \`${a}\` - ${getActionEmoji(a)} ${getActionName(a)}`).join('\n'),
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

      await executePrefixPowerAction(message, serverId, action, context, pterodactylService);
    }

  } catch (error) {
    if (error instanceof UserError) {
      Logger.warn('Error in power command (prefix):', error);
    } else {
      Logger.error('Error in power command (prefix):', error);
    }
    
    const errorMessage = error instanceof Error ? error.message : 'An error occurred while managing server power.';
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ Error')
      .setDescription(errorMessage)
      .setTimestamp();

    await message.reply({ 
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  }
}

async function executePrefixPowerAction(
  message: Message,
  serverId: string,
  action: string,
  context: any,
  pterodactylService: PterodactylService
) {
  // Set user API key
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
  
  // Get user's servers and verify ownership
  const userServers = await pterodactylService.getUserServers();
  const server = userServers.find(s => 
    s.uuid === serverId || 
    s.id?.toString() === serverId ||
    s.uuid.startsWith(serverId) || 
    s.name.toLowerCase() === serverId.toLowerCase()
  );

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ Server Not Found')
      .setDescription(`Server with identifier \`${serverId}\` was not found or doesn't belong to you.`)
      .addFields(
        { 
          name: '💡 Tip', 
          value: 'Use `!power` without parameters to see your available servers, or use `!servers` to list all your servers.',
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

  // Execute power action
  const processingEmbed = new EmbedBuilder()
    .setColor('Yellow')
    .setTitle('⏳ Processing...')
    .setDescription(`Executing ${getActionEmoji(action)} **${getActionName(action)}** on server **${server.name}**...`)
    .setTimestamp();
  const processingMessage = await message.reply({ 
    embeds: [processingEmbed],
    allowedMentions: { repliedUser: false }
  });

  try {
    await pterodactylService.sendPowerAction(server.uuid, action as 'start' | 'stop' | 'restart' | 'kill');

    // Get updated server status
    const updatedServer = await pterodactylService.getServerDetails(server.uuid);
    
    const successEmbed = new EmbedBuilder()
      .setColor('Green')
      .setTitle('✅ Power Action Completed')
      .setDescription(`Successfully executed **${getActionName(action)}** on server **${server.name}**.`)
      .addFields(
        { name: '🏷️ Server Name', value: server.name, inline: true },
        { name: '📊 Status', value: getStatusEmoji(updatedServer.status) + ' ' + updatedServer.status, inline: true },
        { name: '⚡ Action', value: `${getActionEmoji(action)} ${getActionName(action)}`, inline: true }
      )
      .setTimestamp();

    await processingMessage.edit({ embeds: [successEmbed] });

    Logger.info(`User ${message.author.tag} executed ${action} on server: ${server.name} (${server.uuid})`);

  } catch (error) {
    Logger.error('Error executing power action:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ Power Action Failed')
      .setDescription(`Failed to execute **${getActionName(action)}** on server **${server.name}**.`)
      .addFields(
        { 
          name: '🔍 Error Details', 
          value: error instanceof Error ? error.message : 'Unknown error occurred',
          inline: false 
        }
      )
      .setTimestamp();

    await processingMessage.edit({ embeds: [errorEmbed] });
  }
}

async function executePrefixActionSelection(
  message: Message,
  serverId: string,
  context: any,
  pterodactylService: PterodactylService
) {
  // Set user API key
  pterodactylService.setUserApiKey(context.user.pterodactyl_api_key);
  
  // Get user's servers and verify ownership
  const userServers = await pterodactylService.getUserServers();
  const server = userServers.find(s => 
    s.uuid === serverId || 
    s.id?.toString() === serverId ||
    s.uuid.startsWith(serverId) || 
    s.name.toLowerCase() === serverId.toLowerCase()
  );

  if (!server) {
    const embed = new EmbedBuilder()
      .setColor('Red')
      .setTitle('❌ Server Not Found')
      .setDescription(`Server with identifier \`${serverId}\` was not found or doesn't belong to you.`)
      .addFields(
        { 
          name: '💡 Tip', 
          value: 'Use `!power` without parameters to see your available servers, or use `!servers` to list all your servers.',
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

  // Get current server status
  const serverDetails = await pterodactylService.getServerDetails(server.uuid);

  const embed = new EmbedBuilder()
    .setColor('Blue')
    .setTitle('⚡ Server Power Control')
    .setDescription(`Select a power action for server **${server.name}** by replying with the action:`)
    .addFields(
      { name: '🏷️ Server Name', value: server.name, inline: true },
      { name: '📊 Current Status', value: getStatusEmoji(serverDetails.status) + ' ' + serverDetails.status, inline: true },
      { name: '🔗 UUID', value: server.uuid.substring(0, 8) + '...', inline: true },
      { 
        name: 'Available Actions', 
        value: '• `start` - 🟢 Start the server\n• `stop` - 🔴 Stop the server\n• `restart` - 🔄 Restart the server\n• `kill` - ⚡ Force stop the server',
        inline: false 
      },
      { 
        name: 'Usage', 
        value: `\`!power ${serverId} <action>\`\nExample: \`!power ${serverId} start\``,
        inline: false 
      }
    )
    .setTimestamp();

  await message.reply({ 
    embeds: [embed],
    allowedMentions: { repliedUser: false }
  });
}

// Utility functions
function getActionEmoji(action: string): string {
  switch (action) {
    case 'start': return '🟢';
    case 'stop': return '🔴';
    case 'restart': return '🔄';
    case 'kill': return '⚡';
    default: return '❓';
  }
}

function getActionName(action: string): string {
  switch (action) {
    case 'start': return 'Start';
    case 'stop': return 'Stop';
    case 'restart': return 'Restart';
    case 'kill': return 'Kill (Force Stop)';
    default: return 'Unknown';
  }
}

function getStatusEmoji(status: string): string {
  switch (status?.toLowerCase()) {
    case 'running': return '🟢';
    case 'offline': return '🔴';
    case 'starting': return '🟡';
    case 'stopping': return '🟠';
    default: return '⚫';
  }
}
