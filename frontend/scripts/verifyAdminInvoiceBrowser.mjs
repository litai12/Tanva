import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real React components and API clients; no backend, real accounts, or payments.
const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = await mkdtemp(join(tmpdir(), 'tanva-admin-invoice-vite-'));
const artifactDir = await mkdtemp(join(tmpdir(), 'tanva-admin-invoice-browser-'));
const apiBase = 'http://127.0.0.1:41998';
const virtualId = '\0admin-invoice-regression';
const userA = { userId: 'invoice-user-a', userName: '发票测试甲', phone: '13800000001', email: 'invoice-a@example.invalid' };
const userB = { userId: 'invoice-user-b', userName: '发票测试乙', phone: '13800000002', email: 'invoice-b@example.invalid' };
const userRecord = user => ({
  id: user.userId, name: user.userName, phone: user.phone, email: user.email,
  role: 'user', status: 'active', wechatBound: false,
  createdAt: '2026-10-01T12:00:00Z', lastLoginAt: null,
  creditBalance: 12345, totalSpent: 200, totalEarned: 12545, apiCallCount: 3,
});
const orders = Array.from({ length: 43 }, (_, index) => ({
  id: `paid-${index + 1}`, orderNo: `INVOICE-${String(index + 1).padStart(3, '0')}`,
  userId: userA.userId, userPhone: userA.phone, userEmail: userA.email, userName: userA.userName,
  orderType: index === 1 ? 'membership' : 'recharge',
  planName: index === 1 ? '年度专业会员' : null, billingCycle: index === 1 ? 'yearly' : null,
  amount: index === 0 ? 25.5 : index === 1 ? 198 : 10 + index,
  credits: (index + 1) * 100, paymentMethod: ['alipay', 'wechat', 'local'][index % 3],
  status: 'paid', tradeNo: `TRADE-${index + 1}`, paidAt: '2026-10-14T08:00:00Z',
  expiredAt: null, createdAt: '2026-10-14T07:55:00Z',
}));
const totalAmount = Number(orders.reduce((total, order) => total + order.amount, 0).toFixed(2));
const paidResponse = (page, source = orders) => ({
  orders: source.slice((page - 1) * 20, page * 20),
  pagination: { page, pageSize: 20, total: source.length, totalPages: Math.ceil(source.length / 20) },
  totalAmount: source === orders ? totalAmount : source.reduce((total, order) => total + order.amount, 0),
});
const rechargeOrders = {
  membership: { count: 1, totalAmount: 198, totalCredits: 19800, latestPaidAt: '2026-10-14T08:00:00Z' },
  wechatRecharge: { count: 2, totalAmount: 50, totalCredits: 5000, latestPaidAt: '2026-10-13T08:00:00Z' },
  alipayRecharge: { count: 3, totalAmount: 125.5, totalCredits: 12550, latestPaidAt: '2026-10-12T08:00:00Z' },
  recentOrders: orders.slice(0, 3),
};

const server = await createServer({
  root: frontendRoot, cacheDir,
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
    'import.meta.env.VITE_AUTH_MODE': JSON.stringify('server'),
  },
  server: { host: '127.0.0.1', port: 0, proxy: {} },
  optimizeDeps: { entries: [], include: [
    'react', 'react-dom', 'react-dom/client', 'zustand', 'zustand/middleware', 'clsx',
    'tailwind-merge', 'react-router-dom', '@radix-ui/react-switch', 'lucide-react',
    'react-i18next', 'i18next', 'i18next-browser-languagedetector',
  ] },
  plugins: [{
    name: 'admin-invoice-regression-harness',
    configureServer(viteServer) {
      viteServer.middlewares.use('/admin-invoice-regression.html', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(await viteServer.transformIndexHtml('/admin-invoice-regression.html',
          '<div id="root"></div><script type="module" src="/admin-invoice-regression.js"></script>'));
      });
    },
    resolveId(id) { if (id === '/admin-invoice-regression.js') return virtualId; },
    // Export the existing Tab for integration testing without a production source change.
    transform(code, id) {
      if (id.split('?')[0] === join(frontendRoot, 'src/pages/Admin.tsx')) {
        return `${code}\nexport { UsersTab as InvoiceRegressionUsersTab };`;
      }
    },
    load(id) {
      if (id !== virtualId) return;
      return `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import UserPaidOrdersModal from '/src/components/admin/UserPaidOrdersModal.tsx';
        import { InvoiceRegressionUsersTab } from '/src/pages/Admin.tsx';
        import { useAuthStore } from '/src/stores/authStore.ts';
        import { setTokens } from '/src/services/authTokenStorage.ts';
        import '/src/index.css';
        setTokens({ accessToken: 'invoice-regression-token' });
        useAuthStore.setState({user: {id: 'invoice-test-admin', role: 'admin', name: '隔离测试管理员'}});
        const root = createRoot(document.getElementById('root'));
        const close = () => root.render(null);
        window.invoiceTest = {
          render(user) { root.render(React.createElement(UserPaidOrdersModal, {user, onClose: close})); },
          integration() { root.render(React.createElement(InvoiceRegressionUsersTab, {canManageSensitiveUserFields: true})); },
          close,
        };
      `;
    },
  }],
});

