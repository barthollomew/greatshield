import Database from 'better-sqlite3';
import { Logger } from '../utils/Logger';

export interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  unique?: boolean;
  where?: string;
  priority: 'high' | 'medium' | 'low';
}

export interface OptimizationResult {
  indexesCreated: number;
  indexesSkipped: number;
  vacuumPerformed: boolean;
  analyzePerformed: boolean;
  pragmasOptimized: number;
  executionTime: number;
}

export interface TableStats {
  name: string;
  rowCount: number;
  pageCount: number;
  averageRowSize: number;
  indexes: string[];
}

export class DatabaseOptimizer {
  private logger: Logger;
  private db: Database.Database;

  // Predefined indexes for Greatshield tables
  private readonly RECOMMENDED_INDEXES: IndexDefinition[] = [
    // Message context indexes
    {
      name: 'idx_message_context_channel_timestamp',
      table: 'message_context',
      columns: ['channel_id', 'timestamp'],
      priority: 'high'
    },
    {
      name: 'idx_message_context_user_timestamp',
      table: 'message_context',
      columns: ['user_id', 'timestamp'],
      priority: 'medium'
    },

    // Moderation logs indexes
    {
      name: 'idx_moderation_logs_message_id',
      table: 'moderation_logs',
      columns: ['message_id'],
      unique: true,
      priority: 'high'
    },
    {
      name: 'idx_moderation_logs_user_processed',
      table: 'moderation_logs',
      columns: ['user_id', 'processed_at'],
      priority: 'high'
    },
    {
      name: 'idx_moderation_logs_channel_processed',
      table: 'moderation_logs',
      columns: ['channel_id', 'processed_at'],
      priority: 'medium'
    },
    {
      name: 'idx_moderation_logs_detection_type',
      table: 'moderation_logs',
      columns: ['detection_type'],
      priority: 'low'
    },
    {
      name: 'idx_moderation_logs_action_taken',
      table: 'moderation_logs',
      columns: ['action_taken'],
      priority: 'low'
    },
    {
      name: 'idx_moderation_logs_appeal_status',
      table: 'moderation_logs',
      columns: ['appeal_status'],
      where: 'appeal_status IS NOT NULL',
      priority: 'medium'
    },

    // Policy pack indexes
    {
      name: 'idx_policy_packs_active',
      table: 'policy_packs',
      columns: ['is_active'],
      where: 'is_active = 1',
      priority: 'high'
    },

    // Moderation rules indexes
    {
      name: 'idx_moderation_rules_policy_type',
      table: 'moderation_rules',
      columns: ['policy_pack_id', 'rule_type'],
      priority: 'high'
    },
    {
      name: 'idx_moderation_rules_enabled',
      table: 'moderation_rules',
      columns: ['enabled'],
      where: 'enabled = 1',
      priority: 'medium'
    },

    // Banned words indexes
    {
      name: 'idx_banned_words_policy_enabled',
      table: 'banned_words',
      columns: ['policy_pack_id', 'enabled'],
      where: 'enabled = 1',
      priority: 'high'
    },
    {
      name: 'idx_banned_words_severity',
      table: 'banned_words',
      columns: ['severity'],
      priority: 'low'
    },

    // Blocked URLs indexes
    {
      name: 'idx_blocked_urls_policy_enabled',
      table: 'blocked_urls',
      columns: ['policy_pack_id', 'enabled'],
      where: 'enabled = 1',
      priority: 'high'
    },

    // Bot config indexes
    {
      name: 'idx_bot_config_guild_enabled',
      table: 'bot_config',
      columns: ['guild_id', 'is_enabled'],
      priority: 'high'
    },

    // Rate limit violations indexes
    {
      name: 'idx_rate_limit_violations_user_timestamp',
      table: 'rate_limit_violations',
      columns: ['user_id', 'timestamp'],
      priority: 'high'
    },
    {
      name: 'idx_rate_limit_violations_channel_timestamp',
      table: 'rate_limit_violations',
      columns: ['channel_id', 'timestamp'],
      priority: 'medium'
    },
    {
      name: 'idx_rate_limit_violations_type',
      table: 'rate_limit_violations',
      columns: ['violation_type'],
      priority: 'low'
    }
  ];

  constructor(db: Database.Database, logger: Logger) {
    this.db = db;
    this.logger = logger;
  }

