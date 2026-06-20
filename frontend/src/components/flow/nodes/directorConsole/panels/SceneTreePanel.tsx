import React from 'react'
import {
  Video as IconVideo,
  User as IconUser,
  Eye as IconEye,
  EyeOff as IconEyeOff,
  Lock as IconLock,
  LockOpen as IconLockOpen,
} from 'lucide-react'
import type { DirectorScene } from '../types'

type Row = { id: string; name: string; kind: 'camera' | 'character'; hidden?: boolean; locked?: boolean }

type Props = {
  scene: DirectorScene
  selectedId?: string
  onSelect: (id: string) => void
  onToggleHidden: (id: string, hidden: boolean) => void
  onToggleLocked: (id: string, locked: boolean) => void
}

export function SceneTreePanel({ scene, selectedId, onSelect, onToggleHidden, onToggleLocked }: Props) {
  const [q, setQ] = React.useState('')
  const rows: Row[] = [
    ...scene.cameras.map((c): Row => ({ id: c.id, name: c.name, kind: 'camera', hidden: c.hidden, locked: c.locked })),
    ...scene.characters.map((c): Row => ({ id: c.id, name: c.name, kind: 'character', hidden: c.hidden, locked: c.locked })),
  ].filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>场景</div>
      <div style={{ padding: '0 16px 8px' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="请输入搜索内容"
          style={{ width: '100%', background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 8, color: '#e5e7eb', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }} />
      </div>
      <div>
        {rows.map((r) => {
          const active = r.id === selectedId
          return (
            <div key={r.id} onClick={() => onSelect(r.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', cursor: 'pointer', background: active ? '#1c2230' : 'transparent' }}>
              {r.kind === 'camera' ? <IconVideo size={16} color="#9ca3af" /> : <IconUser size={16} color="#9ca3af" />}
              <span style={{ flex: 1, fontSize: 13, color: r.hidden ? '#5b6470' : '#cdd3dc' }}>{r.name}</span>
              <button onClick={(e) => { e.stopPropagation(); onToggleHidden(r.id, !r.hidden) }} style={iconBtn} title="隐藏">
                {r.hidden ? <IconEyeOff size={14} color="#6b7280" /> : <IconEye size={14} color="#9ca3af" />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); onToggleLocked(r.id, !r.locked) }} style={iconBtn} title="锁定">
                {r.locked ? <IconLock size={14} color="#6b7280" /> : <IconLockOpen size={14} color="#9ca3af" />}
              </button>
            </div>
          )
        })}
        {rows.length === 0 ? <div style={{ padding: '12px 16px', color: '#5b6470', fontSize: 12 }}>暂无场景对象</div> : null}
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }
