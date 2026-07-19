import type { CameraObj, CharacterObj, DirectorScene, Vec3 } from '../types'
import type { GroundPath } from './groundPath'
import { pathLength, samplePathAt } from './groundPath'

export type PropertyName = 'position' | 'rotation' | 'scale' | 'uniformScale' | 'pose' | 'fovDeg' | 'lookAt'
export type PoseValue = Record<string, Vec3>
export type KeyframeValue = number | Vec3 | PoseValue
export type PropertyKeyframe = { time: number; value: KeyframeValue }
export type PropertyTrack = {
  id: string
  objectId: string
  objectKind: 'character' | 'camera'
  property: PropertyName
  component?: 0 | 1 | 2
  keyframes: PropertyKeyframe[]
}
export type PropertyTimeline = { duration: number; tracks: PropertyTrack[]; trajectories?: Record<string, GroundPath> }

export const ensurePropertyTimeline = (value?: PropertyTimeline): PropertyTimeline => ({
  duration: Math.max(0.01, Number(value?.duration) || 10),
  tracks: Array.isArray(value?.tracks) ? value!.tracks : [],
  trajectories: value?.trajectories && typeof value.trajectories === 'object' ? value.trajectories : {},
})

export const trackId = (objectId: string, property: PropertyName, component?: 0 | 1 | 2) => `${objectId}:${property}${component == null ? '' : `:${component}`}`

const VECTOR_PROPERTIES = new Set<PropertyName>(['position', 'rotation', 'scale', 'lookAt'])

export const propertiesFor = (objectKind: 'character' | 'camera'): PropertyName[] => objectKind === 'character'
  ? ['position', 'rotation', 'scale', 'uniformScale', 'pose']
  : ['position', 'rotation', 'fovDeg', 'lookAt']

export function addObjectTracks(timelineValue: PropertyTimeline | undefined, _scene: DirectorScene, objectKind: 'character' | 'camera', objectId: string, _time = 0): PropertyTimeline {
  const timeline = ensurePropertyTimeline(timelineValue)
  const additions: PropertyTrack[] = []
  const idsToReplace = new Set<string>()
  for (const property of propertiesFor(objectKind)) {
    if (VECTOR_PROPERTIES.has(property)) {
      idsToReplace.add(trackId(objectId, property))
      for (const component of [0, 1, 2] as const) additions.push({ id: trackId(objectId, property, component), objectId, objectKind, property, component, keyframes: [] })
    } else additions.push({ id: trackId(objectId, property), objectId, objectKind, property, keyframes: [] })
  }
  for (const track of additions) idsToReplace.add(track.id)
  return { ...timeline, tracks: [...timeline.tracks.filter((track) => !idsToReplace.has(track.id)), ...additions] }
}

export function removeObjectTracks(timelineValue: PropertyTimeline | undefined, objectId: string): PropertyTimeline {
  const timeline = ensurePropertyTimeline(timelineValue)
  const trajectories = { ...(timeline.trajectories ?? {}) }
  delete trajectories[objectId]
  return { ...timeline, trajectories, tracks: timeline.tracks.filter((track) => track.objectId !== objectId) }
}

export function valueAt(scene: DirectorScene, objectKind: 'character' | 'camera', objectId: string, property: PropertyName, component?: 0 | 1 | 2): KeyframeValue | undefined {
  const object = objectKind === 'character'
    ? scene.characters.find((item) => item.id === objectId)
    : scene.cameras.find((item) => item.id === objectId)
  const value = (object as any)?.[property]
  if (typeof value === 'number') return value
  if (Array.isArray(value) && value.length >= 3) return component == null ? [Number(value[0]), Number(value[1]), Number(value[2])] : Number(value[component])
  if (property === 'pose' && value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => Array.isArray(item) && item.length >= 3).map(([key, item]) => [key, [Number((item as number[])[0]), Number((item as number[])[1]), Number((item as number[])[2])]]))
  }
  if (property === 'pose') return {}
  if (property === 'rotation') return [0, 0, 0]
  return undefined
}

