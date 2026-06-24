import React from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, PerspectiveCamera, TransformControls, useProgress } from '@react-three/drei'
import * as THREE from 'three'
import type { DirectorScene, CharacterObj, CameraObj, Vec3 } from '../types'
import { CharacterObject, resolveCharacterPose } from './CharacterObject'
import { CameraRig } from './CameraRig'
import { poseEulerFromRig, type JointRole, type RigState } from '../state/pose'
import { aspectRatio, captureSize } from '../state/aspect'
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy'

async function fetchProxiedImageBlob(url: string): Promise<Blob> {
  const proxied = proxifyRemoteAssetUrl(url, { forceProxy: true })
  const res = await fetch(proxied)
  if (!res.ok) throw new Error(`fetch skybox failed: HTTP ${res.status}`)
  return res.blob()
}

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type ViewportHandle = {
  captureView: () => string | null
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
  skyboxUrl?: string
  onSelect: (id?: string) => void
  onPatchCharacter: (id: string, patch: Partial<CharacterObj>) => void
  onPatchCamera: (id: string, patch: Partial<CameraObj>) => void
  onSceneReady?: () => void
}

function resolveLookAt(cam: CameraObj, scene: DirectorScene): Vec3 {
  if (cam.lookAtMode !== 'manual') {
    const target = scene.characters.find((c) => c.id === cam.lookAtMode)
    if (target) return [target.position[0], target.position[1] + 1.2, target.position[2]]
  }
  return cam.lookAt
}

function corsSafeImageUrl(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + 'tc-cors=1'
}

function Skybox({ url }: { url?: string }) {
  const { scene, invalidate } = useThree()
  React.useEffect(() => {
    const DARK = () => { scene.background = new THREE.Color('#0a0b0d') }
    if (!url) { DARK(); return }
    let disposed = false
    let objUrl: string | null = null
    const applyTexture = (tex: THREE.Texture) => {
      if (disposed) { tex.dispose(); return }
      tex.mapping = THREE.EquirectangularReflectionMapping
      tex.colorSpace = THREE.SRGBColorSpace
      scene.background = tex
      invalidate?.()
    }
    void (async () => {
      try {
        const loader = new THREE.TextureLoader()
        if (/^https?:\/\//i.test(url)) {
          const blob = await fetchProxiedImageBlob(corsSafeImageUrl(url))
          if (disposed) return
          objUrl = URL.createObjectURL(blob)
          loader.load(objUrl, applyTexture, undefined, DARK)
        } else {
          loader.load(url, applyTexture, undefined, DARK)
        }
      } catch {
        DARK()
      }
    })()
    return () => {
      disposed = true
      if (objUrl) URL.revokeObjectURL(objUrl)
      scene.background = new THREE.Color('#0a0b0d')
    }
  }, [url, scene, invalidate])
  return null
}

function ActiveCameraView({ cam, lookAt }: { cam: CameraObj; lookAt: Vec3 }) {
  const { set, invalidate } = useThree()
  const ref = React.useRef<THREE.PerspectiveCamera>(null)

  React.useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    c.position.set(cam.position[0], cam.position[1], cam.position[2])
    c.fov = cam.fovDeg
    c.updateProjectionMatrix()
    c.lookAt(lookAt[0], lookAt[1], lookAt[2])
    c.updateMatrixWorld(true)
    set({ camera: c })
    invalidate()
  }, [cam.id, cam.position, cam.fovDeg, lookAt, set, invalidate])

  useFrame(() => {
    ref.current?.lookAt(lookAt[0], lookAt[1], lookAt[2])
  })
  return (
    <perspectiveCamera
      key={cam.id}
      ref={ref}
      position={cam.position}
      fov={cam.fovDeg}
      near={0.1}
      far={1000}
    />
  )
}

