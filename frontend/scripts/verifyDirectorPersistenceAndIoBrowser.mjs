import { chromium } from 'playwright'
import { resolve } from 'node:path'

const baseUrl = process.env.DIRECTOR_VERIFY_BASE_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

const assertPersistable = (value, path = '$') => {
  if (typeof value === 'string') {
    if (/^(data:|blob:|flow-asset:)/i.test(value) || (/^[A-Za-z0-9+/=]{256,}$/.test(value) && !/^https?:/i.test(value))) {
      throw new Error(`Non-persistable runtime media at ${path}: ${value.slice(0, 32)}`)
    }
    return
  }
  if (Array.isArray(value)) return value.forEach((item, index) => assertPersistable(item, `${path}[${index}]`))
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) assertPersistable(item, `${path}.${key}`)
}

try {
  const page = await browser.newPage({ viewport: { width: 1470, height: 900 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('director-acceptance-initialized')) {
      localStorage.removeItem('tanva:director-full-harness:v1')
      sessionStorage.setItem('director-acceptance-initialized', '1')
    }
  })
  await page.goto(`${baseUrl}/director-harness?full=1`, { waitUntil: 'networkidle' })
  const modal = page.getByTestId('director-console-modal')
  await modal.waitFor()
  await page.getByTitle('全屏').click()
  await page.waitForFunction(() => document.fullscreenElement?.getAttribute('data-testid') === 'director-console-modal')
  await page.getByTitle('全屏').click()
  await page.waitForFunction(() => document.fullscreenElement == null)
  if (!await modal.isVisible()) throw new Error('Director modal disappeared after exiting fullscreen')
  await modal.getByText('角色A', { exact: true }).first().click()
  const nameInput = modal.getByText('名称', { exact: true }).last().locator('..').locator('input')
  await nameInput.fill('持久化验收角色')
  const positionInputs = modal.getByText('位置', { exact: true }).last().locator('..').locator('input[type="number"]')
  await positionInputs.nth(0).fill('1.25')
  await modal.getByRole('button', { name: '姿势', exact: true }).click()
  await modal.getByRole('button', { name: '招手', exact: true }).click()
  await page.getByTitle('动画时间轴').click()
  const durationInput = page.getByRole('textbox', { name: '总时长' })
  const playheadInput = page.getByRole('textbox', { name: '播放头位置' })
  const initialDurationLabel = await durationInput.inputValue()
  // Text inputs must preserve incomplete drafts instead of formatting every
  // keystroke. Commit happens on Enter/blur and clamps both boundaries.
  await durationInput.fill('')
  if (await durationInput.inputValue() !== '') throw new Error('Duration input did not preserve an empty editing draft')
  await durationInput.fill('7.')
  if (await durationInput.inputValue() !== '7.') throw new Error('Duration input reformatted an incomplete decimal draft')
  await page.keyboard.press('Escape')
  if (await durationInput.inputValue() !== initialDurationLabel) throw new Error(`Escape did not restore duration: ${await durationInput.inputValue()}`)
  await durationInput.fill('2.50')
  await page.keyboard.press('Enter')
  await playheadInput.fill('99')
  await page.keyboard.press('Enter')
  if (await playheadInput.inputValue() !== '2.50') throw new Error(`Playhead upper clamp failed: ${await playheadInput.inputValue()}`)
  await playheadInput.fill('-4')
  await page.keyboard.press('Enter')
  if (await playheadInput.inputValue() !== '0.00') throw new Error(`Playhead lower clamp failed: ${await playheadInput.inputValue()}`)
  await page.getByRole('button', { name: '切换时间单位为 ms' }).click()
  await durationInput.fill('3200')
  await page.keyboard.press('Enter')
  await playheadInput.fill('1250')
  await page.keyboard.press('Enter')
  if (await playheadInput.inputValue() !== '1250') throw new Error(`Millisecond playhead conversion failed: ${await playheadInput.inputValue()}`)
  await durationInput.fill('100')
  await page.keyboard.press('Enter')
  if (await playheadInput.inputValue() !== '100') throw new Error(`Playhead was not clamped when duration shrank: ${await playheadInput.inputValue()}`)
  await page.getByRole('button', { name: '切换时间单位为 s' }).click()
  await durationInput.fill('3.20')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="director-harness-writes"]')?.textContent?.match(/\d+/)?.[0] || 0) >= 4)

  const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  if (!beforeReload) throw new Error('Director scene was not persisted to localStorage harness storage')
  const savedCharacter = beforeReload.scene.characters.find((character) => character.name === '持久化验收角色')
  if (!savedCharacter) throw new Error('Renamed character was not persisted')
  if (savedCharacter.position[0] !== 1.25) throw new Error(`Character X was not persisted: ${savedCharacter.position[0]}`)
  if (savedCharacter.posePresetId !== 'wave') throw new Error(`Character pose was not persisted: ${savedCharacter.posePresetId}`)
  if (beforeReload.scene.propertyTimeline.duration !== 3.2) throw new Error(`Timeline duration was not persisted: ${beforeReload.scene.propertyTimeline.duration}`)
  assertPersistable(beforeReload)

  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  await modal.getByText('持久化验收角色', { exact: true }).first().click()
  const reloadedName = await modal.getByText('名称', { exact: true }).last().locator('..').locator('input').inputValue()
  const reloadedX = Number(await modal.getByText('位置', { exact: true }).last().locator('..').locator('input[type="number"]').nth(0).inputValue())
  if (reloadedName !== '持久化验收角色' || reloadedX !== 1.25) throw new Error(`Reloaded scene mismatch: ${reloadedName}, X=${reloadedX}`)
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  assertPersistable(afterReload)

  // Input edge + current crop: the connected source is rendered through a
  // runtime blob URL, but neither that blob nor re-encoded pixels are saved.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==', 'base64')
  await page.route('**/api/assets/proxy?*', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
  const splat = Buffer.alloc(32)
  splat.writeFloatLE(0, 0); splat.writeFloatLE(0, 4); splat.writeFloatLE(0, 8)
  splat[12] = 64; splat[13] = 64; splat[14] = 64; splat[15] = 255
  splat[24] = 255; splat[25] = 255; splat[26] = 255; splat[27] = 255
  const gltfText = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{}], buffers: [{ uri: 'buffers/model.bin', byteLength: 4 }] })
  const modelBin = Buffer.alloc(4)
  await page.route('**/api/uploads/presign', async (route) => {
    const requested = route.request().postDataJSON?.() ?? {}
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ host: 'https://acceptance.invalid', dir: requested.dir || 'uploads/', expire: Math.floor(Date.now() / 1000) + 3600, accessId: 'acceptance', policy: 'policy', signature: 'signature' }),
    })
  })
  await page.route('https://acceptance.invalid/**', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 204, body: '' })
    if (new URL(route.request().url()).pathname.endsWith('.splat')) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: splat })
    if (new URL(route.request().url()).pathname.endsWith('.gltf')) return route.fulfill({ status: 200, contentType: 'model/gltf+json', body: gltfText })
    if (new URL(route.request().url()).pathname.endsWith('.bin')) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: modelBin })
    return route.fulfill({ status: 200, contentType: 'image/png', body: png })
  })
  await page.route('**/api/uploads/image', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ url: 'https://acceptance.invalid/director-shot.png', key: 'director-shots/acceptance.png' }),
  }))
  await page.route('**/api/uploads/model', (route) => {
    const body = route.request().postDataBuffer()?.toString('latin1') || ''
    const key = body.match(/name="key"\r\n\r\n([^\r\n]+)/)?.[1] || 'director-models/gltf-acceptance/acceptance.gltf'
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: `https://acceptance.invalid/${key}`, key }),
    })
  })
  await page.goto(`${baseUrl}/director-harness?full=1&io=1`, { waitUntil: 'networkidle' })
  await modal.waitFor()
  await page.keyboard.press('Escape')
  await page.getByText('已连接全景图', { exact: true }).waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
  const afterInput = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  assertPersistable(afterInput)

  // Output edge: capture, persist its remote URL, then create a Flow image
  // node through the real source→img protocol and await the done callback.
  await page.getByTitle('截图').click()
  await page.getByText('相机截图已保存', { exact: true }).waitFor({ timeout: 10000 })
  const sendButton = page.getByRole('button', { name: /^发送.*到画布$/ }).first()
  await sendButton.click()
  await page.getByTestId('director-harness-images').filter({ hasText: 'created images: 1' }).waitFor({ timeout: 10000 })
  const request = await page.evaluate(() => window.__directorHarnessLastImageRequest)
  if (request?.sourceNodeId !== 'director-full-harness' || request?.sourceHandle !== 'source' || request?.targetHandle !== 'img') {
    throw new Error(`Invalid Director output handles: ${JSON.stringify(request)}`)
  }
  if (request?.imageUrl !== 'https://acceptance.invalid/director-shot.png') throw new Error(`Output did not use persisted remote screenshot: ${request?.imageUrl}`)
  const finalSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  assertPersistable(finalSaved)
  const persistedShotUrls = Object.values(finalSaved.scene.cameraShots || {}).flat().map((shot) => shot.imageUrl)
  if (!persistedShotUrls.includes('https://acceptance.invalid/director-shot.png')) throw new Error(`Remote camera shot was not persisted: ${JSON.stringify(persistedShotUrls)}`)
  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  await modal.getByRole('button', { name: '摄像机截图', exact: true }).click()
  await modal.getByRole('button', { name: /^发送.*到画布$/ }).first().waitFor({ timeout: 10000 })
  const reloadedFinal = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  assertPersistable(reloadedFinal)

  // Real .splat file chooser → presigned remote upload → scene object. Drag
  // the same X axis control used by the inspector and prove its remote model
  // reference and transform survive a full refresh.
  await modal.locator('input[accept^=".splat"]').setInputFiles({ name: 'acceptance-ground.splat', mimeType: 'application/octet-stream', buffer: splat })
  await page.getByText('高斯泼溅已上传并添加', { exact: true }).waitFor({ timeout: 10000 })
  const gaussianXAxis = modal.getByRole('button', { name: '左右拖动调整 X 轴' }).first()
  const axisBox = await gaussianXAxis.boundingBox()
  if (!axisBox) throw new Error('Gaussian X drag control has no bounding box')
  await page.mouse.move(axisBox.x + axisBox.width / 2, axisBox.y + axisBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(axisBox.x + axisBox.width / 2 + 50, axisBox.y + axisBox.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const savedWithGaussian = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  const gaussian = savedWithGaussian.scene.characters.find((character) => character.name === '高斯泼溅')
  if (!gaussian || !/^https:\/\/acceptance\.invalid\/director-gaussians\/.+\.splat$/.test(gaussian.modelId)) throw new Error(`Gaussian remote reference was not persisted: ${gaussian?.modelId}`)
  if (!Number.isFinite(gaussian.position[0]) || Math.abs(gaussian.position[0]) < 0.5) throw new Error(`Gaussian X drag did not produce a material movement: ${gaussian.position[0]}`)
  const draggedGaussianX = gaussian.position[0]
  assertPersistable(savedWithGaussian)
  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  await modal.getByText('高斯泼溅', { exact: true }).first().click()
  const gaussianReloadedX = Number(await modal.getByText('位置', { exact: true }).last().locator('..').locator('input[type="number"]').nth(0).inputValue())
  if (gaussianReloadedX !== draggedGaussianX) throw new Error(`Reloaded Gaussian X mismatch: saved ${draggedGaussianX}, reloaded ${gaussianReloadedX}`)

  // GLTF package upload must upload external resources at the exact relative
  // URI before its entry file, then persist only the remote entry URL.
  const modelPicker = modal.locator('input[accept*=".gltf"]')
  await modelPicker.setInputFiles([
    { name: 'acceptance.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(gltfText) },
    { name: 'model.bin', mimeType: 'application/octet-stream', buffer: modelBin },
  ])
  try {
    await page.getByText('GLTF 模型包已上传并添加（1 个依赖）', { exact: true }).waitFor({ timeout: 10000 })
  } catch {
    throw new Error(`GLTF package upload did not complete. Browser errors: ${errors.join(' | ')}. Visible text: ${(await page.locator('body').innerText()).slice(-1200)}`)
  }
  await page.waitForTimeout(500)
  const savedWithGltf = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  const uploadedGltf = savedWithGltf.scene.characters.find((character) => typeof character.modelId === 'string' && character.modelId.startsWith('https://acceptance.invalid/director-models/gltf-') && character.modelId.endsWith('.gltf'))
  if (!uploadedGltf) throw new Error(`GLTF package entry was not persisted remotely: ${JSON.stringify(savedWithGltf.scene.characters.map((character) => character.modelId))}`)
  assertPersistable(savedWithGltf)
  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  const reloadedGltfRow = modal.getByRole('button', { name: `${uploadedGltf.name} 隐藏 锁定`, exact: true })
  if (!await reloadedGltfRow.count()) throw new Error('Uploaded GLTF package did not survive reload')
  await reloadedGltfRow.click()
  await page.keyboard.press('Delete')
  await page.waitForFunction((id) => {
    const saved = JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null')
    return saved && !saved.scene.characters.some((character) => character.id === id)
  }, uploadedGltf.id)

  // Seed a camera-owned track/trajectory beside its already-persisted shot,
  // then delete that real scene-tree object through the keyboard interaction.
  // The reducer must clean every dependent record and choose a surviving main camera.
  const deletionTarget = await page.evaluate(() => {
    const key = 'tanva:director-full-harness:v1'
    const saved = JSON.parse(localStorage.getItem(key) || 'null')
    const cameraId = Object.keys(saved.scene.cameraShots || {}).find((id) => saved.scene.cameras.some((camera) => camera.id === id))
    if (!cameraId) throw new Error('No persisted screenshot camera available for deletion cleanup acceptance')
    const camera = saved.scene.cameras.find((item) => item.id === cameraId)
    saved.scene.activeCameraId = cameraId
    saved.selectedObjectId = cameraId
    saved.scene.propertyTimeline ||= { duration: 3.2, tracks: [], trajectories: {} }
    saved.scene.propertyTimeline.tracks.push({ objectKind: 'camera', objectId: cameraId, property: 'fovDeg', keyframes: [{ time: 0, value: camera.fovDeg }] })
    saved.scene.propertyTimeline.trajectories ||= {}
    saved.scene.propertyTimeline.trajectories[cameraId] = { waypoints: [[0, 0], [1, 1]], mode: 'line', facingMode: 'fixed' }
    localStorage.setItem(key, JSON.stringify(saved))
    return { cameraId, cameraName: camera.name }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  await modal.getByRole('button', { name: `${deletionTarget.cameraName} 隐藏 锁定`, exact: true }).click()
  await page.keyboard.press('Delete')
  await page.waitForFunction((cameraId) => {
    const saved = JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null')
    return saved && !saved.scene.cameras.some((camera) => camera.id === cameraId)
  }, deletionTarget.cameraId)
  const afterDeletion = await page.evaluate(() => JSON.parse(localStorage.getItem('tanva:director-full-harness:v1') || 'null'))
  if (afterDeletion.scene.cameraShots?.[deletionTarget.cameraId]) throw new Error('Deleting camera left its screenshot group behind')
  if (afterDeletion.scene.propertyTimeline.tracks.some((track) => track.objectId === deletionTarget.cameraId)) throw new Error('Deleting camera left its property tracks behind')
  if (afterDeletion.scene.propertyTimeline.trajectories?.[deletionTarget.cameraId]) throw new Error('Deleting camera left its trajectory behind')
  if (!afterDeletion.scene.activeCameraId || afterDeletion.scene.activeCameraId === deletionTarget.cameraId) throw new Error(`Deleting active camera did not select a surviving camera: ${afterDeletion.scene.activeCameraId}`)
  assertPersistable(afterDeletion)
  await page.reload({ waitUntil: 'networkidle' })
  await modal.waitFor()
  if (await modal.getByRole('button', { name: `${deletionTarget.cameraName} 隐藏 锁定`, exact: true }).count()) throw new Error('Deleted camera returned after reload')
  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
  console.log(JSON.stringify({
    ok: true,
    characterSaveReload: true,
    fullscreenEnterExit: true,
    timelineSaveReload: true,
    timelineDraftBoundaryUnits: true,
    connectedCropInput: true,
    remoteSourceToImageOutput: true,
    cameraShotSaveReload: true,
    gaussianUploadDragSaveReload: true,
    gltfPackageUploadSaveReload: true,
    deletionCleanupSaveReload: true,
    transientMediaPersisted: false,
  }, null, 2))
} finally {
  await browser.close()
}
