/**
 * 网格渲染优化器
 * 根据缩放级别动态调整渲染范围，防止过度渲染导致内存溢出
 */

export interface GridRenderConfig {
  zoom: number;
  viewWidth: number;
  viewHeight: number;
  gridSize: number;
}

export interface GridRenderBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  renderWidth: number;
  renderHeight: number;
  gridLineCount: number;
  estimatedObjectCount: number;
}

/**
 * 根据缩放级别计算渲染倍数
 * 缩放越小，渲染范围越大，但有上限
 */
export function calculateRenderMultiplier(zoom: number): number {
  // 缩放级别 -> 渲染倍数映射
  if (zoom >= 0.8) return 1.5;    // 80%+ 只渲染1.5倍
  if (zoom >= 0.5) return 2;      // 50-80% 渲染2倍
  if (zoom >= 0.3) return 3;      // 30-50% 渲染3倍
  if (zoom >= 0.15) return 4;     // 15-30% 渲染4倍
  if (zoom >= 0.08) return 4.5;   // 8-15% 渲染4.5倍
  return 5;                        // <8% 最多渲染5倍
}

/**
 * 计算网格渲染边界
 * 返回优化后的渲染范围，防止过度渲染
 */
export function calculateGridRenderBounds(
  config: GridRenderConfig,
  viewBounds: { left: number; right: number; top: number; bottom: number }
): GridRenderBounds {
  const { zoom, viewWidth, viewHeight, gridSize } = config;
  const { left, right, top, bottom } = viewBounds;

  // 基础参数
  const padding = gridSize * 2;
  const renderMultiplier = calculateRenderMultiplier(zoom);
  const effectivePadding = padding * renderMultiplier;

  // 计算初始边界
  let minX = Math.floor((left - effectivePadding) / gridSize) * gridSize;
  let maxX = Math.ceil((right + effectivePadding) / gridSize) * gridSize;
  let minY = Math.floor((top - effectivePadding) / gridSize) * gridSize;
  let maxY = Math.ceil((bottom + effectivePadding) / gridSize) * gridSize;

  // 应用绝对像素限制
  const MAX_RENDER_PIXELS = 2000 * 2000; // 400万像素
  const maxRenderWidth = Math.min(
    viewWidth * renderMultiplier,
    Math.sqrt(MAX_RENDER_PIXELS)
  );
  const maxRenderHeight = Math.min(
    viewHeight * renderMultiplier,
    Math.sqrt(MAX_RENDER_PIXELS)
  );

  // 调整边界以符合像素限制
  const currentWidth = maxX - minX;
  const currentHeight = maxY - minY;

  if (currentWidth > maxRenderWidth) {
    const excess = currentWidth - maxRenderWidth;
    maxX -= excess / 2;
    minX += excess / 2;
  }

  if (currentHeight > maxRenderHeight) {
    const excess = currentHeight - maxRenderHeight;
    maxY -= excess / 2;
    minY += excess / 2;
  }

  // 计算最终尺寸
  const renderWidth = maxX - minX;
  const renderHeight = maxY - minY;

  // 估算网格线数量
  const verticalLines = Math.ceil(renderWidth / gridSize);
  const horizontalLines = Math.ceil(renderHeight / gridSize);
  const gridLineCount = verticalLines + horizontalLines;

  // 估算对象总数（每条线一个Path对象）
  const estimatedObjectCount = gridLineCount;

  return {
    minX,
    maxX,
    minY,
    maxY,
    renderWidth,
    renderHeight,
    gridLineCount,
    estimatedObjectCount,
  };
}

/**
 * 检查渲染配置是否会导致过度渲染
 */
export function isRenderConfigSafe(bounds: GridRenderBounds): {
  safe: boolean;
  reason?: string;
  severity?: 'warning' | 'error';
} {
  const MAX_GRID_LINES = 10000;      // 最多渲染10000条网格线
  const MAX_OBJECTS = 15000;         // 最多15000个对象
  const MAX_RENDER_AREA = 4000 * 4000; // 最多1600万像素

  const renderArea = bounds.renderWidth * bounds.renderHeight;

  if (bounds.gridLineCount > MAX_GRID_LINES) {
    return {
      safe: false,
      reason: `网格线过多: ${bounds.gridLineCount} > ${MAX_GRID_LINES}`,
      severity: 'error',
    };
  }

  if (bounds.estimatedObjectCount > MAX_OBJECTS) {
    return {
      safe: false,
      reason: `对象过多: ${bounds.estimatedObjectCount} > ${MAX_OBJECTS}`,
      severity: 'error',
    };
  }

  if (renderArea > MAX_RENDER_AREA) {
    return {
      safe: false,
      reason: `渲染面积过大: ${renderArea} > ${MAX_RENDER_AREA}`,
      severity: 'warning',
    };
  }

  return { safe: true };
}

/**
 * 获取优化建议
 */
export function getOptimizationSuggestions(
  bounds: GridRenderBounds,
  zoom: number
): string[] {
  const suggestions: string[] = [];

  if (bounds.gridLineCount > 5000) {
    suggestions.push(
      `⚠️ 网格线过多 (${bounds.gridLineCount}条)。建议：`
    );
    suggestions.push(`   - 增加缩放级别到 ${Math.max(0.1, zoom * 1.5).toFixed(2)}`);
    suggestions.push(`   - 或增加网格间距`);
  }

  if (bounds.renderWidth > 3000 || bounds.renderHeight > 3000) {
    suggestions.push(
      `⚠️ 渲染范围过大 (${bounds.renderWidth.toFixed(0)}x${bounds.renderHeight.toFixed(0)})。建议：`
    );
    suggestions.push(`   - 减少缩放级别`);
    suggestions.push(`   - 或使用更大的网格间距`);
  }

  if (zoom < 0.15) {
    suggestions.push(
      `💡 缩放级别很低 (${(zoom * 100).toFixed(1)}%)。建议：`
    );
    suggestions.push(`   - 使用 Fit to Screen 功能快速调整视图`);
    suggestions.push(`   - 或使用小地图导航`);
  }

  return suggestions;
}

/**
 * 格式化渲染边界信息用于调试
 */
export function formatGridRenderBounds(bounds: GridRenderBounds): string {
  return `
GridRenderBounds:
  范围: (${bounds.minX.toFixed(0)}, ${bounds.minY.toFixed(0)}) -> (${bounds.maxX.toFixed(0)}, ${bounds.maxY.toFixed(0)})
  尺寸: ${bounds.renderWidth.toFixed(0)} x ${bounds.renderHeight.toFixed(0)} 像素
  网格线: ${bounds.gridLineCount} 条
  估算对象: ${bounds.estimatedObjectCount} 个
  `;
}

/**
 * 性能等级评估
 */
export function assessPerformanceLevel(bounds: GridRenderBounds): {
  level: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  score: number;
  description: string;
} {
  const score = Math.min(100, Math.max(0, 100 - bounds.estimatedObjectCount / 100));

  if (score >= 90) {
    return {
      level: 'excellent',
      score,
      description: '性能优秀，可以安全渲染',
    };
  }

  if (score >= 75) {
    return {
      level: 'good',
      score,
      description: '性能良好，渲染流畅',
    };
  }

  if (score >= 50) {
    return {
      level: 'fair',
      score,
      description: '性能一般，可能有轻微卡顿',
    };
  }

  if (score >= 25) {
    return {
      level: 'poor',
      score,
      description: '性能较差，建议优化缩放或网格间距',
    };
  }

  return {
    level: 'critical',
    score,
    description: '性能严重不足，可能导致崩溃',
  };
}
