import { 
  SlashCommandBuilder, 
  CommandInteraction, 
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { BotCommand, GreatshieldBot } from '../GreatshieldBot';

export const GuardianCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('guardian')
    .setDescription('Greatshield moderation commands')
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Check bot status and health')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('appeal')
        .setDescription('Appeal a moderation action')
        .addStringOption(option =>
          option.setName('message_link')
            .setDescription('Link to the moderated message')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('reason')
            .setDescription('Reason for the appeal')
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction: CommandInteraction, bot: GreatshieldBot): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'status':
        await handleStatus(interaction, bot);
        break;
      case 'appeal':
        await handleAppeal(interaction, bot);
        break;
      default:
        await interaction.reply({ 
          content: 'Unknown subcommand!', 
          ephemeral: true 
        });
    }
  }
};

async function handleStatus(interaction: CommandInteraction, bot: GreatshieldBot): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    // Get bot status
    const botStatus = bot.getStatus();
    
    // Get Ollama health
    const ollamaHealth = await bot.ollama.healthCheck();
    
    // Get database stats (if available)
    const activePolicyPack = await bot.db.getActivePolicyPack();
    
    const embed = new EmbedBuilder()
      .setTitle('Greatshield Status')
      .setColor(botStatus.botReady ? 0x00FF00 : 0xFF0000)
      .setTimestamp()
      .addFields([
        {
          name: 'Bot Status',
          value: botStatus.botReady ? 'Online' : 'Offline',
          inline: true
        },
        {
          name: 'Uptime',
          value: botStatus.uptime > 0 ? formatUptime(botStatus.uptime) : 'N/A',
          inline: true
        },
        {
          name: 'Guilds',
          value: botStatus.guildCount.toString(),
          inline: true
        },
        {
          name: 'Users',
          value: botStatus.userCount.toString(),
          inline: true
        },
        {
          name: 'Ollama Status',
          value: ollamaHealth.isRunning ? 
            `Running (${ollamaHealth.modelsAvailable} models)` : 
            'Offline',
          inline: true
        },
        {
          name: 'Ollama Host',
          value: ollamaHealth.host,
          inline: true
        }
      ]);

    if (botStatus.config) {
      embed.addFields([
        {
          name: 'Selected Model',
          value: botStatus.config.selected_model || 'Not set',
          inline: true
        },
        {
          name: 'Policy Pack',
          value: activePolicyPack ? activePolicyPack.name : 'Not set',
          inline: true
        },
        {
          name: 'Mod Log Channel',
          value: botStatus.config.mod_log_channel_id ? 
            `<#${botStatus.config.mod_log_channel_id}>` : 
            'Not set',
          inline: true
        }
      ]);
    }

    if (!ollamaHealth.isRunning && ollamaHealth.error) {
      embed.addFields([
        {
          name: 'Ollama Error',
          value: ollamaHealth.error,
          inline: false
        }
      ]);
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    await interaction.editReply({ 
      content: `Error getting status: ${error}` 
    });
  }
}

async function handleAppeal(interaction: CommandInteraction, bot: GreatshieldBot): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });

  try {
    const messageLink = interaction.options.getString('message_link', true);
    const reason = interaction.options.getString('reason', true);

    // Extract message ID from the link
    const messageLinkRegex = /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
    const match = messageLink.match(messageLinkRegex);

    if (!match) {
      await interaction.editReply({ 
        content: 'Invalid message link format. Please provide a valid Discord message link.' 
      });
      return;
    }

    const [, _guildId, channelId, messageId] = match;

    // Check if the message was actually moderated
    const moderationLog = await bot.db.getModerationLogByMessageId(messageId!);

    if (!moderationLog) {
      await interaction.editReply({ 
        content: 'No moderation action found for this message.' 
      });
      return;
    }

    // Check if already appealed
    if (moderationLog.is_appeal) {
      await interaction.editReply({ 
        content: `This message has already been appealed. Status: ${moderationLog.appeal_status}` 
      });
      return;
    }

    // Create appeal log entry
    const appealLog = {
      ...moderationLog,
      is_appeal: true,
      appeal_reason: reason,
      appeal_status: 'pending' as const,
      moderator_id: interaction.user.id
    };

    await bot.db.addModerationLog(appealLog);

    // Create appeal embed for mod log
    const embed = new EmbedBuilder()
      .setTitle('Moderation Appeal Submitted')
      .setColor(0x0099FF)
      .setTimestamp()
      .addFields([
        {
          name: 'Appealed by',
          value: `<@${interaction.user.id}>`,
          inline: true
        },
        {
          name: 'Original Channel',
          value: `<#${channelId}>`,
          inline: true
        },
        {
          name: 'Original Action',
          value: moderationLog.action_taken,
          inline: true
        },
        {
          name: 'Appeal Reason',
          value: reason,
          inline: false
        },
        {
          name: 'Original Message',
          value: moderationLog.message_content.length > 500 
            ? moderationLog.message_content.substring(0, 497) + '...'
            : moderationLog.message_content,
          inline: false
        },
        {
          name: 'Message Link',
          value: messageLink,
          inline: false
        }
      ]);

    // Send to mod log channel
    const config = bot.getStatus().config;
    if (config?.mod_log_channel_id) {
      try {
        const logChannel = await bot.client.channels.fetch(config.mod_log_channel_id);
        if (logChannel && logChannel.isTextBased() && 'send' in logChannel) {
          await logChannel.send({ embeds: [embed] });
        }
      } catch (error) {
        bot.logger.error('Failed to send appeal to mod log', { error: String(error) });
      }
    }

    await interaction.editReply({ 
      content: 'Your appeal has been submitted and will be reviewed by moderators.' 
    });

    bot.logger.info('Moderation appeal submitted', {
      appealedBy: interaction.user.id,
      originalMessageId: messageId,
      reason: reason
    });

  } catch (error) {
    bot.logger.error('Error processing appeal', { error: String(error) });
    await interaction.editReply({ 
      content: 'An error occurred while processing your appeal. Please try again later.' 
    });
  }
}

function formatUptime(uptime: number): string {
  const seconds = Math.floor((uptime / 1000) % 60);
  const minutes = Math.floor((uptime / (1000 * 60)) % 60);
  const hours = Math.floor((uptime / (1000 * 60 * 60)) % 24);
  const days = Math.floor(uptime / (1000 * 60 * 60 * 24));

  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0) result += `${seconds}s`;

  return result.trim() || '0s';
}