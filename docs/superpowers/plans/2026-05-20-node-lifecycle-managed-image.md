# Node 生命周期 & ManagedImage 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 BaseNode 类体系 + ImageResourceManager 解决画布缩放闪烁问题，并为所有节点类型提供统一的生命周期管理。

**Architecture:** 引入 `ImageResourceManager`（单例）预加载 HTMLImageElement 并缓存，`ImageNode` 调用 `raster.setImage(htmlImage)`（瞬时赋值，无白帧）替代 `raster.source = url`。`NodeManager`（单例）持有所有 `BaseNode`，在缩放时向 `ImageResourceManager` 广播 `setViewportMoving` 信号，暂停非 critical 加载任务。

**Tech Stack:** TypeScript, Paper.js, React Hooks (Zustand 不变), Vite

---

## 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| Create | `frontend/src/canvas/nodes/BaseNode.ts` | 抽象基类 |
| Create | `frontend/src/canvas/ImageResourceManager.ts` | HTMLImage 缓存 + 优先级队列 |
| Create | `frontend/src/canvas/nodes/ImageNode.ts` | 图片节点，依赖 BaseNode + Manager |
| Create | `frontend/src/canvas/nodes/TextNode.ts` | 文字节点 |
| Create | `frontend/src/canvas/nodes/PathNode.ts` | 路径节点 |
| Create | `frontend/src/canvas/NodeManager.ts` | 统一注册表 + viewport 信号 |
| Modify | `frontend/src/components/canvas/InteractionController.tsx` | 滚轮缩放时发送 viewport 信号 |
| Modify | `frontend/src/components/canvas/GlobalZoomCapture.tsx` | 捏合缩放时发送 viewport 信号 |
| Modify | `frontend/src/components/canvas/hooks/useImageTool.ts` | 用 NodeManager.createImage 替换 new paper.Raster |
| Modify | `frontend/src/components/canvas/hooks/useDrawingTools.ts` | 用 NodeManager.createPath 替换 new paper.Path |
| Modify | `frontend/src/components/canvas/hooks/useSimpleTextTool.ts` | 用 NodeManager.createText 替换 new paper.PointText |

---

## Wave 1 — 无依赖基础模块（可并行）

### Task 1: BaseNode 抽象基类

**Files:**
- Create: `frontend/src/canvas/nodes/BaseNode.ts`

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/canvas/nodes/BaseNode.ts
import paper from 'paper'

export type NodeType = 'image' | 'text' | 'path'

export abstract class BaseNode {
  readonly id: string
  readonly type: NodeType
  readonly layer: paper.Layer

  constructor(id: string, type: NodeType, layer: paper.Layer) {
    this.id = id
    this.type = type
    this.layer = layer
  }

  abstract mount(params: unknown): void
  abstract destroy(): void
  abstract getBounds(): paper.Rectangle
  abstract getPaperItem(): paper.Item | null

  setSelected(v: boolean): void {
    const item = this.getPaperItem()
    if (item) item.selected = v
  }

