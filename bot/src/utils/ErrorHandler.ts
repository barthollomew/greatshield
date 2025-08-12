import { Logger } from './Logger';

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  DATABASE = 'database',
  NETWORK = 'network',
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  RATE_LIMIT = 'rate_limit',
  PERMISSION = 'permission',
  PARSING = 'parsing',
  TIMEOUT = 'timeout',
  RESOURCE = 'resource',
  UNKNOWN = 'unknown'
}

export interface ErrorContext {
  userId?: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
  operation?: string;
  component?: string;
  metadata?: Record<string, any>;
}

export interface StructuredError {
  id: string;
  timestamp: Date;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  context: ErrorContext;
  stackTrace?: string;
  originalError?: Error;
  resolved: boolean;
  resolution?: string;
}

export class ErrorHandler {
  private logger: Logger;
  private errors = new Map<string, StructuredError>();
  private maxErrorHistory = 1000;
  private errorCallbacks = new Map<ErrorSeverity, ((error: StructuredError) => void)[]>();

  constructor(logger: Logger) {
    this.logger = logger;
    
    // Set up global error handlers
    this.setupGlobalHandlers();
  }

  /**
   * Handle and log a structured error
   */
  handleError(
    error: Error | string,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    context: ErrorContext = {}
  ): StructuredError {
    const structuredError: StructuredError = {
      id: this.generateErrorId(),
      timestamp: new Date(),
      message: error instanceof Error ? error.message : error,
      category,
      severity,
      context,
      resolved: false
    };

    if (error instanceof Error) {
      if (error.stack) {
        structuredError.stackTrace = error.stack;
      }
      structuredError.originalError = error;
    }

    // Store error
    this.errors.set(structuredError.id, structuredError);
    this.maintainErrorHistory();

    // Log error based on severity
    this.logError(structuredError);

    // Execute callbacks
    this.executeCallbacks(severity, structuredError);

    // Auto-resolve low severity errors after logging
    if (severity === ErrorSeverity.LOW) {
      setTimeout(() => this.resolveError(structuredError.id, 'Auto-resolved'), 5000);
    }

    return structuredError;
  }

  /**
   * Handle database errors with specific context
   */
  handleDatabaseError(error: Error, operation: string, context: ErrorContext = {}): StructuredError {
    const severity = this.determineDatabaseErrorSeverity(error);
    
    return this.handleError(error, ErrorCategory.DATABASE, severity, {
      ...context,
      operation,
      component: 'database'
    });
  }

  /**
   * Handle network errors
   */
  handleNetworkError(error: Error, endpoint?: string, context: ErrorContext = {}): StructuredError {
    return this.handleError(error, ErrorCategory.NETWORK, ErrorSeverity.MEDIUM, {
      ...context,
      operation: 'network_request',
      component: 'network',
      metadata: { endpoint }
    });
  }

  /**
   * Handle validation errors
   */
  handleValidationError(
    message: string,
    field?: string,
    value?: any,
    context: ErrorContext = {}
  ): StructuredError {
    return this.handleError(message, ErrorCategory.VALIDATION, ErrorSeverity.LOW, {
      ...context,
      operation: 'validation',
      metadata: { field, value }
    });
  }

  /**
   * Handle rate limiting errors
   */
  handleRateLimitError(
    userId: string,
    reason: string,
    context: ErrorContext = {}
  ): StructuredError {
    return this.handleError(
      `Rate limit exceeded: ${reason}`,
      ErrorCategory.RATE_LIMIT,
      ErrorSeverity.MEDIUM,
      {
        ...context,
        userId,
        operation: 'rate_limit_check',
        component: 'rate_limiter'
      }
    );
  }

  /**
   * Handle timeout errors
   */
  handleTimeoutError(operation: string, timeoutMs: number, context: ErrorContext = {}): StructuredError {
    return this.handleError(
      `Operation timed out after ${timeoutMs}ms`,
      ErrorCategory.TIMEOUT,
      ErrorSeverity.HIGH,
      {
        ...context,
        operation,
        metadata: { timeoutMs }
      }
    );
  }

  /**
   * Handle permission errors
   */
  handlePermissionError(
    action: string,
    userId?: string,
    context: ErrorContext = {}
  ): StructuredError {
    const errorContext: ErrorContext = {
      ...context,
      operation: 'permission_check',
      metadata: { action }
    };

    if (userId) {
      errorContext.userId = userId;
    }

    return this.handleError(
      `Permission denied for action: ${action}`,
      ErrorCategory.PERMISSION,
      ErrorSeverity.MEDIUM,
      errorContext
    );
  }

  /**
   * Resolve an error
   */
  resolveError(errorId: string, resolution: string): boolean {
    const error = this.errors.get(errorId);
    if (!error || error.resolved) {
      return false;
    }

    error.resolved = true;
    error.resolution = resolution;
    this.errors.set(errorId, error);

    this.logger.info('Error resolved', {
      errorId,
      resolution,
      category: error.category,
      severity: error.severity
    });

    return true;
  }

  /**
   * Get error by ID
   */
  getError(errorId: string): StructuredError | undefined {
    return this.errors.get(errorId);
  }

  /**
   * Get errors by criteria
   */
  getErrors(filters: {
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    resolved?: boolean;
    since?: Date;
    limit?: number;
  } = {}): StructuredError[] {
    let errors = Array.from(this.errors.values());

    if (filters.category) {
      errors = errors.filter(e => e.category === filters.category);
    }

    if (filters.severity) {
      errors = errors.filter(e => e.severity === filters.severity);
    }

    if (filters.resolved !== undefined) {
      errors = errors.filter(e => e.resolved === filters.resolved);
    }

    if (filters.since) {
      errors = errors.filter(e => e.timestamp >= filters.since!);
    }

    // Sort by timestamp (newest first)
    errors.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filters.limit) {
      errors = errors.slice(0, filters.limit);
    }