function ReadySignal({ onReady }: { onReady?: () => void }) {
  const { invalidate } = useThree()
  const { active } = useProgress()
  const [settled, setSettled] = React.useState(false)
  React.useEffect(() => {
    if (active) { setSettled(false); return }
    const timer = window.setTimeout(() => setSettled(true), 600)
    return () => window.clearTimeout(timer)
  }, [active])
  React.useEffect(() => {
    if (!onReady || !settled) return
    let fired = false
    const fire = () => {
      if (fired) return
      fired = true
      onReady()
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      invalidate()
      raf2 = requestAnimationFrame(fire)
    })
    const timer = window.setTimeout(() => {
      invalidate()
      fire()
    }, 800)
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); window.clearTimeout(timer) }
  }, [onReady, settled, invalidate])
  return null
}

function SceneContents({ scene, viewpoint, selectedId, gizmoMode = 'translate', skyboxUrl, onSelect, onPatchCharacter, onPatchCamera }: Props) {
  const activeCam = scene.cameras.find((c) => c.id === scene.activeCameraId)
  const selectedChar = scene.characters.find((c) => c.id === selectedId && !c.locked && !c.hidden)
  const selectedCam = scene.cameras.find((c) => c.id === selectedId && !c.locked && !c.hidden)
  const anchorRef = React.useRef<THREE.Object3D>(null)

  const rigsRef = React.useRef(new Map<string, RigState>())
  const [jointRole, setJointRole] = React.useState<JointRole | null>(null)
  React.useEffect(() => { setJointRole(null) }, [selectedId, viewpoint])

  const groupsRef = React.useRef(new Map<string, THREE.Group>())
  const [, bumpRefs] = React.useReducer((x: number) => x + 1, 0)

  const mode: GizmoMode = selectedCam ? 'translate' : gizmoMode
  const charGroup = selectedChar ? groupsRef.current.get(selectedChar.id) : undefined

  const commitChar = () => {
    if (!selectedChar) return
    const g = groupsRef.current.get(selectedChar.id)
    if (!g) return
    const s = selectedChar.uniformScale || 1
    onPatchCharacter(selectedChar.id, {
      position: [g.position.x, g.position.y, g.position.z],
      rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
      scale: [g.scale.x / s, g.scale.y / s, g.scale.z / s],
    })
  }

  const commitCam = () => {
    const m = anchorRef.current
    if (!m || !selectedCam) return
    onPatchCamera(selectedCam.id, { position: [m.position.x, m.position.y, m.position.z] })
  }

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
        <OrbitControls makeDefault enableDamping target={DIRECTOR_TARGET} />
      ) : activeCam ? (
        <ActiveCameraView cam={activeCam} lookAt={resolveLookAt(activeCam, scene)} />
      ) : null}

      <Skybox url={skyboxUrl ?? scene.skybox} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#ffffff', '#444a55', 0.8]} />
      <directionalLight position={[5, 10, 7]} intensity={1.4} />
      <directionalLight position={[-6, 4, -4]} intensity={0.5} />
      <Grid args={[40, 40]} cellColor="#1d3a5f" sectionColor="#626872" infiniteGrid fadeDistance={60} position={[0, 0, 0]} />

      {scene.characters.filter((c) => !c.hidden).map((c) => (
        <CharacterObject
          key={c.id}
          character={c}
          selected={c.id === selectedId}
          onSelect={() => { setJointRole(null); onSelect(c.id) }}
          jointEditing={viewpoint === 'director' && c.id === selectedChar?.id}
          selectedJointRole={c.id === selectedChar?.id ? jointRole : null}
          onPickJoint={(role) => setJointRole((r) => (r === role ? null : role))}
          onRigChange={(rig) => { if (rig) rigsRef.current.set(c.id, rig); else rigsRef.current.delete(c.id) }}
          onGroupChange={(g) => {
            if (g === groupsRef.current.get(c.id)) return
            if (g) groupsRef.current.set(c.id, g); else groupsRef.current.delete(c.id)
            bumpRefs()
          }}
        />
      ))}
      {scene.cameras.filter((c) => !c.hidden).map((c) => (
        <CameraRig key={c.id} camera={c} scene={scene} active={viewpoint === 'director'} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />
      ))}

      {viewpoint === 'director' && selectedChar && jointRole && jointBone ? (
        <TransformControls
          key={`${selectedChar.id}-${jointRole}`}
          object={jointBone}
          mode="rotate"
          size={0.6}
          onMouseUp={commitJoint}
        />
      ) : viewpoint === 'director' && selectedChar && charGroup ? (
        <React.Fragment key={`${selectedChar.id}-${mode}`}>
          <TransformControls object={charGroup} mode={mode} onMouseUp={commitChar} />
          {mode === 'translate' ? (
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
  const propsRef = React.useRef(props)
  propsRef.current = props

  React.useImperativeHandle(ref, () => ({
    captureView: () => {
      const gl = glRef.current, scene = sceneRef.current
      const live = cameraRef.current as THREE.PerspectiveCamera | null
      const p = propsRef.current
      if (!gl || !scene || !live) return null
      const vw = gl.domElement.width || 1280
      const { width, height } = captureSize(p.scene.aspect, vw / (gl.domElement.height || 720))
      const tmp = new THREE.PerspectiveCamera(live.isPerspectiveCamera ? live.fov : 50, width / height, 0.1, 2000)
      tmp.position.copy(live.position)
      tmp.quaternion.copy(live.quaternion)
      tmp.updateMatrixWorld(true)
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        const any = o as any
        if (o.visible && (o.type === 'CameraHelper' || any.isTransformControls || any.isTransformControlsRoot || any.isTransformControlsGizmo || o.userData?.directorHelper)) {
          o.visible = false; hidden.push(o)
        }
      })
      const rt = new THREE.WebGLRenderTarget(width, height)
      rt.texture.colorSpace = THREE.SRGBColorSpace
      const prevClear = gl.getClearColor(new THREE.Color()).clone()
      gl.setRenderTarget(rt)
      gl.setClearColor('#0a0b0d', 1)
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
        const sy = height - 1 - y
        for (let x = 0; x < width; x++) {
          const si = (sy * width + x) * 4, di = (y * width + x) * 4
          img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = buf[si + 3]
        }
      }
      ctx.putImageData(img, 0, 0)

      tmp.updateMatrixWorld(true)
      const labelFont = Math.max(13, Math.round(height / 42))
      ctx.font = `600 ${labelFont}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2, labelFont / 5)
      const lp = new THREE.Vector3()
      const lm = new THREE.Matrix4()
      const lq = new THREE.Quaternion()
      for (const ch of p.scene.characters) {
        if (ch.hidden) continue
        const us = ch.uniformScale
        lq.setFromEuler(new THREE.Euler(ch.rotation[0], ch.rotation[1], ch.rotation[2]))
        lm.compose(
          new THREE.Vector3(ch.position[0], ch.position[1], ch.position[2]),
          lq,
          new THREE.Vector3(ch.scale[0] * us, ch.scale[1] * us, ch.scale[2] * us),
        )
        lp.set(0, 2.05, 0).applyMatrix4(lm).project(tmp)
        if (lp.z < -1 || lp.z > 1) continue
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
    getCurrentCamera: () => {
      const live = cameraRef.current as THREE.PerspectiveCamera | null
      if (!live) return null
      const pos: Vec3 = [live.position.x, live.position.y, live.position.z]
      const c = controlsRef.current
      let lookAt: Vec3
      if (c?.target) {
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

  const ratio = props.viewpoint === 'camera' ? aspectRatio(props.scene.aspect, 16 / 9) : null
  const wrapStyle: React.CSSProperties = ratio
    ? { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }
    : { position: 'absolute', inset: 0 }
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
        >
          <RefSync glRef={glRef} sceneRef={sceneRef} controlsRef={controlsRef} cameraRef={cameraRef} />
          <React.Suspense fallback={null}>
            <SceneContents {...props} />
            <ReadySignal onReady={props.onSceneReady} />
          </React.Suspense>
        </Canvas>
      </div>
    </div>
  )
})

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
