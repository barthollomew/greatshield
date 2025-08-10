import { Client } from 'discord.js';
import { DatabaseManager, BotConfig } from '../database/DatabaseManager';
import { OllamaManager } from '../ollama/OllamaManager';
import { Logger } from '../utils/Logger';
import { ModerationPipeline } from '../moderation/ModerationPipeline';
import { GreatshieldBot } from './GreatshieldBotRefactored';
import { DiscordEventHandler } from './DiscordEventHandler';
import { ModerationLogService } from './ModerationLogService';

// Service tokens
const TOKENS = {
  DatabaseManager: Symbol('DatabaseManager'),
  OllamaManager: Symbol('OllamaManager'),
  Logger: Symbol('Logger'),
  ModerationPipeline: Symbol('ModerationPipeline'),
  GreatshieldBot: Symbol('GreatshieldBot'),
  DiscordEventHandler: Symbol('DiscordEventHandler'),
  ModerationLogService: Symbol('ModerationLogService'),
  Client: Symbol('Client')
} as const;

interface IDependencyContainer {
  register<T>(token: symbol, factory: (container: IDependencyContainer) => T): void;
  resolve<T>(token: symbol): T;
  hasRegistration(token: symbol): boolean;
}

class DependencyContainer implements IDependencyContainer {
  private factories = new Map<symbol, (container: IDependencyContainer) => any>();
  private singletons = new Map<symbol, any>();

  register<T>(token: symbol, factory: (container: IDependencyContainer) => T): void {
    this.factories.set(token, factory);
  }

  resolve<T>(token: symbol): T {
    // Check if it's already a singleton instance
    if (this.singletons.has(token)) {
      return this.singletons.get(token);
    }

    // Check if we have a factory for this token
    if (!this.factories.has(token)) {
      throw new Error(`No factory registered for token: ${String(token)}`);
    }

    // Create the instance using the factory
    const factory = this.factories.get(token)!;
    const instance = factory(this);

    // Cache as singleton
    this.singletons.set(token, instance);

    return instance;
  }

  hasRegistration(token: symbol): boolean {
    return this.factories.has(token);
  }

  // Method to clear singletons (useful for testing)
  clearSingletons(): void {
    this.singletons.clear();
  }

  // Method to override a service (useful for testing)
  override<T>(token: symbol, instance: T): void {
    this.singletons.set(token, instance);
  }
}

export function createContainer(
  dbPath?: string,
  ollamaHost?: string,
  logLevel?: string,
  logFile?: string
): IDependencyContainer {
  const container = new DependencyContainer();

  // Register Logger
  container.register(TOKENS.Logger, () => {
    return new Logger(logLevel || 'info', logFile);
  });

  // Register DatabaseManager
  container.register(TOKENS.DatabaseManager, () => {
    return new DatabaseManager(dbPath);
  });

  // Register OllamaManager
  container.register(TOKENS.OllamaManager, () => {
    return new OllamaManager(ollamaHost);
  });

  // Register ModerationPipeline
  container.register(TOKENS.ModerationPipeline, (c) => {
    const db = c.resolve<DatabaseManager>(TOKENS.DatabaseManager);
    const ollama = c.resolve<OllamaManager>(TOKENS.OllamaManager);
    const logger = c.resolve<Logger>(TOKENS.Logger);
    return new ModerationPipeline(db, ollama, logger);
  });

  // Register Discord Client (will be created when needed)
  container.register(TOKENS.Client, () => {
    return new Client({
      intents: [
        'Guilds',
        'GuildMessages',
        'MessageContent',
        'GuildMembers',
        'GuildModeration'
      ] as any
    });
  });

  // Register ModerationLogService (requires config to be injected later)
  container.register(TOKENS.ModerationLogService, (c) => {
    const client = c.resolve<Client>(TOKENS.Client);
    const logger = c.resolve<Logger>(TOKENS.Logger);
    // Note: config will need to be provided separately
    return (config: BotConfig) => new ModerationLogService(client, config, logger);
  });

  // Register DiscordEventHandler
  container.register(TOKENS.DiscordEventHandler, (c) => {
    const moderationPipeline = c.resolve<ModerationPipeline>(TOKENS.ModerationPipeline);
    const logger = c.resolve<Logger>(TOKENS.Logger);
    const db = c.resolve<DatabaseManager>(TOKENS.DatabaseManager);
    // Note: ModerationLogService factory will need to be called with config
    return (config: BotConfig) => {
      const moderationLogServiceFactory = c.resolve<(config: BotConfig) => ModerationLogService>(TOKENS.ModerationLogService);
      const moderationLogService = moderationLogServiceFactory(config);
      return new DiscordEventHandler(moderationPipeline, logger, db, moderationLogService);
    };
  });

  // Register GreatshieldBot
  container.register(TOKENS.GreatshieldBot, (c) => {
    const db = c.resolve<DatabaseManager>(TOKENS.DatabaseManager);
    const moderationPipeline = c.resolve<ModerationPipeline>(TOKENS.ModerationPipeline);
    const logger = c.resolve<Logger>(TOKENS.Logger);
    // Note: Event handler factory will need to be called with config
    return (config: BotConfig) => {
      const eventHandlerFactory = c.resolve<(config: BotConfig) => DiscordEventHandler>(TOKENS.DiscordEventHandler);
      const eventHandler = eventHandlerFactory(config);
      const moderationLogServiceFactory = c.resolve<(config: BotConfig) => ModerationLogService>(TOKENS.ModerationLogService);
      const moderationLogService = moderationLogServiceFactory(config);
      
      return new GreatshieldBot(db, moderationPipeline, logger, eventHandler, moderationLogService);
    };
  });

  return container;
}

export { TOKENS, IDependencyContainer };