import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = process.env.DIRECTOR_VERIFY_BASE_URL || 'http://127.0.0.1:5173'
const generatedUrl = 'https://acceptance.invalid/generated-panorama.png'
const svg = (color) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="${color}"/></svg>`)
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1470, height: 900 }, deviceScaleFactor: 1 })
  await page.addInitScript(() => {
    window.__directorPanoramaStatuses = []
    window.addEventListener('director:panorama-status', (event) => window.__directorPanoramaStatuses.push(event.detail))
    if (!sessionStorage.getItem('director-panorama-acceptance-initialized')) {
      localStorage.removeItem('tanva:director-full-harness:v1')
      sessionStorage.setItem('director-panorama-acceptance-initialized', '1')
    }
  })
  await page.route('**/api/ai/generate-image', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ imageUrl: generatedUrl }),
  }))
  await page.route('**/api/assets/proxy?*', (route) => {
    const requestUrl = new URL(route.request().url())
    const source = requestUrl.searchParams.get('url') || ''
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(source.includes('generated-panorama') ? '#dc2626' : '#2563eb') })
  })
  await page.route('https://acceptance.invalid/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg('#dc2626') }))

  await page.goto(`${baseUrl}/director-harness?full=1&io=1`, { waitUntil: 'networkidle' })
  const modal = page.getByTestId('director-console-modal')
  await modal.waitFor()
  await page.waitForFunction(() => document.querySelector('[data-testid="director-console-modal"]')?.getAttribute('data-skybox-url')?.includes('panorama.jpg'))

  await page.getByTitle('全景背景').click()
  await page.getByRole('button', { name: 'AI生成', exact: true }).click()
  await page.getByRole('textbox', { name: '描述需要的 360° 场景环境' }).fill('雨后霓虹街道')
  await page.getByRole('button', { name: '生成全景图', exact: true }).click()
  await page.getByText('AI 全景图已生成并应用', { exact: true }).waitFor({ timeout: 10000 })
  await page.waitForFunction((url) => document.querySelector('[data-testid="director-console-modal"]')?.getAttribute('data-skybox-url') === url, generatedUrl)
  await page.waitForFunction((url) => window.__directorPanoramaStatuses?.some((item) => item.url === url && item.status === 'ready'), generatedUrl)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const renderedPixels = await page.getByTestId('director-main-viewport').locator('canvas').first().evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    const pixels = []
    for (const x of [0.2, 0.4, 0.6, 0.8]) for (const y of [0.2, 0.4, 0.6, 0.8]) {
      const pixel = new Uint8Array(4)
      gl.readPixels(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      pixels.push(Array.from(pixel))
    }
    return pixels
  })
  const redPixelCount = renderedPixels.filter((pixel) => pixel[0] > pixel[1] * 1.5 && pixel[0] > pixel[2] * 1.5).length
  if (redPixelCount < 4) {
    const statuses = await page.evaluate(() => window.__directorPanoramaStatuses)
    throw new Error(`Generated panorama URL became active but its red sphere was not rendered: pixels=${JSON.stringify(renderedPixels)}, statuses=${JSON.stringify(statuses)}`)
  }

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  if (saved?.scene?.skybox !== generatedUrl) throw new Error(`Generated panorama was not persisted: ${saved?.scene?.skybox}`)
  // Radius 10 is smaller than the default director-camera distance (~15).
  // A world-origin BackSide sphere becomes completely invisible here; a real
  // sky sphere must follow the active viewpoint and remain visible.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('tanva:director-full-harness:v1'))
    saved.scene.skyRadius = 10
    localStorage.setItem('tanva:director-full-harness:v1', JSON.stringify(saved))
  })

  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  const reloadedUrl = await modal.getAttribute('data-skybox-url')
  if (reloadedUrl !== generatedUrl) throw new Error(`Connected input overrode generated panorama after reload: ${reloadedUrl}`)
  await page.waitForFunction((url) => window.__directorPanoramaStatuses?.some((item) => item.url === url && item.status === 'ready'), generatedUrl)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const outsideRadiusPixel = await page.getByTestId('director-main-viewport').locator('canvas').first().evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    const pixel = new Uint8Array(4)
    gl.readPixels(Math.floor(canvas.width * 0.2), Math.floor(canvas.height * 0.8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return Array.from(pixel)
  })
  if (!(outsideRadiusPixel[0] > outsideRadiusPixel[1] * 1.5 && outsideRadiusPixel[0] > outsideRadiusPixel[2] * 1.5)) {
    throw new Error(`Panorama disappeared when camera was outside radius 10: ${outsideRadiusPixel}`)
  }
  const evidenceDir = resolve('tmp/director-acceptance')
  await mkdir(evidenceDir, { recursive: true })
  const screenshotPath = resolve(evidenceDir, 'director-panorama-visible.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })

  console.log(JSON.stringify({
    ok: true,
    connectedInputInitiallyRendered: true,
    generatedPanoramaApplied: true,
    generatedPanoramaPersisted: true,
    generatedPanoramaWonAfterReload: true,
    panoramaSphereRendered: true,
    panoramaVisibleOutsideConfiguredRadius: true,
    redPixelCount,
    effectiveUrl: reloadedUrl,
    screenshotPath,
  }, null, 2))
} finally {
  await browser.close()
}
