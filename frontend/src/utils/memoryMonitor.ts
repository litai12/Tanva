// @ts-nocheck
import paper from 'paper';

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

export class MemoryMonitor {
  private static instance: MemoryMonitor;
  private stats: MemoryStats = {
    totalLayers: 0,
    totalItems: 0,
    gridItems: 0,
    activePoolSize: {
      mainDots: 0,
      minorDots: 0,
      gridLines: 0
    },
    memoryWarning: false,
    lastCleanup: Date.now(),
    browserMemory: {
      usedJSHeapSize: 0,
      totalJSHeapSize: 0,
      jsHeapSizeLimit: 0,
      supported: typeof performance !== 'undefined' && 'memory' in performance
    }
  };

  // 内存警告阈值
  private readonly WARNING_THRESHOLDS = {
    totalItems: 5000,      // 总对象超过5000个时警告
    gridItems: 3000,       // 网格对象超过3000个时警告
    poolSize: 1000,        // 对象池总大小超过1000时警告
    timeSinceCleanup: 5 * 60 * 1000  // 5分钟未清理时警告
  };
  private readonly BROWSER_HEAP_WARNING_RATIO = 0.85;
  private readonly BROWSER_HEAP_ABSOLUTE = 900 * 1024 * 1024; // 约900MB

  // 优化：添加自动清理回调机制
  private readonly AGGRESSIVE_CLEANUP_THRESHOLD = 0.75;  // 75% 时触发主动清理
  private readonly CRITICAL_CLEANUP_THRESHOLD = 0.90;    // 90% 时强制清理
  private cleanupCallbacks: Array<() => void> = [];
  private isCleaning = false;

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  // 更新Paper.js项目统计信息
  updatePaperStats(): void {
    if (!paper.project) {
      this.stats.totalLayers = 0;
      this.stats.totalItems = 0;
      this.stats.gridItems = 0;
      return;
    }

    this.stats.totalLayers = paper.project.layers.length;
    
    let totalItems = 0;
    let gridItems = 0;

    paper.project.layers.forEach(layer => {
      const layerItems = this.countItemsRecursively(layer);
      totalItems += layerItems;
      
      // 统计网格相关对象
      if (layer.name === 'grid') {
        gridItems += layerItems;
      }
    });

    this.stats.totalItems = totalItems;
    this.stats.gridItems = gridItems;
  }

  // 递归统计图层中的对象数量
  private countItemsRecursively(item: paper.Item): number {
    let count = 1; // 当前item本身

    if (item.hasChildren && item.children) {
      for (const child of item.children) {
        count += this.countItemsRecursively(child);
      }
    }

    return count;
  }

