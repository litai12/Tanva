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
