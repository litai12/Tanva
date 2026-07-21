// @ts-nocheck
import React from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, Html, Splat, Image as DreiImage } from '@react-three/drei'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import type { CharacterObj } from '../types'
import { getLibraryItem, type PropShape } from '../assets'
import { calibrateRig, applyPoseToRig, applyPosePartialToRig, POSE_PRESETS, type RigState, type PoseMap, type JointRole } from '../state/pose'
import { buildWaveClip } from './waveClip'
import { samplePoseClipAt, type PoseClip } from '../state/poseClip'
import { findCustomMotion } from '../state/motionLibrary'
import { findMotionPreset, concatMotionPresets } from '../state/motionPresets'
import { sampleCharacterMotionAt, type CharacterMotion } from '../state/characterMotion'
import { registerGaussianGround, sampleGaussianGroundHeight, unregisterGaussianGround } from '../state/gaussianGround'

export type CharacterMixerEntry = {
  mixer: THREE.AnimationMixer
  actions: Record<string, THREE.AnimationAction>
  /** 统一动作应用：内置 clip 走 mixer.setTime；自定义动作(id)走 PoseClip 插值；无则回静态姿势。 */
  applyMotion: (motionClip: string | undefined, timeSec: number) => void
  /** 混合分层动作：baked 腿 + 上半身姿势盖回（根 transform 由外层 group 处理）。 */
  applyComposedMotion: (motion: CharacterMotion, tAbs: number) => void
}

export type FootGroundingDiagnostic = {
  side: 'L' | 'R'
  locked: boolean
  verticalError: number
  signedVerticalError: number
  horizontalError: number
  lockHorizontalError: number
  normalAngleErrorDeg: number
  finite: boolean
}

/**
 * 退化 pose clip 阈值：Mixamo「单帧 pose」(如 sad_pose/sneak_pose) 导出成 2 关键帧 bind→pose、
 * 时长 ~0.07s。这类是静态姿势，不能当连续动画 LoopRepeat 播(会在 bind↔pose 间高频闪烁)。
 * 时长低于此值 → LoopOnce + 定格姿势末帧。最短真动画 run≈0.70s，0.25 阈值安全分隔。
 */
const POSE_CLIP_MAX_SECONDS = 0.25
// 面板预览循环：一次性预设播完后，末帧停留这么久再重播（让"出拳→收"读得出节拍，不是无缝硬接）。
const PREVIEW_LOOP_HOLD_SEC = 0.5

/** 显式 pose 优先（用户/进阶覆盖），否则按 posePresetId 解析预设 */
export function resolveCharacterPose(character: Pick<CharacterObj, 'pose' | 'posePresetId'>): PoseMap | undefined {
  if (character.pose && Object.keys(character.pose).length > 0) return character.pose as PoseMap
  if (character.posePresetId) return POSE_PRESETS.find((p) => p.id === character.posePresetId)?.pose
  return undefined
}

type Props = {
  character: CharacterObj
  selected: boolean
  showLabel?: boolean
  /** 场景级自定义动作库（节点数据），character.motionClip 引用其 id 时从这里解析 */
  customMotions?: PoseClip[]
  onSelect: () => void
  /** 选中态（导演视角）下显示可点选关节球，点选后由 Viewport 挂 rotate gizmo 直掰骨骼 */
  jointEditing?: boolean
  selectedJointRole?: JointRole | null
  onPickJoint?: (role: JointRole) => void
  /** 骨架标定完成/卸载时上报 rig，供 Viewport 把 gizmo 挂到具体骨骼 */
  onRigChange?: (rig: RigState | null) => void
  /** 上报角色根 group，供 Viewport 把变换 gizmo 直接挂在实体上（拖拽实时所见即所得） */
  onGroupChange?: (group: THREE.Group | null) => void
  /** 上报骨骼动画 mixer/actions，供 capture 离屏逐帧 setTime 驱动 */
  onMixerChange?: (entry: CharacterMixerEntry | null) => void
  onFootGroundingDiagnostic?: (diagnostic: FootGroundingDiagnostic) => void
  showMotionDirectionHelper?: boolean
  /** 播放动画预览：true → GltfBody 驱动腿+上半身 + 外层 group 沿路径行进；false → 静态 */
  motionPreviewPlaying?: boolean
  /** 给定(≥0)时按此【绝对时间】采样动画与根行进（与全局时间线播放头同步）；否则内部自循环。 */
  motionDriveTime?: number | null
}

function Label({ name, selected }: { name: string; selected: boolean }) {
  return (
    <Html position={[0, 2.05, 0]} center distanceFactor={8} style={{ pointerEvents: 'none' }}>
      <div style={{ fontSize: 12, color: selected ? '#fff' : '#cdd3dc', whiteSpace: 'nowrap', textShadow: '0 1px 2px #000' }}>{name}</div>
    </Html>
  )
}

const _markerInv = new THREE.Matrix4()
const _markerPos = new THREE.Vector3()

/**
 * 可点选关节球：每帧把球同步到骨骼世界位置（骨骼姿势/拖拽实时跟随）。
 * userData.directorHelper 标记让截图时与 gizmo 一起隐藏，不进出图。
 * 注意：球大多藏在身体网格内部，射线总是先命中体表，球自己的 onClick 收不到事件——
 * 点选逻辑在外层 group 的 onClick 里扫 e.intersections（按 userData.jointRole 识别）。
 */
