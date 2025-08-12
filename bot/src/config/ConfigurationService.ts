import { EnvironmentManager, EnvironmentConfig } from './EnvironmentManager';
import { ConfigValidator, ValidationResult } from './ConfigValidator';
import { StructuredLogger, LogLevel } from '../utils/StructuredLogger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/ErrorHandler';
import { Logger } from '../utils/Logger';
import { DatabaseManager, BotConfig } from '../database/DatabaseManager';

export interface ConfigurationChangeEvent {
  type: 'environment' | 'bot_config' | 'policy_pack';
  oldConfig: any;
  newConfig: any;
  timestamp: Date;
}

export type ConfigurationChangeCallback = (event: ConfigurationChangeEvent) => void | Promise<void>;

export class ConfigurationService {
  private logger: StructuredLogger;
  private errorHandler: ErrorHandler;
  private environmentManager: EnvironmentManager;
  private configValidator: ConfigValidator;
  private db?: DatabaseManager;
  private environmentConfig?: EnvironmentConfig;
  private botConfigs = new Map<string, BotConfig>();
  private changeCallbacks: ConfigurationChangeCallback[] = [];
  private isInitialized = false;

  constructor(logger: Logger) {
    this.logger = new StructuredLogger({
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: true,
      filePath: './logs/configuration.log'
    });
    
    this.errorHandler = logger.getErrorHandler() || new ErrorHandler(logger);
    this.configValidator = new ConfigValidator(this.logger, this.errorHandler);
    this.environmentManager = new EnvironmentManager(
      this.logger, 
      this.errorHandler,
      './config/environment.json'
    );
  }

  /**
   * Initialize configuration service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Configuration service already initialized', {
        component: 'configuration_service'
      });
      return;
    }

    this.logger.info('Initializing configuration service', {
      component: 'configuration_service',
      operation: 'initialize'
    });

    try {
      // Load environment configuration
      this.environmentConfig = await this.environmentManager.loadConfiguration();
      
      // Validate critical configuration sections
      await this.validateCriticalConfiguration();
      
      // Set up configuration watching
      this.setupConfigurationWatching();
      
      this.isInitialized = true;
      
      this.logger.info('Configuration service initialized successfully', {
        component: 'configuration_service',
        metadata: {
          environment: this.environmentManager.getEnvironmentSpecificConfig().environment
        }
      });

    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.UNKNOWN,
        ErrorSeverity.CRITICAL,
        {
          operation: 'initialize',
          component: 'configuration_service'
        }
      );
      throw error;
    }
  }

  /**
   * Set database manager for bot configuration management
   */
  setDatabaseManager(db: DatabaseManager): void {
    this.db = db;
    this.logger.info('Database manager set for configuration service', {
      component: 'configuration_service'
    });
  }

  /**
   * Get environment configuration
   */
  getEnvironmentConfig(): EnvironmentConfig {
    if (!this.environmentConfig) {
      throw new Error('Configuration service not initialized');
    }
    return { ...this.environmentConfig };
  }

  /**
   * Get bot configuration for a specific guild
   */
  async getBotConfig(guildId: string): Promise<BotConfig | null> {
    if (!this.db) {
      throw new Error('Database manager not set');
    }

    try {
      // Check cache first
      if (this.botConfigs.has(guildId)) {
        return { ...this.botConfigs.get(guildId)! };
      }

      // Load from database
      const botConfig = await this.db.getBotConfig(guildId);
      if (botConfig) {
        // Validate configuration
        const validationResult = this.configValidator.validate(botConfig, 'bot_config');
        
        if (!validationResult.isValid) {
          this.logger.warn('Invalid bot configuration detected', {
            component: 'configuration_service',
            metadata: {
              guildId,
              errors: validationResult.errors,
              warnings: validationResult.warnings
            }
          });
          
          // Use sanitized config if available
          const sanitizedConfig = validationResult.sanitizedConfig || botConfig;
          this.botConfigs.set(guildId, sanitizedConfig);
          return { ...sanitizedConfig };
        }

        this.botConfigs.set(guildId, botConfig);
        return { ...botConfig };
      }

      return null;

    } catch (error) {
      this.errorHandler.handleDatabaseError(
        error instanceof Error ? error : new Error(String(error)),
        'getBotConfig',
        {
          guildId,
          component: 'configuration_service'
        }
      );
      return null;
    }
  }

