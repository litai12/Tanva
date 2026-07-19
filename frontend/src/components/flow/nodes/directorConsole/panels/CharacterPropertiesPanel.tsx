import React from 'react'
import type { CharacterObj } from '../types'
import { HexColorField, KeyframeButton, Section, TextField, Vec3Row, SliderField } from './Field'
import type { PropertyName } from '../state/propertyTimeline'
import { POSE_PRESETS, deg, toDeg, type JointRole, type PosePreset } from '../state/pose'
import { getLibraryItem } from '../assets'

type Props = {
  character: CharacterObj
  onPatch: (patch: Partial<CharacterObj>) => void
  timelineMode?: boolean
  timelineKeyframes?: {
    isKeyed: (property: PropertyName, component?: 0 | 1 | 2) => boolean
    toggle: (property: PropertyName, component?: 0 | 1 | 2) => void
  }
}

type PoseEntry = { label: string; sourceId: string }

// LibTV Director Console exposes this fixed set and order; Tanva's larger pose library is intentionally not surfaced.
export const LIBTV_POSES: PoseEntry[] = [
  { label: '站立', sourceId: 'arms-down' },
  { label: 'T型', sourceId: 'tpose' },
  { label: '行走', sourceId: 'walk' },
  { label: '跑步', sourceId: 'run' },
  { label: '坐姿', sourceId: 'sit' },
  { label: '蹲下', sourceId: 'squat' },
  { label: '单膝跪', sourceId: 'kneel' },
  { label: '双膝跪', sourceId: 'seiza' },
  { label: '叉腰', sourceId: 'akimbo' },
  { label: '倚靠', sourceId: 'hands-behind' },
  { label: '鞠躬', sourceId: 'bow' },
  { label: '思考', sourceId: 'think' },
  { label: '格斗', sourceId: 'horse-stance' },
  { label: '踢球', sourceId: 'kick' },
  { label: '投掷', sourceId: 'throw' },
  { label: '推进', sourceId: 'push' },
  { label: '招手', sourceId: 'wave' },
  { label: '伸手', sourceId: 'reach' },
  { label: '抱臂', sourceId: 'crossed' },
  { label: '看手机', sourceId: 'phone' },
]

type Adjustment = { label: string; role: JointRole; axis: 0 | 1 | 2; min: number; max: number; side?: '左' | '右' }
type AdjustmentGroup = { title: string; items: Adjustment[] }

const GROUPS: AdjustmentGroup[] = [
  { title: '身体', items: [
    { label: '前倾', role: 'body', axis: 0, min: -45, max: 45 },
    { label: '转身', role: 'body', axis: 1, min: -60, max: 60 },
    { label: '侧倾', role: 'body', axis: 2, min: -40, max: 40 },
  ] },
  { title: '躯干', items: [
    { label: '前倾', role: 'spine', axis: 0, min: -45, max: 45 },
    { label: '扭转', role: 'spine', axis: 1, min: -60, max: 60 },
    { label: '侧倾', role: 'spine', axis: 2, min: -40, max: 40 },
  ] },
  { title: '头部', items: [
    { label: '点头', role: 'neck', axis: 0, min: -40, max: 40 },
    { label: '转头', role: 'neck', axis: 1, min: -60, max: 60 },
    { label: '歪头', role: 'neck', axis: 2, min: -35, max: 35 },
  ] },
  { title: '手臂 — 肩', items: [
    { side: '左', label: '前举', role: 'shoulderL', axis: 0, min: -120, max: 60 },
    { side: '左', label: '外展', role: 'shoulderL', axis: 2, min: -100, max: 140 },
    { side: '左', label: '扭转', role: 'shoulderL', axis: 1, min: -90, max: 90 },
    { side: '右', label: '前举', role: 'shoulderR', axis: 0, min: -120, max: 60 },
    { side: '右', label: '外展', role: 'shoulderR', axis: 2, min: -140, max: 100 },
    { side: '右', label: '扭转', role: 'shoulderR', axis: 1, min: -90, max: 90 },
  ] },
  { title: '肘部', items: [
    { side: '左', label: '弯曲', role: 'elbowL', axis: 1, min: -140, max: 5 },
    { side: '右', label: '弯曲', role: 'elbowR', axis: 1, min: -5, max: 140 },
  ] },
  { title: '腿部 — 髋', items: [
    { side: '左', label: '前抬', role: 'hipL', axis: 0, min: -110, max: 60 },
    { side: '左', label: '外展', role: 'hipL', axis: 2, min: -70, max: 70 },
    { side: '左', label: '扭转', role: 'hipL', axis: 1, min: -70, max: 70 },
    { side: '右', label: '前抬', role: 'hipR', axis: 0, min: -110, max: 60 },
    { side: '右', label: '外展', role: 'hipR', axis: 2, min: -70, max: 70 },
    { side: '右', label: '扭转', role: 'hipR', axis: 1, min: -70, max: 70 },
  ] },
  { title: '膝部', items: [
    { side: '左', label: '弯曲', role: 'kneeL', axis: 0, min: -5, max: 140 },
    { side: '右', label: '弯曲', role: 'kneeR', axis: 0, min: -5, max: 140 },
  ] },
]

const presetById = new Map(POSE_PRESETS.map((preset) => [preset.id, preset]))

