/**
 * 统一日志系统
 * - 默认仅输出 info 及以上（VITE_LOG_LEVEL 或 localStorage 可调整）
 * - 生产环境自动禁用所有控制台输出
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

type ScopedLogger = {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  perf: (label: string, durationMs: number, details?: Record<string, any>) => void;
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const LOG_LEVEL_STORAGE_KEY = 'tanva:log-level';

class Logger {
  private isDevelopment = import.meta.env.DEV;
  private level: LogLevel;

  constructor() {
    this.level = this.resolveInitialLevel();
  }

  private normalizeLevel(level?: string | null): LogLevel {
    if (!level) return 'info';
    const normalized = level.toLowerCase() as LogLevel;
    return ['debug', 'info', 'warn', 'error', 'silent'].includes(normalized)
      ? normalized
      : 'info';
  }

  private resolveInitialLevel(): LogLevel {
    const storedLevel = this.readStoredLevel();
    if (storedLevel) return storedLevel;
    const envLevel = this.normalizeLevel(import.meta.env?.VITE_LOG_LEVEL as string | undefined);
    return envLevel || 'info';
  }

  private readStoredLevel(): LogLevel | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const stored = localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
      return stored ? this.normalizeLevel(stored) : null;
    } catch {
      return null;
    }
  }

  private persistLevel(level: LogLevel): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(LOG_LEVEL_STORAGE_KEY, level);
    } catch {
      // ignore persistence errors (e.g. private mode)
    }
  }

  setLevel(level: LogLevel): void {
    this.level = this.normalizeLevel(level);
    this.persistLevel(this.level);
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.isDevelopment) return false;
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  private emit(level: LogLevel, message: string, scope?: string, ...args: any[]): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]${scope ? ` [${scope}]` : ''}`;

    switch (level) {
      case 'debug':
        console.log(`🔍 ${prefix}`, message, ...args);
        break;
      case 'info':
        console.log(`ℹ️ ${prefix}`, message, ...args);
        break;
      case 'warn':
        console.warn(`⚠️ ${prefix}`, message, ...args);
        break;
      case 'error':
        console.error(`❌ ${prefix}`, message, ...args);
        break;
      default:
        break;
    }
  }

  debug(message: string, ...args: any[]): void {
    this.emit('debug', message, undefined, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.emit('info', message, undefined, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.emit('warn', message, undefined, ...args);
  }

  error(message: string, ...args: any[]): void {
    this.emit('error', message, undefined, ...args);
  }

  // 绘图相关调试
  drawing(message: string, ...args: any[]): void {
    this.emit('debug', message, 'drawing', ...args);
  }

  // 工具相关调试
  tool(message: string, ...args: any[]): void {
    this.emit('debug', message, 'tool', ...args);
  }

  // 上传相关调试
  upload(message: string, ...args: any[]): void {
    this.emit('debug', message, 'upload', ...args);
  }

  // 性能计时输出
  perf(label: string, durationMs: number, details?: Record<string, any>): void {
    if (!this.shouldLog('info')) return;
    const safeDuration = Math.max(0, durationMs);
    const formattedDuration =
      safeDuration >= 1000 ? `${(safeDuration / 1000).toFixed(2)}s` : `${Math.round(safeDuration)}ms`;
    const timestamp = new Date().toLocaleTimeString();
    const extra = details && Object.keys(details).length > 0 ? details : undefined;
    console.info(`⏱️ [${timestamp}] [PERF] ${label} (${formattedDuration})`, extra ?? '');
  }

  scope(scope: string): ScopedLogger {
    return {
      debug: (message: string, ...args: any[]) => this.emit('debug', message, scope, ...args),
      info: (message: string, ...args: any[]) => this.emit('info', message, scope, ...args),
      warn: (message: string, ...args: any[]) => this.emit('warn', message, scope, ...args),
      error: (message: string, ...args: any[]) => this.emit('error', message, scope, ...args),
      perf: (label: string, durationMs: number, details?: Record<string, any>) =>
        this.perf(`${scope}: ${label}`, durationMs, details),
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.shouldLog(level);
  }
}

export const logger = new Logger();
