import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { DatabaseManager } from '../database/DatabaseManager';
import { StructuredLogger, LogLevel } from '../utils/StructuredLogger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/ErrorHandler';
import { Logger } from '../utils/Logger';

export interface BackupConfig {
  enabled: boolean;
  schedule: {
    enabled: boolean;
    interval: number; // milliseconds
    retentionDays: number;
  };
  storage: {
    local: {
      enabled: boolean;
      path: string;
      compress: boolean;
    };
    remote?: {
      enabled: boolean;
      type: 's3' | 'ftp' | 'webhook';
      config: Record<string, any>;
    };
  };
  include: {
    database: boolean;
    configuration: boolean;
    logs: boolean;
    policies: boolean;
  };
}

export interface BackupMetadata {
  id: string;
  timestamp: Date;
  size: number;
  compressed: boolean;
  checksum: string;
  components: string[];
  version: string;
}

export interface BackupInfo extends BackupMetadata {
  filePath: string;
  isValid: boolean;
  canRestore: boolean;
}

export interface RestoreOptions {
  backupId: string;
  components?: string[];
  overwrite: boolean;
  createBackupBeforeRestore: boolean;
}

export interface RestoreResult {
  success: boolean;
  restoredComponents: string[];
  errors: string[];
  preRestoreBackupId?: string;
}

export class BackupManager {
  private logger: StructuredLogger;
  private errorHandler: ErrorHandler;
  private db?: DatabaseManager;
  private config: BackupConfig;
  private scheduleTimer?: NodeJS.Timeout;
  private isRunning = false;
  private backupInProgress = false;

  constructor(logger: Logger, config?: Partial<BackupConfig>) {
    this.logger = new StructuredLogger({
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: true,
      filePath: './logs/backup.log'
    });
    
    this.errorHandler = logger.getErrorHandler() || new ErrorHandler(logger);
    
    this.config = {
      enabled: true,
      schedule: {
        enabled: true,
        interval: 24 * 60 * 60 * 1000, // 24 hours
        retentionDays: 30
      },
      storage: {
        local: {
          enabled: true,
          path: './backups',
          compress: true
        }
      },
      include: {
        database: true,
        configuration: true,
        logs: false,
        policies: true
      },
      ...config
    };
  }