function JointMarkers({ rig, selectedRole }: { rig: RigState; selectedRole?: JointRole | null }) {
  const groupRef = React.useRef<THREE.Group>(null)
  const meshRefs = React.useRef(new Map<JointRole, THREE.Mesh>())
  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    g.updateWorldMatrix(true, false)
    _markerInv.copy(g.matrixWorld).invert()
    for (const [role, j] of Object.entries(rig.joints) as [JointRole, RigState['joints'][JointRole]][]) {
      const mesh = meshRefs.current.get(role)
      if (!mesh || !j) continue
      j.bone.updateWorldMatrix(true, false)
      mesh.position.copy(_markerPos.setFromMatrixPosition(j.bone.matrixWorld).applyMatrix4(_markerInv))
    }
  })
  return (
    <group ref={groupRef} userData={{ directorHelper: true }}>
      {(Object.keys(rig.joints) as JointRole[]).map((role) => (
        <mesh
          key={role}
          ref={(m) => { if (m) meshRefs.current.set(role, m); else meshRefs.current.delete(role) }}
          renderOrder={999}
          userData={{ jointRole: role }}
        >
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshBasicMaterial color={selectedRole === role ? '#ffd166' : '#4d9fff'} transparent opacity={selectedRole === role ? 1 : 0.8} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}

/** 加载独立蒙皮素体（SkeletonUtils 安全克隆骨骼，染成素体色，按 heightM 统一量纲并落地居中）。 */
type FootGroundingConfig = { groundHeight: number; gaussianEnabled: boolean; weight: number; lockEnabled: boolean; lockDistance: number; releaseDistance: number; soleOffset: number; slopeWeight: number }
type FootContactState = Record<'L' | 'R', { locked: boolean; targetScene: THREE.Vector3; plantGroundY: number }>
type WeightedFootVertices = Array<{ mesh: THREE.SkinnedMesh; indices: number[] }>
const footVertexCache = new WeakMap<THREE.Object3D, Record<'L' | 'R', WeightedFootVertices>>()

function collectWeightedFootVertices(cloned: THREE.Object3D, rig: RigState): Record<'L' | 'R', WeightedFootVertices> {
  const cached = footVertexCache.get(cloned)
  if (cached) return cached
  const result: Record<'L' | 'R', WeightedFootVertices> = { L: [], R: [] }
  for (const side of ['L', 'R'] as const) {
    const foot = rig.roles[`foot${side}` as 'footL' | 'footR']
    if (!foot) continue
    cloned.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh || !mesh.skeleton) return
      const controlledBones = new Set<number>()
      mesh.skeleton.bones.forEach((bone, index) => {
        let cursor: THREE.Object3D | null = bone
        while (cursor) {
          if (cursor === foot) { controlledBones.add(index); break }
          cursor = cursor.parent
        }
      })
      if (!controlledBones.size) return
      const skinIndex = mesh.geometry.getAttribute('skinIndex')
      const skinWeight = mesh.geometry.getAttribute('skinWeight')
      const position = mesh.geometry.getAttribute('position')
      if (!skinIndex || !skinWeight || !position) return
      const indices: number[] = []
      for (let index = 0; index < position.count; index++) {
        let controlledWeight = 0
        for (let component = 0; component < 4; component++) {
          const boneIndex = skinIndex.getComponent(index, component)
          if (controlledBones.has(boneIndex)) controlledWeight += skinWeight.getComponent(index, component)
        }
        // Exclude boundary vertices mainly owned by calf/shin bones while
        // retaining toes and shoe geometry parented below the foot joint.
        if (controlledWeight >= 0.5) indices.push(index)
      }
      if (indices.length) result[side].push({ mesh, indices })
    })
  }
  footVertexCache.set(cloned, result)
  return result
}

const _soleVertex = new THREE.Vector3()
function sampleFootSoleSceneY(entries: WeightedFootVertices, sceneGroup: THREE.Object3D, fallback: number): number {
  let minimum = Infinity
  for (const { mesh, indices } of entries) {
    for (const index of indices) {
      mesh.getVertexPosition(index, _soleVertex)
      mesh.localToWorld(_soleVertex)
      sceneGroup.worldToLocal(_soleVertex)
      if (_soleVertex.y < minimum) minimum = _soleVertex.y
    }
  }
  return Number.isFinite(minimum) ? minimum : fallback
}

