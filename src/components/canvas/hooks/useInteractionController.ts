/**
 * 交互控制器Hook
 * 协调所有鼠标事件处理，管理不同工具间的交互
 */

import { useCallback, useEffect, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import type { DrawMode } from '@/stores/toolStore';
import type { ImageDragState, ImageResizeState } from '@/types/canvas';

// 导入其他hook的类型
interface SelectionTool {
  isSelectionDragging: boolean;
  selectedPath: paper.Path | null;
  handleSelectionClick: (point: paper.Point) => any;
  updateSelectionBox: (point: paper.Point) => void;
  finishSelectionBox: (point: paper.Point) => void;
}

interface PathEditor {
  isPathDragging: boolean;
  isSegmentDragging: boolean;
  handlePathEditInteraction: (point: paper.Point, selectedPath: paper.Path | null, type: 'mousedown' | 'mousemove' | 'mouseup') => any;
  getCursorStyle: (point: paper.Point, selectedPath: paper.Path | null) => string;
}

interface DrawingTools {
  startFreeDraw: (point: paper.Point) => void;
  continueFreeDraw: (point: paper.Point) => void;
  startLineDraw: (point: paper.Point) => void;
  updateLineDraw: (point: paper.Point) => void;
  finishLineDraw: (point: paper.Point) => void;
  createLinePath: (point: paper.Point) => void;
  startRectDraw: (point: paper.Point) => void;
  updateRectDraw: (point: paper.Point) => void;
  startCircleDraw: (point: paper.Point) => void;
  updateCircleDraw: (point: paper.Point) => void;
  startImageDraw: (point: paper.Point) => void;
  updateImageDraw: (point: paper.Point) => void;
  start3DModelDraw: (point: paper.Point) => void;
  update3DModelDraw: (point: paper.Point) => void;
  finishDraw: (drawMode: DrawMode, ...args: any[]) => void;
  pathRef: React.RefObject<any>;
  isDrawingRef: React.RefObject<boolean>;
  initialClickPoint: paper.Point | null;
  hasMoved: boolean;
}

interface ImageTool {
  imageInstances: any[];
  imageDragState: ImageDragState;
  imageResizeState: ImageResizeState;
  setImageDragState: (state: ImageDragState) => void;
  setImageResizeState: (state: ImageResizeState) => void;
  handleImageMove: (id: string, position: { x: number; y: number }, skipPaperUpdate?: boolean) => void;
  handleImageResize: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  createImagePlaceholder: (start: paper.Point, end: paper.Point) => void;
}

interface Model3DTool {
  model3DInstances: any[];
  create3DModelPlaceholder: (start: paper.Point, end: paper.Point) => void;
}

interface UseInteractionControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  drawMode: DrawMode;
  zoom: number;
  selectionTool: SelectionTool;
  pathEditor: PathEditor;
  drawingTools: DrawingTools;
  imageTool: ImageTool;
  model3DTool: Model3DTool;
  performErase: (path: paper.Path) => void;
  setDrawMode: (mode: DrawMode) => void;
}

