import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { IDatabaseManager } from './interfaces/IDatabaseManager';
import { IModerationPipeline } from './interfaces/IModerationPipeline';
import { ILogger } from './interfaces/ILogger';
import { IDiscordEventHandler } from './interfaces/IDiscordEventHandler';
import { IModerationLogService } from './interfaces/IModerationLogService';
import { BotConfig } from '../database/DatabaseManager';

export class GreatshieldBot {
  private client: Client;
  private isRunning = false;

  constructor(
    private config: BotConfig,
    private db: IDatabaseManager,
    private moderationPipeline: IModerationPipeline,
    private logger: ILogger,
    private eventHandler: IDiscordEventHandler,
    private moderationLogService: IModerationLogService
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration
      ]
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('ready', this.onReady.bind(this));
    this.client.on('messageCreate', this.eventHandler.handleMessage.bind(this.eventHandler));
    this.client.on('messageUpdate', this.eventHandler.handleMessageUpdate.bind(this.eventHandler));
    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isCommand()) {
        await this.eventHandler.handleInteraction(interaction);
      }
    });
    this.client.on('error', this.onError.bind(this));
  }

  private async onReady(): Promise<void> {
    if (!this.client.user) {
      throw new Error('Client user not available');
    }

    this.logger.info('Bot ready', {
      username: this.client.user.username,
      discriminator: this.client.user.discriminator,
      guildCount: this.client.guilds.cache.size,
      userCount: this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)
    });

    console.log(`Greatshield is online as ${this.client.user.username}#${this.client.user.discriminator}`);

    // Configuration is already loaded via constructor
    console.log(`Using configuration for guild: ${this.client.guilds.cache.get(this.config.guild_id)?.name || this.config.guild_id}`);

    // Initialize moderation pipeline
    await this.moderationPipeline.initialize(this.config);

    // Register slash commands
    await this.registerSlashCommands();
  }

  private onError(error: Error): void {
    this.logger.error('Discord client error', {
      error: error.message,
      stack: error.stack
    });
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.client.user?.id || !process.env['DISCORD_TOKEN']) {
      this.logger.warn('Cannot register slash commands: missing client ID or token');
      return;
    }

    try {
      const rest = new REST({ version: '10' }).setToken(process.env['DISCORD_TOKEN']);

      const commands = [
        {
          name: 'status',
          description: 'Check the status of Greatshield moderation bot'
        },
        {
          name: 'policy',
          description: 'View available policy packs and current configuration'
        },
        {
          name: 'logs',
          description: 'View recent moderation logs (admin only)'
        }
      ];

      await rest.put(
        Routes.applicationCommands(this.client.user.id),
        { body: commands }
      );

      this.logger.info('Successfully registered slash commands', {
        commandCount: commands.length
      });

    } catch (error) {
      this.logger.error('Failed to register slash commands', {
        error: String(error)
      });
    }
  }

  async start(token: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Bot is already running');
    }

    try {
      await this.client.login(token);
      this.isRunning = true;

      this.logger.info('Bot started successfully', {
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      this.logger.error('Failed to start bot', {
        error: String(error)
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.logger.info('Shutting down bot gracefully');

      // Close database connection
      await this.db.close();

      // Destroy Discord client
      this.client.destroy();

      this.isRunning = false;

      this.logger.info('Bot shut down successfully');

    } catch (error) {
      this.logger.error('Error during bot shutdown', {
        error: String(error)
      });
      throw error;
    }
  }

  getClient(): Client {
    return this.client;
  }

  getConfig(): BotConfig {
    return this.config;
  }

  isReady(): boolean {
    return this.isRunning && this.client.readyAt !== null;
  }

  async reloadConfig(): Promise<void> {
    try {
      const newConfig = await this.db.getBotConfig(this.config.guild_id);
      if (newConfig) {
        this.config = newConfig;
        await this.moderationPipeline.initialize(newConfig);
        
        this.logger.info('Configuration reloaded', {
          guildId: this.config.guild_id
        });
      }
    } catch (error) {
      this.logger.error('Failed to reload configuration', {
        error: String(error)
      });
      throw error;
    }
  }
}