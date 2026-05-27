# Node 生命周期 & ManagedImage 设计

**日期**: 2026-05-20  
**分支**: feat/new-api  
**状态**: 已批准，待实现

---

## 1. 问题

### 缩放闪烁

缩放画布时图片短暂变白再出现。根因：

1. `raster.source = url` 触发 Paper.js 内部 `new Image()` + 网络加载，加载期间 raster 为空白
2. React re-render 期间 `setRasterSourceSafely()` 被反复调用（即使 URL 未变），每次都重置 raster 进入加载态
3. 缩放过程中无加载暂停机制，新图片请求与视口动画竞争

### 缺乏节点抽象

所有节点（图片/文字/路径）的 Paper.js 对象散落在各 Hook 中，无统一的创建/销毁/生命周期管理，导致：

- 内存泄露风险（Raster/Path 对象未显式回收）
- 选择、拖拽等交互逻辑重复分散在多个 Hook
- 无法统一广播 viewport 状态（缩放/平移信号）

---

## 2. 方案概览

引入三个新模块：

```
NodeManager (单例)
│
├── 持有所有节点 Map<id, BaseNode>
├── 广播 viewportMoving 信号
│
├── ImageNode extends BaseNode
│   └── 向 ImageResourceManager 申请/释放 HTMLImageElement
│
├── TextNode extends BaseNode
│   └── 包装 paper.PointText
│
└── PathNode extends BaseNode
    └── 包装 paper.Path / paper.CompoundPath

ImageResourceManager (单例)
│
├── HTMLImageElement 缓存（LRU, 128MB 预算）
├── 优先级队列: critical > visible > prefetch
└── isViewportMoving → 暂停非 critical 加载
```

**文件结构**（全部新增，不修改现有 Hook 接口）：

```
frontend/src/canvas/
├── nodes/
│   ├── BaseNode.ts
│   ├── ImageNode.ts
│   ├── TextNode.ts
│   └── PathNode.ts
├── NodeManager.ts
└── ImageResourceManager.ts
```

现有 Hook 的改动仅在**内部实现**：接口/返回值不变，只替换 Paper.js 对象的创建/销毁方式。

---

## 3. 模块详细设计

### 3.1 BaseNode

```typescript
// frontend/src/canvas/nodes/BaseNode.ts

export type NodeType = 'image' | 'text' | 'path'

export abstract class BaseNode {
  readonly id: string
  readonly type: NodeType
  protected layer: paper.Layer

  constructor(id: string, type: NodeType, layer: paper.Layer)

  /** 挂载到 Paper.js 图层，开始资源申请 */
  abstract mount(params: unknown): void

  /** 销毁 Paper.js 对象，释放所有资源 */
  abstract destroy(): void

  /** 获取当前边界矩形（项目坐标） */
  abstract getBounds(): paper.Rectangle

  /** 获取底层 Paper.js item（供 Hook 兼容使用） */
  abstract getPaperItem(): paper.Item

  /** 设置选中状态（子类可覆盖以添加视觉反馈） */
  setSelected(v: boolean): void

  /** 缩放变化时调用（子类可覆盖，如更新描边宽度） */
  onZoomChange(zoom: number): void
}
```

### 3.2 ImageResourceManager

```typescript
// frontend/src/canvas/ImageResourceManager.ts

type LoadPriority = 'critical' | 'visible' | 'prefetch'

interface CachedEntry {
  htmlImage: HTMLImageElement
  url: string
  owners: Set<string>        // ownerIds
  sizeBytes: number
  lastAccessAt: number
}

class ImageResourceManager {
  private static instance: ImageResourceManager
  private cache = new Map<string, CachedEntry>()     // url → entry
  private pending = new Map<string, Promise<HTMLImageElement>>() // url → inflight
  private deferredQueue: Array<DeferredLoad> = []
  private isViewportMoving = false
  private totalBytes = 0
  private readonly MAX_BYTES = 128 * 1024 * 1024     // 128 MB

  static getInstance(): ImageResourceManager

  /**
   * 申请图片资源。
   * - 若已缓存：立即返回 HTMLImageElement
   * - 若 isViewportMoving 且 priority !== 'critical'：入队等待
   * - 否则：开始加载
   */
  async acquire(url: string, priority: LoadPriority, ownerId: string): Promise<HTMLImageElement>

  /** 释放某 owner 对 url 的引用；refCount=0 时从 LRU 候选中移除 */
  release(url: string, ownerId: string): void

  /** 缩放/平移开始时调用；仅 critical 优先级继续加载 */
  setViewportMoving(v: boolean): void

  private load(url: string): Promise<HTMLImageElement>
  private evictLRU(): void       // 超出预算时按 lastAccessAt 淘汰
  private flushDeferred(): void  // viewport 停止后处理等待队列
}
```

