import inquirer from 'inquirer';
import chalk from 'chalk';
import { DatabaseManager, BotConfig } from '../database/DatabaseManager';
import { OllamaManager } from '../ollama/OllamaManager';
import fs from 'fs';
import path from 'path';

export interface WizardConfig {
  discordToken: string;
  applicationId: string;
  publicKey: string;
  guildId: string;
  modLogChannelId: string;
  selectedModel: string;
  ollamaHost: string;
  policyPackId: number;
}

export class SetupWizard {
  private db: DatabaseManager;
  private ollama: OllamaManager;

  constructor(db: DatabaseManager, ollama: OllamaManager) {
    this.db = db;
    this.ollama = ollama;
  }

  async run(): Promise<WizardConfig> {
    console.log(chalk.blue.bold('\n🛡️  Welcome to Greatshield Setup Wizard\n'));
    console.log(chalk.gray('This wizard will help you configure your Discord moderation bot.\n'));

    // Step 1: Discord Configuration
    console.log(chalk.yellow.bold('Step 1: Discord Bot Configuration'));
    const discordConfig = await this.collectDiscordConfig();

    // Step 2: Policy Pack Selection
    console.log(chalk.yellow.bold('\nStep 2: Moderation Policy Selection'));
    const policyPackId = await this.selectPolicyPack();

    // Step 3: AI Model Selection
    console.log(chalk.yellow.bold('\nStep 3: AI Model Configuration'));
    const modelConfig = await this.selectAIModel();

    // Step 4: Channel Configuration
    console.log(chalk.yellow.bold('\nStep 4: Channel Configuration'));
    const channelConfig = await this.collectChannelConfig();

    // Compile final configuration
    const config: WizardConfig = {
      ...discordConfig,
      ...channelConfig,
      ...modelConfig,
      policyPackId
    };

    // Step 5: Save Configuration
    await this.saveConfiguration(config);

    console.log(chalk.green.bold('\n✅ Setup completed successfully!'));
    console.log(chalk.gray('Your bot is ready to start moderating. Run "greatshield start" to begin.\n'));

    return config;
  }

  private async collectDiscordConfig(): Promise<{discordToken: string, applicationId: string, publicKey: string, guildId: string}> {
    const questions: any[] = [
      {
        type: 'input',
        name: 'discordToken',
        message: 'Enter your Discord Bot Token:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Bot token is required';
          }
          // Basic token format validation
          if (!input.match(/^[A-Za-z0-9._-]+$/)) {
            return 'Invalid token format';
          }
          return true;
        },
        transformer: (input: string) => {
          // Hide token for security
          return input.length > 10 ? input.substring(0, 10) + '...' : input;
        }
      },
      {
        type: 'input',
        name: 'applicationId',
        message: 'Enter your Discord Application ID:',
        default: '1403985306021269656',
        validate: (input: string) => {
          if (!input || !/^\d{17,19}$/.test(input)) {
            return 'Application ID must be a valid Discord snowflake (17-19 digits)';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'publicKey',
        message: 'Enter your Discord Public Key:',
        default: 'dc0a734ee5cb3466145f780311fea17d88685c89d41dcd3f5dacc58c63a2a25c',
        validate: (input: string) => {
          if (!input || !/^[a-f0-9]{64}$/.test(input)) {
            return 'Public key must be a 64-character hexadecimal string';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'guildId',
        message: 'Enter your Discord Server (Guild) ID:',
        validate: (input: string) => {
          if (!input || !/^\d{17,19}$/.test(input)) {
            return 'Guild ID must be a valid Discord snowflake (17-19 digits)';
          }
          return true;
        }
      }
    ];

    return await inquirer.prompt(questions) as any;
  }

  private async selectPolicyPack(): Promise<number> {
    const policyPacks = await this.db.getPolicyPacks();
    
    const choices = policyPacks.map(pack => ({
      name: `${pack.name} - ${pack.description}`,
      value: pack.id
    }));

    choices.push({
      name: 'Create new custom policy pack',
      value: -1
    });

    const { selectedPackId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedPackId',
        message: 'Choose a moderation policy pack:',
        choices,
        default: 1 // Default to Strict Moderation
      }
    ]);

    if (selectedPackId === -1) {
      return await this.createCustomPolicyPack();
    }

    await this.db.setActivePolicyPack(selectedPackId);
    return selectedPackId;
  }

  private async createCustomPolicyPack(): Promise<number> {
    console.log(chalk.blue('\nCreating a custom policy pack...'));
    
    const questions: any[] = [
      {
        type: 'input',
        name: 'name',
        message: 'Policy pack name:',
        validate: (input: string) => input.trim().length > 0 ? true : 'Name is required'
      },
      {
        type: 'input',
        name: 'description',
        message: 'Policy pack description:',
        default: 'Custom moderation policy'
      },
      {
        type: 'number',
        name: 'toxicityThreshold',
        message: 'Toxicity detection threshold (0.0-1.0):',
        default: 0.7,
        validate: (input: number) => input >= 0 && input <= 1 ? true : 'Must be between 0.0 and 1.0'
      },
      {
        type: 'list',
        name: 'toxicityAction',
        message: 'Action for toxic content:',
        choices: [
          { name: 'Mask message', value: 'mask' },
          { name: 'Delete and warn', value: 'delete_warn' },
          { name: 'Shadowban user', value: 'shadowban' },
          { name: 'Escalate to moderators', value: 'escalate' }
        ],
        default: 'delete_warn'
      }
    ];

    await inquirer.prompt(questions);

    // Create custom policy pack in database
    // This would need additional implementation in DatabaseManager
    console.log(chalk.yellow('Note: Custom policy pack creation will be implemented in a future update.'));
    console.log(chalk.gray('Using default "Balanced Moderation" policy for now.\n'));
    
    await this.db.setActivePolicyPack(2); // Fallback to Balanced
    return 2;
  }