  /**
   * Initialize backup manager
   */
  async initialize(db?: DatabaseManager): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Backup manager already running', {
        component: 'backup_manager'
      });
      return;
    }

    this.logger.info('Initializing backup manager', {
      component: 'backup_manager',
      operation: 'initialize'
    });

    try {
      this.db = db;
      
      // Create backup directories
      await this.createBackupDirectories();
      
      // Clean up old backups
      await this.cleanupOldBackups();
      
      // Start scheduled backups if enabled
      if (this.config.enabled && this.config.schedule.enabled) {
        this.startScheduledBackups();
      }
      
      this.isRunning = true;
      
      this.logger.info('Backup manager initialized successfully', {
        component: 'backup_manager',
        metadata: {
          scheduleEnabled: this.config.schedule.enabled,
          retentionDays: this.config.schedule.retentionDays
        }
      });

    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.RESOURCE,
        ErrorSeverity.CRITICAL,
        {
          operation: 'initialize',
          component: 'backup_manager'
        }
      );
      throw error;
    }
  }

  /**
   * Create a full backup
   */
  async createBackup(components?: string[]): Promise<BackupMetadata | null> {
    if (this.backupInProgress) {
      this.logger.warn('Backup already in progress', {
        component: 'backup_manager'
      });
      return null;
    }

    this.backupInProgress = true;
    const backupId = this.generateBackupId();
    
    this.logger.info('Starting backup creation', {
      component: 'backup_manager',
      operation: 'create_backup',
      metadata: { backupId, components }
    });

    try {
      const backupPath = this.getBackupPath(backupId);
      const tempPath = `${backupPath}.tmp`;
      
      // Create temporary backup directory
      await fs.mkdir(tempPath, { recursive: true });
      
      const includedComponents: string[] = [];
      let totalSize = 0;

      // Backup database
      if ((!components || components.includes('database')) && this.config.include.database && this.db) {
        await this.backupDatabase(path.join(tempPath, 'database.db'));
        includedComponents.push('database');
        
        const dbStats = await fs.stat(path.join(tempPath, 'database.db'));
        totalSize += dbStats.size;
      }

      // Backup configuration
      if ((!components || components.includes('configuration')) && this.config.include.configuration) {
        await this.backupConfiguration(tempPath);
        includedComponents.push('configuration');
        
        try {
          const configStats = await fs.stat(path.join(tempPath, 'config'));
          totalSize += this.getDirectorySize(path.join(tempPath, 'config'));
        } catch (error) {
          // Config directory might not exist
        }
      }

      // Backup policies
      if ((!components || components.includes('policies')) && this.config.include.policies && this.db) {
        await this.backupPolicies(path.join(tempPath, 'policies.json'));
        includedComponents.push('policies');
        
        const policiesStats = await fs.stat(path.join(tempPath, 'policies.json'));
        totalSize += policiesStats.size;
      }

      // Backup logs
      if ((!components || components.includes('logs')) && this.config.include.logs) {
        await this.backupLogs(tempPath);
        includedComponents.push('logs');
        
        try {
          totalSize += await this.getDirectorySize(path.join(tempPath, 'logs'));
        } catch (error) {
          // Logs directory might not exist
        }
      }

      // Create metadata
      const metadata: BackupMetadata = {
        id: backupId,
        timestamp: new Date(),
        size: totalSize,
        compressed: this.config.storage.local.compress,
        checksum: await this.calculateChecksum(tempPath),
        components: includedComponents,
        version: '1.0.0'
      };

      // Save metadata
      await fs.writeFile(
        path.join(tempPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );

      // Compress backup if enabled
      if (this.config.storage.local.compress) {
        await this.compressBackup(tempPath, `${backupPath}.tar.gz`);
        await fs.rm(tempPath, { recursive: true, force: true });
      } else {
        await fs.rename(tempPath, backupPath);
      }

      this.logger.info('Backup created successfully', {
        component: 'backup_manager',
        metadata: {
          backupId,
          size: totalSize,
          components: includedComponents,
          compressed: this.config.storage.local.compress
        }
      });

      return metadata;

    } catch (error) {
      // Clean up on error
      try {
        await fs.rm(tempPath, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        {
          operation: 'create_backup',
          component: 'backup_manager',
          metadata: { backupId }
        }
      );
      
      return null;

    } finally {
      this.backupInProgress = false;
    }
  }

  /**
   * List available backups
   */
  async listBackups(): Promise<BackupInfo[]> {
    try {
      const backupsPath = this.config.storage.local.path;
      
      if (!await this.directoryExists(backupsPath)) {
        return [];
      }

      const entries = await fs.readdir(backupsPath, { withFileTypes: true });
      const backups: BackupInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory() || entry.name.endsWith('.tar.gz')) {
          try {
            const backupPath = path.join(backupsPath, entry.name);
            const metadata = await this.getBackupMetadata(backupPath);
            
            if (metadata) {
              const stats = await fs.stat(backupPath);
              backups.push({
                ...metadata,
                filePath: backupPath,
                isValid: await this.validateBackup(backupPath),
                canRestore: true
              });
            }
          } catch (error) {
            // Skip invalid backup
            this.logger.warn('Invalid backup found', {
              component: 'backup_manager',
              metadata: { backupName: entry.name }
            });
          }
        }
      }

      return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.RESOURCE,
        ErrorSeverity.MEDIUM,
        {
          operation: 'list_backups',
          component: 'backup_manager'
        }
      );
      return [];
    }
  }

  /**
   * Restore from backup
   */
  async restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
    this.logger.info('Starting backup restore', {
      component: 'backup_manager',
      operation: 'restore_backup',
      metadata: { backupId: options.backupId, components: options.components }
    });

    const result: RestoreResult = {
      success: false,
      restoredComponents: [],
      errors: []
    };

    try {
      // Find backup
      const backups = await this.listBackups();
      const backup = backups.find(b => b.id === options.backupId);
      
      if (!backup) {
        result.errors.push(`Backup not found: ${options.backupId}`);
        return result;
      }

      // Validate backup
      if (!backup.isValid) {
        result.errors.push('Backup is corrupted or invalid');
        return result;
      }

      // Create pre-restore backup if requested
      if (options.createBackupBeforeRestore) {
        const preBackup = await this.createBackup();
        if (preBackup) {
          result.preRestoreBackupId = preBackup.id;
        }
      }

      // Extract backup if compressed
      const workingPath = await this.prepareBackupForRestore(backup);
      
      try {
        // Restore components
        const componentsToRestore = options.components || backup.components;
        
        for (const component of componentsToRestore) {
          try {
            await this.restoreComponent(component, workingPath, options.overwrite);
            result.restoredComponents.push(component);
          } catch (error) {
            const errorMsg = `Failed to restore ${component}: ${error}`;
            result.errors.push(errorMsg);
            
            this.logger.error(`Component restore failed`, {
              component: 'backup_manager',
              metadata: { backupId: options.backupId, componentName: component }
            });
          }
        }

        result.success = result.restoredComponents.length > 0 && result.errors.length === 0;

        this.logger.info('Backup restore completed', {
          component: 'backup_manager',
          metadata: {
            backupId: options.backupId,
            success: result.success,
            restoredComponents: result.restoredComponents,
            errorsCount: result.errors.length
          }
        });

      } finally {
        // Clean up working directory
        if (backup.compressed) {
          await fs.rm(workingPath, { recursive: true, force: true });
        }
      }

      return result;

    } catch (error) {
      const errorMsg = `Restore operation failed: ${error}`;
      result.errors.push(errorMsg);

      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        {
          operation: 'restore_backup',
          component: 'backup_manager',
          metadata: { backupId: options.backupId }
        }
      );

      return result;
    }
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<boolean> {
    try {
      const backups = await this.listBackups();
      const backup = backups.find(b => b.id === backupId);
      
      if (!backup) {
        return false;
      }

      await fs.rm(backup.filePath, { recursive: true, force: true });
      
      this.logger.info('Backup deleted successfully', {
        component: 'backup_manager',
        metadata: { backupId }
      });

      return true;

    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.RESOURCE,
        ErrorSeverity.MEDIUM,
        {
          operation: 'delete_backup',
          component: 'backup_manager',
          metadata: { backupId }
        }
      );
      return false;
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStatistics(): Promise<{
    totalBackups: number;
    totalSize: number;
    oldestBackup?: Date;
    newestBackup?: Date;
    averageSize: number;
    compressionRatio?: number;
  }> {
    const backups = await this.listBackups();
    
    if (backups.length === 0) {
      return {
        totalBackups: 0,
        totalSize: 0,
        averageSize: 0
      };
    }

    const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
    const timestamps = backups.map(b => b.timestamp.getTime());
    
    return {
      totalBackups: backups.length,
      totalSize,
      oldestBackup: new Date(Math.min(...timestamps)),
      newestBackup: new Date(Math.max(...timestamps)),
      averageSize: totalSize / backups.length,
      compressionRatio: this.config.storage.local.compress ? 0.3 : undefined // Estimate
    };
  }

  /**
   * Update backup configuration
   */
  updateConfig(newConfig: Partial<BackupConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Restart scheduling if needed
    if (this.isRunning && this.config.enabled && this.config.schedule.enabled) {
      this.stopScheduledBackups();
      this.startScheduledBackups();
    } else if (!this.config.enabled || !this.config.schedule.enabled) {
      this.stopScheduledBackups();
    }

    this.logger.info('Backup configuration updated', {
      component: 'backup_manager',
      metadata: { config: this.config }
    });
  }

  /**
   * Start scheduled backups
   */
  private startScheduledBackups(): void {
    this.scheduleTimer = setInterval(async () => {
      try {
        await this.createBackup();
        await this.cleanupOldBackups();
      } catch (error) {
        this.logger.error('Scheduled backup failed', {
          component: 'backup_manager'
        });
      }
    }, this.config.schedule.interval);

    this.logger.info('Scheduled backups started', {
      component: 'backup_manager',
      metadata: { interval: this.config.schedule.interval }
    });
  }

  /**
   * Stop scheduled backups
   */
  private stopScheduledBackups(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = undefined;
      
      this.logger.info('Scheduled backups stopped', {
        component: 'backup_manager'
      });
    }
  }

  /**
   * Create backup directories
   */
  private async createBackupDirectories(): Promise<void> {
    await fs.mkdir(this.config.storage.local.path, { recursive: true });
  }

  /**
   * Generate backup ID
   */
  private generateBackupId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `backup-${timestamp}-${random}`;
  }

  /**
   * Get backup path
   */
  private getBackupPath(backupId: string): string {
    return path.join(this.config.storage.local.path, backupId);
  }

  /**
   * Additional helper methods would continue here...
   * (Database backup, configuration backup, policies backup, etc.)
   */

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    this.logger.info('Destroying backup manager', {
      component: 'backup_manager'
    });

    this.stopScheduledBackups();
    this.isRunning = false;
    this.logger.destroy();

    this.logger.info('Backup manager destroyed successfully');
  }

  // Helper methods for backup operations would be implemented here
  private async backupDatabase(outputPath: string): Promise<void> {
    // Implementation for database backup
    if (!this.db) throw new Error('Database not available');
    // Copy database file or export data
  }

  private async backupConfiguration(outputPath: string): Promise<void> {
    // Implementation for configuration backup
    // Copy configuration files
  }

  private async backupPolicies(outputPath: string): Promise<void> {
    // Implementation for policies backup
    if (!this.db) throw new Error('Database not available');
    // Export policy packs and rules
  }

  private async backupLogs(outputPath: string): Promise<void> {
    // Implementation for logs backup
    // Copy log files
  }

  private async calculateChecksum(dirPath: string): Promise<string> {
    // Implementation for checksum calculation
    return 'checksum-placeholder';
  }

  private async compressBackup(sourcePath: string, targetPath: string): Promise<void> {
    // Implementation for backup compression
  }

  private async getBackupMetadata(backupPath: string): Promise<BackupMetadata | null> {
    // Implementation for reading backup metadata
    return null;
  }

  private async validateBackup(backupPath: string): Promise<boolean> {
    // Implementation for backup validation
    return true;
  }

  private async prepareBackupForRestore(backup: BackupInfo): Promise<string> {
    // Implementation for preparing backup for restore
    return backup.filePath;
  }

  private async restoreComponent(component: string, workingPath: string, overwrite: boolean): Promise<void> {
    // Implementation for component restoration
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    // Implementation for calculating directory size
    return 0;
  }

  private async cleanupOldBackups(): Promise<void> {
    const backups = await this.listBackups();
    const cutoffDate = new Date(Date.now() - this.config.schedule.retentionDays * 24 * 60 * 60 * 1000);
    
    for (const backup of backups) {
      if (backup.timestamp < cutoffDate) {
        await this.deleteBackup(backup.id);
      }
    }
  }
}