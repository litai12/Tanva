/**
 * 绘图工具Hook
 * 处理自由绘制、矩形、圆形、直线等绘图工具的功能
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import {
  clearPaperEraserTrails,
  markPaperEraserTrail,
} from '@/utils/paperEraserTrail';
import type { 
  DrawingToolState,
  DrawingToolEventHandlers,
  DrawingContext 
} from '@/types/canvas';
import type { ExtendedPath } from '@/types/paper';
import type { DrawMode, LineStyle } from '@/stores/toolStore';
import { NodeManager } from '@/canvas/NodeManager';
import type { PathNode } from '@/canvas/nodes/PathNode';

interface UseDrawingToolsProps {
  context: DrawingContext;
  currentColor: string;
  fillColor: string;
  strokeWidth: number;
  lineStyle: LineStyle;
  isEraser: boolean;
  hasFill: boolean;
  eventHandlers?: DrawingToolEventHandlers;
}

const isSketchLineStyle = (style: LineStyle): boolean =>
  style === 'sketch-end-heavy' || style === 'sketch-center-heavy';

const supportsSketchMode = (mode: DrawMode): boolean =>
  mode === 'free' || mode === 'line';

const getDashArray = (style: LineStyle, width: number): number[] => {
  const normalizedWidth = Math.max(1, width);
  if (style === 'dashed') {
    return [normalizedWidth * 4, normalizedWidth * 2.8];
  }
  if (style === 'dash-dot') {
    return [normalizedWidth * 5, normalizedWidth * 2, normalizedWidth, normalizedWidth * 2];
  }
  return [];
};

const getSketchProfileFactor = (t: number, style: LineStyle): number => {
  const normalized = Math.max(0, Math.min(1, t));
  const edgeBias = Math.pow(Math.abs(2 * normalized - 1), 0.85);
  if (style === 'sketch-end-heavy') {
    return 0.7 + edgeBias * 0.95;
  }
  return 0.7 + (1 - edgeBias) * 0.95;
};

const getArrowPathPoints = (
  startPoint: paper.Point,
  endPoint: paper.Point,
  strokeWidth: number
): paper.Point[] => {
  const bodyWidth = Math.max(2, strokeWidth);
  let vector = endPoint.subtract(startPoint);
  let length = vector.length;

  if (!Number.isFinite(length) || length < 0.5) {
    vector = new paper.Point(Math.max(1, bodyWidth * 2), 0);
    length = vector.length;
  }

  const direction = vector.normalize();
  const normal = new paper.Point(-direction.y, direction.x);
  const headLength = Math.min(Math.max(14, bodyWidth * 5.8), Math.max(1, length * 0.58));
  const headHalfWidth = Math.min(
    Math.max(6, bodyWidth * 1.8),
    Math.max(bodyWidth, length * 0.4)
  );
  const bodyEndDistance = length > headLength + bodyWidth ? length - headLength : length * 0.45;
  const bodyEnd = startPoint.add(direction.multiply(Math.max(0, bodyEndDistance)));
  const tip = startPoint.add(direction.multiply(length));
  const halfBody = bodyWidth / 2;

  return [
    startPoint.add(normal.multiply(halfBody)),
    bodyEnd.add(normal.multiply(halfBody)),
    bodyEnd.add(normal.multiply(headHalfWidth)),
    tip,
    bodyEnd.subtract(normal.multiply(headHalfWidth)),
    bodyEnd.subtract(normal.multiply(halfBody)),
    startPoint.subtract(normal.multiply(halfBody)),
  ];
};

const updateArrowPathGeometry = (
  path: paper.Path,
  startPoint: paper.Point,
  endPoint: paper.Point,
  strokeWidth: number
) => {
  const points = getArrowPathPoints(startPoint, endPoint, strokeWidth);
  path.removeSegments();
  points.forEach((point) => path.add(point));
  path.closed = true;
};

export const useDrawingTools = ({ 
  context, 
  currentColor, 
  fillColor,
  strokeWidth, 
  lineStyle,
  isEraser,
  hasFill,
  eventHandlers = {} 
}: UseDrawingToolsProps) => {
  const { ensureDrawingLayer } = context;

  const applyLineStyleToPath = useCallback((path: paper.Path, mode: DrawMode) => {
    if (!path || isEraser) return;

    path.strokeCap = 'round';
    path.strokeJoin = 'round';
    path.data = {
      ...(path.data || {}),
      lineStyle,
    };

    if (isSketchLineStyle(lineStyle) && supportsSketchMode(mode)) {
      path.dashArray = [];
      path.dashOffset = 0;
      return;
    }

    const dashArray = getDashArray(lineStyle, strokeWidth);
    path.dashArray = dashArray;
    path.dashOffset = 0;
  }, [lineStyle, strokeWidth, isEraser]);

  const convertToSketchPath = useCallback((sourcePath: paper.Path, mode: DrawMode): paper.Path => {
    if (!isSketchLineStyle(lineStyle) || !supportsSketchMode(mode)) {
      return sourcePath;
    }

    const totalLength = sourcePath.length;
    if (!Number.isFinite(totalLength) || totalLength <= 0.5) {
      return sourcePath;
    }

    const segmentCount = Math.max(
      18,
      Math.min(140, Math.ceil(totalLength / Math.max(1.2, strokeWidth * 0.55)))
    );
    const leftPoints: paper.Point[] = [];
    const rightPoints: paper.Point[] = [];
    const seed = ((sourcePath.firstSegment?.point.x || 0) * 0.037 + (sourcePath.firstSegment?.point.y || 0) * 0.061) % 1;

    for (let i = 0; i < segmentCount; i += 1) {
      const t = segmentCount <= 1 ? 0 : i / (segmentCount - 1);
      const offset = Math.max(0, Math.min(totalLength, totalLength * t));
      const point = sourcePath.getPointAt(offset) || sourcePath.lastSegment?.point || sourcePath.firstSegment?.point;
      if (!point) continue;

      const normalAtOffset =
        sourcePath.getNormalAt(Math.min(totalLength - 0.0001, Math.max(0.0001, offset))) ||
        sourcePath.getNormalAt(offset) ||
        new paper.Point(0, -1);
      const normal = normalAtOffset.normalize();
      const widthBase = Math.max(1, strokeWidth) * getSketchProfileFactor(t, lineStyle);
      const widthWobble =
        Math.sin((t * 5.8 + seed) * Math.PI * 2) * Math.min(0.7, strokeWidth * 0.1);
      const width = Math.max(0.8, widthBase + widthWobble);
      const centerWobble =
        Math.sin((t * 3.6 + seed * 1.7) * Math.PI * 2) * Math.min(0.5, strokeWidth * 0.08);
      const centerPoint = point.add(normal.multiply(centerWobble));

      leftPoints.push(centerPoint.add(normal.multiply(width / 2)));
      rightPoints.push(centerPoint.subtract(normal.multiply(width / 2)));
    }

    if (leftPoints.length < 2 || rightPoints.length < 2) {
      return sourcePath;
    }

    const sourceParent = sourcePath.parent;
    const sourceIndex = sourcePath.index;
    sourcePath.remove();

    const sketchPath = new paper.Path();
    leftPoints.forEach((pt) => sketchPath.add(pt));
    rightPoints.reverse().forEach((pt) => sketchPath.add(pt));
    sketchPath.closed = true;
    sketchPath.fillColor = new paper.Color(currentColor);
    sketchPath.strokeColor = null;
    sketchPath.strokeWidth = 0;
    sketchPath.smooth({ type: 'catmull-rom', factor: 0.58 });
    sketchPath.data = {
      ...(sourcePath.data || {}),
      lineStyle,
      isSketchStylePath: true,
      sourceStrokeWidth: strokeWidth,
    };

    if (sourceParent) {
      sourceParent.insertChild(sourceIndex, sketchPath);
    }

    return sketchPath;
  }, [currentColor, lineStyle, strokeWidth]);

  const applyArrowStyleToPath = useCallback((path: paper.Path, startPoint: paper.Point, endPoint: paper.Point) => {
    path.fillColor = new paper.Color(currentColor);
    path.strokeColor = null;
    path.strokeWidth = 0.01;
    path.strokeCap = 'round';
    path.strokeJoin = 'round';
    path.dashArray = [];
    path.dashOffset = 0;
    path.data = {
      ...(path.data || {}),
      type: 'drawing',
      tool: 'arrow',
      lineStyle,
      sourceStrokeWidth: strokeWidth,
      arrowStart: { x: startPoint.x, y: startPoint.y },
      arrowEnd: { x: endPoint.x, y: endPoint.y },
    };
  }, [currentColor, lineStyle, strokeWidth]);

  // 判断当前工具是否支持填充
  const supportsFill = (mode: DrawMode): boolean => {
    return ['rect', 'circle'].includes(mode);
  };

  // 处理填充颜色，基于hasFill状态和工具类型
  const getFillColor = (mode: DrawMode): paper.Color | null => {
    // 如果工具不支持填充，或用户明确关闭了填充，返回null
    if (!supportsFill(mode) || !hasFill) {
      return null;
    }
    
    return new paper.Color(fillColor);
  };

  // 绘图工具状态
  const pathRef = useRef<ExtendedPath | null>(null);
  const drawingNodeRef = useRef<PathNode | null>(null);
  const isDrawingRef = useRef(false);
  const hasMovedRef = useRef(false); // 立即跟踪移动状态，避免异步问题
  const initialClickPointRef = useRef<paper.Point | null>(null);
  const [drawingState, setDrawingState] = useState<DrawingToolState>({
    currentPath: null,
    isDrawing: false,
    initialClickPoint: null,
    hasMoved: false,
    dragThreshold: 3
  });

  useEffect(() => {
    clearPaperEraserTrails();
  }, []);

  // ========== 自由绘制功能 ==========
  
  // 开始自由绘制
  const startFreeDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，而是等待用户开始移动
    hasMovedRef.current = false; // 重置移动状态
    initialClickPointRef.current = point;
    setDrawingState(prev => ({
      ...prev,
      initialClickPoint: point,
      hasMoved: false
    }));
    eventHandlers.onDrawStart?.('free');
  }, [eventHandlers.onDrawStart]);

  // 实际创建自由绘制路径（当确认用户在拖拽时）
  const createFreeDrawPath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    const drawId = `path_free_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const activeLayer = paper.project.activeLayer as paper.Layer;
    drawingNodeRef.current = NodeManager.getInstance().createPath(drawId, activeLayer, {
      strokeColor: currentColor,
      strokeWidth: strokeWidth,
      fillColor: null,
      data: { type: 'path', pathId: drawId },
    });
    pathRef.current = drawingNodeRef.current.getPaperItem() as unknown as ExtendedPath;

    if (isEraser) {
      // 橡皮擦模式：红色虚线表示擦除轨迹
      pathRef.current.strokeColor = new paper.Color('#ff6b6b');
      pathRef.current.strokeWidth = strokeWidth * 1.5; // 稍微粗一点
      pathRef.current.dashArray = [5, 5]; // 虚线效果
      pathRef.current.opacity = 0.7;
      markPaperEraserTrail(pathRef.current as unknown as paper.Path);
    } else {
      // 普通绘制模式
      pathRef.current.strokeColor = new paper.Color(currentColor);
      pathRef.current.strokeWidth = strokeWidth;
      applyLineStyleToPath(pathRef.current as unknown as paper.Path, 'free');
    }

    pathRef.current.strokeCap = 'round';
    pathRef.current.strokeJoin = 'round';
    pathRef.current.add(startPoint);

    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true
    }));
    isDrawingRef.current = true;
    
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, currentColor, strokeWidth, isEraser, applyLineStyleToPath, eventHandlers.onPathCreate]);

  // 继续自由绘制
  const continueFreeDraw = useCallback((point: paper.Point) => {
    const initialClickPoint = initialClickPointRef.current || drawingState.initialClickPoint;
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && initialClickPoint && !hasMovedRef.current) {
      const distance = initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        createFreeDrawPath(initialClickPoint);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

    if (pathRef.current) {
      // 优化：只有当新点与最后一个点距离足够远时才添加
      const lastSegment = pathRef.current.lastSegment;
      if (lastSegment) {
        const distance = lastSegment.point.getDistance(point);
        // 距离阈值：避免添加过于接近的点
        const minDistance = Math.max(1, strokeWidth * 0.5);
        if (distance < minDistance) {
          return; // 跳过过于接近的点
        }
      }

      pathRef.current.add(point);

      // Force canvas repaint so the new segment is visible immediately.
      // Paper.js only auto-redraws when object properties (e.g. .bounds) change;
      // manually adding points via .add() does not trigger it on its own.
      try { paper.view?.update(); } catch (_) {}

      // 触发 Paper.js 的 change 事件以更新图层面板
      if (paper.project && (paper.project as any).emit) {
        (paper.project as any).emit('change');
      }
    }
  }, [strokeWidth, createFreeDrawPath, drawingState.initialClickPoint, drawingState.dragThreshold]);

  // ========== 矩形绘制功能 ==========

  // 开始绘制矩形
  const startRectDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，等待用户开始移动
    hasMovedRef.current = false; // 重置移动状态
    initialClickPointRef.current = point;
    setDrawingState(prev => ({
      ...prev,
      initialClickPoint: point,
      hasMoved: false
    }));
    eventHandlers.onDrawStart?.('rect');
  }, [eventHandlers.onDrawStart]);

  // 实际创建矩形图元（当确认用户在拖拽时）
  const createRectPath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    // 创建一个最小的矩形，使用 Rectangle 构造函数
    const rectangle = new paper.Rectangle(startPoint, startPoint.add(new paper.Point(1, 1)));
    pathRef.current = new paper.Path.Rectangle(rectangle);
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;
    applyLineStyleToPath(pathRef.current as unknown as paper.Path, 'rect');
    pathRef.current.fillColor = getFillColor('rect');

    // 保存起始点用于后续更新
    if (pathRef.current) pathRef.current.startPoint = startPoint;

    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true
    }));
    isDrawingRef.current = true;
    
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, currentColor, strokeWidth, applyLineStyleToPath, eventHandlers.onPathCreate]);

  // 更新矩形绘制
  const updateRectDraw = useCallback((point: paper.Point) => {
    const initialClickPoint = initialClickPointRef.current || drawingState.initialClickPoint;
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && initialClickPoint && !hasMovedRef.current) {
      const distance = initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        createRectPath(initialClickPoint);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      const rectangle = new paper.Rectangle(startPoint, point);

      // 优化：更新现有矩形而不是重新创建
      if (pathRef.current instanceof paper.Path.Rectangle) {
        // 直接更新矩形的边界
        pathRef.current.bounds = rectangle;
      } else {
        // 如果类型不匹配，才重新创建
        pathRef.current.remove();
        pathRef.current = new paper.Path.Rectangle(rectangle);
      }
      pathRef.current.strokeColor = new paper.Color(currentColor);
      pathRef.current.strokeWidth = strokeWidth;
      applyLineStyleToPath(pathRef.current as unknown as paper.Path, 'rect');
      pathRef.current.fillColor = getFillColor('rect');

      // 保持起始点引用
      if (pathRef.current) (pathRef.current as any).startPoint = startPoint;
    }
  }, [currentColor, strokeWidth, applyLineStyleToPath, createRectPath, drawingState.initialClickPoint, drawingState.dragThreshold]);

  // ========== 圆形绘制功能 ==========

  // 开始绘制圆形
  const startCircleDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，等待用户开始移动
    hasMovedRef.current = false; // 重置移动状态
    initialClickPointRef.current = point;
    setDrawingState(prev => ({
      ...prev,
      initialClickPoint: point,
      hasMoved: false
    }));
    eventHandlers.onDrawStart?.('circle');
  }, [eventHandlers.onDrawStart]);

  // 实际创建圆形图元（当确认用户在拖拽时）
  const createCirclePath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    pathRef.current = new paper.Path.Circle({
      center: startPoint,
      radius: 1,
    });
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;
    applyLineStyleToPath(pathRef.current as unknown as paper.Path, 'circle');
    pathRef.current.fillColor = getFillColor('circle');

    // 保存起始点和圆形标识用于后续更新
    if (pathRef.current) {
      (pathRef.current as any).startPoint = startPoint;
      (pathRef.current as any).isCirclePath = true; // 标记为圆形路径
      logger.debug('🔴 创建圆形路径:', {
        center: startPoint,
        radius: 1,
        className: pathRef.current.className
      });
    }

    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true
    }));
    isDrawingRef.current = true;
    
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, currentColor, strokeWidth, applyLineStyleToPath, eventHandlers.onPathCreate]);

  // 更新圆形绘制
  const updateCircleDraw = useCallback((point: paper.Point) => {
    const initialClickPoint = initialClickPointRef.current || drawingState.initialClickPoint;
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && initialClickPoint && !hasMovedRef.current) {
      const distance = initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        createCirclePath(initialClickPoint);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      const radius = startPoint.getDistance(point);

      // 修复：使用正确的方式更新圆形以避免形变
      if (pathRef.current instanceof paper.Path.Circle) {
        // 直接更新圆形的半径属性，保持正确的圆形
        (pathRef.current as any).radius = radius;
        pathRef.current.position = startPoint;
      } else {
        // 如果类型不匹配，才重新创建
        pathRef.current.remove();
        pathRef.current = new paper.Path.Circle({
          center: startPoint,
          radius: radius,
        });
      }
      pathRef.current.strokeColor = new paper.Color(currentColor);
      pathRef.current.strokeWidth = strokeWidth;
      applyLineStyleToPath(pathRef.current as unknown as paper.Path, 'circle');
      pathRef.current.fillColor = getFillColor('circle');

      // 保持起始点引用
      if (pathRef.current) (pathRef.current as any).startPoint = startPoint;
    }
  }, [currentColor, strokeWidth, applyLineStyleToPath, createCirclePath, drawingState.initialClickPoint, drawingState.dragThreshold]);

  // ========== 图片占位框绘制功能 ==========

  // 开始绘制图片占位框
  const startImageDraw = useCallback((point: paper.Point) => {
    hasMovedRef.current = false; // 重置移动状态
    initialClickPointRef.current = point;
    setDrawingState(prev => ({
      ...prev,
      initialClickPoint: point,
      hasMoved: false
    }));
    eventHandlers.onDrawStart?.('image');
  }, [eventHandlers.onDrawStart]);

  // 实际创建图片占位框路径（当确认用户在拖拽时）
  const createImagePath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    const rect = new paper.Rectangle(startPoint, startPoint.add(new paper.Point(1, 1)));
    pathRef.current = new paper.Path.Rectangle(rect);
    pathRef.current.strokeColor = new paper.Color('#999');
    pathRef.current.strokeWidth = 1;
    pathRef.current.dashArray = [5, 5];
    pathRef.current.fillColor = null;

    // 保存起始点用于后续更新
    if (pathRef.current) pathRef.current.startPoint = startPoint;

    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true
    }));
    isDrawingRef.current = true;
    
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, eventHandlers.onPathCreate]);

  // 更新图片占位框绘制
  const updateImageDraw = useCallback((point: paper.Point) => {
    const initialClickPoint = initialClickPointRef.current || drawingState.initialClickPoint;
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && initialClickPoint && !hasMovedRef.current) {
      const distance = initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        createImagePath(initialClickPoint);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      const rectangle = new paper.Rectangle(startPoint, point);

      // 移除旧的矩形并创建新的
      pathRef.current.remove();
      pathRef.current = new paper.Path.Rectangle(rectangle);
      pathRef.current.strokeColor = new paper.Color('#999');
      pathRef.current.strokeWidth = 1;
      pathRef.current.dashArray = [5, 5];
      pathRef.current.fillColor = null;

      // 保持起始点引用
      if (pathRef.current) (pathRef.current as any).startPoint = startPoint;
    }
  }, [createImagePath, drawingState.initialClickPoint, drawingState.dragThreshold]);

  // ========== 3D模型占位框绘制功能 ==========

  // 开始绘制3D模型占位框
  const start3DModelDraw = useCallback((point: paper.Point) => {
    hasMovedRef.current = false; // 重置移动状态
    initialClickPointRef.current = point;
    setDrawingState(prev => ({
      ...prev,
      initialClickPoint: point,
      hasMoved: false
    }));
    eventHandlers.onDrawStart?.('3d-model');
  }, [eventHandlers.onDrawStart]);

  // 实际创建3D模型占位框路径（当确认用户在拖拽时）
  const create3DModelPath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    const rect = new paper.Rectangle(startPoint, startPoint.add(new paper.Point(1, 1)));
    pathRef.current = new paper.Path.Rectangle(rect);
    pathRef.current.strokeColor = new paper.Color('#8b5cf6');
    pathRef.current.strokeWidth = 1;
    pathRef.current.dashArray = [8, 4];
    pathRef.current.fillColor = null;

    // 保存起始点用于后续更新
    if (pathRef.current) pathRef.current.startPoint = startPoint;

    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true
    }));
    isDrawingRef.current = true;
    
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, eventHandlers.onPathCreate]);

  // 更新3D模型占位框绘制
  const update3DModelDraw = useCallback((point: paper.Point) => {
    const initialClickPoint = initialClickPointRef.current || drawingState.initialClickPoint;
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && initialClickPoint && !hasMovedRef.current) {
      const distance = initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        create3DModelPath(initialClickPoint);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      const rectangle = new paper.Rectangle(startPoint, point);

      // 移除旧的矩形并创建新的
      pathRef.current.remove();
      pathRef.current = new paper.Path.Rectangle(rectangle);
      pathRef.current.strokeColor = new paper.Color('#8b5cf6');
      pathRef.current.strokeWidth = 1;
      pathRef.current.dashArray = [8, 4];
      pathRef.current.fillColor = null;

      // 保持起始点引用
      if (pathRef.current) (pathRef.current as any).startPoint = startPoint;
    }
  }, [create3DModelPath, drawingState.initialClickPoint, drawingState.dragThreshold]);

  // ========== 直线绘制功能 ==========

  // 创建直线路径（延迟创建）
  const createLinePath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer(); // 确保在正确的图层中绘制
    pathRef.current = new paper.Path.Line({
      from: startPoint,
      to: startPoint.add(new paper.Point(1, 0)), // 初始创建一个极短的线段
    });
    pathRef.current.strokeColor = new paper.Color(currentColor);
    pathRef.current.strokeWidth = strokeWidth;
    applyLineStyleToPath(pathRef.current as unknown as paper.Path, 'line');
    pathRef.current.data = {
      ...(pathRef.current.data || {}),
      type: 'drawing',
      tool: 'line',
    };

    // 保存起始点用于后续更新
    if (pathRef.current) (pathRef.current as any).startPoint = startPoint;

    // 更新移动状态
    hasMovedRef.current = true;
    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true,
      hasMoved: true
    }));
    isDrawingRef.current = true;
    
    logger.debug('创建直线路径');
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, currentColor, strokeWidth, applyLineStyleToPath, eventHandlers.onPathCreate]);

  // 开始绘制直线（仅记录起始位置）
  const startLineDraw = useCallback((point: paper.Point) => {
    // 记录起始位置，等待拖拽阈值触发或第二次点击
    hasMovedRef.current = false; // 重置移动状态
    initialClickPointRef.current = point;
    setDrawingState(prev => ({
      ...prev,
      initialClickPoint: point,
      hasMoved: false
    }));
    logger.debug('直线工具激活，等待拖拽');
    eventHandlers.onDrawStart?.('line');
  }, [eventHandlers.onDrawStart]);

  // 更新直线绘制（鼠标移动时跟随）
  const updateLineDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;

      // 更新直线的终点
      pathRef.current.segments[1].point = point;

      // 保持起始点引用和样式
      if (pathRef.current) (pathRef.current as any).startPoint = startPoint;
    }
  }, []);

  // 完成直线绘制（第二次点击）
  const finishLineDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && (pathRef.current as any).startPoint) {
      // 设置最终的终点
      pathRef.current.segments[1].point = point;

      // 清理临时引用
      if (pathRef.current) delete (pathRef.current as any).startPoint;

      logger.drawing('完成直线绘制');
      const completedPath = convertToSketchPath(pathRef.current as paper.Path, 'line');
      pathRef.current = null;
      initialClickPointRef.current = null;
      isDrawingRef.current = false;
      
      setDrawingState(prev => ({
        ...prev,
        currentPath: null,
        isDrawing: false,
        initialClickPoint: null,
        hasMoved: false
      }));

      // 触发 Paper.js 的 change 事件
      if (paper.project && (paper.project as any).emit) {
        (paper.project as any).emit('change');
      }

      eventHandlers.onPathComplete?.(completedPath as any);
      eventHandlers.onDrawEnd?.('line');
    }
  }, [convertToSketchPath, eventHandlers.onPathComplete, eventHandlers.onDrawEnd]);

  // ========== 箭头绘制功能 ==========

  const startArrowDraw = useCallback((point: paper.Point) => {
    hasMovedRef.current = false;
    initialClickPointRef.current = point;
    setDrawingState(prev => ({
      ...prev,
      initialClickPoint: point,
      hasMoved: false
    }));
    logger.debug('箭头工具激活，等待拖拽');
    eventHandlers.onDrawStart?.('arrow');
  }, [eventHandlers.onDrawStart]);

  const createArrowPath = useCallback((startPoint: paper.Point) => {
    ensureDrawingLayer();
    const initialEndPoint = startPoint.add(new paper.Point(1, 0));
    pathRef.current = new paper.Path();
    updateArrowPathGeometry(pathRef.current as unknown as paper.Path, startPoint, initialEndPoint, strokeWidth);
    applyArrowStyleToPath(pathRef.current as unknown as paper.Path, startPoint, initialEndPoint);

    if (pathRef.current) (pathRef.current as any).startPoint = startPoint;

    hasMovedRef.current = true;
    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true,
      hasMoved: true
    }));
    isDrawingRef.current = true;

    logger.debug('创建箭头路径');
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, strokeWidth, applyArrowStyleToPath, eventHandlers.onPathCreate]);

  const updateArrowDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      updateArrowPathGeometry(pathRef.current as unknown as paper.Path, startPoint, point, strokeWidth);
      applyArrowStyleToPath(pathRef.current as unknown as paper.Path, startPoint, point);
      if (pathRef.current) (pathRef.current as any).startPoint = startPoint;
    }
  }, [strokeWidth, applyArrowStyleToPath]);

  const finishArrowDraw = useCallback((point: paper.Point) => {
    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      updateArrowPathGeometry(pathRef.current as unknown as paper.Path, startPoint, point, strokeWidth);
      applyArrowStyleToPath(pathRef.current as unknown as paper.Path, startPoint, point);

      if (pathRef.current) delete (pathRef.current as any).startPoint;

      logger.drawing('完成箭头绘制');
      const completedPath = pathRef.current;
      pathRef.current = null;
      initialClickPointRef.current = null;
      isDrawingRef.current = false;

      setDrawingState(prev => ({
        ...prev,
        currentPath: null,
        isDrawing: false,
        initialClickPoint: null,
        hasMoved: false
      }));

      if (paper.project && (paper.project as any).emit) {
        (paper.project as any).emit('change');
      }

      eventHandlers.onPathComplete?.(completedPath);
      eventHandlers.onDrawEnd?.('arrow');
    }
  }, [strokeWidth, applyArrowStyleToPath, eventHandlers.onPathComplete, eventHandlers.onDrawEnd]);

  // ========== 通用绘制结束 ==========
  
  const finishDraw = useCallback((drawMode: DrawMode, performErase?: (path: paper.Path) => void, createImagePlaceholder?: (start: paper.Point, end: paper.Point) => void, create3DModelPlaceholder?: (start: paper.Point, end: paper.Point) => void, setDrawMode?: (mode: DrawMode) => void) => {
    const initialClickPoint = initialClickPointRef.current || drawingState.initialClickPoint;
    logger.debug(`finishDraw被调用: drawMode=${drawMode}, pathRef=${!!pathRef.current}, initialClickPoint=${!!initialClickPoint}, hasMoved=${hasMovedRef.current}`);
    
    // 处理画线类工具的特殊情况：如果用户只是点击而没有拖拽，切换到选择模式
    if ((drawMode === 'free' || drawMode === 'rect' || drawMode === 'circle') && !pathRef.current && initialClickPoint && !hasMovedRef.current) {
      logger.debug(
        isEraser
          ? 'finishDraw: 橡皮擦点击未拖拽，仅清理点击状态'
          : 'finishDraw: 检测到只点击未拖拽，切换到选择模式'
      );
      // 用户只是点击了但没有拖拽，清理状态并切换模式
      hasMovedRef.current = false;
      initialClickPointRef.current = null;
      setDrawingState(prev => ({
        ...prev,
        initialClickPoint: null,
        hasMoved: false,
        isDrawing: false
      }));
      isDrawingRef.current = false;
      if (isEraser) {
        clearPaperEraserTrails();
      }
      
      // 单击不拖拽时不生成橡皮轨迹；橡皮工具回到选择模式。
      if (setDrawMode) {
        setDrawMode('select');
      }
      
      eventHandlers.onDrawEnd?.(drawMode);
      return;
    }

    if (pathRef.current) {
      // 如果是橡皮擦模式，执行擦除操作然后删除橡皮擦路径
      if (isEraser) {
        const eraserPath = pathRef.current as unknown as paper.Path;
        try {
          performErase?.(eraserPath);
        } finally {
          eraserPath.data = {
            ...(eraserPath.data || {}),
            isActiveEraserTrail: false,
          };
          try {
            eraserPath.remove(); // 删除橡皮擦路径本身
          } catch {
            // Ignore Paper cleanup errors for a transient eraser path.
          }
          pathRef.current = null;
          initialClickPointRef.current = null;
          if (drawingNodeRef.current) {
            drawingNodeRef.current = null;
          }
          clearPaperEraserTrails();
        }
      } else if (drawMode === 'image' && createImagePlaceholder && setDrawMode) {
        // 图片模式：创建占位框
        const startPoint = pathRef.current?.startPoint;
        if (startPoint) {
          const endPoint = new paper.Point(
            pathRef.current.bounds.x + pathRef.current.bounds.width,
            pathRef.current.bounds.y + pathRef.current.bounds.height
          );

          // 删除临时绘制的矩形
          pathRef.current.remove();

          // 创建图片占位框
          createImagePlaceholder(startPoint, endPoint);

          // 自动切换到选择模式
          setDrawMode('select');
        }
      } else if (drawMode === '3d-model' && create3DModelPlaceholder && setDrawMode) {
        // 3D模型模式：创建占位框
        const startPoint = pathRef.current?.startPoint;
        if (startPoint) {
          const endPoint = new paper.Point(
            pathRef.current.bounds.x + pathRef.current.bounds.width,
            pathRef.current.bounds.y + pathRef.current.bounds.height
          );

          // 删除临时绘制的矩形
          pathRef.current.remove();

          // 创建3D模型占位框
          create3DModelPlaceholder(startPoint, endPoint);

          // 自动切换到选择模式
          setDrawMode('select');
        }
      }

      // 清理路径引用和临时数据
      if (pathRef.current) {
        let completedPath = pathRef.current as paper.Path;
        delete pathRef.current.startPoint;
        if (!isEraser && drawMode !== 'image' && drawMode !== '3d-model') {
          completedPath = convertToSketchPath(completedPath, drawMode);
        }
        pathRef.current = null;
        initialClickPointRef.current = null;

        if (drawMode === 'free' && drawingNodeRef.current) {
          // 绘制完成：仅解除管理器登记，保留画布上的线条。
          // 误用 destroy() 会触发 PathNode.destroy → path.remove()，导致线条松手即消失。
          try { NodeManager.getInstance().release(drawingNodeRef.current.id); } catch {}
          drawingNodeRef.current = null;
        }

        if (!isEraser && drawMode !== 'image' && drawMode !== '3d-model') {
          eventHandlers.onPathComplete?.(completedPath as any);
        }
      }

      // 触发 Paper.js 的 change 事件
      if (paper.project && (paper.project as any).emit) {
        (paper.project as any).emit('change');
      }
    }

    if (isEraser) {
      clearPaperEraserTrails();
    }

    // 重置绘图状态
    setDrawingState(prev => ({
      ...prev,
      currentPath: null,
      isDrawing: false,
      initialClickPoint: null,
      hasMoved: false
    }));
    initialClickPointRef.current = null;
    isDrawingRef.current = false;
    
    eventHandlers.onDrawEnd?.(drawMode);
    logger.debug(`结束${drawMode}绘制`);
  }, [isEraser, drawingState.initialClickPoint, convertToSketchPath, eventHandlers.onPathComplete, eventHandlers.onDrawEnd]);

  const resetEraserToolState = useCallback(() => {
    const currentPath = pathRef.current as unknown as paper.Path | null;
    if (currentPath) {
      try {
        currentPath.data = {
          ...(currentPath.data || {}),
          isActiveEraserTrail: false,
        };
        currentPath.remove();
      } catch {
        // Ignore cleanup errors for transient eraser paths.
      }
    }

    pathRef.current = null;
    if (drawingNodeRef.current) {
      drawingNodeRef.current = null;
    }
    hasMovedRef.current = false;
    initialClickPointRef.current = null;
    isDrawingRef.current = false;
    setDrawingState(prev => ({
      ...prev,
      currentPath: null,
      isDrawing: false,
      initialClickPoint: null,
      hasMoved: false
    }));
    clearPaperEraserTrails();
    try {
      paper.view?.update();
    } catch {
      // Ignore view update failures during teardown.
    }
  }, []);

  return {
    // 状态
    drawingState,
    pathRef,
    isDrawingRef,
    
    // 快捷访问常用状态
    initialClickPoint: initialClickPointRef.current || drawingState.initialClickPoint,
    hasMoved: hasMovedRef.current, // 使用ref值保证同步
    currentPath: drawingState.currentPath,
    isDrawing: drawingState.isDrawing,

    // 自由绘制
    startFreeDraw,
    continueFreeDraw,
    createFreeDrawPath,

    // 矩形绘制
    startRectDraw,
    updateRectDraw,
    createRectPath,

    // 圆形绘制
    startCircleDraw,
    updateCircleDraw,
    createCirclePath,

    // 直线绘制
    startLineDraw,
    updateLineDraw,
    finishLineDraw,
    createLinePath,

    // 箭头绘制
    startArrowDraw,
    updateArrowDraw,
    finishArrowDraw,
    createArrowPath,
    clearTemporaryEraserPaths: clearPaperEraserTrails,
    resetEraserToolState,

    // 图片占位框绘制
    startImageDraw,
    updateImageDraw,
    createImagePath,

    // 3D模型占位框绘制
    start3DModelDraw,
    update3DModelDraw,
    create3DModelPath,

    // 通用
    finishDraw,

    // 状态设置器（用于外部直接控制）
    setDrawingState,
  };
};
