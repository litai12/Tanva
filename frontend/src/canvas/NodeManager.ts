// frontend/src/canvas/NodeManager.ts
import paper from 'paper'
import { BaseNode } from './nodes/BaseNode'
import { ImageNode } from './nodes/ImageNode'
import type { ImageNodeMountParams } from './nodes/ImageNode'
import { TextNode } from './nodes/TextNode'
import type { TextNodeMountParams } from './nodes/TextNode'
import { PathNode } from './nodes/PathNode'
import type { PathNodeMountParams } from './nodes/PathNode'
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
