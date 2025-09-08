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
    lastCleanup: Date.now()
  };

  // 内存警告阈值
  private readonly WARNING_THRESHOLDS = {
    totalItems: 5000,      // 总对象超过5000个时警告
    gridItems: 3000,       // 网格对象超过3000个时警告
    poolSize: 1000,        // 对象池总大小超过1000时警告
    timeSinceCleanup: 5 * 60 * 1000  // 5分钟未清理时警告
  };

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

  // 检查是否需要内存警告
  checkMemoryWarning(): boolean {
    const now = Date.now();
    const timeSinceCleanup = now - this.stats.lastCleanup;
    const totalPoolSize = this.stats.activePoolSize.mainDots + 
                         this.stats.activePoolSize.minorDots + 
                         this.stats.activePoolSize.gridLines;

    this.stats.memoryWarning = 
      this.stats.totalItems > this.WARNING_THRESHOLDS.totalItems ||
      this.stats.gridItems > this.WARNING_THRESHOLDS.gridItems ||
      totalPoolSize > this.WARNING_THRESHOLDS.poolSize ||
      timeSinceCleanup > this.WARNING_THRESHOLDS.timeSinceCleanup;

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
- 警告状态: ${stats.memoryWarning ? '是' : '否'}
- 上次清理: ${Math.round((Date.now() - stats.lastCleanup) / 1000)}秒前`;
  }

  // 强制垃圾回收（开发模式下可用）
  forceCleanup(): void {
    if (typeof (window as any).gc === 'function') {
      (window as any).gc();
      console.log('手动垃圾回收已触发');
    } else if (process.env.NODE_ENV === 'development') {
      console.warn('手动垃圾回收不可用。使用 --js-flags="--expose-gc" 启动Chrome以启用此功能。');
    }
    this.markCleanup();
  }
}

// 导出单例实例
export const memoryMonitor = MemoryMonitor.getInstance();