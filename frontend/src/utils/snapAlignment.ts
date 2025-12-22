/**
 * 自动对齐系统 - 核心算法
 * 用于检测拖拽对象与其他对象的对齐关系，实现智能吸附功能
 */

import type { ImageInstance, Model3DInstance } from '@/types/canvas';

// 对齐边缘类型
export type AlignmentEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';

// 对象边界
export interface ObjectBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 对齐线数据
export interface AlignmentLine {
  type: AlignmentEdge;
  position: number; // 对齐线坐标
  sourceId: string; // 被拖拽对象 ID
  targetId: string; // 参考对象 ID
  orientation: 'horizontal' | 'vertical';
  start: number; // 线段起点
  end: number; // 线段终点
}

// 对齐检测结果
export interface SnapResult {
  alignments: AlignmentLine[];
  snapDelta: { x: number; y: number };
}

// 边缘数据
interface EdgeData {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

/**
 * 计算对象的 6 条边缘
 */
function calculateEdges(bounds: ObjectBounds): EdgeData {
  return {
    left: bounds.x,
    right: bounds.x + bounds.width,
    top: bounds.y,
    bottom: bounds.y + bounds.height,
    centerX: bounds.x + bounds.width / 2,
    centerY: bounds.y + bounds.height / 2,
  };
}

/**
 * 检测拖拽对象与其他对象的对齐关系
 * @param draggingBounds 被拖拽对象的边界
 * @param otherObjects 其他对象的边界列表
 * @param threshold 吸附阈值（像素）
 * @returns 对齐检测结果
 */
export function detectAlignments(
  draggingBounds: ObjectBounds,
  otherObjects: ObjectBounds[],
  threshold: number = 8
): SnapResult {
  const alignments: AlignmentLine[] = [];
  let snapX = 0;
  let snapY = 0;
  let foundX = false;
  let foundY = false;

  const sourceEdges = calculateEdges(draggingBounds);

  // 垂直对齐检测配对（X 轴方向）
  const verticalPairs: [AlignmentEdge, AlignmentEdge][] = [
    ['left', 'left'],
    ['left', 'right'],
    ['right', 'left'],
    ['right', 'right'],
    ['centerX', 'centerX'],
  ];

  // 水平对齐检测配对（Y 轴方向）
  const horizontalPairs: [AlignmentEdge, AlignmentEdge][] = [
    ['top', 'top'],
    ['top', 'bottom'],
    ['bottom', 'top'],
    ['bottom', 'bottom'],
    ['centerY', 'centerY'],
  ];

  for (const target of otherObjects) {
    if (target.id === draggingBounds.id) continue;

    const targetEdges = calculateEdges(target);

    // 垂直对齐检测
    for (const [srcEdge, tgtEdge] of verticalPairs) {
      const diff = targetEdges[tgtEdge] - sourceEdges[srcEdge];
      if (Math.abs(diff) <= threshold) {
        alignments.push({
          type: srcEdge,
          position: targetEdges[tgtEdge],
          sourceId: draggingBounds.id,
          targetId: target.id,
          orientation: 'vertical',
          start: Math.min(sourceEdges.top, targetEdges.top),
          end: Math.max(sourceEdges.bottom, targetEdges.bottom),
        });
        // 只取第一个匹配的吸附值
        if (!foundX) {
          snapX = diff;
          foundX = true;
        }
      }
    }

    // 水平对齐检测
    for (const [srcEdge, tgtEdge] of horizontalPairs) {
      const diff = targetEdges[tgtEdge] - sourceEdges[srcEdge];
      if (Math.abs(diff) <= threshold) {
        alignments.push({
          type: srcEdge,
          position: targetEdges[tgtEdge],
          sourceId: draggingBounds.id,
          targetId: target.id,
          orientation: 'horizontal',
          start: Math.min(sourceEdges.left, targetEdges.left),
          end: Math.max(sourceEdges.right, targetEdges.right),
        });
        // 只取第一个匹配的吸附值
        if (!foundY) {
          snapY = diff;
          foundY = true;
        }
      }
    }
  }

  return {
    alignments,
    snapDelta: { x: snapX, y: snapY },
  };
}

/**
 * 去重对齐线 - 合并相同位置的对齐线
 * @param alignments 对齐线列表
 * @returns 去重后的对齐线列表
 */
export function deduplicateAlignments(alignments: AlignmentLine[]): AlignmentLine[] {
  const seen = new Map<string, AlignmentLine>();

  for (const line of alignments) {
    // 使用方向和位置作为唯一键
    const key = `${line.orientation}-${Math.round(line.position)}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, { ...line });
    } else {
      // 合并线段范围
      existing.start = Math.min(existing.start, line.start);
      existing.end = Math.max(existing.end, line.end);
    }
  }

  return Array.from(seen.values());
}

/**
 * 将 ImageInstance 数组转换为 ObjectBounds 数组
 * @param images 图片实例列表
 * @returns 对象边界列表
 */
export function imagesToBounds(images: ImageInstance[]): ObjectBounds[] {
  return images
    .filter((img) => img.visible !== false)
    .map((img) => ({
      id: img.id,
      x: img.bounds.x,
      y: img.bounds.y,
      width: img.bounds.width,
      height: img.bounds.height,
    }));
}

/**
 * 将 Model3DInstance 数组转换为 ObjectBounds 数组
 * @param models 3D模型实例列表
 * @returns 对象边界列表
 */
export function modelsToBounds(models: Model3DInstance[]): ObjectBounds[] {
  return models
    .filter((model) => model.visible !== false)
    .map((model) => ({
      id: model.id,
      x: model.bounds.x,
      y: model.bounds.y,
      width: model.bounds.width,
      height: model.bounds.height,
    }));
}

/**
 * 合并多个对象边界列表
 * @param boundsList 多个对象边界列表
 * @returns 合并后的对象边界列表
 */
export function mergeBounds(...boundsList: ObjectBounds[][]): ObjectBounds[] {
  return boundsList.flat();
}
