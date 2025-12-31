/**
 * 改进的内存监控系统
 * 支持自动清理和主动预防内存溢出
 *
 * 优化：降低清理阈值，添加移动端适配，渐进式清理
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
  // 新增：设备类型
  isMobile: boolean;
}

export interface CleanupAction {
  name: string;
  execute: () => void;
  priority: 'low' | 'medium' | 'high';
}

// 检测是否为移动端设备
function detectMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

export class ImprovedMemoryMonitor {
  private static instance: ImprovedMemoryMonitor;
  private readonly isMobile: boolean;

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
    isMobile: false,
  };

  // 内存警告阈值（降低以更早预警）
  private readonly WARNING_THRESHOLDS = {
    totalItems: 3000,      // 5000 -> 3000
    gridItems: 2000,       // 3000 -> 2000
    poolSize: 800,         // 1000 -> 800
    timeSinceCleanup: 3 * 60 * 1000, // 5分钟 -> 3分钟
  };

  // 内存清理阈值（根据设备类型动态调整）
  private getCleanupThresholds() {
    if (this.isMobile) {
      // 移动端：更激进的清理策略
      return {
        lightCleanup: 0.50,      // 50% 时轻度清理
        aggressiveCleanup: 0.65, // 65% 时主动清理
        criticalCleanup: 0.80,   // 80% 时强制清理
      };
    }
    // 桌面端：稍微宽松一些
    return {
      lightCleanup: 0.60,      // 60% 时轻度清理（新增）
      aggressiveCleanup: 0.70, // 70% 时主动清理（75% -> 70%）
      criticalCleanup: 0.85,   // 85% 时强制清理（90% -> 85%）
    };
  }

  // 绝对内存阈值（根据设备类型）
  private getAbsoluteHeapLimit(): number {
    if (this.isMobile) {
      return 400 * 1024 * 1024; // 移动端 400MB
    }
    return 700 * 1024 * 1024;   // 桌面端 700MB（900MB -> 700MB）
  }

  // 清理回调
  private cleanupCallbacks: CleanupAction[] = [];
  private previousWarningState = false;
  private monitoringInterval: number | null = null;

  // 私有构造函数（单例模式）
  private constructor() {
    this.isMobile = detectMobileDevice();
    this.stats.isMobile = this.isMobile;
    if (this.isMobile) {
      console.log('[MemoryMonitor] 检测到移动端设备，使用更激进的清理策略');
    }
  }

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
   * 检查并执行清理（三级清理策略）
   */
  private checkAndCleanup(): void {
    this.updateBrowserMemoryStats();
    const thresholds = this.getCleanupThresholds();
    const absoluteLimit = this.getAbsoluteHeapLimit();

    const heapUsageRatio =
      this.stats.browserMemory.jsHeapSizeLimit > 0
        ? this.stats.browserMemory.usedJSHeapSize /
          this.stats.browserMemory.jsHeapSizeLimit
        : 0;

    const heapUsageMB = this.stats.browserMemory.usedJSHeapSize / (1024 * 1024);
    const heapLimitMB = this.stats.browserMemory.jsHeapSizeLimit / (1024 * 1024);
    const absoluteLimitMB = absoluteLimit / (1024 * 1024);

    // 同时检查比例阈值和绝对阈值
    const exceedsAbsoluteLimit = this.stats.browserMemory.usedJSHeapSize > absoluteLimit;

    // 三级清理策略
    if (heapUsageRatio > thresholds.criticalCleanup || exceedsAbsoluteLimit) {
      console.warn(
        `[MemoryMonitor] 🔴 触发强制清理 (${heapUsageMB.toFixed(0)}MB / ${heapLimitMB.toFixed(0)}MB = ${(heapUsageRatio * 100).toFixed(1)}%, 绝对上限: ${absoluteLimitMB.toFixed(0)}MB)`
      );
      this.executeCleanup('critical');
    } else if (heapUsageRatio > thresholds.aggressiveCleanup) {
      console.warn(
        `[MemoryMonitor] 🟠 触发主动清理 (${heapUsageMB.toFixed(0)}MB / ${heapLimitMB.toFixed(0)}MB = ${(heapUsageRatio * 100).toFixed(1)}%)`
      );
      this.executeCleanup('aggressive');
    } else if (heapUsageRatio > thresholds.lightCleanup) {
      console.log(
        `[MemoryMonitor] 🟡 触发轻度清理 (${heapUsageMB.toFixed(0)}MB / ${heapLimitMB.toFixed(0)}MB = ${(heapUsageRatio * 100).toFixed(1)}%)`
      );
      this.executeCleanup('light');
    }

    // 检查内存警告状态
    this.checkMemoryWarning();
  }

  /**
   * 执行清理操作（三级清理）
   * @param level 清理级别：light | aggressive | critical
   */
  private executeCleanup(level: 'light' | 'aggressive' | 'critical'): void {
    const levelNames = { light: '轻度', aggressive: '主动', critical: '强制' };
    console.log(`[MemoryMonitor] 执行${levelNames[level]}清理...`);

    // 根据清理级别决定执行哪些回调
    for (const action of this.cleanupCallbacks) {
      const shouldExecute =
        level === 'critical' ||  // 强制清理：执行所有
        (level === 'aggressive' && action.priority !== 'low') ||  // 主动清理：high + medium
        (level === 'light' && action.priority === 'high');  // 轻度清理：仅 high

      if (shouldExecute) {
        try {
          console.log(`[MemoryMonitor] 执行清理: ${action.name} (${action.priority})`);
          action.execute();
        } catch (error) {
          console.error(`[MemoryMonitor] 清理操作失败 (${action.name}):`, error);
        }
      }
    }

    // 强制清理时尝试触发垃圾回收
    if (level === 'critical' && typeof (window as any).gc === 'function') {
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

    const thresholds = this.getCleanupThresholds();
    const absoluteLimit = this.getAbsoluteHeapLimit();

    // 使用动态阈值判断警告
    const heapWarning =
      this.stats.browserMemory.supported &&
      (heapUsageRatio > thresholds.aggressiveCleanup ||
        this.stats.browserMemory.usedJSHeapSize > absoluteLimit);

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
   * 手动触发强制清理
   */
  forceCleanup(): void {
    console.log('[MemoryMonitor] 手动触发强制清理');
    this.executeCleanup('critical');
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
