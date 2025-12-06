/**
 * Unified logging utility for all agents
 */

type LogLevel = 'info' | 'debug' | 'error';

/**
 * Simple logger with level-based filtering
 */
export class Logger {
  private level: LogLevel;
  private context?: string;

  constructor(level: LogLevel = 'info', context?: string) {
    this.level = level;
    this.context = context;
  }

  private shouldLog(messageLevel: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'error'];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(messageLevel);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const contextStr = this.context ? `[${this.context}]` : '';
    return `${timestamp} [${level.toUpperCase()}]${contextStr} ${message}`;
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), data || '');
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message), data || '');
    }
  }

  error(message: string, error?: any): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), error || '');
    }
  }

  /**
   * Create a child logger with a specific context
   */
  child(context: string): Logger {
    const childContext = this.context ? `${this.context}:${context}` : context;
    return new Logger(this.level, childContext);
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || 'info'
);
