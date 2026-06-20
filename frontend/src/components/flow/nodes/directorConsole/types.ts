export type Vec3 = [number, number, number]
export type AspectKey = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'

export type CameraShot = {
  id: string
  name: string
  imageUrl: string
  serverAssetId?: string
  aspect: AspectKey
  createdAt: number
}

export type CharacterObj = {
  id: string
  name: string
  modelId: string
  position: Vec3
  rotation: Vec3
  scale: Vec3
  uniformScale: number
  colorHex: string
  hidden?: boolean
  locked?: boolean
  /** 姿势预设 id（POSE_PRESETS）；与 pose 同存时 pose 优先 */
  posePresetId?: string
  /** 关节角色 → 欧拉角(弧度)，由姿势系统写入 */
  pose?: Record<string, [number, number, number]>
}

export type CameraObj = {
  id: string
  name: string
  position: Vec3
  /** 'manual' 表示用 lookAt 坐标，否则为某个 characterId（锁定该角色） */
  lookAtMode: 'manual' | string
  lookAt: Vec3
  fovDeg: number
  hidden?: boolean
  locked?: boolean
}

export type DirectorScene = {
  characters: CharacterObj[]
  cameras: CameraObj[]
  aspect: AspectKey
  activeCameraId?: string
  /** 等距全景图 URL，作为 3D 场景天空盒背景 */
  skybox?: string
}

export type DirectorConsoleData = {
  kind: 'directorConsole'
  label: string
  scene: DirectorScene
  activeViewpoint: 'director' | 'camera'
  selectedObjectId?: string
  status?: 'idle' | 'running' | 'success' | 'error'
  // 允许画布节点临时字段与 updateNodeData(Record<string, any>) 补丁
  [key: string]: unknown
}

export function createDefaultDirectorConsoleData(_legacyPanoramaUrl?: string): DirectorConsoleData {
  return {
    kind: 'directorConsole',
    label: '导演台',
    scene: { characters: [], cameras: [], aspect: 'auto' },
    activeViewpoint: 'director',
    status: 'idle',
  }
}
