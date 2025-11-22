import paper from 'paper';
import { useLayerStore } from '@/stores/layerStore';

const SYSTEM_LAYER_NAMES = new Set(['grid', 'background', 'scalebar']);
const SANDBOX_LAYER_NAME = '__tanva_sandbox__';
let lastSandboxItems: paper.Item[] = [];

const insertAboveGrid = (layer: paper.Layer) => {
  const gridLayer = paper.project?.layers.find((candidate) => candidate.name === 'grid');
  if (gridLayer) {
    layer.insertAbove(gridLayer);
  }
};

const ensureSandboxLayer = (): paper.Layer => {
  if (!paper.project) {
    throw new Error('Paper.js 尚未初始化');
  }

  const existing = paper.project.layers.find((layer) => layer.name === SANDBOX_LAYER_NAME);
  if (existing) {
    existing.visible = true;
    (existing as any).locked = false;
    existing.activate();
    return existing;
  }

  const sandboxLayer = new paper.Layer();
  sandboxLayer.name = SANDBOX_LAYER_NAME;
  sandboxLayer.data = { isSandbox: true };
  sandboxLayer.visible = true;
  sandboxLayer.activate();
  insertAboveGrid(sandboxLayer);
  return sandboxLayer;
};

const getSandboxLayer = (): paper.Layer | null => {
  if (!paper.project) return null;
  return paper.project.layers.find((layer) => layer.name === SANDBOX_LAYER_NAME) || null;
};

const collectSnapshot = (): Set<paper.Item> => {
  const snapshot = new Set<paper.Item>();
  if (!paper.project) return snapshot;

  const visit = (item: paper.Item | null) => {
    if (!item || snapshot.has(item)) {
      return;
    }
    snapshot.add(item);
    const children = (item as any).children as paper.Item[] | undefined;
    if (children && children.length) {
      children.forEach(visit);
    }
  };

  paper.project.layers.forEach((layer) => visit(layer));
  return snapshot;
};

const shouldTrackItem = (item: paper.Item): boolean => {
  const layerName = item instanceof paper.Layer ? item.name || '' : item.layer?.name || '';
  if (SYSTEM_LAYER_NAMES.has(layerName)) {
    return false;
  }
  if ((item.data as any)?.isHelper) {
    return false;
  }
  return true;
};

const diffSinceSnapshot = (before: Set<paper.Item>): paper.Item[] => {
  const created: paper.Item[] = [];
  const current = collectSnapshot();
  current.forEach((item) => {
    if (!before.has(item) && shouldTrackItem(item)) {
      created.push(item);
    }
  });
  return created;
};

const removeItems = (items: paper.Item[]) => {
  items.forEach((item) => {
    if (!item) return;
    try {
      if (!item.removed) {
        item.remove();
      }
    } catch {
      // ignore removal errors
    }
  });
};

const formatDuration = (ms: number) => Math.round(ms * 10) / 10;

const ensureActiveLayer = (): paper.Layer | null => {
  try {
    const ensure = useLayerStore.getState().ensureActiveLayer;
    if (typeof ensure === 'function') {
      return ensure();
    }
  } catch (error) {
    console.error('[Sandbox] ensureActiveLayer failed:', error);
  }
  return null;
};

export interface SandboxExecutionResult {
  success: boolean;
  message?: string;
  error?: string;
  durationMs?: number;
}

export interface SandboxApplyResult {
  success: boolean;
  message?: string;
  error?: string;
  count?: number;
}

