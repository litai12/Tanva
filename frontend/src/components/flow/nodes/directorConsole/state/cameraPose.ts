import * as THREE from 'three'
import type { CameraObj, DirectorScene, Vec3 } from '../types'

export type ResolvedCameraPose = {
  position: Vec3
  rotation: Vec3
  lookAt?: Vec3
  fovDeg: number
}

const finiteVec3 = (value: Vec3 | undefined, fallback: Vec3): Vec3 => value && value.every(Number.isFinite) ? value : fallback

/**
 * LibTV camera semantics, shared by the viewport, helper frustum and capture.
 * `rotation` is expressed in UI degrees. A look target takes precedence only
 * in manual-coordinate and character-target modes; manual-rotation never gets
 * overwritten by lookAt().
 */
export function resolveCameraPose(camera: CameraObj, scene: DirectorScene): ResolvedCameraPose {
  const storedPosition = finiteVec3(camera.position, [0, 2.2, 10])
  let position: Vec3 = [...storedPosition]
  if (camera.followTargetId) {
    const target = scene.characters.find((item) => item.id === camera.followTargetId)
    if (target) {
      const offset = finiteVec3(camera.followOffset, [
        storedPosition[0] - target.position[0],
        storedPosition[1] - target.position[1],
        storedPosition[2] - target.position[2],
      ])
      position = [target.position[0] + offset[0], target.position[1] + offset[1], target.position[2] + offset[2]]
    }
  }

  const rotation = finiteVec3(camera.rotation, [5.71, 180, 0])
  if (camera.lookAtMode === 'rotation') return { position, rotation, fovDeg: camera.fovDeg }

  if (camera.lookAtMode !== 'manual') {
    const target = scene.characters.find((item) => item.id === camera.lookAtMode)
    if (target) return {
      position,
      rotation,
      lookAt: [target.position[0], target.position[1] + 1.2, target.position[2]],
      fovDeg: camera.fovDeg,
    }
  }
  return { position, rotation, lookAt: finiteVec3(camera.lookAt, [0, 1.2, 0]), fovDeg: camera.fovDeg }
}

export function applyResolvedCameraPose(camera: THREE.PerspectiveCamera, pose: ResolvedCameraPose): void {
  camera.position.set(...pose.position)
  camera.fov = pose.fovDeg
  if (pose.lookAt) {
    camera.lookAt(...pose.lookAt)
  } else {
    camera.rotation.set(
      THREE.MathUtils.degToRad(pose.rotation[0]),
      THREE.MathUtils.degToRad(pose.rotation[1]),
      THREE.MathUtils.degToRad(pose.rotation[2]),
      'XYZ',
    )
  }
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
}
