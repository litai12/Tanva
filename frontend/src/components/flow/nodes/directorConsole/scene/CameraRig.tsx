// @ts-nocheck
import React from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { CameraObj, DirectorScene, Vec3 } from '../types'

type Props = { camera: CameraObj; scene: DirectorScene; active: boolean; selected: boolean; onSelect: () => void }

function resolveLookAt(cam: CameraObj, scene: DirectorScene): Vec3 {
  if (cam.lookAtMode !== 'manual') {
    const target = scene.characters.find((c) => c.id === cam.lookAtMode)
    if (target) return [target.position[0], target.position[1] + 1.2 + (scene.groundY ?? 0), target.position[2]]
  }
  return cam.lookAt
}

/** 用一台离屏透视相机生成视锥 helper，仅在导演视角可见 */
export function CameraRig({ camera, scene, active, selected, onSelect }: Props) {
  const { scene: rootScene } = useThree()
  const helperRef = React.useRef<THREE.CameraHelper | null>(null)
  const camRef = React.useRef<THREE.PerspectiveCamera | null>(null)

  React.useEffect(() => {
    if (!active) return
    const cam = new THREE.PerspectiveCamera(camera.fovDeg, 16 / 9, 0.3, 8)
    camRef.current = cam
    const helper = new THREE.CameraHelper(cam)
    helperRef.current = helper
    rootScene.add(helper)
    return () => {
      rootScene.remove(helper)
      helper.dispose()
      helperRef.current = null
      camRef.current = null
    }
  }, [active, rootScene, camera.fovDeg])

  useFrame(() => {
    const cam = camRef.current
    if (!cam) return
    const la = resolveLookAt(camera, scene)
    cam.fov = camera.fovDeg
    cam.position.set(camera.position[0], camera.position[1], camera.position[2])
    cam.lookAt(la[0], la[1], la[2])
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)
    helperRef.current?.update()
    if (helperRef.current) (helperRef.current.material as THREE.LineBasicMaterial).color.set(selected ? '#52c41a' : '#626872')
  })

  if (!active) return null
  return (
    <group position={camera.position} onClick={(e) => { e.stopPropagation(); onSelect() }}>
      <mesh>
        <boxGeometry args={[0.3, 0.2, 0.4]} />
        <meshStandardMaterial color={selected ? '#52c41a' : '#888'} />
      </mesh>
      <Html position={[0, 0.35, 0]} center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div style={{ fontSize: 11, color: selected ? '#52c41a' : '#9ca3af', whiteSpace: 'nowrap', textShadow: '0 1px 2px #000' }}>{camera.name}</div>
      </Html>
    </group>
  )
}
