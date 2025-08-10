import { 
  Message, 
  TextChannel, 
  EmbedBuilder, 
  PermissionFlagsBits,
  User,
  GuildMember 
} from 'discord.js';
import { Logger } from '../../utils/Logger.js';

export interface ActionResult {
  success: boolean;
  action: string;
  reason?: string;
  error?: string;
}

export class ModerationActions {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async executeAction(
    action: string,
    message: Message,
    reason: string,
    confidence?: number
  ): Promise<ActionResult> {
    try {
      switch (action) {
        case 'mask':
          return await this.maskMessage(message, reason);
        case 'delete_warn':
          return await this.deleteAndWarn(message, reason);
        case 'shadowban':
          return await this.shadowbanUser(message, reason);
        case 'escalate':
          return await this.escalateToModerators(message, reason, confidence);
        default:
          return {
            success: false,
            action: action,
            error: `Unknown action: ${action}`
          };
      }
    } catch (error) {
      this.logger.error('Error executing moderation action', {
        action,
        messageId: message.id,
        error: String(error)
      });

      return {
        success: false,
        action: action,
        error: String(error)
      };
    }
  }

  private async maskMessage(message: Message, reason: string): Promise<ActionResult> {
    try {
      // Replace the message content with a masked version
      const maskedContent = this.createMaskedContent(message.content);

      // Since we can't edit user messages, we'll delete and post a replacement
      await message.delete();

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Content Masked')
        .setDescription(`A message from <@${message.author.id}> was automatically masked`)
        .addFields([
          {
            name: '📝 Original Content (Masked)',
            value: maskedContent,
            inline: false
          },
          {
            name: '🤖 Reason',
            value: reason,
            inline: false
          }
        ])
        .setColor(0xFFAA00)
        .setTimestamp()
        .setFooter({ 
          text: 'This message was automatically moderated by Greatshield',
          iconURL: message.client.user?.avatarURL() ?? undefined
        });

      await message.channel.send({ embeds: [embed] });

      return {
        success: true,
        action: 'mask',
        reason: 'Message content masked due to policy violation'
      };

    } catch (error) {
      return {
        success: false,
        action: 'mask',
        error: `Failed to mask message: ${error}`
      };
    }
  }

