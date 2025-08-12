import { ErrorHandler, ErrorCategory, ErrorSeverity, StructuredError } from '../../src/utils/ErrorHandler';
import { Logger } from '../../src/utils/Logger';

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('error'); // Only log errors to reduce test output
    errorHandler = new ErrorHandler(logger);
  });

  afterEach(() => {
    errorHandler.destroy();
  });

  describe('Error Handling', () => {
    it('should handle string errors', () => {
      const error = errorHandler.handleError(
        'Test error message',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        { userId: 'test-user' }
      );

      expect(error.id).toBeDefined();
      expect(error.message).toBe('Test error message');
      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.context.userId).toBe('test-user');
      expect(error.resolved).toBe(false);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should handle Error objects', () => {
      const originalError = new Error('Original error');
      const error = errorHandler.handleError(
        originalError,
        ErrorCategory.DATABASE,
        ErrorSeverity.HIGH
      );

      expect(error.message).toBe('Original error');
      expect(error.originalError).toBe(originalError);
      expect(error.stackTrace).toBeDefined();
      expect(error.category).toBe(ErrorCategory.DATABASE);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should store and retrieve errors', () => {
      const error1 = errorHandler.handleError('Error 1', ErrorCategory.NETWORK);
      const error2 = errorHandler.handleError('Error 2', ErrorCategory.TIMEOUT);

      expect(errorHandler.getError(error1.id)).toEqual(error1);
      expect(errorHandler.getError(error2.id)).toEqual(error2);
      expect(errorHandler.getError('non-existent')).toBeUndefined();
    });
  });

  describe('Specialized Error Handlers', () => {
    it('should handle database errors with appropriate severity', () => {
      const dbError = new Error('database is locked');
      const error = errorHandler.handleDatabaseError(dbError, 'INSERT', {
        guildId: 'test-guild'
      });

      expect(error.category).toBe(ErrorCategory.DATABASE);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.context.operation).toBe('INSERT');
      expect(error.context.component).toBe('database');
      expect(error.context.guildId).toBe('test-guild');
    });

    it('should handle validation errors', () => {
      const error = errorHandler.handleValidationError(
        'Invalid input',
        'email',
        'invalid-email',
        { userId: 'test-user' }
      );

      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.severity).toBe(ErrorSeverity.LOW);
      expect(error.context.metadata?.field).toBe('email');
      expect(error.context.metadata?.value).toBe('invalid-email');
    });

    it('should handle rate limit errors', () => {
      const error = errorHandler.handleRateLimitError(
        'user123',
        'Too many messages',
        { channelId: 'channel123' }
      );

      expect(error.category).toBe(ErrorCategory.RATE_LIMIT);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.context.userId).toBe('user123');
      expect(error.context.channelId).toBe('channel123');
    });

    it('should handle timeout errors', () => {
      const error = errorHandler.handleTimeoutError('database_query', 5000, {
        operation: 'SELECT'
      });

      expect(error.category).toBe(ErrorCategory.TIMEOUT);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.context.metadata?.timeoutMs).toBe(5000);
    });

    it('should handle permission errors', () => {
      const error = errorHandler.handlePermissionError('DELETE_MESSAGE', 'user123');

      expect(error.category).toBe(ErrorCategory.PERMISSION);
      expect(error.severity).toBe(ErrorSeverity.MEDIUM);
      expect(error.context.userId).toBe('user123');
      expect(error.context.metadata?.action).toBe('DELETE_MESSAGE');
    });
  });

  describe('Error Resolution', () => {
    it('should resolve errors', () => {
      const error = errorHandler.handleError('Test error', ErrorCategory.NETWORK);
      expect(error.resolved).toBe(false);

      const resolved = errorHandler.resolveError(error.id, 'Fixed network issue');
      expect(resolved).toBe(true);

      const updatedError = errorHandler.getError(error.id);
      expect(updatedError?.resolved).toBe(true);
      expect(updatedError?.resolution).toBe('Fixed network issue');
    });

    it('should not resolve already resolved errors', () => {
      const error = errorHandler.handleError('Test error', ErrorCategory.NETWORK);
      errorHandler.resolveError(error.id, 'First resolution');

      const secondResolve = errorHandler.resolveError(error.id, 'Second resolution');
      expect(secondResolve).toBe(false);

      const updatedError = errorHandler.getError(error.id);
      expect(updatedError?.resolution).toBe('First resolution');
    });
  });

  describe('Error Queries', () => {
    beforeEach(() => {
      // Create test errors
      errorHandler.handleError('Error 1', ErrorCategory.DATABASE, ErrorSeverity.HIGH);
      errorHandler.handleError('Error 2', ErrorCategory.NETWORK, ErrorSeverity.MEDIUM);
      errorHandler.handleError('Error 3', ErrorCategory.DATABASE, ErrorSeverity.LOW);
      
      const error4 = errorHandler.handleError('Error 4', ErrorCategory.VALIDATION, ErrorSeverity.MEDIUM);
      errorHandler.resolveError(error4.id, 'Test resolution');
    });

    it('should filter errors by category', () => {
      const dbErrors = errorHandler.getErrors({ category: ErrorCategory.DATABASE });
      expect(dbErrors).toHaveLength(2);
      expect(dbErrors.every(e => e.category === ErrorCategory.DATABASE)).toBe(true);
    });

    it('should filter errors by severity', () => {
      const highErrors = errorHandler.getErrors({ severity: ErrorSeverity.HIGH });
      expect(highErrors).toHaveLength(1);
      expect(highErrors[0].severity).toBe(ErrorSeverity.HIGH);
    });

    it('should filter errors by resolution status', () => {
      const unresolved = errorHandler.getErrors({ resolved: false });
      const resolved = errorHandler.getErrors({ resolved: true });
      
      expect(unresolved).toHaveLength(3);
      expect(resolved).toHaveLength(1);
    });

    it('should limit results', () => {
      const errors = errorHandler.getErrors({ limit: 2 });
      expect(errors).toHaveLength(2);
    });
  });

  describe('Error Statistics', () => {
    beforeEach(() => {
      errorHandler.handleError('DB Error 1', ErrorCategory.DATABASE, ErrorSeverity.HIGH);
      errorHandler.handleError('DB Error 2', ErrorCategory.DATABASE, ErrorSeverity.MEDIUM);
      errorHandler.handleError('Network Error', ErrorCategory.NETWORK, ErrorSeverity.LOW);
      
      const resolvedError = errorHandler.handleError('Validation Error', ErrorCategory.VALIDATION, ErrorSeverity.MEDIUM);
      errorHandler.resolveError(resolvedError.id, 'Fixed');
    });

    it('should provide error statistics', () => {
      const stats = errorHandler.getErrorStats('day');

      expect(stats.total).toBe(4);
      expect(stats.unresolved).toBe(3);
      expect(stats.byCategory[ErrorCategory.DATABASE]).toBe(2);
      expect(stats.byCategory[ErrorCategory.NETWORK]).toBe(1);
      expect(stats.byCategory[ErrorCategory.VALIDATION]).toBe(1);
      expect(stats.bySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(stats.bySeverity[ErrorSeverity.MEDIUM]).toBe(2);
      expect(stats.bySeverity[ErrorSeverity.LOW]).toBe(1);
    });
  });

  describe('Error Callbacks', () => {
    it('should execute callbacks on error occurrence', (done) => {
      let callbackExecuted = false;
      
      errorHandler.onError(ErrorSeverity.HIGH, (error: StructuredError) => {
        expect(error.severity).toBe(ErrorSeverity.HIGH);
        expect(error.message).toBe('High severity error');
        callbackExecuted = true;
        done();
      });

      errorHandler.handleError('High severity error', ErrorCategory.DATABASE, ErrorSeverity.HIGH);
      
      // Give callback time to execute
      setTimeout(() => {
        if (!callbackExecuted) {
          done.fail('Callback was not executed');
        }
      }, 100);
    });
  });

  describe('Error Cleanup', () => {
    it('should clear resolved errors', () => {
      const error1 = errorHandler.handleError('Error 1', ErrorCategory.DATABASE);
      const error2 = errorHandler.handleError('Error 2', ErrorCategory.NETWORK);
      
      errorHandler.resolveError(error1.id, 'Fixed');

      const clearedCount = errorHandler.clearErrors({ resolved: true });
      expect(clearedCount).toBe(1);

      expect(errorHandler.getError(error1.id)).toBeUndefined();
      expect(errorHandler.getError(error2.id)).toBeDefined();
    });

    it('should clear old errors', () => {
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      
      errorHandler.handleError('Recent error', ErrorCategory.DATABASE);
      
      const clearedCount = errorHandler.clearErrors({ olderThan: oldDate });
      expect(clearedCount).toBe(0); // No errors older than 1 day
      
      const clearedCount2 = errorHandler.clearErrors({ olderThan: new Date() });
      expect(clearedCount2).toBe(1); // Clear the recent error
    });
  });

  describe('Error Export', () => {
    beforeEach(() => {
      errorHandler.handleError('Test error 1', ErrorCategory.DATABASE, ErrorSeverity.HIGH);
      errorHandler.handleError('Test error 2', ErrorCategory.NETWORK, ErrorSeverity.MEDIUM);
    });

    it('should export errors as JSON', () => {
      const jsonExport = errorHandler.exportErrors('json');
      const errors = JSON.parse(jsonExport);
      
      expect(Array.isArray(errors)).toBe(true);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toHaveProperty('id');
      expect(errors[0]).toHaveProperty('message');
      expect(errors[0]).toHaveProperty('category');
    });

    it('should export errors as CSV', () => {
      const csvExport = errorHandler.exportErrors('csv');
      const lines = csvExport.split('\n');
      
      expect(lines[0]).toBe('id,timestamp,message,category,severity,resolved');
      expect(lines).toHaveLength(3); // Header + 2 data rows
    });
  });
});