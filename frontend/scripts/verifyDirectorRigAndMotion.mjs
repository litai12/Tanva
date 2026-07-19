import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetRoot = (process.env.DIRECTOR_ASSET_PUBLIC_BASE_URL
  || 'https://tanvas-ai.tos-cn-guangzhou.volces.com/director-assets/v1')
  .replace(/\/+$/, '')
const models = [
  ['quaternius-universal-base/Superhero_Male_FullBody.gltf', ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r']],
  ['quaternius-universal-base/Superhero_Female_FullBody.gltf', ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r']],
  ...['Viking_Male', 'Knight_Male', 'Ninja_Female', 'Elf', 'Goblin_Male', 'Goblin_Female'].map((name) => [
    `quaternius-ultimate-animated/${name}.gltf`,
    ['UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R'],
  ]),
]

for (const [relative, required] of models) {
  const response = await fetch(`${assetRoot}/open-source/${relative}`)
  assert.equal(response.ok, true, `${relative} remote asset returned HTTP ${response.status}`)
  const gltf = await response.json()
  const names = new Set((gltf.nodes ?? []).map((node) => node.name))
  for (const bone of required) assert.ok(names.has(bone), `${relative} missing required IK bone ${bone}`)
}

// Guard the absolute-time trajectory path specifically: this is the path used
// by timeline playback and capture evaluation. A previous early return after
// applyMotion silently skipped Gaussian grounding/foot locking here.
const characterObjectSource = await readFile(
  resolve(root, 'src/components/flow/nodes/directorConsole/scene/CharacterObject.tsx'),
  'utf8',
)
assert.match(
  characterObjectSource,
  /if \(drivenTime != null && drivenTime >= 0\) \{[\s\S]*?applyMotion\(mc, drivenTime\)[\s\S]*?solveFootGrounding\([\s\S]*?return/,
  'absolute-time walk/run evaluation must apply foot grounding before returning',
)

const temporary = await mkdtemp(join(tmpdir(), 'tanva-director-motion-'))
try {
  const output = join(temporary, 'trajectoryMotion.mjs')
  await build({
    entryPoints: [resolve(root, 'src/components/flow/nodes/directorConsole/state/trajectoryMotion.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: output,
    logLevel: 'silent',
  })
  const motion = await import(`${pathToFileURL(output).href}?v=${Date.now()}`)
  assert.deepEqual(motion.resolveTrajectoryGait(0), { playbackRate: 1 })
  assert.deepEqual(motion.resolveTrajectoryGait(1.4), { clip: 'walk', playbackRate: 1 })
  assert.deepEqual(motion.resolveTrajectoryGait(3.2), { clip: 'run', playbackRate: 1 })
  assert.deepEqual(motion.resolveTrajectoryGait(10), { clip: 'run', playbackRate: 3 })
  assert.deepEqual(motion.resolveTrajectoryGait(2, { autoGait: false }), { playbackRate: 1 })
  const defaults = motion.resolveTrajectoryMotion()
  assert.ok(defaults.footLockDistance < defaults.footReleaseDistance, 'foot contact hysteresis must lock before it releases')
  assert.ok(defaults.ikWeight >= 0 && defaults.ikWeight <= 1)
  assert.ok(defaults.footSlopeWeight >= 0 && defaults.footSlopeWeight <= 1)
} finally {
  await rm(temporary, { recursive: true, force: true })
}

console.log(`Director rig/motion verification passed: ${models.length} remote TOS rigs, gait thresholds/rates, absolute-time IK, defaults and foot-lock hysteresis`)