  private async deleteAndWarn(message: Message, reason: string): Promise<ActionResult> {
    try {
      const user = message.author;
      const channel = message.channel;

      // Delete the message
      await message.delete();

      // Send warning to the channel
      const warningEmbed = new EmbedBuilder()
        .setTitle('⚠️ Message Deleted')
        .setDescription(`<@${user.id}>, your message was removed for violating community guidelines.`)
        .addFields([
          {
            name: '🤖 Reason',
            value: reason,
            inline: false
          },
          {
            name: '📖 Guidelines',
            value: 'Please review the server rules to avoid future violations.',
            inline: false
          }
        ])
        .setColor(0xFF4444)
        .setTimestamp()
        .setFooter({ 
          text: 'This action was taken automatically by Greatshield',
          iconURL: message.client.user?.avatarURL() ?? undefined
        });

      await channel.send({ embeds: [warningEmbed] });

      // Try to send a DM to the user
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle('📨 Message Removed - Greatshield')
          .setDescription(`Your message in #${(channel as TextChannel).name} was removed.`)
          .addFields([
            {
              name: '💭 Original Message',
              value: message.content.length > 1000 
                ? message.content.substring(0, 1000) + '...'
                : message.content,
              inline: false
            },
            {
              name: '🤖 Reason',
              value: reason,
              inline: false
            },
            {
              name: '❓ Questions?',
              value: 'Contact the server moderators if you believe this was a mistake.',
              inline: false
            }
          ])
          .setColor(0xFF4444)
          .setTimestamp();

        await user.send({ embeds: [dmEmbed] });
      } catch (dmError) {
        // User has DMs disabled, that's okay
        this.logger.debug('Could not send DM to user', { userId: user.id });
      }

      return {
        success: true,
        action: 'delete_warn',
        reason: 'Message deleted and user warned'
      };

    } catch (error) {
      return {
        success: false,
        action: 'delete_warn',
        error: `Failed to delete and warn: ${error}`
      };
    }
  }

  private async shadowbanUser(message: Message, reason: string): Promise<ActionResult> {
    try {
      const guild = message.guild;
      const member = message.member;

      if (!guild || !member) {
        return {
          success: false,
          action: 'shadowban',
          error: 'Guild or member not found'
        };
      }

      // Delete the triggering message
      await message.delete();

      // Create or find shadowban role
      let shadowbanRole = guild.roles.cache.find(role => role.name === 'Greatshield-Shadowban');
      
      if (!shadowbanRole) {
        shadowbanRole = await guild.roles.create({
          name: 'Greatshield-Shadowban',
          color: 0x2C2F33,
          reason: 'Greatshield shadowban role'
        });

        // Configure role permissions for all channels
        for (const channel of guild.channels.cache.values()) {
          if (channel.isTextBased() && 'permissionOverwrites' in channel) {
            await (channel as any).permissionOverwrites.create(shadowbanRole, {
              SendMessages: false,
              AddReactions: false,
              Speak: false,
              UseVAD: false
            });
          }
        }
      }

      // Add shadowban role to member
      await member.roles.add(shadowbanRole);

      // Log the action
      const _logEmbed = new EmbedBuilder()
        .setTitle('👻 User Shadowbanned')
        .setDescription(`<@${message.author.id}> has been automatically shadowbanned.`)
        .addFields([
          {
            name: '🤖 Reason',
            value: reason,
            inline: false
          },
          {
            name: '⏱️ Duration',
            value: 'Until manually reviewed by moderators',
            inline: false
          }
        ])
        .setColor(0x8B0000)
        .setTimestamp()
        .setFooter({ 
          text: 'Automatic action by Greatshield',
          iconURL: message.client.user?.avatarURL() ?? undefined
        });

      // Find mod log channel and send notification
      // This would be sent to the mod log channel configured in the bot
      
      return {
        success: true,
        action: 'shadowban',
        reason: `User shadowbanned: ${reason}`
      };

    } catch (error) {
      return {
        success: false,
        action: 'shadowban',
        error: `Failed to shadowban user: ${error}`
      };
    }
  }

  private async escalateToModerators(
    message: Message, 
    reason: string, 
    confidence?: number
  ): Promise<ActionResult> {
    try {
      const guild = message.guild;
      if (!guild) {
        return {
          success: false,
          action: 'escalate',
          error: 'Guild not found'
        };
      }

      // Create high-priority alert embed
      const alertEmbed = new EmbedBuilder()
        .setTitle('🚨 HIGH PRIORITY: Moderation Escalation')
        .setDescription('A message requires immediate moderator attention.')
        .addFields([
          {
            name: '👤 User',
            value: `<@${message.author.id}> (${message.author.tag})`,
            inline: true
          },
          {
            name: '📍 Channel',
            value: `<#${message.channelId}>`,
            inline: true
          },
          {
            name: '🔗 Message Link',
            value: `[Jump to Message](https://discord.com/channels/${guild.id}/${message.channelId}/${message.id})`,
            inline: true
          },
          {
            name: '💭 Message Content',
            value: message.content.length > 1000 
              ? message.content.substring(0, 1000) + '...'
              : message.content,
            inline: false
          },
          {
            name: '🤖 AI Analysis',
            value: reason,
            inline: false
          }
        ])
        .setColor(0xFF0000)
        .setTimestamp();

      if (confidence !== undefined) {
        alertEmbed.addFields([
          {
            name: '📊 Confidence',
            value: `${(confidence * 100).toFixed(1)}%`,
            inline: true
          }
        ]);
      }

      // Find moderators or admins to ping
      const moderators = guild.members.cache.filter(member => 
        member.permissions.has(PermissionFlagsBits.ManageMessages) && 
        !member.user.bot
      );

      let mentionText = '';
      if (moderators.size > 0) {
        // Mention up to 3 online moderators
        const onlineMods = moderators.filter(mod => mod.presence?.status === 'online');
        const modsToMention = (onlineMods.size > 0 ? onlineMods : moderators).first(3);
        mentionText = modsToMention.map(mod => `<@${mod.id}>`).join(' ');
      }

      // This would typically be sent to a dedicated mod channel
      // For now, we'll send to the same channel with ephemeral-like behavior
      let escalationMessage: any = null;
      if (message.channel.isTextBased()) {
        escalationMessage = await (message.channel as any).send({
          content: mentionText,
          embeds: [alertEmbed]
        });

        // Auto-delete the escalation message after 10 minutes to reduce clutter
        setTimeout(() => {
          if (escalationMessage) {
            escalationMessage.delete().catch(() => {
              // Message might already be deleted, that's fine
            });
          }
        }, 10 * 60 * 1000);
      }

      return {
        success: true,
        action: 'escalate',
        reason: `Message escalated to moderators: ${reason}`
      };

    } catch (error) {
      return {
        success: false,
        action: 'escalate',
        error: `Failed to escalate to moderators: ${error}`
      };
    }
  }

  private createMaskedContent(originalContent: string): string {
    // Simple masking algorithm - replace potentially offensive content with asterisks
    return originalContent
      .replace(/\b\w+\b/g, (word) => {
        if (word.length <= 3) return word;
        return word[0] + '*'.repeat(word.length - 2) + word[word.length - 1];
      })
      .substring(0, 500); // Limit masked content length
  }

  // Utility method to check if bot has required permissions
  async hasRequiredPermissions(message: Message, action: string): Promise<boolean> {
    const guild = message.guild;
    const botMember = guild?.members.me;
    
    if (!guild || !botMember) return false;

    const channel = message.channel as TextChannel;

    switch (action) {
      case 'mask':
      case 'delete_warn':
        return botMember.permissionsIn(channel).has([
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks
        ]);
      
      case 'shadowban':
        return botMember.permissions.has([
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages
        ]);
      
      case 'escalate':
        return botMember.permissionsIn(channel).has([
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks
        ]);
      
      default:
        return false;
    }
  }
}