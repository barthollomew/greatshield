export interface LogContext {
  [key: string]: any;
}

export interface ILogger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  child(context: LogContext): ILogger;
  close(): Promise<void>;
}