import { ConfigValidator, ValidationSchema } from '../../bot/src/config/ConfigValidator';
import { StructuredLogger, LogLevel } from '../../bot/src/utils/StructuredLogger';
import { ErrorHandler } from '../../bot/src/utils/ErrorHandler';
import { Logger } from '../../bot/src/utils/Logger';

describe('ConfigValidator', () => {
  let configValidator: ConfigValidator;
  let logger: StructuredLogger;
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    const winstonLogger = new Logger('error');
    logger = new StructuredLogger({
      level: LogLevel.ERROR,
      enableConsole: false,
      enableFile: false
    });
    errorHandler = new ErrorHandler(winstonLogger);
    configValidator = new ConfigValidator(logger, errorHandler);
  });

  afterEach(() => {
    logger.destroy();
    errorHandler.destroy();
  });

  describe('Schema Registration', () => {
    it('should register and retrieve schemas', () => {
      const testSchema: ValidationSchema = {
        name: { field: 'name', type: 'string', required: true },
        age: { field: 'age', type: 'number', min: 0, max: 120 }
      };

      configValidator.registerSchema('test', testSchema);
      
      expect(configValidator.getSchemas()).toContain('test');
      expect(configValidator.getSchema('test')).toEqual(testSchema);
    });

    it('should have default schemas registered', () => {
      const schemas = configValidator.getSchemas();
      
      expect(schemas).toContain('bot_config');
      expect(schemas).toContain('database_config');
      expect(schemas).toContain('monitoring_config');
      expect(schemas).toContain('security_config');
      expect(schemas).toContain('logger_config');
    });
  });

  describe('Basic Validation', () => {
    beforeEach(() => {
      const testSchema: ValidationSchema = {
        name: { field: 'name', type: 'string', required: true },
        age: { field: 'age', type: 'number', min: 0, max: 120 },
        email: { field: 'email', type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        active: { field: 'active', type: 'boolean' },
        tags: { field: 'tags', type: 'array' }
      };
      
      configValidator.registerSchema('test', testSchema);
    });

    it('should validate valid configuration', () => {
      const config = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
        active: true,
        tags: ['user', 'admin']
      };

      const result = configValidator.validate(config, 'test');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const config = {
        age: 30,
        email: 'john@example.com'
      };

      const result = configValidator.validate(config, 'test');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('name');
      expect(result.errors[0].message).toBe('Required field is missing');
    });

    it('should detect type mismatches', () => {
      const config = {
        name: 'John Doe',
        age: 'thirty', // Should be number
        email: 'john@example.com'
      };

      const result = configValidator.validate(config, 'test');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('age');
      expect(result.errors[0].message).toBe('Invalid type');
    });

    it('should validate number ranges', () => {
      const config = {
        name: 'John Doe',
        age: 150 // Above max of 120
      };

      const result = configValidator.validate(config, 'test');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('age');
      expect(result.errors[0].message).toBe('Value above maximum');
    });

    it('should validate string patterns', () => {
      const config = {
        name: 'John Doe',
        email: 'invalid-email' // Doesn't match pattern
      };

      const result = configValidator.validate(config, 'test');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('email');
      expect(result.errors[0].message).toBe(`Value doesn't match pattern`);
    });

    it('should warn about unexpected fields', () => {
      const config = {
        name: 'John Doe',
        age: 30,
        unexpectedField: 'value'
      };

      const result = configValidator.validate(config, 'test');
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].field).toBe('unexpectedField');
      expect(result.warnings[0].message).toBe('Unexpected field');
    });
  });

  describe('Advanced Validation', () => {
    beforeEach(() => {
      const testSchema: ValidationSchema = {
        status: {
          field: 'status',
          type: 'string',
          enum: ['active', 'inactive', 'pending']
        },
        password: {
          field: 'password',
          type: 'string',
          min: 8,
          custom: (value: string) => {
            if (!/[A-Z]/.test(value)) return 'Must contain uppercase letter';
            if (!/[0-9]/.test(value)) return 'Must contain number';
            return true;
          }
        },
        profile: {
          field: 'profile',
          type: 'object',
          nested: {
            firstName: { field: 'firstName', type: 'string', required: true },
            lastName: { field: 'lastName', type: 'string', required: true }
          }
        },
        scores: {
          field: 'scores',
          type: 'array',
          min: 1,
          max: 5
        }
      };
      
      configValidator.registerSchema('advanced', testSchema);
    });

    it('should validate enum values', () => {
      const validConfig = { status: 'active' };
      const invalidConfig = { status: 'unknown' };

      const validResult = configValidator.validate(validConfig, 'advanced');
      const invalidResult = configValidator.validate(invalidConfig, 'advanced');
      
      expect(validResult.isValid).toBe(true);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors[0].message).toBe('Invalid enum value');
    });

    it('should validate custom rules', () => {
      const validConfig = { password: 'Password123' };
      const invalidConfig1 = { password: 'password123' }; // No uppercase
      const invalidConfig2 = { password: 'Password' }; // No number

      const validResult = configValidator.validate(validConfig, 'advanced');
      const invalidResult1 = configValidator.validate(invalidConfig1, 'advanced');
      const invalidResult2 = configValidator.validate(invalidConfig2, 'advanced');
      
      expect(validResult.isValid).toBe(true);
      expect(invalidResult1.isValid).toBe(false);
      expect(invalidResult1.errors[0].message).toBe('Must contain uppercase letter');
      expect(invalidResult2.isValid).toBe(false);
      expect(invalidResult2.errors[0].message).toBe('Must contain number');
    });

    it('should validate nested objects', () => {
      const validConfig = {
        profile: {
          firstName: 'John',
          lastName: 'Doe'
        }
      };

      const invalidConfig = {
        profile: {
          firstName: 'John'
          // Missing required lastName
        }
      };

      const validResult = configValidator.validate(validConfig, 'advanced');
      const invalidResult = configValidator.validate(invalidConfig, 'advanced');
      
      expect(validResult.isValid).toBe(true);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors[0].field).toBe('profile.lastName');
      expect(invalidResult.errors[0].message).toBe('Required field is missing');
    });

    it('should validate array length', () => {
      const validConfig = { scores: [1, 2, 3] };
      const invalidConfig = { scores: [] }; // Below minimum

      const validResult = configValidator.validate(validConfig, 'advanced');
      const invalidResult = configValidator.validate(invalidConfig, 'advanced');
      
      expect(validResult.isValid).toBe(true);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors[0].message).toBe('Length below minimum');
    });
  });

  describe('Configuration Sanitization', () => {
    beforeEach(() => {
      const testSchema: ValidationSchema = {
        port: { field: 'port', type: 'number', min: 1000, max: 65535 },
        name: { field: 'name', type: 'string' },
        enabled: { field: 'enabled', type: 'boolean' }
      };
      
      configValidator.registerSchema('sanitize', testSchema);
    });

    it('should sanitize and convert types', () => {
      const config = {
        port: '3000', // String that should be converted to number
        name: '  Test Name  ', // String with whitespace
        enabled: 'true' // String that should be converted to boolean
      };

      const result = configValidator.validateAndSanitize(config, 'sanitize');
      
      expect(result.isValid).toBe(true);
      expect(result.sanitizedConfig.port).toBe(3000);
      expect(result.sanitizedConfig.name).toBe('Test Name');
      expect(result.sanitizedConfig.enabled).toBe(true);
    });

    it('should clamp numbers to valid range', () => {
      const config = {
        port: 99999 // Above maximum
      };

      const result = configValidator.validateAndSanitize(config, 'sanitize');
      
      expect(result.isValid).toBe(true);
      expect(result.sanitizedConfig.port).toBe(65535); // Clamped to maximum
    });
  });

  describe('Default Schema Validation', () => {
    it('should validate bot configuration', () => {
      const validBotConfig = {
        guild_id: '123456789012345678',
        selected_model: 'llama2',
        active_policy_pack_id: 1,
        log_channel_id: '123456789012345678'
      };

      const invalidBotConfig = {
        guild_id: 'invalid', // Too short
        selected_model: 'unknown_model',
        active_policy_pack_id: 0 // Below minimum
      };

      const validResult = configValidator.validate(validBotConfig, 'bot_config');
      const invalidResult = configValidator.validate(invalidBotConfig, 'bot_config');
      
      expect(validResult.isValid).toBe(true);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });

    it('should validate database configuration', () => {
      const validDbConfig = {
        path: './data/test.db',
        maxConnections: 10,
        timeout: 5000,
        retryAttempts: 3
      };

      const invalidDbConfig = {
        path: '', // Required but empty
        maxConnections: 0, // Below minimum
        timeout: 100 // Below minimum
      };

      const validResult = configValidator.validate(validDbConfig, 'database_config');
      const invalidResult = configValidator.validate(invalidDbConfig, 'database_config');
      
      expect(validResult.isValid).toBe(true);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown schema', () => {
      const config = { name: 'test' };
      const result = configValidator.validate(config, 'unknown_schema');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Unknown schema');
    });
  });
});