**闪烁修复核心**：
- 所有 `HTMLImageElement` 在 `ImageResourceManager` 内完全加载（`onload` 触发）后才返回给 ImageNode
- ImageNode 拿到后调用 `raster.setImage(htmlImage)`（瞬时，无白帧）
- 同一 URL 永远只加载一次，React re-render 复用缓存，不重置 raster

### 3.3 ImageNode

```typescript
// frontend/src/canvas/nodes/ImageNode.ts

export interface ImageNodeParams {
  url: string
  bounds: paper.Rectangle     // 初始位置和尺寸
  priority?: LoadPriority
}

export class ImageNode extends BaseNode {
  private raster: paper.Raster
  private currentUrl: string | null = null
  private manager = ImageResourceManager.getInstance()

  mount(params: ImageNodeParams): void
  // 1. 创建 paper.Raster，设置 bounds，挂到 layer
  // 2. 调用 manager.acquire(url, priority, this.id)
  // 3. 在 .then() 中调用 raster.setImage(htmlImage)

  /** 仅在 URL 实际变化时才重新加载，否则 no-op */
  update(url: string, priority?: LoadPriority): void

  destroy(): void
  // 1. raster.remove()
  // 2. manager.release(currentUrl, this.id)

  getBounds(): paper.Rectangle
  getPaperItem(): paper.Raster
}
```

### 3.4 TextNode

```typescript
// frontend/src/canvas/nodes/TextNode.ts

export interface TextNodeParams {
  text: string
  position: paper.Point
  fontSize: number
  fontFamily: string
  fillColor: paper.Color
  justification?: 'left' | 'center' | 'right'
}

export class TextNode extends BaseNode {
  private pointText: paper.PointText

  mount(params: TextNodeParams): void
  update(params: Partial<TextNodeParams>): void
  destroy(): void
  getBounds(): paper.Rectangle
  getPaperItem(): paper.PointText
}
```

### 3.5 PathNode

```typescript
// frontend/src/canvas/nodes/PathNode.ts

export interface PathNodeParams {
  segments?: paper.Segment[]
  strokeColor?: paper.Color
  fillColor?: paper.Color
  strokeWidth?: number
  dashArray?: number[]
  closed?: boolean
}

export class PathNode extends BaseNode {
  private path: paper.Path

  mount(params: PathNodeParams): void
  update(params: Partial<PathNodeParams>): void
  destroy(): void
  getBounds(): paper.Rectangle
  getPaperItem(): paper.Path

  /** 追加线段（绘制过程中调用） */
  addSegment(point: paper.Point): void

  /** 结束绘制，执行平滑 */
  finalize(smooth?: boolean): void
}
```

### 3.6 NodeManager

```typescript
// frontend/src/canvas/NodeManager.ts

class NodeManager {
  private static instance: NodeManager
  private nodes = new Map<string, BaseNode>()

  static getInstance(): NodeManager

  createImage(id: string, layer: paper.Layer, params: ImageNodeParams): ImageNode
  createText(id: string, layer: paper.Layer, params: TextNodeParams): TextNode
  createPath(id: string, layer: paper.Layer, params: PathNodeParams): PathNode

  get<T extends BaseNode = BaseNode>(id: string): T | undefined
  has(id: string): boolean

  destroy(id: string): void
  destroyAll(): void
  /** 销毁指定图层内所有节点（图层删除时调用） */
  destroyByLayerId(layerId: string): void

  /**
   * 缩放/平移状态变化时调用
   * → 广播到 ImageResourceManager
   */
  setViewportMoving(v: boolean): void

  /** 当前节点总数（用于调试） */
  get size(): number
}
```

