# 浏览器崩溃性能优化方案

## 问题诊断总结

### 核心问题
在处理**节点很多的大型工程文件**时，浏览器会出现崩溃，主要原因是：

1. **内存泄漏** - Paper.js 对象未正确释放
2. **过度渲染** - 网格虚拟化范围过大
3. **对象池管理不当** - 对象池无限增长
4. **频繁序列化** - 自动保存导致内存峰值
5. **事件监听器堆积** - React 组件清理不完整

---

## 优化方案详解

### 方案 1: 改进对象池管理（优先级：🔴 高）

**问题**：
```typescript
// GridRenderer.tsx 第96行
if (child.data?.type === 'grid' && pathPoolRef.current.length < 50) {
  pathPoolRef.current.push(child as paper.Path);
}
```
- 对象池限制为 50 个，但实际可能需要数千个
- 没有定期清理机制
- 对象池中的对象可能被损坏或无效

**解决方案**：
```typescript
// 改进的对象池管理
class PathObjectPool {
  private pool: paper.Path[] = [];
  private readonly MAX_POOL_SIZE = 500;  // 增加到500
  private readonly CLEANUP_INTERVAL = 30000;  // 30秒清理一次
  private lastCleanupTime = Date.now();

  acquire(): paper.Path {
    if (this.pool.length > 0) {
      const path = this.pool.pop()!;
      // 验证对象有效性
      if (path.project && !path.removed) {
        return path;
      }
    }
    // 创建新对象
    return new paper.Path();
  }

  release(path: paper.Path): void {
    // 只保存有效的对象
    if (path.project && !path.removed && this.pool.length < this.MAX_POOL_SIZE) {
      path.visible = false;
      path.removeSegments();  // 清空线段
      this.pool.push(path);
    } else {
      path.remove();  // 直接删除无效对象
    }
  }

  cleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanupTime < this.CLEANUP_INTERVAL) {
      return;
    }

    // 移除无效对象
    this.pool = this.pool.filter(path => {
      if (!path.project || path.removed) {
        path.remove();
        return false;
      }
      return true;
    });

    // 如果池太大，删除一半
    if (this.pool.length > this.MAX_POOL_SIZE * 1.5) {
      const toRemove = this.pool.splice(0, Math.floor(this.pool.length / 2));
      toRemove.forEach(path => path.remove());
    }

    this.lastCleanupTime = now;
  }

  clear(): void {
    this.pool.forEach(path => path.remove());
    this.pool = [];
  }
}
```

---

### 方案 2: 限制网格虚拟化范围（优先级：🔴 高）

**问题**：
```typescript
// GridRenderer.tsx 第164-165行
const maxRenderWidth = viewWidth * 6;   // 缩放10%时，实际渲染11520px
const maxRenderHeight = viewHeight * 6;
```

**解决方案**：
```typescript
// 根据缩放级别动态调整渲染范围
const calculateRenderMultiplier = (zoom: number): number => {
  // 缩放级别 -> 渲染倍数
  if (zoom >= 0.5) return 2;      // 50%+ 只渲染2倍
  if (zoom >= 0.3) return 3;      // 30-50% 渲染3倍
  if (zoom >= 0.15) return 4;     // 15-30% 渲染4倍
  return 5;                        // <15% 最多渲染5倍（不是6倍）
};

const renderMultiplier = calculateRenderMultiplier(zoom);
const maxRenderWidth = viewWidth * renderMultiplier;
const maxRenderHeight = viewHeight * renderMultiplier;

// 额外限制：绝对像素上限
const MAX_RENDER_PIXELS = 2000 * 2000;  // 400万像素
const actualRenderWidth = Math.min(maxRenderWidth, Math.sqrt(MAX_RENDER_PIXELS));
const actualRenderHeight = Math.min(maxRenderHeight, Math.sqrt(MAX_RENDER_PIXELS));
```

---

### 方案 3: 改进自动保存策略（优先级：🟡 中）

**问题**：
```typescript
// paperSaveService.ts 第10-11行
private readonly SAVE_DELAY = 150;        // 太短
private readonly MIN_SAVE_INTERVAL = 800; // 仍然太频繁
```

