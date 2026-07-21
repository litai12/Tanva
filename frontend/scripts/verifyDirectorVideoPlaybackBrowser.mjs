import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.env.DIRECTOR_VERIFY_BASE_URL || 'http://127.0.0.1:5173'
const temporary = mkdtempSync(join(tmpdir(), 'director-video-playback-'))
const fixturePath = join(temporary, 'director-animation.webm')
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=1.2', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-an', fixturePath])
const fixture = readFileSync(fixturePath)

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})

const fulfillVideo = async (route) => {
  const range = route.request().headers().range
  if (!range) return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(fixture.length) }, body: fixture })
  const match = /bytes=(\d+)-(\d*)/.exec(range)
  const start = Number(match?.[1] || 0)
  const end = Math.min(fixture.length - 1, match?.[2] ? Number(match[2]) : fixture.length - 1)
  return route.fulfill({ status: 206, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${fixture.length}`, 'Content-Length': String(end - start + 1) }, body: fixture.subarray(start, end + 1) })
}

const doubleClickVideoCenter = (page, center) => page.getByTestId('video-canvas').evaluate((canvas, point) => {
  const rect = canvas.getBoundingClientRect()
  canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: rect.left + point.x, clientY: rect.top + point.y }))
}, center)

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 540 } })
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://acceptance.invalid/director-animation.webm', fulfillVideo)
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('director-video-acceptance-initialized')) {
      localStorage.removeItem('tanva:director-video-harness:v1')
      sessionStorage.setItem('director-video-acceptance-initialized', '1')
    }
    window.addEventListener('canvas:video-instances-changed', (event) => { window.__canvasVideoInstances = event.detail })
  })
  await page.goto(`${baseUrl}/director-harness?videoCanvas=1`, { waitUntil: 'networkidle' })
  await page.getByTestId('canvas-drawing-ready').waitFor({ state: 'attached' })
  await page.waitForTimeout(250)
  await page.getByTestId('insert-director-video').click()
  await page.waitForFunction(() => window.__canvasVideoInstances?.length === 1)
  const insertedCenter = await page.evaluate(() => window.__canvasVideoInstances[0].viewCenter)
  await doubleClickVideoCenter(page, insertedCenter)
  const player = page.getByTestId('canvas-video-element')
  await player.waitFor()
  await page.waitForFunction(() => {
    const video = document.querySelector('[data-testid="canvas-video-element"]')
    return video instanceof HTMLVideoElement && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  })
  const firstTime = await player.evaluate((video) => video.currentTime)
  await page.waitForTimeout(450)
  const advancedTime = await player.evaluate((video) => video.currentTime)
  if (!(advancedTime > firstTime + 0.15)) throw new Error(`Inserted video did not play: ${firstTime} → ${advancedTime}`)
  await page.keyboard.press('Escape')
  await page.getByTestId('canvas-video-player').waitFor({ state: 'detached' })

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__canvasVideoInstances?.length === 1)
  const reloadedCenter = await page.evaluate(() => window.__canvasVideoInstances[0].viewCenter)
  await doubleClickVideoCenter(page, reloadedCenter)
  await player.waitFor()
  await page.waitForFunction(() => {
    const video = document.querySelector('[data-testid="canvas-video-element"]')
    return video instanceof HTMLVideoElement && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  })
  const reloadedStart = await player.evaluate((video) => video.currentTime)
  await page.waitForTimeout(450)
  const reloadedAdvanced = await player.evaluate((video) => video.currentTime)
  if (!(reloadedAdvanced > reloadedStart + 0.15)) throw new Error(`Reloaded video did not play: ${reloadedStart} → ${reloadedAdvanced}`)
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-video-harness:v1') || '[]'))
  if (snapshot.length !== 1 || snapshot[0].url !== 'https://acceptance.invalid/director-animation.webm') throw new Error(`Persisted video snapshot mismatch: ${JSON.stringify(snapshot)}`)
  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log(JSON.stringify({ ok: true, insertedVideoPlayed: true, remoteSnapshotPersisted: true, reloadedVideoHydrated: true, reloadedVideoPlayed: true, firstAdvance: advancedTime - firstTime, reloadedAdvance: reloadedAdvanced - reloadedStart }, null, 2))
} finally {
  await browser.close()
  rmSync(temporary, { recursive: true, force: true })
}