function solveFootGrounding(cloned: THREE.Object3D, rig: RigState, config: FootGroundingConfig, contacts: FootContactState, onDiagnostic?: (diagnostic: FootGroundingDiagnostic) => void) {
  const characterGroup = cloned.parent
  const sceneGroup = characterGroup?.parent
  if (!characterGroup || !sceneGroup) return
  sceneGroup.updateWorldMatrix(true, true)
  const heightAt = (x: number, z: number, fallbackY: number) => config.gaussianEnabled
    ? sampleGaussianGroundHeight(x, z, fallbackY) ?? config.groundHeight
    : config.groundHeight
  const solveLeg = (side: 'L' | 'R') => {
    const hip = rig.roles[`hip${side}` as 'hipL' | 'hipR']
    const knee = rig.roles[`knee${side}` as 'kneeL' | 'kneeR']
    const foot = rig.roles[`foot${side}` as 'footL' | 'footR']
    if (!hip || !knee || !foot) return
    cloned.updateWorldMatrix(true, true)
    const footWorld = foot.getWorldPosition(new THREE.Vector3())
    const footScene = sceneGroup.worldToLocal(footWorld.clone())
    const rawGroundY = heightAt(footScene.x, footScene.z, footScene.y) + config.soleOffset
    const weightedVertices = collectWeightedFootVertices(cloned, rig)[side]
    const soleSceneY = sampleFootSoleSceneY(weightedVertices, sceneGroup, footScene.y)
    // The foot-bone pivot differs by up to several centimetres between the
    // eight source rigs. Move that pivot by the measured mesh-sole error,
    // instead of incorrectly forcing the pivot itself onto the ground.
    const desiredFootBoneY = footScene.y + rawGroundY - soleSceneY
    const contact = contacts[side]
    const footDistance = Math.abs(soleSceneY - rawGroundY)
    if (config.lockEnabled) {
      if (!contact.locked && footDistance <= config.lockDistance) {
        contact.locked = true
        contact.targetScene.set(footScene.x, desiredFootBoneY, footScene.z)
        contact.plantGroundY = rawGroundY
      } else if (contact.locked) {
        // Release against the cached planted point in full 3D. Checking only
        // vertical distance lets a moving character drag a support foot metres
        // behind while it remains at roughly the same ground height.
        const lockedGroundY = heightAt(contact.targetScene.x, contact.targetScene.z, contact.plantGroundY) + config.soleOffset
        const lockedBoneY = contact.targetScene.y + lockedGroundY - contact.plantGroundY
        const distanceFromPlant = footScene.distanceTo(new THREE.Vector3(contact.targetScene.x, lockedBoneY, contact.targetScene.z))
        if (distanceFromPlant >= config.releaseDistance) contact.locked = false
      }
    } else contact.locked = false
    let targetScene = contact.locked
      ? contact.targetScene.clone().setY(contact.targetScene.y + heightAt(contact.targetScene.x, contact.targetScene.z, contact.plantGroundY) + config.soleOffset - contact.plantGroundY)
      : new THREE.Vector3(footScene.x, desiredFootBoneY, footScene.z)
    let targetWorld = sceneGroup.localToWorld(targetScene.clone())
    // CCD on the known hip→knee→foot chain. Four passes converge for the
    // small terrain corrections while retaining the mixer's planted X/Z.
    const solveToTarget = () => {
      for (let pass = 0; pass < 8; pass++) {
        for (const joint of [knee, hip]) {
          cloned.updateWorldMatrix(true, true)
          const jointWorld = joint.getWorldPosition(new THREE.Vector3())
          const effectorWorld = foot.getWorldPosition(new THREE.Vector3())
          const toEffector = effectorWorld.sub(jointWorld).normalize()
          const toTarget = targetWorld.clone().sub(jointWorld).normalize()
          if (!Number.isFinite(toEffector.x) || !Number.isFinite(toTarget.x)) continue
          const deltaWorld = new THREE.Quaternion().setFromUnitVectors(toEffector, toTarget)
          deltaWorld.slerp(new THREE.Quaternion(), 1 - Math.max(0, Math.min(1, config.weight)))
          const parentWorld = joint.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
          const deltaLocal = parentWorld.clone().invert().multiply(deltaWorld).multiply(parentWorld)
          joint.quaternion.premultiply(deltaLocal).normalize()
        }
      }
    }
    solveToTarget()
    if (contact.locked) {
      cloned.updateWorldMatrix(true, true)
      const preliminaryFoot = sceneGroup.worldToLocal(foot.getWorldPosition(new THREE.Vector3()))
      const preliminaryHorizontalError = Math.hypot(preliminaryFoot.x - targetScene.x, preliminaryFoot.z - targetScene.z)
      if (preliminaryHorizontalError > config.lockDistance * 0.5) {
        // The planted point is outside the leg's reachable set after root
        // slope compensation. Release rather than stretching the leg toward
        // an impossible stale contact, then solve a fresh vertical contact.
        contact.locked = false
        const preliminarySoleY = sampleFootSoleSceneY(weightedVertices, sceneGroup, preliminaryFoot.y)
        const freshGroundY = heightAt(preliminaryFoot.x, preliminaryFoot.z, preliminarySoleY) + config.soleOffset
        targetScene = new THREE.Vector3(preliminaryFoot.x, preliminaryFoot.y + freshGroundY - preliminarySoleY, preliminaryFoot.z)
        targetWorld = sceneGroup.localToWorld(targetScene.clone())
        solveToTarget()
      }
    }
    // Align the sole's up axis to the local terrain normal after the leg has
    // reached the contact point; preserve the animated forward/twist axes.
    cloned.updateWorldMatrix(true, true)
    const e = 0.06
    const hx = heightAt(footScene.x + e, footScene.z, targetScene.y) - heightAt(footScene.x - e, footScene.z, targetScene.y)
    const hz = heightAt(footScene.x, footScene.z + e, targetScene.y) - heightAt(footScene.x, footScene.z - e, targetScene.y)
    const normalScene = new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize()
    const normalWorld = normalScene.transformDirection(sceneGroup.matrixWorld)
    const footUpWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(foot.getWorldQuaternion(new THREE.Quaternion())).normalize()
    const soleDeltaWorld = new THREE.Quaternion().setFromUnitVectors(footUpWorld, normalWorld)
    soleDeltaWorld.slerp(new THREE.Quaternion(), 1 - Math.max(0, Math.min(1, config.slopeWeight)))
    const parentWorld = foot.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
    foot.quaternion.premultiply(parentWorld.clone().invert().multiply(soleDeltaWorld).multiply(parentWorld)).normalize()
    cloned.updateWorldMatrix(true, true)
    const solvedScene = sceneGroup.worldToLocal(foot.getWorldPosition(new THREE.Vector3()))
    const solvedSoleY = sampleFootSoleSceneY(weightedVertices, sceneGroup, solvedScene.y)
    const solvedGroundY = heightAt(solvedScene.x, solvedScene.z, solvedSoleY) + config.soleOffset
    const solvedFootUp = new THREE.Vector3(0, 1, 0).applyQuaternion(foot.getWorldQuaternion(new THREE.Quaternion())).normalize()
    const dx = solvedScene.x - targetScene.x
    const dz = solvedScene.z - targetScene.z
    onDiagnostic?.({
      side,
      locked: contact.locked,
      verticalError: Math.abs(solvedSoleY - solvedGroundY),
      signedVerticalError: solvedSoleY - solvedGroundY,
      horizontalError: Math.hypot(dx, dz),
      lockHorizontalError: contact.locked ? Math.hypot(dx, dz) : 0,
      normalAngleErrorDeg: THREE.MathUtils.radToDeg(solvedFootUp.angleTo(normalWorld)),
      finite: [...solvedScene.toArray(), ...hip.quaternion.toArray(), ...knee.quaternion.toArray(), ...foot.quaternion.toArray()].every(Number.isFinite),
    })
  }
  solveLeg('L')
  solveLeg('R')
}