  /**
   * Perform comprehensive database optimization
   */
  async optimize(): Promise<OptimizationResult> {
    const startTime = Date.now();
    
    this.logger.info('Starting database optimization');

    const result: OptimizationResult = {
      indexesCreated: 0,
      indexesSkipped: 0,
      vacuumPerformed: false,
      analyzePerformed: false,
      pragmasOptimized: 0,
      executionTime: 0
    };

    try {
      // Step 1: Optimize pragma settings
      result.pragmasOptimized = await this.optimizePragmas();

      // Step 2: Create recommended indexes
      const indexResult = await this.createRecommendedIndexes();
      result.indexesCreated = indexResult.created;
      result.indexesSkipped = indexResult.skipped;

      // Step 3: Analyze tables for query planner
      result.analyzePerformed = await this.analyzeTables();

      // Step 4: Vacuum database if needed
      result.vacuumPerformed = await this.vacuumIfNeeded();

      result.executionTime = Date.now() - startTime;

      this.logger.info('Database optimization completed', result);

      return result;

    } catch (error) {
      this.logger.error('Database optimization failed', {
        error: String(error),
        partialResult: result
      });
      throw error;
    }
  }

  /**
   * Optimize SQLite pragma settings
   */
  private async optimizePragmas(): Promise<number> {
    const pragmas = [
      // WAL mode for better concurrency
      { name: 'journal_mode', value: 'WAL' },
      
      // Normal synchronization for better performance
      { name: 'synchronous', value: 'NORMAL' },
      
      // Increase cache size (1000 pages = ~4MB with 4KB page size)
      { name: 'cache_size', value: '1000' },
      
      // Use memory for temporary tables
      { name: 'temp_store', value: 'memory' },
      
      // Enable memory mapping (128MB)
      { name: 'mmap_size', value: '134217728' },
      
      // Optimize for read-heavy workloads
      { name: 'optimize', value: null }
    ];

    let optimized = 0;

    for (const pragma of pragmas) {
      try {
        if (pragma.value) {
          this.db.pragma(`${pragma.name} = ${pragma.value}`);
        } else {
          this.db.pragma(pragma.name);
        }
        optimized++;
        
        this.logger.debug('Pragma optimized', {
          name: pragma.name,
          value: pragma.value
        });
      } catch (error) {
        this.logger.warn('Failed to set pragma', {
          name: pragma.name,
          value: pragma.value,
          error: String(error)
        });
      }
    }

    return optimized;
  }

  /**
   * Create recommended indexes
   */
  private async createRecommendedIndexes(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    // Sort by priority
    const sortedIndexes = this.RECOMMENDED_INDEXES.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const indexDef of sortedIndexes) {
      try {
        // Check if table exists
        if (!this.tableExists(indexDef.table)) {
          this.logger.debug('Skipping index for non-existent table', {
            table: indexDef.table,
            index: indexDef.name
          });
          skipped++;
          continue;
        }

        // Check if index already exists
        if (this.indexExists(indexDef.name)) {
          this.logger.debug('Index already exists', { index: indexDef.name });
          skipped++;
          continue;
        }

        // Create the index
        await this.createIndex(indexDef);
        created++;

      } catch (error) {
        this.logger.warn('Failed to create index', {
          index: indexDef.name,
          error: String(error)
        });
        skipped++;
      }
    }

