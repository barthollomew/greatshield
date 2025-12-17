#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BotConfig, DatabaseManager } from './database/DatabaseManager';
import { OllamaManager } from './ollama/OllamaManager';
import { GreatshieldBot } from './core/GreatshieldBot';
import { SetupWizard } from './cli/SetupWizard';
import { Logger } from './utils/Logger';
import { createContainer, TOKENS } from './core/DIContainer';
import { ApiServer } from './server/ApiServer';

dotenv.config();

const program = new Command();
const logger = Logger.create(process.env['NODE_ENV'] as any);

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  console.error(chalk.red('Fatal error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  console.error(chalk.red('Unhandled promise rejection:'), reason);
});

program
  .name('greatshield')
  .description('A local-first Discord moderation bot with AI-powered content analysis')
  .version('1.0.0')
  .showHelpAfterError();

const banner = (message: string): void => {
  console.log(chalk.blue.bold(`Greatshield: ${message}`));
};

const withAction = <T extends any[]>(label: string, action: (...args: T) => Promise<void>) => {
  return async (...args: T) => {
    try {
      await action(...args);
    } catch (error) {
      const err = error as Error;
      logger.error(`${label} failed`, { error: err?.message });
      console.error(chalk.red(`${label} failed:`), err?.message ?? error);
      process.exitCode = 1;
    }
  };
};

const ensureEnv = (key: string, message: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(message);
  }
  return value;
};

