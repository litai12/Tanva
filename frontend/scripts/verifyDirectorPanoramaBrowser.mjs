import { chromium } from 'playwright'

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

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  if (saved?.scene?.skybox !== generatedUrl) throw new Error(`Generated panorama was not persisted: ${saved?.scene?.skybox}`)

  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  const reloadedUrl = await modal.getAttribute('data-skybox-url')
  if (reloadedUrl !== generatedUrl) throw new Error(`Connected input overrode generated panorama after reload: ${reloadedUrl}`)

  console.log(JSON.stringify({
    ok: true,
    connectedInputInitiallyRendered: true,
    generatedPanoramaApplied: true,
    generatedPanoramaPersisted: true,
    generatedPanoramaWonAfterReload: true,
    effectiveUrl: reloadedUrl,
  }, null, 2))
} finally {
  await browser.close()
}
