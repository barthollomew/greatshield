#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { DatabaseManager } from './database/DatabaseManager';
import { OllamaManager } from './ollama/OllamaManager';
import { GreatshieldBot } from './core/GreatshieldBot';
import { SetupWizard } from './cli/SetupWizard';
import { Logger } from './utils/Logger';

// Load environment variables
dotenv.config();

const program = new Command();
const logger = Logger.create(process.env['NODE_ENV'] as any);

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  console.error(chalk.red('Fatal error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  console.error(chalk.red('Unhandled promise rejection:'), reason);
});

// Version and basic info
program
  .name('greatshield')
  .description('A local-first Discord moderation bot with AI-powered content analysis')
  .version('1.0.0');

// Setup command
program
  .command('setup')
  .description('Run the interactive setup wizard')
  .action(async () => {
    console.log(chalk.blue.bold('🛡️  Greatshield Setup'));
    
    try {
      const db = new DatabaseManager();
      await db.initialize();
      
      const ollama = new OllamaManager();
      const wizard = new SetupWizard(db, ollama);
      
      await wizard.run();
      await db.close();
      
    } catch (error) {
      logger.error('Setup failed', { error: String(error) });
      console.error(chalk.red('Setup failed:'), error);
      process.exit(1);
    }
  });

// Start command
program
  .command('start')
  .description('Start the Greatshield moderation bot')
  .option('-c, --config <path>', 'Path to configuration file', '.env')
  .action(async (options) => {
    console.log(chalk.blue.bold('🛡️  Starting Greatshield...'));
    
    try {
      // Load configuration
      if (options.config !== '.env') {
        dotenv.config({ path: options.config });
      }

      const token = process.env['DISCORD_TOKEN'];
      if (!token) {
        console.error(chalk.red('❌ Discord token not found. Please run "greatshield setup" first.'));
        process.exit(1);
      }

      // Initialize components
      const db = new DatabaseManager(process.env['DATABASE_PATH']);
      await db.initialize();
      
      const ollama = new OllamaManager(process.env['OLLAMA_HOST']);
      const bot = new GreatshieldBot(db, ollama, logger);

      // Setup graceful shutdown
      const shutdown = async (signal: string) => {
        console.log(chalk.yellow(`\n🛑 Received ${signal}, shutting down gracefully...`));
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

      // Start the bot
      await bot.start(token);
      
    } catch (error) {
      logger.error('Bot startup failed', { error: String(error) });
      console.error(chalk.red('Failed to start bot:'), error);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Check the health status of Greatshield components')
  .action(async () => {
    console.log(chalk.blue.bold('🛡️  Greatshield Health Check'));
    
    try {
      const db = new DatabaseManager(process.env['DATABASE_PATH']);
      await db.initialize();
      
      const ollama = new OllamaManager(process.env['OLLAMA_HOST']);
      
      console.log(chalk.yellow('\n📊 System Status:'));
      
      // Check database
      console.log(chalk.gray('  Database:'), chalk.green('✅ Connected'));
      
      // Check Ollama
      const ollamaHealth = await ollama.healthCheck();
      if (ollamaHealth.isRunning) {
        console.log(chalk.gray('  Ollama:'), chalk.green(`✅ Running (${ollamaHealth.modelsAvailable} models available)`));
      } else {
        console.log(chalk.gray('  Ollama:'), chalk.red(`❌ ${ollamaHealth.error || 'Not running'}`));
      }
      
      // Check configuration
      const guildId = process.env['DISCORD_GUILD_ID'];
      if (guildId) {
        const config = await db.getBotConfig(guildId);
        if (config) {
          console.log(chalk.gray('  Configuration:'), chalk.green('✅ Found'));
          console.log(chalk.gray('    Selected Model:'), config.selected_model || 'Not set');
          
          const policyPack = await db.getActivePolicyPack();
          console.log(chalk.gray('    Active Policy:'), policyPack?.name || 'Not set');
        } else {
          console.log(chalk.gray('  Configuration:'), chalk.red('❌ Not found'));
        }
      } else {
        console.log(chalk.gray('  Configuration:'), chalk.red('❌ No guild ID in environment'));
      }
      
      await db.close();
      
    } catch (error) {
      logger.error('Status check failed', { error: String(error) });
      console.error(chalk.red('Status check failed:'), error);
      process.exit(1);
    }
  });

// Models command
program
  .command('models')
  .description('List available Ollama models')
  .action(async () => {
    console.log(chalk.blue.bold('🤖 Available Models'));
    
    try {
      const ollama = new OllamaManager(process.env['OLLAMA_HOST']);
      
      const health = await ollama.healthCheck();
      if (!health.isRunning) {
        console.error(chalk.red('❌ Ollama is not running. Please start Ollama first.'));
        process.exit(1);
      }
      
      const models = await ollama.listModels();
      
      if (models.length === 0) {
        console.log(chalk.yellow('No models found. Use "ollama pull <model>" to download models.'));
      } else {
        console.log(chalk.yellow('\n📚 Installed Models:'));
        models.forEach(model => {
          console.log(chalk.gray(`  • ${model}`));
        });
      }
      
    } catch (error) {
      logger.error('Models list failed', { error: String(error) });
      console.error(chalk.red('Failed to list models:'), error);
      process.exit(1);
    }
  });

// Pull model command
program
  .command('pull <model>')
  .description('Download an Ollama model')
  .action(async (model) => {
    console.log(chalk.blue.bold(`🤖 Downloading ${model}...`));
    
    try {
      const ollama = new OllamaManager(process.env['OLLAMA_HOST']);
      
      const health = await ollama.healthCheck();
      if (!health.isRunning) {
        console.error(chalk.red('❌ Ollama is not running. Please start Ollama first.'));
        process.exit(1);
      }
      
      await ollama.pullModel(model);
      console.log(chalk.green(`✅ Model ${model} downloaded successfully!`));
      
    } catch (error) {
      logger.error('Model download failed', { error: String(error), model });
      console.error(chalk.red(`Failed to download ${model}:`), error);
      process.exit(1);
    }
  });

// Logs command
program
  .command('logs')
  .description('View Greatshield logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .action(async (options) => {
    console.log(chalk.blue.bold('📋 Greatshield Logs'));
    
    try {
      const { exec, spawn } = await import('child_process');
      const logFile = process.env['LOG_FILE'] || './logs/greatshield.log';
      
      if (options.follow) {
        console.log(chalk.gray(`Following ${logFile}...`));
        const tail = spawn('tail', ['-f', logFile]);
        
        tail.stdout.on('data', (data) => {
          process.stdout.write(data);
        });
        
        tail.stderr.on('data', (data) => {
          process.stderr.write(data);
        });
        
        tail.on('close', (code) => {
          console.log(chalk.gray(`Log follow ended with code ${code}`));
        });
        
      } else {
        exec(`tail -n ${options.lines} ${logFile}`, (error, stdout, stderr) => {
          if (error) {
            console.error(chalk.red('Error reading logs:'), error.message);
            return;
          }
          if (stderr) {
            console.error(chalk.red('Stderr:'), stderr);
            return;
          }
          console.log(stdout);
        });
      }
      
    } catch (error) {
      logger.error('Logs command failed', { error: String(error) });
      console.error(chalk.red('Failed to read logs:'), error);
      process.exit(1);
    }
  });

// Default command (interactive mode)
program
  .action(async () => {
    console.log(chalk.blue.bold('🛡️  Welcome to Greatshield!'));
    console.log(chalk.gray('The local-first Discord moderation bot with AI-powered content analysis.\n'));
    
    const wizard = await SetupWizard.runIfNeeded(
      new DatabaseManager(),
      new OllamaManager()
    );
    
    if (!wizard) {
      console.log(chalk.green('Configuration found! Use "greatshield start" to begin moderating.'));
      console.log(chalk.gray('Use "greatshield --help" for more commands.\n'));
    }
  });

// Parse command line arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}