import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'tanva-director-output-'))
const output = join(temporary, 'outputProtocol.mjs')

try {
  await build({
    entryPoints: [resolve(root, 'src/components/flow/nodes/directorConsole/outputProtocol.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: output,
    logLevel: 'silent',
  })
  const protocol = await import(`${pathToFileURL(output).href}?v=${Date.now()}`)
  const request = protocol.buildDirectorImageNodeRequest(
    'director-1',
    { x: 100, y: 200 },
    { name: '机位1-截图01', imageUrl: 'https://assets.example/director-shot.jpg' },
    2,
  )
  assert.deepEqual(request, {
    imageUrl: 'https://assets.example/director-shot.jpg',
    label: '机位1-截图01',
    imageName: '机位1-截图01',
    worldPosition: { x: 620, y: 760 },
    sourceNodeId: 'director-1',
    sourceHandle: 'source',
    targetHandle: 'img',
  })
  assert.equal(
    protocol.buildDirectorImageNodeRequest('director-1', null, { name: '截图', imageUrl: 'https://assets.example/a.jpg' }, 0).worldPosition,
    undefined,
    'headless capture must allow FlowOverlay to choose the output position',
  )

  const runnerSource = await readFile(resolve(root, 'src/components/flow/nodes/directorConsole/DirectorCaptureRunner.tsx'), 'utf8')
  assert.match(
    runnerSource,
    /const createdIds = await sendShotsToCanvas\(\s*job\.nodeId,\s*null,\s*\[/,
    'offscreen capture must await the current three-argument output API before reporting success',
  )
  assert.match(
    runnerSource,
    /if \(createdIds\.length !== 1\) throw new Error/,
    'offscreen capture must reject a missing image node',
  )

  console.log('Director output protocol verification passed: remote image payload, source→img handles, placement, awaited headless output')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
