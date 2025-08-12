import fs from 'fs';
import path from 'path';
import { ConfigValidator, ValidationResult } from './ConfigValidator';
import { StructuredLogger, LogLevel } from '../utils/StructuredLogger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/ErrorHandler';

export interface EnvironmentConfig {
  // Core Bot Settings
  discordToken: string;
  guildId: string;
  clientId: string;
  
  // Database Configuration
  database: {
    path: string;
    maxConnections: number;
    timeout: number;
    retryAttempts: number;
    enableWAL: boolean;
  };

  // Ollama Configuration
  ollama: {
    baseUrl: string;
    timeout: number;
    maxRetries: number;
    defaultModel: string;
  };

  // Logging Configuration
  logging: {
    level: LogLevel;
    enableConsole: boolean;
    enableFile: boolean;
    filePath?: string;
    maxFileSize: number;
    maxFiles: number;
    enableJSON: boolean;
  };

  // Security Configuration
  security: {
    rateLimiting: {
      enabled: boolean;
      maxMessages: number;
      timeWindow: number;
      burstLimit: number;
    };
    inputValidation: {
      enabled: boolean;
      maxLength: number;
      allowedFileTypes: string[];
    };
    contentSanitization: {
      enabled: boolean;
      blockMaliciousUrls: boolean;
      stripHtml: boolean;
    };
  };

  // Monitoring Configuration
  monitoring: {
    enabled: boolean;
    healthCheck: {
      interval: number;
      timeout: number;
      retryAttempts: number;
    };
    metrics: {
      collectionInterval: number;
      maxHistory: number;
    };
    alerts: {
      enabled: boolean;
      checkInterval: number;
    };
  };

  // Performance Configuration
  performance: {
    cache: {
      enabled: boolean;
      maxSize: number;
      ttl: number;
    };
    connectionPool: {
      enabled: boolean;
      maxConnections: number;
      acquireTimeout: number;
    };
  };
}

export class EnvironmentManager {
  private logger: StructuredLogger;
  private errorHandler: ErrorHandler;
  private configValidator: ConfigValidator;
  private config?: EnvironmentConfig;
  private configPath: string;
  private watchingConfig = false;

  constructor(
    logger: StructuredLogger,
    errorHandler: ErrorHandler,
    configPath: string = './config/environment.json'
  ) {
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.configPath = path.resolve(configPath);
    this.configValidator = new ConfigValidator(logger, errorHandler);
  }

