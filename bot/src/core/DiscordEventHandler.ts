import { Message, CommandInteraction, EmbedBuilder } from 'discord.js';
import { IDiscordEventHandler } from './interfaces/IDiscordEventHandler';
import { IModerationPipeline } from './interfaces/IModerationPipeline';
import { ILogger } from './interfaces/ILogger';
import { IDatabaseManager } from './interfaces/IDatabaseManager';
import { IModerationLogService } from './interfaces/IModerationLogService';

export class DiscordEventHandler implements IDiscordEventHandler {
  constructor(
    private moderationPipeline: IModerationPipeline,
    private logger: ILogger,
    private db: IDatabaseManager,
    private moderationLogService: IModerationLogService
  ) {}

  async handleMessage(message: Message): Promise<void> {
    // Skip bot messages and system messages
    if (message.author.bot || message.system) {
      return;
    }

    // Skip messages without content
    if (!message.content || message.content.trim().length === 0) {
      return;
    }

    try {
      this.logger.debug('Processing message', {
        messageId: message.id,
        userId: message.author.id,
        channelId: message.channel.id,
        contentLength: message.content.length
      });

      // Store message context for RAG
      await this.db.addMessageContext(
        message.channel.id,
        message.id,
        message.author.id,
        message.content,
        message.createdAt
      );

      // Run moderation pipeline
      const result = await this.moderationPipeline.moderateMessage(message);
      
      if (result) {
        this.logger.info('Moderation action taken', {
          messageId: message.id,
          userId: message.author.id,
          action: result.action,
          reason: result.reason,
          confidence: result.confidence,
          ruleTriggered: result.ruleTriggered,
          detectionType: result.detectionType
        });

        // Log to database
        const logId = await this.db.addModerationLog({
          message_id: message.id,
          channel_id: message.channel.id,
          guild_id: message.guildId!,
          user_id: message.author.id,
          username: message.author.username,
          message_content: message.content,
          detection_type: result.detectionType,
          rule_triggered: result.ruleTriggered,
          confidence_scores: result.confidence ? JSON.stringify({ overall: result.confidence }) : '',
          action_taken: result.action,
          reasoning: result.reason,
          is_appeal: false
        });

        // Send moderation log
        await this.moderationLogService.sendModerationLog({
          id: logId,
          message_id: message.id,
          channel_id: message.channel.id,
          guild_id: message.guildId!,
          user_id: message.author.id,
          username: message.author.username,
          message_content: message.content,
          detection_type: result.detectionType,
          rule_triggered: result.ruleTriggered,
          confidence_scores: result.confidence ? JSON.stringify({ overall: result.confidence }) : '',
          action_taken: result.action,
          reasoning: result.reason,
          is_appeal: false
        }, message);
      }

    } catch (error) {
      this.logger.error('Error processing message', {
        error: String(error),
        messageId: message.id,
        userId: message.author.id
      });
    }
  }

  async handleMessageUpdate(oldMessage: Message, newMessage: Message): Promise<void> {
    // Skip bot messages and system messages
    if (newMessage.author.bot || newMessage.system) {
      return;
    }

    // Skip if content hasn't changed
    if (oldMessage.content === newMessage.content) {
      return;
    }

    this.logger.debug('Message updated, processing', {
      messageId: newMessage.id,
      userId: newMessage.author.id,
      oldContentLength: oldMessage.content?.length || 0,
      newContentLength: newMessage.content?.length || 0
    });

    // Process the updated message
    await this.handleMessage(newMessage);
  }

  async handleInteraction(interaction: CommandInteraction): Promise<void> {
    if (!interaction.isCommand()) {
      return;
    }

    try {
      this.logger.debug('Processing command interaction', {
        commandName: interaction.commandName,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      switch (interaction.commandName) {
        case 'status':
          await this.handleStatusCommand(interaction);
          break;
        case 'policy':
          await this.handlePolicyCommand(interaction);
          break;
        case 'logs':
          await this.handleLogsCommand(interaction);
          break;
        default:
          await interaction.reply({
            content: 'Unknown command.',
            ephemeral: true
          });
      }
    } catch (error) {
      this.logger.error('Error handling interaction', {
        error: String(error),
        commandName: interaction.commandName,
        userId: interaction.user.id
      });

      try {
        const errorMessage = 'An error occurred while processing your command.';
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      } catch (replyError) {
        this.logger.error('Failed to send error response', {
          error: String(replyError),
          originalError: String(error)
        });
      }
    }
  }

  private async handleStatusCommand(interaction: CommandInteraction): Promise<void> {
    try {
      const config = await this.db.getBotConfig(interaction.guildId!);
      const activePolicyPack = await this.db.getActivePolicyPack();

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Greatshield Status')
        .setColor(0x00ff00)
        .addFields(
          { name: 'Status', value: '✅ Online', inline: true },
          { name: 'Active Policy', value: activePolicyPack?.name || 'None', inline: true },
          { name: 'AI Model', value: config?.selected_model || 'Not configured', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      throw error;
    }
  }

  private async handlePolicyCommand(interaction: CommandInteraction): Promise<void> {
    try {
      const policyPacks = await this.db.getPolicyPacks();

      const embed = new EmbedBuilder()
        .setTitle('📋 Policy Packs')
        .setColor(0x0099ff);

      if (policyPacks.length === 0) {
        embed.setDescription('No policy packs found.');
      } else {
        const description = policyPacks.map(pack => 
          `${pack.is_active ? '✅' : '⚪'} **${pack.name}**\n${pack.description || 'No description'}`
        ).join('\n\n');
        
        embed.setDescription(description);
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      throw error;
    }
  }

  private async handleLogsCommand(interaction: CommandInteraction): Promise<void> {
    // This would implement a logs viewing command
    await interaction.reply({
      content: 'Logs command not yet implemented.',
      ephemeral: true
    });
  }
}