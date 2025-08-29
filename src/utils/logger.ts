/**
 * 统一日志系统
 * 在生产环境中自动禁用console输出，开发环境保留调试信息
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private isDevelopment = import.meta.env.DEV;

  private formatMessage(level: LogLevel, message: string, ...args: any[]): void {
    if (!this.isDevelopment) return;

    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
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
    }
  }

  debug(message: string, ...args: any[]): void {
    this.formatMessage('debug', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.formatMessage('info', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.formatMessage('warn', message, ...args);
  }

  error(message: string, ...args: any[]): void {
    this.formatMessage('error', message, ...args);
  }

  // 专门用于绘图相关的调试
  drawing(message: string, ...args: any[]): void {
    if (!this.isDevelopment) return;
    console.log(`🎨 [DRAWING]`, message, ...args);
  }

  // 专门用于工具相关的调试
  tool(message: string, ...args: any[]): void {
    if (!this.isDevelopment) return;
    console.log(`🔧 [TOOL]`, message, ...args);
  }

  // 专门用于上传相关的调试
  upload(message: string, ...args: any[]): void {
    if (!this.isDevelopment) return;
    console.log(`📤 [UPLOAD]`, message, ...args);
  }
}

export const logger = new Logger();