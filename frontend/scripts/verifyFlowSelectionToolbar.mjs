import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Uses a running Vite server and mounts the production toolbar and safe-area hook.
const base = process.env.TANVA_TEST_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, channel: process.env.TANVA_TEST_BROWSER || 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/__selection_fixture', route => route.fulfill({ contentType: 'text/html', body:
    '<html><body><div id="root"></div><div data-xiaot-chat-panel style="position:fixed;left:340px;bottom:12px;width:600px;height:160px;background:white;z-index:50"></div></body></html>' }));
  await page.goto(`${base}/__selection_fixture`);
  await page.evaluate(async () => {
    const refresh = (await import('/@react-refresh')).default;
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    await import('/src/index.css');
    await import('/src/i18n/index.ts');
    const { default: Toolbar } = await import('/src/components/flow/FlowSelectionToolbar.tsx');
    const { useSelectionSafeArea } = await import('/src/components/flow/useSelectionSafeArea.ts');
    function Fixture() {
      const container = React.useRef(null);
      const area = useSelectionSafeArea(container, true);
      return React.createElement('div', { ref: container, style: { position: 'absolute', inset: 0 } },
        React.createElement(Toolbar, { count: 6, area, onAlign: value => { window.lastAlignment = value; }, onGroup: () => {} }));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  });
  const toolbar = page.getByRole('toolbar');
  await toolbar.waitFor();
  const checkClear = async () => {
    await page.waitForTimeout(250);
    const a = await toolbar.boundingBox();
    const b = await page.locator('[data-xiaot-chat-panel]').boundingBox();
    assert.ok(a && b);
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'toolbar overlaps chat');
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.width <= page.viewportSize().width, 'toolbar is offscreen');
    await toolbar.getByRole('button').first().click();
    assert.equal(await page.evaluate(() => window.lastAlignment), 'left');
  };
  await checkClear();
  await page.locator('[data-xiaot-chat-panel]').evaluate(el => { el.style.cssText = 'position:fixed;right:16px;top:16px;bottom:16px;width:580px;background:white;z-index:50'; });
  await checkClear();
  await page.setViewportSize({ width: 640, height: 700 });
  await page.locator('[data-xiaot-chat-panel]').evaluate(el => { el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:12px;height:160px;background:white;z-index:50'; });
  await checkClear();
  await page.locator('[data-xiaot-chat-panel]').evaluate(el => { el.style.display = 'none'; });
  await page.waitForTimeout(250);
  assert.ok((await toolbar.boundingBox()).y > 600, 'toolbar did not return when chat closed');
  console.log('PASS: compact chat, expanded sidebar, narrow viewport, chat dismissal, alignment click');
} finally {
  await browser.close();
}
