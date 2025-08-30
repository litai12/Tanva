/**
 * 绘图工具Hook
 * 处理自由绘制、矩形、圆形、直线等绘图工具的功能
 */

import { useCallback, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import type { 
  DrawingToolState,
  DrawingToolEventHandlers,
  DrawingContext 
} from '@/types/canvas';
import type { ExtendedPath } from '@/types/paper';
import type { DrawMode } from '@/stores/toolStore';

interface UseDrawingToolsProps {
  context: DrawingContext;
  currentColor: string;
  strokeWidth: number;
  isEraser: boolean;
  eventHandlers?: DrawingToolEventHandlers;
}

export const useDrawingTools = ({ 
  context, 
  currentColor, 
  strokeWidth, 
  isEraser,
  eventHandlers = {} 
}: UseDrawingToolsProps) => {
  const { ensureDrawingLayer } = context;

  // 绘图工具状态
  const pathRef = useRef<ExtendedPath | null>(null);
  const isDrawingRef = useRef(false);
  const hasMovedRef = useRef(false); // 立即跟踪移动状态，避免异步问题
  const [drawingState, setDrawingState] = useState<DrawingToolState>({
    currentPath: null,
    isDrawing: false,
    initialClickPoint: null,
    hasMoved: false,
    dragThreshold: 3
  });

  // ========== 自由绘制功能 ==========
  
  // 开始自由绘制
  const startFreeDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，而是等待用户开始移动
    hasMovedRef.current = false; // 重置移动状态
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
    pathRef.current = new paper.Path();

    if (isEraser) {
      // 橡皮擦模式：红色虚线表示擦除轨迹
      pathRef.current.strokeColor = new paper.Color('#ff6b6b');
      pathRef.current.strokeWidth = strokeWidth * 1.5; // 稍微粗一点
      pathRef.current.dashArray = [5, 5]; // 虚线效果
      pathRef.current.opacity = 0.7;
    } else {
      // 普通绘制模式
      pathRef.current.strokeColor = new paper.Color(currentColor);
      pathRef.current.strokeWidth = strokeWidth;
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
  }, [ensureDrawingLayer, currentColor, strokeWidth, isEraser, eventHandlers.onPathCreate]);

  // 继续自由绘制
  const continueFreeDraw = useCallback((point: paper.Point) => {
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && drawingState.initialClickPoint && !hasMovedRef.current) {
      const distance = drawingState.initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        createFreeDrawPath(drawingState.initialClickPoint);
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

      // 触发 Paper.js 的 change 事件以更新图层面板
      if (paper.project && (paper.project as any).emit) {
        (paper.project as any).emit('change');
      }
    }
  }, [strokeWidth, createFreeDrawPath, drawingState.initialClickPoint, drawingState.hasMoved, drawingState.dragThreshold]);

  // ========== 矩形绘制功能 ==========

  // 开始绘制矩形
  const startRectDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，等待用户开始移动
    hasMovedRef.current = false; // 重置移动状态
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
    pathRef.current.fillColor = null; // 确保不填充

    // 保存起始点用于后续更新
    if (pathRef.current) pathRef.current.startPoint = startPoint;

    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true
    }));
    isDrawingRef.current = true;
    
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, currentColor, strokeWidth, eventHandlers.onPathCreate]);

  // 更新矩形绘制
  const updateRectDraw = useCallback((point: paper.Point) => {
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && drawingState.initialClickPoint && !hasMovedRef.current) {
      const distance = drawingState.initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        createRectPath(drawingState.initialClickPoint);
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
      pathRef.current.fillColor = null;

      // 保持起始点引用
      if (pathRef.current) (pathRef.current as any).startPoint = startPoint;
    }
  }, [currentColor, strokeWidth, createRectPath, drawingState.initialClickPoint, drawingState.hasMoved, drawingState.dragThreshold]);

  // ========== 圆形绘制功能 ==========

  // 开始绘制圆形
  const startCircleDraw = useCallback((point: paper.Point) => {
    // 不立即创建图元，等待用户开始移动
    hasMovedRef.current = false; // 重置移动状态
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
    pathRef.current.fillColor = null; // 确保不填充

    // 保存起始点用于后续更新
    if (pathRef.current) pathRef.current.startPoint = startPoint;

    setDrawingState(prev => ({
      ...prev,
      currentPath: pathRef.current,
      isDrawing: true
    }));
    isDrawingRef.current = true;
    
    eventHandlers.onPathCreate?.(pathRef.current);
  }, [ensureDrawingLayer, currentColor, strokeWidth, eventHandlers.onPathCreate]);

  // 更新圆形绘制
  const updateCircleDraw = useCallback((point: paper.Point) => {
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && drawingState.initialClickPoint && !hasMovedRef.current) {
      const distance = drawingState.initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        createCirclePath(drawingState.initialClickPoint);
      } else {
        // 还没超过阈值，继续等待
        return;
      }
    }

    if (pathRef.current && (pathRef.current as any).startPoint) {
      const startPoint = (pathRef.current as any).startPoint;
      const radius = startPoint.getDistance(point);

      // 优化：更新现有圆形而不是重新创建
      if (pathRef.current instanceof paper.Path.Circle) {
        // 直接更新圆形的中心和半径
        pathRef.current.position = startPoint;
        pathRef.current.bounds = new paper.Rectangle(
          startPoint.x - radius,
          startPoint.y - radius,
          radius * 2,
          radius * 2
        );
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
      pathRef.current.fillColor = null;

      // 保持起始点引用
      if (pathRef.current) (pathRef.current as any).startPoint = startPoint;
    }
  }, [currentColor, strokeWidth, createCirclePath, drawingState.initialClickPoint, drawingState.hasMoved, drawingState.dragThreshold]);

  // ========== 图片占位框绘制功能 ==========

  // 开始绘制图片占位框
  const startImageDraw = useCallback((point: paper.Point) => {
    hasMovedRef.current = false; // 重置移动状态
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
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && drawingState.initialClickPoint && !hasMovedRef.current) {
      const distance = drawingState.initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        createImagePath(drawingState.initialClickPoint);
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
    pathRef.current.strokeWidth = 2;
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
    // 如果还没有创建路径，检查是否超过拖拽阈值
    if (!pathRef.current && drawingState.initialClickPoint && !hasMovedRef.current) {
      const distance = drawingState.initialClickPoint.getDistance(point);
      
      if (distance >= drawingState.dragThreshold) {
        // 超过阈值，创建图元并开始绘制
        hasMovedRef.current = true; // 立即设置移动状态
        setDrawingState(prev => ({ ...prev, hasMoved: true }));
        create3DModelPath(drawingState.initialClickPoint);
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
      pathRef.current.strokeWidth = 2;
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
  }, [ensureDrawingLayer, currentColor, strokeWidth, eventHandlers.onPathCreate]);

  // 开始绘制直线（仅记录起始位置）
  const startLineDraw = useCallback((point: paper.Point) => {
    // 记录起始位置，等待拖拽阈值触发或第二次点击
    hasMovedRef.current = false; // 重置移动状态
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
      const completedPath = pathRef.current;
      pathRef.current = null;
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

      eventHandlers.onPathComplete?.(completedPath);
      eventHandlers.onDrawEnd?.('line');
    }
  }, [eventHandlers.onPathComplete, eventHandlers.onDrawEnd]);

  // ========== 通用绘制结束 ==========
  
  const finishDraw = useCallback((drawMode: DrawMode, performErase?: (path: paper.Path) => void, createImagePlaceholder?: (start: paper.Point, end: paper.Point) => void, create3DModelPlaceholder?: (start: paper.Point, end: paper.Point) => void, setDrawMode?: (mode: DrawMode) => void) => {
    logger.debug(`finishDraw被调用: drawMode=${drawMode}, pathRef=${!!pathRef.current}, initialClickPoint=${!!drawingState.initialClickPoint}, hasMoved=${hasMovedRef.current}`);
    
    // 处理画线类工具的特殊情况：如果用户只是点击而没有拖拽，切换到选择模式
    if ((drawMode === 'free' || drawMode === 'rect' || drawMode === 'circle') && !pathRef.current && drawingState.initialClickPoint && !hasMovedRef.current) {
      logger.debug('finishDraw: 检测到只点击未拖拽，切换到选择模式');
      // 用户只是点击了但没有拖拽，清理状态并切换模式
      hasMovedRef.current = false;
      setDrawingState(prev => ({
        ...prev,
        initialClickPoint: null,
        hasMoved: false,
        isDrawing: false
      }));
      isDrawingRef.current = false;
      
      // 切换到选择模式（只有在真正没有拖拽时才切换）
      if (setDrawMode) {
        setDrawMode('select');
      }
      
      eventHandlers.onDrawEnd?.(drawMode);
      return;
    }

    if (pathRef.current) {
      // 如果是橡皮擦模式，执行擦除操作然后删除橡皮擦路径
      if (isEraser && performErase) {
        performErase(pathRef.current as any);
        pathRef.current.remove(); // 删除橡皮擦路径本身
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
        const completedPath = pathRef.current;
        delete pathRef.current.startPoint;
        pathRef.current = null;
        
        if (!isEraser && drawMode !== 'image' && drawMode !== '3d-model') {
          eventHandlers.onPathComplete?.(completedPath);
        }
      }

      // 触发 Paper.js 的 change 事件
      if (paper.project && (paper.project as any).emit) {
        (paper.project as any).emit('change');
      }
    }

    // 重置绘图状态
    setDrawingState(prev => ({
      ...prev,
      currentPath: null,
      isDrawing: false,
      initialClickPoint: null,
      hasMoved: false
    }));
    isDrawingRef.current = false;
    
    eventHandlers.onDrawEnd?.(drawMode);
    logger.debug(`结束${drawMode}绘制`);
  }, [isEraser, drawingState.initialClickPoint, eventHandlers.onPathComplete, eventHandlers.onDrawEnd]);

  return {
    // 状态
    drawingState,
    pathRef,
    isDrawingRef,
    
    // 快捷访问常用状态
    initialClickPoint: drawingState.initialClickPoint,
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