  private async selectAIModel(): Promise<{selectedModel: string, ollamaHost: string}> {
    // Check if Ollama is installed
    const isOllamaInstalled = await this.ollama.checkInstallation();
    
    if (!isOllamaInstalled) {
      const { installOllama } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'installOllama',
          message: 'Ollama is not installed. Would you like to install it automatically?',
          default: true
        }
      ]);

      if (installOllama) {
        console.log(chalk.blue('Installing Ollama...'));
        await this.ollama.installOllama();
        console.log(chalk.green('✅ Ollama installed successfully!'));
      } else {
        console.log(chalk.red('❌ Ollama is required for AI moderation. Please install it manually.'));
        process.exit(1);
      }
    }

    const modelChoices = [
      {
        name: 'TinyLLaMA 1.1B (Low-end PC, ~650MB RAM)',
        value: 'tinyllama:1.1b-q4_k_m',
        description: 'Best for systems with limited resources'
      },
      {
        name: 'Phi-2 2.7B (Mid-range PC, ~850MB RAM) - Recommended',
        value: 'phi:2.7b-q4_k_m',
        description: 'Balanced performance and resource usage'
      },
      {
        name: 'Mistral 7B Instruct (High-end PC, ~4.2GB RAM)',
        value: 'mistral:7b-instruct-q4_k_m',
        description: 'Best accuracy for powerful systems'
      },
      {
        name: 'Custom model (Enter manually)',
        value: 'custom',
        description: 'Specify your own Ollama model'
      }
    ];

    const { selectedModel: modelChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedModel',
        message: 'Choose an AI model for content moderation:',
        choices: modelChoices,
        default: 'phi:2.7b-q4_k_m'
      }
    ]);

    let selectedModel = modelChoice;

    if (modelChoice === 'custom') {
      const { customModel } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customModel',
          message: 'Enter the Ollama model name:',
          validate: (input: string) => input.trim().length > 0 ? true : 'Model name is required'
        }
      ]);
      selectedModel = customModel;
    }

    // Check if model is available
    const availableModels = await this.ollama.listModels();
    const modelExists = availableModels.includes(selectedModel);

    if (!modelExists) {
      const { downloadModel } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'downloadModel',
          message: `Model "${selectedModel}" is not downloaded. Download it now?`,
          default: true
        }
      ]);

      if (downloadModel) {
        console.log(chalk.blue(`Downloading ${selectedModel}... This may take a while.`));
        await this.ollama.pullModel(selectedModel);
        console.log(chalk.green(`✅ Model ${selectedModel} downloaded successfully!`));
      } else {
        console.log(chalk.yellow('⚠️  Model will need to be downloaded before starting the bot.'));
      }
    }

    const { ollamaHost } = await inquirer.prompt([
      {
        type: 'input',
        name: 'ollamaHost',
        message: 'Ollama host URL:',
        default: 'http://localhost:11434',
        validate: (input: string) => {
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        }
      }
    ]);

    return { selectedModel, ollamaHost };
  }

  private async collectChannelConfig(): Promise<{modLogChannelId: string}> {
    const { modLogChannelId } = await inquirer.prompt([
      {
        type: 'input',
        name: 'modLogChannelId',
        message: 'Enter Moderation Log Channel ID:',
        validate: (input: string) => {
          if (!input || !/^\d{17,19}$/.test(input)) {
            return 'Channel ID must be a valid Discord snowflake (17-19 digits)';
          }
          return true;
        }
      }
    ]);

    return { modLogChannelId };
  }

  private async saveConfiguration(config: WizardConfig): Promise<void> {
    // Save to database
    const botConfig: BotConfig = {
      guild_id: config.guildId,
      discord_token: config.discordToken,
      application_id: config.applicationId,
      public_key: config.publicKey,
      mod_log_channel_id: config.modLogChannelId,
      selected_model: config.selectedModel,
      ollama_host: config.ollamaHost,
      active_policy_pack_id: config.policyPackId,
      is_enabled: true
    };

    await this.db.updateBotConfig(botConfig);

    // Save to .env file
    const envContent = `# Greatshield Configuration - Generated by Setup Wizard
DISCORD_TOKEN=${config.discordToken}
DISCORD_APPLICATION_ID=${config.applicationId}
DISCORD_PUBLIC_KEY=${config.publicKey}
DISCORD_GUILD_ID=${config.guildId}
MOD_LOG_CHANNEL_ID=${config.modLogChannelId}
OLLAMA_HOST=${config.ollamaHost}
SELECTED_MODEL=${config.selectedModel}
DATABASE_PATH=./greatshield.db
LOG_LEVEL=info
LOG_FILE=./logs/greatshield.log
PORT=3000
`;

    const envPath = path.resolve('.env');
    fs.writeFileSync(envPath, envContent);

    console.log(chalk.green('\n💾 Configuration saved to database and .env file'));
  }

  static async runIfNeeded(db: DatabaseManager, ollama: OllamaManager): Promise<WizardConfig | null> {
    // Check if configuration exists
    const envPath = path.resolve('.env');
    const envExists = fs.existsSync(envPath);
    
    if (!envExists) {
      const wizard = new SetupWizard(db, ollama);
      return await wizard.run();
    }

    // Check if user wants to reconfigure
    const { reconfigure } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reconfigure',
        message: 'Configuration found. Would you like to run setup wizard again?',
        default: false
      }
    ]);

    if (reconfigure) {
      const wizard = new SetupWizard(db, ollama);
      return await wizard.run();
    }

    return null;
  }
}