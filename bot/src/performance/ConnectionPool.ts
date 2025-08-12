import Database from 'better-sqlite3';
import { Logger } from '../utils/Logger';

export interface PoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeout: number; // milliseconds
  createRetryDelay: number; // milliseconds
  maxRetries: number;
  idleTimeout: number; // milliseconds
  enableWAL: boolean;
  enableMetrics: boolean;
}

export interface PoolConnection {
  id: string;
  db: Database.Database;
  createdAt: number;
  lastUsed: number;
  useCount: number;
  inUse: boolean;
}

export interface PoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  totalAcquired: number;
  totalReleased: number;
  totalCreated: number;
  totalDestroyed: number;
  averageAcquireTime: number;
  peakConnections: number;
}

export class ConnectionPool {
  private connections: Map<string, PoolConnection> = new Map();
  private availableConnections: string[] = [];
  private waitingQueue: Array<{
    resolve: (connection: PoolConnection) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];
  
  private logger: Logger;
  private config: PoolConfig;
  private dbPath: string;
  private metrics: PoolMetrics;
  private cleanupTimer: NodeJS.Timeout;
  private destroyed = false;

  constructor(dbPath: string, logger: Logger, config?: Partial<PoolConfig>) {
    this.dbPath = dbPath;
    this.logger = logger;
    this.config = {
      maxConnections: 10,
      minConnections: 2,
      acquireTimeout: 30000, // 30 seconds
      createRetryDelay: 1000, // 1 second
      maxRetries: 3,
      idleTimeout: 5 * 60 * 1000, // 5 minutes
      enableWAL: true,
      enableMetrics: true,
      ...config
    };

    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      totalAcquired: 0,
      totalReleased: 0,
      totalCreated: 0,
      totalDestroyed: 0,
      averageAcquireTime: 0,
      peakConnections: 0
    };

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, 60000); // 1 minute

    this.logger.info('Connection pool initialized', {
      dbPath: this.dbPath,
      config: this.config
    });
  }

  /**
   * Initialize the connection pool
   */
  async initialize(): Promise<void> {
    if (this.destroyed) {
      throw new Error('Connection pool has been destroyed');
    }

    try {
      // Create minimum connections
      for (let i = 0; i < this.config.minConnections; i++) {
        await this.createConnection();
      }

      this.logger.info('Connection pool initialized successfully', {
        initialConnections: this.config.minConnections
      });
    } catch (error) {
      this.logger.error('Failed to initialize connection pool', {
        error: String(error)
      });
      throw error;
    }
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PoolConnection> {
    if (this.destroyed) {
      throw new Error('Connection pool has been destroyed');
    }

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from waiting queue
        const index = this.waitingQueue.findIndex(
          req => req.resolve === resolve
        );
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        
        reject(new Error(`Connection acquire timeout after ${this.config.acquireTimeout}ms`));
      }, this.config.acquireTimeout);

      const attemptAcquire = async () => {
        try {
          // Try to get available connection
          if (this.availableConnections.length > 0) {
            const connectionId = this.availableConnections.pop()!;
            const connection = this.connections.get(connectionId);
            
            if (connection && !connection.inUse) {
              connection.inUse = true;
              connection.lastUsed = Date.now();
              connection.useCount++;
              
              this.updateMetrics('acquired', Date.now() - startTime);
              
              clearTimeout(timeout);
              resolve(connection);
              return;
            }
          }

          // Try to create new connection if under limit
          if (this.connections.size < this.config.maxConnections) {
            const connection = await this.createConnection();
            connection.inUse = true;
            connection.lastUsed = Date.now();
            connection.useCount++;
            
            this.updateMetrics('acquired', Date.now() - startTime);
            
            clearTimeout(timeout);
            resolve(connection);
            return;
          }

          // Add to waiting queue
          this.waitingQueue.push({
            resolve,
            reject,
            timestamp: Date.now()
          });

        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      };

      attemptAcquire();
    });
  }

  /**
   * Release a connection back to the pool
   */
  async release(connection: PoolConnection): Promise<void> {
    if (this.destroyed) return;

    if (!connection.inUse) {
      this.logger.warn('Attempting to release connection that is not in use', {
        connectionId: connection.id
      });
      return;
    }

    connection.inUse = false;
    connection.lastUsed = Date.now();

    // Check if there are waiting requests
    if (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        connection.inUse = true;
        connection.useCount++;
        
        this.updateMetrics('acquired', Date.now() - waiter.timestamp);
        waiter.resolve(connection);
        return;
      }
    }

    // Return to available pool
    this.availableConnections.push(connection.id);
    this.updateMetrics('released');

    this.logger.debug('Connection released', {
      connectionId: connection.id,
      availableConnections: this.availableConnections.length
    });
  }

  /**
   * Execute a function with an acquired connection
   */
  async execute<T>(fn: (db: Database.Database) => T | Promise<T>): Promise<T> {
    const connection = await this.acquire();
    
    try {
      return await fn(connection.db);
    } finally {
      await this.release(connection);
    }
  }

  /**
   * Execute a transaction with an acquired connection
   */
  async transaction<T>(fn: (db: Database.Database) => T | Promise<T>): Promise<T> {
    const connection = await this.acquire();
    const transaction = connection.db.transaction(() => fn(connection.db));
    
    try {
      const result = await transaction();
      return result;
    } finally {
      await this.release(connection);
    }
  }

  /**
   * Create a new connection
   */
  private async createConnection(retries = 0): Promise<PoolConnection> {
    try {
      const db = new Database(this.dbPath);
      
      if (this.config.enableWAL) {
        db.pragma('journal_mode = WAL');
      }
      
      // Optimize SQLite settings
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = 1000');
      db.pragma('temp_store = memory');
      db.pragma('mmap_size = 134217728'); // 128MB

      const connection: PoolConnection = {
        id: this.generateConnectionId(),
        db,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        useCount: 0,
        inUse: false
      };

      this.connections.set(connection.id, connection);
      this.availableConnections.push(connection.id);
      
      this.updateMetrics('created');
      
      this.logger.debug('Connection created', {
        connectionId: connection.id,
        totalConnections: this.connections.size
      });

      return connection;

    } catch (error) {
      this.logger.error('Failed to create database connection', {
        error: String(error),
        retries,
        dbPath: this.dbPath
      });

      if (retries < this.config.maxRetries) {
        await this.delay(this.config.createRetryDelay);
        return this.createConnection(retries + 1);
      }

      throw new Error(`Failed to create connection after ${retries + 1} attempts: ${error}`);
    }
  }

  /**
   * Close and remove a connection
   */
  private async destroyConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    try {
      connection.db.close();
    } catch (error) {
      this.logger.warn('Error closing database connection', {
        connectionId,
        error: String(error)
      });
    }

    this.connections.delete(connectionId);
    
    // Remove from available connections
    const index = this.availableConnections.indexOf(connectionId);
    if (index !== -1) {
      this.availableConnections.splice(index, 1);
    }

    this.updateMetrics('destroyed');
    
    this.logger.debug('Connection destroyed', {
      connectionId,
      totalConnections: this.connections.size
    });
  }

  /**
   * Clean up idle connections
   */
  private async cleanupIdleConnections(): Promise<void> {
    if (this.destroyed) return;

    const now = Date.now();
    const connectionsToDestroy: string[] = [];

    for (const [id, connection] of this.connections) {
      // Don't destroy connections currently in use
      if (connection.inUse) continue;

      // Don't go below minimum connections
      if (this.connections.size - connectionsToDestroy.length <= this.config.minConnections) {
        break;
      }

      // Check if connection is idle for too long
      if (now - connection.lastUsed > this.config.idleTimeout) {
        connectionsToDestroy.push(id);
      }
    }

    for (const id of connectionsToDestroy) {
      await this.destroyConnection(id);
    }

    if (connectionsToDestroy.length > 0) {
      this.logger.debug('Cleaned up idle connections', {
        destroyed: connectionsToDestroy.length,
        remaining: this.connections.size
      });
    }
  }

  /**
   * Update metrics
   */
  private updateMetrics(
    action: 'acquired' | 'released' | 'created' | 'destroyed',
    acquireTime?: number
  ): void {
    if (!this.config.enableMetrics) return;

    switch (action) {
      case 'acquired':
        this.metrics.totalAcquired++;
        if (acquireTime !== undefined) {
          // Simple moving average
          this.metrics.averageAcquireTime = 
            (this.metrics.averageAcquireTime * 0.9) + (acquireTime * 0.1);
        }
        break;
      case 'released':
        this.metrics.totalReleased++;
        break;
      case 'created':
        this.metrics.totalCreated++;
        break;
      case 'destroyed':
        this.metrics.totalDestroyed++;
        break;
    }

    this.metrics.totalConnections = this.connections.size;
    this.metrics.activeConnections = Array.from(this.connections.values())
      .filter(conn => conn.inUse).length;
    this.metrics.idleConnections = this.availableConnections.length;
    this.metrics.peakConnections = Math.max(
      this.metrics.peakConnections,
      this.metrics.totalConnections
    );
  }

  /**
   * Get pool statistics
   */
  getMetrics(): PoolMetrics {
    this.updateMetrics('acquired', 0); // Update current counts
    return { ...this.metrics };
  }

  /**
   * Get pool status
   */
  getStatus(): {
    totalConnections: number;
    activeConnections: number;
    availableConnections: number;
    waitingRequests: number;
    isHealthy: boolean;
  } {
    const activeConnections = Array.from(this.connections.values())
      .filter(conn => conn.inUse).length;

    return {
      totalConnections: this.connections.size,
      activeConnections,
      availableConnections: this.availableConnections.length,
      waitingRequests: this.waitingQueue.length,
      isHealthy: !this.destroyed && this.connections.size >= this.config.minConnections
    };
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Health check - test a connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      const connection = await this.acquire();
      
      try {
        // Simple query to test connection
        connection.db.prepare('SELECT 1').get();
        return true;
      } finally {
        await this.release(connection);
      }
    } catch (error) {
      this.logger.error('Health check failed', { error: String(error) });
      return false;
    }
  }

  /**
   * Destroy the connection pool
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    
    this.destroyed = true;

    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Reject all waiting requests
    while (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        waiter.reject(new Error('Connection pool is being destroyed'));
      }
    }

    // Close all connections
    const connectionIds = Array.from(this.connections.keys());
    for (const id of connectionIds) {
      await this.destroyConnection(id);
    }

    this.logger.info('Connection pool destroyed', {
      closedConnections: connectionIds.length
    });
  }
}