    return { created, skipped };
  }

  /**
   * Create a single index
   */
  private async createIndex(indexDef: IndexDefinition): Promise<void> {
    const unique = indexDef.unique ? 'UNIQUE ' : '';
    const columns = indexDef.columns.join(', ');
    const whereClause = indexDef.where ? ` WHERE ${indexDef.where}` : '';

    const sql = `CREATE ${unique}INDEX ${indexDef.name} ON ${indexDef.table} (${columns})${whereClause}`;

    this.logger.debug('Creating index', {
      name: indexDef.name,
      table: indexDef.table,
      columns: indexDef.columns,
      sql
    });

    this.db.exec(sql);

    this.logger.info('Index created successfully', {
      name: indexDef.name,
      table: indexDef.table
    });
  }

  /**
   * Analyze tables for query optimization
   */
  private async analyzeTables(): Promise<boolean> {
    try {
      this.logger.debug('Running ANALYZE to update query planner statistics');
      
      this.db.exec('ANALYZE');

      this.logger.info('Table analysis completed');
      return true;

    } catch (error) {
      this.logger.error('Failed to analyze tables', {
        error: String(error)
      });
      return false;
    }
  }

  /**
   * Vacuum database if needed
   */
  private async vacuumIfNeeded(): Promise<boolean> {
    try {
      // Check if vacuum is needed by looking at fragmentation
      const pageCounts = this.db.pragma('page_count');
      const freelistCount = this.db.pragma('freelist_count');
      
      if (typeof pageCounts === 'number' && typeof freelistCount === 'number') {
        const fragmentationRatio = freelistCount / pageCounts;
        
        // Vacuum if more than 10% fragmentation
        if (fragmentationRatio > 0.1) {
          this.logger.info('Running VACUUM to defragment database', {
            pageCount: pageCounts,
            freelistCount,
            fragmentationRatio: Math.round(fragmentationRatio * 100) / 100
          });

          this.db.exec('VACUUM');
          
          this.logger.info('Database vacuum completed');
          return true;
        } else {
          this.logger.debug('Vacuum not needed', {
            fragmentationRatio: Math.round(fragmentationRatio * 100) / 100
          });
        }
      }

      return false;

    } catch (error) {
      this.logger.error('Failed to vacuum database', {
        error: String(error)
      });
      return false;
    }
  }

  /**
   * Get database statistics
   */
  async getTableStats(): Promise<TableStats[]> {
    const stats: TableStats[] = [];

    try {
      // Get all tables
      const tables = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).all() as Array<{ name: string }>;

      for (const table of tables) {
        try {
          // Get row count
          const rowCount = this.db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
          
          // Get page count
          const pageCount = this.db.pragma(`page_count`) as number;
          
          // Get indexes for this table
          const indexes = this.db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'
          `).all(table.name) as Array<{ name: string }>;

          stats.push({
            name: table.name,
            rowCount: rowCount.count,
            pageCount: pageCount,
            averageRowSize: rowCount.count > 0 ? (pageCount * 4096) / rowCount.count : 0,
            indexes: indexes.map(idx => idx.name)
          });

        } catch (error) {
          this.logger.warn('Failed to get stats for table', {
            table: table.name,
            error: String(error)
          });
        }
      }

    } catch (error) {
      this.logger.error('Failed to get table statistics', {
        error: String(error)
      });
    }

    return stats;
  }

  /**
   * Check if table exists
   */
  private tableExists(tableName: string): boolean {
    try {
      const result = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' AND name = ?
      `).get(tableName);

      return !!result;
    } catch {
      return false;
    }
  }

  /**
   * Check if index exists
   */
  private indexExists(indexName: string): boolean {
    try {
      const result = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type = 'index' AND name = ?
      `).get(indexName);

      return !!result;
    } catch {
      return false;
    }
  }

  /**
   * Get query execution plan
   */
  async explainQuery(sql: string): Promise<any[]> {
    try {
      const plan = this.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
      return plan;
    } catch (error) {
      this.logger.error('Failed to get query plan', {
        sql,
        error: String(error)
      });
      return [];
    }
  }

  /**
   * Analyze slow queries and suggest optimizations
   */
  async analyzeSlowQueries(): Promise<{
    suggestions: string[];
    missingIndexes: IndexDefinition[];
  }> {
    const suggestions: string[] = [];
    const missingIndexes: IndexDefinition[] = [];

    // Check for tables without indexes
    const stats = await this.getTableStats();
    
    for (const table of stats) {
      if (table.rowCount > 1000 && table.indexes.length === 0) {
        suggestions.push(`Table '${table.name}' has ${table.rowCount} rows but no indexes`);
      }

      if (table.rowCount > 10000 && table.averageRowSize > 1000) {
        suggestions.push(`Table '${table.name}' has large rows (${Math.round(table.averageRowSize)} bytes avg) - consider normalization`);
      }
    }

    // Check for missing recommended indexes
    for (const indexDef of this.RECOMMENDED_INDEXES) {
      if (this.tableExists(indexDef.table) && !this.indexExists(indexDef.name)) {
        missingIndexes.push(indexDef);
      }
    }

    return { suggestions, missingIndexes };
  }

  /**
   * Get database health metrics
   */
  async getHealthMetrics(): Promise<{
    databaseSize: number;
    pageSize: number;
    pageCount: number;
    freePages: number;
    fragmentationRatio: number;
    walSize?: number;
    indexCount: number;
    tableCount: number;
  }> {
    try {
      const pageSize = this.db.pragma('page_size') as number;
      const pageCount = this.db.pragma('page_count') as number;
      const freelistCount = this.db.pragma('freelist_count') as number;
      
      // Try to get WAL size
      let walSize: number | undefined;
      try {
        walSize = this.db.pragma('wal_checkpoint(PASSIVE)') as number;
      } catch {
        // WAL mode might not be active
      }

      // Count indexes and tables
      const counts = this.db.prepare(`
        SELECT 
          SUM(CASE WHEN type = 'index' AND name NOT LIKE 'sqlite_%' THEN 1 ELSE 0 END) as index_count,
          SUM(CASE WHEN type = 'table' AND name NOT LIKE 'sqlite_%' THEN 1 ELSE 0 END) as table_count
        FROM sqlite_master
      `).get() as { index_count: number; table_count: number };

      const result: any = {
        databaseSize: pageSize * pageCount,
        pageSize,
        pageCount,
        freePages: freelistCount,
        fragmentationRatio: freelistCount / pageCount,
        indexCount: counts.index_count || 0,
        tableCount: counts.table_count || 0
      };

      if (walSize !== undefined) {
        result.walSize = walSize;
      }

      return result;

    } catch (error) {
      this.logger.error('Failed to get health metrics', {
        error: String(error)
      });
      throw error;
    }
  }
}