export function setKeyframe(timelineValue: PropertyTimeline | undefined, scene: DirectorScene, objectKind: 'character' | 'camera', objectId: string, property: PropertyName, time: number, component?: 0 | 1 | 2): PropertyTimeline {
  const timeline = ensurePropertyTimeline(timelineValue)
  const value = valueAt(scene, objectKind, objectId, property, component)
  if (value === undefined) return timeline
  const id = trackId(objectId, property, component)
  const existing = timeline.tracks.find((track) => track.id === id)
  const keyframe = { time: Math.max(0, Math.min(timeline.duration, time)), value }
  const keyframes = [...(existing?.keyframes ?? []).filter((item) => Math.abs(item.time - keyframe.time) > 0.001), keyframe].sort((a, b) => a.time - b.time)
  const track: PropertyTrack = { id, objectId, objectKind, property, component, keyframes }
  return { ...timeline, tracks: [...timeline.tracks.filter((item) => item.id !== id), track] }
}

export function removeKeyframe(timelineValue: PropertyTimeline | undefined, objectId: string, property: PropertyName, time: number, component?: 0 | 1 | 2): PropertyTimeline {
  const timeline = ensurePropertyTimeline(timelineValue)
  const ids = component == null
    ? new Set([trackId(objectId, property), trackId(objectId, property, 0), trackId(objectId, property, 1), trackId(objectId, property, 2)])
    : new Set([trackId(objectId, property, component), trackId(objectId, property)])
  return { ...timeline, tracks: timeline.tracks.map((track) => ids.has(track.id) ? { ...track, keyframes: track.keyframes.filter((item) => Math.abs(item.time - time) > 0.02) } : track) }
}

export function setPropertyKeyframes(timelineValue: PropertyTimeline | undefined, scene: DirectorScene, objectKind: 'character' | 'camera', objectId: string, property: PropertyName, time: number): PropertyTimeline {
  if (!VECTOR_PROPERTIES.has(property)) return setKeyframe(timelineValue, scene, objectKind, objectId, property, time)
  let timeline = ensurePropertyTimeline(timelineValue)
  for (const component of [0, 1, 2] as const) timeline = setKeyframe(timeline, scene, objectKind, objectId, property, time, component)
  return timeline
}

export function hasKeyframeAt(timelineValue: PropertyTimeline | undefined, objectId: string, property: PropertyName, time: number, component?: 0 | 1 | 2): boolean {
  const timeline = ensurePropertyTimeline(timelineValue)
  const ids = component == null
    ? new Set([trackId(objectId, property), trackId(objectId, property, 0), trackId(objectId, property, 1), trackId(objectId, property, 2)])
    : new Set([trackId(objectId, property, component), trackId(objectId, property)])
  return timeline.tracks.some((track) => ids.has(track.id) && track.keyframes.some((keyframe) => Math.abs(keyframe.time - time) <= 0.02))
}

/** Replace an object's position track from the LibTV viewport trajectory editor. */
export function setPositionTrajectory(
  timelineValue: PropertyTimeline | undefined,
  objectKind: 'character' | 'camera',
  objectId: string,
  path: GroundPath,
  yAt: (x: number, z: number) => number,
): PropertyTimeline {
  const timeline = ensurePropertyTimeline(timelineValue)
  const id = trackId(objectId, 'position')
  const positionIds = new Set([id, trackId(objectId, 'position', 0), trackId(objectId, 'position', 1), trackId(objectId, 'position', 2)])
  const trajectories = { ...(timeline.trajectories ?? {}) }
  if (!path.waypoints.length) {
    delete trajectories[objectId]
    return { ...timeline, trajectories, tracks: timeline.tracks.filter((track) => track.id !== id) }
  }
  trajectories[objectId] = { waypoints: path.waypoints.map((point) => [point[0], point[1]]), mode: path.mode, closed: path.closed }
  const totalLength = pathLength(path)
  let samples: Array<{ ratio: number; x: number; z: number }>
  if (path.mode === 'curve' && path.waypoints.length >= 3) {
    const count = Math.max(24, (path.waypoints.length - 1) * 12)
    samples = Array.from({ length: count + 1 }, (_, index) => {
      const ratio = index / count
      const sampled = samplePathAt(path, ratio).pos
      return { ratio, x: sampled[0], z: sampled[1] }
    })
  } else {
    let distance = 0
    samples = path.waypoints.map((point, index) => {
      if (index > 0) distance += Math.hypot(point[0] - path.waypoints[index - 1][0], point[1] - path.waypoints[index - 1][1])
      return { ratio: totalLength > 1e-9 ? distance / totalLength : index / Math.max(1, path.waypoints.length - 1), x: point[0], z: point[1] }
    })
  }
  const keyframes: PropertyKeyframe[] = samples.map((sample) => ({
    time: sample.ratio * timeline.duration,
    value: [sample.x, yAt(sample.x, sample.z), sample.z],
  }))
  const track: PropertyTrack = { id, objectId, objectKind, property: 'position', keyframes }
  return { ...timeline, trajectories, tracks: [...timeline.tracks.filter((item) => !positionIds.has(item.id)), track] }
}

