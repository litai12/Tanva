/**
 * 改进的内存监控系统
 * 支持自动清理和主动预防内存溢出
 */

export interface MemoryStats {
  totalLayers: number;
  totalItems: number;
  gridItems: number;
  activePoolSize: {
    mainDots: number;
    minorDots: number;
    gridLines: number;
  };
  memoryWarning: boolean;
  lastCleanup: number;
  browserMemory: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
    supported: boolean;
  };
}

export interface CleanupAction {
  name: string;
  execute: () => void;
  priority: 'low' | 'medium' | 'high';
}

export class ImprovedMemoryMonitor {
  private static instance: ImprovedMemoryMonitor;
  private stats: MemoryStats = {
    totalLayers: 0,
    totalItems: 0,
    gridItems: 0,
    activePoolSize: {
      mainDots: 0,
      minorDots: 0,
      gridLines: 0,
    },
    memoryWarning: false,
    lastCleanup: Date.now(),
    browserMemory: {
      usedJSHeapSize: 0,
      totalJSHeapSize: 0,
      jsHeapSizeLimit: 0,
      supported: typeof performance !== 'undefined' && 'memory' in performance,
    },
  };

  // 内存警告阈值
  private readonly WARNING_THRESHOLDS = {
    totalItems: 5000,
    gridItems: 3000,
    poolSize: 1000,
    timeSinceCleanup: 5 * 60 * 1000, // 5分钟
  };

  // 内存清理阈值
  private readonly CLEANUP_THRESHOLDS = {
    aggressiveCleanup: 0.75,  // 75% 时触发主动清理
    criticalCleanup: 0.90,    // 90% 时触发强制清理
  };

  private readonly BROWSER_HEAP_ABSOLUTE = 900 * 1024 * 1024; // 约900MB

  // 清理回调
  private cleanupCallbacks: CleanupAction[] = [];
  private previousWarningState = false;
  private monitoringInterval: number | null = null;

  static getInstance(): ImprovedMemoryMonitor {
    if (!ImprovedMemoryMonitor.instance) {
      ImprovedMemoryMonitor.instance = new ImprovedMemoryMonitor();
    }
    return ImprovedMemoryMonitor.instance;
  }

  /**
   * 注册清理回调
   */
  registerCleanupAction(action: CleanupAction): void {
    this.cleanupCallbacks.push(action);
    // 按优先级排序
    this.cleanupCallbacks.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * 开始监控内存
   */
  startMonitoring(interval: number = 5000): void {
    if (this.monitoringInterval !== null) {
      return;
    }

    this.monitoringInterval = window.setInterval(() => {
      this.checkAndCleanup();
    }, interval);

    console.log('[MemoryMonitor] 内存监控已启动');
  }

  /**
   * 停止监控内存
   */
  stopMonitoring(): void {
    if (this.monitoringInterval !== null) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[MemoryMonitor] 内存监控已停止');
    }
  }

  /**
   * 检查并执行清理
   */
  private checkAndCleanup(): void {
    this.updateBrowserMemoryStats();
    const heapUsageRatio =
      this.stats.browserMemory.jsHeapSizeLimit > 0
        ? this.stats.browserMemory.usedJSHeapSize /
          this.stats.browserMemory.jsHeapSizeLimit
        : 0;

    const heapUsageMB = this.stats.browserMemory.usedJSHeapSize / (1024 * 1024);
    const heapLimitMB = this.stats.browserMemory.jsHeapSizeLimit / (1024 * 1024);

    // 检查是否需要清理
    if (heapUsageRatio > this.CLEANUP_THRESHOLDS.criticalCleanup) {
      console.warn(
        `[MemoryMonitor] 触发强制清理 (堆内存 ${heapUsageMB.toFixed(0)}MB / ${heapLimitMB.toFixed(0)}MB = ${(heapUsageRatio * 100).toFixed(1)}%)`
      );
      this.executeCleanup(true); // 强制清理
    } else if (heapUsageRatio > this.CLEANUP_THRESHOLDS.aggressiveCleanup) {
      console.warn(
        `[MemoryMonitor] 触发主动清理 (堆内存 ${heapUsageMB.toFixed(0)}MB / ${heapLimitMB.toFixed(0)}MB = ${(heapUsageRatio * 100).toFixed(1)}%)`
      );
      this.executeCleanup(false); // 主动清理
    }

    // 检查内存警告状态
    this.checkMemoryWarning();
  }

  /**
   * 执行清理操作
   */
  private executeCleanup(isForced: boolean): void {
    console.log(`[MemoryMonitor] 执行${isForced ? '强制' : '主动'}清理...`);

    // 执行所有注册的清理回调
    for (const action of this.cleanupCallbacks) {
      // 强制清理时执行所有操作，主动清理时只执行高优先级
      if (isForced || action.priority === 'high') {
        try {
          console.log(`[MemoryMonitor] 执行清理: ${action.name}`);
          action.execute();
        } catch (error) {
          console.error(`[MemoryMonitor] 清理操作失败 (${action.name}):`, error);
        }
      }
    }

    // 强制清理时尝试触发垃圾回收
    if (isForced && typeof (window as any).gc === 'function') {
      console.log('[MemoryMonitor] 触发垃圾回收');
      (window as any).gc();
    }

    this.markCleanup();
  }