  /**
   * Update bot configuration
   */
  async updateBotConfig(guildId: string, updates: Partial<BotConfig>): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database manager not set');
    }

    try {
      // Get current configuration
      const currentConfig = await this.getBotConfig(guildId);
      const mergedConfig = currentConfig ? { ...currentConfig, ...updates } : updates as BotConfig;

      // Validate updated configuration
      const validationResult = this.configValidator.validate(mergedConfig, 'bot_config');
      
      if (!validationResult.isValid) {
        const errorMessage = `Bot configuration validation failed: ${validationResult.errors.map(e => e.message).join(', ')}`;
        
        this.errorHandler.handleValidationError(
          errorMessage,
          'bot_config_update',
          updates,
          {
            guildId,
            component: 'configuration_service'
          }
        );
        
        return false;
      }

      // Use sanitized config
      const finalConfig = validationResult.sanitizedConfig || mergedConfig;

      // Update in database
      await this.db.upsertBotConfig(finalConfig);
      
      // Update cache
      this.botConfigs.set(guildId, finalConfig);
      
      // Trigger change event
      await this.triggerConfigurationChange({
        type: 'bot_config',
        oldConfig: currentConfig,
        newConfig: finalConfig,
        timestamp: new Date()
      });

      this.logger.info('Bot configuration updated successfully', {
        component: 'configuration_service',
        metadata: {
          guildId,
          updatedFields: Object.keys(updates)
        }
      });

      return true;

    } catch (error) {
      this.errorHandler.handleDatabaseError(
        error instanceof Error ? error : new Error(String(error)),
        'updateBotConfig',
        {
          guildId,
          component: 'configuration_service'
        }
      );
      return false;
    }
  }

  /**
   * Update environment configuration
   */
  async updateEnvironmentConfig(updates: Partial<EnvironmentConfig>): Promise<boolean> {
    try {
      await this.environmentManager.updateConfiguration(updates);
      const newConfig = this.environmentManager.getConfiguration();
      
      // Trigger change event
      await this.triggerConfigurationChange({
        type: 'environment',
        oldConfig: this.environmentConfig,
        newConfig: newConfig,
        timestamp: new Date()
      });

      this.environmentConfig = newConfig;
      
      this.logger.info('Environment configuration updated successfully', {
        component: 'configuration_service',
        metadata: {
          updatedFields: Object.keys(updates)
        }
      });

      return true;

    } catch (error) {
      this.errorHandler.handleValidationError(
        error instanceof Error ? error.message : String(error),
        'environment_config_update',
        updates,
        {
          component: 'configuration_service'
        }
      );
      return false;
    }
  }

  /**
   * Save current configuration to file
   */
  async saveConfigurationToFile(filePath?: string): Promise<boolean> {
    try {
      await this.environmentManager.saveConfiguration(filePath);
      
      this.logger.info('Configuration saved to file successfully', {
        component: 'configuration_service',
        metadata: { filePath }
      });

      return true;

    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        {
          operation: 'save_config',
          component: 'configuration_service',
          metadata: { filePath }
        }
      );
      return false;
    }
  }

  /**
   * Register callback for configuration changes
   */
  onConfigurationChange(callback: ConfigurationChangeCallback): void {
    this.changeCallbacks.push(callback);
    
    this.logger.debug('Configuration change callback registered', {
      component: 'configuration_service',
      metadata: { callbacksCount: this.changeCallbacks.length }
    });
  }

  /**
   * Remove configuration change callback
   */
  removeConfigurationChangeCallback(callback: ConfigurationChangeCallback): boolean {
    const index = this.changeCallbacks.indexOf(callback);
    if (index !== -1) {
      this.changeCallbacks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get configuration summary
   */
  getConfigurationSummary(): {
    environment: {
      isValid: boolean;
      environment: string;
      lastUpdated: Date | null;
    };
    botConfigs: {
      guildId: string;
      isValid: boolean;
      lastUpdated: Date | null;
    }[];
    validationErrors: number;
    validationWarnings: number;
  } {
    const envConfig = this.environmentManager.getEnvironmentSpecificConfig();
    const envValidation = this.environmentConfig ? 
      this.configValidator.validate(this.environmentConfig, 'environment_config') : 
      { isValid: false, errors: [], warnings: [] };

    const botConfigSummaries = Array.from(this.botConfigs.entries()).map(([guildId, config]) => {
      const validation = this.configValidator.validate(config, 'bot_config');
      return {
        guildId,
        isValid: validation.isValid,
        lastUpdated: null // Would need to track this separately
      };
    });

    return {
      environment: {
        isValid: envValidation.isValid,
        environment: envConfig.environment,
        lastUpdated: null // Would need to track this separately
      },
      botConfigs: botConfigSummaries,
      validationErrors: envValidation.errors.length + 
        botConfigSummaries.reduce((sum, config) => sum + (config.isValid ? 0 : 1), 0),
      validationWarnings: envValidation.warnings.length
    };
  }

  /**
   * Clear cached configurations
   */
  clearCache(): void {
    this.botConfigs.clear();
    
    this.logger.info('Configuration cache cleared', {
      component: 'configuration_service'
    });
  }

  /**
   * Validate all configurations
   */
  async validateAllConfigurations(): Promise<{
    environment: ValidationResult;
    botConfigs: Map<string, ValidationResult>;
  }> {
    const environmentResult = this.environmentConfig ?
      this.configValidator.validate(this.environmentConfig, 'environment_config') :
      { isValid: false, errors: [{ field: 'environment', message: 'Not loaded' }], warnings: [] };

    const botConfigResults = new Map<string, ValidationResult>();
    
    for (const [guildId, config] of this.botConfigs.entries()) {
      const validation = this.configValidator.validate(config, 'bot_config');
      botConfigResults.set(guildId, validation);
    }

    return {
      environment: environmentResult,
      botConfigs: botConfigResults
    };
  }

  /**
   * Set up configuration file watching
   */
  private setupConfigurationWatching(): void {
    this.environmentManager.watchConfiguration(async (newConfig) => {
      try {
        await this.triggerConfigurationChange({
          type: 'environment',
          oldConfig: this.environmentConfig,
          newConfig: newConfig,
          timestamp: new Date()
        });

        this.environmentConfig = newConfig;

        this.logger.info('Environment configuration reloaded from file', {
          component: 'configuration_service'
        });

      } catch (error) {
        this.errorHandler.handleError(
          error instanceof Error ? error : new Error(String(error)),
          ErrorCategory.RESOURCE,
          ErrorSeverity.MEDIUM,
          {
            operation: 'config_file_watch',
            component: 'configuration_service'
          }
        );
      }
    });
  }

  /**
   * Validate critical configuration sections
   */
  private async validateCriticalConfiguration(): Promise<void> {
    if (!this.environmentConfig) {
      throw new Error('Environment configuration not loaded');
    }

    // Validate Discord configuration
    if (!this.environmentConfig.discordToken || !this.environmentConfig.guildId) {
      throw new Error('Critical Discord configuration missing (token, guildId)');
    }

    // Validate database configuration
    if (!this.environmentConfig.database.path) {
      throw new Error('Database path not configured');
    }

    // Log validation success
    this.logger.info('Critical configuration validation passed', {
      component: 'configuration_service'
    });
  }

  /**
   * Trigger configuration change event
   */
  private async triggerConfigurationChange(event: ConfigurationChangeEvent): Promise<void> {
    const promises = this.changeCallbacks.map(async (callback) => {
      try {
        await callback(event);
      } catch (error) {
        this.errorHandler.handleError(
          error instanceof Error ? error : new Error(String(error)),
          ErrorCategory.UNKNOWN,
          ErrorSeverity.MEDIUM,
          {
            operation: 'config_change_callback',
            component: 'configuration_service'
          }
        );
      }
    });

    await Promise.allSettled(promises);

    this.logger.debug('Configuration change event triggered', {
      component: 'configuration_service',
      metadata: {
        type: event.type,
        callbacksExecuted: promises.length
      }
    });
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    this.logger.info('Destroying configuration service', {
      component: 'configuration_service'
    });

    try {
      // Stop file watching
      this.environmentManager.stopWatching();
      
      // Clear callbacks and caches
      this.changeCallbacks.length = 0;
      this.botConfigs.clear();
      
      // Clean up resources
      this.environmentManager.destroy();
      this.logger.destroy();
      
      this.isInitialized = false;
      
      this.logger.info('Configuration service destroyed successfully');

    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.RESOURCE,
        ErrorSeverity.MEDIUM,
        {
          operation: 'destroy',
          component: 'configuration_service'
        }
      );
    }
  }
}