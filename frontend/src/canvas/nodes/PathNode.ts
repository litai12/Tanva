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
