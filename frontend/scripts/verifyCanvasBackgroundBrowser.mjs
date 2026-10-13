import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cacheDir = await mkdtemp(join(tmpdir(), 'tanva-background-vite-'));
const virtualId = '\0canvas-background-regression';
const server = await createServer({
  cacheDir,
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { entries: [] },
  plugins: [{
    name: 'canvas-background-regression',
    configureServer(viteServer) {
      viteServer.middlewares.use('/background-regression.html', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await viteServer.transformIndexHtml('/background-regression.html', '<div id="root"></div><script type="module" src="/background-regression.js"></script>'));
      });
    },
    resolveId(id) { if (id === '/background-regression.js') return virtualId; },
    load(id) {
      if (id !== virtualId) return;
      return `
        import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import paper from 'paper';
        import { ReactFlow, Background, BackgroundVariant } from '@xyflow/react';
        import '@xyflow/react/dist/style.css';
        import '/src/index.css';
        import '/src/styles/chat.css';
        import CanvasViewControls from '/src/components/canvas/CanvasViewControls.tsx';
        import ToolBar from '/src/components/toolbar/ToolBar.tsx';
        import ZoomIndicator from '/src/components/canvas/ZoomIndicator.tsx';
        import GridRenderer from '/src/components/canvas/GridRenderer.tsx';
        import GlobalEventCapture from '/src/components/canvas/GlobalEventCapture.tsx';
        import GlobalZoomCapture from '/src/components/canvas/GlobalZoomCapture.tsx';
        import { useCanvasBackgroundStyle } from '/src/hooks/useCanvasBackgroundStyle.ts';
        import { useCanvasBackgroundStore } from '/src/stores/canvasBackgroundStore.ts';
        import { useAIChatStore } from '/src/stores/aiChatStore.ts';
        import { useCanvasStore, GridStyle } from '/src/stores/canvasStore.ts';
        import { useUIStore } from '/src/stores/uiStore.ts';
        import { useShortcutStore } from '/src/stores/shortcutStore.ts';
        import { canvasEventBus } from '/src/canvas/CanvasEventBus.ts';
        import '/src/components/canvas/canvasBackground.css';
        useUIStore.setState({ showGrid: true, showAxis: false, focusMode: false, showLayerPanel: false, flowUIEnabled: true });
        useCanvasStore.setState({ zoom: 1, gridStyle: GridStyle.LINES, gridBgEnabled: false });
        window.paletteEvents = 0;
        window.paletteShortcuts = 0;
        canvasEventBus.on('keydownCapture', () => { window.paletteEvents++; });
        canvasEventBus.on('mousedownCapture', () => { window.paletteEvents++; });
        canvasEventBus.on('wheel', () => { window.paletteEvents++; });
        window.addEventListener('keydown', event => {
          if (useShortcutStore.getState().matchesShortcut('delete', event) || useShortcutStore.getState().matchesShortcut('group', event)) window.paletteShortcuts++;
        }, true);
        function App() {
          const canvasRef = useRef(null);
          const [ready, setReady] = useState(false);
          const [variant, setVariant] = useState(BackgroundVariant.Dots);
          const [embedded, setEmbedded] = useState(false);
          const [surfaceWidth, setSurfaceWidth] = useState(null);
          const theme = useAIChatStore(state => state.chatTheme);
          const style = useCanvasBackgroundStyle();
          useLayoutEffect(() => { paper.setup(canvasRef.current); setReady(true); }, []);
          useEffect(() => { document.body.classList.toggle('tanva-premium-black-theme', theme === 'black'); }, [theme]);
          useEffect(() => {
            window.backgroundTest = {
              preferences: () => useCanvasBackgroundStore.getState().byScheme,
              theme: theme => useAIChatStore.setState({ chatTheme: theme }),
              grid: enabled => useUIStore.setState({ showGrid: enabled, showAxis: false }),
              solid: enabled => useCanvasStore.setState({ gridBgEnabled: enabled }),
              flowVariant: setVariant,
              focus: () => useUIStore.getState().focusMode,
              zoom: () => useCanvasStore.getState().zoom,
              layer: enabled => useUIStore.setState({ showLayerPanel: enabled }),
              embedded: enabled => { window.tanvaDesktop = enabled ? { isElectron: true } : undefined; setEmbedded(enabled); },
              surfaceWidth: setSurfaceWidth,
              maximized: enabled => useAIChatStore.setState({ isMaximized: enabled }),
              gridState: () => {
                const layer = paper.project.layers.find(layer => layer.name === 'grid');
                return { locked: !!layer?.data?.isRendering, lines: layer?.children.filter(child => child.visible && child.data?.type === 'grid').length ?? 0,
                  strokes: layer?.children.filter(child => child.visible && child.data?.type === 'grid').slice(0, 4).map(child => child.strokeColor.toCSS()),
                  fill: layer?.children.find(child => child.visible && child.data?.type === 'solid-background')?.fillColor.toCSS() };
              },
              pixel: () => { paper.view.update(); return [...canvasRef.current.getContext('2d').getImageData(501, 503, 1, 1).data]; },
            };
          }, []);
          return React.createElement('div', { className: 'tanva-canvas-surface' + (embedded ? ' tanva-canvas-embedded' : ''), 'data-background-custom': !!style,
            style: { position: 'relative', width: surfaceWidth ?? (embedded ? 'calc(100vw - 250px)' : '100vw'), height: embedded ? 'calc(100vh - 80px)' : '100vh', marginLeft: embedded ? 250 : 0, marginTop: embedded ? 40 : 0, ...style } },
            React.createElement('canvas', { ref: canvasRef, className: 'tanva-main-canvas', width: 900, height: 700, style: { position: 'absolute', inset: 0, background: 'white' } }),
            ready && React.createElement(GridRenderer, { canvasRef, isPaperInitialized: ready }),
            React.createElement('div', { className: 'tanva-flow-overlay', style: { position: 'absolute', inset: 0, pointerEvents: 'none' } },
              React.createElement(ReactFlow, { nodes: [], edges: [] }, React.createElement(Background, { variant, color: '#94a3b8', style: { opacity: 0.4 } }))),
            React.createElement(GlobalEventCapture), React.createElement(GlobalZoomCapture),
            React.createElement(ToolBar), React.createElement(ZoomIndicator), React.createElement(CanvasViewControls, { embeddedDesktop: embedded }));
        }
        createRoot(document.getElementById('root')).render(React.createElement(App));
      `;
    },
  }],
});
await server.listen();
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/background-regression.html`);
  await page.waitForFunction(() => window.backgroundTest && window.backgroundTest.gridState().lines > 0);
  const trigger = page.locator('.tanva-canvas-background-trigger');
  const dock = page.locator('.tanva-canvas-view-controls');
  const toggle = page.locator('.tanva-canvas-view-toggle');
  const expand = async () => { if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click(); };
  const hex = page.locator('.tanva-canvas-background-input');
  const reset = page.locator('.tanva-canvas-background-fields button');
  const background = () => page.locator('.tanva-main-canvas').evaluate(element => getComputedStyle(element).backgroundColor);
  const setHex = async value => { await hex.fill(value); await hex.press('Enter'); };
  assert.equal(await background(), 'rgb(255, 255, 255)', 'unset light preference preserves default');
  assert.equal(await trigger.count(), 0, 'view controls start collapsed');
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => window.backgroundTest.focus()), true, 'collapsed dock retains Tab focus shortcut');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => window.backgroundTest.focus()), false);
  await expand();
  const eye = page.locator('.tanva-focus-mode-button button');
  await eye.click();
  assert.equal(await page.evaluate(() => window.backgroundTest.focus()), true, 'eye still toggles focus');
  await eye.click();
  await trigger.click();
  await page.locator('.tanva-canvas-background-swatch').nth(4).click();
  assert.equal(await background(), 'rgb(227, 234, 242)');
  await setHex('ABC');
  assert.equal(await background(), 'rgb(170, 187, 204)');
  await setHex('invalid');
  assert.equal(await hex.inputValue(), 'aabbcc');
  await setHex('000');
  assert.equal(await background(), 'rgb(0, 0, 0)');
  const darkLines = await page.evaluate(() => window.backgroundTest.gridState());
  assert.ok(darkLines.strokes.every(color => color.startsWith('rgba(255,255,255,')), 'Paper grid contrasts against dark custom background');
  for (const variant of ['dots', 'lines', 'cross']) {
    await page.evaluate(variant => window.backgroundTest.flowVariant(variant), variant);
    const selector = variant === 'dots' ? '.react-flow__background circle' : '.react-flow__background path';
    await page.waitForSelector(selector, { state: 'attached' });
    assert.equal(await page.locator(selector).first().evaluate((element, property) => getComputedStyle(element)[property], variant === 'dots' ? 'fill' : 'stroke'), 'rgb(255, 255, 255)', `${variant} Flow grid responds to custom color`);
  }
  await page.evaluate(() => window.backgroundTest.solid(true));
  await setHex('123456');
  await page.waitForFunction(() => window.backgroundTest.gridState().fill === 'rgb(18,52,86)');
  assert.deepEqual(await page.evaluate(() => window.backgroundTest.pixel()), [18, 52, 86, 255], 'Paper solid background draws chosen pixels');
  await page.evaluate(() => window.backgroundTest.grid(false));
  await setHex('fedcba');
  await page.evaluate(() => window.backgroundTest.grid(true));
  await page.waitForFunction(() => window.backgroundTest.gridState().lines > 0);
  assert.equal(await page.evaluate(() => window.backgroundTest.gridState().locked), false);
  await page.evaluate(() => window.backgroundTest.theme('black'));
  assert.equal(await background(), 'rgb(9, 9, 9)', 'unset dark preference preserves dark CSS despite light preference');
  await setHex('ffffff');
  assert.equal(await background(), 'rgb(255, 255, 255)', 'custom dark-theme background overrides theme important rule');
  await page.evaluate(() => window.backgroundTest.theme('white'));
  assert.equal(await background(), 'rgb(254, 220, 186)', 'themes restore independent choices');

  const spectrum = page.locator('.tanva-canvas-background-spectrum');
  const eventsBefore = await page.evaluate(() => window.paletteEvents);
  const zoomBefore = await page.evaluate(() => window.backgroundTest.zoom());
  await spectrum.focus();
  await spectrum.press('Tab');
  await spectrum.press('g');
  await spectrum.press('Control+g');
  await spectrum.press('Delete');
  await spectrum.hover();
  await page.mouse.wheel(0, 180);
  assert.equal(await page.evaluate(() => window.backgroundTest.focus()), false, 'Tab inside dialog leaves focus mode unchanged');
  assert.equal(await page.evaluate(() => window.paletteShortcuts), 0, 'capture shortcuts ignore palette controls');
  assert.equal(await page.evaluate(() => window.paletteEvents), eventsBefore, 'palette keyboard/wheel do not reach canvas event bus');
  assert.equal(await page.evaluate(() => window.backgroundTest.zoom()), zoomBefore);
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
  await page.keyboard.press('Control+g');
  await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(() => window.paletteShortcuts), 0, 'open palette suppresses capture shortcuts even if focus leaves controls');

  const beforeSpectrum = await page.evaluate(() => window.backgroundTest.preferences().light);
  const bounds = await spectrum.boundingBox();
  await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.4);
  assert.notEqual(await page.evaluate(() => window.backgroundTest.preferences().light), beforeSpectrum, 'interactive spectrum commits color');
  const beforeHue = await page.evaluate(() => window.backgroundTest.preferences().light);
  await page.locator('.tanva-canvas-background-hue').press('Home');
  assert.notEqual(await page.evaluate(() => window.backgroundTest.preferences().light), beforeHue, 'hue slider commits color');
  await spectrum.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(() => window.paletteShortcuts), 1, 'closing palette restores capture shortcuts');
  await trigger.click();
  await page.mouse.click(850, 650);
  assert.equal(await page.getByRole('dialog').count(), 0, 'outside click closes');
  await trigger.click();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.getByRole('dialog').count(), 0, 'window blur closes');
  await trigger.click();
  await setHex('abcdef');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tanva-canvas-background')).state.byScheme.light === '#abcdef');
  await page.reload();
  await page.waitForFunction(() => window.backgroundTest);
  assert.equal(await background(), 'rgb(171, 205, 239)', 'preference survives reload');
  await expand();
  await trigger.click();
  await page.screenshot({ path: '/tmp/tanva-canvas-background-palette.png' });
  await reset.click();
  assert.equal(await background(), 'rgb(255, 255, 255)');
  assert.deepEqual(await page.evaluate(() => window.backgroundTest.preferences()), { light: null, dark: '#ffffff' }, 'reset only clears active theme');
  await page.evaluate(() => window.backgroundTest.layer(true));
  await page.waitForTimeout(100);
  assert.ok((await dock.boundingBox()).x >= 330, 'dock follows the layer sidebar');
  await hex.press('Escape');
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const assertGeometry = async label => {
    const box = await dock.boundingBox();
    const toolbar = await page.locator('.tanva-toolbar-shell').boundingBox();
    const zoom = await page.locator('.tanva-zoom-shell').boundingBox();
    const surface = await page.locator('.tanva-canvas-surface').boundingBox();
    assert.ok(!overlaps(box, toolbar), label + ': dock avoids real toolbar');
    assert.ok(!overlaps(box, zoom), label + ': dock avoids zoom');
    assert.ok(box.x >= surface.x && box.x + box.width <= surface.x + surface.width && box.y >= surface.y && box.y + box.height <= surface.y + surface.height, label + ': dock stays in canvas');
    if (await toggle.getAttribute('aria-expanded') === 'true') {
      const children = await page.locator('.tanva-canvas-view-controls > *').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect().y));
      assert.ok(Math.max(...children) - Math.min(...children) <= 1, label + ': controls expand horizontally');
    }
    console.log(label, { dock: box, toolbar, zoom });
  };
  for (const height of [700, 600]) {
    await page.setViewportSize({ width: 900, height });
    for (const layer of [false, true]) {
      await page.evaluate(layer => window.backgroundTest.layer(layer), layer);
      await page.waitForTimeout(100);
      await assertGeometry(height + 'px layer=' + layer + ' expanded');
      await toggle.click();
      assert.equal(await trigger.count(), 0);
      await assertGeometry(height + 'px layer=' + layer + ' collapsed');
      await expand();
    }
    await page.evaluate(() => window.backgroundTest.layer(false));
    await page.waitForTimeout(100);
    await page.screenshot({ path: '/tmp/tanva-canvas-view-controls-' + height + '.png' });
  }
  await trigger.click();
  await toggle.click();
  assert.equal(await page.getByRole('dialog').count(), 0, 'collapse also closes the color dialog');
  await expand();
  await page.setViewportSize({ width: 450, height: 600 });
  await page.evaluate(() => window.backgroundTest.layer(true));
  await page.waitForTimeout(100);
  await assertGeometry('450px narrow canvas with layers');
  await page.setViewportSize({ width: 900, height: 600 });
  await page.evaluate(() => window.backgroundTest.layer(false));
  await toggle.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Escape collapses the row');
  await page.evaluate(() => window.backgroundTest.embedded(true));
  await expand();
  assert.equal(await eye.count(), 0, 'embedded desktop retains its existing absence of standalone focus mode');
  await assertGeometry('embedded desktop');
  await page.evaluate(() => { window.backgroundTest.surfaceWidth(450); window.backgroundTest.layer(true); });
  await page.waitForTimeout(100);
  await assertGeometry('450px embedded with layers');
  await page.screenshot({ path: '/tmp/tanva-canvas-view-controls-embedded-layers.png' });
  await page.evaluate(() => window.backgroundTest.layer(false));
  await page.waitForTimeout(100);
  await trigger.click();
  await page.evaluate(() => window.backgroundTest.surfaceWidth(360));
  await page.waitForTimeout(100);
  const popup = await page.getByRole('dialog').boundingBox();
  const surface = await page.locator('.tanva-canvas-surface').boundingBox();
  assert.ok(popup.x >= surface.x && popup.x + popup.width <= surface.x + surface.width && popup.y >= surface.y && popup.y + popup.height <= surface.y + surface.height, 'palette clamps to embedded canvas bounds');
  await page.evaluate(() => window.backgroundTest.theme('black'));
  assert.equal(await dock.getAttribute('data-scheme'), 'dark');
  await page.screenshot({ path: '/tmp/tanva-canvas-view-controls-embedded-dark.png' });
  await page.evaluate(() => window.backgroundTest.maximized(true));
  assert.equal(await dock.isVisible(), false, 'maximized chat hides the dock');
  await page.evaluate(() => window.backgroundTest.maximized(false));
  assert.equal(await page.getByRole('dialog').count(), 0, 'maximizing closes the palette');
  assert.deepEqual(errors, []);
  console.log('Canvas background browser checks passed: palettes, HEX, theme persistence/reset, Paper pixels/grid reopening, Flow dots/lines/cross, event isolation and closing.');
} finally {
  await browser.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
