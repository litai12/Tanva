/**
 * 路径编辑工具Hook
 * 处理控制点拖拽、路径拖拽等路径编辑功能
 */

import { useCallback, useRef, useState } from 'react';
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
  const pathDragMovedRef = useRef(false);
  const segmentDragMovedRef = useRef(false);
  const altCloneActiveRef = useRef(false);
  const altClonePlaceholderRef = useRef<paper.Group | null>(null);
  const altClonePathRef = useRef<paper.Path | null>(null);
  const altCloneDeltaRef = useRef({ x: 0, y: 0 });

  const findPlaceholderGroup = useCallback((item?: paper.Item | null): paper.Group | null => {
    let node: paper.Item | null | undefined = item;

    while (node) {
      if (node.data?.type === 'image-placeholder' || node.data?.type === '3d-model-placeholder') {
        return node as paper.Group;
      }
      node = node.parent;
    }

    return null;
  }, []);

  const clearAltCloneState = useCallback(() => {
    altCloneActiveRef.current = false;
    altCloneDeltaRef.current = { x: 0, y: 0 };
    altClonePathRef.current = null;
    if (altClonePlaceholderRef.current) {
      try { altClonePlaceholderRef.current.remove(); } catch {}
      altClonePlaceholderRef.current = null;
    }
  }, []);

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
    segmentDragMovedRef.current = false;
    const placeholderGroup = findPlaceholderGroup(segment.path);
    if (placeholderGroup) {
      setIsSegmentDragging(true);
      setDraggedSegment(segment);
      setDragStartPoint(startPoint);
      setIsScaling(true);
      setOriginalBounds(placeholderGroup.bounds.clone());
      logger.debug('开始占位符缩放');
      return;
    }

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
  }, [findPlaceholderGroup, isRectanglePath]);

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
    try {
      if (currentPoint.getDistance(dragStartPoint) > 0.01) {
        segmentDragMovedRef.current = true;
      }
    } catch {}

    const placeholderGroup = findPlaceholderGroup(draggedSegment.path);

    if (placeholderGroup && originalBounds) {
      const center = originalBounds.center;
      const minSize = (placeholderGroup.data?.placeholderMinSize as number | undefined) ?? 40;
      const delta = currentPoint.subtract(center);
      const width = Math.max(minSize, Math.abs(delta.x) * 2);
      const height = Math.max(minSize, Math.abs(delta.y) * 2);
      const newBounds = new paper.Rectangle(
        center.subtract([width / 2, height / 2]),
        new paper.Size(width, height)
      );
      placeholderGroup.fitBounds(newBounds);
      try {
        placeholderGroup.data = {
          ...placeholderGroup.data,
          bounds: { x: newBounds.x, y: newBounds.y, width: newBounds.width, height: newBounds.height }
        };
      } catch {}
      logger.debug('更新占位符中心缩放');
      return;
    }

    if (isScaling && originalBounds && draggedSegment.path) {
      // Shift+拖拽：等比例缩放
      scaleRectangle(draggedSegment.path, draggedSegment, originalBounds, dragStartPoint, currentPoint);
    } else {
      // 普通拖拽：直接移动角点
      draggedSegment.point = currentPoint;
    }
    
    logger.debug('更新控制点位置:', currentPoint, { isScaling });
  }, [isSegmentDragging, draggedSegment, dragStartPoint, isScaling, originalBounds, scaleRectangle, findPlaceholderGroup]);

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
  const startPathDrag = useCallback((path: paper.Path, startPoint: paper.Point, altPressed: boolean = false) => {
    pathDragMovedRef.current = false;
    clearAltCloneState();
    const placeholderGroup = findPlaceholderGroup(path);
    if (placeholderGroup) {
      setIsPathDragging(true);
      setDraggedPath(path);
      setDragStartPoint(startPoint);
      setOriginalBounds(placeholderGroup.bounds.clone());
      logger.debug('开始拖拽占位符');
      return;
    }

    if (altPressed) {
      altCloneActiveRef.current = true;
      altCloneDeltaRef.current = { x: 0, y: 0 };
      try {
        altClonePathRef.current = path.clone({ insert: false }) as paper.Path;
      } catch {
        altClonePathRef.current = null;
      }

      try {
        const bounds = path.bounds?.clone?.() ?? path.bounds;
        const placeholderGroup = new paper.Group();
        placeholderGroup.data = { type: 'path-alt-drag-placeholder', isHelper: true, totalDeltaX: 0, totalDeltaY: 0 };

        const safeZoom = Math.max(zoom || 1, 0.0001);
        const placeholder = new paper.Path.Rectangle({
          rectangle: bounds,
          strokeColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.8),
          strokeWidth: 2 / safeZoom,
          dashArray: [6 / safeZoom, 4 / safeZoom],
          fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.1),
        });
        placeholder.data = { isHelper: true };
        placeholderGroup.addChild(placeholder);

        const boundsCenter = bounds.center;
        const iconSize = Math.min(40, Math.min(bounds.width, bounds.height) * 0.3);
        const iconBg = new paper.Path.Circle({
          center: boundsCenter,
          radius: iconSize / 2,
          fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.9),
        });
        iconBg.data = { isHelper: true };
        placeholderGroup.addChild(iconBg);

        const iconScale = iconSize / 40;
        const rect1 = new paper.Path.Rectangle({
          point: [boundsCenter.x - 8 * iconScale, boundsCenter.y - 8 * iconScale],
          size: [12 * iconScale, 12 * iconScale],
          strokeColor: new paper.Color(1, 1, 1, 1),
          strokeWidth: 1.5 / safeZoom,
          fillColor: null,
        });
        rect1.data = { isHelper: true };
        placeholderGroup.addChild(rect1);

        const rect2 = new paper.Path.Rectangle({
          point: [boundsCenter.x - 4 * iconScale, boundsCenter.y - 4 * iconScale],
          size: [12 * iconScale, 12 * iconScale],
          strokeColor: new paper.Color(1, 1, 1, 1),
          strokeWidth: 1.5 / safeZoom,
          fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.9),
        });
        rect2.data = { isHelper: true };
        placeholderGroup.addChild(rect2);

        altClonePlaceholderRef.current = placeholderGroup;
        try { paper.view.update(); } catch {}
        logger.debug('🔄 Alt+拖拽路径：显示占位框，原路径保持不动');
      } catch {
        // 若占位框创建失败，则退回到普通拖拽
        altCloneActiveRef.current = false;
        altCloneDeltaRef.current = { x: 0, y: 0 };
        altClonePathRef.current = null;
      }
    }

    setIsPathDragging(true);
    setDraggedPath(path);
    setDragStartPoint(startPoint);
    logger.debug('开始拖拽路径');
  }, [clearAltCloneState, findPlaceholderGroup, zoom]);

  // 更新路径位置
  const updatePathDrag = useCallback((currentPoint: paper.Point) => {
    if (!isPathDragging || !draggedPath || !dragStartPoint) return;

    const placeholderGroup = findPlaceholderGroup(draggedPath);
    if (placeholderGroup) {
      const delta = currentPoint.subtract(dragStartPoint);
      if (Math.abs(delta.x) > 0.01 || Math.abs(delta.y) > 0.01) {
        pathDragMovedRef.current = true;
      }
      placeholderGroup.translate(delta);
      const b = placeholderGroup.bounds;
      try {
        placeholderGroup.data = {
          ...placeholderGroup.data,
          bounds: { x: b.x, y: b.y, width: b.width, height: b.height }
        };
      } catch {}
      setDragStartPoint(currentPoint);
      logger.debug('移动占位符');
      return;
    }

    const delta = currentPoint.subtract(dragStartPoint);
    if (Math.abs(delta.x) > 0.01 || Math.abs(delta.y) > 0.01) {
      pathDragMovedRef.current = true;
    }

    if (altCloneActiveRef.current && altClonePlaceholderRef.current) {
      altClonePlaceholderRef.current.translate(delta);
      altCloneDeltaRef.current = {
        x: altCloneDeltaRef.current.x + delta.x,
        y: altCloneDeltaRef.current.y + delta.y,
      };
      setDragStartPoint(currentPoint);
      logger.debug('移动路径复制占位框');
      return;
    }

    draggedPath.translate(delta);
    setDragStartPoint(currentPoint);
    logger.debug('更新路径位置');
  }, [isPathDragging, draggedPath, dragStartPoint, findPlaceholderGroup]);

  // 结束路径拖拽
  const finishPathDrag = useCallback((options?: { dropToLibrary?: boolean }): { moved: boolean; action: 'move' | 'clone' | 'library' | 'none' } | null => {
    if (!isPathDragging) return null;

    const moved = pathDragMovedRef.current;
    let action: 'move' | 'clone' | 'library' | 'none' = moved ? 'move' : 'none';

    if (altCloneActiveRef.current) {
      action = 'none';
      const delta = altCloneDeltaRef.current;
      const didMove = moved && Number.isFinite(delta.x) && Number.isFinite(delta.y) && (Math.abs(delta.x) > 0.01 || Math.abs(delta.y) > 0.01);
      if (options?.dropToLibrary && didMove) {
        action = 'library';
      } else if (didMove && altClonePathRef.current) {
        try {
          const cloned = altClonePathRef.current;
          cloned.translate(new paper.Point(delta.x, delta.y));

          const parent = draggedPath?.parent;
          if (parent && typeof (parent as any).insertChild === 'function' && typeof (draggedPath as any)?.index === 'number') {
            (parent as any).insertChild((draggedPath as any).index + 1, cloned);
          } else if (paper.project?.activeLayer) {
            paper.project.activeLayer.addChild(cloned);
          } else if (paper.project) {
            try { new paper.Layer(); } catch {}
            try { paper.project.activeLayer?.addChild?.(cloned); } catch {}
          }
          try { paper.view.update(); } catch {}
          action = 'clone';
          logger.debug('🔄 Alt+拖拽路径：已在目标位置创建副本');
        } catch {
          action = 'none';
        }
      }
      clearAltCloneState();
    }

    setIsPathDragging(false);
    setDraggedPath(null);
    setDragStartPoint(null);
    logger.debug('结束路径拖拽');
    return { moved, action };
  }, [clearAltCloneState, draggedPath, isPathDragging]);

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
    shiftPressed?: boolean,
    altPressed?: boolean,
    dropToLibrary?: boolean
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
        startPathDrag(selectedPath, point, !!altPressed);
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
        const moved = segmentDragMovedRef.current;
        finishSegmentDrag();
        return { type: 'segment-drag-end', moved };
      }

      if (isPathDragging) {
        const result = finishPathDrag({ dropToLibrary });
        return { type: 'path-drag-end', ...(result ?? { moved: false, action: 'none' }) };
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