function GltfBody({ url, colorHex, heightM, pose, motionClip, customMotions, characterMotion, motionDriveTime, footGrounding, jointEditing, selectedJointRole, onRigChange, onMixerChange, onFootGroundingDiagnostic }: {
  url: string; colorHex: string; heightM: number; pose?: PoseMap; motionClip?: string; customMotions?: PoseClip[]
  characterMotion?: CharacterMotion
  /** 给定(≥0)时按此【绝对时间】采样动画（与全局播放头同步），否则内部自循环。 */
  motionDriveTime?: number | null
  footGrounding?: FootGroundingConfig
  jointEditing?: boolean; selectedJointRole?: JointRole | null; onRigChange?: (rig: RigState | null) => void
  onMixerChange?: (entry: CharacterMixerEntry | null) => void
  onFootGroundingDiagnostic?: (diagnostic: FootGroundingDiagnostic) => void
}) {
  const { scene, animations } = useGLTF(url)
  const rigState = React.useRef<RigState | null>(null)
  const cloned = React.useMemo(() => {
    const c = skeletonClone(scene)
    c.traverse((o) => {
      const mesh = o as THREE.Mesh
      if ((mesh as any).isMesh) {
        mesh.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.6, metalness: 0.05 })
      }
    })
    // 归一化：按包围盒高度缩放到 heightM
    c.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(c)
    const size = new THREE.Vector3(); box.getSize(size)
    const k = size.y > 0.0001 ? heightM / size.y : 1
    c.scale.setScalar(k)
    // 缩放后重新量，脚落到 y=0、水平居中
    c.updateMatrixWorld(true)
    const box2 = new THREE.Box3().setFromObject(c)
    const center = new THREE.Vector3(); box2.getCenter(center)
    c.position.x -= center.x
    c.position.z -= center.z
    c.position.y -= box2.min.y
    return c
  }, [scene, colorHex, heightM])

  // 标定骨架（关节映射 + 绑定姿态 + 解剖学规范坐标系，pose.ts）必须在【已提交】的 cloned 上做：
  // React StrictMode 双调 useMemo 工厂，在工厂内写 ref 会让 rig 指向被丢弃的那份克隆 →
  // 姿势/动作全打在孤儿骨架上，渲染中的素体纹丝不动、关节点脱离(2026-07-15 已踩)。
  // useLayoutEffect 在提交后、passive effect(应用姿势)之前运行，时序安全。
  React.useLayoutEffect(() => {
    rigState.current = calibrateRig(cloned)
    return () => { rigState.current = null }
  }, [cloned])

  // 骨骼动画：在克隆骨架上建 mixer + 按 clip 名建 action（内嵌 7 段 + 程序化 wave）。
  // 交互态不 play/不 update —— 只在 capture 离屏逐帧由 Viewport setTime 驱动。
  const mixerEntry = React.useMemo(() => {
    const mixer = new THREE.AnimationMixer(cloned)
    const actions: Record<string, THREE.AnimationAction> = {}
    const allClips = [...animations, buildWaveClip(cloned)]
    for (const clip of allClips) {
      const action = mixer.clipAction(clip)
      // 退化 pose clip（sad_pose/sneak_pose 等）是静态姿势，LoopOnce+定格末帧，禁 LoopRepeat 防 bind↔pose 闪烁
      const isPoseClip = clip.duration < POSE_CLIP_MAX_SECONDS
      action.loop = isPoseClip ? THREE.LoopOnce : THREE.LoopRepeat
      action.clampWhenFinished = isPoseClip
      action.enabled = false
      actions[clip.name] = action
    }
    return { mixer, actions }
  }, [cloned, animations])

  // 应用静态姿势（仅无 motionClip 时；有动作时由 applyMotion 驱动，避免打架）
  React.useEffect(() => {
    if (!motionClip && rigState.current) applyPoseToRig(cloned, rigState.current, pose)
  }, [pose, cloned, motionClip])

  // 统一动作应用：内置 mixer clip 走 setTime；自定义动作(id)从库解析成 PoseClip 插值 + applyPoseToRig；
  // 无则停动画回静态姿势。live 预览(累计时长)与 capture 渲染(每帧 motionTimeSec)共用。
  const poseRef = React.useRef(pose); poseRef.current = pose
  const customMotionsRef = React.useRef(customMotions); customMotionsRef.current = customMotions
  const applyMotion = React.useCallback((mc: string | undefined, t: number) => {
    const me = mixerEntry
    if (mc && me.actions[mc]) {
      const a = me.actions[mc]
      if (!a.isRunning()) { for (const x of Object.values(me.actions)) x.enabled = false; a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.play() }
      // pose clip（退化 bind→pose 短 clip）定格到姿势末帧、不随时间循环；连续动画照常 setTime(t)
      const clipDur = a.getClip().duration
      me.mixer.setTime(clipDur < POSE_CLIP_MAX_SECONDS ? clipDur : t)
      return
    }
    if (mc) {
      // 动作 clip 解析顺序：场景级 customMotions(节点数据/小T 生成) → 内置动画预设(motionPresets) → localStorage 自定义
      const clip = customMotionsRef.current?.find((m) => m.id === mc) ?? findMotionPreset(mc) ?? findCustomMotion(mc) ?? null
      if (clip && rigState.current) { applyPoseToRig(cloned, rigState.current, samplePoseClipAt(clip, t)); return }
    }
    for (const a of Object.values(me.actions)) a.stop()
    if (rigState.current) applyPoseToRig(cloned, rigState.current, poseRef.current)
  }, [mixerEntry, cloned])

  const applyComposedMotion = React.useCallback((motion: CharacterMotion, tAbs: number) => {
    const me = mixerEntry
    const s = sampleCharacterMotionAt(motion, tAbs)
    // 1) baked 腿/全身
    if (s.bakedClip && me.actions[s.bakedClip]) {
      const a = me.actions[s.bakedClip]
      if (!a.isRunning()) { for (const x of Object.values(me.actions)) x.enabled = false; a.reset(); a.enabled = true; a.setEffectiveWeight(1); a.play() }
      me.mixer.setTime(s.bakedTimeSec ?? 0)
    } else {
      for (const a of Object.values(me.actions)) a.stop()
    }
    // 2) 上半身姿势盖回（或整身，由 mask 决定）；有 baked 时跳过自动落地
    if (rigState.current) {
      applyPosePartialToRig(cloned, rigState.current, s.pose, s.poseMask, { autoLand: !s.bakedClip })
    }
  }, [mixerEntry, cloned])

  // 上报 mixer + applyMotion 给 Viewport（capture 逐帧调 applyMotion/applyComposedMotion）
  const reportedEntry = React.useMemo<CharacterMixerEntry>(() => ({ mixer: mixerEntry.mixer, actions: mixerEntry.actions, applyMotion, applyComposedMotion }), [mixerEntry, applyMotion, applyComposedMotion])
  const onMixerChangeRef = React.useRef(onMixerChange)
  onMixerChangeRef.current = onMixerChange
  React.useEffect(() => {
    onMixerChangeRef.current?.(reportedEntry)
    return () => onMixerChangeRef.current?.(null)
  }, [reportedEntry])

  // 实时预览：characterMotion 优先走合成器；否则 motionClip 走 applyMotion 原路径
  const motionRef = React.useRef(motionClip); motionRef.current = motionClip
  const elapsedRef = React.useRef(0)
  const characterMotionRef = React.useRef(characterMotion); characterMotionRef.current = characterMotion
  const driveTimeRef = React.useRef(motionDriveTime); driveTimeRef.current = motionDriveTime
  const previewElapsedRef = React.useRef(0)
  const footContactsRef = React.useRef<FootContactState>({
    L: { locked: false, targetScene: new THREE.Vector3(), plantGroundY: 0 },
    R: { locked: false, targetScene: new THREE.Vector3(), plantGroundY: 0 },
  })
  useFrame((_, delta) => {
    if (characterMotionRef.current) {
      const dt = driveTimeRef.current
      if (dt != null && dt >= 0) {
        // 与全局播放头同步：按绝对时间采样，并【钳到本片段时长】——超出轨道长度冻结在末帧，不再循环
        const dur = Math.max(0.5, characterMotionRef.current.durationSeconds)
        applyComposedMotion(characterMotionRef.current, Math.min(dt, dur))
        if (rigState.current && footGrounding) solveFootGrounding(cloned, rigState.current, footGrounding, footContactsRef.current, onFootGroundingDiagnostic)
        return
      }
      previewElapsedRef.current += delta
      applyComposedMotion(characterMotionRef.current, previewElapsedRef.current)
      if (rigState.current && footGrounding) solveFootGrounding(cloned, rigState.current, footGrounding, footContactsRef.current, onFootGroundingDiagnostic)
      return
    }
    const mc = motionRef.current
    if (!mc) { elapsedRef.current = 0; return }
    const drivenTime = driveTimeRef.current
    if (drivenTime != null && drivenTime >= 0) {
      applyMotion(mc, drivenTime)
      // 时间线/轨迹预览走绝对时间驱动时同样必须执行贴地求解。
      // 之前这里直接 return，导致最常用的自动 walk/run 路径只播骨骼动画，
      // 却绕过了 Gaussian 高度、锁脚与坡面脚掌对齐。
      if (rigState.current && footGrounding) solveFootGrounding(cloned, rigState.current, footGrounding, footContactsRef.current, onFootGroundingDiagnostic)
      return
    }
    elapsedRef.current += delta
    // 【面板预览统一循环·补动】一次性预设(loop=false)播完会冻结成静态(看着像"站立不动")。
    // 预览里把 elapsed 折回 [0, dur+hold]：动作播完、末帧停 hold 秒、再重播——浏览预设时个个都在动。
    // 不影响时间线/出片：那条走 applyMotion(显式 t)+samplePoseClipAt，仍尊重各预设的 loop 语义。
    const previewDur = (() => {
      const clip = customMotionsRef.current?.find((m) => m.id === mc) ?? findMotionPreset(mc) ?? findCustomMotion(mc)
      return clip ? Math.max(0.1, clip.durationSeconds) : 0 // 0 = 内置 mixer/GLB clip，交给 mixer 自循环，不外折
    })()
    const tPlay = previewDur > 0 ? elapsedRef.current % (previewDur + PREVIEW_LOOP_HOLD_SEC) : elapsedRef.current
    applyMotion(mc, tPlay)
    if (rigState.current && footGrounding) solveFootGrounding(cloned, rigState.current, footGrounding, footContactsRef.current, onFootGroundingDiagnostic)
  })

  // 上报 rig 给 Viewport（骨骼 gizmo 挂载点）；回调身份用 ref 解耦，只随模型重建触发
  const onRigChangeRef = React.useRef(onRigChange)
  onRigChangeRef.current = onRigChange
  React.useEffect(() => {
    onRigChangeRef.current?.(rigState.current)
    return () => onRigChangeRef.current?.(null)
  }, [cloned])

  return (
    <>
      <primitive object={cloned} />
      {jointEditing && rigState.current ? (
        <JointMarkers rig={rigState.current} selectedRole={selectedJointRole} />
      ) : null}
    </>
  )
}