export const useInteractionController = ({
  canvasRef,
  drawMode,
  zoom,
  selectionTool,
  pathEditor,
  drawingTools,
  imageTool,
  model3DTool,
  performErase,
  setDrawMode
}: UseInteractionControllerProps) => {

  // 拖拽检测相关常量
  const DRAG_THRESHOLD = 3; // 3像素的拖拽阈值

  // ========== 鼠标按下事件处理 ==========
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (event.button !== 0) return; // 只响应左键点击

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // 转换为 Paper.js 坐标系
    const point = paper.view.viewToProject(new paper.Point(x, y));

    // ========== 选择模式处理 ==========
    if (drawMode === 'select') {
      // 首先检查是否点击在图像的调整控制点上
      const resizeHandleHit = paper.project.hitTest(point, {
        fill: true,
        tolerance: 5 / zoom
      });

      if (resizeHandleHit && resizeHandleHit.item.data?.isResizeHandle) {
        // 开始图像调整大小
        const imageId = resizeHandleHit.item.data.imageId;
        const direction = resizeHandleHit.item.data.direction;

        // 获取图像组
        const imageGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId === imageId
          )
        )[0];

        if (imageGroup) {
          // 获取实际的图片边界（Raster的边界），而不是整个组的边界
          const raster = imageGroup.children.find(child => child instanceof paper.Raster);
          const actualBounds = raster ? raster.bounds.clone() : imageGroup.bounds.clone();

          imageTool.setImageResizeState({
            isImageResizing: true,
            resizeImageId: imageId,
            resizeDirection: direction,
            resizeStartBounds: actualBounds,
            resizeStartPoint: point
          });
        }
        return;
      }

      // 处理路径编辑交互
      const pathEditResult = pathEditor.handlePathEditInteraction(point, selectionTool.selectedPath, 'mousedown');
      if (pathEditResult) {
        return; // 路径编辑处理了这个事件
      }

      // 处理选择相关的点击（传递Ctrl键状态）
      const ctrlPressed = event.ctrlKey || event.metaKey;  // Mac上使用Cmd键
      const selectionResult = selectionTool.handleSelectionClick(point, ctrlPressed);

      // 如果点击了图片且准备拖拽
      if (selectionResult?.type === 'image') {
        const clickedImage = imageTool.imageInstances.find(img => img.id === selectionResult.id);
        if (clickedImage?.isSelected) {
          imageTool.setImageDragState({
            isImageDragging: true,
            dragImageId: selectionResult.id,
            imageDragStartPoint: point,
            imageDragStartBounds: { x: clickedImage.bounds.x, y: clickedImage.bounds.y }
          });
        }
      }

      return;
    }

    // ========== 绘图模式处理 ==========
    logger.drawing(`开始绘制: 模式=${drawMode}, 坐标=(${x.toFixed(1)}, ${y.toFixed(1)})`);

    if (drawMode === 'free') {
      drawingTools.startFreeDraw(point);
    } else if (drawMode === 'line') {
      // 直线绘制模式：第一次点击开始，第二次点击完成
      if (!drawingTools.pathRef.current || !(drawingTools.pathRef.current as any).startPoint) {
        drawingTools.startLineDraw(point);
      } else {
        drawingTools.finishLineDraw(point);
      }
    } else if (drawMode === 'rect') {
      drawingTools.startRectDraw(point);
    } else if (drawMode === 'circle') {
      drawingTools.startCircleDraw(point);
    } else if (drawMode === 'image') {
      drawingTools.startImageDraw(point);
    } else if (drawMode === 'quick-image') {
      // 快速图片上传模式不需要绘制占位框，直接触发上传
      return;
    } else if (drawMode === '3d-model') {
      drawingTools.start3DModelDraw(point);
    }

    drawingTools.isDrawingRef.current = true;
  }, [
    canvasRef,
    drawMode,
    zoom,
    selectionTool,
    pathEditor,
    drawingTools,
    imageTool,
    logger
  ]);

  // ========== 鼠标移动事件处理 ==========
  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const point = paper.view.viewToProject(new paper.Point(x, y));

    // ========== 选择模式处理 ==========
    if (drawMode === 'select') {
      // 处理路径编辑移动
      const pathEditResult = pathEditor.handlePathEditInteraction(point, selectionTool.selectedPath, 'mousemove');
      if (pathEditResult) {
        return; // 路径编辑处理了这个事件
      }

      // 处理图像拖拽
      if (imageTool.imageDragState.isImageDragging &&
        imageTool.imageDragState.dragImageId &&
        imageTool.imageDragState.imageDragStartPoint &&
        imageTool.imageDragState.imageDragStartBounds) {

        const deltaX = point.x - imageTool.imageDragState.imageDragStartPoint.x;
        const deltaY = point.y - imageTool.imageDragState.imageDragStartPoint.y;

        const newPosition = {
          x: imageTool.imageDragState.imageDragStartBounds.x + deltaX,
          y: imageTool.imageDragState.imageDragStartBounds.y + deltaY
        };

        imageTool.handleImageMove(imageTool.imageDragState.dragImageId, newPosition, false);
        return;
      }

      // 处理图像调整大小
      if (imageTool.imageResizeState.isImageResizing &&
        imageTool.imageResizeState.resizeImageId &&
        imageTool.imageResizeState.resizeDirection &&
        imageTool.imageResizeState.resizeStartBounds &&
        imageTool.imageResizeState.resizeStartPoint) {

        handleImageResize(point);
        return;
      }

      // 处理选择框拖拽
      if (selectionTool.isSelectionDragging) {
        selectionTool.updateSelectionBox(point);
        return;
      }

      // 更新鼠标光标样式
      updateCursorStyle(point, canvas);
      return;
    }

    // ========== 绘图模式处理 ==========

    // 直线模式：检查拖拽阈值或跟随鼠标
    if (drawMode === 'line') {
      if (drawingTools.initialClickPoint && !drawingTools.hasMoved && !drawingTools.pathRef.current) {
        const distance = drawingTools.initialClickPoint.getDistance(point);
        if (distance >= DRAG_THRESHOLD) {
          drawingTools.createLinePath(drawingTools.initialClickPoint);
        }
      }

      if (drawingTools.pathRef.current && (drawingTools.pathRef.current as any).startPoint) {
        drawingTools.updateLineDraw(point);
      }
      return;
    }

    // 其他绘图模式
    if (drawMode === 'free') {
      drawingTools.continueFreeDraw(point);
    } else if (drawMode === 'rect') {
      drawingTools.updateRectDraw(point);
    } else if (drawMode === 'circle') {
      drawingTools.updateCircleDraw(point);
    } else if (drawMode === 'image') {
      drawingTools.updateImageDraw(point);
    } else if (drawMode === '3d-model') {
      drawingTools.update3DModelDraw(point);
    }
  }, [
    canvasRef,
    drawMode,
    selectionTool,
    pathEditor,
    drawingTools,
    imageTool,
    DRAG_THRESHOLD
  ]);

  // ========== 鼠标抬起事件处理 ==========
  const handleMouseUp = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ========== 选择模式处理 ==========
    if (drawMode === 'select') {
      // 处理路径编辑结束
      const pathEditResult = pathEditor.handlePathEditInteraction(
        paper.view.viewToProject(new paper.Point(
          event.clientX - canvas.getBoundingClientRect().left,
          event.clientY - canvas.getBoundingClientRect().top
        )),
        selectionTool.selectedPath,
        'mouseup'
      );
      if (pathEditResult) {
        return;
      }

      // 处理图像拖拽结束
      if (imageTool.imageDragState.isImageDragging) {
        imageTool.setImageDragState({
          isImageDragging: false,
          dragImageId: null,
          imageDragStartPoint: null,
          imageDragStartBounds: null
        });
        return;
      }

      // 处理图像调整大小结束
      if (imageTool.imageResizeState.isImageResizing) {
        imageTool.setImageResizeState({
          isImageResizing: false,
          resizeImageId: null,
          resizeDirection: null,
          resizeStartBounds: null,
          resizeStartPoint: null
        });
        return;
      }

      // 处理选择框完成
      if (selectionTool.isSelectionDragging) {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const point = paper.view.viewToProject(new paper.Point(x, y));
        selectionTool.finishSelectionBox(point);
        return;
      }
    }

    // ========== 绘图模式处理 ==========
    const validDrawingModes: DrawMode[] = ['line', 'free', 'rect', 'circle', 'image', '3d-model'];

    if (validDrawingModes.includes(drawMode)) {
      // 只有在实际有绘制活动时才调用 finishDraw
      if (drawingTools.isDrawingRef.current ||
        drawingTools.pathRef.current ||
        drawingTools.hasMoved ||
        drawingTools.initialClickPoint) {

        logger.debug(`🎨 ${drawMode}模式结束，交给finishDraw处理`);
        drawingTools.finishDraw(
          drawMode,
          performErase,
          imageTool.createImagePlaceholder,
          model3DTool.create3DModelPlaceholder,
          setDrawMode
        );
      }
    } else if (drawingTools.isDrawingRef.current) {
      logger.drawing(`结束绘制: 模式=${drawMode}`);
      drawingTools.finishDraw(
        drawMode,
        performErase,
        imageTool.createImagePlaceholder,
        model3DTool.create3DModelPlaceholder,
        setDrawMode
      );
    }

    drawingTools.isDrawingRef.current = false;
  }, [
    canvasRef,
    drawMode,
    pathEditor,
    selectionTool,
    imageTool,
    drawingTools,
    model3DTool,
    performErase,
    setDrawMode,
    logger
  ]);

  // ========== 辅助函数 ==========

  // 处理图像调整大小
  const handleImageResize = useCallback((point: paper.Point) => {
    if (!imageTool.imageResizeState.isImageResizing ||
      !imageTool.imageResizeState.resizeStartBounds ||
      !imageTool.imageResizeState.resizeImageId ||
      !imageTool.imageResizeState.resizeDirection) {
      return;
    }

    // 获取原始宽高比
    const aspectRatio = imageTool.imageResizeState.resizeStartBounds.width /
      imageTool.imageResizeState.resizeStartBounds.height;

    const newBounds = imageTool.imageResizeState.resizeStartBounds.clone();

    // 根据拖拽方向调整边界，保持宽高比
    const direction = imageTool.imageResizeState.resizeDirection;

    if (direction === 'se') {
      // 右下角调整
      const dx = point.x - imageTool.imageResizeState.resizeStartBounds.x;
      const dy = point.y - imageTool.imageResizeState.resizeStartBounds.y;

      const diagonalX = 1;
      const diagonalY = 1 / aspectRatio;

      const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);

      newBounds.width = Math.max(50, projectionLength * diagonalX);
      newBounds.height = newBounds.width / aspectRatio;

    } else if (direction === 'nw') {
      // 左上角调整
      const dx = imageTool.imageResizeState.resizeStartBounds.right - point.x;
      const dy = imageTool.imageResizeState.resizeStartBounds.bottom - point.y;

      const diagonalX = 1;
      const diagonalY = 1 / aspectRatio;

      const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);

      newBounds.width = Math.max(50, projectionLength * diagonalX);
      newBounds.height = newBounds.width / aspectRatio;
      newBounds.x = imageTool.imageResizeState.resizeStartBounds.right - newBounds.width;
      newBounds.y = imageTool.imageResizeState.resizeStartBounds.bottom - newBounds.height;

    } else if (direction === 'ne') {
      // 右上角调整
      const dx = point.x - imageTool.imageResizeState.resizeStartBounds.x;
      const dy = imageTool.imageResizeState.resizeStartBounds.bottom - point.y;

      const diagonalX = 1;
      const diagonalY = 1 / aspectRatio;

      const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);

      newBounds.width = Math.max(50, projectionLength * diagonalX);
      newBounds.height = newBounds.width / aspectRatio;
      newBounds.y = imageTool.imageResizeState.resizeStartBounds.bottom - newBounds.height;

    } else if (direction === 'sw') {
      // 左下角调整
      const dx = imageTool.imageResizeState.resizeStartBounds.right - point.x;
      const dy = point.y - imageTool.imageResizeState.resizeStartBounds.y;

      const diagonalX = 1;
      const diagonalY = 1 / aspectRatio;

      const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);

      newBounds.width = Math.max(50, projectionLength * diagonalX);
      newBounds.height = newBounds.width / aspectRatio;
      newBounds.x = imageTool.imageResizeState.resizeStartBounds.right - newBounds.width;
    }

    // 更新图像边界
    imageTool.handleImageResize(imageTool.imageResizeState.resizeImageId, {
      x: newBounds.x,
      y: newBounds.y,
      width: newBounds.width,
      height: newBounds.height
    });

    // 不强制更新Paper.js视图，让它自然渲染
  }, [imageTool]);

  // 更新鼠标光标样式
  const updateCursorStyle = useCallback((point: paper.Point, canvas: HTMLCanvasElement) => {
    // 首先检查是否悬停在图像调整控制点上
    const hoverHit = paper.project.hitTest(point, {
      fill: true,
      tolerance: 5 / zoom
    });

    if (hoverHit && hoverHit.item.data?.isResizeHandle) {
      const direction = hoverHit.item.data.direction;
      if (direction === 'nw' || direction === 'se') {
        canvas.style.cursor = 'nwse-resize';
      } else if (direction === 'ne' || direction === 'sw') {
        canvas.style.cursor = 'nesw-resize';
      }
      return;
    }

    // 检查是否悬停在已选中的图像上
    for (const image of imageTool.imageInstances) {
      if (image.isSelected &&
        point.x >= image.bounds.x &&
        point.x <= image.bounds.x + image.bounds.width &&
        point.y >= image.bounds.y &&
        point.y <= image.bounds.y + image.bounds.height) {
        canvas.style.cursor = 'move';
        return;
      }
    }

    // 检查路径编辑相关的光标
    if (selectionTool.selectedPath) {
      const cursor = pathEditor.getCursorStyle(point, selectionTool.selectedPath);
      canvas.style.cursor = cursor;
      return;
    }

    canvas.style.cursor = 'default'; // 默认光标
  }, [zoom, imageTool.imageInstances, selectionTool.selectedPath, pathEditor]);

  // ========== 事件监听器绑定 ==========
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 绑定事件监听器
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp); // 鼠标离开也结束绘制

    return () => {
      // 清理事件监听器
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp]);

  return {
    // 主要事件处理器
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,

    // 辅助功能
    updateCursorStyle,
    handleImageResize,
  };
};