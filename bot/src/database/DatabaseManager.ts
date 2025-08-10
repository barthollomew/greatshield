import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

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
  rule_triggered?: string;
  confidence_scores?: string; // JSON string
  action_taken: string;
  reasoning?: string;
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
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './greatshield.db') {
    this.dbPath = path.resolve(dbPath);
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(new Error(`Failed to connect to database: ${err.message}`));
          return;
        }
        
        this.db!.serialize(() => {
          this.createTables()
            .then(() => this.seedDatabase())
            .then(() => resolve())
            .catch(reject);
        });
      });
    });
  }

  private async createTables(): Promise<void> {
    const schemaPath = path.join(__dirname, '../../schemas/database.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    return new Promise((resolve, reject) => {
      this.db!.exec(schema, (err) => {
        if (err) {
          reject(new Error(`Failed to create tables: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  private async seedDatabase(): Promise<void> {
    const seedPath = path.join(__dirname, '../../schemas/seed-data.sql');
    const seedData = fs.readFileSync(seedPath, 'utf8');
    
    return new Promise((resolve, reject) => {
      this.db!.exec(seedData, (err) => {
        if (err) {
          reject(new Error(`Failed to seed database: ${err.message}`));
          return;
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          reject(new Error(`Failed to close database: ${err.message}`));
          return;
        }
        this.db = null;
        resolve();
      });
    });
  }

  // Policy Pack Methods
  async getPolicyPacks(): Promise<PolicyPack[]> {
    return new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT * FROM policy_packs ORDER BY created_at DESC',
        [],
        (err, rows: PolicyPack[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });
  }

  async getActivePolicyPack(): Promise<PolicyPack | null> {
    return new Promise((resolve, reject) => {
      this.db!.get(
        'SELECT * FROM policy_packs WHERE is_active = 1 LIMIT 1',
        [],
        (err, row: PolicyPack) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || null);
        }
      );
    });
  }

  async setActivePolicyPack(policyPackId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db!.serialize(() => {
        this.db!.run('UPDATE policy_packs SET is_active = 0');
        this.db!.run(
          'UPDATE policy_packs SET is_active = 1 WHERE id = ?',
          [policyPackId],
          (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          }
        );
      });
    });
  }

  // Moderation Rules Methods
  async getModerationRules(policyPackId: number): Promise<ModerationRule[]> {
    return new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT * FROM moderation_rules WHERE policy_pack_id = ? AND enabled = 1',
        [policyPackId],
        (err, rows: ModerationRule[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });
  }

  // Moderation Logs Methods
  async addModerationLog(log: ModerationLog): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db!.prepare(`
        INSERT INTO moderation_logs (
          message_id, channel_id, guild_id, user_id, username, message_content,
          detection_type, rule_triggered, confidence_scores, action_taken,
          reasoning, moderator_id, is_appeal, appeal_reason, appeal_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
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
      ], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.lastID);
      });

      stmt.finalize();
    });
  }

  async getModerationLogByMessageId(messageId: string): Promise<ModerationLog | null> {
    return new Promise((resolve, reject) => {
      this.db!.get(
        'SELECT * FROM moderation_logs WHERE message_id = ? LIMIT 1',
        [messageId],
        (err, row: ModerationLog) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || null);
        }
      );
    });
  }

  // Bot Configuration Methods
  async getBotConfig(guildId: string): Promise<BotConfig | null> {
    return new Promise((resolve, reject) => {
      this.db!.get(
        'SELECT * FROM bot_config WHERE guild_id = ? LIMIT 1',
        [guildId],
        (err, row: BotConfig) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || null);
        }
      );
    });
  }

  async updateBotConfig(config: BotConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db!.prepare(`
        INSERT OR REPLACE INTO bot_config (
          guild_id, discord_token, application_id, public_key, mod_log_channel_id,
          selected_model, ollama_host, active_policy_pack_id, is_enabled, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run([
        config.guild_id,
        config.discord_token,
        config.application_id,
        config.public_key,
        config.mod_log_channel_id,
        config.selected_model,
        config.ollama_host,
        config.active_policy_pack_id,
        config.is_enabled ? 1 : 0
      ], (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });

      stmt.finalize();
    });
  }

  // Message Context Methods (for RAG)
  async addMessageContext(channelId: string, messageId: string, userId: string, content: string, timestamp: Date): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db!.prepare(`
        INSERT OR IGNORE INTO message_context (channel_id, message_id, user_id, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run([channelId, messageId, userId, content, timestamp.toISOString()], (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });

      stmt.finalize();
    });
  }

  async getRecentMessageContext(channelId: string, limit: number = 10): Promise<Array<{user_id: string, content: string, timestamp: string}>> {
    return new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT user_id, content, timestamp FROM message_context WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?',
        [channelId, limit],
        (err, rows: Array<{user_id: string, content: string, timestamp: string}>) => {
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
      this.db!.all(
        'SELECT word_or_phrase, is_regex, severity, action FROM banned_words WHERE policy_pack_id = ? AND enabled = 1',
        [policyPackId],
        (err, rows: Array<{word_or_phrase: string, is_regex: boolean, severity: string, action: string}>) => {
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
    return new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT url_pattern, is_regex, reason, action FROM blocked_urls WHERE policy_pack_id = ? AND enabled = 1',
        [policyPackId],
        (err, rows: Array<{url_pattern: string, is_regex: boolean, reason: string, action: string}>) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });
  }
}