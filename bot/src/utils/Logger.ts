import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { ILogger, LogContext } from '../core/interfaces/ILogger';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from './ErrorHandler';

export class Logger implements ILogger {
  private winston: winston.Logger;
  private errorHandler?: ErrorHandler;

  constructor(logLevel: string = 'info', logFile?: string) {
    // Ensure logs directory exists
    const logsDir = path.dirname(logFile || './logs/greatshield.log');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const formats = [
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ];

    const transports: winston.transport[] = [
      // Console transport with colorized output for development
      new winston.transports.Console({
        level: logLevel,
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}]: ${message}${metaStr}`;
          })
        )
      })
    ];

    // Add file transport if logFile is specified
    if (logFile) {
      transports.push(
        new winston.transports.File({
          filename: logFile,
          level: logLevel,
          format: winston.format.combine(...formats),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
          tailable: true
        })
      );

      // Error log file
      transports.push(
        new winston.transports.File({
          filename: path.join(path.dirname(logFile), 'error.log'),
          level: 'error',
          format: winston.format.combine(...formats),
          maxsize: 5242880, // 5MB
          maxFiles: 3
        })
      );
    }

    this.winston = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(...formats),
      transports,
      exitOnError: false
    });

    // Handle uncaught exceptions and rejections
    this.winston.exceptions.handle(
      new winston.transports.File({ 
        filename: path.join(logsDir, 'exceptions.log'),
        maxsize: 5242880,
        maxFiles: 2
      })
    );

    this.winston.rejections.handle(
      new winston.transports.File({ 
        filename: path.join(logsDir, 'rejections.log'),
        maxsize: 5242880,
        maxFiles: 2
      })
    );

    // Initialize error handler after winston logger is set up
    this.errorHandler = new ErrorHandler(this);
  }

  /**
   * Set error handler for structured error logging
   */
  setErrorHandler(errorHandler: ErrorHandler): void {
    this.errorHandler = errorHandler;
  }

  /**
   * Get error handler instance
   */
  getErrorHandler(): ErrorHandler | undefined {
    return this.errorHandler;
  }

  info(message: string, context?: LogContext): void {
    this.winston.info(message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.winston.warn(message, context);
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.winston.error(message, context);
    
    // Log structured error if error handler is available
    if (this.errorHandler && error) {
      this.errorHandler.handleError(error, ErrorCategory.UNKNOWN, ErrorSeverity.HIGH, {
        operation: 'logging',
        component: 'logger',
        ...context
      });
    }
  }

  debug(message: string, context?: LogContext): void {
    this.winston.debug(message, context);
  }

  verbose(message: string, context?: LogContext): void {
    this.winston.verbose(message, context);
  }

  // Method to log moderation events specifically
  moderation(action: string, messageId: string, userId: string, reason: string, additional?: LogContext): void {
    this.info('Moderation action taken', {
      action,
      messageId,
      userId,
      reason,
      category: 'moderation',
      ...additional
    });
  }

  // Method to log security events
  security(event: string, details: LogContext): void {
    this.warn('Security event', {
      event,
      category: 'security',
      ...details
    });
  }

  // Method to log performance metrics
  performance(operation: string, duration: number, additional?: LogContext): void {
    this.debug('Performance metric', {
      operation,
      duration,
      category: 'performance',
      ...additional
    });
  }

  // Method to create a child logger with persistent context
  child(context: LogContext): ILogger {
    const childLogger = new Logger();
    childLogger.winston = this.winston.child(context);
    return childLogger;
  }

  // Method to change log level at runtime
  setLevel(level: string): void {
    this.winston.level = level;
  }

  // Method to get current log level
  getLevel(): string {
    return this.winston.level;
  }

  // Method to close the logger and flush any pending writes
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.winston.on('finish', resolve);
      this.winston.end();
    });
  }

  // Static method to create a logger with environment-based configuration
  static create(env: 'development' | 'production' | 'test' = 'production'): Logger {
    const config = {
      development: {
        level: 'debug',
        file: './logs/greatshield-dev.log'
      },
      production: {
        level: 'info',
        file: './logs/greatshield.log'
      },
      test: {
        level: 'error',
        file: undefined // No file logging for tests
      }
    };

    const settings = config[env];
    return new Logger(settings.level, settings.file);
  }
}

// Export a default logger instance
export const defaultLogger = Logger.create(
  (process.env['NODE_ENV'] as 'development' | 'production' | 'test') || 'production'
);