function GaussianObject({ character, url }: { character: CharacterObj; url: string }) {
  React.useEffect(() => {
    void registerGaussianGround(character, url).catch(() => {})
    return () => unregisterGaussianGround(character.id)
  }, [character.id, character.position, character.rotation, character.scale, character.uniformScale, url])
  return <Splat src={url} />
}

/** 几何/家具道具：程序化组合几何体（blocking 占位风格，真实米制尺寸、底面落地 y=0），主色 + 暗部辅色区分结构 */
function PropObject({ shape, colorHex }: { shape: PropShape; colorHex: string }) {
  const darkHex = React.useMemo(() => `#${new THREE.Color(colorHex).multiplyScalar(0.7).getHexString()}`, [colorHex])
  const mat = <meshStandardMaterial color={colorHex} roughness={0.6} metalness={0.05} />
  const mat2 = <meshStandardMaterial color={darkHex} roughness={0.65} metalness={0.05} />
  // 四腿：xz 平面位置列表 + 腿高（中心 y = h/2）
  const legs = (xz: Array<[number, number]>, h: number, r: number) =>
    xz.map(([x, z], i) => (
      <mesh key={`leg${i}`} position={[x, h / 2, z]}>
        <cylinderGeometry args={[r, r, h, 10]} />
        {mat2}
      </mesh>
    ))
  switch (shape) {
    case 'box': return <mesh position={[0, 0.5, 0]}><boxGeometry args={[1, 1, 1]} />{mat}</mesh>
    case 'sphere': return <mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.5, 24, 24]} />{mat}</mesh>
    case 'cylinder': return <mesh position={[0, 0.6, 0]}><cylinderGeometry args={[0.4, 0.4, 1.2, 24]} />{mat}</mesh>
    case 'torus': return <mesh position={[0, 0.65, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.5, 0.14, 18, 48]} />{mat}</mesh>
    case 'cone': return <mesh position={[0, 0.6, 0]}><coneGeometry args={[0.5, 1.2, 24]} />{mat}</mesh>
    case 'pyramid': return <mesh position={[0, 0.6, 0]}><coneGeometry args={[0.62, 1.2, 4]} />{mat}</mesh>
    case 'plane': return <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.5, 1.5]} />{mat}</mesh>
    case 'table': return (
      <group>
        <mesh position={[0, 0.745, 0]}><boxGeometry args={[1.4, 0.05, 0.8]} />{mat}</mesh>
        {legs([[-0.62, -0.32], [0.62, -0.32], [-0.62, 0.32], [0.62, 0.32]], 0.72, 0.04)}
      </group>
    )
    case 'low-table': return (
      <group>
        <mesh position={[0, 0.43, 0]}><boxGeometry args={[1.0, 0.04, 0.6]} />{mat}</mesh>
        {legs([[-0.42, -0.24], [0.42, -0.24], [-0.42, 0.24], [0.42, 0.24]], 0.41, 0.03)}
      </group>
    )
    case 'chair': return (
      <group>
        <mesh position={[0, 0.425, 0]}><boxGeometry args={[0.45, 0.05, 0.45]} />{mat}</mesh>
        <mesh position={[0, 0.7, -0.2]}><boxGeometry args={[0.45, 0.5, 0.05]} />{mat}</mesh>
        {legs([[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]], 0.4, 0.025)}
      </group>
    )
    case 'stool': return (
      <group>
        <mesh position={[0, 0.425, 0]}><cylinderGeometry args={[0.18, 0.18, 0.05, 20]} />{mat}</mesh>
        <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.045, 0.045, 0.4, 12]} />{mat2}</mesh>
        <mesh position={[0, 0.015, 0]}><cylinderGeometry args={[0.14, 0.14, 0.03, 20]} />{mat2}</mesh>
      </group>
    )
    case 'sofa': return (
      <group>
        <mesh position={[0, 0.2, 0]}><boxGeometry args={[1.8, 0.4, 0.85]} />{mat}</mesh>
        <mesh position={[0, 0.625, -0.315]}><boxGeometry args={[1.8, 0.45, 0.22]} />{mat}</mesh>
        <mesh position={[-0.79, 0.525, 0]}><boxGeometry args={[0.22, 0.25, 0.85]} />{mat2}</mesh>
        <mesh position={[0.79, 0.525, 0]}><boxGeometry args={[0.22, 0.25, 0.85]} />{mat2}</mesh>
      </group>
    )
    case 'bed': return (
      // 床头朝 -Z
      <group>
        <mesh position={[0, 0.21, 0]}><boxGeometry args={[1.5, 0.22, 2.0]} />{mat2}</mesh>
        <mesh position={[0, 0.41, 0]}><boxGeometry args={[1.4, 0.18, 1.9]} />{mat}</mesh>
        <mesh position={[0, 0.575, -0.97]}><boxGeometry args={[1.5, 0.55, 0.06]} />{mat2}</mesh>
        <mesh position={[0, 0.545, -0.72]}><boxGeometry args={[0.55, 0.09, 0.32]} />{mat}</mesh>
        {legs([[-0.7, -0.93], [0.7, -0.93], [-0.7, 0.93], [0.7, 0.93]], 0.1, 0.04)}
      </group>
    )
    case 'cabinet': return (
      // 柜门朝 +Z
      <group>
        <mesh position={[0, 0.95, 0]}><boxGeometry args={[0.9, 1.9, 0.45]} />{mat}</mesh>
        <mesh position={[-0.2225, 0.95, 0.225]}><boxGeometry args={[0.42, 1.78, 0.03]} />{mat2}</mesh>
        <mesh position={[0.2225, 0.95, 0.225]}><boxGeometry args={[0.42, 1.78, 0.03]} />{mat2}</mesh>
        <mesh position={[-0.05, 0.95, 0.25]}><boxGeometry args={[0.025, 0.18, 0.025]} />{mat}</mesh>
        <mesh position={[0.05, 0.95, 0.25]}><boxGeometry args={[0.025, 0.18, 0.025]} />{mat}</mesh>
      </group>
    )
    case 'sideboard': return (
      <group>
        <mesh position={[0, 0.33, 0]}><boxGeometry args={[1.6, 0.5, 0.45]} />{mat}</mesh>
        <mesh position={[-0.39, 0.33, 0.225]}><boxGeometry args={[0.74, 0.42, 0.03]} />{mat2}</mesh>
        <mesh position={[0.39, 0.33, 0.225]}><boxGeometry args={[0.74, 0.42, 0.03]} />{mat2}</mesh>
        {legs([[-0.74, -0.18], [0.74, -0.18], [-0.74, 0.18], [0.74, 0.18]], 0.08, 0.03)}
      </group>
    )
    case 'shelf': return (
      // 开放书架，背板朝 -Z
      <group>
        <mesh position={[-0.45, 0.9, 0]}><boxGeometry args={[0.04, 1.8, 0.32]} />{mat}</mesh>
        <mesh position={[0.45, 0.9, 0]}><boxGeometry args={[0.04, 1.8, 0.32]} />{mat}</mesh>
        <mesh position={[0, 0.9, -0.15]}><boxGeometry args={[0.94, 1.8, 0.02]} />{mat2}</mesh>
        {[0.1, 0.52, 0.94, 1.36, 1.78].map((y) => (
          <mesh key={`shelf${y}`} position={[0, y, 0]}><boxGeometry args={[0.86, 0.03, 0.3]} />{mat}</mesh>
        ))}
      </group>
    )
    case 'lamp': return (
      <group>
        <mesh position={[0, 0.015, 0]}><cylinderGeometry args={[0.16, 0.16, 0.03, 20]} />{mat2}</mesh>
        <mesh position={[0, 0.755, 0]}><cylinderGeometry args={[0.018, 0.018, 1.45, 10]} />{mat2}</mesh>
        <mesh position={[0, 1.55, 0]}><cylinderGeometry args={[0.13, 0.2, 0.3, 20]} />{mat}</mesh>
      </group>
    )
    default: return null
  }
}

