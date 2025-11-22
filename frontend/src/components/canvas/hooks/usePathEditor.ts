/**
 * 路径编辑工具Hook
 * 处理控制点拖拽、路径拖拽等路径编辑功能
 */

import { useCallback, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';

interface UsePathEditorProps {
  zoom: number;
}

export const usePathEditor = ({ zoom }: UsePathEditorProps) => {

  // ========== 路径编辑状态 ==========
  const [isPathDragging, setIsPathDragging] = useState(false);
  const [isSegmentDragging, setIsSegmentDragging] = useState(false);
  const [isScaling, setIsScaling] = useState(false);
  const [dragStartPoint, setDragStartPoint] = useState<paper.Point | null>(null);
  const [draggedSegment, setDraggedSegment] = useState<paper.Segment | null>(null);
  const [draggedPath, setDraggedPath] = useState<paper.Path | null>(null);
  const [originalBounds, setOriginalBounds] = useState<paper.Rectangle | null>(null);

  // ========== 控制点检测和拖拽 ==========

  // 检测鼠标位置是否在控制点上
  const getSegmentAt = useCallback((point: paper.Point, path: paper.Path): paper.Segment | null => {
    if (!path.segments) return null;

    const tolerance = 14 / zoom; // 放大控制点命中区域

    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i];
      const distance = segment.point.getDistance(point);
      if (distance <= tolerance) {
        return segment;
      }
    }
    return null;
  }, [zoom]);

  // 检查路径是否为矩形
  const isRectanglePath = useCallback((path: paper.Path): boolean => {
    return path instanceof paper.Path.Rectangle || 
           (path.segments && path.segments.length === 4 && path.closed);
  }, []);

  // 开始拖拽控制点
  const startSegmentDrag = useCallback((segment: paper.Segment, startPoint: paper.Point, shiftPressed: boolean = false) => {
    setIsSegmentDragging(true);
    setDraggedSegment(segment);
    setDragStartPoint(startPoint);
    
    // 如果按住Shift且是矩形，启用缩放模式
    if (shiftPressed && segment.path && isRectanglePath(segment.path)) {
      setIsScaling(true);
      setOriginalBounds(segment.path.bounds.clone());
      logger.debug('开始Shift+角点缩放模式');
    } else {
      setIsScaling(false);
      setOriginalBounds(null);
      logger.debug('开始拖拽控制点');
    }
  }, [isRectanglePath]);

  // 计算矩形缩放
  const scaleRectangle = useCallback((
    path: paper.Path,
    draggedSegment: paper.Segment,
    originalBounds: paper.Rectangle,
    dragStartPoint: paper.Point,
    currentPoint: paper.Point
  ) => {
    if (!path.segments || path.segments.length !== 4) return;

    // 找到被拖拽角点的索引
    const segmentIndex = path.segments.indexOf(draggedSegment);
    if (segmentIndex === -1) return;

    // 计算拖拽向量
    const dragVector = currentPoint.subtract(dragStartPoint);
    
    // 根据角点位置计算缩放因子
    let scaleX = 1;
    let scaleY = 1;
    
    // 计算基于拖拽距离的缩放因子
    const originalCenter = originalBounds.center;
    const originalCorner = dragStartPoint;
    const newCorner = currentPoint;
    
    // 计算从中心到原始角点和新角点的距离
    const originalDistance = originalCenter.getDistance(originalCorner);
    const newDistance = originalCenter.getDistance(newCorner);
    
    if (originalDistance > 0) {
      const scaleFactor = newDistance / originalDistance;
      scaleX = scaleFactor;
      scaleY = scaleFactor;
    }

    // 应用缩放，保持中心点不变
    const center = originalBounds.center;
    const newWidth = originalBounds.width * scaleX;
    const newHeight = originalBounds.height * scaleY;
    
    const newBounds = new paper.Rectangle(
      center.x - newWidth / 2,
      center.y - newHeight / 2,
      newWidth,
      newHeight
    );

    // 更新矩形的四个角点
    path.segments[0].point = new paper.Point(newBounds.left, newBounds.top);
    path.segments[1].point = new paper.Point(newBounds.right, newBounds.top);
    path.segments[2].point = new paper.Point(newBounds.right, newBounds.bottom);
    path.segments[3].point = new paper.Point(newBounds.left, newBounds.bottom);

    logger.debug('矩形缩放:', { scaleFactor: scaleX, newBounds });
  }, []);

  // 更新控制点位置
  const updateSegmentDrag = useCallback((currentPoint: paper.Point) => {
    if (!isSegmentDragging || !draggedSegment || !dragStartPoint) return;

    if (isScaling && originalBounds && draggedSegment.path) {
      // Shift+拖拽：等比例缩放
      scaleRectangle(draggedSegment.path, draggedSegment, originalBounds, dragStartPoint, currentPoint);
    } else {
      // 普通拖拽：直接移动角点
      draggedSegment.point = currentPoint;
    }
    
    logger.debug('更新控制点位置:', currentPoint, { isScaling });
  }, [isSegmentDragging, draggedSegment, dragStartPoint, isScaling, originalBounds, scaleRectangle]);

  // 结束控制点拖拽
  const finishSegmentDrag = useCallback(() => {
    if (isSegmentDragging) {
      setIsSegmentDragging(false);
      setDraggedSegment(null);
      setDragStartPoint(null);
      setIsScaling(false);
      setOriginalBounds(null);
      logger.debug('结束控制点拖拽');
    }
  }, [isSegmentDragging]);

  // ========== 路径拖拽 ==========

  // 开始拖拽整个路径
  const startPathDrag = useCallback((path: paper.Path, startPoint: paper.Point) => {
    setIsPathDragging(true);
    setDraggedPath(path);
    setDragStartPoint(startPoint);
    logger.debug('开始拖拽路径');
  }, []);

  // 更新路径位置
  const updatePathDrag = useCallback((currentPoint: paper.Point) => {
    if (!isPathDragging || !draggedPath || !dragStartPoint) return;

    const delta = currentPoint.subtract(dragStartPoint);
    draggedPath.translate(delta);
    setDragStartPoint(currentPoint);
    logger.debug('更新路径位置');
  }, [isPathDragging, draggedPath, dragStartPoint]);

  // 结束路径拖拽
  const finishPathDrag = useCallback(() => {
    if (isPathDragging) {
      setIsPathDragging(false);
      setDraggedPath(null);
      setDragStartPoint(null);
      logger.debug('结束路径拖拽');
    }
  }, [isPathDragging]);

  // ========== 路径编辑辅助功能 ==========

  // 检测鼠标是否在选中路径上（用于判断是否开始路径拖拽）
  const isPointOnPath = useCallback((point: paper.Point, path: paper.Path): boolean => {
    const hitResult = paper.project.hitTest(point, {
      stroke: true,
      fill: true,
      bounds: true,
      tolerance: 6 / zoom
    });

    if (!hitResult || !hitResult.item) {
      return false;
    }

    // 直接命中当前路径
    if (hitResult.item === path) {
      return true;
    }

    // 某些命中可能返回子项（例如布尔运算后的 CompoundPath 部分）
    if (hitResult.item.parent === path) {
      return true;
    }

    return false;
  }, [zoom]);

  // 处理路径编辑模式下的鼠标交互
  const handlePathEditInteraction = useCallback((
    point: paper.Point, 
    selectedPath: paper.Path | null,
    interactionType: 'mousedown' | 'mousemove' | 'mouseup',
    shiftPressed?: boolean
  ) => {
    if (!selectedPath) return null;

    if (interactionType === 'mousedown') {
      // 检查是否点击在控制点上
      const segment = getSegmentAt(point, selectedPath);
      if (segment) {
        // 点击在控制点上，开始控制点拖拽
        startSegmentDrag(segment, point, shiftPressed);
        return { type: 'segment-drag-start', segment, isScaling: shiftPressed && isRectanglePath(selectedPath) };
      }

      // 检查是否点击在路径本身上（非控制点）
      if (isPointOnPath(point, selectedPath)) {
        // 点击在路径上，开始路径拖拽
        startPathDrag(selectedPath, point);
        return { type: 'path-drag-start', path: selectedPath };
      }
    } else if (interactionType === 'mousemove') {
      // 处理拖拽移动
      if (isSegmentDragging) {
        updateSegmentDrag(point);
        return { type: 'segment-dragging' };
      }

      if (isPathDragging) {
        updatePathDrag(point);
        return { type: 'path-dragging' };
      }
    } else if (interactionType === 'mouseup') {
      // 处理拖拽结束
      if (isSegmentDragging) {
        finishSegmentDrag();
        return { type: 'segment-drag-end' };
      }

      if (isPathDragging) {
        finishPathDrag();
        return { type: 'path-drag-end' };
      }
    }

    return null;
  }, [
    getSegmentAt, 
    startSegmentDrag, 
    isPointOnPath, 
    startPathDrag, 
    isSegmentDragging, 
    updateSegmentDrag, 
    isPathDragging, 
    updatePathDrag, 
    finishSegmentDrag, 
    finishPathDrag
  ]);

  // 获取鼠标光标样式（基于当前路径编辑状态）
  const getCursorStyle = useCallback((point: paper.Point, selectedPath: paper.Path | null): string => {
    if (!selectedPath) return 'default';

    const segment = getSegmentAt(point, selectedPath);
    if (segment) {
      return 'crosshair'; // 控制点上显示十字光标
    }

    if (isPointOnPath(point, selectedPath)) {
      return 'move'; // 路径上显示移动光标
    }

    return 'default';
  }, [getSegmentAt, isPointOnPath]);

  // ========== 路径编辑工具函数 ==========

  // 为路径添加新的控制点（在指定位置）
  const addSegmentToPath = useCallback((path: paper.Path, point: paper.Point): paper.Segment | null => {
    if (!path.segments) return null;

    // 找到最近的路径段
    const nearestLocation = path.getNearestLocation(point);
    if (!nearestLocation) return null;

    // 在最近位置插入新的段
    const newSegment = path.insert(nearestLocation.index + 1, point);
    logger.debug('在路径中添加新控制点:', point);
    
    return newSegment;
  }, []);

  // 从路径中删除指定的控制点
  const removeSegmentFromPath = useCallback((segment: paper.Segment): boolean => {
    if (!segment || !segment.path) return false;

    const path = segment.path;
    
    // 确保路径至少有3个点（保持路径完整性）
    if (path.segments.length <= 2) {
      logger.debug('无法删除控制点：路径点数太少');
      return false;
    }

    segment.remove();
    logger.debug('从路径中删除控制点');
    
    return true;
  }, []);

  // 平滑路径（重新计算控制点）
  const smoothPath = useCallback((path: paper.Path, factor: number = 0.4) => {
    if (!path.segments || path.segments.length < 3) return;

    path.smooth({ type: 'geometric', factor });
    logger.debug('路径平滑处理完成');
  }, []);

  return {
    // 状态
    isPathDragging,
    isSegmentDragging,
    isScaling,
    dragStartPoint,
    draggedSegment,
    draggedPath,
    originalBounds,

    // 控制点检测和拖拽
    getSegmentAt,
    startSegmentDrag,
    updateSegmentDrag,
    finishSegmentDrag,

    // 路径拖拽
    startPathDrag,
    updatePathDrag,
    finishPathDrag,

    // 辅助功能
    isPointOnPath,
    handlePathEditInteraction,
    getCursorStyle,

    // 路径编辑工具
    addSegmentToPath,
    removeSegmentFromPath,
    smoothPath,

    // 状态设置器（供外部直接控制）
    setIsPathDragging,
    setIsSegmentDragging,
    setDragStartPoint,
    setDraggedSegment,
    setDraggedPath,
  };
};
