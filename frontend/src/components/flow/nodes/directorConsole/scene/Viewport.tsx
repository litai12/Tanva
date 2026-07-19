// @ts-nocheck
import React from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Line, Grid, GizmoHelper, GizmoViewport, PerspectiveCamera, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import type { DirectorScene, CharacterObj, CameraObj, Vec3 } from '../types'
import { CharacterObject, resolveCharacterPose, type FootGroundingDiagnostic } from './CharacterObject'
import { CameraRig } from './CameraRig'
import { poseEulerFromRig, type JointRole, type RigState } from '../state/pose'
import { aspectRatio, captureSize } from '../state/aspect'
import { isPanoramaRatio, panoramaCanvasSize, adaptPanoramaPixels } from './panoramaAdapt'
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy'
import { resolveImageToBlob } from '@/utils/imageSource'
import { pathLength, samplePathAt } from '../state/groundPath'
import { snapPositionToGround } from '../state/gaussianGround'
import { applyResolvedCameraPose, resolveCameraPose } from '../state/cameraPose'
import { resolveTrajectoryGait, resolveTrajectoryMotion } from '../state/trajectoryMotion'

async function fetchProxiedImageBlob(url: string): Promise<Blob> {
  // Director 全景既可能是完整 OSS URL，也可能是 OSS key、历史 proxy
  // 包装或外部模型返回地址。统一解析器会依次尝试公开地址、同源代理和
  // 直连，避免 key 被误当成前端相对路径后静默显示黑色。
  const blob = await resolveImageToBlob(url, { preferProxy: true })
  if (blob) return blob
  const proxied = proxifyRemoteAssetUrl(url, { forceProxy: true })
  const res = await fetch(proxied)
  if (!res.ok) throw new Error(`fetch skybox failed: HTTP ${res.status}`)
  return res.blob()
}

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type ViewportHandle = {
  /** fovScale：画幅取景框可见时传 框高/视口高，垂直 FOV 收窄到框内 → 截图=框中所见（缺省 1 保持原行为） */
  captureView: (opts?: { fovScale?: number }) => string | null
  getCurrentCamera: () => { position: Vec3; lookAt: Vec3; fovDeg: number } | null
  resetView: () => void
}

const DIRECTOR_CAM_POS: Vec3 = [6, 4.5, 13]
const DIRECTOR_TARGET: Vec3 = [0, 1, 0]

type Props = {
  scene: DirectorScene
  viewpoint: 'director' | 'camera'
  selectedId?: string
  gizmoMode?: GizmoMode
  /** 全景背景图 URL（来自连入导演台左侧输入口的图片节点；优先于 scene.skybox 上传兜底） */
  skyboxUrl?: string
  onSelect: (id?: string) => void
  onPatchCharacter: (id: string, patch: Partial<CharacterObj>) => void
  onPatchCamera: (id: string, patch: Partial<CameraObj>) => void
  /** 离屏截图用：所有 useGLTF 模型加载完成（Suspense resolve）后触发一次 */
  onSceneReady?: () => void
  /** 路径绘制：active 时视口出现地面落点平面 + 路点把手 + 路径线（仅 director 视角） */
  pathDraw?: {
    active: boolean
    objectKind: 'character' | 'camera'
    waypoints: [number, number][]   // XZ
    mode: 'linear' | 'curve'
    groundY?: number
    gaussianGroundSnap?: boolean
    onAddWaypoint: (xz: [number, number]) => void
    onMoveWaypoint: (i: number, xz: [number, number]) => void
    selectedIndex?: number
    onSelectWaypoint?: (i: number) => void
  }
  /** Absolute property-timeline playhead; drives skeletal mixers deterministically. */
  animationTime?: number
  /** Acceptance/telemetry hook for the post-IK foot result. */
  onFootGroundingDiagnostic?: (characterId: string, diagnostic: FootGroundingDiagnostic) => void
}