const mixValue = (a: KeyframeValue, b: KeyframeValue, amount: number): KeyframeValue => {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * amount
  if (Array.isArray(a) && Array.isArray(b)) return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
  if (!Array.isArray(a) && !Array.isArray(b) && typeof a === 'object' && typeof b === 'object') {
    const result: PoseValue = {}
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const av = (a as PoseValue)[key] ?? [0, 0, 0]
      const bv = (b as PoseValue)[key] ?? [0, 0, 0]
      result[key] = [mixAngle(av[0], bv[0], amount, Math.PI * 2), mixAngle(av[1], bv[1], amount, Math.PI * 2), mixAngle(av[2], bv[2], amount, Math.PI * 2)]
    }
    return result
  }
  return a
}

const mixAngle = (from: number, to: number, amount: number, period: number): number => {
  let delta = (to - from) % period
  if (delta > period / 2) delta -= period
  if (delta < -period / 2) delta += period
  return from + delta * amount
}

const mixRotation = (a: KeyframeValue, b: KeyframeValue, amount: number, period: number): KeyframeValue => {
  if (!Array.isArray(a) || !Array.isArray(b)) return mixValue(a, b, amount)
  return [mixAngle(a[0], b[0], amount, period), mixAngle(a[1], b[1], amount, period), mixAngle(a[2], b[2], amount, period)]
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
    const amount = (time - previous.time) / Math.max(0.0001, next.time - previous.time)
    if (track.property === 'rotation') {
      const period = track.objectKind === 'camera' ? 360 : Math.PI * 2
      if (typeof previous.value === 'number' && typeof next.value === 'number') return mixAngle(previous.value, next.value, amount, period)
      return mixRotation(previous.value, next.value, amount, period)
    }
    return mixValue(previous.value, next.value, amount)
  }
  return keys[keys.length - 1].value
}

export function samplePropertyTimeline(scene: DirectorScene, time: number): DirectorScene {
  const timeline = ensurePropertyTimeline(scene.propertyTimeline)
  if (!timeline.tracks.length) return scene
  const characterPatches = new Map<string, Partial<CharacterObj>>()
  const cameraPatches = new Map<string, Partial<CameraObj>>()
  // Legacy whole-vector tracks establish the base first; component tracks are
  // applied second so a newly keyed X/Y/Z axis deterministically overrides
  // only that axis even when old project data contains both formats.
  const orderedTracks = [...timeline.tracks].sort((a, b) => Number(a.component != null) - Number(b.component != null))
  for (const track of orderedTracks) {
    const value = sampleTrack(track, time)
    if (value === undefined) continue
    const target = track.objectKind === 'character' ? characterPatches : cameraPatches
    const currentPatch = target.get(track.objectId) ?? {}
    if (track.component != null && typeof value === 'number') {
      const sourceObject = track.objectKind === 'character' ? scene.characters.find((item) => item.id === track.objectId) : scene.cameras.find((item) => item.id === track.objectId)
      const currentVector = ((currentPatch as any)[track.property] ?? (sourceObject as any)?.[track.property] ?? [0, 0, 0]).slice() as Vec3
      currentVector[track.component] = value
      target.set(track.objectId, { ...currentPatch, [track.property]: currentVector })
    } else target.set(track.objectId, { ...currentPatch, [track.property]: value, ...(track.property === 'pose' ? { posePresetId: undefined } : {}) })
  }
  return {
    ...scene,
    characters: scene.characters.map((item) => ({ ...item, ...(characterPatches.get(item.id) ?? {}) })),
    cameras: scene.cameras.map((item) => ({ ...item, ...(cameraPatches.get(item.id) ?? {}) })),
  }
}
