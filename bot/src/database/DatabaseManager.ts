import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface PolicyPack {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ModerationRule {
  id: number;
  policy_pack_id: number;
  rule_type: 'toxicity' | 'harassment' | 'spam' | 'grooming';
  threshold: number;
  action: 'mask' | 'delete_warn' | 'shadowban' | 'escalate';
  enabled: boolean;
  created_at: string;
}

export interface ModerationLog {
  id?: number;
  message_id: string;
  channel_id: string;
  guild_id: string;
  user_id: string;
  username?: string;
  message_content: string;
  detection_type: 'fast_pass' | 'ai_analysis';
  rule_triggered?: string | undefined;
  confidence_scores?: string; // JSON string
  action_taken: string;
  reasoning?: string | undefined;
  moderator_id?: string;
  is_appeal?: boolean;
  appeal_reason?: string;
  appeal_status?: 'pending' | 'approved' | 'rejected';
  processed_at?: string;
}

export interface BotConfig {
  id?: number;
  guild_id: string;
  discord_token?: string;
  application_id?: string;
  public_key?: string;
  mod_log_channel_id?: string;
  selected_model?: string;
  ollama_host?: string;
  active_policy_pack_id?: number;
  is_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './greatshield.db') {
    this.dbPath = path.resolve(dbPath);
  }

  async initialize(): Promise<void> {
    try {
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      await this.createTables();
      await this.seedDatabase();
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error}`);
    }
  }

  private async createTables(): Promise<void> {
    // Handle both development and production paths
    const schemaPath = fs.existsSync(path.join(__dirname, '../../schemas/database.sql'))
      ? path.join(__dirname, '../../schemas/database.sql')
      : path.join(process.cwd(), 'bot/schemas/database.sql');
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at: ${schemaPath}`);
    }
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    try {
      this.db!.exec(schema);
    } catch (error) {
      throw new Error(`Failed to create tables: ${error}`);
    }
  }

  private async seedDatabase(): Promise<void> {
    // Handle both development and production paths
    const seedPath = fs.existsSync(path.join(__dirname, '../../schemas/seed-data.sql'))
      ? path.join(__dirname, '../../schemas/seed-data.sql')
      : path.join(process.cwd(), 'bot/schemas/seed-data.sql');
    
    if (!fs.existsSync(seedPath)) {
      throw new Error(`Seed file not found at: ${seedPath}`);
    }
    
    const seedData = fs.readFileSync(seedPath, 'utf8');
    
    try {
      this.db!.exec(seedData);
    } catch (error) {
      throw new Error(`Failed to seed database: ${error}`);
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Policy Pack Methods
  async getPolicyPacks(): Promise<PolicyPack[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    try {
      const stmt = this.db.prepare('SELECT * FROM policy_packs ORDER BY created_at DESC');
      return stmt.all() as PolicyPack[];
    } catch (error) {
      throw new Error(`Failed to get policy packs: ${error}`);
    }
  }

  async getActivePolicyPack(): Promise<PolicyPack | null> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    try {
      const stmt = this.db.prepare('SELECT * FROM policy_packs WHERE is_active = 1 LIMIT 1');
      return (stmt.get() as PolicyPack) || null;
    } catch (error) {
      throw new Error(`Failed to get active policy pack: ${error}`);
    }
  }

  async setActivePolicyPack(policyPackId: number): Promise<void> {
    try {
      const transaction = this.db!.transaction(() => {
        this.db!.prepare('UPDATE policy_packs SET is_active = 0').run();
        this.db!.prepare('UPDATE policy_packs SET is_active = 1 WHERE id = ?').run(policyPackId);
      });
      transaction();
    } catch (error) {
      throw new Error(`Failed to set active policy pack: ${error}`);
    }
  }

  // Moderation Rules Methods
  async getModerationRules(policyPackId: number): Promise<ModerationRule[]> {
    try {
      const stmt = this.db!.prepare('SELECT * FROM moderation_rules WHERE policy_pack_id = ? AND enabled = 1');
      return stmt.all(policyPackId) as ModerationRule[];
    } catch (error) {
      throw new Error(`Failed to get moderation rules: ${error}`);
    }
  }

  // Moderation Logs Methods
  async addModerationLog(log: ModerationLog): Promise<number> {
    try {
      const stmt = this.db!.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, username, message_content,
          detection_type, rule_triggered, confidence_scores, action_taken,
          reasoning, moderator_id, is_appeal, appeal_reason, appeal_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        log.message_id,
        log.channel_id,
        log.guild_id,
        log.user_id,
        log.username,
        log.message_content,
        log.detection_type,
        log.rule_triggered,
        log.confidence_scores,
        log.action_taken,
        log.reasoning,
        log.moderator_id,
        log.is_appeal ? 1 : 0,
        log.appeal_reason,
        log.appeal_status
      );

      return result.lastInsertRowid as number;
    } catch (error) {
      throw new Error(`Failed to add moderation log: ${error}`);
    }
  }

  async getModerationLogByMessageId(messageId: string): Promise<ModerationLog | null> {
    try {
      const stmt = this.db!.prepare('SELECT * FROM moderation_logs WHERE message_id = ? LIMIT 1');
      return (stmt.get(messageId) as ModerationLog) || null;
    } catch (error) {
      throw new Error(`Failed to get moderation log: ${error}`);
    }
  }

  // Bot Configuration Methods
  async getBotConfig(guildId: string): Promise<BotConfig | null> {
    try {
      const stmt = this.db!.prepare('SELECT * FROM bot_config WHERE guild_id = ? LIMIT 1');
      return (stmt.get(guildId) as BotConfig) || null;
    } catch (error) {
      throw new Error(`Failed to get bot config: ${error}`);
    }
  }

  async updateBotConfig(config: BotConfig): Promise<void> {
    try {
      const stmt = this.db!.prepare(`
        INSERT OR REPLACE INTO bot_config (
          guild_id, discord_token, application_id, public_key, mod_log_channel_id,
          selected_model, ollama_host, active_policy_pack_id, is_enabled, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(
        config.guild_id,
        config.discord_token,
        config.application_id,
        config.public_key,
        config.mod_log_channel_id,
        config.selected_model,
        config.ollama_host,
        config.active_policy_pack_id,
        config.is_enabled ? 1 : 0
      );
    } catch (error) {
      throw new Error(`Failed to update bot config: ${error}`);
    }
  }

  // Message Context Methods (for RAG)
  async addMessageContext(channelId: string, messageId: string, userId: string, content: string, timestamp: Date): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db!.prepare(`
        INSERT OR IGNORE INTO message_context (channel_id, message_id, user_id, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run([channelId, messageId, userId, content, timestamp.toISOString()], (err: any) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });

      (stmt as any).finalize();
    });
  }

  async getRecentMessageContext(channelId: string, limit: number = 10): Promise<Array<{user_id: string, content: string, timestamp: string}>> {
    return new Promise((resolve, reject) => {
      (this.db as any).all(
        'SELECT user_id, content, timestamp FROM message_context WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?',
        [channelId, limit],
        (err: any, rows: Array<{user_id: string, content: string, timestamp: string}>) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });
  }

  // Banned Words Methods
  async getBannedWords(policyPackId: number): Promise<Array<{word_or_phrase: string, is_regex: boolean, severity: string, action: string}>> {
    return new Promise((resolve, reject) => {
      (this.db as any).all(
        'SELECT word_or_phrase, is_regex, severity, action FROM banned_words WHERE policy_pack_id = ? AND enabled = 1',
        [policyPackId],
        (err: any, rows: Array<{word_or_phrase: string, is_regex: boolean, severity: string, action: string}>) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });
  }

  // Blocked URLs Methods
  async getBlockedUrls(policyPackId: number): Promise<Array<{url_pattern: string, is_regex: boolean, reason: string, action: string}>> {
    try {
      const stmt = this.db!.prepare('SELECT url_pattern, is_regex, reason, action FROM blocked_urls WHERE policy_pack_id = ? AND enabled = 1');
      return stmt.all(policyPackId) as Array<{url_pattern: string, is_regex: boolean, reason: string, action: string}>;
    } catch (error) {
      throw new Error(`Failed to get blocked URLs: ${error}`);
    }
  }
}