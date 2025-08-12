import { StructuredLogger, LogLevel } from '../utils/StructuredLogger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../utils/ErrorHandler';

export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  custom?: (value: any) => boolean | string;
  nested?: ValidationSchema;
}

export interface ValidationSchema {
  [key: string]: ValidationRule;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  sanitizedConfig?: any;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  expected?: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

export class ConfigValidator {
  private logger: StructuredLogger;
  private errorHandler: ErrorHandler;
  private schemas = new Map<string, ValidationSchema>();

  constructor(logger: StructuredLogger, errorHandler: ErrorHandler) {
    this.logger = logger;
    this.errorHandler = errorHandler;
    
    // Register default schemas
    this.registerDefaultSchemas();
  }

  /**
   * Register a validation schema
   */
  registerSchema(name: string, schema: ValidationSchema): void {
    this.schemas.set(name, schema);
    this.logger.debug('Validation schema registered', {
      component: 'config_validator',
      metadata: { schemaName: name, fieldsCount: Object.keys(schema).length }
    });
  }

  /**
   * Validate configuration against a schema
   */
  validate(config: any, schemaName: string): ValidationResult {
    const schema = this.schemas.get(schemaName);
    if (!schema) {
      const error = this.errorHandler.handleValidationError(
        `Unknown schema: ${schemaName}`,
        'schema',
        schemaName
      );
      
      return {
        isValid: false,
        errors: [{ field: 'schema', message: `Unknown schema: ${schemaName}` }],
        warnings: []
      };
    }

    this.logger.startTimer('config_validation', { 
      component: 'config_validator',
      metadata: { schemaName }
    });

    const result = this.validateObject(config, schema, '');
    
    this.logger.endTimer('config_validation', {
      component: 'config_validator',
      metadata: { 
        schemaName,
        isValid: result.isValid,
        errorsCount: result.errors.length,
        warningsCount: result.warnings.length
      }
    });

    if (!result.isValid) {
      this.logger.warn('Configuration validation failed', {
        component: 'config_validator',
        metadata: {
          schemaName,
          errors: result.errors,
          warnings: result.warnings
        }
      });
    } else {
      this.logger.info('Configuration validated successfully', {
        component: 'config_validator',
        metadata: {
          schemaName,
          warningsCount: result.warnings.length
        }
      });
    }

    return result;
  }

  /**
   * Validate and sanitize configuration
   */
  validateAndSanitize(config: any, schemaName: string): ValidationResult {
    const result = this.validate(config, schemaName);
    
    if (result.isValid) {
      const schema = this.schemas.get(schemaName)!;
      result.sanitizedConfig = this.sanitizeObject(config, schema);
    }

    return result;
  }