**解决方案**：
```typescript
class PaperSaveService {
  private saveTimeoutId: number | null = null;
  private readonly SAVE_DELAY = 500;           // 增加到500ms
  private readonly MIN_SAVE_INTERVAL = 2000;   // 增加到2秒
  private lastSaveTimestamp = 0;
  private pendingChanges = false;

  // 智能保存：只在必要时保存
  scheduleSave(reason: string, forceImmediate = false): void {
    this.pendingChanges = true;

    if (forceImmediate) {
      this.performSave(reason);
      return;
    }

    // 清除之前的定时器
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId);
    }

    // 检查是否可以立即保存
    const timeSinceLastSave = Date.now() - this.lastSaveTimestamp;
    if (timeSinceLastSave >= this.MIN_SAVE_INTERVAL) {
      this.performSave(reason);
    } else {
      // 延迟保存
      const delay = Math.max(
        this.SAVE_DELAY,
        this.MIN_SAVE_INTERVAL - timeSinceLastSave
      );
      this.saveTimeoutId = window.setTimeout(() => {
        if (this.pendingChanges) {
          this.performSave(reason);
        }
      }, delay);
    }
  }

  private performSave(reason: string): void {
    const now = Date.now();
    const timeSinceLastSave = now - this.lastSaveTimestamp;

    // 防止过于频繁的保存
    if (timeSinceLastSave < this.MIN_SAVE_INTERVAL) {
      console.log(`[Save] 跳过保存 (${timeSinceLastSave}ms < ${this.MIN_SAVE_INTERVAL}ms)`);
      return;
    }

    console.log(`[Save] 执行保存: ${reason}`);
    this.lastSaveTimestamp = now;
    this.pendingChanges = false;

    // 异步执行保存，避免阻塞主线程
    requestIdleCallback(() => {
      this.doActualSave();
    }, { timeout: 5000 });
  }

  private doActualSave(): void {
    // 实际保存逻辑
    // ...
  }
}
```

---

### 方案 4: 改进内存监控和自动清理（优先级：🟡 中）

**问题**：
- 内存监控只是警告，没有自动清理机制
- 对象池无限增长

**解决方案**：
```typescript
// memoryMonitor.ts 增强版
export class MemoryMonitor {
  private cleanupCallbacks: (() => void)[] = [];
  private readonly AGGRESSIVE_CLEANUP_THRESHOLD = 0.75;  // 75% 时触发
  private readonly CRITICAL_CLEANUP_THRESHOLD = 0.90;    // 90% 时强制清理

  // 注册清理回调
  onMemoryPressure(callback: () => void): void {
    this.cleanupCallbacks.push(callback);
  }

  // 检查并执行清理
  checkAndCleanup(): void {
    this.updateBrowserMemoryStats();
    const heapUsageRatio = this.stats.browserMemory.usedJSHeapSize /
                          this.stats.browserMemory.jsHeapSizeLimit;

    if (heapUsageRatio > this.CRITICAL_CLEANUP_THRESHOLD) {
      console.warn('[MemoryMonitor] 触发强制清理 (堆内存 > 90%)');
      this.executeCleanup(true);  // 强制清理
    } else if (heapUsageRatio > this.AGGRESSIVE_CLEANUP_THRESHOLD) {
      console.warn('[MemoryMonitor] 触发主动清理 (堆内存 > 75%)');
      this.executeCleanup(false);  // 主动清理
    }
  }

  private executeCleanup(isForced: boolean): void {
    // 执行所有注册的清理回调
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('[MemoryMonitor] 清理回调执行失败:', error);
      }
    });

    if (isForced && typeof (window as any).gc === 'function') {
      (window as any).gc();
    }

    this.markCleanup();
  }
}
```

---

### 方案 5: 改进图像缓存管理（优先级：🟡 中）

**问题**：
- 图像历史记录无限增长
- 每张图像可能是几MB