  // 更新对象池统计信息
  updatePoolStats(mainDots: number, minorDots: number, gridLines: number): void {
    this.stats.activePoolSize = {
      mainDots,
      minorDots,
      gridLines
    };
  }

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
      supported: true
    };
  }

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

  // 检查是否需要内存警告
  checkMemoryWarning(): boolean {
    const now = Date.now();
    const timeSinceCleanup = now - this.stats.lastCleanup;
    const totalPoolSize = this.stats.activePoolSize.mainDots + 
                         this.stats.activePoolSize.minorDots + 
                         this.stats.activePoolSize.gridLines;
    const heapUsageRatio =
      this.stats.browserMemory.jsHeapSizeLimit > 0
        ? this.stats.browserMemory.usedJSHeapSize /
          this.stats.browserMemory.jsHeapSizeLimit
        : 0;
    const heapWarning =
      this.stats.browserMemory.supported &&
      (heapUsageRatio > this.BROWSER_HEAP_WARNING_RATIO ||
        this.stats.browserMemory.usedJSHeapSize > this.BROWSER_HEAP_ABSOLUTE);

    const previousWarning = this.stats.memoryWarning;
    this.stats.memoryWarning = 
      this.stats.totalItems > this.WARNING_THRESHOLDS.totalItems ||
      this.stats.gridItems > this.WARNING_THRESHOLDS.gridItems ||
      totalPoolSize > this.WARNING_THRESHOLDS.poolSize ||
      timeSinceCleanup > this.WARNING_THRESHOLDS.timeSinceCleanup ||
      heapWarning;

    if (previousWarning !== this.stats.memoryWarning) {
      this.emitMemoryEvent(this.stats.memoryWarning);
      if (this.stats.memoryWarning) {
        console.warn(
          '[memoryMonitor] 检测到内存压力. usedJSHeapSize:',
          this.stats.browserMemory.usedJSHeapSize,
          'limit:',
          this.stats.browserMemory.jsHeapSizeLimit
        );
      }
    }

    return this.stats.memoryWarning;
  }

  // 标记清理完成
  markCleanup(): void {
    this.stats.lastCleanup = Date.now();
    this.stats.memoryWarning = false;
  }

  // 获取当前内存统计
  getStats(): MemoryStats {
    this.updatePaperStats();
    this.updateBrowserMemoryStats();
    this.checkMemoryWarning();
    return { ...this.stats };
  }

  // 获取内存使用摘要（用于调试）
  getMemorySummary(): string {
    const stats = this.getStats();
    const totalPoolSize = stats.activePoolSize.mainDots + 
                         stats.activePoolSize.minorDots + 
                         stats.activePoolSize.gridLines;

    return `内存统计:
- 图层总数: ${stats.totalLayers}
- 对象总数: ${stats.totalItems}
- 网格对象: ${stats.gridItems}
- 对象池大小: ${totalPoolSize} (主:${stats.activePoolSize.mainDots}, 副:${stats.activePoolSize.minorDots}, 线:${stats.activePoolSize.gridLines})
- JS堆内存: ${
      stats.browserMemory.supported
        ? `${(stats.browserMemory.usedJSHeapSize / (1024 * 1024)).toFixed(1)}MB / ${(stats.browserMemory.jsHeapSizeLimit / (1024 * 1024)).toFixed(1)}MB`
        : '不支持'
    }
- 警告状态: ${stats.memoryWarning ? '是' : '否'}
- 上次清理: ${Math.round((Date.now() - stats.lastCleanup) / 1000)}秒前`;
  }

  // 强制垃圾回收（开发模式下可用）
  forceCleanup(): void {
    // 复用统一的清理流程，确保回调被执行
    this.executeCleanup(true);
  }

  // 优化：注册内存压力清理回调
  onMemoryPressure(callback: () => void): () => void {
    this.cleanupCallbacks.push(callback);
    // 返回取消注册函数
    return () => {
      const index = this.cleanupCallbacks.indexOf(callback);
      if (index > -1) {
        this.cleanupCallbacks.splice(index, 1);
      }
    };
  }

  // 优化：检查并执行自动清理
  checkAndCleanup(): void {
    this.updateBrowserMemoryStats();

    if (!this.stats.browserMemory.supported || this.stats.browserMemory.jsHeapSizeLimit === 0) {
      return;
    }

    const heapUsageRatio = this.stats.browserMemory.usedJSHeapSize /
                          this.stats.browserMemory.jsHeapSizeLimit;

    if (heapUsageRatio > this.CRITICAL_CLEANUP_THRESHOLD) {
      console.warn('[MemoryMonitor] 触发强制清理 (堆内存 > 90%)');
      this.executeCleanup(true);
    } else if (heapUsageRatio > this.AGGRESSIVE_CLEANUP_THRESHOLD) {
      console.warn('[MemoryMonitor] 触发主动清理 (堆内存 > 75%)');
      this.executeCleanup(false);
    }
  }

  // 执行清理回调
  private executeCleanup(isForced: boolean): void {
    if (this.isCleaning) {
      console.warn('[MemoryMonitor] 清理已在进行中，跳过重复调用');
      return;
    }

    this.isCleaning = true;

    try {
      console.log(`[MemoryMonitor] 执行${isForced ? '强制' : '主动'}清理，共 ${this.cleanupCallbacks.length} 个回调`);

      // 执行所有注册的清理回调
      this.cleanupCallbacks.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error('[MemoryMonitor] 清理回调执行失败:', error);
        }
      });

      // 强制清理时尝试触发垃圾回收
      if (isForced && typeof (window as any).gc === 'function') {
        (window as any).gc();
      }

      this.markCleanup();
      this.emitMemoryEvent(false); // 发送内存压力缓解事件
    } finally {
      this.isCleaning = false;
    }
  }

  // 获取已注册的清理回调数量
  getCleanupCallbackCount(): number {
    return this.cleanupCallbacks.length;
  }
}

// 导出单例实例
export const memoryMonitor = MemoryMonitor.getInstance();
