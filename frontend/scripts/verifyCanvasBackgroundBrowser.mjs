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
        import CanvasBackgroundPicker from '/src/components/canvas/CanvasBackgroundPicker.tsx';
        import GridRenderer from '/src/components/canvas/GridRenderer.tsx';
        import FocusModeButton from '/src/components/canvas/FocusModeButton.tsx';
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
        useUIStore.setState({ showGrid: true, showAxis: false, focusMode: false, showLayerPanel: false });
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
              gridState: () => {
                const layer = paper.project.layers.find(layer => layer.name === 'grid');
                return { locked: !!layer?.data?.isRendering, lines: layer?.children.filter(child => child.visible && child.data?.type === 'grid').length ?? 0,
                  strokes: layer?.children.filter(child => child.visible && child.data?.type === 'grid').slice(0, 4).map(child => child.strokeColor.toCSS()),
                  fill: layer?.children.find(child => child.visible && child.data?.type === 'solid-background')?.fillColor.toCSS() };
              },
              pixel: () => { paper.view.update(); return [...canvasRef.current.getContext('2d').getImageData(501, 503, 1, 1).data]; },
            };
          }, []);
          return React.createElement('div', { className: 'tanva-canvas-surface', 'data-background-custom': !!style,
            style: { position: 'relative', width: '100vw', height: '100vh', ...style } },
            React.createElement('canvas', { ref: canvasRef, className: 'tanva-main-canvas', width: 900, height: 700, style: { position: 'absolute', inset: 0, background: 'white' } }),
            ready && React.createElement(GridRenderer, { canvasRef, isPaperInitialized: ready }),
            React.createElement('div', { className: 'tanva-flow-overlay', style: { position: 'absolute', inset: 0, pointerEvents: 'none' } },
              React.createElement(ReactFlow, { nodes: [], edges: [] }, React.createElement(Background, { variant, color: '#94a3b8', style: { opacity: 0.4 } }))),
            React.createElement(GlobalEventCapture), React.createElement(GlobalZoomCapture),
            React.createElement(FocusModeButton), React.createElement(CanvasBackgroundPicker));
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
  const hex = page.locator('.tanva-canvas-background-input');
  const reset = page.locator('.tanva-canvas-background-fields button');
  const background = () => page.locator('.tanva-main-canvas').evaluate(element => getComputedStyle(element).backgroundColor);
  const setHex = async value => { await hex.fill(value); await hex.press('Enter'); };
  assert.equal(await background(), 'rgb(255, 255, 255)', 'unset light preference preserves default');
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
  await trigger.click();
  await page.screenshot({ path: '/tmp/tanva-canvas-background-palette.png' });
  await reset.click();
  assert.equal(await background(), 'rgb(255, 255, 255)');
  assert.deepEqual(await page.evaluate(() => window.backgroundTest.preferences()), { light: null, dark: '#ffffff' }, 'reset only clears active theme');
  await page.evaluate(() => window.backgroundTest.layer(true));
  assert.equal(await page.locator('.tanva-canvas-background-shell').evaluate(element => getComputedStyle(element).left), '330px');
  assert.deepEqual(errors, []);
  console.log('Canvas background browser checks passed: palettes, HEX, theme persistence/reset, Paper pixels/grid reopening, Flow dots/lines/cross, event isolation and closing.');
} finally {
  await browser.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
