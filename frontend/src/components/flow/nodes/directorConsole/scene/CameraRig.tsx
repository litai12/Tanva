// @ts-nocheck
import React from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { CameraObj, DirectorScene } from '../types'
import { applyResolvedCameraPose, resolveCameraPose } from '../state/cameraPose'
import { aspectRatio } from '../state/aspect'

type Props = {
  camera: CameraObj; scene: DirectorScene; active: boolean; selected: boolean; onSelect: () => void
}

/** 用一台离屏透视相机生成视锥 helper，仅在导演视角可见 */
export function CameraRig({ camera, scene, active, selected, onSelect }: Props) {
  const { scene: rootScene } = useThree()
  const helperRef = React.useRef<THREE.CameraHelper | null>(null)
  const camRef = React.useRef<THREE.PerspectiveCamera | null>(null)
  const groupRef = React.useRef<THREE.Group | null>(null)

  React.useEffect(() => {
    if (!active) return
    const cam = new THREE.PerspectiveCamera(camera.fovDeg, aspectRatio(scene.aspect, 16 / 9), 0.3, 8)
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
  }, [active, rootScene, camera.fovDeg, scene.aspect])

  useFrame(() => {
    const cam = camRef.current
    if (!cam) return
    const pose = resolveCameraPose(camera, scene)
    applyResolvedCameraPose(cam, pose)
    helperRef.current?.update()
    if (helperRef.current) (helperRef.current.material as THREE.LineBasicMaterial).color.set(selected ? '#52c41a' : '#626872')
    // 相机图标 + 标签必须和最终取景姿态完全一致；仅更新位置会让
    // 导演视角里的相机模型与视锥/机位预览朝向互相矛盾。
    if (groupRef.current) {
      groupRef.current.position.copy(cam.position)
      groupRef.current.quaternion.copy(cam.quaternion)
    }
  })

  if (!active) return null
  return (
    // userData.directorHelper：截图/出片时随其它辅助物一起隐藏，相机图标不进产出画面
    <group ref={groupRef} position={camera.position} userData={{ directorHelper: true }} onClick={(e) => { e.stopPropagation(); onSelect() }}>
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