function PathDrawLayer({ pd, scene, onDragStart, onDragEnd }: {
  pd: NonNullable<Props['pathDraw']>
  scene: DirectorScene
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const camera = useThree((s) => s.camera)
  const raycaster = useThree((s) => s.raycaster)
  const pointer = useThree((s) => s.pointer)
  const draggingRef = React.useRef<number | null>(null)
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const pathTransform = React.useMemo(() => {
    if (pd.objectKind === 'camera') return new THREE.Matrix4()
    const position = new THREE.Vector3(...(scene.scenePosition ?? [0, 0, 0]))
    const rotation = scene.sceneRotation ?? [0, 0, 0]
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rotation[0]),
      THREE.MathUtils.degToRad(rotation[1]),
      THREE.MathUtils.degToRad(rotation[2]),
    ))
    const scale = Math.max(0.01, scene.sceneScale ?? 3)
    return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(scale, scale, scale))
  }, [pd.objectKind, scene.scenePosition, scene.sceneRotation, scene.sceneScale])
  const inversePathTransform = React.useMemo(() => pathTransform.clone().invert(), [pathTransform])
  const plane = React.useMemo(() => (
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -(pd.groundY ?? 0)).applyMatrix4(pathTransform)
  ), [pd.groundY, pathTransform])
  const pointY = React.useCallback((x: number, z: number) => {
    if (pd.objectKind !== 'character' || !pd.gaussianGroundSnap) return pd.groundY ?? 0
    return snapPositionToGround([x, pd.groundY ?? 0, z], pd.groundY ?? 0, true)[1]
  }, [pd.objectKind, pd.gaussianGroundSnap, pd.groundY])
  const hitGround = React.useCallback((): [number, number] | null => {
    raycaster.setFromCamera(pointer, camera)
    const p = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, p)) return null
    p.applyMatrix4(inversePathTransform)
    return [p.x, p.z]
  }, [raycaster, pointer, camera, plane, inversePathTransform])

  const linePts = React.useMemo<[number, number, number][]>(() => {
    if (pd.waypoints.length < 2 || pd.mode === 'linear') return pd.waypoints.map((w) => [w[0], pointY(w[0], w[1]) + 0.02, w[1]])
    const path = { waypoints: pd.waypoints, mode: 'curve' as const }
    const N = 64
    const out: [number, number, number][] = []
    for (let i = 0; i <= N; i++) { const s = samplePathAt(path, i / N); out.push([s.pos[0], pointY(s.pos[0], s.pos[1]) + 0.02, s.pos[1]]) }
    return out
  }, [pd.waypoints, pd.mode, pointY])

  useFrame(() => {
    if (!pd.active) return
    const handles = pd.waypoints.map((waypoint, index) => {
      const world = new THREE.Vector3(waypoint[0], pointY(waypoint[0], waypoint[1]) + 0.12, waypoint[1]).applyMatrix4(pathTransform)
      const projected = world.project(camera)
      return { index, waypoint, x: (projected.x + 1) * size.width / 2, y: (1 - projected.y) * size.height / 2, visible: projected.z >= -1 && projected.z <= 1 }
    })
    window.dispatchEvent(new CustomEvent('director:trajectory-handles', { detail: { canvas: gl.domElement, handles } }))
  })

  return (
    <group
      matrix={pathTransform}
      matrixAutoUpdate={false}
      userData={{ directorHelper: true }}
    >
      {pd.active ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, pd.groundY ?? 0, 0]}
          onPointerDown={(e) => { e.stopPropagation(); if (draggingRef.current != null) return; const xz = hitGround(); if (xz) pd.onAddWaypoint(xz) }}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
      {linePts.length >= 2 ? <Line points={linePts} color="#22d3ee" lineWidth={2} /> : null}
      {pd.waypoints.map((w, i) => (
        <mesh
          key={i}
          position={[w[0], pointY(w[0], w[1]) + 0.12, w[1]]}
          onPointerDown={(e) => { e.stopPropagation(); draggingRef.current = i; onDragStart(); pd.onSelectWaypoint?.(i); const t = e.target as { setPointerCapture?: (id: number) => void }; t.setPointerCapture?.(e.pointerId) }}
          onPointerMove={(e) => { if (draggingRef.current !== i) return; e.stopPropagation(); const xz = hitGround(); if (xz) pd.onMoveWaypoint(i, xz) }}
          onPointerUp={(e) => { if (draggingRef.current === i) { draggingRef.current = null; onDragEnd(); const t = e.target as { releasePointerCapture?: (id: number) => void }; t.releasePointerCapture?.(e.pointerId) } }}
        >
          <sphereGeometry args={[0.13, 16, 16]} />
          <meshBasicMaterial color={pd.selectedIndex === i ? '#fbbf24' : '#22d3ee'} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}

type SceneContentsProps = Props & {
  groupsRef: React.MutableRefObject<Map<string, THREE.Group>>
}

/**
 * 给跨域取图加独立 cache-buster query：R2 源站本身允许 CORS（带 Origin 必返 ACAO），
 * 但同一张图常被 ManagedImage 用无 crossorigin 的 <img>（不带 Origin）先加载过，
 * Cloudflare/浏览器缓存了一份无 ACAO 的响应；后续 fetch(CORS) 命中脏缓存 → 被 CORS 拦。
 * 加一个仅本路径用到的 query key → 必经 CORS 请求填充 → 必带 ACAO，且与 <img> 缓存隔离。
 */
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('全景图加载失败'))
    img.src = url
  })
}

