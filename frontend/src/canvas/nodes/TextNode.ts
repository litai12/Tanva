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
