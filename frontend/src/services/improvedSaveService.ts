/**
 * 改进的自动保存服务
 * 优化保存策略，减少内存峰值和频繁序列化
 */

export interface SaveConfig {
  initialDelay: number;      // 初始防抖延迟 (ms)
  minInterval: number;       // 最小保存间隔 (ms)
  maxWaitTime: number;       // 最长等待时间 (ms)
  enableIdleCallback: boolean; // 是否使用 requestIdleCallback
}

export interface SaveStats {
  totalSaves: number;
  skippedSaves: number;
  lastSaveTime: number;
  pendingChanges: boolean;
  averageSaveTime: number;
}

export class ImprovedSaveService {
  private saveTimeoutId: number | null = null;
  private lastSaveTimestamp = 0;
  private pendingChanges = false;
  private pendingSaveReason: string | null = null;
  private saveCallbacks: Array<(reason: string) => Promise<void>> = [];

  private stats: SaveStats = {
    totalSaves: 0,
    skippedSaves: 0,
    lastSaveTime: 0,
    pendingChanges: false,
    averageSaveTime: 0,
  };

  private readonly config: SaveConfig = {
    initialDelay: 500,        // 增加到500ms（从150ms）
    minInterval: 2000,        // 增加到2秒（从800ms）
    maxWaitTime: 10000,       // 最多等待10秒
    enableIdleCallback: true,
  };

  constructor(config?: Partial<SaveConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * 注册保存回调
   */
  onSave(callback: (reason: string) => Promise<void>): void {
    this.saveCallbacks.push(callback);
  }

  /**
   * 调度保存操作
   * @param reason 保存原因（用于日志）
   * @param forceImmediate 是否强制立即保存
   */
  scheduleSave(reason: string, forceImmediate = false): void {
    this.pendingChanges = true;
    this.pendingSaveReason = reason;

    if (forceImmediate) {
      this.performSave(reason);
      return;
    }

    // 清除之前的定时器
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }

    // 检查是否可以立即保存
    const timeSinceLastSave = Date.now() - this.lastSaveTimestamp;
    if (timeSinceLastSave >= this.config.minInterval) {
      // 可以立即保存
      this.performSave(reason);
    } else {
      // 需要延迟保存
      const remainingTime = this.config.minInterval - timeSinceLastSave;
      const delay = Math.max(this.config.initialDelay, remainingTime);

      this.saveTimeoutId = window.setTimeout(() => {
        if (this.pendingChanges) {
          this.performSave(reason);
        }
      }, delay);
    }
  }

  /**
   * 执行保存操作
   */
  private performSave(reason: string): void {
    const now = Date.now();
    const timeSinceLastSave = now - this.lastSaveTimestamp;

    // 防止过于频繁的保存
    if (timeSinceLastSave < this.config.minInterval) {
      console.log(
        `[Save] 跳过保存 (${timeSinceLastSave}ms < ${this.config.minInterval}ms): ${reason}`
      );
      this.stats.skippedSaves++;
      return;
    }

    console.log(`[Save] 执行保存: ${reason}`);
    this.lastSaveTimestamp = now;
    this.pendingChanges = false;
    this.stats.totalSaves++;

    // 异步执行保存，避免阻塞主线程
    if (this.config.enableIdleCallback && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(
        () => this.doActualSave(reason),
        { timeout: this.config.maxWaitTime }
      );
    } else {
      // 降级方案：使用 setTimeout
      setTimeout(() => this.doActualSave(reason), 0);
    }
  }

  /**
   * 实际执行保存逻辑
   */
  private async doActualSave(reason: string): Promise<void> {
    const startTime = performance.now();

    try {
      // 执行所有注册的保存回调
      await Promise.all(
        this.saveCallbacks.map(callback =>
          callback(reason).catch(error => {
            console.error('[Save] 保存回调执行失败:', error);
          })
        )
      );

      const duration = performance.now() - startTime;
      this.updateAverageSaveTime(duration);

      console.log(`[Save] 保存完成 (耗时: ${duration.toFixed(0)}ms)`);
    } catch (error) {
      console.error('[Save] 保存失败:', error);
    }
  }

  /**
   * 更新平均保存时间
   */
  private updateAverageSaveTime(duration: number): void {
    const totalTime = this.stats.averageSaveTime * (this.stats.totalSaves - 1) + duration;
    this.stats.averageSaveTime = totalTime / this.stats.totalSaves;
  }

  /**
   * 立即保存（用于关键操作）
   */
  async saveNow(reason: string): Promise<void> {
    this.performSave(reason);
    // 等待保存完成
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!this.pendingChanges) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // 最多等待10秒
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });
  }

  /**
   * 取消待处理的保存
   */
  cancelPendingSave(): void {
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }
    this.pendingChanges = false;
    this.pendingSaveReason = null;
  }

  /**
   * 获取保存统计信息
   */
  getStats(): SaveStats {
    return {
      ...this.stats,
      pendingChanges: this.pendingChanges,
      lastSaveTime: this.lastSaveTimestamp,
    };
  }

  /**
   * 获取保存统计摘要
   */
  getSummary(): string {
    const stats = this.getStats();
    return `SaveService: 总保存=${stats.totalSaves}, 跳过=${stats.skippedSaves}, 平均耗时=${stats.averageSaveTime.toFixed(0)}ms, 待处理=${stats.pendingChanges}`;
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      totalSaves: 0,
      skippedSaves: 0,
      lastSaveTime: 0,
      pendingChanges: false,
      averageSaveTime: 0,
    };
  }
}

// 导出单例
export const improvedSaveService = new ImprovedSaveService();
