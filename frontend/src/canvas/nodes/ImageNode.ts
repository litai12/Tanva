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