  /**
   * 更新浏览器内存统计
   */
  private updateBrowserMemoryStats(): void {
    if (typeof performance === 'undefined' || !(performance as any)?.memory) {
      this.stats.browserMemory.supported = false;
      return;
    }

    const memory = (performance as any).memory;
    this.stats.browserMemory = {
      usedJSHeapSize: memory.usedJSHeapSize ?? 0,
      totalJSHeapSize: memory.totalJSHeapSize ?? 0,
      jsHeapSizeLimit: memory.jsHeapSizeLimit ?? 0,
      supported: true,
    };
  }

  /**
   * 检查内存警告
   */
  private checkMemoryWarning(): void {
    const now = Date.now();
    const timeSinceCleanup = now - this.stats.lastCleanup;
    const totalPoolSize =
      this.stats.activePoolSize.mainDots +
      this.stats.activePoolSize.minorDots +
      this.stats.activePoolSize.gridLines;

    const heapUsageRatio =
      this.stats.browserMemory.jsHeapSizeLimit > 0
        ? this.stats.browserMemory.usedJSHeapSize /
          this.stats.browserMemory.jsHeapSizeLimit
        : 0;

    const heapWarning =
      this.stats.browserMemory.supported &&
      (heapUsageRatio > 0.85 ||
        this.stats.browserMemory.usedJSHeapSize > this.BROWSER_HEAP_ABSOLUTE);

    this.stats.memoryWarning =
      this.stats.totalItems > this.WARNING_THRESHOLDS.totalItems ||
      this.stats.gridItems > this.WARNING_THRESHOLDS.gridItems ||
      totalPoolSize > this.WARNING_THRESHOLDS.poolSize ||
      timeSinceCleanup > this.WARNING_THRESHOLDS.timeSinceCleanup ||
      heapWarning;

    // 状态变化时发送事件
    if (this.previousWarningState !== this.stats.memoryWarning) {
      this.emitMemoryEvent(this.stats.memoryWarning);
      this.previousWarningState = this.stats.memoryWarning;
    }
  }

  /**
   * 发送内存事件
   */
  private emitMemoryEvent(isWarning: boolean): void {
    if (typeof window === 'undefined') return;

    const eventName = isWarning ? 'memory-pressure' : 'memory-relieved';
    try {
      window.dispatchEvent(
        new CustomEvent(eventName, { detail: { stats: { ...this.stats } } })
      );
    } catch {
      // 忽略自定义事件失败
    }
  }

  /**
   * 更新 Paper.js 统计信息
   */
  updatePaperStats(
    totalLayers: number,
    totalItems: number,
    gridItems: number
  ): void {
    this.stats.totalLayers = totalLayers;
    this.stats.totalItems = totalItems;
    this.stats.gridItems = gridItems;
  }

  /**
   * 更新对象池统计信息
   */
  updatePoolStats(mainDots: number, minorDots: number, gridLines: number): void {
    this.stats.activePoolSize = {
      mainDots,
      minorDots,
      gridLines,
    };
  }

  /**
   * 标记清理完成
   */
  markCleanup(): void {
    this.stats.lastCleanup = Date.now();
  }

  /**
   * 获取当前内存统计
   */
  getStats(): MemoryStats {
    this.updateBrowserMemoryStats();
    return { ...this.stats };
  }

  /**
   * 获取内存使用摘要
   */
  getMemorySummary(): string {
    const stats = this.getStats();
    const totalPoolSize =
      stats.activePoolSize.mainDots +
      stats.activePoolSize.minorDots +
      stats.activePoolSize.gridLines;

    const heapUsageRatio =
      stats.browserMemory.jsHeapSizeLimit > 0
        ? stats.browserMemory.usedJSHeapSize / stats.browserMemory.jsHeapSizeLimit
        : 0;

    return `
内存统计:
- 图层总数: ${stats.totalLayers}
- 对象总数: ${stats.totalItems}
- 网格对象: ${stats.gridItems}
- 对象池大小: ${totalPoolSize} (主:${stats.activePoolSize.mainDots}, 副:${stats.activePoolSize.minorDots}, 线:${stats.activePoolSize.gridLines})
- JS堆内存: ${
      stats.browserMemory.supported
        ? `${(stats.browserMemory.usedJSHeapSize / (1024 * 1024)).toFixed(1)}MB / ${(stats.browserMemory.jsHeapSizeLimit / (1024 * 1024)).toFixed(1)}MB (${(heapUsageRatio * 100).toFixed(1)}%)`
        : '不支持'
    }
- 警告状态: ${stats.memoryWarning ? '是' : '否'}
- 上次清理: ${Math.round((Date.now() - stats.lastCleanup) / 1000)}秒前
- 清理回调数: ${this.cleanupCallbacks.length}
    `;
  }

  /**
   * 手动触发垃圾回收
   */
  forceCleanup(): void {
    console.log('[MemoryMonitor] 手动触发清理');
    this.executeCleanup(true);
  }

  /**
   * 获取清理回调列表
   */
  getCleanupActions(): CleanupAction[] {
    return [...this.cleanupCallbacks];
  }
}

// 导出单例实例
export const improvedMemoryMonitor = ImprovedMemoryMonitor.getInstance();