---

## 4. 现有 Hook 集成改动

### useImageTool.ts

| 原来 | 改为 |
|------|------|
| `new paper.Raster()` | `NodeManager.createImage(id, layer, params)` |
| `setRasterSourceSafely(raster, url)` | `imageNode.update(url)` |
| `raster.remove()` | `NodeManager.destroy(id)` |
| 直接操作 `raster.bounds` | 通过 `imageNode.getPaperItem().bounds` |

其余逻辑（上传、拖拽、缩放手柄）保持不变。

### useDrawingTools.ts

| 原来 | 改为 |
|------|------|
| `new paper.Path()` | `NodeManager.createPath(id, layer, params)` |
| `path.add(point)` | `pathNode.addSegment(point)` |
| `path.smooth()` | `pathNode.finalize(true)` |
| `new paper.PointText()` | `NodeManager.createText(id, layer, params)` |

### useSelectionTool.ts / useInteractionController.ts

- 通过 `NodeManager.get(id)?.getPaperItem()` 获取 Paper.js 对象进行操作
- 选中时调用 `NodeManager.get(id)?.setSelected(true)` 并将该节点 priority 提升为 `'critical'`（通过 `imageNode.update()` 触发）

### InteractionController.tsx / GlobalZoomCapture.tsx

```typescript
// 缩放开始
onZoomStart={() => NodeManager.getInstance().setViewportMoving(true)}
// 缩放结束（松手/惯性结束后）
onZoomEnd={() => NodeManager.getInstance().setViewportMoving(false)}
```

### DrawingController.tsx

- 在 `useEffect` 初始化段获取 `NodeManager.getInstance()`
- 图层删除时调用 `NodeManager.destroyByLayerId(layerId)`

---

## 5. 内存管理

| 机制 | 说明 |
|------|------|
| LRU 淘汰 | `totalBytes > 128MB` 时按 `lastAccessAt` 从旧到新释放，已有 owner 的资源不释放 |
| 引用计数 | 同一 URL 被多个节点共用，`owners.size === 0` 才进入 LRU 候选 |
| viewport 暂停 | `isViewportMoving=true` 时，`priority !== 'critical'` 的加载入 `deferredQueue`，viewport 停止后批量触发 |
| 节点销毁 | `NodeManager.destroy(id)` → `ImageNode.destroy()` → `manager.release(url, id)` |

---

## 6. 数据流（缩放场景）

```
用户滚轮
  → InteractionController 计算新 zoom
  → NodeManager.setViewportMoving(true)
    → ImageResourceManager.setViewportMoving(true)
  → canvasStore.setViewport(zoom, panX, panY)
  → PaperCanvasManager 应用 paper.Matrix（图片不闪，raster 已有 htmlImage）
  
用户停止滚动（debounce 150ms）
  → NodeManager.setViewportMoving(false)
    → ImageResourceManager.setViewportMoving(false)
    → flushDeferred() 恢复队列中的加载任务
```

---

## 7. 实现顺序（适合并行）

**Wave 1（无依赖，可完全并行）：**
- `BaseNode.ts`
- `ImageResourceManager.ts`

**Wave 2（依赖 Wave 1，可并行）：**
- `ImageNode.ts`（依赖 BaseNode + ImageResourceManager）
- `TextNode.ts`（依赖 BaseNode）
- `PathNode.ts`（依赖 BaseNode）
- `NodeManager.ts`（依赖 BaseNode 接口）

**Wave 3（依赖 Wave 2，可并行）：**
- 集成 `useImageTool.ts`
- 集成 `useDrawingTools.ts`
- 集成 `useSelectionTool.ts` + `useInteractionController.ts`
- 集成 viewport 信号到 `InteractionController.tsx` / `GlobalZoomCapture.tsx`

**Wave 4：**
- 集成 `DrawingController.tsx`（图层销毁 → destroyByLayerId）
- 端到端测试缩放闪烁
