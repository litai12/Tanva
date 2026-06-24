import React from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, Html } from '@react-three/drei'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import type { CharacterObj } from '../types'
import { getLibraryItem, type PropShape } from '../assets'
import { calibrateRig, applyPoseToRig, POSE_PRESETS, type RigState, type PoseMap, type JointRole } from '../state/pose'

/** 显式 pose 优先（用户/进阶覆盖），否则按 posePresetId 解析预设 */
export function resolveCharacterPose(character: Pick<CharacterObj, 'pose' | 'posePresetId'>): PoseMap | undefined {
  if (!character.pose && !character.posePresetId) {
    return POSE_PRESETS.find((p) => p.id === 'arms-down')?.pose
  }
  if (character.pose && Object.keys(character.pose).length > 0) return character.pose as PoseMap
  if (character.posePresetId) return POSE_PRESETS.find((p) => p.id === character.posePresetId)?.pose
  return undefined
}

type Props = {
  character: CharacterObj
  selected: boolean
  onSelect: () => void
  /** 选中态（导演视角）下显示可点选关节球，点选后由 Viewport 挂 rotate gizmo 直掰骨骼 */
  jointEditing?: boolean
  selectedJointRole?: JointRole | null
  onPickJoint?: (role: JointRole) => void
  /** 骨架标定完成/卸载时上报 rig，供 Viewport 把 gizmo 挂到具体骨骼 */
  onRigChange?: (rig: RigState | null) => void
  /** 上报角色根 group，供 Viewport 把变换 gizmo 直接挂在实体上（拖拽实时所见即所得） */
  onGroupChange?: (group: THREE.Group | null) => void
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

/** 有 GLB 时加载素体（SkeletonUtils 安全克隆骨骼，染成素体色，按 heightM 归一化身高+落地+居中，widthScale 控体宽） */
function GltfBody({ url, colorHex, heightM, widthScale, pose, jointEditing, selectedJointRole, onRigChange }: {
  url: string; colorHex: string; heightM: number; widthScale: number; pose?: PoseMap
  jointEditing?: boolean; selectedJointRole?: JointRole | null; onRigChange?: (rig: RigState | null) => void
}) {
  const { scene } = useGLTF(url)
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
    c.scale.set(k * widthScale, k, k * widthScale)
    // 缩放后重新量，脚落到 y=0、水平居中
    c.updateMatrixWorld(true)
    const box2 = new THREE.Box3().setFromObject(c)
    const center = new THREE.Vector3(); box2.getCenter(center)
    c.position.x -= center.x
    c.position.z -= center.z
    c.position.y -= box2.min.y
    // 标定骨架：关节映射 + 绑定姿态 + 解剖学规范坐标系（pose.ts）
    rigState.current = calibrateRig(c)
    return c
  }, [scene, colorHex, heightM, widthScale])

  // 应用姿势：规范坐标系旋转 + 自动落地（pose.ts applyPoseToRig）
  React.useEffect(() => {
    if (rigState.current) applyPoseToRig(cloned, rigState.current, pose)
  }, [pose, cloned])

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
    case 'cone': return <mesh position={[0, 0.6, 0]}><coneGeometry args={[0.5, 1.2, 24]} />{mat}</mesh>
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

export function CharacterObject({ character, selected, onSelect, jointEditing, selectedJointRole, onPickJoint, onRigChange, onGroupChange }: Props) {
  const item = getLibraryItem(character.modelId)
  const s = character.uniformScale
  // 稳定 ref 回调（inline 箭头会让 React 每次渲染都 detach/attach，上游 bump 会死循环）
  const onGroupChangeRef = React.useRef(onGroupChange)
  onGroupChangeRef.current = onGroupChange
  const groupRefCb = React.useCallback((g: THREE.Group | null) => { onGroupChangeRef.current?.(g) }, [])
  let body: React.ReactNode
  if (item?.kind === 'prop') {
    body = <PropObject shape={item.shape} colorHex={character.colorHex} />
  } else if (item?.kind === 'body' && item.url) {
    body = (
      <React.Suspense fallback={<PlaceholderBody colorHex={character.colorHex} />}>
        <GltfBody
          url={item.url} colorHex={character.colorHex} heightM={item.heightM} widthScale={item.widthScale ?? 1} pose={resolveCharacterPose(character)}
          jointEditing={jointEditing} selectedJointRole={selectedJointRole} onRigChange={onRigChange}
        />
      </React.Suspense>
    )
  } else {
    body = <PlaceholderBody colorHex={character.colorHex} />
  }
  return (
    <group
      ref={groupRefCb}
      position={character.position}
      rotation={character.rotation}
      scale={[character.scale[0] * s, character.scale[1] * s, character.scale[2] * s]}
      onClick={(e) => {
        e.stopPropagation()
        if (e.delta > 4) return // 环绕/gizmo 拖拽松手时仍派发 click，按位移过滤
        if (jointEditing && onPickJoint) {
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
      <Label name={character.name} selected={selected} />
    </group>
  )
}
