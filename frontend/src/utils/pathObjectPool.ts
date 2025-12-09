import paper from 'paper';

/**
 * 改进的 Paper.js Path 对象池
 * 解决网格渲染时对象无限增长的问题
 */
export class PathObjectPool {
  private pool: paper.Path[] = [];
  private readonly MAX_POOL_SIZE = 500;
  private readonly CLEANUP_INTERVAL = 30000; // 30秒
  private lastCleanupTime = Date.now();
  private stats = {
    acquired: 0,
    released: 0,
    cleaned: 0,
  };

  /**
   * 从对象池获取一个 Path 对象
   * 优先复用池中的对象，否则创建新对象
   */
  acquire(): paper.Path {
    // 定期清理无效对象
    this.periodicCleanup();

    if (this.pool.length > 0) {
      const path = this.pool.pop()!;

      // 验证对象有效性
      if (this.isPathValid(path)) {
        this.stats.acquired++;
        return path;
      } else {
        // 无效对象直接删除
        try {
          path.remove();
        } catch {
          // 忽略删除失败
        }
      }
    }

    // 创建新对象
    this.stats.acquired++;
    return new paper.Path();
  }

  /**
   * 将 Path 对象归还到对象池
   */
  release(path: paper.Path): void {
    if (!this.isPathValid(path)) {
      // 无效对象直接删除
      try {
        path.remove();
      } catch {
        // 忽略删除失败
      }
      return;
    }

    // 清空路径数据
    try {
      path.visible = false;
      path.removeSegments();
      path.strokeColor = null;
      path.fillColor = null;
      path.data = {};
    } catch {
      // 清理失败，删除对象
      try {
        path.remove();
      } catch {
        // 忽略
      }
      return;
    }

    // 只在池未满时添加
    if (this.pool.length < this.MAX_POOL_SIZE) {
      this.pool.push(path);
      this.stats.released++;
    } else {
      // 池满了，直接删除
      try {
        path.remove();
      } catch {
        // 忽略
      }
    }
  }

  /**
   * 检查 Path 对象是否有效
   */
  private isPathValid(path: paper.Path): boolean {
    try {
      // 检查对象是否被删除
      if ((path as any).removed) {
        return false;
      }

      // 检查对象是否属于有效的项目
      if (!path.project) {
        return false;
      }

      // 检查对象是否有父级
      if (!path.parent) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 定期清理无效对象
   */
  private periodicCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanupTime < this.CLEANUP_INTERVAL) {
      return;
    }

    this.cleanup();
    this.lastCleanupTime = now;
  }

  /**
   * 清理对象池中的无效对象
   */
  cleanup(): void {
    const validPaths: paper.Path[] = [];
    let removedCount = 0;

    for (const path of this.pool) {
      if (this.isPathValid(path)) {
        validPaths.push(path);
      } else {
        try {
          path.remove();
        } catch {
          // 忽略
        }
        removedCount++;
      }
    }

    this.pool = validPaths;

    // 如果池太大，删除一半
    if (this.pool.length > this.MAX_POOL_SIZE * 1.5) {
      const toRemove = this.pool.splice(0, Math.floor(this.pool.length / 2));
      toRemove.forEach(path => {
        try {
          path.remove();
        } catch {
          // 忽略
        }
      });
      removedCount += toRemove.length;
    }

    this.stats.cleaned += removedCount;

    if (removedCount > 0) {
      console.log(`[PathObjectPool] 清理了 ${removedCount} 个无效对象`);
    }
  }

  /**
   * 清空对象池
   */
  clear(): void {
    for (const path of this.pool) {
      try {
        path.remove();
      } catch {
        // 忽略
      }
    }
    this.pool = [];
    console.log('[PathObjectPool] 对象池已清空');
  }

  /**
   * 获取对象池统计信息
   */
  getStats() {
    return {
      poolSize: this.pool.length,
      maxPoolSize: this.MAX_POOL_SIZE,
      acquired: this.stats.acquired,
      released: this.stats.released,
      cleaned: this.stats.cleaned,
    };
  }

  /**
   * 获取对象池摘要
   */
  getSummary(): string {
    const stats = this.getStats();
    return `PathObjectPool: 池大小=${stats.poolSize}/${stats.maxPoolSize}, 获取=${stats.acquired}, 释放=${stats.released}, 清理=${stats.cleaned}`;
  }
}

// 导出单例
export const pathObjectPool = new PathObjectPool();
