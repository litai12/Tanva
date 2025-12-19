/**
 * 交互控制器Hook
 * 协调所有鼠标事件处理，管理不同工具间的交互
 */

import { useCallback, useEffect, useRef } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import { clientToProject, getDpr } from '@/utils/paperCoords';
import { historyService } from '@/services/historyService';
import type { DrawMode } from '@/stores/toolStore';
import type { ImageDragState, ImageResizeState } from '@/types/canvas';
import { paperSaveService } from '@/services/paperSaveService';
import { useCanvasStore } from '@/stores';

// 导入其他hook的类型
interface SelectionTool {
  isSelectionDragging: boolean;
  selectedPath: paper.Path | null;
  selectedPaths: paper.Path[];
  handleSelectionClick: (point: paper.Point, multiSelect?: boolean) => any;
  updateSelectionBox: (point: paper.Point) => void;
  finishSelectionBox: (point: paper.Point) => void;
}

interface PathEditor {
  isPathDragging: boolean;
  isSegmentDragging: boolean;
  isScaling: boolean;
  handlePathEditInteraction: (point: paper.Point, selectedPath: paper.Path | null, type: 'mousedown' | 'mousemove' | 'mouseup', shiftPressed?: boolean) => any;
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
  handleImageMoveBatch?: (
    positions: Record<string, { x: number; y: number }>,
    options?: { updateView?: boolean; commitState?: boolean; notify?: boolean }
  ) => void;
  handleImageResize: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  createImagePlaceholder: (start: paper.Point, end: paper.Point) => void;
  // 可选：由图片工具暴露的选中集与删除方法
  selectedImageIds?: string[];
  handleImageDelete?: (id: string) => void;
  // 占位框相关
  selectedPlaceholderId?: string | null;
  deletePlaceholder?: (id: string) => void;
}

interface Model3DTool {
  model3DInstances: any[];
  create3DModelPlaceholder: (start: paper.Point, end: paper.Point) => void;
  // 可选：若后续支持按键删除3D模型
  selectedModel3DIds?: string[];
  handleModel3DDelete?: (id: string) => void;
  // 占位框相关
  selectedPlaceholderId?: string | null;
  deletePlaceholder?: (id: string) => void;
}

interface SimpleTextTool {
  handleCanvasClick: (point: paper.Point, event?: PointerEvent, currentDrawMode?: string) => void;
  handleDoubleClick: (point: paper.Point) => void;
  handleKeyDown: (event: KeyboardEvent) => boolean;
  // 文本选择/编辑状态（可选，供键盘事件处理逻辑使用）
  selectedTextId?: string | null;
  editingTextId?: string | null;
}

type GroupPathDragMode = 'image' | 'path';

interface GroupPathDragState {
  active: boolean;
  mode: GroupPathDragMode | null;
  startPoint: paper.Point | null;
  paths: Array<{ path: paper.Path; startPosition: paper.Point }>;
  hasMoved: boolean;
}

interface SpacePanDragState {
  startScreen: { x: number; y: number };
  startPan: { x: number; y: number };
}

const isPaperItemRemoved = (item: paper.Item | null | undefined): boolean => {
  if (!item) return true;
  const removedFlag = (item as { removed?: unknown }).removed;
  if (typeof removedFlag === 'boolean') {
    return removedFlag;
  }
  return typeof item.isInserted === 'function' ? !item.isInserted() : false;
};

