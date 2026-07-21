import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'tanva-director-timeline-'))
const output = join(temporary, 'propertyTimeline.mjs')

try {
  await build({
    entryPoints: [resolve(root, 'src/components/flow/nodes/directorConsole/state/propertyTimeline.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: { '@': resolve(root, 'src') },
    outfile: output,
    logLevel: 'silent',
  })
  const timelineModule = await import(`${pathToFileURL(output).href}?v=${Date.now()}`)
  const scene = {
    characters: [{ id: 'character', position: [0, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1], uniformScale: 1 }],
    cameras: [{ id: 'camera', position: [0, 2, 10], rotation: [0, 350, 0], fovDeg: 50, lookAt: [0, 1, 0] }],
    activeCameraId: 'camera',
    aspect: 'auto',
  }

  let timeline = timelineModule.addObjectTracks(undefined, scene, 'character', 'character', 0)
  const positionTracks = timeline.tracks.filter((track) => track.objectId === 'character' && track.property === 'position')
  assert.deepEqual(positionTracks.map((track) => track.component), [0, 1, 2], 'new position track must contain X/Y/Z components')
  assert.ok(timeline.tracks.every((track) => track.keyframes.length === 0), 'new tracks must start without implicit keyframes')

  timeline = timelineModule.setKeyframe(timeline, scene, 'character', 'character', 'position', 0, 0)
  const movedScene = { ...scene, characters: [{ ...scene.characters[0], position: [10, 99, 88] }] }
  timeline = timelineModule.setKeyframe(timeline, movedScene, 'character', 'character', 'position', 10, 0)
  let sampled = timelineModule.samplePropertyTimeline({ ...scene, propertyTimeline: timeline }, 5)
  assert.deepEqual(sampled.characters[0].position, [5, 2, 3], 'X-only animation must not alter Y/Z')

  let cameraTimeline = timelineModule.setKeyframe(undefined, scene, 'camera', 'camera', 'rotation', 0, 1)
  const cameraEndScene = { ...scene, cameras: [{ ...scene.cameras[0], rotation: [0, 10, 0] }] }
  cameraTimeline = timelineModule.setKeyframe(cameraTimeline, cameraEndScene, 'camera', 'camera', 'rotation', 10, 1)
  sampled = timelineModule.samplePropertyTimeline({ ...scene, propertyTimeline: cameraTimeline }, 5)
  assert.equal(sampled.cameras[0].rotation[1], 360, '350°→10° component rotation must take the 20° shortest arc')

  const mixedTimeline = {
    duration: 10,
    tracks: [
      { id: 'character:position', objectId: 'character', objectKind: 'character', property: 'position', keyframes: [{ time: 0, value: [1, 2, 3] }] },
      { id: 'character:position:0', objectId: 'character', objectKind: 'character', property: 'position', component: 0, keyframes: [{ time: 0, value: 7 }] },
    ],
  }
  sampled = timelineModule.samplePropertyTimeline({ ...scene, propertyTimeline: mixedTimeline }, 0)
  assert.deepEqual(sampled.characters[0].position, [7, 2, 3], 'component track must override only its legacy vector axis')

  const path = { waypoints: [[0, 0], [0, 4], [4, 4]], mode: 'curve' }
  const trajectoryTimeline = timelineModule.setPositionTrajectory(undefined, 'character', 'character', path, () => 2)
  const positionTrack = trajectoryTimeline.tracks.find((track) => track.id === 'character:position')
  const headingTrack = trajectoryTimeline.tracks.find((track) => track.id === 'character:rotation:1')
  assert.ok(positionTrack?.keyframes.length > 2, 'character trajectory must compile position samples')
  assert.equal(headingTrack?.keyframes.length, positionTrack.keyframes.length, 'position and face heading must use the same path ratios')
  assert.deepEqual(headingTrack.keyframes.map((keyframe) => keyframe.time), positionTrack.keyframes.map((keyframe) => keyframe.time), 'position and face heading keyframes must remain time-locked through bends')
  const straightZ = timelineModule.setPositionTrajectory(undefined, 'character', 'character', { waypoints: [[0, 0], [0, 4]], mode: 'linear' }, () => 2)
  assert.equal(straightZ.tracks.find((track) => track.id === 'character:rotation:1')?.keyframes[0].value, 0, 'a +Z path must face the model forward axis along +Z')
  const straightX = timelineModule.setPositionTrajectory(undefined, 'character', 'character', { waypoints: [[0, 0], [4, 0]], mode: 'linear' }, () => 2)
  const straightXHeading = straightX.tracks.find((track) => track.id === 'character:rotation:1')?.keyframes.at(-1)?.value
  assert.ok(Math.abs(straightXHeading - Math.PI / 2) < 1e-9, 'a +X path must face +X')
  sampled = timelineModule.samplePropertyTimeline({ ...scene, propertyTimeline: trajectoryTimeline }, 10)
  assert.equal(sampled.characters[0].rotation[1], headingTrack.keyframes.at(-1).value, 'timeline playback must apply the compiled path heading')

  const reverseTimeline = timelineModule.setPositionTrajectory(undefined, 'character', 'character', { waypoints: [[0, 0], [0, 4]], mode: 'linear', facingMode: 'reverse' }, () => 2)
  sampled = timelineModule.samplePropertyTimeline({ ...scene, propertyTimeline: reverseTimeline }, 5)
  assert.deepEqual(sampled.characters[0].position, [0, 0, 2], 'runtime trajectory sampling must place the root exactly on the original path at the current ratio')
  assert.ok(Math.abs(sampled.characters[0].rotation[1] - Math.PI) < 1e-9, 'reverse facing must look opposite the exact runtime tangent')

  const fixedTimeline = timelineModule.setPositionTrajectory(undefined, 'character', 'character', { waypoints: [[0, 0], [4, 0]], mode: 'linear', facingMode: 'fixed', fixedHeading: 0.75, facingOffset: 0.25 }, () => 2)
  sampled = timelineModule.samplePropertyTimeline({ ...scene, propertyTimeline: fixedTimeline }, 5)
  assert.equal(sampled.characters[0].rotation[1], 1, 'fixed facing must preserve its captured heading plus explicit offset')

  console.log('Director property timeline verification passed: components, axis isolation, shortest arc, legacy precedence, trajectory position/heading lock')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
