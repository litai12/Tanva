import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const baseUrl = process.env.DIRECTOR_VERIFY_BASE_URL || 'http://127.0.0.1:5173'
const evidenceDir = resolve(process.env.DIRECTOR_EVIDENCE_DIR || 'tmp/director-acceptance')
await mkdir(evidenceDir, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1470, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${baseUrl}/director-harness`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '显示八套独立素体' }).click()
  await page.waitForTimeout(8000)
  await page.getByRole('button', { name: '配置八体轨迹运动验收' }).click()
  await page.waitForTimeout(3000)
  await page.waitForFunction(() => Object.keys(window.__directorFootDiagnostics || {}).length === 16, null, { timeout: 10000 })
  const playhead = page.getByRole('slider', { name: '属性时间线播放头' })
  const canvasLocator = page.locator('canvas')
  const checkpoints = [0, 0.65, 2, 3.99]
  const frames = []
  for (const time of checkpoints) {
    await playhead.fill(String(time))
    await page.waitForTimeout(350)
    const buffer = await canvasLocator.screenshot()
    const filename = `eight-bodies-motion-${time.toFixed(2).replace('.', '_')}s.png`
    await writeFile(resolve(evidenceDir, filename), buffer)
    const diagnostics = await page.evaluate(() => Object.entries(window.__directorFootDiagnostics || {}).map(([id, value]) => ({ id, ...value })))
    if (diagnostics.length !== 16) throw new Error(`Expected 16 post-IK foot diagnostics at ${time}s, received ${diagnostics.length}`)
    if (diagnostics.some((entry) => !entry.finite)) throw new Error(`Non-finite hip/knee/foot result at ${time}s`)
    const maxHorizontalError = Math.max(...diagnostics.map((entry) => entry.lockHorizontalError))
    const maxVerticalError = Math.max(...diagnostics.map((entry) => entry.verticalError))
    if (maxHorizontalError > 0.02) throw new Error(`Post-IK/foot-lock horizontal error ${maxHorizontalError.toFixed(4)}m exceeds 0.02m at ${time}s`)
    if (maxVerticalError > 0.05) throw new Error(`Measured skinned-mesh sole error ${maxVerticalError.toFixed(4)}m exceeds 0.05m at ${time}s`)
    frames.push({
      time,
      filename,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      maxVerticalError,
      maxHorizontalError,
      lockedFeet: diagnostics.filter((entry) => entry.locked).length,
      worstVerticalFoot: diagnostics.reduce((worst, entry) => entry.verticalError > worst.verticalError ? entry : worst),
      buffer,
    })
  }
  // Scrubbing back to the exact start must restore the exact same evaluated
  // frame. This catches accumulated mixer/root motion and loop-boundary drift.
  await playhead.fill('0')
  await page.waitForTimeout(350)
  const loopFrame = await canvasLocator.screenshot()
  await writeFile(resolve(evidenceDir, 'eight-bodies-motion-loop-0_00s.png'), loopFrame)
  if (!loopFrame.equals(frames[0].buffer)) throw new Error('Scrubbing 3.99s → 0s did not restore the deterministic initial canvas frame')
  const canvas = await page.locator('canvas').evaluate((element) => {
    const context = element.getContext('webgl2') || element.getContext('webgl')
    const pixels = new Uint8Array(4)
    context?.readPixels(Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixels)
    return { width: element.width, height: element.height, centerPixel: [...pixels] }
  })
  await playhead.fill('2')
  await page.waitForTimeout(350)
  await page.screenshot({ path: resolve(evidenceDir, 'eight-bodies-motion-midpoint.png'), fullPage: true })
  const visibleText = await page.locator('body').innerText()
  if (!visibleText.includes('角色数 8')) throw new Error(`Expected eight characters, got: ${visibleText.slice(-300)}`)
  if (canvas.width <= 0 || canvas.height <= 0) throw new Error('Director WebGL canvas has no backing size')
  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  if (!visibleText.includes('eight-body motion acceptance configured at 2.00s')) throw new Error('Motion acceptance fixture was not applied')

  // Repeat the same deterministic evaluation on a registered Gaussian point
  // cloud slope. samplePropertyTimeline must move/pitch/roll the root while the
  // post-animation IK keeps the measured skinned-mesh soles on the surface.
  await page.getByRole('button', { name: '验证高斯坡面高度索引' }).click()
  await page.waitForTimeout(1000)
  const slopeFrames = []
  for (const time of checkpoints) {
    await playhead.fill(String(time))
    await page.waitForTimeout(500)
    const buffer = await canvasLocator.screenshot()
    const filename = `eight-bodies-slope-${time.toFixed(2).replace('.', '_')}s.png`
    await writeFile(resolve(evidenceDir, filename), buffer)
    const diagnostics = await page.evaluate(() => Object.entries(window.__directorFootDiagnostics || {}).map(([id, value]) => ({ id, ...value })))
    if (diagnostics.length !== 16) throw new Error(`Expected 16 slope foot diagnostics at ${time}s, received ${diagnostics.length}`)
    if (diagnostics.some((entry) => !entry.finite)) throw new Error(`Non-finite slope hip/knee/foot result at ${time}s`)
    const maxHorizontalError = Math.max(...diagnostics.map((entry) => entry.lockHorizontalError))
    const maxVerticalError = Math.max(...diagnostics.map((entry) => entry.verticalError))
    const maxNormalAngleErrorDeg = Math.max(...diagnostics.map((entry) => entry.normalAngleErrorDeg))
    if (maxHorizontalError > 0.02) throw new Error(`Slope foot-lock horizontal error ${maxHorizontalError.toFixed(4)}m exceeds 0.02m at ${time}s`)
    if (maxVerticalError > 0.05) throw new Error(`Slope measured sole error ${maxVerticalError.toFixed(4)}m exceeds 0.05m at ${time}s`)
    if (maxNormalAngleErrorDeg > 1) throw new Error(`Slope sole-normal error ${maxNormalAngleErrorDeg.toFixed(3)}° exceeds 1° at ${time}s`)
    slopeFrames.push({ time, filename, sha256: createHash('sha256').update(buffer).digest('hex'), maxVerticalError, maxHorizontalError, maxNormalAngleErrorDeg, lockedFeet: diagnostics.filter((entry) => entry.locked).length, buffer })
  }
  await playhead.fill('0')
  await page.waitForTimeout(500)
  const slopeLoopFrame = await canvasLocator.screenshot()
  await writeFile(resolve(evidenceDir, 'eight-bodies-slope-loop-0_00s.png'), slopeLoopFrame)
  if (!slopeLoopFrame.equals(slopeFrames[0].buffer)) throw new Error('Gaussian slope scrub 3.99s → 0s did not restore the deterministic initial frame')
  console.log(JSON.stringify({
    ok: true,
    canvas,
    checkpoints: frames.map(({ time, filename, sha256, maxVerticalError, maxHorizontalError, lockedFeet, worstVerticalFoot }) => ({ time, filename, sha256, maxVerticalError, maxHorizontalError, lockedFeet, worstVerticalFoot })),
    loopStartSha256: createHash('sha256').update(loopFrame).digest('hex'),
    slopeCheckpoints: slopeFrames.map(({ time, filename, sha256, maxVerticalError, maxHorizontalError, maxNormalAngleErrorDeg, lockedFeet }) => ({ time, filename, sha256, maxVerticalError, maxHorizontalError, maxNormalAngleErrorDeg, lockedFeet })),
    slopeLoopStartSha256: createHash('sha256').update(slopeLoopFrame).digest('hex'),
    evidence: resolve(evidenceDir, 'eight-bodies-motion-midpoint.png'),
  }, null, 2))
} finally {
  await browser.close()
}
