import paper from 'paper';
import { useLayerStore } from '@/stores/layerStore';

const SYSTEM_LAYER_NAMES = new Set(['grid', 'background', 'scalebar']);
const SANDBOX_LAYER_NAME = '__tanva_sandbox__';
const PLACEHOLDER_LAYER_NAME = '__tanva_vector_placeholder__';
let lastSandboxItems: paper.Item[] = [];
let placeholderGroup: paper.Group | null = null;

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
      // Check if item is still valid and not yet removed
      if (item.parent !== null) {
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

    // 创建 Path.Capsule 辅助函数（胶囊形状：两端是半圆的矩形）
    const createCapsule = (options: {
      from: paper.Point | [number, number];
      to: paper.Point | [number, number];
      radius: number;
      fillColor?: paper.Color | string;
      strokeColor?: paper.Color | string;
      strokeWidth?: number;
    }): paper.Path => {
      const from = Array.isArray(options.from) ? new paper.Point(options.from[0], options.from[1]) : options.from;
      const to = Array.isArray(options.to) ? new paper.Point(options.to[0], options.to[1]) : options.to;
      const radius = options.radius;

      // 计算方向向量和长度
      const direction = to.subtract(from);
      const length = direction.length;
      const angle = direction.angle;
      const normalized = length > 0 ? direction.normalize() : new paper.Point(1, 0);
      const perpendicular = new paper.Point(-normalized.y, normalized.x);

      // 如果长度小于等于半径的两倍，创建一个圆
      if (length <= radius * 2) {
        const center = from.add(to).divide(2);
        const circle = new paper.Path.Circle({
          center,
          radius: Math.max(radius, length / 2),
        });
        if (options.fillColor) {
          circle.fillColor = typeof options.fillColor === 'string' 
            ? new paper.Color(options.fillColor) 
            : options.fillColor;
        }
        if (options.strokeColor) {
          circle.strokeColor = typeof options.strokeColor === 'string' 
            ? new paper.Color(options.strokeColor) 
            : options.strokeColor;
        }
        if (options.strokeWidth !== undefined) {
          circle.strokeWidth = options.strokeWidth;
        }
        return circle;
      }

      // 创建胶囊路径：先创建水平胶囊，然后旋转
      const center = from.add(to).divide(2);
      const halfLength = length / 2;
      
      // 创建水平胶囊（从左到右）
      const capsule = new paper.Path();
      
      // 左端半圆（从底部到顶部，顺时针）
      const leftArcPoints = 16;
      for (let i = 0; i <= leftArcPoints; i++) {
        const arcAngle = Math.PI / 2 + (Math.PI / leftArcPoints) * i;
        const x = -halfLength + Math.cos(arcAngle) * radius;
        const y = Math.sin(arcAngle) * radius;
        capsule.add(new paper.Point(x, y));
      }
      
      // 顶部直线
      capsule.add(new paper.Point(halfLength, radius));
      
      // 右端半圆（从顶部到底部，顺时针）
      const rightArcPoints = 16;
      for (let i = 0; i <= rightArcPoints; i++) {
        const arcAngle = -Math.PI / 2 + (Math.PI / rightArcPoints) * i;
        const x = halfLength + Math.cos(arcAngle) * radius;
        const y = Math.sin(arcAngle) * radius;
        capsule.add(new paper.Point(x, y));
      }
      
      // 底部直线（闭合路径）
      capsule.closed = true;
      
      // 移动到中心并旋转到正确角度
      capsule.translate(center);
      if (angle !== 0) {
        capsule.rotate(angle, center);
      }
      
      // 应用样式
      if (options.fillColor) {
        capsule.fillColor = typeof options.fillColor === 'string' 
          ? new paper.Color(options.fillColor) 
          : options.fillColor;
      }
      if (options.strokeColor) {
        capsule.strokeColor = typeof options.strokeColor === 'string' 
          ? new paper.Color(options.strokeColor) 
          : options.strokeColor;
      }
      if (options.strokeWidth !== undefined) {
        capsule.strokeWidth = options.strokeWidth;
      }
      
      return capsule;
    };

    // 扩展 Path 对象，添加 Capsule 静态方法，同时保持原始构造函数行为
    const PathWithCapsule = paper.Path as typeof paper.Path & {
      Capsule?: typeof createCapsule;
    };

    // 覆盖一次即可，重复赋值也不会有副作用
    PathWithCapsule.Capsule = createCapsule;

    const sandboxContext = {
      paper,
      project: paper.project,
      view: paper.view,
      Path: PathWithCapsule as any,
      Point: paper.Point,
      Size: paper.Size,
      Rectangle: paper.Rectangle,
      Raster: paper.Raster,
      PointText: paper.PointText,
      Group: paper.Group,
      Layer: paper.Layer,
      Style: paper.Style,
      Color: paper.Color,
      Gradient: paper.Gradient as any,
      GradientStop: paper.GradientStop as any,
      Matrix: paper.Matrix,
      Segment: paper.Segment,
      Item: paper.Item,
      CompoundPath: paper.CompoundPath,
      Curve: paper.Curve,
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
          // 🎨 标记为可编辑的用户创建对象
          (clone.data as any).isUserCreated = true;
          (clone.data as any).isEditable = true;
          (clone.data as any).generatedBy = 'paperjs-ai';
          (clone.data as any).createdAt = new Date().toISOString();

          // 确保图形可以被选中
          clone.selected = false; // 不自动选中，但可以被选中

          // 递归标记所有子项
          const markChildren = (item: paper.Item) => {
            if ((item as any).children) {
              ((item as any).children as paper.Item[]).forEach((child) => {
                (child.data as any).isUserCreated = true;
                (child.data as any).isEditable = true;
                markChildren(child);
              });
            }
          };
          markChildren(clone);

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
      message: `已将 ${clones.length} 个图形应用到当前图层，可直接编辑和移动`,
      count: clones.length,
    };
  },

  /**
   * 显示矢量图形生成占位标记
   * 在画布中央显示一个彩雾涌动效果
   */
  showVectorPlaceholder(): void {
    if (!paper.project || !paper.view) {
      console.warn('[Sandbox] Paper.js 未初始化，无法显示占位标记');
      return;
    }

    // 如果已存在占位标记，先移除
    this.hideVectorPlaceholder();

    const previousLayer = paper.project.activeLayer;

    // 创建占位标记图层
    let placeholderLayer = paper.project.layers.find(
      (layer) => layer.name === PLACEHOLDER_LAYER_NAME
    );
    if (!placeholderLayer) {
      placeholderLayer = new paper.Layer();
      placeholderLayer.name = PLACEHOLDER_LAYER_NAME;
      placeholderLayer.data = { isPlaceholder: true, isHelper: true };
      insertAboveGrid(placeholderLayer);
    }
    placeholderLayer.activate();
    placeholderLayer.visible = true;

    const center = paper.view.center;
    const baseRadius = 80;

    // 创建占位标记组
    placeholderGroup = new paper.Group();
    placeholderGroup.data = { isPlaceholder: true, isHelper: true };

    // 彩雾颜色配置 - 参考 AI 对话框的彩雾效果
    // 使用径向渐变模拟模糊效果
    const auraColors = [
      { r: 59/255, g: 130/255, b: 246/255, offset: { x: -0.35, y: -0.3 }, radius: 1.1 },   // 蓝色 - 左上
      { r: 167/255, g: 139/255, b: 250/255, offset: { x: 0.35, y: -0.4 }, radius: 1.0 },   // 紫色 - 右上
      { r: 248/255, g: 113/255, b: 113/255, offset: { x: -0.4, y: 0.35 }, radius: 1.05 },  // 红色 - 左下
      { r: 251/255, g: 191/255, b: 36/255, offset: { x: 0.35, y: 0.3 }, radius: 1.1 },     // 黄色 - 右下
      { r: 52/255, g: 211/255, b: 153/255, offset: { x: 0, y: 0 }, radius: 0.85 },         // 绿色 - 中心
    ];

    // 创建彩雾圆形 - 使用径向渐变实现柔和边缘
    const auraCircles: paper.Path.Circle[] = [];
    auraColors.forEach((config, index) => {
      const offsetX = config.offset.x * baseRadius;
      const offsetY = config.offset.y * baseRadius;
      const circleCenter = new paper.Point(center.x + offsetX, center.y + offsetY);
      const circleRadius = baseRadius * config.radius;

      const circle = new paper.Path.Circle({
        center: circleCenter,
        radius: circleRadius,
      });

      // 创建径向渐变 - 从中心到边缘逐渐透明
      const gradient = new paper.Gradient();
      gradient.stops = [
        new paper.GradientStop(new paper.Color(config.r, config.g, config.b, 0.5), 0),
        new paper.GradientStop(new paper.Color(config.r, config.g, config.b, 0.3), 0.5),
        new paper.GradientStop(new paper.Color(config.r, config.g, config.b, 0), 1),
      ];
      // 标记为径向渐变
      (gradient as any).radial = true;

      circle.fillColor = new paper.Color(gradient, circleCenter, circleCenter.add(new paper.Point(circleRadius, 0)));
      circle.data = { isHelper: true, auraIndex: index };
      auraCircles.push(circle);
    });

    placeholderGroup.addChildren(auraCircles);

    // 添加彩雾涌动动画
    let frameCount = 0;
    const initialPositions = auraCircles.map(c => c.position.clone());
    const initialRadii = auraColors.map(c => baseRadius * c.radius);
    // 保存初始渐变配置用于动画
    const initialGradientConfigs = auraColors.map(c => ({ r: c.r, g: c.g, b: c.b }));

    paper.view.onFrame = () => {
      if (placeholderGroup && placeholderGroup.parent) {
        frameCount++;
        const time = frameCount * 0.02;

        // 每个彩雾圆形独立运动
        auraCircles.forEach((circle, index) => {
          const initialPos = initialPositions[index];
          const initialRadius = initialRadii[index];
          const colorConfig = initialGradientConfigs[index];

          // 不同相位的正弦波运动，创造涌动效果
          const phase = index * Math.PI * 0.4;
          const moveX = Math.sin(time + phase) * 12;
          const moveY = Math.cos(time * 0.8 + phase) * 10;

          // 更新位置
          const newPos = new paper.Point(
            initialPos.x + moveX,
            initialPos.y + moveY
          );
          circle.position = newPos;

          // 脉冲缩放效果
          const scalePhase = index * Math.PI * 0.3;
          const scale = 1 + Math.sin(time * 0.6 + scalePhase) * 0.12;
          const newRadius = initialRadius * scale;

          // 通过重新设置 bounds 来缩放圆形
          circle.bounds = new paper.Rectangle(
            newPos.x - newRadius,
            newPos.y - newRadius,
            newRadius * 2,
            newRadius * 2
          );

          // 更新渐变以匹配新位置和大小
          const gradient = new paper.Gradient();
          gradient.stops = [
            new paper.GradientStop(new paper.Color(colorConfig.r, colorConfig.g, colorConfig.b, 0.55), 0),
            new paper.GradientStop(new paper.Color(colorConfig.r, colorConfig.g, colorConfig.b, 0.35), 0.5),
            new paper.GradientStop(new paper.Color(colorConfig.r, colorConfig.g, colorConfig.b, 0), 1),
          ];
          (gradient as any).radial = true;
          circle.fillColor = new paper.Color(gradient, newPos, newPos.add(new paper.Point(newRadius, 0)));
        });
      }
    };

    paper.view.update();

    // 恢复之前的活跃图层
    if (previousLayer && previousLayer.name !== PLACEHOLDER_LAYER_NAME) {
      previousLayer.activate();
    }

    console.log('[Sandbox] 矢量图形彩雾占位标记已显示');
  },

  /**
   * 隐藏矢量图形生成占位标记
   */
  hideVectorPlaceholder(): void {
    if (!paper.project) {
      return;
    }

    // 停止动画
    if (paper.view) {
      paper.view.onFrame = null;
    }

    // 移除占位标记组
    if (placeholderGroup && placeholderGroup.parent) {
      placeholderGroup.remove();
      placeholderGroup = null;
    }

    // 移除占位标记图层
    const placeholderLayer = paper.project.layers.find(
      (layer) => layer.name === PLACEHOLDER_LAYER_NAME
    );
    if (placeholderLayer) {
      placeholderLayer.removeChildren();
      placeholderLayer.remove();
    }

    if (paper.view) {
      paper.view.update();
    }

    console.log('[Sandbox] 矢量图形占位标记已隐藏');
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