const loadEnvFrom = (configPath?: string): void => {
  if (configPath && configPath !== '.env') {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found at ${resolved}`);
    }
    dotenv.config({ path: resolved });
  }
};

const loadConfig = async (db: DatabaseManager, guildId: string): Promise<BotConfig> => {
  const config = await db.getBotConfig(guildId);
  if (!config) {
    throw new Error('Bot configuration not found. Run "greatshield setup" first.');
  }
  return config;
};

const printLogTail = (logFile: string, lines: number): void => {
  if (!fs.existsSync(logFile)) {
    throw new Error(`Log file not found at ${logFile}`);
  }
  const content = fs.readFileSync(logFile, 'utf8');
  const tail = content.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
  console.log(tail);
};

const followLogFile = (logFile: string): void => {
  if (!fs.existsSync(logFile)) {
    throw new Error(`Log file not found at ${logFile}`);
  }

  let position = fs.statSync(logFile).size;
  console.log(chalk.gray(`Following ${logFile}...`));

  const readChunk = () => {
    const stats = fs.statSync(logFile);
    if (stats.size < position) {
      position = 0;
    }
    if (stats.size === position) {
      return;
    }

    const stream = fs.createReadStream(logFile, { start: position, end: stats.size });
    stream.on('data', (chunk) => process.stdout.write(chunk.toString()));
    position = stats.size;
  };

  readChunk();
  const watcher = fs.watch(logFile, (eventType) => {
    if (eventType === 'change') {
      readChunk();
    }
  });

  process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
  });
};

program
  .command('setup')
  .description('Run the interactive setup wizard')
  .action(
    withAction('Setup', async () => {
      banner('Setup');
      const db = new DatabaseManager();
      await db.initialize();

      try {
        const ollama = new OllamaManager();
        const wizard = new SetupWizard(db, ollama);
        await wizard.run();
      } finally {
        await db.close();
      }
    })
  );

program
  .command('start')
  .description('Start the Greatshield moderation bot')
  .option('-c, --config <path>', 'Path to configuration file', '.env')
  .action(
    withAction('Startup', async (options: { config?: string }) => {
      banner('Starting');
      loadEnvFrom(options.config);

      const token = ensureEnv(
        'DISCORD_TOKEN',
        'Discord token not found. Run "greatshield setup" first.'
      );

      const container = createContainer(
        process.env['DATABASE_PATH'],
        process.env['OLLAMA_HOST'],
        process.env['LOG_LEVEL'],
        process.env['LOG_FILE']
      );

      const db = container.resolve<DatabaseManager>(TOKENS.DatabaseManager);
      await db.initialize();

      let started = false;

      try {
        const guildId = ensureEnv(
          'DISCORD_GUILD_ID',
          'Discord guild ID not found. Run "greatshield setup" first.'
        );

        const config = await loadConfig(db, guildId);
        const botFactory = container.resolve<(config: BotConfig) => GreatshieldBot>(
          TOKENS.GreatshieldBot
        );
        const bot = botFactory(config);

        const shutdown = async (signal: string) => {
          console.log(chalk.yellow(`\nReceived ${signal}, shutting down gracefully...`));
          logger.info(`Received ${signal}, shutting down`);

          try {
            await bot.stop();
            await logger.close();
            process.exit(0);
          } catch (error) {
            logger.error('Error during shutdown', { error: String(error) });
            process.exit(1);
          }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

      await bot.start(token);
      started = true;
    } finally {
      if (!started) {
        await db.close();
      }
    }
  })
);

program
  .command('serve')
  .description('Start the REST API for the Greatshield dashboard')
  .option('-p, --port <number>', 'Port to listen on', process.env['PORT'] || '4000')
  .action(
    withAction('API server', async (options: { port?: string }) => {
      banner('API server');

      const portNumber = Number(options.port || process.env['PORT'] || '4000');
      if (Number.isNaN(portNumber)) {
        throw new Error('Port must be a number.');
      }

      const db = new DatabaseManager(process.env['DATABASE_PATH']);
      await db.initialize();
      const ollama = new OllamaManager(process.env['OLLAMA_HOST']);
      const api = new ApiServer(db, ollama, logger, portNumber);
      await api.start();

      console.log(chalk.green(`REST API available at http://localhost:${portNumber}/api`));

      const shutdown = async (signal: string) => {
        console.log(chalk.yellow(`\nReceived ${signal}, shutting down API...`));
        await api.stop();
        await db.close();
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
  );

program
  .command('status')
  .description('Check the health status of Greatshield components')
  .action(
    withAction('Status', async () => {
      banner('Health Check');

      const db = new DatabaseManager(process.env['DATABASE_PATH']);
      await db.initialize();

      try {
        const ollama = new OllamaManager(process.env['OLLAMA_HOST']);

        console.log(chalk.yellow('\nSystem Status:'));
        console.log(chalk.gray('  Database:'), chalk.green('Connected'));

        const ollamaHealth = await ollama.healthCheck();
        if (ollamaHealth.isRunning) {
          console.log(
            chalk.gray('  Ollama:'),
            chalk.green(`Running (${ollamaHealth.modelsAvailable} models available)`)
          );
        } else {
          console.log(chalk.gray('  Ollama:'), chalk.red(ollamaHealth.error || 'Not running'));
        }

        const guildId = process.env['DISCORD_GUILD_ID'];
        if (guildId) {
          const config = await db.getBotConfig(guildId);
          if (config) {
            console.log(chalk.gray('  Configuration:'), chalk.green('Found'));
            console.log(chalk.gray('    Selected Model:'), config.selected_model || 'Not set');

            const policyPack = await db.getActivePolicyPack();
            console.log(chalk.gray('    Active Policy:'), policyPack?.name || 'Not set');
          } else {
            console.log(chalk.gray('  Configuration:'), chalk.red('Not found'));
          }
        } else {
          console.log(chalk.gray('  Configuration:'), chalk.red('No guild ID in environment'));
        }
      } finally {
        await db.close();
      }
    })
  );

program
  .command('models')
  .description('List available Ollama models')
  .action(
    withAction('Models', async () => {
      banner('Available Models');

      const ollama = new OllamaManager(process.env['OLLAMA_HOST']);
      const health = await ollama.healthCheck();

      if (!health.isRunning) {
        throw new Error('Ollama is not running. Please start Ollama first.');
      }

      const models = await ollama.listModels();
      if (models.length === 0) {
        console.log(chalk.yellow('No models found. Use "ollama pull <model>" to download models.'));
      } else {
        console.log(chalk.yellow('\nInstalled Models:'));
        models.forEach((model) => console.log(chalk.gray(`  - ${model}`)));
      }
    })
  );

program
  .command('pull <model>')
  .description('Download an Ollama model')
  .action(
    withAction('Model download', async (model: string) => {
      banner(`Downloading ${model}`);

      const ollama = new OllamaManager(process.env['OLLAMA_HOST']);
      const health = await ollama.healthCheck();
      if (!health.isRunning) {
        throw new Error('Ollama is not running. Please start Ollama first.');
      }

      await ollama.pullModel(model);
      console.log(chalk.green(`Model ${model} downloaded successfully.`));
    })
  );

program
  .command('logs')
  .description('View Greatshield logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action(
    withAction('Logs', async (options: { follow?: boolean; lines?: string }) => {
      banner('Logs');

      const logFile = process.env['LOG_FILE'] || './logs/greatshield.log';
      const lines = Number(options.lines || '50');

      if (Number.isNaN(lines) || lines <= 0) {
        throw new Error('Lines must be a positive number.');
      }

      if (options.follow) {
        followLogFile(logFile);
      } else {
        printLogTail(logFile, lines);
      }
    })
  );

const runDefault = withAction('Welcome', async () => {
  banner('Welcome');
  console.log(chalk.gray('The local-first Discord moderation bot with AI-powered content analysis.\n'));

  const db = new DatabaseManager();
  const ollama = new OllamaManager();

  try {
    const wizard = await SetupWizard.runIfNeeded(db, ollama);
    if (!wizard) {
      console.log(chalk.green('Configuration found! Use "greatshield start" to begin moderating.'));
      console.log(chalk.gray('Use "greatshield --help" for more commands.\n'));
    }
  } finally {
    await db.close();
  }
});

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    await runDefault();
    program.outputHelp();
    return;
  }

  await program.parseAsync(process.argv);
}

void main().catch((error) => {
  logger.error('CLI failed', { error: String(error) });
  console.error(chalk.red('Greatshield failed to start:'), error);
  process.exit(1);
});
