import assert from 'node:assert/strict';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Mount the production modal and capture component rather than a copy of their logic.
// Assets are HTTP URLs served by this fixture; there are no upstream media/API calls.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `.image-preview-smoke-${process.pid}`;
const html = path.join(root, `${name}.html`);
const tsx = path.join(root, `${name}.tsx`);
const modalSelector = '[data-image-preview-modal="true"]';
const transformSelector = `${modalSelector} .react-transform-component`;
const eventTypes = ['wheel', 'mousedownCapture', 'mousemoveCapture', 'mouseupCapture', 'keydownCapture', 'keyupCapture', 'gesturestart', 'gesturechange', 'gestureend'];
let server, browser, page;
try {
  await writeFile(html, `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ImagePreviewModal from './src/components/ui/ImagePreviewModal';
import GlobalEventCapture from './src/components/canvas/GlobalEventCapture';
import { canvasEventBus } from './src/canvas/CanvasEventBus';
import './src/i18n';
import './src/index.css';
const eventTypes = ${JSON.stringify(eventTypes)};
const events = Object.fromEntries(eventTypes.map(type => [type, 0]));
const hostEvents = {pointerdown:0,doubleclick:0};
const items = Array.from({length: 36}, (_, i) => ({id: 'image-' + i, src: location.origin + '/preview-fixture/' + (i % 2 ? 'portrait' : 'landscape') + '.svg', title: i === 0 ? 'Landscape reference' : i === 1 ? 'Portrait reference' : 'History ' + i, timestamp: 1800000000000 - i * 1000}));
function App() {
  const [open, setOpen] = React.useState(false);
  const [id, setId] = React.useState(items[0].id);
  const [theme, setTheme] = React.useState('light');
  const [loading, setLoading] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const [showCollection, setShowCollection] = React.useState(true);
  const loads = React.useRef(0);
  const changes = React.useRef([]);
  React.useEffect(() => {
    const off = eventTypes.map(type => canvasEventBus.on(type, () => { events[type]++; }));
    return () => off.forEach(fn => fn());
  }, []);
  React.useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    document.body.style.background = theme === 'dark' ? '#151820' : '#e9edf3';
  }, [theme]);
  const selected = items.find(item => item.id === id);
  window.previewSmoke = {
    resetEvents: () => {eventTypes.forEach(type => { events[type] = 0; });hostEvents.pointerdown = 0;hostEvents.doubleclick = 0;},
    snapshot: () => ({events: {...events}, hostEvents: {...hostEvents}, open, id, theme, loads: loads.current, changes: [...changes.current]}),
    open: () => setOpen(true),
    close: () => setOpen(false),
    setImage: setId,
    setTheme,
    setShowCollection,
  };
  return <div onPointerDown={() => {hostEvents.pointerdown++;}} onDoubleClick={() => {hostEvents.doubleclick++;}}><GlobalEventCapture/><main style={{padding:40,fontFamily:'sans-serif'}}><h1>Image preview browser fixture</h1><button id="open-preview" onClick={() => setOpen(true)}>Open preview</button><p>Actual production modal, two same-origin SVG assets, and canvas event telemetry.</p><div id="canvas-target" style={{width:500,height:300,background:'#8faccb'}}>Canvas event control target</div></main><ImagePreviewModal isOpen={open} imageSrc={selected.src} imageTitle={selected.title} onClose={() => setOpen(false)} imageCollection={showCollection ? items : []} currentImageId={id} onImageChange={next => { changes.current.push(next); setId(next); }} collectionTitle="Fixture history" hasMore={hasMore} isLoading={loading} onLoadMore={() => { loads.current++; setLoading(true); setTimeout(() => {setLoading(false);setHasMore(false);},150); }}/></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const svgAsset = url => {
    const portrait = url.includes('portrait');
    const width = portrait ? 480 : 1600;
    const height = portrait ? 960 : 1000;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g"><stop stop-color="${portrait ? '#4f468a' : '#215e78'}"/><stop offset="1" stop-color="${portrait ? '#cb887e' : '#8dc7b8'}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width,height) / 3}" fill="none" stroke="#f5e6ac" stroke-width="16"/><path d="M0 ${height / 2}H${width}M${width / 2} 0V${height}" stroke="#fff" stroke-opacity=".35" stroke-width="3"/><text x="${width / 2}" y="${height / 2}" fill="#fff" font-size="${portrait ? 30 : 65}" text-anchor="middle">${portrait ? 'PORTRAIT 480 × 960' : 'LANDSCAPE 1600 × 1000'}</text></svg>`;
  };
  await page.route('**/preview-fixture/*.svg', route => route.fulfill({contentType:'image/svg+xml',body:svgAsset(route.request().url())}));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get('url');
    if (url.pathname.endsWith('/assets/proxy') && source?.includes('/preview-fixture/')) return route.fulfill({contentType:'image/svg+xml',body:svgAsset(source)});
    return route.fulfill({json:{}});
  });
  const modal = page.locator(modalSelector);
  const image = modal.locator('.image-preview__image');
  const stage = modal.locator('.image-preview__stage');
  const strip = modal.locator('.image-preview__strip');
  const snapshot = () => page.evaluate(() => window.previewSmoke.snapshot());
  const clearEvents = () => page.evaluate(() => window.previewSmoke.resetEvents());
  const assertIsolated = async (label) => {
    const {events,hostEvents} = await snapshot();
    assert.deepEqual(events, Object.fromEntries(eventTypes.map(type => [type,0])), `${label}: preview events leaked to CanvasEventBus`);
    assert.deepEqual(hostEvents,{pointerdown:0,doubleclick:0},`${label}: portal synthetic events leaked to React host`);
  };
  const transform = () => page.locator(transformSelector).evaluate(el => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { scale: Math.hypot(matrix.a,matrix.b), x: matrix.e, y: matrix.f };
  });
  const waitScale = async (predicate, label) => {
    for (let n = 0; n < 40; n++) {
      const state = await transform();
      if (predicate(state.scale)) { await page.waitForTimeout(350); return await transform(); }
      await page.waitForTimeout(50);
    }
    assert.fail(`${label}: transform ${JSON.stringify(await transform())}`);
  };
  const expectReset = async label => {
    const state = await waitScale(scale => Math.abs(scale - 1) < .01,label);
    assert.ok(Math.abs(state.scale - 1) < .01, `${label}: scale must reset to 1`);
    assert.equal(await image.evaluate(el => el.style.transform), 'rotate(0deg)', `${label}: rotation must reset`);
  };
  const imageReady = async () => {
    await image.waitFor({state:'visible'});
    await image.evaluate(el => el.complete && el.naturalWidth ? null : new Promise(resolve => el.addEventListener('load',resolve,{once:true})));
    await page.waitForTimeout(250);
  };
  const openPreview = async () => {
    await page.evaluate(() => window.previewSmoke.open());
    await modal.waitFor({state:'visible'});
    await imageReady();
    await clearEvents();
  };
  const focusStage = async () => {
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width / 2,box.y + box.height / 2);
  };
  await page.goto(`${origin}/${name}.html`);
  await page.waitForFunction(() => Boolean(window.previewSmoke));
  // Prove capture telemetry is live when the modal is closed.
  await page.locator('#canvas-target').hover();
  await page.mouse.wheel(0,120);
  await page.locator('#canvas-target').click();
  await page.keyboard.press('a');
  const control = (await snapshot()).events;
  for (const type of ['wheel','mousedownCapture','mousemoveCapture','mouseupCapture','keydownCapture','keyupCapture']) assert.ok(control[type] > 0, `${type}: fixture event capture is inactive`);

  await openPreview();
  await expectReset('initial open');
  // A representative mouse-wheel tick should adjust the image gently and keep
  // the image point under the cursor fixed, even away from the viewport center.
  const stageBox = await stage.boundingBox();
  const anchor = { x: stageBox.x + stageBox.width * .65, y: stageBox.y + stageBox.height * .6 };
  const contentPoint = () => page.locator(transformSelector).evaluate((el, anchor) => {
    const rect = el.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const scale = Math.hypot(matrix.a, matrix.b);
    return { x: (anchor.x - rect.left) / scale, y: (anchor.y - rect.top) / scale };
  }, anchor);
  const pointBeforeWheel = await contentPoint();
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -100);
  const gentleWheel = await waitScale(scale => scale > 1.01, '100px wheel zoom');
  assert.ok(gentleWheel.scale >= 1.08 && gentleWheel.scale <= 1.12, `100px wheel should zoom by about 10%, got ${gentleWheel.scale}`);
  const pointAfterWheel = await contentPoint();
  assert.ok(Math.hypot(pointAfterWheel.x - pointBeforeWheel.x, pointAfterWheel.y - pointBeforeWheel.y) < 1, 'wheel zoom must preserve the cursor anchor');
  await assertIsolated('gentle wheel zoom');
  await page.mouse.wheel(0, 100);
  await expectReset('reverse 100px wheel');
  console.log(`100px wheel scale: ${gentleWheel.scale.toFixed(3)}; cursor anchor preserved.`);
  const initial = await transform();
  await focusStage();
  await page.mouse.wheel(0,-280);
  const wheeled = await waitScale(scale => scale > initial.scale + .05,'wheel zoom');
  await assertIsolated('wheel');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0,-180);
  await page.keyboard.up('Control');
  await waitScale(scale => scale > wheeled.scale + .05,'ctrl-wheel zoom');
  assert.equal(await page.evaluate(() => window.scrollY),0,'ctrl-wheel must not scroll background');
  await assertIsolated('ctrl-wheel');

  const beforeDrag = await transform();
  await page.mouse.down();
  await page.mouse.move(820,560,{steps:12});
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.equal(await modal.isVisible(),true,'drag must not close preview');
  const afterDrag = await transform();
  assert.ok(Math.hypot(afterDrag.x - beforeDrag.x,afterDrag.y - beforeDrag.y) > 15,'drag must pan the image');
  await assertIsolated('drag');
  await image.dblclick();
  await expectReset('double-click');
  await assertIsolated('double-click');

  const zoomIn = modal.getByRole('button',{name:/^(放大|Zoom in)( \([+]\))?$/i});
  const zoomOut = modal.getByRole('button',{name:/^(缩小|Zoom out)( \([-]\))?$/i});
  await zoomIn.click();
  const buttonScale = await waitScale(scale => scale > 1.05,'zoom in button');
  await zoomOut.click();
  await waitScale(scale => scale < buttonScale.scale - .05,'zoom out button');
  const slider = modal.getByRole('slider');
  const setSlider = async scale => slider.evaluate((el,scale) => {
    if (!(el instanceof HTMLInputElement)) throw new Error('Fixture expects native zoom range input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(el,Math.log(scale));
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  },scale);
  await setSlider(2);
  await waitScale(scale => Math.abs(scale - 2) < .04,'zoom slider');
  await modal.getByRole('button',{name:/^(顺时针旋转|Rotate clockwise)$/i}).click();
  assert.equal(await image.evaluate(el => el.style.transform),'rotate(90deg)','rotation button');
  await modal.getByRole('button',{name:/^(逆时针旋转|Rotate counterclockwise)$/i}).click();
  assert.equal(await image.evaluate(el => el.style.transform),'rotate(0deg)','counter rotation button');
  await modal.getByRole('button',{name:/^(图片信息|Image info)$/i}).click();
  await modal.locator('.image-preview__info').waitFor();
  assert.match(await modal.locator('.image-preview__info').innerText(),/1600\s*×\s*1000/,'image info contains real dimensions');
  const downloadPromise = page.waitForEvent('download');
  await modal.getByRole('button',{name:/^(下载|Download)$/i}).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename(),'download has filename');
  assert.equal(await download.failure(),null,'download succeeds');
  assert.match(await readFile(await download.path(),'utf8'),/LANDSCAPE 1600 × 1000/,'download contains the current image asset');
  await assertIsolated('toolbar');

  await page.screenshot({path:'/tmp/tanva-image-preview-zoom.png'});
  await setSlider(.25);
  await waitScale(scale => Math.abs(scale - .25) < .001,'minimum zoom .25');
  await setSlider(10);
  await waitScale(scale => Math.abs(scale - 10) < .001,'maximum zoom 10');
  const reset = modal.getByRole('button',{name:/^(重置视图|Reset view)/i});
  await reset.click();
  await expectReset('reset button');
  await page.keyboard.press('Shift+Equal');
  const hotkeyScale = await waitScale(scale => scale > 1.05,'plus hotkey');
  await page.keyboard.press('Minus');
  await waitScale(scale => scale < hotkeyScale.scale - .05,'minus hotkey');
  await page.keyboard.press('Digit0');
  await expectReset('zero hotkey');
  await assertIsolated('zoom bounds and hotkeys');

  const light = await modal.evaluate(el => ({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  await page.screenshot({path:'/tmp/tanva-image-preview-light.png'});
  await page.evaluate(() => window.previewSmoke.setTheme('dark'));
  await page.waitForTimeout(200);
  const dark = await modal.evaluate(el => ({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  assert.notDeepEqual(dark,light,'dark theme must change preview appearance');
  await page.screenshot({path:'/tmp/tanva-image-preview-dark.png'});

  // Keyboard and thumbnail navigation both use the supplied public callbacks.
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.previewSmoke.snapshot().id === 'image-1');
  await imageReady();
  assert.equal(await image.evaluate(el => el.naturalWidth),480,'navigation renders portrait fixture');
  assert.equal(await image.evaluate(el => el.naturalHeight),960,'portrait dimensions');
  await expectReset('image change');
  await assertIsolated('keyboard image navigation');
  await modal.locator('.image-preview__thumb').first().click();
  await page.waitForFunction(() => window.previewSmoke.snapshot().id === 'image-0');
  await imageReady();
  await expectReset('history thumbnail');
  assert.equal(await modal.locator('.image-preview__thumb[aria-current="true"]').count(),1,'single active history thumbnail');
  await strip.hover();
  const beforeScroll = await strip.evaluate(el => el.scrollLeft);
  await page.mouse.wheel(0,300);
  await page.waitForTimeout(200);
  assert.ok(await strip.evaluate(el => el.scrollLeft) > beforeScroll,'history wheel scrolls horizontally');
  await strip.evaluate(el => {el.scrollLeft = el.scrollWidth;el.dispatchEvent(new Event('scroll',{bubbles:true}));});
  await page.waitForFunction(() => window.previewSmoke.snapshot().loads === 1);
  await page.waitForTimeout(250);
  await strip.evaluate(el => el.dispatchEvent(new Event('scroll',{bubbles:true})));
  assert.equal((await snapshot()).loads,1,'history pagination must not duplicate after hasMore becomes false');
  await assertIsolated('history scrolling');

  await zoomIn.click();
  await waitScale(scale => scale > 1.05,'before closing');
  await modal.getByRole('button',{name:/^(顺时针旋转|Rotate clockwise)$/i}).click();
  await modal.getByRole('button',{name:/^(关闭|Close)( \(Esc\))?$/i}).click();
  await modal.waitFor({state:'detached'});
  await openPreview();
  await expectReset('close/reopen');
  // Keydown is checked before keyup because Escape removes the portal immediately.
  await page.keyboard.down('Escape');
  await modal.waitFor({state:'detached'});
  assert.equal((await snapshot()).open,false,'Escape closes preview');
  await assertIsolated('Escape keydown');
  await page.keyboard.up('Escape');
  await page.evaluate(() => {window.previewSmoke.setShowCollection(false);window.previewSmoke.setTheme('light');});
  await page.setViewportSize({width:390,height:844});
  await openPreview();
  await expectReset('narrow viewport without history');
  assert.equal(await strip.count(),0,'standalone image preview has no history strip');
  const imageBounds = await image.boundingBox();
  assert.ok(imageBounds.width <= 390 && imageBounds.height <= 844,'standalone image fits narrow viewport');
  const toolbarBounds = await modal.locator('.image-preview__top-center').boundingBox();
  assert.ok(toolbarBounds.x >= 0 && toolbarBounds.x + toolbarBounds.width <= 390,'narrow toolbar fits viewport');
  assert.equal(await modal.locator('.image-preview__top-right > .image-preview__kbd').isVisible(),false,'narrow Escape hint must not overlap zoom toolbar');
  await page.screenshot({path:'/tmp/tanva-image-preview-narrow.png'});
  await modal.getByRole('button',{name:/^(关闭|Close)( \(Esc\))?$/i}).click();
  await modal.waitFor({state:'detached'});
  await assertIsolated('standalone close');
  await page.setViewportSize({width:1440,height:1000});
  await clearEvents();
  await page.locator('#canvas-target').hover();
  await page.mouse.wheel(0,120);
  assert.ok((await snapshot()).events.wheel > 0,'canvas wheel capture resumes after preview closes');
  assert.deepEqual(errors,[],'browser must have no uncaught runtime errors');
  console.log('PASS: actual ImagePreviewModal wheel/ctrl-wheel zoom, pan, double-click/reset, toolbar/log slider (.25..10), +/-/0, rotation/info/current-image download, image/history navigation and pagination, light/dark, reopen reset, Escape, CanvasEventBus/React portal isolation, and narrow standalone preview. Same-origin SVG fixture; screenshots: /tmp/tanva-image-preview-{light,dark,zoom,narrow}.png');
} catch (error) {
  await page?.screenshot({path:'/tmp/tanva-image-preview-failure.png'}).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([html,tsx].map(file => unlink(file).catch(() => {})));
}
