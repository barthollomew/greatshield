import { 
  Client, 
  GatewayIntentBits, 
  Collection, 
  Message, 
  SlashCommandBuilder, 
  CommandInteraction,
  TextChannel,
  EmbedBuilder,
  PartialMessage
} from 'discord.js';
import { DatabaseManager, BotConfig, ModerationLog } from '../database/DatabaseManager';
import { OllamaManager } from '../ollama/OllamaManager';
import { ModerationPipeline } from '../moderation/ModerationPipeline';
import { Logger } from '../utils/Logger';
import chalk from 'chalk';

export interface BotCommand {
  data: any;
  execute: (interaction: CommandInteraction, bot: GreatshieldBot) => Promise<void>;
}

export class GreatshieldBot {
  public client: Client;
  public db: DatabaseManager;
  public ollama: OllamaManager;
  public moderationPipeline: ModerationPipeline;
  public logger: Logger;
  public commands: Collection<string, BotCommand>;
  private config: BotConfig | null = null;

  constructor(db: DatabaseManager, ollama: OllamaManager, logger: Logger) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
      ]
    });

    this.db = db;
    this.ollama = ollama;
    this.logger = logger;
    this.commands = new Collection();
    this.moderationPipeline = new ModerationPipeline(db, ollama, logger);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once('ready', this.onReady.bind(this));
    this.client.on('messageCreate', this.onMessage.bind(this));
    this.client.on('messageUpdate', this.onMessageUpdate.bind(this));
    this.client.on('interactionCreate', this.onInteractionCreate.bind(this));
    this.client.on('error', this.onError.bind(this));
    this.client.on('warn', this.onWarning.bind(this));
  }

  private async onReady(): Promise<void> {
    if (!this.client.user) return;

    console.log(chalk.green(`✅ Greatshield is online as ${this.client.user.tag}`));
    this.logger.info(`Bot ready as ${this.client.user.tag}`, {
      guildCount: this.client.guilds.cache.size,
      userCount: this.client.users.cache.size
    });

    // Load configuration
    const guild = this.client.guilds.cache.first();
    if (guild) {
      this.config = await this.db.getBotConfig(guild.id);
      if (this.config) {
        console.log(chalk.blue(`📋 Loaded configuration for guild: ${guild.name}`));
        
        // Initialize moderation pipeline
        await this.moderationPipeline.initialize(this.config);
        
        // Register slash commands
        await this.registerSlashCommands();
      }
    }

    // Set bot status
    this.client.user.setActivity('for harmful content', { type: 3 }); // WATCHING
  }

  private async onMessage(message: Message): Promise<void> {
    // Ignore bot messages and messages without content
    if (message.author.bot || !message.content) return;

    // Ignore messages not in configured guild
    if (!this.config || message.guildId !== this.config.guild_id) return;

    try {
      // Store message in context for RAG
      await this.db.addMessageContext(
        message.channelId,
        message.id,
        message.author.id,
        message.content,
        message.createdAt
      );

      // Run moderation pipeline
      const result = await this.moderationPipeline.moderateMessage(message);

      if (result.actionTaken !== 'none') {
        // Log the moderation action
        const log: ModerationLog = {
          message_id: message.id,
          channel_id: message.channelId,
          guild_id: message.guildId!,
          user_id: message.author.id,
          username: message.author.username,
          message_content: message.content,
          detection_type: result.detectionType,
          rule_triggered: result.ruleTriggered || undefined,
          confidence_scores: JSON.stringify(result.confidenceScores),
          action_taken: result.actionTaken,
          reasoning: result.reasoning || undefined
        };

        await this.db.addModerationLog(log);

        // Send to mod log channel
        await this.sendModerationLog(log, message);

        this.logger.info('Message moderated', {
          messageId: message.id,
          userId: message.author.id,
          action: result.actionTaken,
          reason: result.reasoning
        });
      }

    } catch (error) {
      this.logger.error('Error moderating message', { 
        error: String(error), 
        messageId: message.id 
      });
    }
  }

  private async onMessageUpdate(_oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> {
    // Treat message edits as new messages for moderation
    if (newMessage.partial) {
      try {
        await newMessage.fetch();
      } catch (error) {
        this.logger.error('Failed to fetch partial message', { error: String(error) });
        return;
      }
    }

    if (newMessage instanceof Message) {
      await this.onMessage(newMessage);
    }
  }

  private async onInteractionCreate(interaction: any): Promise<void> {
    if (!interaction.isCommand()) return;

    const command = this.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, this);
    } catch (error) {
      this.logger.error('Error executing command', {
        command: interaction.commandName,
        user: interaction.user.id,
        error: String(error)
      });

      const errorMessage = 'There was an error executing this command!';
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  }

  private onError(error: Error): void {
    this.logger.error('Discord client error', { error: error.message, stack: error.stack });
    console.error(chalk.red('Discord Error:'), error);
  }

  private onWarning(warning: string): void {
    this.logger.warn('Discord client warning', { warning });
    console.warn(chalk.yellow('Discord Warning:'), warning);
  }

  private async sendModerationLog(log: ModerationLog, _originalMessage: Message): Promise<void> {
    if (!this.config?.mod_log_channel_id) return;

    try {
      const logChannel = await this.client.channels.fetch(this.config.mod_log_channel_id) as TextChannel;
      if (!logChannel) return;

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Moderation Action Taken')
        .setColor(this.getActionColor(log.action_taken))
        .setTimestamp()
        .addFields([
          {
            name: '👤 User',
            value: `<@${log.user_id}> (${log.username})`,
            inline: true
          },
          {
            name: '📍 Channel',
            value: `<#${log.channel_id}>`,
            inline: true
          },
          {
            name: '⚡ Action',
            value: log.action_taken,
            inline: true
          },
          {
            name: '🔍 Detection Type',
            value: log.detection_type === 'fast_pass' ? 'Fast Pass Filter' : 'AI Analysis',
            inline: true
          },
          {
            name: '📜 Rule Triggered',
            value: log.rule_triggered || 'N/A',
            inline: true
          },
          {
            name: '💭 Message Content',
            value: log.message_content.length > 1024 
              ? log.message_content.substring(0, 1021) + '...'
              : log.message_content,
            inline: false
          }
        ]);

      if (log.reasoning) {
        embed.addFields([
          {
            name: '🤖 AI Reasoning',
            value: log.reasoning.length > 1024 
              ? log.reasoning.substring(0, 1021) + '...'
              : log.reasoning,
            inline: false
          }
        ]);
      }

      if (log.confidence_scores) {
        const scores = JSON.parse(log.confidence_scores);
        const scoreText = Object.entries(scores)
          .map(([key, value]) => `${key}: ${(value as number * 100).toFixed(1)}%`)
          .join(', ');
        
        embed.addFields([
          {
            name: '📊 Confidence Scores',
            value: scoreText,
            inline: false
          }
        ]);
      }

      embed.addFields([
        {
          name: '🔗 Original Message',
          value: `[Jump to message](https://discord.com/channels/${log.guild_id}/${log.channel_id}/${log.message_id})`,
          inline: false
        }
      ]);

      await logChannel.send({ embeds: [embed] });

    } catch (error) {
      this.logger.error('Failed to send moderation log', { 
        error: String(error),
        logId: log.id 
      });
    }
  }

  private getActionColor(action: string): number {
    switch (action) {
      case 'mask': return 0xFFAA00; // Orange
      case 'delete_warn': return 0xFF4444; // Red
      case 'shadowban': return 0x8B0000; // Dark Red
      case 'escalate': return 0xFF0000; // Bright Red
      default: return 0x808080; // Gray
    }
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.client.application || !this.config) return;

    const commands = [
      new SlashCommandBuilder()
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
        .toJSON()
    ];

    try {
      await this.client.application.commands.set(commands, this.config.guild_id);
      console.log(chalk.green('✅ Slash commands registered successfully'));
    } catch (error) {
      this.logger.error('Failed to register slash commands', { error: String(error) });
      console.error(chalk.red('Failed to register slash commands:'), error);
    }
  }

  public async start(token: string): Promise<void> {
    try {
      await this.client.login(token);
    } catch (error) {
      this.logger.error('Failed to start bot', { error: String(error) });
      throw new Error(`Failed to start bot: ${error}`);
    }
  }

  public async stop(): Promise<void> {
    console.log(chalk.yellow('🛑 Stopping Greatshield...'));
    this.logger.info('Bot shutting down');
    
    try {
      this.client.destroy();
      await this.db.close();
      console.log(chalk.green('✅ Greatshield stopped successfully'));
    } catch (error) {
      this.logger.error('Error during shutdown', { error: String(error) });
      console.error(chalk.red('Error during shutdown:'), error);
    }
  }

  public getStatus(): {
    botReady: boolean;
    guildCount: number;
    userCount: number;
    uptime: number;
    config: BotConfig | null;
  } {
    return {
      botReady: this.client.readyAt !== null,
      guildCount: this.client.guilds.cache.size,
      userCount: this.client.users.cache.size,
      uptime: this.client.uptime || 0,
      config: this.config
    };
  }
}