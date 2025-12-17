import { Client, EmbedBuilder, TextChannel, Message } from 'discord.js';
import { IModerationLogService } from './interfaces/IModerationLogService';
import { ModerationLog, BotConfig } from '../database/DatabaseManager';
import { ILogger } from './interfaces/ILogger';

export class ModerationLogService implements IModerationLogService {
  constructor(
    private client: Client,
    private config: BotConfig,
    private logger: ILogger
  ) {}

  async sendModerationLog(log: ModerationLog, originalMessage: Message): Promise<void> {
    if (!this.config.mod_log_channel_id) {
      this.logger.warn('No moderation log channel configured');
      return;
    }

    try {
      const logChannel = this.client.channels.cache.get(this.config.mod_log_channel_id) as TextChannel;
      if (!logChannel) {
        this.logger.error('Moderation log channel not found', {
          channelId: this.config.mod_log_channel_id
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('Moderation Action')
        .setColor(this.getColorForAction(log.action_taken))
        .addFields(
          { name: 'User', value: `<@${log.user_id}> (${log.username})`, inline: true },
          { name: 'Channel', value: `<#${log.channel_id}>`, inline: true },
          { name: 'Action', value: log.action_taken, inline: true },
          { name: 'Detection Type', value: log.detection_type === 'fast_pass' ? 'Fast Pass' : 'AI Analysis', inline: true },
          { name: 'Message Content', value: this.truncateContent(log.message_content), inline: false }
        );

      if (log.rule_triggered) {
        embed.addFields({ name: 'Rule Triggered', value: log.rule_triggered, inline: true });
      }

      if (log.confidence_scores) {
        try {
          const scores = JSON.parse(log.confidence_scores);
          const scoreText = Object.entries(scores)
            .map(([key, value]) => `${key}: ${typeof value === 'number' ? (value * 100).toFixed(1) + '%' : value}`)
            .join('\n');
          embed.addFields({ name: 'Confidence Scores', value: scoreText, inline: true });
        } catch (error) {
          this.logger.warn('Failed to parse confidence scores', { 
            error: String(error), 
            scores: log.confidence_scores 
          });
        }
      }

      if (log.reasoning) {
        embed.addFields({ name: 'Reasoning', value: this.truncateContent(log.reasoning), inline: false });
      }

      embed
        .addFields({ name: 'Message ID', value: log.message_id, inline: true })
        .setTimestamp()
        .setFooter({ text: `Log ID: ${log.id}` });

      await logChannel.send({ embeds: [embed] });

      this.logger.debug('Moderation log sent', {
        logId: log.id,
        messageId: log.message_id,
        action: log.action_taken
      });

    } catch (error) {
      this.logger.error('Failed to send moderation log', {
        error: String(error),
        logId: log.id,
        channelId: this.config.mod_log_channel_id
      });
    }
  }

  private getColorForAction(action: string): number {
    switch (action.toLowerCase()) {
      case 'delete_warn':
      case 'delete':
        return 0xff4444; // Red
      case 'shadowban':
      case 'escalate':
        return 0xff8800; // Orange
      case 'mask':
        return 0xffff00; // Yellow
      case 'warn':
        return 0x88ff88; // Light green
      default:
        return 0x666666; // Gray
    }
  }

  private truncateContent(content: string, maxLength: number = 1000): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength - 3) + '...';
  }
}