/** 无 GLB 时用分段人形 mannequin 占位（头/躯干/四肢），观感接近素体 */
function PlaceholderBody({ colorHex }: { colorHex: string }) {
  const mat = <meshStandardMaterial color={colorHex} roughness={0.55} metalness={0.05} />
  const limb = (key: string, pos: [number, number, number], len: number, r = 0.07) => (
    <mesh key={key} position={pos}>
      <capsuleGeometry args={[r, len, 4, 8]} />
      {mat}
    </mesh>
  )
  return (
    <group>
      {/* 头 */}
      <mesh position={[0, 1.62, 0]}><sphereGeometry args={[0.13, 20, 20]} />{mat}</mesh>
      {/* 颈 */}
      <mesh position={[0, 1.46, 0]}><cylinderGeometry args={[0.05, 0.06, 0.1, 12]} />{mat}</mesh>
      {/* 躯干 */}
      <mesh position={[0, 1.1, 0]}><capsuleGeometry args={[0.17, 0.5, 6, 14]} />{mat}</mesh>
      {/* 髋 */}
      <mesh position={[0, 0.78, 0]}><sphereGeometry args={[0.15, 16, 16]} />{mat}</mesh>
      {/* 上臂/前臂 */}
      {limb('lUpper', [-0.26, 1.18, 0], 0.32)}
      {limb('lFore', [-0.3, 0.82, 0], 0.3, 0.06)}
      {limb('rUpper', [0.26, 1.18, 0], 0.32)}
      {limb('rFore', [0.3, 0.82, 0], 0.3, 0.06)}
      {/* 大腿/小腿 */}
      {limb('lThigh', [-0.1, 0.5, 0], 0.42, 0.09)}
      {limb('lCalf', [-0.1, 0.05, 0], 0.4, 0.07)}
      {limb('rThigh', [0.1, 0.5, 0], 0.42, 0.09)}
      {limb('rCalf', [0.1, 0.05, 0], 0.4, 0.07)}
    </group>
  )
}