    return errors;
  }

  /**
   * Get error statistics
   */
  getErrorStats(timeframe: 'hour' | 'day' | 'week' = 'day'): {
    total: number;
    unresolved: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
    errorRate: number;
  } {
    const now = new Date();
    const timeframeMs = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000
    };

    const since = new Date(now.getTime() - timeframeMs[timeframe]);
    const relevantErrors = this.getErrors({ since });

    const byCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.DATABASE]: 0,
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.AUTHENTICATION]: 0,
      [ErrorCategory.RATE_LIMIT]: 0,
      [ErrorCategory.PERMISSION]: 0,
      [ErrorCategory.PARSING]: 0,
      [ErrorCategory.TIMEOUT]: 0,
      [ErrorCategory.RESOURCE]: 0,
      [ErrorCategory.UNKNOWN]: 0
    };

    const bySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.CRITICAL]: 0
    };

    relevantErrors.forEach(error => {
      byCategory[error.category]++;
      bySeverity[error.severity]++;
    });

    return {
      total: relevantErrors.length,
      unresolved: relevantErrors.filter(e => !e.resolved).length,
      byCategory,
      bySeverity,
      errorRate: relevantErrors.length / (timeframeMs[timeframe] / 1000) // errors per second
    };
  }

  /**
   * Register callback for specific error severity
   */
  onError(severity: ErrorSeverity, callback: (error: StructuredError) => void): void {
    if (!this.errorCallbacks.has(severity)) {
      this.errorCallbacks.set(severity, []);
    }
    this.errorCallbacks.get(severity)!.push(callback);
  }

  /**
   * Clear all errors or by criteria
   */
  clearErrors(filters: { resolved?: boolean; olderThan?: Date } = {}): number {
    let clearedCount = 0;

    for (const [id, error] of this.errors.entries()) {
      let shouldClear = true;

      if (filters.resolved !== undefined && error.resolved !== filters.resolved) {
        shouldClear = false;
      }

      if (filters.olderThan && error.timestamp >= filters.olderThan) {
        shouldClear = false;
      }

      if (shouldClear) {
        this.errors.delete(id);
        clearedCount++;
      }
    }

    this.logger.info('Errors cleared', {
      count: clearedCount,
      filters
    });

    return clearedCount;
  }

  /**
   * Export errors for analysis
   */
  exportErrors(format: 'json' | 'csv' = 'json'): string {
    const errors = this.getErrors();

    if (format === 'csv') {
      const headers = ['id', 'timestamp', 'message', 'category', 'severity', 'resolved'];
      const rows = errors.map(error => [
        error.id,
        error.timestamp.toISOString(),
        `"${error.message.replace(/"/g, '""')}"`,
        error.category,
        error.severity,
        error.resolved.toString()
      ]);

      return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    return JSON.stringify(errors, null, 2);
  }

  /**
   * Set up global error handlers
   */
  private setupGlobalHandlers(): void {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.handleError(error, ErrorCategory.UNKNOWN, ErrorSeverity.CRITICAL, {
        component: 'process',
        operation: 'uncaught_exception'
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any, _promise: Promise<any>) => {
      this.handleError(
        reason instanceof Error ? reason : new Error(String(reason)),
        ErrorCategory.UNKNOWN,
        ErrorSeverity.HIGH,
        {
          component: 'process',
          operation: 'unhandled_rejection'
        }
      );
    });
  }

  /**
   * Log error based on severity
   */
  private logError(error: StructuredError): void {
    const logData = {
      errorId: error.id,
      category: error.category,
      context: error.context,
      stack: error.stackTrace
    };

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        this.logger.error(`[CRITICAL] ${error.message}`, logData);
        break;
      case ErrorSeverity.HIGH:
        this.logger.error(`[HIGH] ${error.message}`, logData);
        break;
      case ErrorSeverity.MEDIUM:
        this.logger.warn(`[MEDIUM] ${error.message}`, logData);
        break;
      case ErrorSeverity.LOW:
        this.logger.info(`[LOW] ${error.message}`, logData);
        break;
    }
  }

  /**
   * Execute registered callbacks for error severity
   */
  private executeCallbacks(severity: ErrorSeverity, error: StructuredError): void {
    const callbacks = this.errorCallbacks.get(severity);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(error);
        } catch (callbackError) {
          this.logger.error('Error in error callback', { 
            callbackError: String(callbackError),
            originalErrorId: error.id 
          });
        }
      });
    }
  }

  /**
   * Determine severity for database errors
   */
  private determineDatabaseErrorSeverity(error: Error): ErrorSeverity {
    const message = error.message.toLowerCase();
    
    if (message.includes('database is locked') || 
        message.includes('no such table') ||
        message.includes('syntax error')) {
      return ErrorSeverity.HIGH;
    }

    if (message.includes('constraint') || 
        message.includes('foreign key')) {
      return ErrorSeverity.MEDIUM;
    }

    return ErrorSeverity.HIGH; // Default for database errors
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Maintain error history within limits
   */
  private maintainErrorHistory(): void {
    if (this.errors.size > this.maxErrorHistory) {
      const sortedErrors = Array.from(this.errors.entries())
        .sort(([, a], [, b]) => a.timestamp.getTime() - b.timestamp.getTime());

      const toRemove = sortedErrors.slice(0, sortedErrors.length - this.maxErrorHistory);
      toRemove.forEach(([id]) => this.errors.delete(id));
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.errorCallbacks.clear();
    this.errors.clear();
    this.logger.info('ErrorHandler destroyed');
  }
}