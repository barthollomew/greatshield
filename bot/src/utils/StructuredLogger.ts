import fs from 'fs';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export interface LogContext {
  userId?: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
  component?: string;
  operation?: string;
  requestId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context: LogContext;
  source: string;
  hostname: string;
  processId: number;
  threadId: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  filePath?: string;
  maxFileSize: number; // bytes
  maxFiles: number;
  enableJSON: boolean;
  includeStackTrace: boolean;
  enablePerformanceLogging: boolean;
  bufferSize: number;
  flushInterval: number; // milliseconds
}

export class StructuredLogger {
  private config: LoggerConfig;
  private logBuffer: LogEntry[] = [];
  private flushTimer?: NodeJS.Timeout;
  private fileHandle?: number;
  private currentFileSize = 0;
  private performanceTimers = new Map<string, number>();
  private hostname: string;
  private processId: number;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      enableConsole: true,
      enableFile: false,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      enableJSON: true,
      includeStackTrace: false,
      enablePerformanceLogging: true,
      bufferSize: 100,
      flushInterval: 5000, // 5 seconds
      ...config
    };

    this.hostname = require('os').hostname();
    this.processId = process.pid;

    if (this.config.enableFile && this.config.filePath) {
      this.initializeFileLogging();
    }

    // Set up periodic flush
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval);

    // Flush on process exit
    process.on('exit', () => this.flush());
    process.on('SIGINT', () => {
      this.flush();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      this.flush();
      process.exit(0);
    });
  }

  /**
   * Log debug message
   */
  debug(message: string, context: LogContext = {}): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context: LogContext = {}): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context: LogContext = {}): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log error message
   */
  error(message: string, context: LogContext = {}, error?: Error): void {
    const enhancedContext = { ...context };
    
    if (error) {
      enhancedContext.metadata = {
        ...enhancedContext.metadata,
        error: {
          name: error.name,
          message: error.message,
          stack: this.config.includeStackTrace ? error.stack : undefined
        }
      };
    }

    this.log(LogLevel.ERROR, message, enhancedContext);
  }

  /**
   * Log fatal error message
   */
  fatal(message: string, context: LogContext = {}, error?: Error): void {
    const enhancedContext = { ...context };
    
    if (error) {
      enhancedContext.metadata = {
        ...enhancedContext.metadata,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack // Always include stack trace for fatal errors
        }
      };
    }

    this.log(LogLevel.FATAL, message, enhancedContext);
    
    // Immediately flush fatal errors
    this.flush();
  }

  /**
   * Start performance timer
   */
  startTimer(operation: string, context: LogContext = {}): void {
    if (!this.config.enablePerformanceLogging) return;

    const key = `${operation}_${context.requestId || 'default'}`;
    this.performanceTimers.set(key, Date.now());
  }

  /**
   * End performance timer and log duration
   */
  endTimer(operation: string, context: LogContext = {}): number {
    if (!this.config.enablePerformanceLogging) return 0;

    const key = `${operation}_${context.requestId || 'default'}`;
    const startTime = this.performanceTimers.get(key);
    
    if (!startTime) {
      this.warn('Timer not found', { operation, ...context });
      return 0;
    }

    const duration = Date.now() - startTime;
    this.performanceTimers.delete(key);

    this.info(`Operation completed: ${operation}`, {
      ...context,
      operation,
      metadata: { ...context.metadata, duration }
    });

    return duration;
  }

  /**
   * Log HTTP request
   */
  logRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    context: LogContext = {}
  ): void {
    const level = statusCode >= 500 ? LogLevel.ERROR : 
                  statusCode >= 400 ? LogLevel.WARN : 
                  LogLevel.INFO;

    this.log(level, `${method} ${url} ${statusCode}`, {
      ...context,
      component: 'http',
      operation: 'request',
      metadata: {
        ...context.metadata,
        method,
        url,
        statusCode,
        duration
      }
    });
  }

  /**
   * Log moderation action
   */
  logModerationAction(
    action: string,
    userId: string,
    reason: string,
    context: LogContext = {}
  ): void {
    this.info(`Moderation action: ${action}`, {
      ...context,
      userId,
      component: 'moderation',
      operation: 'action',
      metadata: {
        ...context.metadata,
        action,
        reason
      }
    });
  }

  /**
   * Log database operation
   */
  logDatabaseOperation(
    operation: string,
    table?: string,
    duration?: number,
    context: LogContext = {}
  ): void {
    this.debug(`Database operation: ${operation}`, {
      ...context,
      component: 'database',
      operation: 'query',
      metadata: {
        ...context.metadata,
        dbOperation: operation,
        table,
        duration
      }
    });
  }

  /**
   * Log security event
   */
  logSecurityEvent(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    context: LogContext = {}
  ): void {
    const level = severity === 'critical' ? LogLevel.FATAL :
                  severity === 'high' ? LogLevel.ERROR :
                  severity === 'medium' ? LogLevel.WARN :
                  LogLevel.INFO;

    this.log(level, `Security event: ${event}`, {
      ...context,
      component: 'security',
      operation: 'event',
      metadata: {
        ...context.metadata,
        event,
        severity
      }
    });
  }

  /**
   * Create child logger with default context
   */
  createChild(defaultContext: LogContext): StructuredLogger {
    const childLogger = new StructuredLogger(this.config);
    
    // Override the log method to include default context
    const originalLog = childLogger.log.bind(childLogger);
    childLogger.log = (level: LogLevel, message: string, context: LogContext = {}) => {
      originalLog(level, message, { ...defaultContext, ...context });
    };

    return childLogger;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Force flush all buffered logs
   */
  flush(): void {
    if (this.logBuffer.length === 0) return;

    const logsToFlush = [...this.logBuffer];
    this.logBuffer = [];

    if (this.config.enableFile && this.fileHandle !== undefined) {
      this.writeLogsToFile(logsToFlush);
    }
  }

  /**
   * Get log statistics
   */
  getStats(): {
    bufferSize: number;
    totalLogs: number;
    fileSize: number;
    timersActive: number;
  } {
    return {
      bufferSize: this.logBuffer.length,
      totalLogs: this.logBuffer.length,
      fileSize: this.currentFileSize,
      timersActive: this.performanceTimers.size
    };
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, context: LogContext = {}): void {
    if (level < this.config.level) return;

    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context,
      source: this.getSource(),
      hostname: this.hostname,
      processId: this.processId,
      threadId: this.getThreadId()
    };

    // Add to buffer
    this.logBuffer.push(logEntry);

    // Console output (immediate)
    if (this.config.enableConsole) {
      this.writeToConsole(logEntry);
    }

    // Flush if buffer is full
    if (this.logBuffer.length >= this.config.bufferSize) {
      this.flush();
    }
  }

  /**
   * Write log entry to console
   */
  private writeToConsole(logEntry: LogEntry): void {
    const timestamp = logEntry.timestamp.toISOString();
    const levelName = LogLevel[logEntry.level];
    const contextStr = Object.keys(logEntry.context).length > 0 ? 
      ` ${JSON.stringify(logEntry.context)}` : '';

    const logLine = this.config.enableJSON ?
      JSON.stringify(logEntry) :
      `[${timestamp}] ${levelName} ${logEntry.message}${contextStr}`;

    switch (logEntry.level) {
      case LogLevel.DEBUG:
        console.debug(logLine);
        break;
      case LogLevel.INFO:
        console.info(logLine);
        break;
      case LogLevel.WARN:
        console.warn(logLine);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(logLine);
        break;
    }
  }

  /**
   * Initialize file logging
   */
  private initializeFileLogging(): void {
    try {
      const dir = path.dirname(this.config.filePath!);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Rotate if file exists and is too large
      if (fs.existsSync(this.config.filePath!)) {
        const stats = fs.statSync(this.config.filePath!);
        if (stats.size >= this.config.maxFileSize) {
          this.rotateLogFile();
        } else {
          this.currentFileSize = stats.size;
        }
      }

      this.fileHandle = fs.openSync(this.config.filePath!, 'a');
    } catch (error) {
      console.error('Failed to initialize file logging:', error);
      this.config.enableFile = false;
    }
  }

  /**
   * Write logs to file
   */
  private writeLogsToFile(logs: LogEntry[]): void {
    if (!this.fileHandle) return;

    try {
      const logLines = logs.map(log => 
        this.config.enableJSON ? 
          JSON.stringify(log) + '\n' :
          this.formatLogLine(log) + '\n'
      );

      const buffer = Buffer.from(logLines.join(''));
      fs.writeSync(this.fileHandle, buffer);
      
      this.currentFileSize += buffer.length;

      // Check if rotation is needed
      if (this.currentFileSize >= this.config.maxFileSize) {
        this.rotateLogFile();
      }
    } catch (error) {
      console.error('Failed to write logs to file:', error);
    }
  }

  /**
   * Format log line for text output
   */
  private formatLogLine(logEntry: LogEntry): string {
    const timestamp = logEntry.timestamp.toISOString();
    const levelName = LogLevel[logEntry.level].padEnd(5);
    const component = logEntry.context.component ? `[${logEntry.context.component}] ` : '';
    const operation = logEntry.context.operation ? `${logEntry.context.operation}: ` : '';
    
    let line = `${timestamp} ${levelName} ${component}${operation}${logEntry.message}`;
    
    if (logEntry.context.userId) line += ` user:${logEntry.context.userId}`;
    if (logEntry.context.guildId) line += ` guild:${logEntry.context.guildId}`;
    if (logEntry.duration) line += ` duration:${logEntry.duration}ms`;
    
    return line;
  }

  /**
   * Rotate log file
   */
  private rotateLogFile(): void {
    if (!this.config.filePath || !this.fileHandle) return;

    try {
      fs.closeSync(this.fileHandle);
      
      // Rotate existing files
      for (let i = this.config.maxFiles - 1; i > 0; i--) {
        const oldFile = `${this.config.filePath}.${i}`;
        const newFile = `${this.config.filePath}.${i + 1}`;
        
        if (fs.existsSync(oldFile)) {
          if (i === this.config.maxFiles - 1) {
            fs.unlinkSync(oldFile); // Delete oldest
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      // Move current file to .1
      if (fs.existsSync(this.config.filePath)) {
        fs.renameSync(this.config.filePath, `${this.config.filePath}.1`);
      }

      // Create new file
      this.fileHandle = fs.openSync(this.config.filePath, 'w');
      this.currentFileSize = 0;
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  /**
   * Get source information
   */
  private getSource(): string {
    if (!this.config.includeStackTrace) return 'unknown';
    
    const stack = new Error().stack;
    if (!stack) return 'unknown';
    
    const lines = stack.split('\n');
    // Find first line that's not from this logger
    const sourceLine = lines.find(line => 
      line.includes('.ts:') && 
      !line.includes('StructuredLogger.ts') &&
      !line.includes('Logger.ts')
    );
    
    if (!sourceLine) return 'unknown';
    
    const match = sourceLine.match(/at\s+(?:.*\s+\()?([^(]+):(\d+):(\d+)/);
    return match ? `${path.basename(match[1])}:${match[2]}` : 'unknown';
  }

  /**
   * Get thread ID (simplified for Node.js)
   */
  private getThreadId(): string {
    return 'main';
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flush();
    
    if (this.fileHandle) {
      fs.closeSync(this.fileHandle);
    }
    
    this.performanceTimers.clear();
  }
}