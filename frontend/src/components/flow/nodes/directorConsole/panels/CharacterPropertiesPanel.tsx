import React from 'react'
import type { CharacterObj } from '../types'
import { Section, TextField, Vec3Row, SliderField } from './Field'
import { POSE_PRESETS, JOINT_SLIDERS, deg, toDeg, type JointRole } from '../state/pose'
import { getLibraryItem } from '../assets'

type Props = { character: CharacterObj; onPatch: (patch: Partial<CharacterObj>) => void }

export function CharacterPropertiesPanel({ character, onPatch }: Props) {
  const [tab, setTab] = React.useState<'props' | 'pose'>('props')
  // 道具（几何/家具）没有骨骼，不展示姿势页
  const isProp = getLibraryItem(character.modelId)?.kind === 'prop'
  const effectiveTab = isProp ? 'props' : tab
  return (
    <div>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600 }}>{isProp ? '道具' : '角色'}</div>
      <div style={{ display: 'flex', gap: 16, padding: '0 16px 8px', borderBottom: '1px solid #16181d' }}>
        {(isProp ? (['props'] as const) : (['props', 'pose'] as const)).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, paddingBottom: 8, color: effectiveTab === t ? '#fff' : '#6b7280', borderBottom: effectiveTab === t ? '2px solid #fff' : '2px solid transparent' }}>
            {t === 'props' ? '属性' : '姿势'}
          </button>
        ))}
      </div>

      {effectiveTab === 'props' ? (
        <>
          <Section title="名称"><TextField value={character.name} onChange={(v) => onPatch({ name: v })} /></Section>
          <Section title="位置"><Vec3Row value={character.position} onChange={(v) => onPatch({ position: v })} /></Section>
          <Section title="旋转"><Vec3Row value={character.rotation} onChange={(v) => onPatch({ rotation: v })} /></Section>
          <Section title="缩放"><Vec3Row value={character.scale} onChange={(v) => onPatch({ scale: v })} /></Section>
          <Section title="统一缩放">
            <SliderField value={character.uniformScale} min={0.2} max={3} step={0.01} onChange={(v) => onPatch({ uniformScale: v })} />
          </Section>
          <Section title="颜色">
            <input type="color" value={character.colorHex} onChange={(e) => onPatch({ colorHex: e.target.value })}
              style={{ width: 48, height: 32, background: 'transparent', border: '1px solid #2a2f3a', borderRadius: 6, cursor: 'pointer' }} />
          </Section>
        </>
      ) : (
        <PoseTab character={character} onPatch={onPatch} />
      )}
    </div>
  )
}

// 按 category 保序分组（POSE_PRESETS 内同类已相邻）
const poseGroups = POSE_PRESETS.reduce<{ category: string; items: typeof POSE_PRESETS }[]>((acc, p) => {
  const last = acc[acc.length - 1]
  if (last && last.category === p.category) last.items.push(p)
  else acc.push({ category: p.category, items: [p] })
  return acc
}, [])

function PoseTab({ character, onPatch }: Props) {
  const pose = (character.pose ?? {}) as Record<string, [number, number, number]>
  const applyPreset = (presetId: string, p: Record<string, [number, number, number]>) => onPatch({ pose: { ...p }, posePresetId: presetId })
  const setJoint = (role: JointRole, axis: 0 | 1 | 2, valDeg: number) => {
    const cur = (pose[role] ?? [0, 0, 0]).slice() as [number, number, number]
    cur[axis] = deg(valDeg)
    onPatch({ pose: { ...pose, [role]: cur } })
  }
  return (
    <>
      <Section title="姿势预设">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {poseGroups.map((g) => (
            <div key={g.category}>
              <div style={{ fontSize: 11, color: '#8b93a1', marginBottom: 4 }}>{g.category}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {g.items.map((p) => (
                  <button key={p.id} onClick={() => applyPreset(p.id, p.pose as Record<string, [number, number, number]>)}
                    style={{ padding: '6px 0', borderRadius: 6, background: '#1c1f26', color: '#cdd3dc', border: '1px solid #2a2f3a', cursor: 'pointer', fontSize: 12 }}>{p.name}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="逐关节调节">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {JOINT_SLIDERS.map((j) => {
            const v = toDeg((pose[j.role]?.[j.axis]) ?? 0)
            return (
              <div key={`${j.role}-${j.axis}`}>
                <div style={{ fontSize: 11, color: '#8b93a1', marginBottom: 2 }}>{j.label}</div>
                <SliderField value={v} min={j.min} max={j.max} step={1} onChange={(nv) => setJoint(j.role, j.axis, nv)} />
              </div>
            )
          })}
        </div>
      </Section>
      <div style={{ padding: '8px 16px' }}>
        <button onClick={() => onPatch({ pose: undefined, posePresetId: undefined })} style={{ width: '100%', padding: '7px 0', borderRadius: 8, background: '#1c1f26', color: '#9ca3af', border: '1px solid #2a2f3a', cursor: 'pointer' }}>重置姿势</button>
      </div>
    </>
  )
}