**解决方案**：
```typescript
// imageHistoryStore.ts 改进版
interface ImageHistoryState {
  history: ImageData[];
  maxHistorySize: number;  // 最多保留多少张
  maxMemoryUsage: number;  // 最多占用多少内存
}

export const useImageHistoryStore = create<ImageHistoryState>((set, get) => ({
  history: [],
  maxHistorySize: 20,      // 最多保留20张
  maxMemoryUsage: 100 * 1024 * 1024,  // 最多100MB

  addToHistory: (image: ImageData) => {
    set((state) => {
      const newHistory = [image, ...state.history];

      // 限制历史记录数量
      if (newHistory.length > state.maxHistorySize) {
        newHistory.pop();
      }

      // 限制内存使用
      let totalSize = 0;
      const trimmedHistory = [];
      for (const img of newHistory) {
        const size = this.estimateImageSize(img);
        if (totalSize + size <= state.maxMemoryUsage) {
          trimmedHistory.push(img);
          totalSize += size;
        } else {
          break;
        }
      }

      return { history: trimmedHistory };
    });
  },

  clearOldHistory: () => {
    set((state) => ({
      history: state.history.slice(0, Math.floor(state.maxHistorySize / 2))
    }));
  },

  estimateImageSize: (image: ImageData): number => {
    // 估算图像大小（字节）
    if (typeof image === 'string') {
      return image.length;
    }
    if (image instanceof Blob) {
      return image.size;
    }
    return 0;
  }
}));
```

---

### 方案 6: 改进 React 组件清理（优先级：🟡 中）

**问题**：
- Flow 节点可能有未清理的事件监听器
- useEffect 依赖数组不完整

**解决方案**：
```typescript
// Flow 节点通用模板
export const GenerateNodeInner = React.memo(({ data, id }: NodeProps) => {
  const [state, setState] = useState({...});
  const eventListenersRef = useRef<Array<() => void>>([]);

  // 统一的事件监听管理
  const addEventListener = useCallback((
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions
  ) => {
    target.addEventListener(event, handler, options);

    // 记录清理函数
    eventListenersRef.current.push(() => {
      target.removeEventListener(event, handler, options);
    });
  }, []);

  // 清理所有事件监听器
  useEffect(() => {
    return () => {
      eventListenersRef.current.forEach(cleanup => cleanup());
      eventListenersRef.current = [];
    };
  }, []);

  // 其他 useEffect 都要有完整的依赖数组
  useEffect(() => {
    // 初始化逻辑
    const handleSomething = () => { /* ... */ };
    addEventListener(window, 'resize', handleSomething);

    return () => {
      // 清理逻辑会自动执行
    };
  }, [addEventListener]);  // 完整的依赖数组

  return (/* JSX */);
});

export default GenerateNodeInner;
```

---

## 实施优先级和时间表

| 优先级 | 方案 | 预期效果 | 实施难度 |
|--------|------|---------|---------|
| 🔴 高 | 改进对象池管理 | 减少内存泄漏 50% | 中 |
| 🔴 高 | 限制网格虚拟化范围 | 减少渲染对象 60% | 低 |
| 🟡 中 | 改进自动保存策略 | 减少内存峰值 30% | 低 |
| 🟡 中 | 改进内存监控 | 主动预防崩溃 | 中 |
| 🟡 中 | 改进图像缓存 | 减少长期内存占用 | 低 |
| 🟡 中 | 改进 React 清理 | 减少事件监听器泄漏 | 中 |

---

## 测试方案

### 1. 内存监控测试
```bash
# 启用 Chrome 垃圾回收暴露
google-chrome --js-flags="--expose-gc"

# 在控制台监控
setInterval(() => {
  if (window.gc) window.gc();
  const stats = memoryMonitor.getStats();
  console.log(stats.getMemorySummary());
}, 5000);
```

### 2. 压力测试
- 创建包含 1000+ 节点的工程文件
- 缩放到 10% 并拖拽
- 监控内存使用情况
- 验证是否出现崩溃

### 3. 性能基准
- 优化前：内存增长到 1.5GB+ 导致崩溃
- 优化后目标：内存稳定在 500MB 以下

---

## 快速检查清单

- [ ] 对象池管理改进
- [ ] 网格虚拟化范围限制
- [ ] 自动保存策略优化
- [ ] 内存监控自动清理
- [ ] 图像缓存限制
- [ ] React 组件清理完善
- [ ] 压力测试验证
- [ ] 性能基准测试
- [ ] 文档更新
- [ ] 代码审查

