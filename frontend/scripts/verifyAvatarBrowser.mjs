import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cacheDir = await mkdtemp(join(tmpdir(), 'tanva-avatar-vite-'));
const remoteBase = 'https://avatar-fixture.oss-cn-shenzhen.aliyuncs.com';
const apiBase = 'http://127.0.0.1:41999';
const virtualId = '\0avatar-regression';
const server = await createServer({
  cacheDir,
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
    'import.meta.env.VITE_AUTH_MODE': JSON.stringify('server'),
    'import.meta.env.VITE_ASSET_PUBLIC_BASE_URL': JSON.stringify(remoteBase),
    'import.meta.env.VITE_IMAGE_UPLOAD_BACKEND_RELAY': JSON.stringify('true'),
  },
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { entries: [] },
  plugins: [{
    name: 'avatar-regression-harness',
    configureServer(viteServer) {
      viteServer.middlewares.use('/avatar-regression.html', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await viteServer.transformIndexHtml('/avatar-regression.html', '<div id="avatar" style="width:48px;height:48px"></div><script type="module" src="/avatar-regression.js"></script>'));
      });
    },
    resolveId(id) { if (id === '/avatar-regression.js') return virtualId; },
    load(id) {
      if (id !== virtualId) return;
      return `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import UserAvatar from '/src/components/ui/UserAvatar.tsx';
        import { uploadUserAvatar } from '/src/services/avatarProfile.ts';
        import { setTokens } from '/src/services/authTokenStorage.ts';
        setTokens({ accessToken: 'avatar-regression-token' });
        const root = createRoot(document.getElementById('avatar'));
        window.avatarTest = {
          render(src) { root.render(React.createElement(UserAvatar, { src, name: '测试用户', userId: 'avatar-test' })); },
          async upload() {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 32;
            canvas.getContext('2d').fillRect(0, 0, 32, 32);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            return uploadUserAvatar(new File([blob], '测试头像.png', { type: 'image/png' }));
          }
        };
      `;
    },
  }],
});
await server.listen();
const address = server.httpServer.address();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let mode = 'private';
  let savedUrl = `${remoteBase}/uploads/avatars/old.png`;
  const patches = [];
  const proxyAuthHeaders = [];
  let proxyReads = 0;
  let imageBytes;
  await page.route(`${remoteBase}/**`, route => mode === 'public'
    ? route.fulfill({ contentType: 'image/png', body: imageBytes })
    : route.fulfill({ status: 403, body: 'AccessDenied' }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      'access-control-allow-origin': request.headers().origin || '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/api/uploads/image') return route.fulfill({ headers, json: { url: `${remoteBase}/uploads/avatars/${mode}.png`, key: `uploads/avatars/${mode}.png` } });
    if (path === '/api/users/me' && request.method() === 'PATCH') {
      const payload = request.postDataJSON();
      patches.push(payload);
      savedUrl = payload.avatarUrl;
      return route.fulfill({ headers, json: { id: 'avatar-test', name: '测试用户', email: 'test@example.invalid', avatarUrl: savedUrl } });
    }
    if (path === '/api/assets/proxy') {
      proxyReads += 1;
      proxyAuthHeaders.push(request.headers().authorization);
      // Simulate readable HTTP response with corrupt image bytes: transport success is insufficient.
      const bytes = mode === 'corrupt' ? Buffer.from('this is not an image') : imageBytes;
      return route.fulfill({ headers, status: mode === 'unreadable' ? 403 : 200, contentType: mode === 'generic-mime' ? 'application/octet-stream' : 'image/png', body: bytes });
    }
    return route.fulfill({ headers, status: 404, json: {} });
  });
  await page.goto(`http://127.0.0.1:${address.port}/avatar-regression.html`);
  await page.waitForFunction(() => window.avatarTest);
  imageBytes = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = '#3b82f6';
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const render = src => page.evaluate(src => window.avatarTest.render(src), src);
  const waitForImage = () => page.waitForFunction(() => {
    const image = document.querySelector('#avatar img');
    return image?.complete && image.naturalWidth === 32;
  });

  mode = 'public';
  await render(`${remoteBase}/uploads/avatars/public.png`);
  await waitForImage();
  assert.equal(proxyReads, 0, 'public avatar displays directly without a proxy request');
  await render('uploads/avatars/key.png');
  await waitForImage();
  assert.equal(await page.locator('#avatar img').getAttribute('src'), `${remoteBase}/uploads/avatars/key.png`);

  mode = 'private';
  await render(`${remoteBase}/uploads/avatars/private.png`);
  await waitForImage();
  assert.match(await page.locator('#avatar img').getAttribute('src'), /^blob:/);
  assert.ok(proxyAuthHeaders.includes('Bearer avatar-regression-token'), 'avatar proxy fallback supports bearer auth');
  const updated = await page.evaluate(() => window.avatarTest.upload());
  assert.equal(updated.avatarUrl, `${remoteBase}/uploads/avatars/private.png`);
  assert.deepEqual(patches, [{ avatarUrl: `${remoteBase}/uploads/avatars/private.png` }], 'profile persists stable original remote URL');
  const previousUrl = savedUrl;

  mode = 'generic-mime';
  await render(`${remoteBase}/uploads/avatars/generic-mime.png`);
  await waitForImage();
  assert.match(await page.locator('#avatar img').getAttribute('src'), /^blob:/, 'legacy octet-stream image still decodes');

  for (const failureMode of ['unreadable', 'corrupt']) {
    mode = 'public';
    await render(previousUrl);
    await waitForImage();
    const displayedBefore = await page.locator('#avatar img').getAttribute('src');
    mode = failureMode;
    const error = await page.evaluate(async () => {
      try { await window.avatarTest.upload(); return null; }
      catch (error) { return error.message; }
    });
    assert.ok(error, `${failureMode} upload must reject`);
    assert.equal(patches.length, 1, 'failed upload must not patch the profile');
    assert.equal(savedUrl, previousUrl, 'failed replacement keeps the saved avatar');
    assert.equal(await page.locator('#avatar img').getAttribute('src'), displayedBefore, 'failed replacement keeps the displayed avatar');
    await render(`${remoteBase}/uploads/avatars/${failureMode}.png`);
    await page.waitForFunction(() => document.querySelector('#avatar')?.textContent === '测');
    assert.equal(await page.locator('#avatar img').count(), 0, 'failed avatar shows initial without broken image');
  }

  mode = 'public';
  await render(`${remoteBase}/uploads/avatars/replacement.png`);
  await waitForImage();
  await render(null);
  await page.waitForFunction(() => document.querySelector('#avatar')?.textContent === '测');
  assert.deepEqual(errors, [], 'no React/runtime errors');
  console.log('Avatar browser verification passed: public URL, legacy key, private origin + authenticated proxy, stable profile URL, octet-stream image, unreadable/corrupt upload preservation, initials fallback, replacement recovery.');
} finally {
  await browser.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