export const paperSandboxService = {
  isReady(): boolean {
    return Boolean(paper?.project && paper?.view);
  },

  executeCode(code: string): SandboxExecutionResult {
    if (!code.trim()) {
      return { success: false, error: '请输入要执行的 Paper.js 代码' };
    }

    if (!paper.project || !paper.view) {
      return { success: false, error: '画布未初始化，请稍后再试' };
    }

    const previousLayer = paper.project.activeLayer || null;
    const sandboxLayer = ensureSandboxLayer();
    const snapshot = collectSnapshot();
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (paper.view) {
      paper.view.onFrame = null;
    }

    const sandboxContext = {
      paper,
      project: paper.project,
      view: paper.view,
      Path: paper.Path,
      Point: paper.Point,
      Size: paper.Size,
      Rectangle: paper.Rectangle,
      Raster: paper.Raster,
      PointText: paper.PointText,
      Group: paper.Group,
      Layer: paper.Layer,
      Style: paper.Style,
      Color: paper.Color,
      Gradient: paper.Gradient as paper.Gradient,
      GradientStop: paper.GradientStop as paper.GradientStop,
      Matrix: paper.Matrix,
      sandboxLayer,
      activeLayer: sandboxLayer,
      console,
    };

    try {
      const runner = new Function(
        ...Object.keys(sandboxContext),
        `
        ${code}
        return true;
        `
      );

      runner(...Object.values(sandboxContext));

      const createdItems = diffSinceSnapshot(snapshot);
      if (lastSandboxItems.length) {
        removeItems(lastSandboxItems);
      }
      lastSandboxItems = createdItems;

      if (paper.view) {
        paper.view.update();
      }

      const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return {
        success: true,
        message: `代码执行完成，共生成 ${createdItems.length} 个图形`,
        durationMs: formatDuration(finishedAt - startedAt),
      };
    } catch (error) {
      const createdItems = diffSinceSnapshot(snapshot);
      if (createdItems.length) {
        removeItems(createdItems);
      }

      const errMessage = error instanceof Error ? error.message : String(error);
      console.error('[Sandbox] 执行出错:', errMessage);

      return {
        success: false,
        error: errMessage,
      };
    } finally {
      if (previousLayer && previousLayer !== sandboxLayer) {
        try {
          previousLayer.activate();
        } catch {
          // ignore activation failure
        }
      }
    }
  },

  clearCanvas() {
    const sandboxLayer = getSandboxLayer();
    if (sandboxLayer) {
      try {
        sandboxLayer.removeChildren();
      } catch {
        // ignore
      }
    }
    if (paper.view) {
      paper.view.onFrame = null;
    }
    if (lastSandboxItems.length) {
      removeItems(lastSandboxItems);
      lastSandboxItems = [];
    }
    if (paper.view) {
      paper.view.update();
    }
  },

  applyOutputToActiveLayer(): SandboxApplyResult {
    if (!paper.project) {
      return { success: false, error: 'Paper.js 尚未初始化' };
    }

    const sandboxLayer = getSandboxLayer();
    if (!sandboxLayer || sandboxLayer.children.length === 0) {
      return { success: false, error: '沙盒中暂无图形' };
    }

    const targetLayer = ensureActiveLayer();
    if (!targetLayer) {
      return { success: false, error: '没有可用的画布图层' };
    }

    const clones: paper.Item[] = [];
    const items = sandboxLayer.children.slice();

    items.forEach((item) => {
      try {
        const clone = item.copyTo(targetLayer);
        if (clone) {
          clones.push(clone);
        }
      } catch (error) {
        console.error('[Sandbox] copy item failed:', error);
      }
    });

    sandboxLayer.removeChildren();
    lastSandboxItems = [];

    if (paper.view) {
      paper.view.update();
    }

    return {
      success: true,
      message: `已将 ${clones.length} 个图形应用到当前图层`,
      count: clones.length,
    };
  },

  getCodeExamples(): Record<string, string> {
    return {
      '动态光圈': `const layer = sandboxLayer;
layer.removeChildren();

const rings = 8;
const radius = 60;

for (let i = 0; i < rings; i++) {
  const pct = i / rings;
  const path = new Path.Circle({
    center: view.center,
    radius: radius + i * 24,
  });
  path.strokeWidth = 2 + pct * 6;
  path.strokeColor = new Color(0.2 + pct * 0.6, 0.6, 1 - pct * 0.5, 0.85);
  path.dashArray = [12, 8];
  path.rotate(i * 15);
}`,
      '随机星空': `const count = 160;
for (let i = 0; i < count; i++) {
  const point = new Point(Math.random() * view.bounds.width, Math.random() * view.bounds.height);
  const star = new Path.Star({
    center: point,
    points: 5,
    radius1: 2,
    radius2: 5,
    fillColor: new Color(1, 1, 1, Math.random()),
  });
  star.rotate(Math.random() * 360);
}`,
      '曲线花朵': `const petals = 24;
const base = view.center;
const multi = new Path();
multi.strokeColor = '#ff4f81';
multi.strokeWidth = 2;
multi.closed = true;

for (let i = 0; i < petals; i++) {
  const angle = (i / petals) * Math.PI * 2;
  const length = 90 + Math.sin(i * 0.6) * 40;
  const point = base + new Point(Math.cos(angle) * length, Math.sin(angle) * length);
  multi.add(point);
}
multi.smooth({ type: 'continuous' });
multi.fillColor = new Color('#ffd1dc');
multi.fillColor.alpha = 0.35;`,
      '动画环': `const circle = new Path.Circle({
  center: view.center,
  radius: 140,
  strokeColor: '#38bdf8',
  strokeWidth: 3,
  dashArray: [16, 10],
});

view.onFrame = (event) => {
  circle.rotate(0.5);
  circle.dashOffset = event.count;
};`,
    };
  },
};