let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors = [];
  const unexpectedRequests = [];
  const paidRequests = [];
  const heldRequests = [];
  let mode = 'normal';
  let holdNext = false;
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser runtime error:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/') && url.origin === origin) return route.continue();
    const headers = {
      'access-control-allow-origin': request.headers().origin || '*',
      'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const paidMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/paid-orders$/);
    if (paidMatch) {
      const userId = decodeURIComponent(paidMatch[1]);
      const requestedPage = Number(url.searchParams.get('page') || 1);
      paidRequests.push({ userId, page: requestedPage, authorization: request.headers().authorization });
      let json = mode === 'empty' ? paidResponse(requestedPage, []) : paidResponse(requestedPage);
      if (userId === userB.userId) json = paidResponse(requestedPage, [{ ...orders[0], id: 'other-user-paid', userId, orderNo: 'OTHER-USER-ORDER', amount: 88.88 }]);
      if (holdNext) {
        holdNext = false;
        await new Promise(resolve => heldRequests.push(resolve));
      }
      try {
        return await route.fulfill(mode === 'error'
          ? { status: 503, headers, json: { message: '模拟交易记录加载失败' } }
          : { headers, json });
      } catch (error) {
        // Aborting a stale fetch is valid; the UI checks below also catch stale overwrites.
        if (!/closed|canceled|cancelled|invalid|intercepted/i.test(error.message)) throw error;
        return;
      }
    }
    if (url.pathname === '/api/admin/users') return route.fulfill({ headers, json: {
      users: [userRecord(userA), userRecord(userB)],
      pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
    } });
    if (url.pathname === '/api/admin/credit-change-records') return route.fulfill({ headers, json: {
      records: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    } });
    if (/^\/api\/admin\/users\/[^/]+\/credits\/transactions$/.test(url.pathname)) return route.fulfill({ headers, json: {
      transactions: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    } });
    if ([`/api/admin/users/${userA.userId}`, `/api/admin/users/${userB.userId}`].includes(url.pathname)) {
      return route.fulfill({ headers, json: { ...userRecord(url.pathname.endsWith(userB.userId) ? userB : userA), rechargeOrders } });
    }
    unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    return route.fulfill({ status: 404, headers, json: { message: 'Unexpected isolated test request' } });
  });
  await page.goto(`${origin}/admin-invoice-regression.html`);
  await page.waitForFunction(() => window.invoiceTest);
  const render = user => page.evaluate(user => window.invoiceTest.render(user), user);
  const dialog = page.getByRole('dialog', { name: '开发票 · 交易记录' });
  const rows = dialog.locator('tbody tr');
  const order = orderNo => dialog.getByText(orderNo, { exact: true });
  const waitOrder = async orderNo => order(orderNo).waitFor({ state: 'visible' });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const next = () => dialog.getByRole('button', { name: '下一页', exact: true });
  const previous = () => dialog.getByRole('button', { name: '上一页', exact: true });

  await render(userA);
  await waitOrder('INVOICE-001');
  assert.equal(await rows.count(), 20, 'first page contains exactly 20 successful transactions');
  assert.equal(await previous().isDisabled(), true, 'first page cannot go backwards');
  assert.equal(await next().isDisabled(), false);
  assert.match(await rows.first().innerText(), /支付宝/);
  assert.match(await rows.first().innerText(), /25\.50/);
  assert.match(await rows.nth(1).innerText(), /微信/);
  assert.match(await rows.nth(1).innerText(), /年度专业会员/);
  assert.match(await rows.nth(2).innerText(), /本地/);
  assert.ok((await dialog.innerText()).includes(new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(totalAmount)));
  assert.match(await dialog.innerText(), /43/);
  assert.equal(paidRequests[0].authorization, 'Bearer invoice-regression-token');
  await page.screenshot({ path: join(artifactDir, 'paid-orders-first-page.png'), fullPage: true });

  await next().click();
  await waitOrder('INVOICE-021');
  assert.equal(await rows.count(), 20);
  assert.equal(await order('INVOICE-001').count(), 0);
  await next().click();
  await waitOrder('INVOICE-041');
  assert.equal(await rows.count(), 3, 'last page contains the remaining three transactions');
  assert.equal(await next().isDisabled(), true);
  assert.equal(await previous().isDisabled(), false);
  await previous().click();
  await waitOrder('INVOICE-021');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await render(userA);
  await waitOrder('INVOICE-001');
  assert.equal(paidRequests.at(-1).page, 1, 'reopening resets to the first page');

  await page.evaluate(() => window.invoiceTest.close());
  mode = 'empty';
  await render(userA);
  await dialog.getByText(/暂无.*(交易|订单)/).waitFor();
  assert.equal(await dialog.getByText('INVOICE-001', { exact: true }).count(), 0);
  assert.equal(await next().isDisabled(), true);
  assert.equal(await previous().isDisabled(), true);
  await page.screenshot({ path: join(artifactDir, 'paid-orders-empty.png'), fullPage: true });
  await page.evaluate(() => window.invoiceTest.close());
  mode = 'error';
  await render(userA);
  await dialog.getByText('模拟交易记录加载失败', { exact: true }).waitFor();
  mode = 'normal';
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await waitOrder('INVOICE-001');

  // A late page response from the previous mount must not replace a reopened first page.
  holdNext = true;
  await next().click();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes('加载'));
  assert.equal(heldRequests.length, 1);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await render(userA);
  await waitOrder('INVOICE-001');
  heldRequests.shift()();
  await settle();
  assert.equal(await order('INVOICE-021').count(), 0);

  // Update props on the same real component while its old user's request is pending.
  holdNext = true;
  await next().click();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent.includes('加载'));
  assert.equal(heldRequests.length, 1);
  await render(userB);
  await waitOrder('OTHER-USER-ORDER');
  assert.equal(paidRequests.at(-1).page, 1, 'changing user resets the page');
  heldRequests.shift()();
  await settle();
  assert.equal(await order('INVOICE-021').count(), 0, 'old user response never replaces the current user');
  assert.match(await dialog.innerText(), /88\.88/);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // Integration: the actual UsersTab loads real API clients and owns both modal layers.
  await page.evaluate(() => window.invoiceTest.integration());
  await page.getByRole('row').filter({ hasText: userA.userName }).getByRole('button', { name: '详情', exact: true }).click();
  const creditHeading = page.getByRole('heading', { name: `积分详情 - ${userA.userName}`, exact: true });
  await creditHeading.waitFor();
  await page.getByText('支付宝购买积分', { exact: true }).waitFor();
  const alipayCard = page.getByText('支付宝购买积分', { exact: true }).locator('..');
  assert.match(await alipayCard.innerText(), /3\s*笔/);
  assert.match(await alipayCard.innerText(), /125\.50/);
  assert.match(await alipayCard.innerText(), /12,550/);
  await page.getByRole('button', { name: '开发票', exact: true }).click();
  await waitOrder('INVOICE-001');
  await page.screenshot({ path: join(artifactDir, 'credit-details-invoice-integration.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await creditHeading.isVisible(), true, 'Escape closes only invoice dialog');
  await page.getByRole('button', { name: '开发票', exact: true }).click();
  await waitOrder('INVOICE-001');
  await page.getByTestId('paid-orders-backdrop').click({ position: { x: 4, y: 4 } });
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await creditHeading.isVisible(), true, 'backdrop closes only invoice dialog');
  assert.deepEqual(unexpectedRequests, [], 'all API requests are mocked and no external service is used');
  assert.deepEqual(errors, [], 'no React or browser runtime errors');
  console.log(`Admin invoice browser verification passed: 20-row pagination, last/previous pages, channels and amounts, empty/error/retry, reopen reset, late requests/user switching, real credit-detail integration, Escape/backdrop layering. Screenshots: ${artifactDir}`);
} catch (error) {
  if (browser) {
    const [page] = browser.contexts().flatMap(context => context.pages());
    if (page) await page.screenshot({ path: join(artifactDir, 'failure.png'), fullPage: true }).catch(() => {});
  }
  console.error(`Admin invoice browser verification failed. Artifacts: ${artifactDir}`);
  throw error;
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
