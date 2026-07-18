import React from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { IconStack2 } from '@tabler/icons-react'
import type { DirectorConsoleData } from './types'

const DirectorConsoleModal = React.lazy(() => import('./DirectorConsoleModal'))

type DirectorConsoleFlowNode = Node<DirectorConsoleData, 'directorConsole'>

export function DirectorConsoleNode({ id, data }: NodeProps<DirectorConsoleFlowNode>) {
  const [open, setOpen] = React.useState(false)
  return (
    <div style={{ width: 320, background: '#16181d', borderRadius: 12, border: '1px solid #262a33', overflow: 'hidden' }}>
      <Handle
        id="target"
        className="tc-handle"
        type="target"
        position={Position.Left}
        data-handle-type="any"
        data-handle-position="left"
        title="输入：全景背景图（连接图片节点）"
        aria-label="输入：全景背景图"
      />
      <Handle
        id="source"
        className="tc-handle"
        type="source"
        position={Position.Right}
        data-handle-type="image"
        data-handle-position="right"
        title="输出：机位截图"
        aria-label="输出：机位截图"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', color: '#cdd3dc', fontSize: 13 }}>
        <IconStack2 size={16} /> {data.label ?? '导演台'}
      </div>
      <div className="nodrag" style={{ margin: 12, padding: 24, borderRadius: 10, background: '#1c1f26', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <IconStack2 size={32} color="#6b7280" />
        <p style={{ color: '#8b93a1', fontSize: 12, textAlign: 'center', margin: 0 }}>在3D空间中搭建场景并进行多视角截图</p>
        <button className="nodrag" onClick={() => setOpen(true)} style={{ padding: '6px 16px', borderRadius: 8, background: '#3a3f4b', color: '#fff', border: 'none', cursor: 'pointer' }}>打开导演台</button>
      </div>
      {open ? (
        <React.Suspense fallback={null}>
          <DirectorConsoleModal nodeId={id} onClose={() => setOpen(false)} />
        </React.Suspense>
      ) : null}
    </div>
  )
}

export default DirectorConsoleNode