export function CharacterPropertiesPanel({ character, onPatch, timelineMode = false, timelineKeyframes }: Props) {
  const isProp = getLibraryItem(character.modelId)?.kind !== 'body'
  const [tab, setTab] = React.useState<'props' | 'pose' | 'trajectory'>('props')
  const effectiveTab = isProp || (!timelineMode && tab === 'trajectory') ? 'props' : tab
  const pose = (character.pose ?? {}) as Record<string, [number, number, number]>
  const rotationDegrees = character.rotation.map((value) => toDeg(value)) as [number, number, number]

  const applyPreset = (entry: PoseEntry) => {
    const preset = presetById.get(entry.sourceId) as PosePreset | undefined
    if (!preset) return
    onPatch({ pose: { ...preset.pose }, posePresetId: entry.sourceId, motion: undefined, motionClip: undefined, motionSequence: undefined })
  }

  const setJoint = (item: Adjustment, value: number) => {
    const current = (pose[item.role] ?? [0, 0, 0]).slice() as [number, number, number]
    current[item.axis] = deg(value)
    onPatch({ pose: { ...pose, [item.role]: current }, posePresetId: undefined, motion: undefined, motionClip: undefined, motionSequence: undefined })
  }

  const tabs = isProp ? [{ id: 'props', label: '属性' }] : [
    { id: 'props', label: '属性' },
    { id: 'pose', label: '姿势' },
    ...(timelineMode ? [{ id: 'trajectory', label: '运动轨迹' }] : []),
  ]

  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: '#f5f5f5' }}>{isProp ? '对象' : '角色'}</div>
      <div style={{ display: 'flex', gap: 18, padding: '0 16px 8px', borderBottom: '1px solid #262626' }}>
        {tabs.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id as typeof tab)} style={{ border: 0, borderBottom: effectiveTab === item.id ? '2px solid #f5f5f5' : '2px solid transparent', padding: '0 0 8px', background: 'transparent', color: effectiveTab === item.id ? '#f5f5f5' : '#737373', cursor: 'pointer', fontSize: 13 }}>{item.label}</button>
        ))}
      </div>

      {effectiveTab === 'props' ? <>
        <Section title="名称"><TextField value={character.name} onChange={(value) => onPatch({ name: value })} /></Section>
        <Section title="位置"><Vec3Row value={character.position} onChange={(value) => onPatch({ position: value })} renderAxisAction={timelineMode && timelineKeyframes ? (component) => <KeyframeButton keyed={timelineKeyframes.isKeyed('position', component)} onClick={() => timelineKeyframes.toggle('position', component)} /> : undefined} /></Section>
        <Section title="旋转"><Vec3Row value={rotationDegrees} onChange={(value) => onPatch({ rotation: value.map((angle) => deg(angle)) as [number, number, number] })} renderAxisAction={timelineMode && timelineKeyframes ? (component) => <KeyframeButton keyed={timelineKeyframes.isKeyed('rotation', component)} onClick={() => timelineKeyframes.toggle('rotation', component)} /> : undefined} /></Section>
        <Section title="缩放"><Vec3Row value={character.scale} onChange={(value) => onPatch({ scale: value })} renderAxisAction={timelineMode && timelineKeyframes ? (component) => <KeyframeButton keyed={timelineKeyframes.isKeyed('scale', component)} onClick={() => timelineKeyframes.toggle('scale', component)} /> : undefined} /></Section>
        <Section title="统一缩放"><SliderField value={character.uniformScale} min={0.2} max={3} step={0.01} displayDigits={1} onChange={(value) => onPatch({ uniformScale: value })} /></Section>
        <Section title="颜色"><HexColorField value={character.colorHex} onChange={(colorHex) => onPatch({ colorHex })} /></Section>
      </> : effectiveTab === 'pose' ? <>
        <Section title="姿势预设">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
            {LIBTV_POSES.map((entry) => {
              const active = character.posePresetId === entry.sourceId
              return <button key={entry.label} onClick={() => applyPreset(entry)} style={{ minHeight: 36, borderRadius: 6, border: `1px solid ${active ? '#e5e5e5' : '#333'}`, background: active ? '#404040' : '#242424', color: active ? '#fff' : '#bfbfbf', fontSize: 11, cursor: 'pointer' }}>{entry.label}</button>
            })}
          </div>
        </Section>
        <div style={{ padding: '12px 16px 4px', color: '#8b93a1', fontSize: 12 }}>姿势调节</div>
        {GROUPS.map((group) => <Section key={group.title} title={group.title}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {group.items.map((item, index) => <React.Fragment key={`${item.side ?? ''}-${item.label}-${item.role}`}>
              {item.side && (index === 0 || group.items[index - 1]?.side !== item.side) ? <div style={{ color: '#d4d4d4', fontSize: 11, fontWeight: 600 }}>{item.side}</div> : null}
              <div>
              <div style={{ marginBottom: 3, color: '#a3a3a3', fontSize: 11 }}>{item.label}</div>
              <SliderField value={toDeg(pose[item.role]?.[item.axis] ?? 0)} min={item.min} max={item.max} step={1} inputLabel={`${item.label}角度`} onChange={(value) => setJoint(item, value)} />
              </div>
            </React.Fragment>)}
          </div>
        </Section>)}
      </> : <div style={{ padding: 16, color: '#8c8c8c', fontSize: 12, lineHeight: 1.6 }}>在下方时间轴中选择角色轨道，并使用“绘制轨迹”设置角色运动路径。</div>}
    </div>
  )
}
