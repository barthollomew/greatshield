import { Logger } from '../utils/Logger';

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheConfig {
  maxSize: number;
  defaultTtl: number; // milliseconds
  cleanupInterval: number; // milliseconds
  enableStats: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  size: number;
  memoryUsage: number;
  hitRate: number;
}

export class CacheManager<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private logger: Logger;
  private config: CacheConfig;
  private cleanupTimer: NodeJS.Timeout;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    size: 0,
    memoryUsage: 0,
    hitRate: 0
  };

  constructor(logger: Logger, config?: Partial<CacheConfig>) {
    this.logger = logger;
    this.config = {
      maxSize: 1000,
      defaultTtl: 5 * 60 * 1000, // 5 minutes
      cleanupInterval: 60 * 1000, // 1 minute
      enableStats: true,
      ...config
    };

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);

    this.logger.info('CacheManager initialized', {
      maxSize: this.config.maxSize,
      defaultTtl: this.config.defaultTtl,
      cleanupInterval: this.config.cleanupInterval
    });
  }

  /**
   * Get a value from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.incrementStat('misses');
      return undefined;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.incrementStat('misses');
      this.incrementStat('evictions');
      return undefined;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    
    this.incrementStat('hits');
    return entry.value;
  }

  /**
   * Set a value in cache
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const entryTtl = ttl ?? this.config.defaultTtl;

    // Check if we need to make room
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: now,
      ttl: entryTtl,
      accessCount: 1,
      lastAccessed: now
    };

    this.cache.set(key, entry);
    this.incrementStat('sets');
    this.updateStats();
  }

  /**
   * Delete a value from cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.incrementStat('deletes');
      this.updateStats();
    }
    return deleted;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.incrementStat('evictions');
      return false;
    }
    
    return true;
  }

  /**
   * Get or set pattern
   */
  async getOrSet(
    key: string, 
    factory: () => T | Promise<T>, 
    ttl?: number
  ): Promise<T> {
    let value = this.get(key);
    
    if (value === undefined) {
      value = await factory();
      this.set(key, value, ttl);
    }
    
    return value;
  }

  /**
   * Update TTL for existing entry
   */
  touch(key: string, ttl?: number): boolean {
    const entry = this.cache.get(key);
    if (!entry || this.isExpired(entry)) {
      return false;
    }

    entry.ttl = ttl ?? this.config.defaultTtl;
    entry.timestamp = Date.now();
    entry.lastAccessed = Date.now();
    
    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.evictions += size;
    this.updateStats();
    
    this.logger.info('Cache cleared', { evictedEntries: size });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get all cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey = '';
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.incrementStat('evictions');
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const beforeSize = this.cache.size;
    let evicted = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      this.stats.evictions += evicted;
      this.updateStats();
      
      this.logger.debug('Cache cleanup completed', {
        beforeSize,
        afterSize: this.cache.size,
        evicted
      });
    }
  }

  /**
   * Increment a statistic counter
   */
  private incrementStat(stat: keyof Pick<CacheStats, 'hits' | 'misses' | 'sets' | 'deletes' | 'evictions'>): void {
    if (this.config.enableStats) {
      this.stats[stat]++;
    }
  }

  /**
   * Update calculated statistics
   */
  private updateStats(): void {
    if (!this.config.enableStats) return;

    this.stats.size = this.cache.size;
    this.stats.memoryUsage = this.estimateMemoryUsage();
    
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Estimate memory usage (rough calculation)
   */
  private estimateMemoryUsage(): number {
    let bytes = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      // Key size (string)
      bytes += key.length * 2; // UTF-16
      
      // Entry object overhead
      bytes += 64; // rough estimate for object overhead
      
      // Value size (rough estimate)
      try {
        const valueStr = JSON.stringify(entry.value);
        bytes += valueStr.length * 2; // UTF-16
      } catch {
        bytes += 100; // fallback estimate
      }
    }
    
    return bytes;
  }

  /**
   * Configure cache settings
   */
  configure(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart cleanup timer if interval changed
    if (config.cleanupInterval) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, this.config.cleanupInterval);
    }

    this.logger.info('Cache configuration updated', this.config);
  }

  /**
   * Export cache data for backup/restore
   */
  export(): Array<{ key: string; entry: CacheEntry<T> }> {
    const exportData: Array<{ key: string; entry: CacheEntry<T> }> = [];

    for (const [key, entry] of this.cache.entries()) {
      // Only export non-expired entries
      if (!this.isExpired(entry)) {
        exportData.push({ key, entry });
      }
    }

    return exportData;
  }

  /**
   * Import cache data from backup
   */
  import(data: Array<{ key: string; entry: CacheEntry<T> }>): number {
    let imported = 0;
    const now = Date.now();

    for (const { key, entry } of data) {
      // Skip expired entries
      if (this.isExpired(entry)) continue;

      // Update timestamps to current time
      entry.lastAccessed = now;
      
      this.cache.set(key, entry);
      imported++;
    }

    this.updateStats();
    this.logger.info('Cache data imported', { 
      totalEntries: data.length, 
      importedEntries: imported 
    });

    return imported;
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cache.clear();
    this.logger.info('CacheManager destroyed');
  }
}