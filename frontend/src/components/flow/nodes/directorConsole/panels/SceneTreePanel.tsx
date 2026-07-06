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
import { SliderField } from './Field'

type Row = { id: string; name: string; kind: 'camera' | 'character'; hidden?: boolean; locked?: boolean }

type Props = {
  scene: DirectorScene
  selectedId?: string
  onSelect: (id: string) => void
  onToggleHidden: (id: string, hidden: boolean) => void
  onToggleLocked: (id: string, locked: boolean) => void
  onSetGroundY: (v: number) => void
  onSetSkyboxPitch: (v: number) => void
}

export function SceneTreePanel({ scene, selectedId, onSelect, onToggleHidden, onToggleLocked, onSetGroundY, onSetSkyboxPitch }: Props) {
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
      <div style={{ padding: '12px 16px', marginTop: 8, borderTop: '1px solid #1c1f26' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#cdd3dc', marginBottom: 8 }}>
          <span>地平线高度</span>
          <button
            style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0 }}
            onClick={() => onSetGroundY(0)}
          >归零</button>
        </div>
        <SliderField value={scene.groundY ?? 0} min={-10} max={10} step={0.1} onChange={onSetGroundY} />
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 1.6 }}>向左拖动降低地面，让网格与角色对齐天空盒中的地面高度。</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#cdd3dc', margin: '16px 0 8px' }}>
          <span>天空盒俯仰</span>
          <button
            style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: 0 }}
            onClick={() => onSetSkyboxPitch(0)}
          >归零</button>
        </div>
        <SliderField value={scene.skyboxPitch ?? 0} min={-45} max={45} step={0.5} onChange={onSetSkyboxPitch} />
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 1.6 }}>上下旋转全景图，让它的地平线落到网格地平线上（处理拍摄不水平/未居中）。</div>
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }
