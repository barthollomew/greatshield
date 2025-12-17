import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { BotConfig, DatabaseManager } from '../database/DatabaseManager';
import { OllamaManager } from '../ollama/OllamaManager';

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
  constructor(private db: DatabaseManager, private ollama: OllamaManager) {}

  async run(): Promise<WizardConfig> {
    console.log(chalk.blue.bold('\nGreatshield Setup Wizard\n'));
    console.log(chalk.gray('This wizard will help you configure your Discord moderation bot.\n'));

    console.log(chalk.yellow.bold('Step 1: Discord Bot Configuration'));
    const discordConfig = await this.collectDiscordConfig();

    console.log(chalk.yellow.bold('\nStep 2: Moderation Policy Selection'));
    const policyPackId = await this.selectPolicyPack();

    console.log(chalk.yellow.bold('\nStep 3: AI Model Configuration'));
    const modelConfig = await this.selectAIModel();

    console.log(chalk.yellow.bold('\nStep 4: Channel Configuration'));
    const channelConfig = await this.collectChannelConfig();

    const config: WizardConfig = {
      ...discordConfig,
      ...channelConfig,
      ...modelConfig,
      policyPackId
    };

    await this.saveConfiguration(config);

    console.log(chalk.green.bold('\nSetup completed successfully!'));
    console.log(chalk.gray('Run "greatshield start" to begin moderating.\n'));

    return config;
  }

  private async collectDiscordConfig(): Promise<{
    discordToken: string;
    applicationId: string;
    publicKey: string;
    guildId: string;
  }> {
    const questions: any[] = [
      {
        type: 'input',
        name: 'discordToken',
        message: 'Enter your Discord Bot Token:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Bot token is required';
          }
          if (!input.match(/^[A-Za-z0-9._-]+$/)) {
            return 'Invalid token format';
          }
          return true;
        },
        transformer: (input: string) => {
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

    return (await inquirer.prompt(questions)) as any;
  }

  private async selectPolicyPack(): Promise<number> {
    const policyPacks = await this.db.getPolicyPacks();
    if (!policyPacks.length) {
      throw new Error('No policy packs available in the database.');
    }

    const choices = policyPacks.map((pack) => ({
      name: `${pack.name} - ${pack.description ?? ''}`.trim(),
      value: pack.id
    }));

    const { selectedPackId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedPackId',
        message: 'Choose a moderation policy pack:',
        choices,
        default: policyPacks[0].id
      }
    ]);

    await this.db.setActivePolicyPack(selectedPackId);
    return selectedPackId;
  }

  private async selectAIModel(): Promise<{ selectedModel: string; ollamaHost: string }> {
    const isOllamaInstalled = await this.ollama.checkInstallation();

    if (!isOllamaInstalled) {
      const { installOllama } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'installOllama',
          message: 'Ollama is not installed. Install it now?',
          default: true
        }
      ]);

      if (!installOllama) {
        throw new Error('Ollama is required for AI moderation.');
      }

      console.log(chalk.blue('Installing Ollama...'));
      await this.ollama.installOllama();
      console.log(chalk.green('Ollama installed successfully.'));
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
          validate: (input: string) => (input.trim().length > 0 ? true : 'Model name is required')
        }
      ]);
      selectedModel = customModel;
    }

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
        console.log(chalk.green(`Model ${selectedModel} downloaded successfully.`));
      } else {
        console.log(chalk.yellow('Model will need to be downloaded before starting the bot.'));
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

  private async collectChannelConfig(): Promise<{ modLogChannelId: string }> {
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

    console.log(chalk.green('\nConfiguration saved to database and .env file'));
  }

  static async runIfNeeded(db: DatabaseManager, ollama: OllamaManager): Promise<WizardConfig | null> {
    await db.initialize();

    const envPath = path.resolve('.env');
    const envExists = fs.existsSync(envPath);

    if (!envExists) {
      const wizard = new SetupWizard(db, ollama);
      return await wizard.run();
    }

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
