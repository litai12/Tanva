import type { CameraObj, CharacterObj, DirectorScene, Vec3 } from '../types'

export type PropertyName = 'position' | 'rotation' | 'scale' | 'uniformScale' | 'pose' | 'fovDeg' | 'lookAt'
export type PoseValue = Record<string, Vec3>
export type KeyframeValue = number | Vec3 | PoseValue
export type PropertyKeyframe = { time: number; value: KeyframeValue }
export type PropertyTrack = {
  id: string
  objectId: string
  objectKind: 'character' | 'camera'
  property: PropertyName
  keyframes: PropertyKeyframe[]
}
export type PropertyTimeline = { duration: number; tracks: PropertyTrack[] }

export const ensurePropertyTimeline = (value?: PropertyTimeline): PropertyTimeline => ({
  duration: Math.max(0.01, Number(value?.duration) || 10),
  tracks: Array.isArray(value?.tracks) ? value!.tracks : [],
})

export const trackId = (objectId: string, property: PropertyName) => `${objectId}:${property}`

export const propertiesFor = (objectKind: 'character' | 'camera'): PropertyName[] => objectKind === 'character'
  ? ['position', 'rotation', 'scale', 'uniformScale', 'pose']
  : ['position', 'rotation', 'fovDeg', 'lookAt']

export function addObjectTracks(timelineValue: PropertyTimeline | undefined, scene: DirectorScene, objectKind: 'character' | 'camera', objectId: string, time = 0): PropertyTimeline {
  let timeline = ensurePropertyTimeline(timelineValue)
  for (const property of propertiesFor(objectKind)) timeline = setKeyframe(timeline, scene, objectKind, objectId, property, time)
  return timeline
}

export function removeObjectTracks(timelineValue: PropertyTimeline | undefined, objectId: string): PropertyTimeline {
  const timeline = ensurePropertyTimeline(timelineValue)
  return { ...timeline, tracks: timeline.tracks.filter((track) => track.objectId !== objectId) }
}

export function valueAt(scene: DirectorScene, objectKind: 'character' | 'camera', objectId: string, property: PropertyName): KeyframeValue | undefined {
  const object = objectKind === 'character'
    ? scene.characters.find((item) => item.id === objectId)
    : scene.cameras.find((item) => item.id === objectId)
  const value = (object as any)?.[property]
  if (typeof value === 'number') return value
  if (Array.isArray(value) && value.length >= 3) return [Number(value[0]), Number(value[1]), Number(value[2])]
  if (property === 'pose' && value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => Array.isArray(item) && item.length >= 3).map(([key, item]) => [key, [Number((item as number[])[0]), Number((item as number[])[1]), Number((item as number[])[2])]]))
  }
  if (property === 'pose') return {}
  if (property === 'rotation') return [0, 0, 0]
  return undefined
}

export function setKeyframe(timelineValue: PropertyTimeline | undefined, scene: DirectorScene, objectKind: 'character' | 'camera', objectId: string, property: PropertyName, time: number): PropertyTimeline {
  const timeline = ensurePropertyTimeline(timelineValue)
  const value = valueAt(scene, objectKind, objectId, property)
  if (value === undefined) return timeline
  const id = trackId(objectId, property)
  const existing = timeline.tracks.find((track) => track.id === id)
  const keyframe = { time: Math.max(0, Math.min(timeline.duration, time)), value }
  const keyframes = [...(existing?.keyframes ?? []).filter((item) => Math.abs(item.time - keyframe.time) > 0.001), keyframe].sort((a, b) => a.time - b.time)
  const track: PropertyTrack = { id, objectId, objectKind, property, keyframes }
  return { ...timeline, tracks: [...timeline.tracks.filter((item) => item.id !== id), track] }
}

export function removeKeyframe(timelineValue: PropertyTimeline | undefined, objectId: string, property: PropertyName, time: number): PropertyTimeline {
  const timeline = ensurePropertyTimeline(timelineValue)
  const id = trackId(objectId, property)
  return { ...timeline, tracks: timeline.tracks.map((track) => track.id === id ? { ...track, keyframes: track.keyframes.filter((item) => Math.abs(item.time - time) > 0.02) } : track).filter((track) => track.keyframes.length > 0) }
}

const mixValue = (a: KeyframeValue, b: KeyframeValue, amount: number): KeyframeValue => {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * amount
  if (Array.isArray(a) && Array.isArray(b)) return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
  if (!Array.isArray(a) && !Array.isArray(b) && typeof a === 'object' && typeof b === 'object') {
    const result: PoseValue = {}
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const av = (a as PoseValue)[key] ?? [0, 0, 0]
      const bv = (b as PoseValue)[key] ?? [0, 0, 0]
      result[key] = [av[0] + (bv[0] - av[0]) * amount, av[1] + (bv[1] - av[1]) * amount, av[2] + (bv[2] - av[2]) * amount]
    }
    return result
  }
  return a
}

function sampleTrack(track: PropertyTrack, time: number): KeyframeValue | undefined {
  const keys = track.keyframes
  if (!keys.length) return undefined
  if (time <= keys[0].time) return keys[0].value
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value
  for (let index = 1; index < keys.length; index++) {
    const next = keys[index]
    if (time > next.time) continue
    const previous = keys[index - 1]
    return mixValue(previous.value, next.value, (time - previous.time) / Math.max(0.0001, next.time - previous.time))
  }
  return keys[keys.length - 1].value
}

export function samplePropertyTimeline(scene: DirectorScene, time: number): DirectorScene {
  const timeline = ensurePropertyTimeline(scene.propertyTimeline)
  if (!timeline.tracks.length) return scene
  const characterPatches = new Map<string, Partial<CharacterObj>>()
  const cameraPatches = new Map<string, Partial<CameraObj>>()
  for (const track of timeline.tracks) {
    const value = sampleTrack(track, time)
    if (value === undefined) continue
    const target = track.objectKind === 'character' ? characterPatches : cameraPatches
    target.set(track.objectId, { ...(target.get(track.objectId) ?? {}), [track.property]: value, ...(track.property === 'pose' ? { posePresetId: undefined } : {}) })
  }
  return {
    ...scene,
    characters: scene.characters.map((item) => ({ ...item, ...(characterPatches.get(item.id) ?? {}) })),
    cameras: scene.cameras.map((item) => ({ ...item, ...(cameraPatches.get(item.id) ?? {}) })),
  }
}
