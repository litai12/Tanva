import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
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
  let uploadSeen = false
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    class AcceptanceMediaRecorder {
      static isTypeSupported(type) { return type.startsWith('video/') }
      constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || 'video/webm'; this.state = 'inactive' }
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        const payload = new Blob(['deterministic-director-animation'], { type: this.mimeType.split(';')[0] })
        this.ondataavailable?.({ data: payload })
        queueMicrotask(() => this.onstop?.())
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: AcceptanceMediaRecorder })
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      value() { return { getTracks: () => [{ stop() {} }] } },
    })
    window.addEventListener('canvas:insert-video', (event) => { window.__directorInsertedVideo = event.detail })
  })
  await page.route('**/api/uploads/video', async (route) => {
    uploadSeen = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://acceptance.invalid/director-animation.mp4', key: 'director-animations/acceptance.mp4' }),
    })
  })
  await page.route('https://acceptance.invalid/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'video/mp4', body: 'deterministic-director-animation' })
  })
  await page.route('**/api/assets/proxy?*', async (route) => {
    await route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Content-Range': 'bytes 0-0/32' }, body: 'd' })
  })
  await page.goto(`${baseUrl}/director-harness?full=1&export=1`, { waitUntil: 'networkidle' })
  const modal = page.getByTestId('director-console-modal')
  await modal.waitFor()
  await page.getByTitle('动画时间轴').click()
  const exportButton = page.getByRole('button', { name: '导出到画布' })
  await exportButton.waitFor()
  const playhead = page.getByRole('textbox', { name: '播放头位置' })
  const duration = await page.getByRole('textbox', { name: '总时长' }).inputValue()
  if (duration !== '0.70') throw new Error(`Export fixture duration should be 0.70s, got ${duration}`)
  await playhead.fill('0')
  await page.waitForTimeout(500)
  const canvas = modal.locator('canvas').first()
  const before = await canvas.screenshot()
  await writeFile(resolve(evidenceDir, 'timeline-export-before.png'), before)
  await exportButton.click()
  await page.getByRole('button', { name: '导出中…' }).waitFor()
  await page.waitForTimeout(350)
  const during = await canvas.screenshot()
  await writeFile(resolve(evidenceDir, 'timeline-export-during.png'), during)
  if (during.equals(before)) throw new Error('Timeline export did not advance the shared preview canvas')
  const exportRedHelperPixels = await canvas.evaluate((element) => {
    const gl = element.getContext('webgl2') || element.getContext('webgl')
    if (!gl) return -1
    const pixels = new Uint8Array(element.width * element.height * 4)
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] > 200 && pixels[index + 1] < 120 && pixels[index + 2] < 150 && pixels[index + 3] > 0) count++
    return count
  })
  if (exportRedHelperPixels !== 0) throw new Error(`Export camera frame contains ${exportRedHelperPixels} red trajectory-helper pixels`)
  await page.waitForTimeout(2500)
  const insertedText = await page.getByTestId('director-harness-video').innerText()
  const insertedEvent = await page.evaluate(() => window.__directorInsertedVideo)
  if (insertedEvent?.asset?.url !== 'https://acceptance.invalid/director-animation.mp4') {
    const bodyText = await page.locator('body').innerText()
    throw new Error(`Export did not insert remote video (uploadSeen=${uploadSeen}, marker=${insertedText}): ${bodyText.slice(-500)}`)
  }
  await page.waitForTimeout(500)
  const after = await canvas.screenshot()
  await writeFile(resolve(evidenceDir, 'timeline-export-restored.png'), after)
  if (!after.equals(before)) throw new Error('Timeline export did not restore the exact pre-export playhead/viewpoint frame')
  if (!uploadSeen) throw new Error('Timeline export never uploaded its MediaRecorder blob')
  if (Number(await playhead.inputValue()) !== 0) throw new Error(`Timeline export did not restore playhead 0; got ${await playhead.inputValue()}`)
  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log(JSON.stringify({
    ok: true,
    sharedCanvasAdvanced: true,
    exactFrameRestored: true,
    remoteVideoInserted: true,
    trajectoryHelpersInExport: false,
    evidence: ['timeline-export-before.png', 'timeline-export-during.png', 'timeline-export-restored.png'].map((name) => resolve(evidenceDir, name)),
  }, null, 2))
} finally {
  await browser.close()
}