  /**
   * Load and validate configuration from environment and files
   */
  async loadConfiguration(): Promise<EnvironmentConfig> {
    this.logger.info('Loading environment configuration', {
      component: 'environment_manager',
      operation: 'load_config'
    });

    try {
      // Load base configuration from defaults
      const baseConfig = this.getDefaultConfiguration();
      
      // Override with file configuration if it exists
      const fileConfig = await this.loadConfigurationFile();
      const mergedConfig = this.mergeConfigurations(baseConfig, fileConfig);
      
      // Override with environment variables
      const finalConfig = this.applyEnvironmentOverrides(mergedConfig);
      
      // Validate the final configuration
      const validationResult = await this.validateConfiguration(finalConfig);
      
      if (!validationResult.isValid) {
        const errorMessage = `Configuration validation failed: ${validationResult.errors.map(e => e.message).join(', ')}`;
        
        this.errorHandler.handleValidationError(
          errorMessage,
          'configuration',
          finalConfig,
          {
            operation: 'load_config',
            component: 'environment_manager'
          }
        );
        
        throw new Error(errorMessage);
      }

      // Log validation warnings
      if (validationResult.warnings.length > 0) {
        this.logger.warn('Configuration warnings detected', {
          component: 'environment_manager',
          metadata: { warnings: validationResult.warnings }
        });
      }

      // Use sanitized config if available
      this.config = validationResult.sanitizedConfig || finalConfig;
      
      this.logger.info('Configuration loaded successfully', {
        component: 'environment_manager',
        metadata: {
          warningsCount: validationResult.warnings.length,
          configSource: 'merged'
        }
      });

      return this.config;

    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.VALIDATION,
        ErrorSeverity.CRITICAL,
        {
          operation: 'load_config',
          component: 'environment_manager'
        }
      );
      
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfiguration(): EnvironmentConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfiguration() first.');
    }
    return { ...this.config }; // Return a copy
  }

  /**
   * Update configuration and validate
   */
  async updateConfiguration(updates: Partial<EnvironmentConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfiguration() first.');
    }

    const updatedConfig = this.mergeConfigurations(this.config, updates);
    const validationResult = await this.validateConfiguration(updatedConfig);

    if (!validationResult.isValid) {
      const errorMessage = `Configuration update validation failed: ${validationResult.errors.map(e => e.message).join(', ')}`;
      
      this.errorHandler.handleValidationError(
        errorMessage,
        'configuration_update',
        updates,
        {
          operation: 'update_config',
          component: 'environment_manager'
        }
      );
      
      throw new Error(errorMessage);
    }

    this.config = validationResult.sanitizedConfig || updatedConfig;
    
    this.logger.info('Configuration updated successfully', {
      component: 'environment_manager',
      operation: 'update_config',
      metadata: { updatedFields: Object.keys(updates) }
    });
  }

  /**
   * Save current configuration to file
   */
  async saveConfiguration(configPath?: string): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfiguration() first.');
    }

    const filePath = configPath || this.configPath;
    const dir = path.dirname(filePath);

    try {
      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write configuration to file
      const configData = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(filePath, configData, 'utf8');

      this.logger.info('Configuration saved to file', {
        component: 'environment_manager',
        operation: 'save_config',
        metadata: { filePath }
      });

    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.RESOURCE,
        ErrorSeverity.HIGH,
        {
          operation: 'save_config',
          component: 'environment_manager',
          metadata: { filePath }
        }
      );
      
      throw error;
    }
  }

  /**
   * Watch configuration file for changes
   */
  watchConfiguration(callback: (config: EnvironmentConfig) => void): void {
    if (this.watchingConfig || !fs.existsSync(this.configPath)) {
      return;
    }

    this.watchingConfig = true;
    
    fs.watchFile(this.configPath, { interval: 1000 }, async (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        this.logger.info('Configuration file changed, reloading...', {
          component: 'environment_manager',
          operation: 'watch_config'
        });

        try {
          const newConfig = await this.loadConfiguration();
          callback(newConfig);
        } catch (error) {
          this.errorHandler.handleError(
            error instanceof Error ? error : new Error(String(error)),
            ErrorCategory.RESOURCE,
            ErrorSeverity.MEDIUM,
            {
              operation: 'reload_config',
              component: 'environment_manager'
            }
          );
        }
      }
    });

    this.logger.info('Started watching configuration file', {
      component: 'environment_manager',
      metadata: { filePath: this.configPath }
    });
  }

  /**
   * Stop watching configuration file
   */
  stopWatching(): void {
    if (this.watchingConfig) {
      fs.unwatchFile(this.configPath);
      this.watchingConfig = false;
      this.logger.info('Stopped watching configuration file');
    }
  }

  /**
   * Get environment-specific configuration
   */
  getEnvironmentSpecificConfig(): {
    environment: string;
    isDevelopment: boolean;
    isProduction: boolean;
    isTest: boolean;
  } {
    const environment = process.env['NODE_ENV'] || 'production';
    
    return {
      environment,
      isDevelopment: environment === 'development',
      isProduction: environment === 'production',
      isTest: environment === 'test'
    };
  }

  /**
   * Load configuration from file
   */
  private async loadConfigurationFile(): Promise<Partial<EnvironmentConfig>> {
    if (!fs.existsSync(this.configPath)) {
      this.logger.warn('Configuration file not found, using defaults', {
        component: 'environment_manager',
        metadata: { configPath: this.configPath }
      });
      return {};
    }

    try {
      const fileContent = fs.readFileSync(this.configPath, 'utf8');
      const config = JSON.parse(fileContent);
      
      this.logger.debug('Configuration file loaded', {
        component: 'environment_manager',
        metadata: { configPath: this.configPath }
      });
      
      return config;
    } catch (error) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorCategory.PARSING,
        ErrorSeverity.HIGH,
        {
          operation: 'parse_config_file',
          component: 'environment_manager',
          metadata: { configPath: this.configPath }
        }
      );
      
      return {};
    }
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvironmentOverrides(config: EnvironmentConfig): EnvironmentConfig {
    const overriddenConfig = { ...config };

    // Discord configuration
    if (process.env['DISCORD_TOKEN']) {
      overriddenConfig.discordToken = process.env['DISCORD_TOKEN'];
    }
    if (process.env['GUILD_ID']) {
      overriddenConfig.guildId = process.env['GUILD_ID'];
    }
    if (process.env['CLIENT_ID']) {
      overriddenConfig.clientId = process.env['CLIENT_ID'];
    }

    // Database configuration
    if (process.env['DB_PATH']) {
      overriddenConfig.database.path = process.env['DB_PATH'];
    }

    // Ollama configuration
    if (process.env['OLLAMA_BASE_URL']) {
      overriddenConfig.ollama.baseUrl = process.env['OLLAMA_BASE_URL'];
    }

    // Logging configuration
    if (process.env['LOG_LEVEL']) {
      const logLevel = process.env['LOG_LEVEL'].toUpperCase() as keyof typeof LogLevel;
      if (LogLevel[logLevel] !== undefined) {
        overriddenConfig.logging.level = LogLevel[logLevel];
      }
    }
    if (process.env['LOG_FILE_PATH']) {
      overriddenConfig.logging.filePath = process.env['LOG_FILE_PATH'];
    }

    return overriddenConfig;
  }

  /**
   * Merge two configuration objects
   */
  private mergeConfigurations(base: any, override: any): any {
    const result = { ...base };

    for (const key in override) {
      if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
        result[key] = this.mergeConfigurations(result[key] || {}, override[key]);
      } else {
        result[key] = override[key];
      }
    }

    return result;
  }

  /**
   * Validate configuration
   */
  private async validateConfiguration(config: EnvironmentConfig): Promise<ValidationResult> {
    // Create a comprehensive validation schema for the entire config
    this.configValidator.registerSchema('environment_config', {
      discordToken: {
        field: 'discordToken',
        type: 'string',
        required: true,
        min: 50,
        pattern: /^[A-Za-z0-9\-_.]+$/
      },
      guildId: {
        field: 'guildId',
        type: 'string',
        required: true,
        pattern: /^\d{17,19}$/
      },
      clientId: {
        field: 'clientId',
        type: 'string',
        required: true,
        pattern: /^\d{17,19}$/
      },
      database: {
        field: 'database',
        type: 'object',
        required: true,
        nested: {
          path: { field: 'path', type: 'string', required: true },
          maxConnections: { field: 'maxConnections', type: 'number', min: 1, max: 100 },
          timeout: { field: 'timeout', type: 'number', min: 1000, max: 60000 },
          retryAttempts: { field: 'retryAttempts', type: 'number', min: 1, max: 10 },
          enableWAL: { field: 'enableWAL', type: 'boolean' }
        }
      }
      // Additional validation rules would be added here for other config sections
    });

    return this.configValidator.validateAndSanitize(config, 'environment_config');
  }

  /**
   * Get default configuration
   */
  private getDefaultConfiguration(): EnvironmentConfig {
    return {
      discordToken: process.env['DISCORD_TOKEN'] || '',
      guildId: process.env['GUILD_ID'] || '',
      clientId: process.env['CLIENT_ID'] || '',
      
      database: {
        path: './data/greatshield.db',
        maxConnections: 10,
        timeout: 10000,
        retryAttempts: 3,
        enableWAL: true
      },

      ollama: {
        baseUrl: 'http://localhost:11434',
        timeout: 30000,
        maxRetries: 3,
        defaultModel: 'llama2'
      },

      logging: {
        level: LogLevel.INFO,
        enableConsole: true,
        enableFile: true,
        filePath: './logs/greatshield.log',
        maxFileSize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        enableJSON: false
      },

      security: {
        rateLimiting: {
          enabled: true,
          maxMessages: 10,
          timeWindow: 60000, // 1 minute
          burstLimit: 3
        },
        inputValidation: {
          enabled: true,
          maxLength: 2000,
          allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'md']
        },
        contentSanitization: {
          enabled: true,
          blockMaliciousUrls: true,
          stripHtml: true
        }
      },

      monitoring: {
        enabled: true,
        healthCheck: {
          interval: 30000, // 30 seconds
          timeout: 10000, // 10 seconds
          retryAttempts: 3
        },
        metrics: {
          collectionInterval: 15000, // 15 seconds
          maxHistory: 10000
        },
        alerts: {
          enabled: true,
          checkInterval: 30000 // 30 seconds
        }
      },

      performance: {
        cache: {
          enabled: true,
          maxSize: 1000,
          ttl: 300000 // 5 minutes
        },
        connectionPool: {
          enabled: true,
          maxConnections: 10,
          acquireTimeout: 5000
        }
      }
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopWatching();
    this.logger.info('EnvironmentManager destroyed');
  }
}