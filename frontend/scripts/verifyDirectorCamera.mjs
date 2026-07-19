import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { build } from 'esbuild'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'tanva-director-camera-'))
try {
  const output = join(temporary, 'cameraPose.mjs')
  await build({ entryPoints: [resolve(root, 'src/components/flow/nodes/directorConsole/state/cameraPose.ts')], bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' })
  const { resolveCameraPose } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`)
  const character = { id: 'actor', position: [2, 0, -1] }
  const scene = { characters: [character] }
  const base = { id: 'cam', name: 'cam', position: [4, 2, 8], rotation: [10, 170, 2], lookAtMode: 'manual', lookAt: [0, 1, 0], fovDeg: 45 }
  assert.deepEqual(resolveCameraPose(base, scene), { position: [4, 2, 8], rotation: [10, 170, 2], lookAt: [0, 1, 0], fovDeg: 45 })
  assert.deepEqual(resolveCameraPose({ ...base, lookAtMode: 'rotation' }, scene), { position: [4, 2, 8], rotation: [10, 170, 2], fovDeg: 45 })
  assert.deepEqual(resolveCameraPose({ ...base, lookAtMode: 'actor' }, scene).lookAt, [2, 1.2, -1])
  assert.deepEqual(resolveCameraPose({ ...base, followTargetId: 'actor', followOffset: [1, 2, 6] }, scene).position, [3, 2, 5])
} finally {
  await rm(temporary, { recursive: true, force: true })
}

const baseUrl = process.env.DIRECTOR_VERIFY_BASE_URL || 'http://127.0.0.1:5173'
const evidenceDir = resolve(process.env.DIRECTOR_EVIDENCE_DIR || 'tmp/director-acceptance')
await mkdir(evidenceDir, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1470, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${baseUrl}/director-harness`, { waitUntil: 'networkidle' })
  const canvas = page.locator('canvas')
  const audit = page.getByTestId('director-camera-audit')
  const cases = [
    ['相机验收：手动坐标', 'manual', [4, 2, 8], 45],
    ['相机验收：手动旋转', 'rotation', [0, 2, 6], 45],
    ['相机验收：角色注视', 'target', [-4, 2, 7], 45],
    ['相机验收：跟随移动', 'follow', [3, 2, 6], 45],
    ['相机验收：FOV 25', 'fov25', [3, 2, 6], 25],
    ['相机验收：FOV 90', 'fov90', [3, 2, 6], 90],
  ]
  const frames = []
  for (const [button, label, expectedPosition, expectedFov] of cases) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await audit.filter({ hasText: `camera audit: ${label}:` }).waitFor({ timeout: 5000 })
    await page.waitForTimeout(350)
    const text = await audit.innerText()
    const pose = JSON.parse(text.slice(text.indexOf(`${label}:`) + label.length + 1))
    pose.position.forEach((value, index) => assert.ok(Math.abs(value - expectedPosition[index]) < 1e-5, `${label} position[${index}] ${value}`))
    assert.ok(Math.abs(pose.fovDeg - expectedFov) < 1e-5, `${label} FOV ${pose.fovDeg}`)
    const buffer = await canvas.screenshot()
    const redHelperPixels = await canvas.evaluate((element) => {
      const gl = element.getContext('webgl2') || element.getContext('webgl')
      if (!gl) return -1
      const pixels = new Uint8Array(element.width * element.height * 4)
      gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let count = 0
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] > 200 && pixels[index + 1] < 120 && pixels[index + 2] < 150 && pixels[index + 3] > 0) count++
      return count
    })
    assert.equal(redHelperPixels, 0, `${label} camera view must not contain the red trajectory direction helper`)
    const filename = `camera-${label}.png`
    await writeFile(resolve(evidenceDir, filename), buffer)
    frames.push({ label, filename, sha256: createHash('sha256').update(buffer).digest('hex'), redHelperPixels })
  }
  assert.equal(new Set(frames.map((frame) => frame.sha256)).size, frames.length, 'every camera mode/FOV must produce a distinct visual frame')
  await page.evaluate(() => localStorage.removeItem('tanva:director-full-harness:v1'))
  await page.goto(`${baseUrl}/director-harness?full=1`, { waitUntil: 'networkidle' })
  const modal = page.getByTestId('director-console-modal')
  await modal.waitFor()
  assert.equal(await modal.getByRole('group', { name: '视角切换' }).count(), 0, 'LibTV does not expose a director/camera viewpoint switch')
  assert.equal(await modal.getByRole('button', { name: /切换到机位视角/ }).count(), 0, 'camera inspector must render its preview directly')
  await modal.getByRole('button', { name: '机位1 隐藏 锁定', exact: true }).click()
  const selectedPreview = modal.getByTestId('selected-camera-preview')
  await selectedPreview.waitFor()
  const previewCanvas = selectedPreview.locator('canvas')
  await previewCanvas.waitFor()
  await page.waitForTimeout(500)
  const previewPixels = await previewCanvas.evaluate((element) => {
    const gl = element.getContext('webgl2') || element.getContext('webgl')
    if (!gl) return { width: 0, height: 0, nonBlack: 0, red: 0 }
    const pixels = new Uint8Array(element.width * element.height * 4)
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let nonBlack = 0, red = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 15) nonBlack++
      if (pixels[i] > 200 && pixels[i + 1] < 120 && pixels[i + 2] < 150) red++
    }
    return { width: element.width, height: element.height, nonBlack, red }
  })
  assert.ok(previewPixels.width > 0 && previewPixels.height > 0 && previewPixels.nonBlack > 100, `selected camera preview did not render: ${JSON.stringify(previewPixels)}`)
  assert.equal(previewPixels.red, 0, 'selected camera preview must not render trajectory direction helpers')
  const layout = await page.evaluate(() => {
    const box = (testId) => {
      const rect = document.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect()
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom } : null
    }
    const toolbarRect = document.querySelector('[aria-label="导演台工具栏"]')?.getBoundingClientRect()
    return { header: box('director-header'), workspace: box('director-workspace'), left: box('director-scene-sidebar'), viewport: box('director-main-viewport'), right: box('director-inspector-sidebar'), toolbar: toolbarRect ? { x: toolbarRect.x, y: toolbarRect.y, width: toolbarRect.width, height: toolbarRect.height, right: toolbarRect.right, bottom: toolbarRect.bottom } : null }
  })
  assert.equal(layout.header?.height, 48)
  assert.equal(layout.left?.width, 240)
  assert.equal(layout.right?.width, 320)
  assert.equal(layout.left?.bottom, 900, 'scene tree must extend behind the floating toolbar to the bottom edge')
  assert.equal(layout.right?.bottom, 900, 'inspector must extend behind the floating toolbar to the bottom edge')
  assert.ok(layout.toolbar.x >= layout.viewport.x && layout.toolbar.right <= layout.viewport.right, `toolbar escaped main viewport: ${JSON.stringify(layout)}`)
  assert.equal(layout.toolbar.bottom, 892, 'scene toolbar must float 8px above the viewport bottom')
  await page.screenshot({ path: resolve(evidenceDir, 'director-layout-camera-selected.png') })
  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log(JSON.stringify({ ok: true, pureCameraSemantics: true, directSelectedCameraPreview: true, legacyViewpointSwitchRemoved: true, previewPixels, layout, layoutEvidence: resolve(evidenceDir, 'director-layout-camera-selected.png'), distinctVisualFrames: frames }, null, 2))
} finally {
  await browser.close()
}
