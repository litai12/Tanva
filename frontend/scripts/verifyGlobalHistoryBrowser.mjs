import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real page/store/API client, local assets and stubbed GETs. No generation or account data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `.global-history-smoke-${process.pid}`;
const html = path.join(root, `${name}.html`);
const tsx = path.join(root, `${name}.tsx`);
let server, browser;
try {
  await writeFile(html, `<html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await writeFile(tsx, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import GlobalImageHistoryPage from './src/components/global-history/GlobalImageHistoryPage';
import './src/i18n';
import './src/index.css';
function App() {
  const [open, setOpen] = React.useState(true);
  return <><button id="reopen" onClick={() => setOpen(true)}>Open</button><GlobalImageHistoryPage isOpen={open} onClose={() => setOpen(false)}/></>;
}
createRoot(document.getElementById('root')).render(<App/>);
`);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="teal"/></svg>';
  const item = id => ({ id, imageUrl: `${origin}/history-fixture.svg`, prompt: `Actual request ${id}`, sourceType: 'generate', createdAt: '2026-10-22T12:00:00Z' });
  let listCalls = 0;
  let releasePagination;
  await page.route('**/history-fixture.svg', route => route.fulfill({contentType: 'image/svg+xml', body: svg}));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/global-image-history')) {
      assert.equal(route.request().method(), 'GET');
      listCalls++;
      if (url.searchParams.get('cursor')) {
        await new Promise(resolve => { releasePagination = resolve; });
        return route.fulfill({ json: { items: [item('second')], nextCursor: 'second', hasMore: true } });
      }
      return route.fulfill({ json: { items: [item('first')], nextCursor: 'first', hasMore: true } });
    }
    if (url.pathname.endsWith('/assets/proxy')) return route.fulfill({contentType: 'image/svg+xml', body: svg});
    return route.fulfill({ json: {} });
  });
  await page.goto(`${origin}/${name}.html`);
  const loadMore = page.getByRole('button', { name: /^(加载更多|Load More)$/ });
  await loadMore.waitFor();
  await page.getByAltText('Actual request first').locator('..').locator('..').click({ position: { x: 20, y: 70 } });
  const detailHeading = page.getByRole('heading', { name: /^(图片详情|Image Details)$/ });
  await detailHeading.waitFor();
  assert.equal(await page.getByAltText('Actual request first').count(), 2, 'image opens in history detail');
  const detailRoot = detailHeading.locator('..').locator('..').locator('..');
  assert.equal(await detailRoot.getAttribute('translate'), 'no');
  assert.ok((await detailRoot.getAttribute('class')).split(/\s+/).includes('notranslate'));
  await page.waitForFunction(() => [...document.images].filter(image => image.alt === 'Actual request first').every(image => image.complete && image.naturalWidth === 640));
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: /^(图片详情|Image Details)$/ }).waitFor({ state: 'detached' });

  // Replace React's text nodes with <font>, as page translation extensions do.
  // Force mutation even inside notranslate to also cover extensions ignoring it.
  const simulateTranslation = button => button.evaluate(button => {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) if (walker.currentNode.textContent.trim()) texts.push(walker.currentNode);
    for (const node of texts) {
      const translated = document.createElement('font');
      translated.textContent = node.textContent;
      node.replaceWith(translated);
    }
  });
  await simulateTranslation(loadMore);
  await loadMore.click();
  await page.waitForTimeout(100);
  assert.deepEqual(errors, [], 'translated load-more button must not crash while entering loading state');
  const loading = page.getByRole('button', { name: /^(加载中\.\.\.|Loading\.\.\.)$/ });
  await loading.waitFor();
  assert.equal(await loading.isDisabled(), true);
  assert.equal(listCalls, 2, 'pagination fetches once');
  assert.ok(releasePagination, 'pagination route reached');
  await simulateTranslation(loading);
  releasePagination();
  await page.waitForTimeout(100);
  assert.deepEqual(errors, [], 'translated loading label must not crash while completing pagination');
  await page.getByAltText('Actual request second').waitFor();
  assert.equal(await page.getByAltText('Actual request first').count(), 1);
  await loadMore.waitFor();
  const historyRoot = page.getByRole('heading', { name: /^(全局历史|Global History)$/ }).locator('..').locator('..');
  assert.equal(await historyRoot.getAttribute('translate'), 'no');
  assert.ok((await historyRoot.getAttribute('class')).split(/\s+/).includes('notranslate'));
  await page.keyboard.press('Escape');
  await historyRoot.waitFor({ state: 'detached' });
  await page.locator('#reopen').click();
  await page.getByAltText('Actual request first').waitFor();
  assert.deepEqual(errors, [], 'history open, pagination, close/reopen must have no runtime errors');
  console.log('PASS: global history image details, translated-text pagination/loading, portal translation opt-out, close/reopen; stubbed local GETs only.');
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([html, tsx].map(file => unlink(file).catch(() => {})));
}