  onZoomChange(_zoom: number): void {
    // subclasses override when needed
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "canvas/nodes/BaseNode" || echo "✅ BaseNode OK"
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/canvas/nodes/BaseNode.ts
git commit -m "feat(canvas): add BaseNode abstract class"
```

---

### Task 2: ImageResourceManager

**Files:**
- Create: `frontend/src/canvas/ImageResourceManager.ts`

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/canvas/ImageResourceManager.ts

export type LoadPriority = 'critical' | 'visible' | 'prefetch'

interface CachedEntry {
  htmlImage: HTMLImageElement
  url: string
  owners: Set<string>
  sizeBytes: number
  lastAccessAt: number
}

interface DeferredLoad {
  url: string
  ownerId: string
  resolve: (img: HTMLImageElement) => void
  reject: (err: Error) => void
}

class ImageResourceManager {
  private static _instance: ImageResourceManager | null = null

  private cache = new Map<string, CachedEntry>()
  private pending = new Map<string, Promise<HTMLImageElement>>()
  private deferred: DeferredLoad[] = []
  private isViewportMoving = false
  private totalBytes = 0
  private readonly MAX_BYTES = 128 * 1024 * 1024 // 128 MB

  private constructor() {}

  static getInstance(): ImageResourceManager {
    if (!ImageResourceManager._instance) {
      ImageResourceManager._instance = new ImageResourceManager()
    }
    return ImageResourceManager._instance
  }

  /** 申请图片资源。已缓存则立即返回；viewport 移动中且非 critical 则延迟。 */
  async acquire(
    url: string,
    priority: LoadPriority,
    ownerId: string
  ): Promise<HTMLImageElement> {
    const cached = this.cache.get(url)
    if (cached) {
      cached.owners.add(ownerId)
      cached.lastAccessAt = Date.now()
      return cached.htmlImage
    }

    if (this.isViewportMoving && priority !== 'critical') {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        this.deferred.push({ url, ownerId, resolve, reject })
      })
    }

    return this.load(url, ownerId)
  }

  /** 释放某 owner 对 url 的引用；owners 归零后进入 LRU 候选。 */
  release(url: string, ownerId: string): void {
    const entry = this.cache.get(url)
    if (entry) entry.owners.delete(ownerId)
  }

  /** 缩放/平移开始时调用 true，结束时调用 false。 */
  setViewportMoving(v: boolean): void {
    this.isViewportMoving = v
    if (!v) this.flushDeferred()
  }

  private async load(url: string, ownerId: string): Promise<HTMLImageElement> {
    const inflight = this.pending.get(url)
    if (inflight) {
      const img = await inflight
      const entry = this.cache.get(url)
      if (entry) entry.owners.add(ownerId)
      return img
    }

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const sizeBytes = img.naturalWidth * img.naturalHeight * 4
        const entry: CachedEntry = {
          htmlImage: img,
          url,
          owners: new Set([ownerId]),
          sizeBytes,
          lastAccessAt: Date.now(),
        }
        this.cache.set(url, entry)
        this.totalBytes += sizeBytes
        this.pending.delete(url)
        this.evictLRU()
        resolve(img)
      }
      img.onerror = () => {
        this.pending.delete(url)
        reject(new Error(`ImageResourceManager: failed to load ${url}`))
      }
      img.src = url
    })

    this.pending.set(url, promise)
    return promise
  }

  private flushDeferred(): void {
    const queue = this.deferred.splice(0)
    for (const item of queue) {
      this.load(item.url, item.ownerId).then(item.resolve).catch(item.reject)
    }
  }

  private evictLRU(): void {
    if (this.totalBytes <= this.MAX_BYTES) return
    const candidates = Array.from(this.cache.values())
      .filter((e) => e.owners.size === 0)
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt)
    for (const entry of candidates) {
      if (this.totalBytes <= this.MAX_BYTES) break
      this.totalBytes -= entry.sizeBytes
      this.cache.delete(entry.url)
    }
  }
}

export { ImageResourceManager }
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "ImageResourceManager" || echo "✅ ImageResourceManager OK"
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/canvas/ImageResourceManager.ts
git commit -m "feat(canvas): add ImageResourceManager with LRU cache and viewport pause"
```

---

## Wave 2 — 具体节点类 + NodeManager（依赖 Wave 1，可并行）

### Task 3: ImageNode

**Files:**
- Create: `frontend/src/canvas/nodes/ImageNode.ts`

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/canvas/nodes/ImageNode.ts
import paper from 'paper'
import { BaseNode } from './BaseNode'
import { ImageResourceManager, LoadPriority } from '../ImageResourceManager'

export interface ImageNodeMountParams {
  url: string
  bounds: paper.Rectangle
  priority?: LoadPriority
  onReady?: (raster: paper.Raster) => void
}

export class ImageNode extends BaseNode {
  private raster: paper.Raster | null = null
  private currentUrl: string | null = null

  constructor(id: string, layer: paper.Layer) {
    super(id, 'image', layer)
  }

  mount(params: ImageNodeMountParams): void {
    const { url, bounds, priority = 'visible', onReady } = params

    this.layer.activate()
    this.raster = new paper.Raster()
    ;(this.raster as any).crossOrigin = 'anonymous'
    this.raster.bounds = bounds.clone()
    this.currentUrl = url

    ImageResourceManager.getInstance()
      .acquire(url, priority, this.id)
      .then((htmlImage) => {
        if (!this.raster) return
        ;(this.raster as any).setImage(htmlImage)
        onReady?.(this.raster)
      })
      .catch(() => {
        // fallback: 让 Paper.js 自行加载（会有短暂白帧，但不丢图）
        if (!this.raster) return
        this.raster.source = url
        onReady?.(this.raster)
      })
  }

  /**
   * 仅在 URL 实际变化时重新加载，相同 URL 直接 no-op。
   * 这是消除 React re-render 导致重复加载的核心保证。
   */
  update(url: string, priority: LoadPriority = 'visible'): void {
    if (url === this.currentUrl) return

    const oldUrl = this.currentUrl
    this.currentUrl = url

    if (oldUrl) {
      ImageResourceManager.getInstance().release(oldUrl, this.id)
    }

    ImageResourceManager.getInstance()
      .acquire(url, priority, this.id)
      .then((htmlImage) => {
        if (!this.raster) return
        ;(this.raster as any).setImage(htmlImage)
      })
      .catch(() => {
        if (!this.raster) return
        this.raster.source = url
      })
  }

  destroy(): void {
    if (this.currentUrl) {
      ImageResourceManager.getInstance().release(this.currentUrl, this.id)
    }
    this.raster?.remove()
    this.raster = null
    this.currentUrl = null
  }

  getBounds(): paper.Rectangle {
    return this.raster?.bounds ?? new paper.Rectangle(0, 0, 0, 0)
  }

  getPaperItem(): paper.Raster | null {
    return this.raster
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "canvas/nodes/ImageNode" || echo "✅ ImageNode OK"
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/canvas/nodes/ImageNode.ts
git commit -m "feat(canvas): add ImageNode with pre-decoded HTMLImageElement loading"
```

---

### Task 4: TextNode

**Files:**
- Create: `frontend/src/canvas/nodes/TextNode.ts`

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/canvas/nodes/TextNode.ts
import paper from 'paper'
import { BaseNode } from './BaseNode'

export interface TextNodeMountParams {
  text: string
  position: paper.Point
  fontSize: number
  fontFamily: string
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  fillColor: string | paper.Color
  justification?: 'left' | 'center' | 'right'
  data?: Record<string, unknown>
}

export class TextNode extends BaseNode {
  private pointText: paper.PointText | null = null

  constructor(id: string, layer: paper.Layer) {
    super(id, 'text', layer)
  }

  mount(params: TextNodeMountParams): void {
    this.layer.activate()
    this.pointText = new paper.PointText({
      point: [params.position.x, params.position.y],
      content: params.text,
      fillColor: params.fillColor,
      fontSize: params.fontSize,
      fontFamily: params.fontFamily,
      fontWeight: params.fontWeight ?? 'normal',
      fontStyle: params.fontStyle ?? 'normal',
      justification: params.justification ?? 'left',
      visible: true,
    })
    this.pointText.strokeColor = null
    this.pointText.selected = false
    if (params.data) this.pointText.data = { ...params.data }
  }

  update(params: Partial<TextNodeMountParams>): void {
    if (!this.pointText) return
    if (params.text !== undefined) this.pointText.content = params.text
    if (params.fillColor !== undefined) {
      this.pointText.fillColor = new paper.Color(params.fillColor as string)
    }
    if (params.fontSize !== undefined) this.pointText.fontSize = params.fontSize
    if (params.fontFamily !== undefined) this.pointText.fontFamily = params.fontFamily
    if (params.fontWeight !== undefined) this.pointText.fontWeight = params.fontWeight
    if (params.fontStyle !== undefined) this.pointText.fontStyle = params.fontStyle
    if (params.justification !== undefined) {
      this.pointText.justification = params.justification
    }
    if (params.position !== undefined) this.pointText.position = params.position
  }

  destroy(): void {
    this.pointText?.remove()
    this.pointText = null
  }

  getBounds(): paper.Rectangle {
    return this.pointText?.bounds ?? new paper.Rectangle(0, 0, 0, 0)
  }

  getPaperItem(): paper.PointText | null {
    return this.pointText
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "canvas/nodes/TextNode" || echo "✅ TextNode OK"
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/canvas/nodes/TextNode.ts
git commit -m "feat(canvas): add TextNode wrapping paper.PointText"
```

---

### Task 5: PathNode

**Files:**
- Create: `frontend/src/canvas/nodes/PathNode.ts`

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/canvas/nodes/PathNode.ts
import paper from 'paper'
import { BaseNode } from './BaseNode'

export interface PathNodeMountParams {
  segments?: paper.Segment[]
  strokeColor?: string | paper.Color | null
  fillColor?: string | paper.Color | null
  strokeWidth?: number
  dashArray?: number[]
  closed?: boolean
  data?: Record<string, unknown>
}

export class PathNode extends BaseNode {
  private path: paper.Path | null = null

  constructor(id: string, layer: paper.Layer) {
    super(id, 'path', layer)
  }

  mount(params: PathNodeMountParams = {}): void {
    this.layer.activate()
    this.path = new paper.Path()

    const toColor = (c: string | paper.Color | null | undefined) =>
      c != null ? new paper.Color(c as string) : null

    if (params.strokeColor !== undefined) this.path.strokeColor = toColor(params.strokeColor)
    if (params.fillColor !== undefined) this.path.fillColor = toColor(params.fillColor)
    if (params.strokeWidth !== undefined) this.path.strokeWidth = params.strokeWidth
    if (params.dashArray !== undefined) this.path.dashArray = params.dashArray
    if (params.closed !== undefined) this.path.closed = params.closed
    if (params.segments?.length) this.path.segments = params.segments
    if (params.data) this.path.data = { ...params.data }
  }

  update(params: Partial<PathNodeMountParams>): void {
    if (!this.path) return
    const toColor = (c: string | paper.Color | null | undefined) =>
      c != null ? new paper.Color(c as string) : null

    if (params.strokeColor !== undefined) this.path.strokeColor = toColor(params.strokeColor)
    if (params.fillColor !== undefined) this.path.fillColor = toColor(params.fillColor)
    if (params.strokeWidth !== undefined) this.path.strokeWidth = params.strokeWidth
    if (params.dashArray !== undefined) this.path.dashArray = params.dashArray
    if (params.closed !== undefined) this.path.closed = params.closed
  }

  /** 绘制过程中追加点 */
  addSegment(point: paper.Point): void {
    this.path?.add(point)
  }

  /** 绘制完成，可选平滑 */
  finalize(smooth = false): void {
    if (!this.path) return
    if (smooth) this.path.smooth({ type: 'catmull-rom', factor: 0.5 })
  }

  destroy(): void {
    this.path?.remove()
    this.path = null
  }

  getBounds(): paper.Rectangle {
    return this.path?.bounds ?? new paper.Rectangle(0, 0, 0, 0)
  }

  getPaperItem(): paper.Path | null {
    return this.path
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "canvas/nodes/PathNode" || echo "✅ PathNode OK"
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/canvas/nodes/PathNode.ts
git commit -m "feat(canvas): add PathNode wrapping paper.Path"
```

---

### Task 6: NodeManager

**Files:**
- Create: `frontend/src/canvas/NodeManager.ts`

依赖：Task 1–5 全部完成后执行。

- [ ] **Step 1: 创建文件**

```typescript
// frontend/src/canvas/NodeManager.ts
import paper from 'paper'
import { BaseNode } from './nodes/BaseNode'
import { ImageNode, ImageNodeMountParams } from './nodes/ImageNode'
import { TextNode, TextNodeMountParams } from './nodes/TextNode'
import { PathNode, PathNodeMountParams } from './nodes/PathNode'
import { ImageResourceManager } from './ImageResourceManager'

class NodeManager {
  private static _instance: NodeManager | null = null
  private nodes = new Map<string, BaseNode>()

  private constructor() {}

  static getInstance(): NodeManager {
    if (!NodeManager._instance) {
      NodeManager._instance = new NodeManager()
    }
    return NodeManager._instance
  }

  createImage(id: string, layer: paper.Layer, params: ImageNodeMountParams): ImageNode {
    const node = new ImageNode(id, layer)
    node.mount(params)
    this.nodes.set(id, node)
    return node
  }

  createText(id: string, layer: paper.Layer, params: TextNodeMountParams): TextNode {
    const node = new TextNode(id, layer)
    node.mount(params)
    this.nodes.set(id, node)
    return node
  }

  createPath(id: string, layer: paper.Layer, params: PathNodeMountParams): PathNode {
    const node = new PathNode(id, layer)
    node.mount(params)
    this.nodes.set(id, node)
    return node
  }

  get<T extends BaseNode = BaseNode>(id: string): T | undefined {
    return this.nodes.get(id) as T | undefined
  }

  has(id: string): boolean {
    return this.nodes.has(id)
  }

  destroy(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    node.destroy()
    this.nodes.delete(id)
  }

  destroyAll(): void {
    for (const node of this.nodes.values()) node.destroy()
    this.nodes.clear()
  }

  /** 图层删除时调用：销毁该图层内所有节点 */
  destroyByLayerId(layerId: string): void {
    for (const [id, node] of this.nodes.entries()) {
      if (node.layer.name === layerId) {
        node.destroy()
        this.nodes.delete(id)
      }
    }
  }

  /** 缩放/平移时调用，广播到 ImageResourceManager */
  setViewportMoving(v: boolean): void {
    ImageResourceManager.getInstance().setViewportMoving(v)
  }

  get size(): number {
    return this.nodes.size
  }
}

export { NodeManager }
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "canvas/NodeManager" || echo "✅ NodeManager OK"
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/canvas/NodeManager.ts
git commit -m "feat(canvas): add NodeManager singleton"
```

---

## Wave 3 — 集成现有代码（依赖 Wave 2，可并行）

### Task 7: Viewport 信号 — InteractionController + GlobalZoomCapture

**Files:**
- Modify: `frontend/src/components/canvas/InteractionController.tsx`
- Modify: `frontend/src/components/canvas/GlobalZoomCapture.tsx`

#### 7a: InteractionController.tsx

滚轮缩放开始时发送 `setViewportMoving(true)`，停止 150ms 后发送 `false`。

- [ ] **Step 1: 修改文件**

在 `frontend/src/components/canvas/InteractionController.tsx` 顶部添加 import：

```typescript
import { NodeManager } from '@/canvas/NodeManager'
```

在组件内（`const zoomRef = useRef(1)` 之后）添加：

```typescript
const zoomEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

在 `handleWheel` 的 `if (shouldZoom)` 分支内，`setViewport(...)` 调用之**前**插入：

```typescript
NodeManager.getInstance().setViewportMoving(true)
if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current)
zoomEndTimerRef.current = setTimeout(() => {
  NodeManager.getInstance().setViewportMoving(false)
}, 150)
```

在 `useEffect` 的 cleanup `return () => { ... }` 内添加：

```typescript
if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current)
```

完整修改后的 `InteractionController.tsx`：

```typescript
import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores';
import { normalizeWheelDelta, computeSmoothZoom } from '@/lib/zoomUtils';
import { NodeManager } from '@/canvas/NodeManager';

interface InteractionControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const InteractionController: React.FC<InteractionControllerProps> = ({ canvasRef }) => {
  const zoomRef = useRef(1);
  const zoomEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoom = useCanvasStore((state) => state.zoom);
  const setPan = useCanvasStore((state) => state.setPan);
  const setViewport = useCanvasStore((state) => state.setViewport);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      const store = useCanvasStore.getState();

      if (store.isOperationInProgress) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const isModifierWheel = event.ctrlKey || event.metaKey;
      const shouldZoom =
        store.wheelZoomMode === 'direct' ? !isModifierWheel : isModifierWheel;

      if (shouldZoom) {
        event.preventDefault();
        event.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const sx = (event.clientX - rect.left) * dpr;
        const sy = (event.clientY - rect.top) * dpr;

        const z1 = zoomRef.current;
        const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
        if (Math.abs(delta) < 1e-6) return;

        const z2 = computeSmoothZoom(z1, delta, { sensitivity: store.zoomSensitivity });
        if (z1 === z2) return;

        const pan2x = store.panX + sx * (1 / z2 - 1 / z1);
        const pan2y = store.panY + sy * (1 / z2 - 1 / z1);

        NodeManager.getInstance().setViewportMoving(true);
        if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current);
        zoomEndTimerRef.current = setTimeout(() => {
          NodeManager.getInstance().setViewportMoving(false);
        }, 150);

        setViewport({ panX: pan2x, panY: pan2y, zoom: z2 });
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) > 0) {
        const dpr = window.devicePixelRatio || 1;
        const worldDeltaX = (-event.deltaX * dpr) / zoomRef.current;
        const worldDeltaY = (-event.deltaY * dpr) / zoomRef.current;

        const newPanX = store.panX + worldDeltaX;
        const newPanY = store.panY + worldDeltaY;
        setPan(newPanX, newPanY);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (zoomEndTimerRef.current) clearTimeout(zoomEndTimerRef.current);
    };
  }, [setPan, setViewport, canvasRef]);

  return null;
};

export default InteractionController;
```

- [ ] **Step 2: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "InteractionController" || echo "✅ InteractionController OK"
```

#### 7b: GlobalZoomCapture.tsx

捏合手势（gesturestart/gestureend）以及全局 wheel 缩放时发送信号。

- [ ] **Step 3: 修改 GlobalZoomCapture.tsx**

在文件顶部 import 区加入：

```typescript
import { NodeManager } from '@/canvas/NodeManager';
```

在组件内现有 `useRef` 声明之后添加：

```typescript
const pinchEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

在 `handleGestureStart` 函数内（`gestureStartZoomRef.current = ...` 之前）添加：

```typescript
NodeManager.getInstance().setViewportMoving(true);
```

在 `handleGestureEnd` 函数内（`gestureStartZoomRef.current = null` 之后）添加：

```typescript
NodeManager.getInstance().setViewportMoving(false);
```

在全局 `handleWheel`（GlobalZoomCapture 里的那个，非 InteractionController）的 `applyZoom(...)` 调用之前添加：

```typescript
NodeManager.getInstance().setViewportMoving(true);
if (pinchEndTimerRef.current) clearTimeout(pinchEndTimerRef.current);
pinchEndTimerRef.current = setTimeout(() => {
  NodeManager.getInstance().setViewportMoving(false);
}, 150);
```

在 `return () => { ... }` cleanup 里添加：

```typescript
if (pinchEndTimerRef.current) clearTimeout(pinchEndTimerRef.current);
```

- [ ] **Step 4: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "GlobalZoomCapture" || echo "✅ GlobalZoomCapture OK"
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/canvas/InteractionController.tsx \
        frontend/src/components/canvas/GlobalZoomCapture.tsx
git commit -m "feat(canvas): broadcast viewport moving signal on zoom/pinch"
```

---

### Task 8: 集成 useImageTool.ts

**Files:**
- Modify: `frontend/src/components/canvas/hooks/useImageTool.ts`

这是核心修改：用 `NodeManager.createImage()` 替换 `new paper.Raster()` + `setRasterSourceSafely`。

背景：原代码在 `handleImageUploaded` 里（约第 289–570 行）：
1. `new paper.Raster()` 创建空 raster
2. 设置 `raster.onLoad` 回调（含初始化逻辑和 `alreadyInitialized` 防重复保护）
3. 调用 `setRasterSourceSafely(raster, url)` 触发加载
4. 创建 `imageGroup = new paper.Group([raster])`

新代码：把 `raster.onLoad` 的初始化逻辑移入 `onReady` 回调，去掉 `alreadyInitialized` 防重复逻辑（`ImageNode.update()` 的 URL 幂等性已处理）。

- [ ] **Step 1: 在文件顶部添加 import**

在 `useImageTool.ts` 的现有 import 区末尾添加：

```typescript
import { NodeManager } from '@/canvas/NodeManager';
import type { ImageNode } from '@/canvas/nodes/ImageNode';
```

- [ ] **Step 2: 在 imageInstances state 中新增 nodeId 字段**

找到 `ImageInstance` 类型定义（约 140 行附近），在其中添加：

```typescript
nodeId?: string;  // NodeManager 中的节点 ID
```

- [ ] **Step 3: 替换 handleImageUploaded 中的 Raster 创建**

找到 `handleImageUploaded` 中以下代码段（约 315–530 行），定位到：

```typescript
// 创建Paper.js的Raster对象来显示图片
const raster = new paper.Raster();
(raster as any).crossOrigin = 'anonymous';

// 等待图片加载完成后设置位置
raster.onLoad = () => {
  // 🔥 若 Raster source 被切换（dataURL → OSS URL 等）会再次触发 onLoad：
  const alreadyInitialized = Boolean((raster as any)?.data?.__tanvaImageInitialized);
  if (alreadyInitialized) {
    // ... source switch handling (约 25 行)
    return;
  }
  // ... initialization (约 150 行)
};

raster.onError = (error: unknown) => {
  // ...
};

// ... 设置 raster.data
setRasterSourceSafely(raster, sourceForRaster);
```

替换为：

```typescript
// 获取当前活跃图层
const activeLayer = paper.project.activeLayer as paper.Layer;

// 用 NodeManager 创建 ImageNode（内部用 ImageResourceManager 预加载，无白帧）
const imageNode = NodeManager.getInstance().createImage(imageId, activeLayer, {
  url: sourceForRaster,
  bounds: new paper.Rectangle(
    paperBounds.x,
    paperBounds.y,
    paperBounds.width,
    paperBounds.height
  ),
  priority: 'visible',
  onReady: (raster) => {
    // 以下逻辑来自原 raster.onLoad 的非 alreadyInitialized 分支
    const originalWidth = raster.width;
    const originalHeight = raster.height;
    const aspectRatio = originalWidth / originalHeight;

    raster.data = {
      ...(raster.data || {}),
      type: 'image',
      imageId,
      imageLocked: Boolean(asset.locked),
      originalWidth,
      originalHeight,
      aspectRatio,
    };

    const useOriginalSize = localStorage.getItem('tanva-use-original-size') === 'true';
    let finalBounds: paper.Rectangle;

    if (useOriginalSize) {
      const centerX = paperBounds.x + paperBounds.width / 2;
      const centerY = paperBounds.y + paperBounds.height / 2;
      finalBounds = new paper.Rectangle(
        centerX - originalWidth / 2,
        centerY - originalHeight / 2,
        originalWidth,
        originalHeight
      );
    } else {
      const boxAspectRatio = paperBounds.width / paperBounds.height;
      if (aspectRatio > boxAspectRatio) {
        const newWidth = paperBounds.width;
        const newHeight = newWidth / aspectRatio;
        const yOffset = (paperBounds.height - newHeight) / 2;
        finalBounds = new paper.Rectangle(
          paperBounds.x,
          paperBounds.y + yOffset,
          newWidth,
          newHeight
        );
      } else {
        const newHeight = paperBounds.height;
        const newWidth = newHeight * aspectRatio;
        const xOffset = (paperBounds.width - newWidth) / 2;
        finalBounds = new paper.Rectangle(
          paperBounds.x + xOffset,
          paperBounds.y,
          newWidth,
          newHeight
        );
      }
    }

    raster.bounds = finalBounds;
    addImageSelectionElements(raster, finalBounds, imageId, Boolean(asset.locked));

    const preferredDisplaySrc = pickRuntimeImageSource({
      pendingUpload: asset.pendingUpload,
      localDataUrl: asset.localDataUrl,
      persistedCandidates: [persistedSrc, persistedUrl, asset.url],
    });

    setImageInstances((prev) =>
      prev.map((img) =>
        img.id === imageId
          ? {
              ...img,
              bounds: {
                x: finalBounds.x,
                y: finalBounds.y,
                width: finalBounds.width,
                height: finalBounds.height,
              },
              imageData: {
                ...img.imageData,
                url: asset.url,
                src: preferredDisplaySrc || asset.url,
                key: asset.key || img.imageData.key,
                fileName: asset.fileName || img.imageData.fileName,
                width: originalWidth,
                height: originalHeight,
                contentType: asset.contentType || img.imageData.contentType,
                pendingUpload: asset.pendingUpload,
                localDataUrl: asset.localDataUrl,
              },
            }
          : img
      )
    );

    if (!suppressAutoSave) {
      try { paperSaveService.triggerAutoSave('image-loaded'); } catch {}
    }

    try {
      (raster.data as any).__tanvaImageInitialized = true;
      (raster.data as any).__tanvaBounds = {
        x: finalBounds.x,
        y: finalBounds.y,
        width: finalBounds.width,
        height: finalBounds.height,
      };
    } catch {}

    paper.view.update();
  },
});

const raster = imageNode.getPaperItem()!;
```

**注意**：`onReady` 回调体内需要完整复制原 `raster.onLoad` 的初始化分支代码（originalWidth 计算、finalBounds 计算、`addImageSelectionElements` 调用、`setImageInstances` 状态更新）。原 `alreadyInitialized` 分支整体删除（URL 切换由下面的 `update` 处理）。

- [ ] **Step 4: 处理 URL 切换（OSS URL 替换 dataURL）**

原代码在图片上传完成后会再次调用 `setRasterSourceSafely(raster, ossUrl)`，触发第二次 `onLoad`（走 `alreadyInitialized` 分支更新位置）。

新代码：找到调用 `setRasterSourceSafely` 更新 OSS URL 的位置（通常在 upload 完成回调里），替换为：

```typescript
const node = NodeManager.getInstance().get<ImageNode>(imageId);
node?.update(ossUrl, 'visible');
```

- [ ] **Step 5: 处理节点删除**

找到图片删除逻辑（原来调用 `raster.remove()` 的地方），替换为：

```typescript
NodeManager.getInstance().destroy(imageId);
```

- [ ] **Step 6: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "useImageTool" || echo "✅ useImageTool OK"
```

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/canvas/hooks/useImageTool.ts
git commit -m "feat(canvas): use NodeManager.createImage in useImageTool, eliminate zoom flicker"
```

---

### Task 9: 集成 useDrawingTools.ts

**Files:**
- Modify: `frontend/src/components/canvas/hooks/useDrawingTools.ts`

背景：`useDrawingTools.ts` 中有多处 `new paper.Path()` 用于自由绘制、矩形、圆形、箭头等。将主要的自由绘制路径替换为 `NodeManager.createPath()`。

> **范围说明**：矩形/圆形/箭头等工具使用 `paper.Path.Rectangle` / `paper.Path.Circle` 等静态方法，不在本次 Task 范围内（PathNode 目前只封装 `new paper.Path()`）。本 Task 只替换自由绘制（约第 278–300 行的 `pathRef.current = new paper.Path()`）。

- [ ] **Step 1: 添加 import**

在 `useDrawingTools.ts` 顶部 import 区末尾添加：

```typescript
import { NodeManager } from '@/canvas/NodeManager';
import type { PathNode } from '@/canvas/nodes/PathNode';
```

- [ ] **Step 2: 添加 nodeRef**

在文件中找到 `pathRef` 定义附近，添加：

```typescript
const drawingNodeRef = useRef<PathNode | null>(null);
```

- [ ] **Step 3: 替换自由绘制的 Path 创建（约第 278 行）**

找到：

```typescript
pathRef.current = new paper.Path();
```

（紧跟在自由绘制 `startDrawing` 逻辑内）替换为：

```typescript
const drawId = `path_draw_${Date.now()}`;
const activeLayer = paper.project.activeLayer as paper.Layer;
drawingNodeRef.current = NodeManager.getInstance().createPath(drawId, activeLayer, {
  strokeColor: currentColor,
  strokeWidth: strokeWidth,
  fillColor: null,
});
pathRef.current = drawingNodeRef.current.getPaperItem();
```

- [ ] **Step 4: 替换自由绘制的 addSegment**

找到绘制过程中调用 `pathRef.current.add(point)` 的位置，在其后增加（不替换，保持兼容）：

```typescript
// pathRef.current.add(point) 已有，保留原逻辑
```

`PathNode.addSegment` 在本 Task 中不强制替换，只确保通过 NodeManager 创建的节点在销毁时正确清理。

- [ ] **Step 5: 替换路径删除**

在绘制取消或清除路径的地方，找到 `pathRef.current?.remove()` 调用，在其后添加：

```typescript
if (drawingNodeRef.current) {
  NodeManager.getInstance().destroy(drawingNodeRef.current.id);
  drawingNodeRef.current = null;
}
```

- [ ] **Step 6: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "useDrawingTools" || echo "✅ useDrawingTools OK"
```

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/canvas/hooks/useDrawingTools.ts
git commit -m "feat(canvas): register freehand paths with NodeManager"
```

---

### Task 10: 集成 useSimpleTextTool.ts

**Files:**
- Modify: `frontend/src/components/canvas/hooks/useSimpleTextTool.ts`

背景：`useSimpleTextTool.ts` 约第 110 行创建 `new paper.PointText()`。

- [ ] **Step 1: 添加 import**

```typescript
import { NodeManager } from '@/canvas/NodeManager';
```

- [ ] **Step 2: 替换 PointText 创建（约第 107–133 行）**

找到：

```typescript
const paperText = new paper.PointText({
  point: [point.x, point.y],
  content: content,
  fillColor: textStyle.color,
  fontSize: textStyle.fontSize,
  fontFamily: textStyle.fontFamily,
  fontWeight: textStyle.fontWeight === 'bold' ? 'bold' : 'normal',
  fontStyle: textStyle.italic ? 'italic' : 'normal',
  justification: textStyle.align,
  visible: true
});
paperText.strokeColor = null;
paperText.selected = false;
paperText.data = {
  type: 'text',
  textId: id
};
drawingLayer.addChild(paperText);
```

替换为：

```typescript
const textNodeInst = NodeManager.getInstance().createText(id, drawingLayer as paper.Layer, {
  text: content,
  position: point,
  fontSize: textStyle.fontSize,
  fontFamily: textStyle.fontFamily,
  fontWeight: textStyle.fontWeight === 'bold' ? 'bold' : 'normal',
  fontStyle: textStyle.italic ? 'italic' : 'normal',
  fillColor: textStyle.color,
  justification: textStyle.align as 'left' | 'center' | 'right',
  data: { type: 'text', textId: id },
});
const paperText = textNodeInst.getPaperItem()!;
```

- [ ] **Step 3: 替换 PointText 销毁**

找到 `clearAllTextItems` 中 `item.paperText?.remove()` 调用，在其后添加：

```typescript
NodeManager.getInstance().destroy(item.id);
```

（保留原 `remove()` 调用作为双重保障，NodeManager.destroy 里也会调用 `TextNode.destroy()` → `pointText.remove()`，但双重 remove 是幂等的）

- [ ] **Step 4: 类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1 | grep "useSimpleTextTool" || echo "✅ useSimpleTextTool OK"
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/canvas/hooks/useSimpleTextTool.ts
git commit -m "feat(canvas): register text nodes with NodeManager"
```

---

## Wave 4 — 端到端验证

### Task 11: 全量类型检查 + 启动验证

**Files:** 无新文件，验证所有修改

- [ ] **Step 1: 全量类型检查**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc --noEmit 2>&1
```

预期：无 `canvas/` 相关错误（允许已有的 TS 错误保持不变）

- [ ] **Step 2: 启动开发服务器**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npm run dev
```

- [ ] **Step 3: 手动验证缩放闪烁修复**

1. 打开画布页面
2. 上传至少一张图片，等待加载完成
3. 用滚轮快速缩放画布（5 次以上连续缩放）
4. 预期：图片**不再出现**短暂白帧或消失

- [ ] **Step 4: 手动验证图片 URL 切换**

1. 上传图片，观察上传过程
2. 确认图片从预览态（dataURL）切换到 OSS URL 时**无闪烁**

- [ ] **Step 5: 手动验证文字/路径**

1. 创建文本节点，确认正常渲染
2. 自由绘制路径，确认正常渲染
3. 删除节点，确认无 console 报错

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(canvas): complete node lifecycle system and zoom flicker fix"
```
