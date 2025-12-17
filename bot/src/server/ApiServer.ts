import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { DatabaseManager, BotConfig } from '../database/DatabaseManager';
import { OllamaManager } from '../ollama/OllamaManager';
import { Logger } from '../utils/Logger';

interface HealthResponse {
  database: { connected: boolean };
  ollama: { running: boolean; modelsAvailable?: number; error?: string };
  configuration?: { guildId?: string; selected_model?: string; active_policy_pack_id?: number };
}

export class ApiServer {
  private app = express();
  private server?: http.Server;

  constructor(
    private db: DatabaseManager,
    private ollama: OllamaManager,
    private logger: Logger,
    private port: number = Number(process.env['PORT'] || 4000)
  ) {
    this.configure();
  }

  private configure(): void {
    this.app.use(cors());
    this.app.use(express.json());

    this.app.get('/api/health', async (req, res) => {
      await this.handle(res, async () => {
        const guildId = this.getGuildId(req);
        const config = guildId ? await this.db.getBotConfig(guildId) : await this.db.getFirstBotConfig();
        const ollamaHealth = await this.ollama.healthCheck();

        const payload: HealthResponse = {
          database: { connected: true },
          ollama: {
            running: ollamaHealth.isRunning,
            modelsAvailable: ollamaHealth.modelsAvailable,
            error: ollamaHealth.error
          },
          configuration: config
            ? {
              guildId: config.guild_id,
              selected_model: config.selected_model,
              active_policy_pack_id: config.active_policy_pack_id
            }
            : undefined
        };

        res.json(payload);
      });
    });

    this.app.get('/api/config', async (req, res) => {
      await this.handle(res, async () => {
        const config = await this.loadConfig(req);
        res.json(config);
      });
    });

    this.app.post('/api/config', async (req, res) => {
      await this.handle(res, async () => {
        const guildId = this.getGuildId(req);
        const targetGuild = guildId || req.body.guild_id;

        if (!targetGuild) {
          res.status(400).json({ message: 'guildId is required in environment, query, or body.' });
          return;
        }

        const existing = await this.db.getBotConfig(targetGuild);
        if (!existing) {
          res.status(404).json({ message: 'Bot configuration not found for the provided guildId.' });
          return;
        }

        const payload: BotConfig = {
          ...existing,
          guild_id: targetGuild,
          selected_model: req.body.selected_model ?? existing.selected_model,
          mod_log_channel_id: req.body.mod_log_channel_id ?? existing.mod_log_channel_id,
          active_policy_pack_id: req.body.active_policy_pack_id ?? existing.active_policy_pack_id,
          ollama_host: req.body.ollama_host ?? existing.ollama_host,
          is_enabled: req.body.is_enabled ?? existing.is_enabled
        };

        await this.db.updateBotConfig(payload);
        res.json(payload);
      });
    });

    this.app.get('/api/policy-packs', async (_req, res) => {
      await this.handle(res, async () => {
        const packs = await this.db.getPolicyPacks();
        res.json(packs);
      });
    });

    this.app.get('/api/models', async (_req, res) => {
      await this.handle(res, async () => {
        const health = await this.ollama.healthCheck();
        if (!health.isRunning) {
          res.status(503).json({ message: 'Ollama is not running' });
          return;
        }
        const models = await this.ollama.listModels();
        res.json(models);
      });
    });
  }

  private getGuildId(req: Request): string | undefined {
    const fromQuery = (req.query['guildId'] || req.query['guild_id']) as string | undefined;
    return fromQuery || process.env['DISCORD_GUILD_ID'];
  }

  private async loadConfig(req: Request): Promise<BotConfig> {
    const guildId = this.getGuildId(req);
    const config = guildId ? await this.db.getBotConfig(guildId) : await this.db.getFirstBotConfig();

    if (!config) {
      throw new Error('Bot configuration not found. Run setup to create one.');
    }

    return config;
  }

  private async handle(res: Response, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('API error', { error: message });
      res.status(500).json({ message });
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server = this.app.listen(this.port, () => {
        this.logger.info(`API server listening on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server = undefined;
  }
}
