import React from 'react'
import type { CharacterObj } from '../types'
import { Section, TextField, Vec3Row, SliderField } from './Field'
import { POSE_PRESETS, deg, toDeg, type JointRole, type PosePreset } from '../state/pose'
import { getLibraryItem } from '../assets'

type Props = {
  character: CharacterObj
  onPatch: (patch: Partial<CharacterObj>) => void
  timelineMode?: boolean
}

type PoseEntry = { label: string; sourceId: string }

// LibTV Director Console exposes this fixed set and order; Tanva's larger pose library is intentionally not surfaced.
const LIBTV_POSES: PoseEntry[] = [
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

type Adjustment = { label: string; role: JointRole; axis: 0 | 1 | 2; min: number; max: number }
type AdjustmentGroup = { title: string; items: Adjustment[] }

const GROUPS: AdjustmentGroup[] = [
  { title: '身体', items: [
    { label: '前后倾', role: 'spine', axis: 0, min: -45, max: 45 },
    { label: '转身', role: 'spine', axis: 1, min: -60, max: 60 },
    { label: '侧倾', role: 'spine', axis: 2, min: -40, max: 40 },
  ] },
  { title: '躯干', items: [
    { label: '前后倾', role: 'spine', axis: 0, min: -45, max: 45 },
    { label: '扭转', role: 'spine', axis: 1, min: -60, max: 60 },
    { label: '侧倾', role: 'spine', axis: 2, min: -40, max: 40 },
  ] },
  { title: '头部', items: [
    { label: '点头', role: 'neck', axis: 0, min: -40, max: 40 },
    { label: '转头', role: 'neck', axis: 1, min: -60, max: 60 },
    { label: '歪头', role: 'neck', axis: 2, min: -35, max: 35 },
  ] },
  { title: '肩部', items: [
    { label: '左肩前举', role: 'shoulderL', axis: 0, min: -120, max: 60 },
    { label: '左肩外展', role: 'shoulderL', axis: 2, min: -100, max: 140 },
    { label: '左肩旋转', role: 'shoulderL', axis: 1, min: -90, max: 90 },
    { label: '右肩前举', role: 'shoulderR', axis: 0, min: -120, max: 60 },
    { label: '右肩外展', role: 'shoulderR', axis: 2, min: -140, max: 100 },
    { label: '右肩旋转', role: 'shoulderR', axis: 1, min: -90, max: 90 },
  ] },
  { title: '肘部', items: [
    { label: '左肘弯曲', role: 'elbowL', axis: 1, min: -140, max: 5 },
    { label: '右肘弯曲', role: 'elbowR', axis: 1, min: -5, max: 140 },
  ] },
  { title: '髋部', items: [
    { label: '左髋前举', role: 'hipL', axis: 0, min: -110, max: 60 },
    { label: '左髋外展', role: 'hipL', axis: 2, min: -70, max: 70 },
    { label: '左髋旋转', role: 'hipL', axis: 1, min: -70, max: 70 },
    { label: '右髋前举', role: 'hipR', axis: 0, min: -110, max: 60 },
    { label: '右髋外展', role: 'hipR', axis: 2, min: -70, max: 70 },
    { label: '右髋旋转', role: 'hipR', axis: 1, min: -70, max: 70 },
  ] },
  { title: '膝部', items: [
    { label: '左膝弯曲', role: 'kneeL', axis: 0, min: -5, max: 140 },
    { label: '右膝弯曲', role: 'kneeR', axis: 0, min: -5, max: 140 },
  ] },
]

const presetById = new Map(POSE_PRESETS.map((preset) => [preset.id, preset]))

export function CharacterPropertiesPanel({ character, onPatch, timelineMode = false }: Props) {
  const isProp = getLibraryItem(character.modelId)?.kind !== 'body'
  const [tab, setTab] = React.useState<'props' | 'pose' | 'trajectory'>('props')
  const effectiveTab = isProp || (!timelineMode && tab === 'trajectory') ? 'props' : tab
  const pose = (character.pose ?? {}) as Record<string, [number, number, number]>

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
        <Section title="位置"><Vec3Row value={character.position} onChange={(value) => onPatch({ position: value })} /></Section>
        <Section title="旋转"><Vec3Row value={character.rotation} onChange={(value) => onPatch({ rotation: value })} /></Section>
        <Section title="缩放"><Vec3Row value={character.scale} onChange={(value) => onPatch({ scale: value })} /></Section>
        <Section title="统一缩放"><SliderField value={character.uniformScale} min={0.2} max={3} step={0.01} onChange={(value) => onPatch({ uniformScale: value })} /></Section>
        <Section title="颜色"><input type="color" value={character.colorHex} onChange={(event) => onPatch({ colorHex: event.target.value })} style={{ width: 52, height: 30, border: '1px solid #333', borderRadius: 6, background: 'transparent' }} /></Section>
      </> : effectiveTab === 'pose' ? <>
        <Section title="姿势预设">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
            {LIBTV_POSES.map((entry) => {
              const active = character.posePresetId === entry.sourceId
              return <button key={entry.label} onClick={() => applyPreset(entry)} style={{ minHeight: 36, borderRadius: 6, border: `1px solid ${active ? '#e5e5e5' : '#333'}`, background: active ? '#404040' : '#242424', color: active ? '#fff' : '#bfbfbf', fontSize: 11, cursor: 'pointer' }}>{entry.label}</button>
            })}
          </div>
        </Section>
        {GROUPS.map((group) => <Section key={group.title} title={group.title}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {group.items.map((item) => <div key={item.label}>
              <div style={{ marginBottom: 3, color: '#a3a3a3', fontSize: 11 }}>{item.label}</div>
              <SliderField value={toDeg(pose[item.role]?.[item.axis] ?? 0)} min={item.min} max={item.max} step={1} onChange={(value) => setJoint(item, value)} />
            </div>)}
          </div>
        </Section>)}
        <div style={{ padding: '8px 16px' }}><button onClick={() => onPatch({ pose: undefined, posePresetId: undefined, motion: undefined, motionClip: undefined, motionSequence: undefined })} style={{ width: '100%', padding: '8px 0', borderRadius: 6, border: '1px solid #333', background: '#242424', color: '#bfbfbf', cursor: 'pointer' }}>重置姿势</button></div>
      </> : <div style={{ padding: 16, color: '#8c8c8c', fontSize: 12, lineHeight: 1.6 }}>在下方时间轴中选择角色轨道，并使用“绘制轨迹”设置角色运动路径。</div>}
    </div>
  )
}