export function CharacterObject({ character, selected, showLabel = true, customMotions, onSelect, jointEditing, selectedJointRole, onPickJoint, onRigChange, onGroupChange, onMixerChange, onFootGroundingDiagnostic, showMotionDirectionHelper = true, motionPreviewPlaying, motionDriveTime, footGrounding }: Props & { footGrounding?: FootGroundingConfig }) {
  const item = getLibraryItem(character.modelId)
  const s = character.uniformScale
  // 稳定 ref 回调（inline 箭头会让 React 每次渲染都 detach/attach，上游 bump 会死循环）
  const onGroupChangeRef = React.useRef(onGroupChange)
  onGroupChangeRef.current = onGroupChange
  // 外层 group 双 ref：onGroupChange 上报 gizmo 系统（保持现有行为）+ outerRef 供根行进 useFrame 写位置/朝向
  const outerRef = React.useRef<THREE.Group | null>(null)
  const combinedRefCb = React.useCallback((g: THREE.Group | null) => { outerRef.current = g; onGroupChangeRef.current?.(g) }, [])

  // 根行进预览：playing + 有路径 → group 沿路径移动；停止 → elapsed 归零（JSX props 回写 position/rotation）
  const motionPreviewPlayingRef = React.useRef(motionPreviewPlaying)
  motionPreviewPlayingRef.current = motionPreviewPlaying
  const characterRef = React.useRef(character)
  characterRef.current = character
  const pathElapsedRef = React.useRef(0)
  const driveTimeRef = React.useRef(motionDriveTime); driveTimeRef.current = motionDriveTime
  useFrame((_, delta) => {
    const g = outerRef.current
    const ch = characterRef.current
    if (!g || !motionPreviewPlayingRef.current || !ch.motion) {
      pathElapsedRef.current = 0
      return
    }
    const duration = Math.max(0.5, ch.motion.durationSeconds)
    const dt = driveTimeRef.current
    let t: number
    if (dt != null && dt >= 0) {
      // 与全局播放头同步：根行进按绝对时间采样，并钳到片段时长——超出冻结在路径终点
      t = Math.min(dt, duration)
    } else {
      pathElapsedRef.current += delta
      t = pathElapsedRef.current % duration
    }
    const sm = sampleCharacterMotionAt(ch.motion, t)
    if (sm.rootXZ != null) {
      g.position.set(sm.rootXZ[0], ch.position[1], sm.rootXZ[1])
      if (sm.rootHeadingY !== undefined) g.rotation.y = sm.rootHeadingY
    }
  })

  // 【连招】motionSequence 非空 → 合成一条首尾相接的 PoseClip 注入 customMotions，作为有效 motionClip。
  // 复用既有 applyMotion 解析(先查 customMotions)+预览循环+capture 出片，全链路零改动；motion 仍最高优先。
  const seqClip = React.useMemo(() => concatMotionPresets(character.motionSequence), [character.motionSequence])
  const effectiveMotionClip = seqClip ? seqClip.id : character.motionClip
  const effectiveCustomMotions = React.useMemo(
    () => (seqClip ? [...(customMotions ?? []), seqClip] : customMotions),
    [seqClip, customMotions],
  )

  let body: React.ReactNode
  if (item?.kind === 'empty') {
    body = null
  } else if (item?.kind === 'gaussian') {
    body = <GaussianObject character={character} url={item.url} />
  } else if (item?.kind === 'reference') {
    body = <DreiImage url={item.url} scale={[3.2, 1.8]} position={[0, 0.9, 0]} transparent />
  } else if (item?.kind === 'prop') {
    body = <PropObject shape={item.shape} colorHex={character.colorHex} />
  } else if (item?.kind === 'body') {
    body = (
      <React.Suspense fallback={<PlaceholderBody colorHex={character.colorHex} />}>
        <GltfBody
          url={item.url} colorHex={character.colorHex} heightM={item.heightM} pose={resolveCharacterPose(character)} motionClip={effectiveMotionClip} customMotions={effectiveCustomMotions} characterMotion={motionPreviewPlaying ? character.motion : undefined} motionDriveTime={motionDriveTime} footGrounding={footGrounding}
          jointEditing={jointEditing} selectedJointRole={selectedJointRole} onRigChange={onRigChange} onMixerChange={onMixerChange} onFootGroundingDiagnostic={onFootGroundingDiagnostic}
        />
      </React.Suspense>
    )
  } else {
    body = <PlaceholderBody colorHex={character.colorHex} />
  }
  return (
    <group
      ref={combinedRefCb}
      position={character.position}
      rotation={character.rotation}
      scale={[character.scale[0] * s, character.scale[1] * s, character.scale[2] * s]}
      onClick={(e) => {
        e.stopPropagation()
        if (e.delta > 4) return // 环绕/gizmo 拖拽松手时 r3f 仍派发 click，按位移过滤
        if (jointEditing && onPickJoint) {
          // 关节球多藏在体内，射线先命中体表 → 在完整命中列表里找离首命中足够近的关节球
          const first = e.intersections[0]
          const hit = e.intersections.find((i) => i.object.userData?.jointRole)
          if (hit && first && hit.distance - first.distance < 0.4) {
            onPickJoint(hit.object.userData.jointRole as JointRole)
            return
          }
        }
        onSelect()
      }}
    >
      {body}
      {motionPreviewPlaying && showMotionDirectionHelper ? (
        // 朝向调试箭头：红锥指素体局部正前(+Z)，作为 group 子级随 heading 旋转 → 直观对照「身体朝向 vs 路径方向」。
        // userData.directorHelper 标记 → 渲染样片/截图时与其它 helper 一并隐藏，不进出图。
        <mesh position={[0, 1.0, 0.55]} rotation={[Math.PI / 2, 0, 0]} userData={{ directorHelper: true }} renderOrder={998}>
          <coneGeometry args={[0.13, 0.45, 14]} />
          <meshBasicMaterial color="#f43f5e" depthTest={false} transparent opacity={0.95} />
        </mesh>
      ) : null}
      {showLabel ? <Label name={character.name} selected={selected} /> : null}
    </group>
  )
}
