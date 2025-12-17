import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { IDatabaseManager } from '../core/interfaces/IDatabaseManager';
import { CacheManager } from '../performance/CacheManager';
import { ConnectionPool } from '../performance/ConnectionPool';
import { DatabaseOptimizer } from '../performance/DatabaseOptimizer';
import { Logger } from '../utils/Logger';

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

export class DatabaseManager implements IDatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string;
  private logger: Logger;
  private cache: CacheManager;
  private connectionPool?: ConnectionPool;
  private optimizer?: DatabaseOptimizer;
  private enablePerformanceFeatures: boolean;

  constructor(dbPath: string = './greatshield.db', enablePerformanceFeatures: boolean = true) {
    this.dbPath = path.resolve(dbPath);
    this.logger = new Logger('DatabaseManager');
    this.cache = new CacheManager(this.logger, {
      maxSize: 500,
      defaultTtl: 5 * 60 * 1000, // 5 minutes
      enableStats: true
    });
    this.enablePerformanceFeatures = enablePerformanceFeatures;
  }

  async initialize(): Promise<void> {
    try {
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      if (this.enablePerformanceFeatures) {
        // Initialize connection pool
        this.connectionPool = new ConnectionPool(this.dbPath, this.logger, {
          maxConnections: 10,
          minConnections: 2,
          acquireTimeout: 30000,
          idleTimeout: 5 * 60 * 1000
        });
        
        await this.connectionPool.initialize();
        
        // Get primary connection for setup
        const connection = await this.connectionPool.acquire();
        this.db = connection.db;
        
        // Don't release yet - we need it for setup
        await this.createTables();
        await this.seedDatabase();
        
        // Initialize optimizer
        this.optimizer = new DatabaseOptimizer(this.db, this.logger);
        
        // Run optimization
        await this.optimizer.optimize();
        
        // Now release the connection
        await this.connectionPool.release(connection);
        
        this.logger.info('Database initialized with performance features enabled');
      } else {
        // Simple initialization without performance features
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');

        await this.createTables();
        await this.seedDatabase();
        
        this.logger.info('Database initialized with basic configuration');
      }
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
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    try {
      const transaction = this.db.transaction(() => {
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
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    const cacheKey = `moderation_rules_${policyPackId}`;
    
    try {
      return await this.cache.getOrSet(cacheKey, async () => {
        if (this.connectionPool) {
          return await this.connectionPool.execute((db) => {
            const stmt = db.prepare('SELECT * FROM moderation_rules WHERE policy_pack_id = ? AND enabled = 1');
            return stmt.all(policyPackId) as ModerationRule[];
          });
        } else {
          const stmt = this.db!.prepare('SELECT * FROM moderation_rules WHERE policy_pack_id = ? AND enabled = 1');
          return stmt.all(policyPackId) as ModerationRule[];
        }
      }, 10 * 60 * 1000); // Cache for 10 minutes
    } catch (error) {
      throw new Error(`Failed to get moderation rules: ${error}`);
    }
  }

  // Moderation Logs Methods
  async addModerationLog(log: ModerationLog): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
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
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    try {
      const stmt = this.db.prepare('SELECT * FROM moderation_logs WHERE message_id = ? LIMIT 1');
      return (stmt.get(messageId) as ModerationLog) || null;
    } catch (error) {
      throw new Error(`Failed to get moderation log: ${error}`);
    }
  }

  // Bot Configuration Methods
  async getBotConfig(guildId: string): Promise<BotConfig | null> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
      try {
        const stmt = this.db.prepare('SELECT * FROM bot_config WHERE guild_id = ? LIMIT 1');
        return (stmt.get(guildId) as BotConfig) || null;
      } catch (error) {
        throw new Error(`Failed to get bot config: ${error}`);
      }
    }

  async getFirstBotConfig(): Promise<BotConfig | null> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    try {
      const stmt = this.db.prepare('SELECT * FROM bot_config ORDER BY updated_at DESC LIMIT 1');
      return (stmt.get() as BotConfig) || null;
    } catch (error) {
      throw new Error(`Failed to get default bot config: ${error}`);
    }
  }

  async updateBotConfig(config: BotConfig): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
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
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO message_context (channel_id, message_id, user_id, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run(channelId, messageId, userId, content, timestamp.toISOString());
    } catch (error) {
      throw new Error(`Failed to add message context: ${error}`);
    }
  }

  async getRecentMessageContext(channelId: string, limit: number = 10): Promise<Array<{user_id: string, content: string, timestamp: string}>> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    try {
      const stmt = this.db.prepare('SELECT user_id, content, timestamp FROM message_context WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?');
      return stmt.all(channelId, limit) as Array<{user_id: string, content: string, timestamp: string}>;
    } catch (error) {
      throw new Error(`Failed to get recent message context: ${error}`);
    }
  }

  // Banned Words Methods
  async getBannedWords(policyPackId: number): Promise<Array<{word_or_phrase: string, is_regex: boolean, severity: string, action: string}>> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    const cacheKey = `banned_words_${policyPackId}`;
    
    try {
      return await this.cache.getOrSet(cacheKey, async () => {
        if (this.connectionPool) {
          return await this.connectionPool.execute((db) => {
            const stmt = db.prepare('SELECT word_or_phrase, is_regex, severity, action FROM banned_words WHERE policy_pack_id = ? AND enabled = 1');
            return stmt.all(policyPackId) as Array<{word_or_phrase: string, is_regex: boolean, severity: string, action: string}>;
          });
        } else {
          const stmt = this.db!.prepare('SELECT word_or_phrase, is_regex, severity, action FROM banned_words WHERE policy_pack_id = ? AND enabled = 1');
          return stmt.all(policyPackId) as Array<{word_or_phrase: string, is_regex: boolean, severity: string, action: string}>;
        }
      }, 15 * 60 * 1000); // Cache for 15 minutes
    } catch (error) {
      throw new Error(`Failed to get banned words: ${error}`);
    }
  }

  // Blocked URLs Methods
  async getBlockedUrls(policyPackId: number): Promise<Array<{url_pattern: string, is_regex: boolean, reason: string, action: string}>> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    try {
      const stmt = this.db.prepare('SELECT url_pattern, is_regex, reason, action FROM blocked_urls WHERE policy_pack_id = ? AND enabled = 1');
      return stmt.all(policyPackId) as Array<{url_pattern: string, is_regex: boolean, reason: string, action: string}>;
    } catch (error) {
      throw new Error(`Failed to get blocked URLs: ${error}`);
    }
  }

  // Rate Limit Violation Logging
  async logRateLimitViolation(userId: string, channelId: string, violationType: string, violationCount: number): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    
    try {
      // Create rate_limit_violations table if it doesn't exist
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS rate_limit_violations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          violation_type TEXT NOT NULL,
          violation_count INTEGER NOT NULL,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          INDEX idx_user_timestamp (user_id, timestamp),
          INDEX idx_channel_timestamp (channel_id, timestamp)
        )
      `).run();

      const stmt = this.db.prepare(`
        INSERT INTO rate_limit_violations (user_id, channel_id, violation_type, violation_count)
        VALUES (?, ?, ?, ?)
      `);
      
      stmt.run(userId, channelId, violationType, violationCount);
    } catch (error) {
      throw new Error(`Failed to log rate limit violation: ${error}`);
    }
  }

  // Performance and cache management methods
  
  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    cache: any;
    connectionPool?: any;
    optimizer?: any;
  } {
    const stats: any = {
      cache: this.cache.getStats()
    };

    if (this.connectionPool) {
      stats.connectionPool = this.connectionPool.getMetrics();
    }

    if (this.optimizer) {
      stats.optimizer = {
        available: true,
        // Add optimizer-specific stats here if needed
      };
    }

    return stats;
  }

  /**
   * Clear cache for specific keys or all cache
   */
  clearCache(pattern?: string): void {
    if (pattern) {
      // Clear specific cache entries matching pattern
      const keys = this.cache.keys();
      for (const key of keys) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
      this.logger.info('Cache cleared for pattern', { pattern });
    } else {
      this.cache.clear();
      this.logger.info('All cache cleared');
    }
  }

  /**
   * Optimize database performance
   */
  async optimizeDatabase(): Promise<any> {
    if (!this.optimizer) {
      throw new Error('Database optimizer not available');
    }
    
    return await this.optimizer.optimize();
  }

  /**
   * Get database health metrics
   */
  async getHealthMetrics(): Promise<any> {
    if (!this.optimizer) {
      throw new Error('Database optimizer not available');
    }
    
    return await this.optimizer.getHealthMetrics();
  }

  /**
   * Check connection pool health
   */
  getConnectionPoolStatus(): any {
    if (!this.connectionPool) {
      return { available: false };
    }
    
    return this.connectionPool.getStatus();
  }


  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    this.logger.info('Closing database manager');
    
    // Clean up cache
    this.cache.destroy();
    
    // Clean up connection pool
    if (this.connectionPool) {
      await this.connectionPool.destroy();
    }
    
    // Close direct connection if exists
    if (this.db && !this.connectionPool) {
      this.db.close();
      this.db = null;
    }
    
    this.logger.info('Database manager closed');
  }
}
