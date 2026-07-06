// @ts-nocheck
import React from 'react'
import { Handle, Position } from 'reactflow'
import { Layers as IconStack2 } from 'lucide-react'
import type { DirectorConsoleData } from './types'

const DirectorConsoleModal = React.lazy(() => import('./DirectorConsoleModal'))

type Props = {
  id: string
  data: DirectorConsoleData & { boxW?: number; boxH?: number }
  selected?: boolean
}

function DirectorConsoleNodeInner({ id, data, selected }: Props) {
  const [open, setOpen] = React.useState(false)
  const borderColor = selected ? '#2563eb' : '#262a33'
  return (
    <div style={{ width: data.boxW || 320, height: data.boxH || 220, background: '#16181d', borderRadius: 12, border: `1px solid ${borderColor}`, overflow: 'hidden', position: 'relative' }}>
      <Handle id="in-image" type="target" position={Position.Left} title="输入：全景背景图（连接图片节点）" />
      <Handle id="out-image" type="source" position={Position.Right} title="输出：机位截图" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', color: '#cdd3dc', fontSize: 13 }}>
        <IconStack2 size={16} /> {(data.label as string) ?? '导演台'}
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

export default React.memo(DirectorConsoleNodeInner)