  /**
   * Get available schemas
   */
  getSchemas(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Get schema definition
   */
  getSchema(name: string): ValidationSchema | undefined {
    return this.schemas.get(name);
  }

  /**
   * Validate object against schema
   */
  private validateObject(obj: any, schema: ValidationSchema, path: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for required fields
    for (const [fieldName, rule] of Object.entries(schema)) {
      const fullPath = path ? `${path}.${fieldName}` : fieldName;
      const value = obj?.[fieldName];

      if (rule.required && (value === undefined || value === null)) {
        errors.push({
          field: fullPath,
          message: `Required field is missing`,
          expected: `${rule.type} value`
        });
        continue;
      }

      if (value !== undefined && value !== null) {
        const fieldResult = this.validateField(value, rule, fullPath);
        errors.push(...fieldResult.errors);
        warnings.push(...fieldResult.warnings);
      }
    }

    // Check for unexpected fields
    if (obj && typeof obj === 'object') {
      for (const fieldName of Object.keys(obj)) {
        if (!schema[fieldName]) {
          warnings.push({
            field: path ? `${path}.${fieldName}` : fieldName,
            message: 'Unexpected field',
            suggestion: 'Remove this field or add it to the schema'
          });
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate individual field
   */
  private validateField(value: any, rule: ValidationRule, path: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Type validation
    if (!this.validateType(value, rule.type)) {
      errors.push({
        field: path,
        message: `Invalid type`,
        value,
        expected: rule.type
      });
      return { isValid: false, errors, warnings };
    }

    // Range validation for numbers
    if (rule.type === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        errors.push({
          field: path,
          message: `Value below minimum`,
          value,
          expected: `>= ${rule.min}`
        });
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push({
          field: path,
          message: `Value above maximum`,
          value,
          expected: `<= ${rule.max}`
        });
      }
    }

    // Length validation for strings and arrays
    if (rule.type === 'string' || rule.type === 'array') {
      const length = rule.type === 'string' ? value.length : value.length;
      if (rule.min !== undefined && length < rule.min) {
        errors.push({
          field: path,
          message: `Length below minimum`,
          value: length,
          expected: `>= ${rule.min} characters/items`
        });
      }
      if (rule.max !== undefined && length > rule.max) {
        errors.push({
          field: path,
          message: `Length above maximum`,
          value: length,
          expected: `<= ${rule.max} characters/items`
        });
      }
    }

    // Pattern validation for strings
    if (rule.type === 'string' && rule.pattern && !rule.pattern.test(value)) {
      errors.push({
        field: path,
        message: `Value doesn't match pattern`,
        value,
        expected: rule.pattern.toString()
      });
    }

    // Enum validation
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push({
        field: path,
        message: `Invalid enum value`,
        value,
        expected: `one of: ${rule.enum.join(', ')}`
      });
    }

    // Nested object validation
    if (rule.type === 'object' && rule.nested) {
      const nestedResult = this.validateObject(value, rule.nested, path);
      errors.push(...nestedResult.errors);
      warnings.push(...nestedResult.warnings);
    }

    // Array element validation
    if (rule.type === 'array' && rule.nested && Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemResult = this.validateObject(item, rule.nested!, `${path}[${index}]`);
        errors.push(...itemResult.errors);
        warnings.push(...itemResult.warnings);
      });
    }

    // Custom validation
    if (rule.custom) {
      const customResult = rule.custom(value);
      if (typeof customResult === 'string') {
        errors.push({
          field: path,
          message: customResult,
          value
        });
      } else if (!customResult) {
        errors.push({
          field: path,
          message: 'Custom validation failed',
          value
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate value type
   */
  private validateType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return false;
    }
  }

  /**
   * Sanitize object by applying defaults and transformations
   */
  private sanitizeObject(obj: any, schema: ValidationSchema): any {
    const sanitized = { ...obj };

    for (const [fieldName, rule] of Object.entries(schema)) {
      const value = sanitized[fieldName];

      if (value !== undefined && value !== null) {
        // Sanitize nested objects
        if (rule.type === 'object' && rule.nested) {
          sanitized[fieldName] = this.sanitizeObject(value, rule.nested);
        }
        
        // Sanitize arrays
        if (rule.type === 'array' && rule.nested && Array.isArray(value)) {
          sanitized[fieldName] = value.map(item => 
            this.sanitizeObject(item, rule.nested!)
          );
        }

        // Type coercion
        if (rule.type === 'number' && typeof value === 'string') {
          const parsed = parseFloat(value);
          if (!isNaN(parsed)) {
            sanitized[fieldName] = parsed;
          }
        }

        if (rule.type === 'boolean' && typeof value === 'string') {
          sanitized[fieldName] = value.toLowerCase() === 'true';
        }

        // Clamp numbers to range
        if (rule.type === 'number') {
          if (rule.min !== undefined && value < rule.min) {
            sanitized[fieldName] = rule.min;
          }
          if (rule.max !== undefined && value > rule.max) {
            sanitized[fieldName] = rule.max;
          }
        }

        // Trim strings
        if (rule.type === 'string' && typeof value === 'string') {
          sanitized[fieldName] = value.trim();
        }
      }
    }

    return sanitized;
  }

  /**
   * Register default validation schemas
   */
  private registerDefaultSchemas(): void {
    // Bot Configuration Schema
    this.registerSchema('bot_config', {
      guild_id: {
        field: 'guild_id',
        type: 'string',
        required: true,
        pattern: /^\d{17,19}$/
      },
      selected_model: {
        field: 'selected_model',
        type: 'string',
        required: true,
        enum: ['llama2', 'mistral', 'codellama', 'neural-chat']
      },
      active_policy_pack_id: {
        field: 'active_policy_pack_id',
        type: 'number',
        required: true,
        min: 1
      },
      log_channel_id: {
        field: 'log_channel_id',
        type: 'string',
        pattern: /^\d{17,19}$/
      },
      moderator_role_id: {
        field: 'moderator_role_id',
        type: 'string',
        pattern: /^\d{17,19}$/
      }
    });

    // Database Configuration Schema
    this.registerSchema('database_config', {
      path: {
        field: 'path',
        type: 'string',
        required: true
      },
      maxConnections: {
        field: 'maxConnections',
        type: 'number',
        min: 1,
        max: 100
      },
      timeout: {
        field: 'timeout',
        type: 'number',
        min: 1000,
        max: 30000
      },
      retryAttempts: {
        field: 'retryAttempts',
        type: 'number',
        min: 1,
        max: 10
      }
    });

    // Monitoring Configuration Schema
    this.registerSchema('monitoring_config', {
      healthCheck: {
        field: 'healthCheck',
        type: 'object',
        nested: {
          enabled: { field: 'enabled', type: 'boolean' },
          interval: { field: 'interval', type: 'number', min: 5000, max: 300000 },
          timeout: { field: 'timeout', type: 'number', min: 1000, max: 60000 },
          retryAttempts: { field: 'retryAttempts', type: 'number', min: 1, max: 5 }
        }
      },
      metrics: {
        field: 'metrics',
        type: 'object',
        nested: {
          enabled: { field: 'enabled', type: 'boolean' },
          collectionInterval: { field: 'collectionInterval', type: 'number', min: 1000 },
          maxHistory: { field: 'maxHistory', type: 'number', min: 100, max: 50000 }
        }
      },
      alerts: {
        field: 'alerts',
        type: 'object',
        nested: {
          enabled: { field: 'enabled', type: 'boolean' },
          checkInterval: { field: 'checkInterval', type: 'number', min: 5000 }
        }
      }
    });

    // Security Configuration Schema
    this.registerSchema('security_config', {
      rateLimiting: {
        field: 'rateLimiting',
        type: 'object',
        nested: {
          enabled: { field: 'enabled', type: 'boolean' },
          maxMessages: { field: 'maxMessages', type: 'number', min: 1, max: 100 },
          timeWindow: { field: 'timeWindow', type: 'number', min: 1000 },
          burstLimit: { field: 'burstLimit', type: 'number', min: 1, max: 50 }
        }
      },
      inputValidation: {
        field: 'inputValidation',
        type: 'object',
        nested: {
          enabled: { field: 'enabled', type: 'boolean' },
          maxLength: { field: 'maxLength', type: 'number', min: 100, max: 4000 },
          allowedFileTypes: { field: 'allowedFileTypes', type: 'array' }
        }
      },
      contentSanitization: {
        field: 'contentSanitization',
        type: 'object',
        nested: {
          enabled: { field: 'enabled', type: 'boolean' },
          blockMaliciousUrls: { field: 'blockMaliciousUrls', type: 'boolean' },
          stripHtml: { field: 'stripHtml', type: 'boolean' }
        }
      }
    });

    // Logger Configuration Schema
    this.registerSchema('logger_config', {
      level: {
        field: 'level',
        type: 'string',
        enum: ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
      },
      enableConsole: {
        field: 'enableConsole',
        type: 'boolean'
      },
      enableFile: {
        field: 'enableFile',
        type: 'boolean'
      },
      filePath: {
        field: 'filePath',
        type: 'string'
      },
      maxFileSize: {
        field: 'maxFileSize',
        type: 'number',
        min: 1024 * 1024, // 1MB minimum
        max: 100 * 1024 * 1024 // 100MB maximum
      },
      maxFiles: {
        field: 'maxFiles',
        type: 'number',
        min: 1,
        max: 50
      }
    });
  }
}