interface UseInteractionControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  drawMode: DrawMode;
  zoom: number;
  selectionTool: SelectionTool;
  pathEditor: PathEditor;
  drawingTools: DrawingTools;
  imageTool: ImageTool;
  model3DTool: Model3DTool;
  simpleTextTool: SimpleTextTool;
  performErase: (path: paper.Path) => void;
  setDrawMode: (mode: DrawMode) => void;
  isEraser: boolean;
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
  simpleTextTool,
  performErase,
  setDrawMode,
  isEraser
}: UseInteractionControllerProps) => {

  // 拖拽检测相关常量
  const DRAG_THRESHOLD = 3; // 3像素的拖拽阈值
  const isSpacePressedRef = useRef(false);
  const spacePanDragRef = useRef<SpacePanDragState | null>(null);
  const groupPathDragRef = useRef<GroupPathDragState>({
    active: false,
    mode: null,
    startPoint: null,
    paths: [],
    hasMoved: false
  });
  const imageDragRafRef = useRef<number | null>(null);
  const pendingImageDragPositionsRef = useRef<Record<string, { x: number; y: number }> | null>(null);
  const lastImageDragPositionsRef = useRef<Record<string, { x: number; y: number }> | null>(null);

  // Refs to always read the latest tool states inside global event handlers
  const selectionToolRef = useRef(selectionTool);
  const imageToolRef = useRef(imageTool);
  const model3DToolRef = useRef(model3DTool);
  const pathEditorRef = useRef(pathEditor);
  const drawingToolsRef = useRef(drawingTools);
  const simpleTextToolRef = useRef(simpleTextTool);
  const drawModeRef = useRef(drawMode);
  const isEraserRef = useRef(isEraser);
  const zoomRef = useRef(zoom);
  const performEraseRef = useRef(performErase);
  const setDrawModeRef = useRef(setDrawMode);

  useEffect(() => {
    selectionToolRef.current = selectionTool;
  }, [selectionTool]);

  useEffect(() => {
    imageToolRef.current = imageTool;
  }, [imageTool]);

  useEffect(() => {
    model3DToolRef.current = model3DTool;
  }, [model3DTool]);

  useEffect(() => {
    pathEditorRef.current = pathEditor;
  }, [pathEditor]);

  useEffect(() => {
    drawingToolsRef.current = drawingTools;
  }, [drawingTools]);

  useEffect(() => {
    simpleTextToolRef.current = simpleTextTool;
  }, [simpleTextTool]);

  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  useEffect(() => {
    isEraserRef.current = isEraser;
  }, [isEraser]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    performEraseRef.current = performErase;
  }, [performErase]);

  useEffect(() => {
    setDrawModeRef.current = setDrawMode;
  }, [setDrawMode]);

  const isSelectionLikeMode = useCallback(() => {
    const mode = drawModeRef.current;
    return mode === 'select' || mode === 'pointer' || mode === 'global-pointer';
  }, []);

  const collectSelectedPaths = useCallback(() => {
    const latestSelectionTool = selectionToolRef.current;
    const single = latestSelectionTool?.selectedPath ?? null;
    const multiple = latestSelectionTool?.selectedPaths ?? [];

    const set = new Set<paper.Path>();
    if (single && !isPaperItemRemoved(single)) {
      set.add(single);
    }
    multiple.forEach((path) => {
      if (path && !isPaperItemRemoved(path)) {
        set.add(path);
      }
    });
    return Array.from(set);
  }, []);

  const resetGroupPathDrag = useCallback(() => {
    groupPathDragRef.current = {
      active: false,
      mode: null,
      startPoint: null,
      paths: [],
      hasMoved: false
    };
  }, []);

  const beginGroupPathDrag = useCallback((startPoint: paper.Point | null, mode: GroupPathDragMode) => {
    if (!startPoint) {
      resetGroupPathDrag();
      return false;
    }

    const selected = collectSelectedPaths();
    if (!selected.length) {
      resetGroupPathDrag();
      return false;
    }

    const start = startPoint.clone ? startPoint.clone() : new paper.Point(startPoint.x, startPoint.y);
    const entries = selected
      .map((path) => {
        if (!path || isPaperItemRemoved(path)) return null;
        const position = path.position;
        if (!position) return null;
        const startPosition = position.clone ? position.clone() : new paper.Point(position.x, position.y);
        return { path, startPosition };
      })
      .filter((entry): entry is { path: paper.Path; startPosition: paper.Point } => !!entry);

    if (!entries.length) {
      resetGroupPathDrag();
      return false;
    }

    groupPathDragRef.current = {
      active: true,
      mode,
      startPoint: start,
      paths: entries,
      hasMoved: false
    };
    return true;
  }, [collectSelectedPaths, resetGroupPathDrag]);

  const applyGroupPathDrag = useCallback((point: paper.Point | null, expectedMode: GroupPathDragMode | null = null) => {
    const state = groupPathDragRef.current;
    if (!state.active || !state.startPoint || !point) return;
    if (expectedMode && state.mode !== expectedMode) return;

    const deltaX = point.x - state.startPoint.x;
    const deltaY = point.y - state.startPoint.y;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
      state.hasMoved = true;
    }

    state.paths.forEach(({ path, startPosition }) => {
      if (!path || isPaperItemRemoved(path) || !startPosition) return;
      const newPosition = new paper.Point(startPosition.x + deltaX, startPosition.y + deltaY);
      path.position = newPosition;
    });
  }, []);

  const stopSpacePan = useCallback(() => {
    if (spacePanDragRef.current) {
      spacePanDragRef.current = null;
      try { useCanvasStore.getState().setDragging(false); } catch {}
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (isSpacePressedRef.current && isSelectionLikeMode()) {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = 'default';
    }
  }, [canvasRef, isSelectionLikeMode]);

  // 阻止框选过程中触发的滚轮事件导致画布意外平移/缩放
  useEffect(() => {
    const blockWheelDuringSelection = (event: WheelEvent) => {
      if (selectionToolRef.current?.isSelectionDragging) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('wheel', blockWheelDuringSelection, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', blockWheelDuringSelection, { capture: true });
  }, []);

  // ========== 鼠标按下事件处理 ==========
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (event.button !== 0) return; // 只响应左键点击

    const canvas = canvasRef.current;
    if (!canvas) return;
    const currentDrawMode = drawModeRef.current;
    const latestSelectionTool = selectionToolRef.current;
    const latestImageTool = imageToolRef.current;
    const latestModel3DTool = model3DToolRef.current;
    const latestPathEditor = pathEditorRef.current;
    const latestDrawingTools = drawingToolsRef.current;
    const latestSimpleTextTool = simpleTextToolRef.current;
    const currentZoom = Math.max(zoomRef.current ?? 1, 0.0001);
    const isEraserActive = isEraserRef.current;

    if (!currentDrawMode || !latestSelectionTool || !latestImageTool || !latestPathEditor || !latestDrawingTools || !latestSimpleTextTool) {
      return;
    }

    if (isSelectionLikeMode() && isSpacePressedRef.current) {
      const rect = canvas.getBoundingClientRect();
      const { panX, panY, setDragging } = useCanvasStore.getState();
      spacePanDragRef.current = {
        startScreen: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        startPan: { x: panX, y: panY }
      };
      try { setDragging(true); } catch {}
      canvas.style.cursor = 'grabbing';
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    // 转换为 Paper.js 项目坐标（考虑 devicePixelRatio）
    const point = clientToProject(canvas, event.clientX, event.clientY);

    // ========== 选择模式处理 ==========
    if (currentDrawMode === 'select' || currentDrawMode === 'global-pointer') {
      // 橡皮擦模式下，不允许激活选择框功能
      if (isEraserActive) {
        logger.debug('🧹 橡皮擦模式下，跳过选择框激活');
        return;
      }
      const previouslySelectedPaths = new Set<paper.Path>();
      if (latestSelectionTool.selectedPath) {
        previouslySelectedPaths.add(latestSelectionTool.selectedPath);
      }
      (latestSelectionTool.selectedPaths ?? []).forEach((path) => {
        if (path) {
          previouslySelectedPaths.add(path);
        }
      });
      const hasMultiplePathSelection = previouslySelectedPaths.size > 1;
      
      // 先检查是否点击了图片占位框（Paper 组 data.type === 'image-placeholder'）
      try {
        const hit = paper.project.hitTest(point, {
          segments: false,
          stroke: true,
          fill: true,
          tolerance: 2 / currentZoom,
        } as any);
        if (hit && hit.item) {
          let node: any = hit.item;
          let imagePlaceholder: any = null;
          let modelPlaceholder: any = null;
          let hotspotType: 'image' | 'model3d' | null = null;

          while (node) {
            if (!hotspotType && node.data?.uploadHotspotType) {
              hotspotType = node.data.uploadHotspotType;
            }
            if (!imagePlaceholder && node.data?.type === 'image-placeholder') {
              imagePlaceholder = node;
            }
            if (!modelPlaceholder && node.data?.type === '3d-model-placeholder') {
              modelPlaceholder = node;
            }
            node = node.parent;
          }

          if (hotspotType === 'image' && imagePlaceholder) {
            try {
              const placeholderRef = (latestImageTool as any)?.currentPlaceholderRef;
              if (placeholderRef) {
                placeholderRef.current = imagePlaceholder;
              }
            } catch {}
            try {
              const triggerUpload = (latestImageTool as any)?.setTriggerImageUpload;
              if (typeof triggerUpload === 'function') {
                triggerUpload(true);
              }
            } catch {}
            logger.upload('📸 命中图片上传按钮，触发上传');
            return;
          }

          if (hotspotType === 'model3d' && modelPlaceholder) {
            try {
              const placeholderRef = (latestModel3DTool as any)?.currentModel3DPlaceholderRef;
              if (placeholderRef) {
                placeholderRef.current = modelPlaceholder;
              }
            } catch {}
            try {
              const triggerUpload = (latestModel3DTool as any)?.setTriggerModel3DUpload;
              if (typeof triggerUpload === 'function') {
                triggerUpload(true);
              }
            } catch {}
            logger.upload('🎲 命中3D模型上传按钮，触发上传');
            return;
          }
        }
      } catch {}

      // 首先检查是否点击在图像的调整控制点上
      const resizeHandleHit = paper.project.hitTest(point, {
        fill: true,
        tolerance: 10 / currentZoom
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

          latestImageTool.setImageResizeState({
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
      const shiftPressed = event.shiftKey;
      if (!hasMultiplePathSelection) {
        const pathEditResult = latestPathEditor.handlePathEditInteraction(point, latestSelectionTool.selectedPath, 'mousedown', shiftPressed);
        if (pathEditResult) {
          return; // 路径编辑处理了这个事件
        }
      }

      // 处理选择相关的点击（传递Ctrl键状态）
      const ctrlPressed = event.ctrlKey || event.metaKey;  // Mac上使用Cmd键
      const selectionResult = latestSelectionTool.handleSelectionClick(point, ctrlPressed);

      // 如果开始框选，禁用 Flow 节点的 pointer-events
      // 这样框选拖拽时不会被 Flow 节点打断
      if (selectionResult?.type === 'selection-box-start') {
        document.body.classList.add('tanva-selection-dragging');
        // 直接设置 Flow overlay 的 pointer-events，确保框选不被打断
        const flowOverlay = document.querySelector('.tanva-flow-overlay') as HTMLElement;
        if (flowOverlay) {
          flowOverlay.style.pointerEvents = 'none';
        }
        logger.debug('🔲 开始框选，禁用 Flow 层事件');
      }

      // 如果点击了图片且准备拖拽
      if (selectionResult?.type === 'image') {
        const clickedImage = latestImageTool.imageInstances.find(img => img.id === selectionResult.id);
        if (clickedImage?.isSelected) {
          const selectedIds = Array.isArray(latestImageTool.selectedImageIds) && latestImageTool.selectedImageIds.length > 0
            ? (latestImageTool.selectedImageIds.includes(selectionResult.id)
                ? latestImageTool.selectedImageIds
                : [selectionResult.id])
            : [selectionResult.id];

          const boundsMap: Record<string, { x: number; y: number }> = {};
          selectedIds.forEach((id) => {
            const inst = latestImageTool.imageInstances.find((img) => img.id === id);
            if (inst) {
              boundsMap[id] = { x: inst.bounds.x, y: inst.bounds.y };
            }
          });

          latestImageTool.setImageDragState({
            isImageDragging: true,
            dragImageId: selectionResult.id,
            imageDragStartPoint: point,
            imageDragStartBounds: { x: clickedImage.bounds.x, y: clickedImage.bounds.y },
            groupImageIds: selectedIds,
            groupStartBounds: boundsMap,
          });
          beginGroupPathDrag(point, 'image');
        }
      }

      if (selectionResult?.type === 'path') {
        const pathWasSelected = previouslySelectedPaths.has(selectionResult.path);
        if (pathWasSelected && hasMultiplePathSelection && !ctrlPressed) {
          beginGroupPathDrag(point, 'path');
        }
      }

      // 在选择模式下，让文本工具也处理点击事件（用于文本选择/取消选择）
      latestSimpleTextTool.handleCanvasClick(point, event as any, 'select');

      return;
    }

    // ========== 绘图模式处理 ==========
    logger.drawing(`开始绘制: 模式=${currentDrawMode}, 坐标=(${point.x.toFixed(1)}, ${point.y.toFixed(1)}), 橡皮擦=${isEraserActive}`);

    if (currentDrawMode === 'free') {
      latestDrawingTools.startFreeDraw(point);
    } else if (currentDrawMode === 'line') {
      // 直线绘制模式：第一次点击开始，第二次点击完成
      if (!latestDrawingTools.pathRef.current || !(latestDrawingTools.pathRef.current as any).startPoint) {
        latestDrawingTools.startLineDraw(point);
      } else {
        latestDrawingTools.finishLineDraw(point);
      }
    } else if (currentDrawMode === 'rect') {
      latestDrawingTools.startRectDraw(point);
    } else if (currentDrawMode === 'circle') {
      latestDrawingTools.startCircleDraw(point);
    } else if (currentDrawMode === 'image') {
      latestDrawingTools.startImageDraw(point);
    } else if (currentDrawMode === 'quick-image') {
      // 快速图片上传模式不需要绘制占位框，直接触发上传
      return;
    } else if (currentDrawMode === '3d-model') {
      latestDrawingTools.start3DModelDraw(point);
    } else if (currentDrawMode === 'text') {
      // 文本工具处理，传递当前工具模式
      latestSimpleTextTool.handleCanvasClick(point, event as any, currentDrawMode);
      return; // 文本工具不需要设置 isDrawingRef
    }

    latestDrawingTools.isDrawingRef.current = true;
  }, [canvasRef, beginGroupPathDrag, isSelectionLikeMode]);

  // 更新鼠标光标样式（需在 handleMouseMove 之前定义，避免临时死区）
  function updateCursorStyle(point: paper.Point, canvas: HTMLCanvasElement) {
    const currentZoom = Math.max(zoomRef.current ?? 1, 0.0001);
    const latestImageTool = imageToolRef.current;
    const latestSelectionTool = selectionToolRef.current;
    const latestPathEditor = pathEditorRef.current;

    // 空格抓手优先：仅在选择/指针模式下生效
    if (isSelectionLikeMode() && isSpacePressedRef.current) {
      canvas.style.cursor = spacePanDragRef.current ? 'grabbing' : 'grab';
      return;
    }

    const hoverHit = paper.project.hitTest(point, {
      fill: true,
      tolerance: 10 / currentZoom,
    });

    if (hoverHit && hoverHit.item.data?.isResizeHandle) {
      const direction = hoverHit.item.data.direction;
      canvas.style.cursor =
        direction === 'nw' || direction === 'se' ? 'nwse-resize' : 'nesw-resize';
      return;
    }

    for (const image of latestImageTool?.imageInstances ?? []) {
      if (
        image.isSelected &&
        point.x >= image.bounds.x &&
        point.x <= image.bounds.x + image.bounds.width &&
        point.y >= image.bounds.y &&
        point.y <= image.bounds.y + image.bounds.height
      ) {
        canvas.style.cursor = 'move';
        return;
      }
    }

    if (latestSelectionTool?.selectedPath && latestPathEditor) {
      canvas.style.cursor = latestPathEditor.getCursorStyle(
        point,
        latestSelectionTool.selectedPath,
      );
      return;
    }

    canvas.style.cursor = 'default';
  }

  // 处理图像调整大小，默认保持宽高比，按住Shift自由缩放
  const handleImageResize = useCallback((point: paper.Point, shiftPressed: boolean = false) => {
    const latestImageTool = imageToolRef.current;
    if (!latestImageTool ||
      !latestImageTool.imageResizeState.isImageResizing ||
      !latestImageTool.imageResizeState.resizeStartBounds ||
      !latestImageTool.imageResizeState.resizeImageId ||
      !latestImageTool.imageResizeState.resizeDirection) {
      return;
    }

    const startBounds = latestImageTool.imageResizeState.resizeStartBounds;
    const aspectRatio = startBounds.width / startBounds.height;
    const MIN_SIZE = 50;

    const newBounds = startBounds.clone();

    const direction = latestImageTool.imageResizeState.resizeDirection;

    const applyLockedAspectResize = () => {
      if (direction === 'se') {
        const dx = point.x - startBounds.x;
        const dy = point.y - startBounds.y;

        const diagonalX = 1;
        const diagonalY = 1 / aspectRatio;

        const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);

        newBounds.width = Math.max(MIN_SIZE, projectionLength * diagonalX);
        newBounds.height = newBounds.width / aspectRatio;
      } else if (direction === 'nw') {
        const dx = startBounds.right - point.x;
        const dy = startBounds.bottom - point.y;

        const diagonalX = 1;
        const diagonalY = 1 / aspectRatio;

        const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);

        newBounds.width = Math.max(MIN_SIZE, projectionLength * diagonalX);
        newBounds.height = newBounds.width / aspectRatio;
        newBounds.x = startBounds.right - newBounds.width;
        newBounds.y = startBounds.bottom - newBounds.height;
      } else if (direction === 'ne') {
        const dx = point.x - startBounds.x;
        const dy = startBounds.bottom - point.y;

        const diagonalX = 1;
        const diagonalY = 1 / aspectRatio;

        const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);

        newBounds.width = Math.max(MIN_SIZE, projectionLength * diagonalX);
        newBounds.height = newBounds.width / aspectRatio;
        newBounds.y = startBounds.bottom - newBounds.height;
      } else if (direction === 'sw') {
        const dx = startBounds.right - point.x;
        const dy = point.y - startBounds.y;

        const diagonalX = 1;
        const diagonalY = 1 / aspectRatio;

        const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);

        newBounds.width = Math.max(MIN_SIZE, projectionLength * diagonalX);
        newBounds.height = newBounds.width / aspectRatio;
        newBounds.x = startBounds.right - newBounds.width;
      }
    };

    const applyFreeResize = () => {
      if (direction === 'se') {
        newBounds.width = Math.max(MIN_SIZE, point.x - startBounds.x);
        newBounds.height = Math.max(MIN_SIZE, point.y - startBounds.y);
      } else if (direction === 'nw') {
        newBounds.width = Math.max(MIN_SIZE, startBounds.right - point.x);
        newBounds.height = Math.max(MIN_SIZE, startBounds.bottom - point.y);
        newBounds.x = startBounds.right - newBounds.width;
        newBounds.y = startBounds.bottom - newBounds.height;
      } else if (direction === 'ne') {
        newBounds.width = Math.max(MIN_SIZE, point.x - startBounds.x);
        newBounds.height = Math.max(MIN_SIZE, startBounds.bottom - point.y);
        newBounds.y = startBounds.bottom - newBounds.height;
      } else if (direction === 'sw') {
        newBounds.width = Math.max(MIN_SIZE, startBounds.right - point.x);
        newBounds.height = Math.max(MIN_SIZE, point.y - startBounds.y);
        newBounds.x = startBounds.right - newBounds.width;
      }
    };

    if (shiftPressed) {
      applyFreeResize();
    } else {
      applyLockedAspectResize();
    }

    latestImageTool.handleImageResize(latestImageTool.imageResizeState.resizeImageId, {
      x: newBounds.x,
      y: newBounds.y,
      width: newBounds.width,
      height: newBounds.height
    });
  }, []);

  // ========== 鼠标移动事件处理 ==========
  const handleMouseMove = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const currentDrawMode = drawModeRef.current;
    const latestSelectionTool = selectionToolRef.current;
    const latestPathEditor = pathEditorRef.current;
    const latestDrawingTools = drawingToolsRef.current;
    const latestImageTool = imageToolRef.current;

    if (!currentDrawMode || !latestSelectionTool || !latestPathEditor || !latestDrawingTools || !latestImageTool) {
      return;
    }

    const point = clientToProject(canvas, event.clientX, event.clientY);

    if (spacePanDragRef.current) {
      const rect = canvas.getBoundingClientRect();
      const dpr = getDpr();
      const currentZoom = Math.max(zoomRef.current ?? 1, 0.0001);
      const deltaX = (event.clientX - rect.left - spacePanDragRef.current.startScreen.x) * dpr;
      const deltaY = (event.clientY - rect.top - spacePanDragRef.current.startScreen.y) * dpr;
      // 使画布跟随鼠标移动方向（鼠标向右拖，画布内容向右移动）
      const worldDeltaX = deltaX / currentZoom;
      const worldDeltaY = deltaY / currentZoom;
      try {
        const { setPan } = useCanvasStore.getState();
        setPan(spacePanDragRef.current.startPan.x + worldDeltaX, spacePanDragRef.current.startPan.y + worldDeltaY);
      } catch {}
      canvas.style.cursor = 'grabbing';
      return;
    }

    // ========== 选择模式处理 ==========
    if (currentDrawMode === 'select' || currentDrawMode === 'global-pointer') {
      const pathGroupDragState = groupPathDragRef.current;
      if (pathGroupDragState.active && pathGroupDragState.mode === 'path') {
        applyGroupPathDrag(point, 'path');
        try { paper.view.update(); } catch {}
        return;
      }
      // 处理路径编辑移动
      const pathEditResult = latestPathEditor.handlePathEditInteraction(point, latestSelectionTool.selectedPath, 'mousemove');
      if (pathEditResult) {
        return; // 路径编辑处理了这个事件
      }

      // 处理图像拖拽
      if (
        latestImageTool.imageDragState.isImageDragging &&
        latestImageTool.imageDragState.dragImageId &&
        latestImageTool.imageDragState.imageDragStartPoint &&
        latestImageTool.imageDragState.imageDragStartBounds
      ) {
        const deltaX = point.x - latestImageTool.imageDragState.imageDragStartPoint.x;
        const deltaY = point.y - latestImageTool.imageDragState.imageDragStartPoint.y;

        const groupIds = latestImageTool.imageDragState.groupImageIds?.length
          ? latestImageTool.imageDragState.groupImageIds
          : [latestImageTool.imageDragState.dragImageId];
        const groupStart = latestImageTool.imageDragState.groupStartBounds || {};

        const batchPositions: Record<string, { x: number; y: number }> = {};
        groupIds.forEach((id) => {
          const start = groupStart[id] || latestImageTool.imageDragState.imageDragStartBounds;
          if (!start) {
            return;
          }
          batchPositions[id] = {
            x: start.x + deltaX,
            y: start.y + deltaY,
          };
        });

        pendingImageDragPositionsRef.current = batchPositions;
        if (imageDragRafRef.current === null) {
          imageDragRafRef.current = requestAnimationFrame(() => {
            imageDragRafRef.current = null;
            const pending = pendingImageDragPositionsRef.current;
            pendingImageDragPositionsRef.current = null;
            if (!pending) return;
            lastImageDragPositionsRef.current = pending;

            const tool = imageToolRef.current;
            if (!tool) return;
            if (tool.handleImageMoveBatch) {
              tool.handleImageMoveBatch(pending, { commitState: false, notify: false });
            } else {
              Object.entries(pending).forEach(([id, pos]) => tool.handleImageMove(id, pos, true));
              try { paper.view.update(); } catch {}
            }
          });
        }

        applyGroupPathDrag(point, 'image');
        return;
      }

      // 处理图像调整大小
      if (latestImageTool.imageResizeState.isImageResizing &&
        latestImageTool.imageResizeState.resizeImageId &&
        latestImageTool.imageResizeState.resizeDirection &&
        latestImageTool.imageResizeState.resizeStartBounds &&
        latestImageTool.imageResizeState.resizeStartPoint) {

        handleImageResize(point, event.shiftKey);
        return;
      }

      // 处理选择框拖拽
      if (latestSelectionTool.isSelectionDragging) {
        latestSelectionTool.updateSelectionBox(point);
        return;
      }

      // 更新鼠标光标样式
      updateCursorStyle(point, canvas);
      return;
    }

    // ========== 绘图模式处理 ==========

    // 直线模式：检查拖拽阈值或跟随鼠标
    if (currentDrawMode === 'line') {
      if (latestDrawingTools.initialClickPoint && !latestDrawingTools.hasMoved && !latestDrawingTools.pathRef.current) {
        const distance = latestDrawingTools.initialClickPoint.getDistance(point);
        if (distance >= DRAG_THRESHOLD) {
          latestDrawingTools.createLinePath(latestDrawingTools.initialClickPoint);
        }
      }

      if (latestDrawingTools.pathRef.current && (latestDrawingTools.pathRef.current as any).startPoint) {
        latestDrawingTools.updateLineDraw(point);
      }
      return;
    }

    // 其他绘图模式
    if (currentDrawMode === 'free') {
      latestDrawingTools.continueFreeDraw(point);
    } else if (currentDrawMode === 'rect') {
      latestDrawingTools.updateRectDraw(point);
    } else if (currentDrawMode === 'circle') {
      latestDrawingTools.updateCircleDraw(point);
    } else if (currentDrawMode === 'image') {
      latestDrawingTools.updateImageDraw(point);
    } else if (currentDrawMode === '3d-model') {
      latestDrawingTools.update3DModelDraw(point);
    }
  }, [
    canvasRef,
    DRAG_THRESHOLD,
    applyGroupPathDrag,
    updateCursorStyle,
    handleImageResize
  ]);

  // ========== 鼠标抬起事件处理 ==========
  const handleMouseUp = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const currentDrawMode = drawModeRef.current;
    const latestSelectionTool = selectionToolRef.current;
    const latestPathEditor = pathEditorRef.current;
    const latestImageTool = imageToolRef.current;
    const latestDrawingTools = drawingToolsRef.current;
    const latestPerformErase = performEraseRef.current;
    const latestSetDrawMode = setDrawModeRef.current;
    const latestModel3DTool = model3DToolRef.current;

    if (!currentDrawMode || !latestSelectionTool || !latestPathEditor || !latestImageTool || !latestDrawingTools) {
      return;
    }

    if (spacePanDragRef.current) {
      stopSpacePan();
      return;
    }

    // ========== 选择模式处理 ==========
    if (currentDrawMode === 'select' || currentDrawMode === 'global-pointer') {
      // 处理路径编辑结束
      const pathEditResult = latestPathEditor.handlePathEditInteraction(
        clientToProject(canvas, event.clientX, event.clientY),
        latestSelectionTool.selectedPath,
        'mouseup'
      );
      if (pathEditResult) {
        return;
      }

      const pathGroupDragState = groupPathDragRef.current;
      if (pathGroupDragState.active && pathGroupDragState.mode === 'path') {
        const moved = pathGroupDragState.hasMoved;
        resetGroupPathDrag();
        if (moved) {
          try { paper.view.update(); } catch {}
          historyService.commit('move-paths').catch(() => {});
        }
        return;
      }

      // 处理图像拖拽结束
      if (latestImageTool.imageDragState.isImageDragging) {
        if (imageDragRafRef.current !== null) {
          cancelAnimationFrame(imageDragRafRef.current);
          imageDragRafRef.current = null;
        }
        const pending = pendingImageDragPositionsRef.current;
        pendingImageDragPositionsRef.current = null;
        if (pending) {
          if (latestImageTool.handleImageMoveBatch) {
            latestImageTool.handleImageMoveBatch(pending, { commitState: false, notify: false });
          } else {
            Object.entries(pending).forEach(([id, pos]) => latestImageTool.handleImageMove(id, pos, true));
            try { paper.view.update(); } catch {}
          }
          lastImageDragPositionsRef.current = pending;
        }

        const finalPositions = lastImageDragPositionsRef.current;
        lastImageDragPositionsRef.current = null;
        if (finalPositions && latestImageTool.handleImageMoveBatch) {
          latestImageTool.handleImageMoveBatch(finalPositions, { updateView: false, commitState: true });
        }

        latestImageTool.setImageDragState({
          isImageDragging: false,
          dragImageId: null,
          imageDragStartPoint: null,
          imageDragStartBounds: null,
          groupImageIds: undefined,
          groupStartBounds: undefined,
        });
        resetGroupPathDrag();
        historyService.commit('move-image').catch(() => {});
        try { paperSaveService.triggerAutoSave('move-image'); } catch {}
        return;
      }

      // 处理图像调整大小结束
      if (latestImageTool.imageResizeState.isImageResizing) {
        latestImageTool.setImageResizeState({
          isImageResizing: false,
          resizeImageId: null,
          resizeDirection: null,
          resizeStartBounds: null,
          resizeStartPoint: null
        });
        historyService.commit('resize-image').catch(() => {});
        try { paperSaveService.triggerAutoSave('resize-image'); } catch {}
        return;
      }

      // 处理选择框完成
      if (latestSelectionTool.isSelectionDragging) {
        const point = clientToProject(canvas, event.clientX, event.clientY);
        latestSelectionTool.finishSelectionBox(point);
        // 移除框选时禁用 Flow 节点事件的 CSS 类
        document.body.classList.remove('tanva-selection-dragging');
        // 恢复 Flow overlay 的 pointer-events
        const flowOverlay = document.querySelector('.tanva-flow-overlay') as HTMLElement;
        if (flowOverlay) {
          flowOverlay.style.pointerEvents = '';
        }
        logger.debug('🔲 框选结束，恢复 Flow 层事件');
        return;
      }
    }

    // ========== 绘图模式处理 ==========
    const validDrawingModes: DrawMode[] = ['line', 'free', 'rect', 'circle', 'image', '3d-model'];

    // 直线模式特殊处理：首击抬起时不应结束绘制，否则无法等待第二次点击
    if (currentDrawMode === 'line') {
      const hasLinePath = !!latestDrawingTools.pathRef.current;
      const waitingForSecondClick =
        !!latestDrawingTools.initialClickPoint &&
        !hasLinePath &&
        !latestDrawingTools.hasMoved;

      if (waitingForSecondClick) {
        logger.debug('🟦 直线模式：首击抬起，保持起点等待第二次点击');
        return;
      }
    }

    if (validDrawingModes.includes(currentDrawMode as DrawMode)) {
      // 只有在实际有绘制活动时才调用 finishDraw
      if (latestDrawingTools.isDrawingRef.current ||
        latestDrawingTools.pathRef.current ||
        latestDrawingTools.hasMoved ||
        latestDrawingTools.initialClickPoint) {

        logger.debug(`🎨 ${currentDrawMode}模式结束，交给finishDraw处理`);
        latestDrawingTools.finishDraw(
          currentDrawMode,
          latestPerformErase,
          latestImageTool.createImagePlaceholder,
          latestModel3DTool.create3DModelPlaceholder,
          latestSetDrawMode
        );
        historyService.commit(`finish-${String(currentDrawMode)}`).catch(() => {});
      }
    } else if (latestDrawingTools.isDrawingRef.current) {
      logger.drawing(`结束绘制: 模式=${currentDrawMode}`);
      latestDrawingTools.finishDraw(
        currentDrawMode,
        latestPerformErase,
        latestImageTool.createImagePlaceholder,
        latestModel3DTool.create3DModelPlaceholder,
        latestSetDrawMode
      );
      historyService.commit(`finish-${String(currentDrawMode)}`).catch(() => {});
    }

    latestDrawingTools.isDrawingRef.current = false;
  }, [canvasRef, resetGroupPathDrag, stopSpacePan]);

  // ========== 事件监听器绑定 ==========
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 键盘事件处理
    const handleKeyDown = (event: KeyboardEvent) => {
      const latestSelectionTool = selectionToolRef.current;
      const latestImageTool = imageToolRef.current;
      const latestModel3DTool = model3DToolRef.current;
      const currentDrawMode = drawModeRef.current;
      const latestSimpleTextTool = simpleTextToolRef.current;

      // 输入框/可编辑区域不拦截
      const active = document.activeElement as Element | null;
      const isEditable = !!active && ((active.tagName?.toLowerCase() === 'input') || (active.tagName?.toLowerCase() === 'textarea') || (active as any).isContentEditable);

      if (!isEditable && isSelectionLikeMode() && (event.code === 'Space' || event.key === ' ')) {
        isSpacePressedRef.current = true;
        const canvasEl = canvasRef.current;
        if (canvasEl && !spacePanDragRef.current) {
          canvasEl.style.cursor = 'grab';
        }
        event.preventDefault();
        return;
      }

      // 文本工具优先处理（无论当前是什么模式，只要有选中的文本）
      if (latestSimpleTextTool) {
        // 检查是否有选中或正在编辑的文本
        const hasSelectedText = !!latestSimpleTextTool.selectedTextId;
        const isEditingText = !!latestSimpleTextTool.editingTextId;

        // 如果在文本模式下，或者有选中的文本，让文本工具处理键盘事件
        if (currentDrawMode === 'text' || hasSelectedText || isEditingText) {
          const handled = latestSimpleTextTool.handleKeyDown(event);
          if (handled) {
            event.preventDefault();
            return;
          }
        }
      }

      // Delete/Backspace 删除已选元素
      if (!isEditable && (event.key === 'Delete' || event.key === 'Backspace')) {
        let didDelete = false;

        // 删除路径（单选与多选），含占位符组
        try {
          const selectedPath = (latestSelectionTool as any)?.selectedPath as paper.Path | null;
          const selectedPaths = (latestSelectionTool as any)?.selectedPaths as paper.Path[] | undefined;
          const removedPlaceholders = new Set<paper.Group>();

          // 🔥 不再使用 placeholderGroup 引用，改为向上查找占位符组
          const resolvePlaceholderGroup = (path: paper.Path | null | undefined): paper.Group | null => {
            let node: any = path;
            while (node) {
              if (node.data?.type === 'image-placeholder' || node.data?.type === '3d-model-placeholder') {
                return node as paper.Group;
              }
              node = node.parent;
            }
            return null;
          };

          if (selectedPath) {
            const ph = resolvePlaceholderGroup(selectedPath);
            if (ph && !removedPlaceholders.has(ph)) {
              try {
                const pid = ph.data?.placeholderId;
                ph.remove();
                if (pid && typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('predictImagePlaceholder', { detail: { placeholderId: pid, action: 'remove' } }));
                }
                didDelete = true;
              } catch {}
              removedPlaceholders.add(ph);
            } else {
              try { selectedPath.remove(); didDelete = true; } catch {}
            }
            try { (latestSelectionTool as any)?.setSelectedPath?.(null); } catch {}
          }
          if (Array.isArray(selectedPaths) && selectedPaths.length > 0) {
            selectedPaths.forEach(p => {
              const ph = resolvePlaceholderGroup(p);
              if (ph && !removedPlaceholders.has(ph)) {
                try {
                  const pid = ph.data?.placeholderId;
                  ph.remove();
                  if (pid && typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('predictImagePlaceholder', { detail: { placeholderId: pid, action: 'remove' } }));
                  }
                  didDelete = true;
                } catch {}
                removedPlaceholders.add(ph);
              } else {
                try { p.remove(); didDelete = true; } catch {}
              }
            });
            try { (latestSelectionTool as any)?.setSelectedPaths?.([]); } catch {}
          }
        } catch {}

        // 删除图片（按选中ID或状态）
        try {
          const ids = (latestImageTool?.selectedImageIds && latestImageTool.selectedImageIds.length > 0)
            ? latestImageTool.selectedImageIds
            : (latestImageTool?.imageInstances || []).filter((img: any) => img.isSelected).map((img: any) => img.id);
          if (ids && ids.length > 0 && typeof latestImageTool?.handleImageDelete === 'function') {
            ids.forEach((id: string) => { try { latestImageTool.handleImageDelete?.(id); didDelete = true; } catch {} });
          }
        } catch {}

        // 删除3D模型（若工具暴露了API）
        try {
          const mids = (latestModel3DTool?.selectedModel3DIds && latestModel3DTool.selectedModel3DIds.length > 0)
            ? latestModel3DTool.selectedModel3DIds
            : (latestModel3DTool?.model3DInstances || []).filter((m: any) => m.isSelected).map((m: any) => m.id);
          if (mids && mids.length > 0 && typeof latestModel3DTool?.handleModel3DDelete === 'function') {
            mids.forEach((id: string) => { try { latestModel3DTool.handleModel3DDelete?.(id); didDelete = true; } catch {} });
          }
        } catch {}

        // 删除选中的图片占位框
        try {
          if (latestImageTool?.selectedPlaceholderId && typeof latestImageTool?.deletePlaceholder === 'function') {
            latestImageTool.deletePlaceholder(latestImageTool.selectedPlaceholderId);
            didDelete = true;
          }
        } catch {}

        // 删除选中的3D模型占位框
        try {
          if (latestModel3DTool?.selectedPlaceholderId && typeof latestModel3DTool?.deletePlaceholder === 'function') {
            latestModel3DTool.deletePlaceholder(latestModel3DTool.selectedPlaceholderId);
            didDelete = true;
          }
        } catch {}

        if (didDelete) {
          event.preventDefault();
          try { paper.view.update(); } catch {}
          historyService.commit('delete-selection').catch(() => {});
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        isSpacePressedRef.current = false;
        stopSpacePan();
      }
    };

    // 双击事件处理
    const handleDoubleClick = (event: MouseEvent) => {
      const point = clientToProject(canvas, event.clientX, event.clientY);

      const currentDrawMode = drawModeRef.current;
      const latestSimpleTextTool = simpleTextToolRef.current;

      const tryOpenImagePreview = () => {
        try {
          const hit = paper.project.hitTest(point, {
            segments: true,
            stroke: true,
            fill: true,
            bounds: true,
            center: true,
            tolerance: 6,
          } as any);
          if (hit?.item) {
            let current: any = hit.item;
            while (current) {
              const data = current.data || {};
              if (data?.imageId) {
                event.preventDefault();
                event.stopPropagation();
                try {
                  window.dispatchEvent(new CustomEvent('canvas:image-open-preview', { detail: { imageId: data.imageId } }));
                } catch (err) {
                  console.warn('dispatch image preview failed', err);
                }
                return true;
              }
              current = current.parent;
            }
          }
        } catch (err) {
          console.warn('hitTest image on dblclick failed', err);
        }
        return false;
      };

      if (tryOpenImagePreview()) return;

      logger.debug('🎯 检测到原生双击事件，当前模式:', currentDrawMode);
      
      // 允许在任何模式下双击文本进行编辑
      // 这样即使在选择模式下也能双击编辑文本
      latestSimpleTextTool?.handleDoubleClick(point);
    };

    // 绑定事件监听器
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('dblclick', handleDoubleClick); // 双击事件

    // 在窗口级别监听移动/抬起，避免经过 Flow 节点时中断拖拽
    window.addEventListener('mousemove', handleMouseMove, { capture: true });
    window.addEventListener('mouseup', handleMouseUp, { capture: true });
    window.addEventListener('mouseleave', handleMouseUp, { capture: true });
    
    // 键盘事件需要绑定到document，因为canvas无法获取焦点
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);

    return () => {
      // 清理事件监听器
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      window.removeEventListener('mouseup', handleMouseUp, { capture: true });
      window.removeEventListener('mouseleave', handleMouseUp, { capture: true });
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
      if (imageDragRafRef.current !== null) {
        cancelAnimationFrame(imageDragRafRef.current);
        imageDragRafRef.current = null;
      }
      pendingImageDragPositionsRef.current = null;
      lastImageDragPositionsRef.current = null;
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, stopSpacePan, isSelectionLikeMode]);

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
