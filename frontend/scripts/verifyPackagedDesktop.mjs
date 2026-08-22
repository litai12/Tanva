import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const cdpUrl = process.env.DESKTOP_CDP_URL || 'http://127.0.0.1:9333';
const evidenceDir = resolve(process.env.DESKTOP_EVIDENCE_DIR || 'tmp/desktop-acceptance');
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.connectOverCDP(cdpUrl);
let createdSessionId = null;

try {
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => candidate.url().startsWith('file://')) ?? context.pages()[0];
  if (!page) throw new Error('Tanva packaged renderer page was not found');

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByRole('button', { name: '新任务' }).waitFor({ timeout: 20_000 });

  const project = page.locator('[data-desktop-project-menu-root]').first();
  await project.waitFor({ timeout: 20_000 });
  const projectName = (await project.getAttribute('data-desktop-project-name')) ||
    (await project.locator('button[aria-expanded]').getAttribute('aria-label')) ||
    '首个项目';
  const projectId = await project.getAttribute('data-desktop-project-menu-root');
  if (!projectId) throw new Error('Packaged project identity is missing');
  const beforeIds = new Set(
    await page.locator('[data-desktop-task-menu-root]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-desktop-task-menu-root')).filter(Boolean)
    )
  );

  const startInProject = project.getByRole('button', { name: /中发起新会话$/ });
  await startInProject.waitFor();
  if ((await startInProject.evaluate((element) => getComputedStyle(element).opacity)) !== '1') {
    throw new Error('Packaged project new-conversation entry is not permanently visible');
  }
  await startInProject.click();

  await page.waitForFunction(
    (knownIds) => Array.from(document.querySelectorAll('[data-desktop-task-menu-root]'))
      .some((node) => !knownIds.includes(node.getAttribute('data-desktop-task-menu-root'))),
    [...beforeIds],
    { timeout: 20_000 }
  );
  const afterIds = await page.locator('[data-desktop-task-menu-root]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-desktop-task-menu-root')).filter(Boolean)
  );
  createdSessionId = afterIds.find((id) => !beforeIds.has(id)) ?? null;
  if (!createdSessionId) throw new Error('Project conversation was created but no new session identity appeared');

  const createdTask = project.locator(`[data-desktop-task-menu-root="${createdSessionId}"]`);
  await createdTask.waitFor({ timeout: 20_000 });

  await page.getByRole('button', { name: '画布', exact: true }).click();
  const canvasSurface = page.getByRole('region', { name: 'Tanva 画布工具面' });
  await canvasSurface.waitFor({ timeout: 20_000 });
  await canvasSurface.locator('.react-flow__minimap').waitFor({ timeout: 20_000 });
  await canvasSurface
    .getByRole('button', { name: /切换生图线路，当前：/ })
    .waitFor({ timeout: 20_000 });
  const canvasProjectBinding = await page.evaluate(async (expectedProjectId) => {
    const snapshot = await new Promise((resolveSnapshot, rejectSnapshot) => {
      const timer = window.setTimeout(
        () => rejectSnapshot(new Error('Timed out waiting for packaged project snapshot')),
        4000
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
    const rejected = await new Promise((resolveRejected) => {
      window.dispatchEvent(new CustomEvent('flow:agent-add-node', {
        detail: {
          type: 'textPrompt',
          data: { text: '不应写入当前项目' },
          projectId: 'packaged-wrong-project',
          done: (id, error) => resolveRejected({ id, error }),
        },
      }));
    });
    return { snapshotProjectId: snapshot.projectId, rejected };
  }, projectId);
  if (
    canvasProjectBinding.snapshotProjectId !== projectId ||
    canvasProjectBinding.rejected.id !== null ||
    !canvasProjectBinding.rejected.error
  ) {
    throw new Error(`Packaged current-project binding failed: ${JSON.stringify(canvasProjectBinding)}`);
  }
  const hideCanvasButton = page.getByRole('button', { name: '隐藏', exact: true });
  if (!(await hideCanvasButton.evaluate((element) =>
    getComputedStyle(element).whiteSpace === 'nowrap' && element.scrollHeight <= element.clientHeight
  ))) {
    throw new Error('Packaged canvas visibility control wrapped onto multiple lines');
  }
  await hideCanvasButton.click();
  await canvasSurface.waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('tanva:desktop-surface-request', {
      detail: { pluginId: 'tanva.canvas', reason: 'packaged-repeated-agent-patch' },
    }));
  });
  await page.waitForTimeout(100);
  if ((await canvasSurface.count()) !== 0) {
    throw new Error('Packaged canvas reopened after the user manually hid it');
  }
  await page.evaluate(() => {
    window.dispatchEvent(new Event('tanva:desktop-surface-auto-open-reset'));
  });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('tanva:desktop-open-media-preview', {
      detail: {
        id: 'packaged-media-preview',
        title: '打包图片预览',
        items: [{ id: 'packaged-logo', url: './Logo.svg', title: '打包图片预览' }],
        currentItemId: 'packaged-logo',
        createdAt: new Date().toISOString(),
      },
    }));
  });
  const mediaSurface = page.getByRole('region', { name: '媒体预览工具面' });
  await mediaSurface.waitFor({ timeout: 20_000 });
  if (
    (await mediaSurface.getByRole('button', { name: '下载', exact: true }).count()) !== 1 ||
    (await mediaSurface.locator('button[title="最大化工具面"]').count()) !== 0
  ) {
    throw new Error('Packaged media preview did not remain a docked, downloadable side surface');
  }
  await mediaSurface.locator('button[title="关闭工具面"]').click();
  await mediaSurface.waitFor({ state: 'hidden' });

  await page.keyboard.press('Meta+b');
  await page.locator('aside').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await page.locator('aside').waitFor();

  await page.screenshot({
    path: resolve(evidenceDir, 'desktop-packaged-app.png'),
    fullPage: true,
  });

  await createdTask.hover();
  await createdTask.getByRole('button', { name: /管理会话/ }).click();
  await page.getByRole('button', { name: '删除会话', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await createdTask.waitFor({ state: 'detached', timeout: 20_000 });
  createdSessionId = null;

  if (pageErrors.length > 0) {
    throw new Error(`Packaged renderer page errors: ${pageErrors.join(' | ')}`);
  }

  console.log(JSON.stringify({
    ok: true,
    renderer: page.url(),
    loginRestored: true,
    projectConversation: true,
    canvasVisibility: true,
    manualHidePriority: true,
    currentCanvasOperations: true,
    canvasMiniMap: true,
    canvasImageRouteSwitch: true,
    mediaSidePreview: true,
    projectName,
    sidebarToggle: true,
    cleanup: true,
    evidence: resolve(evidenceDir, 'desktop-packaged-app.png'),
  }, null, 2));
} finally {
  if (createdSessionId) {
    console.warn(`[tanva-desktop] acceptance session requires manual cleanup: ${createdSessionId}`);
  }
  await browser.close();
}
