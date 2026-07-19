import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const baseUrl = process.env.DIRECTOR_VERIFY_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1470, height: 900 } })
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('director-trajectory-acceptance-initialized')) {
      localStorage.removeItem('tanva:director-full-harness:v1')
      sessionStorage.setItem('director-trajectory-acceptance-initialized', '1')
    }
    window.addEventListener('director:trajectory-handles', (event) => {
      const rect = event.detail.canvas.getBoundingClientRect()
      window.__directorTrajectoryHandles = { handles: event.detail.handles, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    })
  })
  await page.goto(`${baseUrl}/director-harness?full=1`, { waitUntil: 'networkidle' })
  const modal = page.getByTestId('director-console-modal')
  await modal.waitFor()
  await modal.getByRole('button', { name: '角色A 隐藏 锁定', exact: true }).click()
  await page.getByTitle('动画时间轴').click()
  const timeline = page.getByTestId('timeline-panel')
  await timeline.getByRole('button', { name: '新建轨道', exact: true }).click()
  const characterRow = timeline.getByText('角色A', { exact: true }).locator('..')
  await characterRow.getByRole('button', { name: '绘制轨迹', exact: true }).click()
  await page.waitForFunction(() => window.__directorTrajectoryHandles?.handles?.length === 1)

  const initial = await page.evaluate(() => window.__directorTrajectoryHandles)
  await page.mouse.click(initial.rect.x + initial.rect.width * 0.68, initial.rect.y + initial.rect.height * 0.68)
  await page.waitForFunction(() => window.__directorTrajectoryHandles?.handles?.length === 2)
  const before = await page.evaluate(() => window.__directorTrajectoryHandles)
  const handle = before.handles[1]
  const startX = before.rect.x + handle.x
  const startY = before.rect.y + handle.y
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 90, startY - 35, { steps: 12 })
  await page.mouse.up()
  await page.waitForFunction((original) => {
    const current = window.__directorTrajectoryHandles?.handles?.[1]?.waypoint
    return current && Math.hypot(current[0] - original[0], current[1] - original[1]) > 0.1
  }, handle.waypoint)
  const after = await page.evaluate(() => window.__directorTrajectoryHandles)
  const moved = after.handles[1].waypoint
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  const path = saved.scene.propertyTimeline.trajectories['default-character-1']
  assert.ok(path?.waypoints?.length === 2, `dragged trajectory was not persisted: ${JSON.stringify(path)}`)
  assert.ok(Math.hypot(path.waypoints[1][0] - handle.waypoint[0], path.waypoints[1][1] - handle.waypoint[1]) > 0.1, 'persisted waypoint did not move')
  const persistedPoint = path.waypoints[1]

  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  const reloaded = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  const reloadedPoint = reloaded.scene.propertyTimeline.trajectories['default-character-1'].waypoints[1]
  assert.ok(Math.hypot(reloadedPoint[0] - persistedPoint[0], reloadedPoint[1] - persistedPoint[1]) < 1e-9, `trajectory drag changed after reload: ${JSON.stringify({ persistedPoint, reloadedPoint })}`)
  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log(JSON.stringify({ ok: true, groundPointAddedByPointer: true, controlPointDraggedByPointer: true, waypointBefore: handle.waypoint, pointerFrameWaypoint: moved, persistedWaypoint: persistedPoint, exactSaveReload: true }, null, 2))
} finally {
  await browser.close()
}
