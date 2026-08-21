import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.DESKTOP_VERIFY_BASE_URL || 'http://127.0.0.1:5173';
const evidenceDir = resolve(process.env.DESKTOP_EVIDENCE_DIR || 'tmp/desktop-acceptance');
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    if (window.top !== window) return;
    Object.defineProperty(window, 'tanvaDesktop', {
      configurable: true,
      value: {
        isElectron: true,
        platform: 'darwin',
        versions: { electron: 'test', chrome: 'test', node: 'test' },
        window: {
          minimize: async () => {},
          toggleMaximize: async () => false,
          close: async () => {},
          isMaximized: async () => false,
          onMaximizedChanged: () => () => {},
        },
        auth: {
          read: async () => ({ available: true, tokens: null }),
          write: async () => true,
          clear: async () => true,
        },
        connectors: {
          list: async () => [
            { id: 'sketchup', name: 'SketchUp', hostedBy: null, available: true, source: 'discovered', transport: 'configured', toolCount: 0, error: null },
            { id: 'rhino', name: 'Rhino', hostedBy: null, available: false, source: 'missing', transport: 'not-configured', toolCount: 0, error: null },
            { id: 'grasshopper', name: 'Grasshopper', hostedBy: 'rhino', available: false, source: 'missing', transport: 'not-configured', toolCount: 0, error: null },
            { id: 'autocad', name: 'AutoCAD', hostedBy: null, available: false, source: 'missing', transport: 'not-configured', toolCount: 0, error: null },
            { id: 'photoshop', name: 'Photoshop', hostedBy: null, available: true, source: 'configured', transport: 'connected', toolCount: 2, error: null },
          ],
          configure: async () => null,
          launch: async () => ({ ok: true }),
          configureMcp: async () => null,
          connectMcp: async () => ({ transport: 'connected', toolCount: 2, error: null }),
          disconnectMcp: async () => ({ transport: 'configured', toolCount: 0, error: null }),
          listTools: async () => [
            { name: 'get_document_info', description: 'Read the active document metadata', inputSchema: { type: 'object' }, risk: 'read' },
            { name: 'export_preview', description: 'Export a read-only preview', inputSchema: { type: 'object' }, risk: 'write' },
          ],
          callTool: async () => ({ approved: true, cancelled: false, text: 'preview' }),
        },
      },
    });
    localStorage.setItem('mock_user', JSON.stringify({
      id: 'desktop-acceptance-user',
      email: 'desktop@example.com',
      name: 'Tanva 用户',
      role: 'user',
    }));
    localStorage.setItem('token_expiry', String(Date.now() + 60 * 60 * 1000));
  });

  const mockProject = {
    id: 'desktop-acceptance-project',
    name: '桌面验收项目',
    description: null,
    thumbnailUrl: null,
    teamId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await page.route('**/api/projects**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && /\/api\/projects\/?$/.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([mockProject]) });
      return;
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/content')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: {
            layers: [],
            activeLayerId: null,
            canvas: { zoom: 1, panX: 0, panY: 0 },
            assets: { images: [], models: [], texts: [], videos: [] },
            flow: { nodes: [], edges: [] },
            updatedAt: new Date().toISOString(),
          },
          version: 0,
          updatedAt: null,
        }),
      });
      return;
    }
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockProject) });
      return;
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/?desktopPreview=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新任务' }).waitFor();
  await page.getByPlaceholder('搜索任务').waitFor();
  const createProjectButton = page.getByRole('button', { name: '新建项目' });
  await createProjectButton.waitFor();
  await createProjectButton.click();
  await page.getByRole('textbox', { name: '项目名称' }).waitFor();
  await page.getByRole('button', { name: '取消' }).first().click();
  await page.getByRole('button', { name: '收起 Work', exact: true }).click();
  await page.getByRole('button', { name: '收起项目 桌面验收项目', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '展开 Work', exact: true }).click();
  await page.getByRole('button', { name: '收起项目 桌面验收项目', exact: true }).waitFor();
  const unboundTask = page.locator('[data-desktop-task-menu-root][draggable="true"]').first();
  await unboundTask.waitFor();
  const projectDropTarget = page.locator(
    '[data-desktop-project-menu-root="desktop-acceptance-project"]'
  );
  await unboundTask.dragTo(projectDropTarget);
  await page.waitForTimeout(500);
  if ((await projectDropTarget.locator('[data-desktop-task-menu-root][draggable="true"]').count()) !== 1) {
    const diagnostics = await page.evaluate(() => ({
      taskContext: localStorage.getItem('tanva:desktop-task-context:v1'),
      sidebarText: document.querySelector('aside')?.textContent || '',
    }));
    throw new Error(`Dragged task did not remain inside its project: ${JSON.stringify(diagnostics)}`);
  }
  const collapseProjectButton = page.getByRole('button', { name: '收起项目 桌面验收项目' });
  await collapseProjectButton.click();
  await projectDropTarget.locator('[data-desktop-task-menu-root][draggable="true"]').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '展开项目 桌面验收项目' }).click();
  await projectDropTarget.locator('[data-desktop-task-menu-root][draggable="true"]').waitFor();
  const chatDropTarget = page.locator('aside section').filter({ hasText: /^Chat/ });
  await unboundTask.dragTo(chatDropTarget);
  const manageProjectButton = page.getByRole('button', { name: '管理项目 桌面验收项目' });
  await manageProjectButton.click({ force: true });
  await page.getByRole('button', { name: '重命名项目' }).waitFor();
  await page.getByRole('button', { name: '删除项目' }).waitFor();
  await page.locator('main header').click({ position: { x: 120, y: 24 } });
  await page.getByRole('button', { name: '重命名项目' }).waitFor({ state: 'hidden' });
  await manageProjectButton.click({ force: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重命名项目' }).waitFor({ state: 'hidden' });
  const startProjectConversationButton = page.getByRole('button', {
    name: '在 桌面验收项目 中发起新会话',
  });
  await startProjectConversationButton.waitFor();
  if ((await startProjectConversationButton.evaluate((element) => getComputedStyle(element).opacity)) !== '1') {
    throw new Error('The project new-conversation entry must remain discoverable without hover');
  }
  await startProjectConversationButton.click();
  const projectCreatedTask = projectDropTarget.locator('[data-desktop-task-menu-root][draggable="true"]').first();
  await projectCreatedTask.waitFor();
  await projectCreatedTask.dragTo(chatDropTarget);
  await projectCreatedTask.waitFor({ state: 'hidden' });
  if ((await chatDropTarget.locator('[data-desktop-task-menu-root][draggable="true"]').count()) < 1) {
    throw new Error('A task created from a project must survive when moved back to Chat');
  }
  const chatTaskRow = chatDropTarget.locator('[data-desktop-task-menu-root][draggable="true"]').first();
  await chatTaskRow.hover();
  await chatTaskRow.getByRole('button', { name: /管理会话/ }).click();
  await page.getByRole('button', { name: '置顶会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '重命名会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '归档会话', exact: true }).waitFor();
  await page.getByRole('button', { name: '删除会话', exact: true }).waitFor();
  await page.locator('main header').click({ position: { x: 120, y: 24 } });
  await page.getByRole('button', { name: '置顶会话', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '收起 Chat', exact: true }).click();
  await chatTaskRow.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '展开 Chat', exact: true }).click();
  await chatTaskRow.waitFor();
  await page.getByRole('button', { name: '扩展' }).click();

  const extensionPanel = page.getByText('已安装工具面').locator('..');
  await extensionPanel.getByText('Tanva 画布').waitFor();
  await extensionPanel.getByText('文件工作台').waitFor();
  await extensionPanel.getByText('本机应用连接').waitFor();
  const manageButtons = extensionPanel.getByRole('button', { name: '管理' });
  if ((await manageButtons.count()) !== 1) {
    throw new Error('Only the connector management surface may expose a manual management entry');
  }
  await page.getByRole('button', { name: '扩展' }).click();

  if ((await page.getByRole('button', { name: '画布', exact: true }).count()) !== 0) {
    throw new Error('Chat tasks must not expose a project canvas');
  }
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  const canvasToggle = page.getByRole('button', { name: '画布', exact: true });
  await canvasToggle.waitFor();
  await canvasToggle.click();
  const canvasSurface = page.getByRole('region', { name: 'Tanva 画布工具面' });
  await canvasSurface.waitFor();
  await canvasSurface.locator('[data-canvas-mode="desktop-plugin"]').waitFor();
  const canvasProjectBinding = await page.evaluate(async (expectedProjectId) => {
    const snapshot = await new Promise((resolveSnapshot, rejectSnapshot) => {
      const timer = window.setTimeout(
        () => rejectSnapshot(new Error('Timed out waiting for project-scoped canvas snapshot')),
        2500
      );
      const handler = (event) => {
        const detail = event.detail || {};
        if (detail.projectId !== expectedProjectId || detail.hydrated !== true) return;
        window.clearTimeout(timer);
        window.removeEventListener('flow:nodes-snapshot', handler);
        resolveSnapshot(detail);
      };
      window.addEventListener('flow:nodes-snapshot', handler);
      window.dispatchEvent(new CustomEvent('flow:request-nodes-snapshot', {
        detail: { expectedProjectId },
      }));
    });
    const beforeCount = document.querySelectorAll('.react-flow__node').length;
    const rejected = await new Promise((resolveRejected) => {
      window.dispatchEvent(new CustomEvent('flow:agent-add-node', {
        detail: {
          type: 'textPrompt',
          data: { text: '不应写入当前项目' },
          projectId: 'another-project',
          done: (id, error) => resolveRejected({ id, error }),
        },
      }));
    });
    const accepted = await new Promise((resolveAccepted) => {
      window.dispatchEvent(new CustomEvent('flow:agent-add-node', {
        detail: {
          type: 'textPrompt',
          data: { text: '当前项目画布绑定验收' },
          projectId: expectedProjectId,
          done: (id, error) => resolveAccepted({ id, error }),
        },
      }));
    });
    await new Promise((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(resolvePaint)));
    return {
      snapshotProjectId: snapshot.projectId,
      rejected,
      accepted,
      beforeCount,
      afterCount: document.querySelectorAll('.react-flow__node').length,
    };
  }, mockProject.id);
  if (
    canvasProjectBinding.snapshotProjectId !== mockProject.id ||
    canvasProjectBinding.rejected.id !== null ||
    !canvasProjectBinding.rejected.error ||
    !canvasProjectBinding.accepted.id ||
    canvasProjectBinding.afterCount !== canvasProjectBinding.beforeCount + 1
  ) {
    throw new Error(`Current-project canvas binding failed: ${JSON.stringify(canvasProjectBinding)}`);
  }
  if ((await canvasSurface.locator('.tanva-header-shell').count()) !== 0) {
    throw new Error('Desktop canvas must not render the website project/account header');
  }
  const surfaceBox = await canvasSurface.boundingBox();
  const toolbarBox = await canvasSurface.locator('.tanva-toolbar-shell').boundingBox();
  if (!surfaceBox || !toolbarBox || toolbarBox.x < surfaceBox.x) {
    throw new Error('Canvas toolbar escaped from the plugin surface');
  }
  await page.screenshot({
    path: resolve(evidenceDir, 'desktop-canvas.png'),
    fullPage: true,
  });
  const hideCanvasButton = page.getByRole('button', { name: '隐藏', exact: true });
  if (!(await hideCanvasButton.evaluate((element) =>
    getComputedStyle(element).whiteSpace === 'nowrap' && element.scrollHeight <= element.clientHeight
  ))) {
    throw new Error('Canvas visibility control must stay on one line');
  }
  await hideCanvasButton.click();
  await canvasSurface.waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('tanva:desktop-surface-request', {
      detail: { pluginId: 'tanva.canvas', reason: 'acceptance-repeated-agent-patch' },
    }));
  });
  await page.waitForTimeout(100);
  if ((await canvasSurface.count()) !== 0) {
    throw new Error('A repeated agent patch reopened a canvas that the user manually hid');
  }
  await page.evaluate(() => {
    window.dispatchEvent(new Event('tanva:desktop-surface-auto-open-reset'));
    window.dispatchEvent(new CustomEvent('tanva:desktop-surface-request', {
      detail: { pluginId: 'tanva.canvas', reason: 'acceptance-next-user-turn' },
    }));
  });
  await canvasSurface.waitFor();
  await page.getByRole('button', { name: '隐藏', exact: true }).click();
  await canvasSurface.waitFor({ state: 'hidden' });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('tanva:desktop-open-artifact', {
      detail: {
        id: 'sheet-acceptance',
        kind: 'spreadsheet',
        title: '项目预算',
        summary: '1 个工作表',
        formats: ['xlsx'],
        sheets: [{ name: '预算', rows: [['项目', '金额'], ['设计', '1200']] }],
        createdAt: new Date().toISOString(),
      },
    }));
  });
  const artifactSurface = page.getByRole('region', { name: '文件工作台工具面' });
  await artifactSurface.waitFor();
  await artifactSurface.getByText('项目预算', { exact: true }).first().waitFor();
  await artifactSurface.getByText('设计', { exact: true }).waitFor();
  await artifactSurface.getByRole('button', { name: '下载 XLSX' }).waitFor();
  await page.screenshot({
    path: resolve(evidenceDir, 'desktop-artifacts.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('tanva:desktop-open-artifact', {
      detail: {
        id: 'presentation-acceptance',
        kind: 'presentation',
        title: '产品方案',
        summary: '2 页 · 16:9',
        nodeId: 'presentation-node-acceptance',
        formats: ['html', 'pptx'],
        deck: {
          version: 1,
          aspectRatio: '16:9',
          themeCss: '.slide-root { background: #07162f; color: white; font-family: system-ui; padding: 96px; }',
          slides: [
            { id: 'slide-1', title: '封面', html: '<h1 style="font-size:92px">产品方案</h1><p style="font-size:32px;color:#67e8f9">Tanva Desktop</p>', css: '' },
            { id: 'slide-2', title: '能力', html: '<h1 style="font-size:72px">创作能力</h1><p style="font-size:32px">对话、画布、PPT 与 Excel</p>', css: '' },
          ],
        },
        createdAt: new Date().toISOString(),
      },
    }));
  });
  await artifactSurface.getByText('产品方案', { exact: true }).first().waitFor();
  await artifactSurface.getByRole('button', { name: '第 1 页 封面', exact: true }).waitFor();
  await artifactSurface.getByRole('button', { name: '第 2 页 能力', exact: true }).click();
  await artifactSurface.getByRole('button', { name: 'PPTX', exact: true }).waitFor();
  if ((await artifactSurface.locator('iframe').count()) < 3) {
    throw new Error('Presentation workspace must render slide thumbnails and an active slide preview');
  }
  await page.screenshot({
    path: resolve(evidenceDir, 'desktop-presentation.png'),
    fullPage: true,
  });
  await page.getByTitle('关闭工具面').click();
  await artifactSurface.waitFor({ state: 'hidden' });

  const chatInput = page.getByPlaceholder(/输入任何内容/);
  await chatInput.fill('打开画布');
  await chatInput.press('Enter');
  await canvasSurface.waitFor();
  await page.getByRole('main').getByText('已展开当前项目画布。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '隐藏', exact: true }).click();
  await canvasSurface.waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: '扩展' }).click();
  const reopenedExtensionPanel = page.getByText('已安装工具面').locator('..');
  const connectorManageButton = reopenedExtensionPanel.getByRole('button', { name: '管理' });
  await connectorManageButton.click();

  const connectorSurface = page.getByRole('region', { name: '本机应用连接工具面' });
  await connectorSurface.waitFor();
  await connectorSurface.getByText('SketchUp', { exact: true }).waitFor();
  await connectorSurface.getByText('MCP 已连接 · 2 个工具').waitFor();
  await connectorSurface.getByRole('button', { name: '工具', exact: true }).click();
  await connectorSurface.getByText('get_document_info').waitFor();
  await page.screenshot({
    path: resolve(evidenceDir, 'desktop-connectors.png'),
    fullPage: true,
  });
  await page.getByTitle('关闭工具面').click();
  await connectorSurface.waitFor({ state: 'hidden' });

  await page.keyboard.press('Meta+K');
  if (!(await page.getByPlaceholder('搜索任务').evaluate((element) => element === document.activeElement))) {
    throw new Error('Command-K did not focus task search');
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+b');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).waitFor();
  await page.keyboard.press('Meta+b');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).waitFor();

  await page.screenshot({
    path: resolve(evidenceDir, 'desktop-task-shell.png'),
    fullPage: true,
  });

  if (pageErrors.length) throw new Error(`Desktop shell page errors:\n${pageErrors.join('\n')}`);
  console.log(JSON.stringify({
    ok: true,
    taskShell: true,
    projectManagement: true,
    uniqueManualEntry: true,
    canvasToggle: true,
    localCanvasCommand: true,
    currentCanvasOperations: true,
    embeddedCanvas: true,
    artifactWorkspace: true,
    connectorSurface: true,
    commandK: true,
    sidebarToggle: true,
    evidence: [
      resolve(evidenceDir, 'desktop-task-shell.png'),
      resolve(evidenceDir, 'desktop-canvas.png'),
      resolve(evidenceDir, 'desktop-artifacts.png'),
      resolve(evidenceDir, 'desktop-presentation.png'),
      resolve(evidenceDir, 'desktop-connectors.png'),
    ],
  }, null, 2));
} finally {
  // Chrome occasionally leaves its CDP transport pending after all assertions have
  // completed. Bound teardown so the acceptance command cannot hang indefinitely.
  await Promise.race([
    browser.close(),
    new Promise((resolveClose) => setTimeout(resolveClose, 5_000)),
  ]);
}

process.exit(0);