/** 非 2:1 图 → cover 铺满 2:1 画布 + seam/极点优化 → 穹顶纹理（吸收 storyai-3d-director-desk 全景管线） */
function buildBackdropTexture(img: HTMLImageElement): THREE.Texture | null {
  const { width, height } = panoramaCanvasSize(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#06080D'
  ctx.fillRect(0, 0, width, height)
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
  try {
    const frame = ctx.getImageData(0, 0, width, height)
    frame.data.set(adaptPanoramaPixels(frame.data, width, height))
    ctx.putImageData(frame, 0, 0)
  } catch {
    // getImageData 失败（极端环境/跨域污染）：退回未优化的 cover 结果，仍可用
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.repeat.set(-1, 1) // 从穹顶内侧看不镜像
  tex.offset.set(1, 0)
  return tex
}

type SkyboxState = { url: string; mode: 'equirect' | 'backdrop'; texture: THREE.Texture; width: number; height: number; luminance: number } | null

function measureImageLuminance(img: HTMLImageElement): number {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 16
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return -1
  try {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let total = 0
    for (let i = 0; i < pixels.length; i += 4) total += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722
    return Math.round((total / (pixels.length / 4)) * 10) / 10
  } catch {
    return -1
  }
}

/** 全景背景：~2:1 等距图设为天空盒；非 2:1 普通图自适应处理后贴 BackSide 穹顶（裸 equirect 会严重拉伸）。
 * yawDeg 水平旋转背景取景；清除/失败时恢复纯色。 */
function Skybox({ url, yawDeg, skyColor = '#060608', radius = 60 }: { url?: string; yawDeg?: number; skyColor?: string; radius?: number }) {
  const { scene, invalidate, camera } = useThree()
  const [state, setState] = React.useState<SkyboxState>(null)
  const sphereRef = React.useRef<THREE.Mesh>(null)
  // 天空球始终以当前视点为球心。否则用户缩放导演视角、把球半径调到
  // 10，或机位运动到球外后，BackSide 材质会从外侧完全不可见，只剩黑屏。
  useFrame(() => { sphereRef.current?.position.copy(camera.position) })

  React.useEffect(() => {
    if (!url) { setState(null); return }
    window.dispatchEvent(new CustomEvent('director:panorama-status', { detail: { url, status: 'loading' } }))
    let disposed = false
    let objUrl: string | null = null
    let created: THREE.Texture | null = null
    void (async () => {
      try {
        let loadUrl = url
        if (!/^blob:/i.test(url)) {
          const blob = await fetchProxiedImageBlob(url)
          if (disposed) return
          objUrl = URL.createObjectURL(blob)
          loadUrl = objUrl
        }
        const img = await loadImageElement(loadUrl)
        if (disposed) return
        const metrics = { width: img.naturalWidth, height: img.naturalHeight, luminance: measureImageLuminance(img) }
        if (isPanoramaRatio(img.naturalWidth, img.naturalHeight)) {
          const tex = new THREE.Texture(img)
          // 使用真实 BackSide 球体的 UV，而不是只依赖 scene.background。
          // 这样主视口、机位预览和离屏截图消费同一张可见球面贴图。
          tex.mapping = THREE.UVMapping
          tex.colorSpace = THREE.SRGBColorSpace
          tex.wrapS = THREE.RepeatWrapping
          tex.wrapT = THREE.ClampToEdgeWrapping
          tex.repeat.set(-1, 1)
          tex.offset.set(1, 0)
          tex.needsUpdate = true
          created = tex
          setState({ url, mode: 'equirect', texture: tex, ...metrics })
        } else {
          const tex = buildBackdropTexture(img)
          created = tex
          setState(tex ? { url, mode: 'backdrop', texture: tex, ...metrics } : null)
        }
        invalidate?.()
      } catch (error) {
        if (!disposed) {
          setState(null)
          console.error('[Director panorama] 全景纹理加载失败', { url, error })
          window.dispatchEvent(new CustomEvent('director:panorama-status', { detail: { url, status: 'error', message: error instanceof Error ? error.message : String(error) } }))
        }
      }
    })()
    return () => {
      disposed = true
      if (objUrl) URL.revokeObjectURL(objUrl)
      created?.dispose()
      setState(null)
    }
  }, [url, invalidate])

  const yawRad = (((yawDeg ?? 0) % 360) * Math.PI) / 180
  React.useEffect(() => {
    scene.background = new THREE.Color(skyColor)
    if (state && state.url === url) window.dispatchEvent(new CustomEvent('director:panorama-status', { detail: { url, status: 'ready', mode: state.mode, width: state.width, height: state.height, luminance: state.luminance } }))
    invalidate?.()
    return () => { scene.background = new THREE.Color(skyColor) }
  }, [state, url, yawDeg, skyColor, scene, invalidate])

  // 所有全景都渲染成真实内视球体。穹顶不参与拾取，否则点空处永远命中背景球。
  return state && state.url === url ? (
    <mesh ref={sphereRef} frustumCulled={false} renderOrder={-1000} rotation={[0, yawRad, 0]} raycast={() => null}>
      <sphereGeometry args={[Math.max(1, radius), 96, 64]} />
      <meshBasicMaterial map={state.texture} side={THREE.BackSide} depthWrite={false} toneMapped={false} />
    </mesh>
  ) : null
}

/** 机位视角始终消费与视锥、截图相同的 LibTV 相机姿态。 */
function ActiveCameraView({ cam, scene }: { cam: CameraObj; scene: DirectorScene }) {
  const ref = React.useRef<THREE.PerspectiveCamera>(null)
  useFrame(() => {
    const c = ref.current
    if (!c) return
    applyResolvedCameraPose(c, resolveCameraPose(cam, scene))
  })
  const pose = resolveCameraPose(cam, scene)
  return <PerspectiveCamera ref={ref} makeDefault position={pose.position} fov={pose.fovDeg} near={0.1} far={1000} />
}

/** Suspense 边界内的就绪探针：模型已 resolve 才会挂载，挂载后下一帧回调一次。
 * 后台标签页会冻结 rAF（离屏截图的 onReady 永不触发、busyRef 卡死），
 * 故与 setTimeout 兜底竞速：前台 rAF 先到行为不变，后台靠定时器兜底（截图走手动 gl.render，不依赖绘制帧）。 */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  const { invalidate } = useThree()
  React.useEffect(() => {
    if (!onReady) return
    let fired = false
    const fire = () => {
      if (fired) return
      fired = true
      onReady()
    }
    // GLTFs are local static assets and resolve inside CharacterObject's own
    // Suspense boundary. Waiting for a stable window avoids subscribing to
    // drei's global progress store, which can update ReadySignal while a
    // GltfBody is rendering under React 19.
    const timer = window.setTimeout(() => {
      invalidate()
      requestAnimationFrame(() => requestAnimationFrame(fire))
    }, 2500)
    // Background tabs freeze rAF; the watchdog-safe fallback fires after the
    // stable loading window even when no paint callbacks are scheduled.
    const fallback = window.setTimeout(fire, 3200)
    return () => { window.clearTimeout(timer); window.clearTimeout(fallback) }
  }, [onReady, invalidate])
  return null
}

function SceneContents({ scene, viewpoint, selectedId, gizmoMode = 'translate', skyboxUrl, pathDraw, animationTime, onSelect, onPatchCharacter, onPatchCamera, onFootGroundingDiagnostic, groupsRef }: SceneContentsProps) {
  const activeCam = scene.cameras.find((c) => c.id === scene.activeCameraId)
  const selectedChar = scene.characters.find((c) => c.id === selectedId && !c.locked && !c.hidden)
  const selectedCam = scene.cameras.find((c) => c.id === selectedId && !c.locked && !c.hidden)
  const anchorRef = React.useRef<THREE.Object3D>(null)
  const [orbitOn, setOrbitOn] = React.useState(true)
  const scenePosition = scene.scenePosition ?? [0, 0, 0]
  const sceneRotation = scene.sceneRotation ?? [0, 0, 0]
  const sceneScale = Math.max(0.01, scene.sceneScale ?? 3)
  const sceneRotationRad: Vec3 = sceneRotation.map((value) => THREE.MathUtils.degToRad(value)) as Vec3

  // 骨骼直掰：选中角色后场景里出现可点选关节球，点选 → rotate gizmo 挂到该骨骼
  const rigsRef = React.useRef(new Map<string, RigState>())
  const [jointRole, setJointRole] = React.useState<JointRole | null>(null)
  React.useEffect(() => { setJointRole(null) }, [selectedId, viewpoint])

  // 角色根 group 注册表：gizmo 直接挂实体 → 拖拽实时所见即所得（不再经隐形锚点+松手跳变）
  // groupsRef 已上提到 Viewport，由外层透传
  const [, bumpRefs] = React.useReducer((x: number) => x + 1, 0)

  // 机位只支持移动；角色支持移动/旋转/缩放
  const mode: GizmoMode = selectedCam ? 'translate' : gizmoMode
  const charGroup = selectedChar ? groupsRef.current.get(selectedChar.id) : undefined

  // 角色 gizmo 松手：从实体 group 读回整套变换（group.scale 含 uniformScale，需除回）
  const commitChar = () => {
    if (!selectedChar) return
    const g = groupsRef.current.get(selectedChar.id)
    if (!g) return
    const s = selectedChar.uniformScale || 1
    const snap = scene.gridSnap ?? false
    const snapStep = 0.5
    const rawPosition: Vec3 = [
      snap ? Math.round(g.position.x / snapStep) * snapStep : g.position.x,
      g.position.y,
      snap ? Math.round(g.position.z / snapStep) * snapStep : g.position.z,
    ]
    const position = (scene.gaussianGroundSnap ?? true)
      ? snapPositionToGround(rawPosition, scene.groundHeight ?? 0, true)
      : rawPosition
    if (snap) g.position.set(position[0], position[1], position[2])
    else if (position[1] !== g.position.y) g.position.y = position[1]
    onPatchCharacter(selectedChar.id, {
      position,
      rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
      scale: [g.scale.x / s, g.scale.y / s, g.scale.z / s],
    })
  }

  const commitCam = () => {
    const m = anchorRef.current
    if (!m || !selectedCam) return
    const snap = scene.gridSnap ?? false
    const step = 0.5
    const position: Vec3 = [snap ? Math.round(m.position.x / step) * step : m.position.x, m.position.y, snap ? Math.round(m.position.z / step) * step : m.position.z]
    if (snap) m.position.set(position[0], position[1], position[2])
    onPatchCamera(selectedCam.id, { position })
  }

  // 骨骼 gizmo 松手：从骨骼当前局部四元数反解规范系欧拉角，合并回写 pose（所见即所得）
  const commitJoint = () => {
    if (!selectedChar || !jointRole) return
    const rig = rigsRef.current.get(selectedChar.id)
    if (!rig) return
    const eul = poseEulerFromRig(rig, jointRole)
    if (!eul) return
    const base = resolveCharacterPose(selectedChar) ?? {}
    onPatchCharacter(selectedChar.id, { pose: { ...base, [jointRole]: eul } as CharacterObj['pose'] })
  }

  const jointBone = selectedChar && jointRole ? rigsRef.current.get(selectedChar.id)?.joints[jointRole]?.bone : undefined

  return (
    <>
      {viewpoint === 'director' ? (
        <OrbitControls makeDefault enableDamping enabled={orbitOn} target={DIRECTOR_TARGET} />
      ) : activeCam ? (
        <ActiveCameraView cam={activeCam} scene={scene} />
      ) : null}

      <Skybox url={skyboxUrl ?? scene.skybox} yawDeg={scene.skyboxYaw} skyColor={scene.skyColor ?? '#060608'} radius={scene.skyRadius ?? 60} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#ffffff', '#444a55', 0.8]} />
      <directionalLight position={[5, 10, 7]} intensity={1.4} />
      <directionalLight position={[-6, 4, -4]} intensity={0.5} />
      {(scene.groundVisible ?? true) ? (
        <group position={[0, scene.groundHeight ?? 0, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-10}>
            <planeGeometry args={[120, 120]} />
            <meshBasicMaterial color="#111820" transparent opacity={Math.max(0, Math.min(1, scene.groundOpacity ?? 0.4))} depthWrite={false} />
          </mesh>
          <Grid
            args={[40, 40]}
            cellColor="#1d3a5f"
            sectionColor="#626872"
            infiniteGrid
            fadeDistance={60}
            cellThickness={0.6}
            sectionThickness={1}
            cellSize={1}
            sectionSize={5}
            fadeStrength={1}
          />
        </group>
      ) : null}

      {viewpoint === 'director' && pathDraw ? (
        <PathDrawLayer pd={pathDraw} scene={scene} onDragStart={() => setOrbitOn(false)} onDragEnd={() => setOrbitOn(true)} />
      ) : null}

      <group position={scenePosition} rotation={sceneRotationRad} scale={sceneScale}>
        {scene.characters.filter((c) => !c.hidden).map((c) => {
          const trajectory = scene.propertyTimeline?.trajectories?.[c.id]
          const motionConfig = resolveTrajectoryMotion(c.trajectoryMotion)
          const duration = Math.max(0.01, scene.propertyTimeline?.duration ?? 10)
          const speedMps = trajectory && trajectory.waypoints.length >= 2 ? pathLength(trajectory) / duration : 0
          const gait = resolveTrajectoryGait(speedMps, c.trajectoryMotion)
          const inferredClip = gait.clip
          const gaitRate = gait.playbackRate
          const renderedCharacter = animationTime != null && inferredClip && !c.motionClip && !c.motion
            ? { ...c, motionClip: inferredClip }
            : c
          return (
          <CharacterObject
          key={c.id}
          character={renderedCharacter}
          customMotions={scene.customMotions}
          selected={c.id === selectedId}
          showLabel={scene.showCharacterLabels ?? true}
          onSelect={() => { setJointRole(null); onSelect(c.id) }}
          jointEditing={viewpoint === 'director' && c.id === selectedChar?.id}
          selectedJointRole={c.id === selectedChar?.id ? jointRole : null}
          onPickJoint={(role) => setJointRole((r) => (r === role ? null : role))}
          onRigChange={(rig) => { if (rig) rigsRef.current.set(c.id, rig); else rigsRef.current.delete(c.id) }}
          onGroupChange={(g) => {
            if (g === groupsRef.current.get(c.id)) return
            if (g) groupsRef.current.set(c.id, g); else groupsRef.current.delete(c.id)
            bumpRefs() // 注册表变化驱动重渲染，确保选中时 gizmo 能拿到 group
          }}
          motionPreviewPlaying={animationTime != null}
          motionDriveTime={animationTime != null ? animationTime * gaitRate : undefined}
          onFootGroundingDiagnostic={(diagnostic) => onFootGroundingDiagnostic?.(c.id, diagnostic)}
          showMotionDirectionHelper={viewpoint === 'director'}
          footGrounding={animationTime != null && motionConfig.ikEnabled ? {
            groundHeight: scene.groundHeight ?? 0,
            gaussianEnabled: scene.gaussianGroundSnap ?? true,
            weight: motionConfig.ikWeight,
            lockEnabled: motionConfig.footLockEnabled,
            lockDistance: motionConfig.footLockDistance,
            releaseDistance: motionConfig.footReleaseDistance,
            soleOffset: motionConfig.soleOffset,
            slopeWeight: motionConfig.footSlopeWeight,
          } : undefined}
          />
          )
        })}
      </group>
      {scene.cameras.filter((c) => !c.hidden).map((c) => (
        <CameraRig key={c.id} camera={c} scene={scene} active={viewpoint === 'director'} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
      ))}

      {viewpoint === 'director' && selectedChar && jointRole && jointBone ? (
        // 骨骼直掰：rotate gizmo 直接挂在被点选的骨骼上，拖拽实时驱动蒙皮，松手反解回写 pose
        <TransformControls
          key={`${selectedChar.id}-${jointRole}`}
          object={jointBone}
          mode="rotate"
          size={0.6}
          onMouseUp={commitJoint}
        />
      ) : viewpoint === 'director' && selectedChar && charGroup ? (
        // gizmo 直接挂角色实体：移动/转向/缩放拖拽全程实时
        <React.Fragment key={`${selectedChar.id}-${mode}`}>
          <TransformControls object={charGroup} mode={mode} onMouseUp={commitChar} />
          {mode === 'translate' ? (
            // 移动模式下常驻 Y 轴转向环：拖环直接转身，无需切到旋转模式
            <TransformControls object={charGroup} mode="rotate" showX={false} showZ={false} onMouseUp={commitChar} />
          ) : null}
        </React.Fragment>
      ) : viewpoint === 'director' && selectedCam ? (
        <React.Fragment key={selectedCam.id}>
          <object3D ref={anchorRef} position={selectedCam.position} />
          <TransformControls
            object={anchorRef as React.MutableRefObject<THREE.Object3D>}
            mode="translate"
            onMouseUp={commitCam}
          />
        </React.Fragment>
      ) : null}

      {viewpoint === 'director' ? (
        <GizmoHelper alignment="top-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ff4d4f', '#52c41a', '#1890ff']} labelColor="#fff" />
        </GizmoHelper>
      ) : null}
    </>
  )
}

export const Viewport = React.forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const glRef = React.useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = React.useRef<THREE.Scene | null>(null)
  const controlsRef = React.useRef<any>(null)
  const cameraRef = React.useRef<THREE.Camera | null>(null)
  const groupsRef = React.useRef(new Map<string, THREE.Group>())
  const propsRef = React.useRef(props)
  propsRef.current = props

  React.useImperativeHandle(ref, () => ({
    // 纯客户端截图：截「当前所见」——导演视角=环绕相机视角，机位视角=机位 POV；离屏按画幅渲染 → dataURL
    captureView: (opts) => {
      const gl = glRef.current, scene = sceneRef.current
      const live = cameraRef.current as THREE.PerspectiveCamera | null
      const p = propsRef.current
      if (!gl || !scene || !live) return null
      const vw = gl.domElement.width || 1280
      const { width, height } = captureSize(p.scene.aspect, vw / (gl.domElement.height || 720))
      const baseFov = live.isPerspectiveCamera ? live.fov : 50
      const fovScale = opts?.fovScale
      const fov = fovScale && fovScale > 0 && fovScale !== 1
        ? (Math.atan(Math.tan((baseFov * Math.PI) / 360) * fovScale) * 360) / Math.PI
        : baseFov
      const tmp = new THREE.PerspectiveCamera(fov, width / height, 0.1, 2000)
      tmp.position.copy(live.position)
      tmp.quaternion.copy(live.quaternion)
      tmp.updateMatrixWorld(true)
      // 截图前隐藏辅助物体（机位视锥/变换 gizmo/关节球），出图只含角色+网格
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        const any = o as any
        if (o.visible && (o.type === 'CameraHelper' || any.isTransformControls || any.isTransformControlsRoot || any.isTransformControlsGizmo || o.userData?.directorHelper)) {
          o.visible = false; hidden.push(o)
        }
      })
      const rt = new THREE.WebGLRenderTarget(width, height)
      // 关键：离屏 RT 默认线性、读回会偏暗 → 设 sRGB，使渲染器写出与屏幕一致的亮度
      rt.texture.colorSpace = THREE.SRGBColorSpace
      const prevClear = gl.getClearColor(new THREE.Color()).clone()
      gl.setRenderTarget(rt)
      gl.setClearColor(p.scene.skyColor ?? '#060608', 1)
      gl.clear()
      gl.render(scene, tmp)
      gl.setRenderTarget(null)
      gl.setClearColor(prevClear, 1)
      hidden.forEach((o) => { o.visible = true })
      const buf = new Uint8Array(width * height * 4)
      gl.readRenderTargetPixels(rt, 0, 0, width, height, buf)
      rt.dispose()
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d'); if (!ctx) return null
      const img = ctx.createImageData(width, height)
      for (let y = 0; y < height; y++) {
        const sy = height - 1 - y // WebGL 像素是上下翻转的
        for (let x = 0; x < width; x++) {
          const si = (sy * width + x) * 4, di = (y * width + x) * 4
          img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = buf[si + 3]
        }
      }
      ctx.putImageData(img, 0, 0)

      // 角色标注：drei <Html> 是 DOM 覆盖层，不在 WebGL 帧缓冲里，readPixels 截不到。
      // 用截图相机把每个角色的标注锚点（角色组本地 [0,2.05,0]，与 Label 一致）投影到
      // 画布坐标后手绘，使发送到画布的截图保留「角色X」标注（对齐导演台所见）。
      tmp.updateMatrixWorld(true)
      const labelFont = Math.max(13, Math.round(height / 42))
      ctx.font = `600 ${labelFont}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2, labelFont / 5)
      const lp = new THREE.Vector3()
      const lm = new THREE.Matrix4()
      const sceneMatrix = new THREE.Matrix4()
      const lq = new THREE.Quaternion()
      const sceneQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(p.scene.sceneRotation?.[0] ?? 0),
        THREE.MathUtils.degToRad(p.scene.sceneRotation?.[1] ?? 0),
        THREE.MathUtils.degToRad(p.scene.sceneRotation?.[2] ?? 0),
      ))
      const globalScale = Math.max(0.01, p.scene.sceneScale ?? 3)
      sceneMatrix.compose(
        new THREE.Vector3(...(p.scene.scenePosition ?? [0, 0, 0])),
        sceneQuaternion,
        new THREE.Vector3(globalScale, globalScale, globalScale),
      )
      for (const ch of (p.scene.showCharacterLabels ?? true) ? p.scene.characters : []) {
        if (ch.hidden) continue
        const us = ch.uniformScale
        lq.setFromEuler(new THREE.Euler(ch.rotation[0], ch.rotation[1], ch.rotation[2]))
        lm.compose(
          new THREE.Vector3(ch.position[0], ch.position[1], ch.position[2]),
          lq,
          new THREE.Vector3(ch.scale[0] * us, ch.scale[1] * us, ch.scale[2] * us),
        )
        lm.premultiply(sceneMatrix)
        lp.set(0, 2.05, 0).applyMatrix4(lm).project(tmp)
        if (lp.z < -1 || lp.z > 1) continue // 相机背后或视锥外
        if (lp.x < -1.05 || lp.x > 1.05 || lp.y < -1.05 || lp.y > 1.05) continue
        const sx = (lp.x * 0.5 + 0.5) * width
        const sy = (1 - (lp.y * 0.5 + 0.5)) * height
        ctx.strokeStyle = 'rgba(0,0,0,0.85)'
        ctx.strokeText(ch.name, sx, sy)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(ch.name, sx, sy)
      }

      return canvas.toDataURL('image/jpeg', 0.92)
    },
    // 当前视角相机参数：位置 + 注视点(优先 OrbitControls target，否则相机前方) + FOV
    getCurrentCamera: () => {
      const live = cameraRef.current as THREE.PerspectiveCamera | null
      if (!live) return null
      const pos: Vec3 = [live.position.x, live.position.y, live.position.z]
      const c = controlsRef.current
      let lookAt: Vec3
      // OrbitControls may remain in the ref briefly after switching from the
      // director view. Its target is valid only for that view; consuming the
      // stale target in camera view makes “capture current view” create a new
      // camera looking somewhere different from the pixels being captured.
      if (propsRef.current.viewpoint === 'director' && c?.target) {
        lookAt = [c.target.x, c.target.y, c.target.z]
      } else {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(live.quaternion).multiplyScalar(10).add(live.position)
        lookAt = [fwd.x, fwd.y, fwd.z]
      }
      return { position: pos, lookAt, fovDeg: live.isPerspectiveCamera ? live.fov : 50 }
    },
    resetView: () => {
      const cam = cameraRef.current as THREE.PerspectiveCamera | null
      if (cam) { cam.position.set(DIRECTOR_CAM_POS[0], DIRECTOR_CAM_POS[1], DIRECTOR_CAM_POS[2]); cam.updateProjectionMatrix() }
      const c = controlsRef.current
      if (c) { if (c.target?.set) c.target.set(DIRECTOR_TARGET[0], DIRECTOR_TARGET[1], DIRECTOR_TARGET[2]); c.update?.() }
    },
  }), [])

  // 机位视角按画幅比例做 letterbox
  const ratio = props.viewpoint === 'camera' ? aspectRatio(props.scene.aspect, 16 / 9) : null
  // isolation:isolate → 每个视口自成层叠上下文，把 drei <Html> 角色/机位标注(z-index≈16M)关在视口内，
  // 不再穿透盖在聊天面板/工具条等同级 UI 之上。
  const wrapStyle: React.CSSProperties = ratio
    ? { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', isolation: 'isolate' }
    : { position: 'absolute', inset: 0, isolation: 'isolate' }
  const canvasStyle: React.CSSProperties = ratio
    ? { aspectRatio: String(ratio), maxWidth: '100%', maxHeight: '100%', width: ratio >= 1 ? '100%' : 'auto', height: ratio >= 1 ? 'auto' : '100%' }
    : { width: '100%', height: '100%' }

  return (
    <div style={wrapStyle}>
      <div style={canvasStyle}>
        <Canvas
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          camera={{ position: [6, 4.5, 13], fov: 45 }}
          onCreated={({ gl, scene }) => { glRef.current = gl; sceneRef.current = scene; gl.setClearColor('#0a0b0d') }}
          style={{ width: '100%', height: '100%' }}
          onPointerMissed={() => props.onSelect(undefined)}
        >
          <RefSync glRef={glRef} sceneRef={sceneRef} controlsRef={controlsRef} cameraRef={cameraRef} />
          <React.Suspense fallback={null}>
            <SceneContents {...props} groupsRef={groupsRef} />
            <ReadySignal onReady={props.onSceneReady} />
          </React.Suspense>
        </Canvas>
      </div>
    </div>
  )
})

/** 同步 gl/scene/controls/camera 给截图与重置视角用 */
function RefSync({ glRef, sceneRef, controlsRef, cameraRef }: {
  glRef: React.MutableRefObject<THREE.WebGLRenderer | null>
  sceneRef: React.MutableRefObject<THREE.Scene | null>
  controlsRef: React.MutableRefObject<any>
  cameraRef: React.MutableRefObject<THREE.Camera | null>
}) {
  const { gl, scene, controls, camera } = useThree()
  React.useEffect(() => { glRef.current = gl; sceneRef.current = scene }, [gl, scene, glRef, sceneRef])
  React.useEffect(() => { controlsRef.current = controls; cameraRef.current = camera }, [controls, camera, controlsRef, cameraRef])
  return null
}
