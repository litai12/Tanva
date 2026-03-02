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
import {
  deleteImageGroupBlock,
  findGroupBlockTitle,
  getImagePaperBounds,
  IMAGE_GROUP_BLOCK_TYPE,
  updateGroupBlockTitle,
} from '@/utils/paperImageGroupBlock';
import type { ImageAssetSnapshot } from '@/types/project';
import type { SnapAlignmentAPI } from './useSnapAlignment';

// 导入其他hook的类型
interface SelectionTool {
  isSelectionDragging: boolean;
  selectedPath: paper.Path | null;
  selectedPaths: paper.Path[];
  startSelectionBox: (point: paper.Point) => void;
  handleSelectionClick: (point: paper.Point, multiSelect?: boolean) => any;
  updateSelectionBox: (point: paper.Point) => void;
  finishSelectionBox: (point: paper.Point, options?: {
    selectFlowNodes?: boolean;
    selectPaths?: boolean;
    selectImages?: boolean;
    selectModels?: boolean;
    selectTexts?: boolean;
  }) => void;
  selectAll?: (options?: {
    selectFlowNodes?: boolean;
    selectPaths?: boolean;
    selectImages?: boolean;
    selectModels?: boolean;
    selectTexts?: boolean;
  }) => void;
}

interface PathEditor {
  isPathDragging: boolean;
  isSegmentDragging: boolean;
  isScaling: boolean;
  handlePathEditInteraction: (
    point: paper.Point,
    selectedPath: paper.Path | null,
    type: 'mousedown' | 'mousemove' | 'mouseup',
    shiftPressed?: boolean,
    altPressed?: boolean,
    dropToLibrary?: boolean
  ) => any;
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
  handleImagesMove?: (moves: Array<{ id: string; position: { x: number; y: number } }>, skipPaperUpdate?: boolean) => void;
  handleImageResize: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  createImagePlaceholder: (start: paper.Point, end: paper.Point) => void;
  createImageFromSnapshot?: (
    snapshot: ImageAssetSnapshot,
    options?: {
      offset?: { x: number; y: number };
      idOverride?: string;
    }
  ) => string | null;
  setImagesVisibility?: (ids: string[], visible: boolean) => void;
  // 可选：由图片工具暴露的选中集与删除方法
  selectedImageIds?: string[];
  handleImageDelete?: (id: string) => void;
  // 可选：占位框管理（用于 Delete 键删除占位框）
  selectedPlaceholderId?: string | null;
  deletePlaceholder?: (placeholderId?: string) => boolean;
}

interface Model3DTool {
  model3DInstances: any[];
  create3DModelPlaceholder: (start: paper.Point, end: paper.Point) => void;
  // 可选：若后续支持按键删除3D模型
  selectedModel3DIds?: string[];
  handleModel3DDelete?: (id: string) => void;
  // 可选：占位框管理（用于 Delete 键删除占位框）
  selectedPlaceholderId?: string | null;
  deletePlaceholder?: (placeholderId?: string) => boolean;
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
  groupBlocks: Array<{
    block: paper.Path;
    imageIds: string[];
    startBounds: Record<string, { x: number; y: number }>;
  }>;
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
  snapAlignment?: SnapAlignmentAPI;
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
  isEraser,
  snapAlignment
}: UseInteractionControllerProps) => {

  // 拖拽检测相关常量
  const DRAG_THRESHOLD = 3; // 3像素的拖拽阈值
  const isSpacePressedRef = useRef(false);
  const isAltPressedRef = useRef(false); // Alt/Option 键状态
  const altDragClonedRef = useRef(false); // 标记是否已经在当前拖拽中创建了克隆
  const altDragCloneIdsRef = useRef<string[]>([]); // 记录Alt拖拽时创建的克隆图片ID
  const altDragPlaceholderRef = useRef<paper.Group | null>(null); // Alt+拖拽时的占位框
  const altDragSnapshotsRef = useRef<ImageAssetSnapshot[]>([]); // Alt+拖拽时保存的图片快照
  // 路径 Alt+拖拽复制相关状态
  const pathAltDragClonedRef = useRef(false); // 标记路径是否已创建克隆占位框
  const pathAltDragPlaceholderRef = useRef<paper.Group | null>(null); // 路径 Alt+拖拽占位框
  const pathAltDragSnapshotsRef = useRef<paper.Path[]>([]); // 保存原始路径的克隆
  const spacePanDragRef = useRef<SpacePanDragState | null>(null);
  const imageDragMovedRef = useRef(false);
  const imageDragRafRef = useRef<number | null>(null); // RAF ID for image drag sync
  const libraryHoveringRef = useRef(false);
  const groupPathDragRef = useRef<GroupPathDragState>({
    active: false,
    mode: null,
    startPoint: null,
    paths: [],
    groupBlocks: [],
    hasMoved: false
  });

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
  const snapAlignmentRef = useRef(snapAlignment);

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

  useEffect(() => {
    snapAlignmentRef.current = snapAlignment;
  }, [snapAlignment]);

  const isSelectionLikeMode = useCallback(() => {
    const mode = drawModeRef.current;
    return mode === 'select' || mode === 'marquee' || mode === 'pointer';
  }, []);

  const isPendingUploadImage = useCallback((imageId: string): boolean => {
    const images = imageToolRef.current?.imageInstances ?? [];
    const match = images.find((img: any) => String(img.id) === String(imageId));
    return Boolean(match?.imageData?.pendingUpload);
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
      groupBlocks: [],
      hasMoved: false
    };
    // 清理路径 Alt+拖拽状态
    pathAltDragClonedRef.current = false;
    if (pathAltDragPlaceholderRef.current) {
      try { pathAltDragPlaceholderRef.current.remove(); } catch {}
      pathAltDragPlaceholderRef.current = null;
    }
    pathAltDragSnapshotsRef.current = [];
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
    const pathEntries: Array<{ path: paper.Path; startPosition: paper.Point }> = [];
    const groupBlocks: Array<{
      block: paper.Path;
      imageIds: string[];
      startBounds: Record<string, { x: number; y: number }>;
    }> = [];

    const imageInstanceMap = new Map(
      (imageToolRef.current?.imageInstances ?? []).map((img: any) => [String(img.id), img])
    );

    selected.forEach((path) => {
      if (!path || isPaperItemRemoved(path)) return;
      if (path.data?.type === 'image-group') {
        // 在图片拖拽模式下，组块由图片移动驱动，不需要加入路径拖拽队列
        if (mode === 'image') return;
        const rawIds = (path.data as any)?.imageIds;
        const imageIds = Array.isArray(rawIds) ? rawIds.filter((id) => typeof id === 'string') : [];
        if (imageIds.length === 0) return;
        const startBounds: Record<string, { x: number; y: number }> = {};
        imageIds.forEach((id) => {
          const inst = imageInstanceMap.get(id);
          if (inst?.bounds) startBounds[id] = { x: inst.bounds.x, y: inst.bounds.y };
        });
        if (Object.keys(startBounds).length === 0) return;
        groupBlocks.push({ block: path, imageIds, startBounds });
        return;
      }

      const position = path.position;
      if (!position) return;
      const startPosition = position.clone ? position.clone() : new paper.Point(position.x, position.y);
      pathEntries.push({ path, startPosition });
    });

    if (!pathEntries.length && !groupBlocks.length) {
      resetGroupPathDrag();
      return false;
    }

    groupPathDragRef.current = {
      active: true,
      mode,
      startPoint: start,
      paths: pathEntries,
      groupBlocks,
      hasMoved: false
    };
    return true;
  }, [collectSelectedPaths, resetGroupPathDrag]);

  const updateLibraryDropHover = useCallback((clientX: number, clientY: number, enabled: boolean) => {
    const libraryDropZone = document.querySelector('[data-library-drop-zone="true"]');
    if (!libraryDropZone) {
      if (libraryHoveringRef.current) {
        libraryHoveringRef.current = false;
        window.dispatchEvent(new CustomEvent('canvas:library-drag-hover', {
          detail: { hovering: false }
        }));
      }
      return false;
    }

    if (!enabled) {
      libraryDropZone.classList.remove('library-drop-highlight');
      if (libraryHoveringRef.current) {
        libraryHoveringRef.current = false;
        window.dispatchEvent(new CustomEvent('canvas:library-drag-hover', {
          detail: { hovering: false }
        }));
      }
      return false;
    }

    const rect = libraryDropZone.getBoundingClientRect();
    const isOverLibrary =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (isOverLibrary) {
      libraryDropZone.classList.add('library-drop-highlight');
    } else {
      libraryDropZone.classList.remove('library-drop-highlight');
    }

    if (libraryHoveringRef.current !== isOverLibrary) {
      libraryHoveringRef.current = isOverLibrary;
      window.dispatchEvent(new CustomEvent('canvas:library-drag-hover', {
        detail: { hovering: isOverLibrary }
      }));
    }

    return isOverLibrary;
  }, []);

  const clearLibraryDropHover = useCallback(() => {
    updateLibraryDropHover(0, 0, false);
  }, [updateLibraryDropHover]);

  const applyGroupPathDrag = useCallback((point: paper.Point | null, expectedMode: GroupPathDragMode | null = null, altPressed: boolean = false) => {
    const state = groupPathDragRef.current;
    if (!state.active || !state.startPoint || !point) return;
    if (expectedMode && state.mode !== expectedMode) return;

    const deltaX = point.x - state.startPoint.x;
    const deltaY = point.y - state.startPoint.y;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
      state.hasMoved = true;
    }

    // Alt+拖拽路径：创建占位框，原路径保持不动
    if (altPressed && state.paths.length > 0 && !pathAltDragClonedRef.current) {
      pathAltDragClonedRef.current = true;

      // 计算所有路径的总边界
      let totalBounds: paper.Rectangle | null = null;
      const clonedPaths: paper.Path[] = [];

      state.paths.forEach(({ path }) => {
        if (!path || isPaperItemRemoved(path)) return;
        // 克隆路径用于后续创建副本
        const cloned = path.clone({ insert: false }) as paper.Path;
        clonedPaths.push(cloned);

        if (!totalBounds) {
          totalBounds = path.bounds.clone();
        } else {
          totalBounds = totalBounds.unite(path.bounds);
        }
      });

      pathAltDragSnapshotsRef.current = clonedPaths;

      // 创建占位框
      if (totalBounds && paper.project) {
        const bounds = totalBounds as paper.Rectangle;
        const placeholderGroup = new paper.Group();
        placeholderGroup.data = { type: 'path-alt-drag-placeholder', isHelper: true };

        // 占位框背景（蓝色虚线框）
        const placeholder = new paper.Path.Rectangle({
          rectangle: bounds,
          strokeColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.8),
          strokeWidth: 2 / (zoomRef.current || 1),
          dashArray: [6 / (zoomRef.current || 1), 4 / (zoomRef.current || 1)],
          fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.1),
        });
        placeholder.data = { isHelper: true };
        placeholderGroup.addChild(placeholder);

        // 图标背景圆
        const boundsCenter = bounds.center;
        const iconSize = Math.min(40, Math.min(bounds.width, bounds.height) * 0.3);
        const iconBg = new paper.Path.Circle({
          center: boundsCenter,
          radius: iconSize / 2,
          fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.9),
        });
        iconBg.data = { isHelper: true };
        placeholderGroup.addChild(iconBg);

        // 复制图标（两个重叠矩形）
        const iconScale = iconSize / 40;
        const rect1 = new paper.Path.Rectangle({
          point: [boundsCenter.x - 8 * iconScale, boundsCenter.y - 8 * iconScale],
          size: [12 * iconScale, 12 * iconScale],
          strokeColor: new paper.Color(1, 1, 1, 1),
          strokeWidth: 1.5 / (zoomRef.current || 1),
          fillColor: null,
        });
        rect1.data = { isHelper: true };
        placeholderGroup.addChild(rect1);

        const rect2 = new paper.Path.Rectangle({
          point: [boundsCenter.x - 4 * iconScale, boundsCenter.y - 4 * iconScale],
          size: [12 * iconScale, 12 * iconScale],
          strokeColor: new paper.Color(1, 1, 1, 1),
          strokeWidth: 1.5 / (zoomRef.current || 1),
          fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.9),
        });
        rect2.data = { isHelper: true };
        placeholderGroup.addChild(rect2);

        pathAltDragPlaceholderRef.current = placeholderGroup;
        try { paper.view.update(); } catch {}
      }

      logger.debug('🔄 Alt+拖拽路径：显示占位框，原路径保持不动');
    }

    // Alt+拖拽模式：只移动占位框，不移动原路径
    if (pathAltDragClonedRef.current && pathAltDragPlaceholderRef.current) {
      const placeholder = pathAltDragPlaceholderRef.current;
      placeholder.position = new paper.Point(
        placeholder.position.x + deltaX - (placeholder.data.lastDeltaX || 0),
        placeholder.position.y + deltaY - (placeholder.data.lastDeltaY || 0)
      );
      placeholder.data.lastDeltaX = deltaX;
      placeholder.data.lastDeltaY = deltaY;
      try { paper.view.update(); } catch {}
      return;
    }

    // 普通拖拽：移动原路径
    state.paths.forEach(({ path, startPosition }) => {
      if (!path || isPaperItemRemoved(path) || !startPosition) return;
      const newPosition = new paper.Point(startPosition.x + deltaX, startPosition.y + deltaY);
      path.position = newPosition;
    });

    // 组块：拖拽时移动其内部图片，由图片位置驱动组块更新，避免组块与图片脱节
    const latestImageTool = imageToolRef.current;
    if (latestImageTool?.handleImageMove) {
      state.groupBlocks.forEach((entry) => {
        const startBounds = entry.startBounds || {};
        const moves: Array<{ id: string; position: { x: number; y: number } }> = [];
        Object.keys(startBounds).forEach((imageId) => {
          const start = startBounds[imageId];
          if (!start) return;
          moves.push({ id: imageId, position: { x: start.x + deltaX, y: start.y + deltaY } });
        });

        if (moves.length === 0) return;
        if (typeof latestImageTool.handleImagesMove === 'function') {
          try { latestImageTool.handleImagesMove(moves, false); } catch {}
          return;
        }

        moves.forEach(({ id, position }) => {
          try { latestImageTool.handleImageMove(id, position, false); } catch {}
        });
      });
    }
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

  // ========== 鼠标按下事件处理 ==========
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (event.button !== 0) return; // 只响应左键点击

    const canvas = canvasRef.current;
    if (!canvas) return;
    isAltPressedRef.current = event.altKey;
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
    if (currentDrawMode === 'select' || currentDrawMode === 'marquee') {
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

        if (isPendingUploadImage(imageId)) {
          // 上传中仅允许移动，跳过 resize，继续后续选择逻辑
        } else {
          const actualBounds = getImagePaperBounds(imageId);
          if (!actualBounds) return;

          latestImageTool.setImageResizeState({
            isImageResizing: true,
            resizeImageId: imageId,
            resizeDirection: direction,
            resizeStartBounds: actualBounds,
            resizeStartPoint: point
          });
          // 调整大小时也禁用工具栏/Flow 节点事件，避免快速拖动时经过悬浮工具栏导致交互中断
          document.body.classList.add('tanva-canvas-dragging');
          return;
        }
      }

      // 处理路径编辑交互
      const shiftPressed = event.shiftKey;
      const selectedPathForEdit = latestSelectionTool.selectedPath;
      const isImageGroupBlockSelected = selectedPathForEdit?.data?.type === 'image-group';
      if (!hasMultiplePathSelection && !isImageGroupBlockSelected) {
        const pathEditResult = latestPathEditor.handlePathEditInteraction(
          point,
          latestSelectionTool.selectedPath,
          'mousedown',
          shiftPressed,
          isAltPressedRef.current || event.altKey,
          undefined
        );
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
        logger.debug('🔲 开始框选，禁用 Flow 节点事件');
      }

      // 如果点击了图片且准备拖拽
      // 🔥 修复：移除 isSelected 检查，因为 handleSelectionClick 已经处理了选中逻辑
      // 第一次点击图片时，isSelected 还是 false（状态更新是异步的），导致无法拖拽
      if (selectionResult?.type === 'image') {
        const clickedImage = latestImageTool.imageInstances.find(img => img.id === selectionResult.id);

        // 若当前已选中图片组块，且点击的图片属于该组，则允许直接从组内图片触发“组拖拽”
        const selectedGroupImageIds = new Set<string>();
        let clickedInSelectedGroup = false;
        try {
          previouslySelectedPaths.forEach((path) => {
            if (path?.data?.type !== 'image-group') return;
            const raw = (path.data as any)?.imageIds;
            if (!Array.isArray(raw)) return;
            raw.forEach((id) => {
              if (typeof id !== 'string') return;
              const trimmed = id.trim();
              if (!trimmed) return;
              selectedGroupImageIds.add(trimmed);
            });
          });
          clickedInSelectedGroup = selectedGroupImageIds.has(selectionResult.id);
        } catch {}

        // 判断是否已有多选：如果当前图片在已选中列表中，使用已选中列表；否则只拖拽当前图片
        const wasAlreadySelected = Boolean(clickedImage?.isSelected);
        const shouldDragExistingSelection =
          wasAlreadySelected &&
          Array.isArray(latestImageTool.selectedImageIds) &&
          latestImageTool.selectedImageIds.length > 0 &&
          latestImageTool.selectedImageIds.includes(selectionResult.id);

        const baseSelectedIds = shouldDragExistingSelection
          ? latestImageTool.selectedImageIds!
          : [selectionResult.id];

        // 若复合选择中包含图片组块，则拖拽时需要把组内图片一并移动
        const groupImageIds: string[] = [];
        if (shouldDragExistingSelection || clickedInSelectedGroup) {
          previouslySelectedPaths.forEach((path) => {
            if (path?.data?.type !== 'image-group') return;
            const raw = (path.data as any)?.imageIds;
            if (Array.isArray(raw)) {
              raw.forEach((id) => {
                if (typeof id === 'string') groupImageIds.push(id);
              });
            }
          });
        }

        const dragIdsSet = new Set<string>();
        baseSelectedIds.forEach((id) => dragIdsSet.add(id));
        groupImageIds.forEach((id) => dragIdsSet.add(id));
        // 组块被选中但图片未选中时：从组内图片开始拖拽，确保能拖动整个组
        if (clickedInSelectedGroup && selectedGroupImageIds.size > 0) {
          selectedGroupImageIds.forEach((id) => dragIdsSet.add(id));
        }
        const selectedIds = Array.from(dragIdsSet);

        // 🔥 修复：优先从 Paper.js 获取实际 bounds，避免 React 状态不同步/尚未写入导致拖动异常
        const boundsMap: Record<string, { x: number; y: number }> = {};
        selectedIds.forEach((id) => {
          const paperBounds = getImagePaperBounds(id);
          if (paperBounds) {
            boundsMap[id] = { x: paperBounds.x, y: paperBounds.y };
            return;
          }
          const inst = latestImageTool.imageInstances.find((img) => img.id === id);
          if (inst) boundsMap[id] = { x: inst.bounds.x, y: inst.bounds.y };
        });

        const clickedPaperBounds = getImagePaperBounds(selectionResult.id);
        const actualClickedBounds = clickedPaperBounds
          ? { x: clickedPaperBounds.x, y: clickedPaperBounds.y }
          : clickedImage
            ? { x: clickedImage.bounds.x, y: clickedImage.bounds.y }
            : null;

        if (!actualClickedBounds) return;

        imageDragMovedRef.current = false;
        altDragCloneIdsRef.current = [];
        libraryHoveringRef.current = false;
        latestImageTool.setImageDragState({
          isImageDragging: true,
          dragImageId: selectionResult.id,
          imageDragStartPoint: point,
          imageDragStartBounds: { x: actualClickedBounds.x, y: actualClickedBounds.y },
          groupImageIds: selectedIds,
          groupStartBounds: boundsMap,
        });
        // 初始化对齐吸附
        if (snapAlignmentRef.current?.startSnapping) {
          snapAlignmentRef.current.startSnapping(selectedIds);
        }
        // 拖拽图片时禁用 Flow 节点事件，避免经过节点时被打断
        document.body.classList.add('tanva-canvas-dragging');
        if (shouldDragExistingSelection) {
          beginGroupPathDrag(point, 'image');
        }
      }

      if (selectionResult?.type === 'path') {
        const pathWasSelected = previouslySelectedPaths.has(selectionResult.path);

        if (selectionResult.path?.data?.type === 'image-group') {
          const rawIds = (selectionResult.path.data as any)?.imageIds;
          const candidateIds = Array.isArray(rawIds) ? rawIds.filter((id) => typeof id === 'string') : [];
          if (candidateIds.length > 0) {
            const instanceMap = new Map((latestImageTool.imageInstances || []).map((img) => [img.id, img]));

            const dragIdSet = new Set<string>();
            // 组内图片
            candidateIds.forEach((id) => {
              if (instanceMap.has(id)) dragIdSet.add(id);
            });

            // 若组块本来就在选中集里，则把复合选择中其它图片/其它组块的图片也并入拖拽
            if (pathWasSelected) {
              (latestImageTool.selectedImageIds || []).forEach((id) => {
                if (typeof id === 'string' && instanceMap.has(id)) dragIdSet.add(id);
              });
              previouslySelectedPaths.forEach((path) => {
                if (path?.data?.type !== 'image-group') return;
                const raw = (path.data as any)?.imageIds;
                if (!Array.isArray(raw)) return;
                raw.forEach((id) => {
                  if (typeof id === 'string' && instanceMap.has(id)) dragIdSet.add(id);
                });
              });
            }

            const groupIds = Array.from(dragIdSet);
            // 🔥 修复：优先从 Paper.js 获取实际 bounds
            const boundsMap: Record<string, { x: number; y: number }> = {};
            groupIds.forEach((id) => {
              const paperBounds = getImagePaperBounds(id);
              if (paperBounds) {
                boundsMap[id] = { x: paperBounds.x, y: paperBounds.y };
              } else {
                const inst = instanceMap.get(id);
                if (inst) boundsMap[id] = { x: inst.bounds.x, y: inst.bounds.y };
              }
            });

            const firstId = groupIds[0];
            const first = firstId ? instanceMap.get(firstId) : null;
            // 🔥 修复：获取第一张图片的实际 bounds
            const firstPaperBounds = firstId ? getImagePaperBounds(firstId) : null;
            const actualFirstBounds = firstPaperBounds
              ? { x: firstPaperBounds.x, y: firstPaperBounds.y }
              : first?.bounds
                ? { x: first.bounds.x, y: first.bounds.y }
                : null;

            if (first && firstId && actualFirstBounds) {
              imageDragMovedRef.current = false;
              altDragCloneIdsRef.current = [];
              libraryHoveringRef.current = false;
              latestImageTool.setImageDragState({
                isImageDragging: true,
                dragImageId: firstId,
                imageDragStartPoint: point,
                imageDragStartBounds: { x: actualFirstBounds.x, y: actualFirstBounds.y },
                groupImageIds: groupIds,
                groupStartBounds: boundsMap,
              });
              // 初始化对齐吸附
              if (snapAlignmentRef.current?.startSnapping) {
                snapAlignmentRef.current.startSnapping(groupIds);
              }
              document.body.classList.add('tanva-canvas-dragging');
              if (pathWasSelected) {
                beginGroupPathDrag(point, 'image');
              }
              return;
            }
          }
        }

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
        // Alt 键按下时显示复制光标
        canvas.style.cursor = isAltPressedRef.current ? 'copy' : 'move';
        return;
      }
    }

    if (latestSelectionTool?.selectedPath && latestPathEditor) {
      const baseCursor = latestPathEditor.getCursorStyle(point, latestSelectionTool.selectedPath);

      // Alt 键按下时，鼠标在任意已选路径上显示复制光标（包含开放路径的 stroke 命中）
      if (isAltPressedRef.current && baseCursor !== 'crosshair') {
        try {
          const hit = paper.project.hitTest(point, {
            stroke: true,
            fill: true,
            bounds: true,
            tolerance: 6 / currentZoom,
          } as any);

          if (hit?.item) {
            let node: any = hit.item;
            for (let i = 0; i < 6 && node; i++) {
              if (node.selected || node.fullySelected) {
                canvas.style.cursor = 'copy';
                return;
              }
              node = node.parent;
            }
          }
        } catch {}

        // 兜底：若在当前 selectedPath 上显示 move，则改为 copy
        if (baseCursor === 'move') {
          canvas.style.cursor = 'copy';
          return;
        }
      }

      canvas.style.cursor = baseCursor;
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
    // Flow 拖拽/连线时，跳过 Canvas 侧的重计算（Paper hitTest / update 等），避免双系统同时处理 mousemove 导致掉帧。
    if (
      typeof document !== 'undefined' &&
      (document.body.classList.contains('tanva-flow-node-dragging') ||
        document.body.classList.contains('tanva-flow-connecting'))
    ) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    isAltPressedRef.current = event.altKey;

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
    if (currentDrawMode === 'select' || currentDrawMode === 'marquee') {
      const pathGroupDragState = groupPathDragRef.current;
      if (pathGroupDragState.active && pathGroupDragState.mode === 'path') {
        const altPressed = isAltPressedRef.current || event.altKey;
        updateLibraryDropHover(event.clientX, event.clientY, altPressed);
        applyGroupPathDrag(point, 'path', altPressed);
        try { paper.view.update(); } catch {}
        return;
      }
      // 处理路径编辑移动
      const pathEditResult = latestPathEditor.handlePathEditInteraction(
        point,
        latestSelectionTool.selectedPath,
        'mousemove',
        undefined,
        isAltPressedRef.current || event.altKey,
        undefined
      );
      if (pathEditResult) {
        const altPressed = isAltPressedRef.current || event.altKey;
        const isPathDragging = (pathEditResult as any)?.type === 'path-dragging' || latestPathEditor.isPathDragging;
        updateLibraryDropHover(event.clientX, event.clientY, altPressed && isPathDragging);
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
        const currentZoom = Math.max(zoomRef.current ?? 1, 0.0001);
        const threshold = DRAG_THRESHOLD / currentZoom;
        if (!imageDragMovedRef.current) {
          if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) {
            return;
          }
          imageDragMovedRef.current = true;

          // Alt+拖拽：显示占位框，原图保持不动
          if ((isAltPressedRef.current || event.altKey) && !altDragClonedRef.current) {
            altDragClonedRef.current = true;
            const groupIds = latestImageTool.imageDragState.groupImageIds?.length
              ? latestImageTool.imageDragState.groupImageIds
              : [latestImageTool.imageDragState.dragImageId];

            // 保存图片快照，用于松开时创建副本
            const snapshots: ImageAssetSnapshot[] = [];
            let totalBounds: paper.Rectangle | null = null;

            groupIds.forEach((imageId) => {
              const imageInstance = latestImageTool.imageInstances.find((img: any) => img.id === imageId);
              if (imageInstance) {
                const snapshot: ImageAssetSnapshot = {
                  id: imageInstance.id,
                  bounds: { ...imageInstance.bounds },
                  url: imageInstance.imageData?.url || '',
                  src: imageInstance.imageData?.src || '',
                  localDataUrl: imageInstance.imageData?.localDataUrl,
                  key: imageInstance.imageData?.key,
                  fileName: imageInstance.imageData?.fileName,
                  width: imageInstance.imageData?.width,
                  height: imageInstance.imageData?.height,
                  contentType: imageInstance.imageData?.contentType,
                  layerId: imageInstance.layerId ?? null,
                };
                snapshots.push(snapshot);

                // 计算总边界
                const imgBounds = new paper.Rectangle(
                  imageInstance.bounds.x,
                  imageInstance.bounds.y,
                  imageInstance.bounds.width,
                  imageInstance.bounds.height
                );
                if (!totalBounds) {
                  totalBounds = imgBounds;
                } else {
                  totalBounds = totalBounds.unite(imgBounds);
                }
              }
            });

            altDragSnapshotsRef.current = snapshots;

            // 创建占位框
            if (totalBounds && paper.project) {
              const bounds = totalBounds as unknown as paper.Rectangle;
              const boundsCenter = bounds.center;
              const placeholderGroup = new paper.Group();
              placeholderGroup.data = { type: 'alt-drag-placeholder', isHelper: true };

              // 占位框背景
              const placeholder = new paper.Path.Rectangle({
                rectangle: bounds,
                strokeColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.8),
                strokeWidth: 2 / (zoomRef.current || 1),
                dashArray: [6 / (zoomRef.current || 1), 4 / (zoomRef.current || 1)],
                fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.1),
              });
              placeholder.data = { isHelper: true };
              placeholderGroup.addChild(placeholder);

              // 图标背景圆
              const iconSize = Math.min(40, Math.min(bounds.width, bounds.height) * 0.3);
              const iconBg = new paper.Path.Circle({
                center: boundsCenter,
                radius: iconSize / 2,
                fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.9),
              });
              iconBg.data = { isHelper: true };
              placeholderGroup.addChild(iconBg);

              // 复制图标 (简化的两个重叠矩形)
              const iconScale = iconSize / 40;
              const rect1 = new paper.Path.Rectangle({
                point: [boundsCenter.x - 8 * iconScale, boundsCenter.y - 8 * iconScale],
                size: [12 * iconScale, 12 * iconScale],
                strokeColor: new paper.Color(1, 1, 1, 1),
                strokeWidth: 1.5 / (zoomRef.current || 1),
                fillColor: null,
              });
              rect1.data = { isHelper: true };
              placeholderGroup.addChild(rect1);

              const rect2 = new paper.Path.Rectangle({
                point: [boundsCenter.x - 4 * iconScale, boundsCenter.y - 4 * iconScale],
                size: [12 * iconScale, 12 * iconScale],
                strokeColor: new paper.Color(1, 1, 1, 1),
                strokeWidth: 1.5 / (zoomRef.current || 1),
                fillColor: new paper.Color(59 / 255, 130 / 255, 246 / 255, 0.9),
              });
              rect2.data = { isHelper: true };
              placeholderGroup.addChild(rect2);

              altDragPlaceholderRef.current = placeholderGroup;
              try { paper.view.update(); } catch {}
            }

            logger.debug('🔄 Alt+拖拽：显示占位框，原图保持不动');
          }
        }

        const groupIds = latestImageTool.imageDragState.groupImageIds?.length
          ? latestImageTool.imageDragState.groupImageIds
          : [latestImageTool.imageDragState.dragImageId];
        const groupStart = latestImageTool.imageDragState.groupStartBounds || {};

        // Alt+拖拽时检测是否在库区域，添加高亮效果
        if (isAltPressedRef.current || event.altKey) {
          const libraryDropZone = document.querySelector('[data-library-drop-zone="true"]');
          if (libraryDropZone) {
            const rect = libraryDropZone.getBoundingClientRect();
            const isOverLibrary =
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom;

            if (isOverLibrary) {
              libraryDropZone.classList.add('library-drop-highlight');
            } else {
              libraryDropZone.classList.remove('library-drop-highlight');
            }

            if (libraryHoveringRef.current !== isOverLibrary) {
              libraryHoveringRef.current = isOverLibrary;
              window.dispatchEvent(new CustomEvent('canvas:library-drag-hover', {
                detail: { hovering: isOverLibrary }
              }));
              const cloneIds = altDragCloneIdsRef.current;
              if (cloneIds.length && typeof latestImageTool.setImagesVisibility === 'function') {
                latestImageTool.setImagesVisibility(cloneIds, !isOverLibrary);
              }
            }
          } else if (libraryHoveringRef.current) {
            libraryHoveringRef.current = false;
            window.dispatchEvent(new CustomEvent('canvas:library-drag-hover', {
              detail: { hovering: false }
            }));
            const cloneIds = altDragCloneIdsRef.current;
            if (cloneIds.length && typeof latestImageTool.setImagesVisibility === 'function') {
              latestImageTool.setImagesVisibility(cloneIds, true);
            }
          }
        } else if (libraryHoveringRef.current) {
          libraryHoveringRef.current = false;
          const libraryDropZone = document.querySelector('[data-library-drop-zone="true"]');
          libraryDropZone?.classList.remove('library-drop-highlight');
          window.dispatchEvent(new CustomEvent('canvas:library-drag-hover', {
            detail: { hovering: false }
          }));
          const cloneIds = altDragCloneIdsRef.current;
          if (cloneIds.length && typeof latestImageTool.setImagesVisibility === 'function') {
            latestImageTool.setImagesVisibility(cloneIds, true);
          }
        }

        // 使用 RAF 同步图片位置更新，与画布平移保持同一帧
        if (imageDragRafRef.current) {
          cancelAnimationFrame(imageDragRafRef.current);
        }

        imageDragRafRef.current = requestAnimationFrame(() => {
          // Alt+拖拽模式：只移动占位框，不移动原图
          if (altDragPlaceholderRef.current && altDragClonedRef.current) {
            const placeholder = altDragPlaceholderRef.current;
            placeholder.position = new paper.Point(
              placeholder.position.x + deltaX - (placeholder.data.lastDeltaX || 0),
              placeholder.position.y + deltaY - (placeholder.data.lastDeltaY || 0)
            );
            placeholder.data.lastDeltaX = deltaX;
            placeholder.data.lastDeltaY = deltaY;
            try { paper.view.update(); } catch {}
            imageDragRafRef.current = null;
            return;
          }

          // 普通拖拽：移动原图（支持对齐吸附）
          const latestSnapAlignment = snapAlignmentRef.current;
          const isGroupDrag = groupIds.length > 1;

          // 计算组的整体边界（用于组拖拽时的对齐检测）
          let groupBounds: { x: number; y: number; width: number; height: number } | null = null;
          let snapDeltaX = 0;
          let snapDeltaY = 0;
          let groupAlignments: any[] = [];

          if (isGroupDrag && latestSnapAlignment?.snapEnabled) {
            // 计算组的整体边界
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            groupIds.forEach((id) => {
              const imageInstance = latestImageTool.imageInstances.find((img: any) => img.id === id);
              if (imageInstance) {
                const start = groupStart[id] || latestImageTool.imageDragState.imageDragStartBounds;
                if (start) {
                  const newX = start.x + deltaX;
                  const newY = start.y + deltaY;
                  minX = Math.min(minX, newX);
                  minY = Math.min(minY, newY);
                  maxX = Math.max(maxX, newX + imageInstance.bounds.width);
                  maxY = Math.max(maxY, newY + imageInstance.bounds.height);
                }
              }
            });

            if (minX !== Infinity) {
              groupBounds = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
              };

              // 对组的整体边界进行对齐检测
              const result = latestSnapAlignment.calculateSnappedPosition(
                `group-${groupIds[0]}`, // 使用虚拟 ID
                { x: groupBounds.x, y: groupBounds.y },
                { width: groupBounds.width, height: groupBounds.height }
              );

              // 计算吸附偏移量
              snapDeltaX = result.position.x - groupBounds.x;
              snapDeltaY = result.position.y - groupBounds.y;
              groupAlignments = result.alignments;
            }
          }

          // 移动所有图片
          const moves: Array<{ id: string; position: { x: number; y: number } }> = [];
          groupIds.forEach((id) => {
            const start = groupStart[id] || latestImageTool.imageDragState.imageDragStartBounds;
            if (!start) {
              return;
            }

            // 计算原始位置
            const rawPosition = {
              x: start.x + deltaX,
              y: start.y + deltaY,
            };

            let finalPosition = rawPosition;

            if (latestSnapAlignment?.snapEnabled) {
              if (isGroupDrag) {
                // 组拖拽：所有图片应用相同的吸附偏移量
                finalPosition = {
                  x: rawPosition.x + snapDeltaX,
                  y: rawPosition.y + snapDeltaY,
                };
              } else {
                // 单图拖拽：单独计算对齐
                const imageInstance = latestImageTool.imageInstances.find((img: any) => img.id === id);
                if (imageInstance) {
                  const result = latestSnapAlignment.calculateSnappedPosition(
                    id,
                    rawPosition,
                    { width: imageInstance.bounds.width, height: imageInstance.bounds.height }
                  );
                  finalPosition = result.position;
                  groupAlignments = result.alignments;
                }
              }
            }

            moves.push({ id, position: finalPosition });
          });

          if (moves.length > 0) {
            if (moves.length > 1 && typeof latestImageTool.handleImagesMove === 'function') {
              try { latestImageTool.handleImagesMove(moves, false); } catch {}
            } else {
              moves.forEach(({ id, position }) => {
                latestImageTool.handleImageMove(id, position, false);
              });
            }
          }

          // 更新对齐线显示
          if (latestSnapAlignment) {
            if (groupAlignments.length > 0) {
              latestSnapAlignment.updateAlignments(groupAlignments);
            } else {
              latestSnapAlignment.updateAlignments([]);
            }
          }

          applyGroupPathDrag(point, 'image');
          imageDragRafRef.current = null;
        });
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
      if (currentDrawMode === 'marquee' && canvas.style.cursor === 'default') {
        canvas.style.cursor = 'crosshair';
      }
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
    updateLibraryDropHover,
    updateCursorStyle,
    handleImageResize
  ]);

  // ========== 鼠标抬起事件处理 ==========
  const handleMouseUp = useCallback((event: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    isAltPressedRef.current = event.altKey;
    const currentDrawMode = drawModeRef.current;
    const latestSelectionTool = selectionToolRef.current;

    // 安全机制：如果框选状态异常，确保清理 CSS 类
    if (!latestSelectionTool?.isSelectionDragging && document.body.classList.contains('tanva-selection-dragging')) {
      document.body.classList.remove('tanva-selection-dragging');
      logger.debug('🔲 清理异常的框选状态');
    }
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
    if (currentDrawMode === 'select' || currentDrawMode === 'marquee') {
      // 处理路径编辑结束
      const isAltPressed = isAltPressedRef.current || event.altKey;
      const droppedToLibrary =
        isAltPressed &&
        (() => {
          const libraryDropZone = document.querySelector('[data-library-drop-zone="true"]');
          if (!libraryDropZone) return false;
          const rect = libraryDropZone.getBoundingClientRect();
          return (
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
          );
        })();
      const pathEditResult = latestPathEditor.handlePathEditInteraction(
        clientToProject(canvas, event.clientX, event.clientY),
        latestSelectionTool.selectedPath,
        'mouseup',
        undefined,
        isAltPressed,
        droppedToLibrary
      );
      if (pathEditResult) {
        clearLibraryDropHover();
        const moved = !!(pathEditResult as any)?.moved;
        const action = (pathEditResult as any)?.action as 'move' | 'clone' | 'none' | 'library' | undefined;
        if (moved) {
          try { paper.view.update(); } catch {}
          if (action === 'clone') {
            historyService.commit('clone-paths').catch(() => {});
            try { paperSaveService.triggerAutoSave('clone-paths'); } catch {}
          } else if (action === 'move') {
            historyService.commit('move-paths').catch(() => {});
          } else if (action === 'library') {
            window.dispatchEvent(new CustomEvent('canvas:add-selected-paths-to-library'));
          } else if ((pathEditResult as any)?.type === 'segment-drag-end') {
            historyService.commit('edit-path').catch(() => {});
          }
        }
        return;
      }

      const pathGroupDragState = groupPathDragRef.current;
      if (pathGroupDragState.active && pathGroupDragState.mode === 'path') {
        const moved = pathGroupDragState.hasMoved;
        const wasPathAltClone = pathAltDragClonedRef.current;
        const droppedToLibrary =
          wasPathAltClone &&
          (() => {
            const libraryDropZone = document.querySelector('[data-library-drop-zone="true"]');
            if (!libraryDropZone) return false;
            const rect = libraryDropZone.getBoundingClientRect();
            return (
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom
            );
          })();
        clearLibraryDropHover();

        // Alt+拖拽路径复制：在目标位置创建副本
        if (wasPathAltClone && moved && pathAltDragPlaceholderRef.current && pathAltDragSnapshotsRef.current.length > 0) {
          const placeholder = pathAltDragPlaceholderRef.current;
          const clonedPaths = pathAltDragSnapshotsRef.current;

          // 计算位移量
          const deltaX = placeholder.data.lastDeltaX || 0;
          const deltaY = placeholder.data.lastDeltaY || 0;

          // 拖拽到库：触发加入个人库（导出为 SVG），不在画布创建副本
          if (droppedToLibrary) {
            window.dispatchEvent(new CustomEvent('canvas:add-selected-paths-to-library'));
            logger.debug('📚 Alt+拖拽路径：已触发添加到个人库');

            // 清理占位框
            try { placeholder.remove(); } catch {}
            pathAltDragPlaceholderRef.current = null;
            pathAltDragSnapshotsRef.current = [];
            pathAltDragClonedRef.current = false;

            // 重置拖拽状态
            groupPathDragRef.current = {
              active: false,
              mode: null,
              startPoint: null,
              paths: [],
              groupBlocks: [],
              hasMoved: false
            };
            try { paper.view.update(); } catch {}
            return;
          }

          // 在目标位置创建路径副本
          clonedPaths.forEach((clonedPath) => {
            // 移动克隆的路径到目标位置
            clonedPath.position = new paper.Point(
              clonedPath.position.x + deltaX,
              clonedPath.position.y + deltaY
            );
            // 插入到画布
            if (paper.project.activeLayer) {
              paper.project.activeLayer.addChild(clonedPath);
            }
          });

          logger.debug('🔄 Alt+拖拽路径：已在目标位置创建副本');

          // 清理占位框
          try { placeholder.remove(); } catch {}
          pathAltDragPlaceholderRef.current = null;
          pathAltDragSnapshotsRef.current = [];
          pathAltDragClonedRef.current = false;

          // 重置拖拽状态
          groupPathDragRef.current = {
            active: false,
            mode: null,
            startPoint: null,
            paths: [],
            groupBlocks: [],
            hasMoved: false
          };

          try { paper.view.update(); } catch {}
          historyService.commit('clone-paths').catch(() => {});
          try { paperSaveService.triggerAutoSave('clone-paths'); } catch {}
          return;
        }

        resetGroupPathDrag();
        clearLibraryDropHover();
        if (moved) {
          try { paper.view.update(); } catch {}
          historyService.commit('move-paths').catch(() => {});
        }
        return;
      }

      // 处理图像拖拽结束
      if (latestImageTool.imageDragState.isImageDragging) {
        // 清理未完成的 RAF
        if (imageDragRafRef.current) {
          cancelAnimationFrame(imageDragRafRef.current);
          imageDragRafRef.current = null;
        }
        const didMove = imageDragMovedRef.current;
        const wasAltClone = altDragClonedRef.current;
        const wasAltDrag = isAltPressedRef.current || event.altKey;
        imageDragMovedRef.current = false;
        altDragClonedRef.current = false; // 重置 Alt 拖拽克隆标记

        // Alt+拖拽复制：在目标位置创建副本
        if (wasAltClone && didMove && altDragPlaceholderRef.current && altDragSnapshotsRef.current.length > 0) {
          const placeholder = altDragPlaceholderRef.current;
          const snapshots = altDragSnapshotsRef.current;

          // 计算位移量
          const deltaX = placeholder.data.lastDeltaX || 0;
          const deltaY = placeholder.data.lastDeltaY || 0;

          // 检测是否拖拽到库区域
          const libraryDropZone = document.querySelector('[data-library-drop-zone="true"]');
          let droppedToLibrary = false;
          if (libraryDropZone) {
            libraryDropZone.classList.remove('library-drop-highlight');
            const rect = libraryDropZone.getBoundingClientRect();
            if (
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom
            ) {
              droppedToLibrary = true;
              // 添加到库
              snapshots.forEach((snapshot) => {
                window.dispatchEvent(new CustomEvent('canvas:add-to-library', {
                  detail: {
                    type: '2d',
                    url: snapshot.url || snapshot.src,
                    name: snapshot.fileName || '画布图片',
                    fileName: snapshot.fileName,
                    width: snapshot.width,
                    height: snapshot.height,
                    contentType: snapshot.contentType,
                  }
                }));
              });
              logger.debug('📚 Alt+拖拽：已将图片添加到个人库');
            }
          }

          // 如果没有拖到库，则在目标位置创建副本
          const createImageFromSnapshot = latestImageTool.createImageFromSnapshot;
          if (!droppedToLibrary && typeof createImageFromSnapshot === 'function') {
            snapshots.forEach((snapshot) => {
              const newSnapshot = {
                ...snapshot,
                bounds: {
                  x: snapshot.bounds.x + deltaX,
                  y: snapshot.bounds.y + deltaY,
                  width: snapshot.bounds.width,
                  height: snapshot.bounds.height,
                },
              };
              createImageFromSnapshot(newSnapshot, { offset: { x: 0, y: 0 } });
            });
            logger.debug('🔄 Alt+拖拽：已在目标位置创建副本');
          }

          // 清理占位框
          try { placeholder.remove(); } catch {}
          altDragPlaceholderRef.current = null;
          altDragSnapshotsRef.current = [];

          // 清理状态并提交历史
          latestImageTool.setImageDragState({
            isImageDragging: false,
            dragImageId: null,
            imageDragStartPoint: null,
            imageDragStartBounds: null,
            groupImageIds: undefined,
            groupStartBounds: undefined,
          });
          document.body.classList.remove('tanva-canvas-dragging');
          resetGroupPathDrag();

          if (!droppedToLibrary) {
            historyService.commit('clone-image').catch(() => {});
            try { paperSaveService.triggerAutoSave('clone-image'); } catch {}
          }
          try { paper.view.update(); } catch {}
          return;
        }

        // 清理占位框（如果存在但没有移动）
        if (altDragPlaceholderRef.current) {
          try { altDragPlaceholderRef.current.remove(); } catch {}
          altDragPlaceholderRef.current = null;
          altDragSnapshotsRef.current = [];
        }

        // Alt+拖拽到库：检测鼠标是否在库面板区域
        if (wasAltDrag && didMove) {
          const libraryDropZone = document.querySelector('[data-library-drop-zone="true"]');
          if (libraryDropZone) {
            // 清除高亮效果
            libraryDropZone.classList.remove('library-drop-highlight');

            const rect = libraryDropZone.getBoundingClientRect();
            if (
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom
            ) {
              // 拖拽到库区域，添加资源到个人库
              const groupIds = latestImageTool.imageDragState.groupImageIds?.length
                ? latestImageTool.imageDragState.groupImageIds
                : [latestImageTool.imageDragState.dragImageId];

              groupIds.forEach((imageId) => {
                const imageInstance = latestImageTool.imageInstances.find((img: any) => img.id === imageId);
                if (imageInstance?.imageData?.url) {
                  // 通过自定义事件通知库面板添加资源
                  window.dispatchEvent(new CustomEvent('canvas:add-to-library', {
                    detail: {
                      type: '2d',
                      url: imageInstance.imageData.url,
                      name: imageInstance.imageData.fileName || '画布图片',
                      fileName: imageInstance.imageData.fileName,
                      width: imageInstance.imageData.width,
                      height: imageInstance.imageData.height,
                      contentType: imageInstance.imageData.contentType,
                    }
                  }));
                }
              });

              logger.debug('📚 Alt+拖拽：已将图片添加到个人库');
            }
          }
        }

        // 清理库悬停状态并恢复克隆可见性
        if (libraryHoveringRef.current) {
          window.dispatchEvent(new CustomEvent('canvas:library-drag-hover', {
            detail: { hovering: false }
          }));
        }
        libraryHoveringRef.current = false;
        const altCloneIds = altDragCloneIdsRef.current;
        if (altCloneIds.length && typeof latestImageTool.setImagesVisibility === 'function') {
          latestImageTool.setImagesVisibility(altCloneIds, true);
        }
        altDragCloneIdsRef.current = [];

        latestImageTool.setImageDragState({
          isImageDragging: false,
          dragImageId: null,
          imageDragStartPoint: null,
          imageDragStartBounds: null,
          groupImageIds: undefined,
          groupStartBounds: undefined,
        });
        // 清除对齐参考线
        if (snapAlignmentRef.current?.clearAlignments) {
          snapAlignmentRef.current.clearAlignments();
        }
        // 移除拖拽时禁用 Flow 节点事件的 CSS 类
        document.body.classList.remove('tanva-canvas-dragging');
        resetGroupPathDrag();
        if (didMove) {
          historyService.commit(wasAltClone ? 'clone-image' : 'move-image').catch(() => {});
          // 移动图片不触发自动保存，仅记录历史
        }
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
        // 调整图片大小不触发自动保存，仅记录历史
        document.body.classList.remove('tanva-canvas-dragging');
        return;
      }

      // 处理选择框完成
      if (latestSelectionTool.isSelectionDragging) {
        const point = clientToProject(canvas, event.clientX, event.clientY);
        if (currentDrawMode === 'marquee') {
          latestSelectionTool.finishSelectionBox(point, { selectFlowNodes: false });
        } else {
          latestSelectionTool.finishSelectionBox(point);
        }
        // 移除框选时禁用 Flow 节点事件的 CSS 类
        document.body.classList.remove('tanva-selection-dragging');
        logger.debug('🔲 框选结束，恢复 Flow 节点事件');
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
      isAltPressedRef.current = event.altKey;
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

      // Ctrl+A / Cmd+A 全选（仅复合选择模式）
      if (!isEditable && currentDrawMode === 'select') {
        const key = event.key?.toLowerCase?.() || '';
        if (key === 'a' && (event.ctrlKey || event.metaKey)) {
          if (typeof latestSelectionTool?.selectAll === 'function') {
            latestSelectionTool.selectAll();
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }
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
        // 记录通过删除组块而删除的图片ID，避免重复删除
        const deletedImageIdsFromGroup = new Set<string>();

        // 删除路径（单选与多选），含占位符组和图片组块
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

          // 检查是否为图片组块
          const isImageGroupBlock = (path: paper.Path | null | undefined): boolean => {
            return path?.data?.type === IMAGE_GROUP_BLOCK_TYPE;
          };

          // 删除单个路径的处理函数
          const deletePath = (p: paper.Path) => {
            // 检查是否为图片组块，如果是则删除整个组（包括图片）
            if (isImageGroupBlock(p)) {
              const raw = (p.data as any)?.imageIds;
              const blocked = Array.isArray(raw)
                ? raw.some((id) => typeof id === 'string' && isPendingUploadImage(id))
                : false;
              if (blocked) {
                return;
              }
              const deletedIds = deleteImageGroupBlock(p);
              deletedIds.forEach(id => deletedImageIdsFromGroup.add(id));
              if (deletedIds.length > 0 || p.data?.groupId) {
                didDelete = true;
              }
              return;
            }

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
            } else if (!ph) {
              try { p.remove(); didDelete = true; } catch {}
            }
          };

          if (selectedPath) {
            deletePath(selectedPath);
            try { (latestSelectionTool as any)?.setSelectedPath?.(null); } catch {}
          }
          if (Array.isArray(selectedPaths) && selectedPaths.length > 0) {
            selectedPaths.forEach(p => deletePath(p));
            try { (latestSelectionTool as any)?.setSelectedPaths?.([]); } catch {}
          }
        } catch {}

        // 删除组块后，需要同步清理图片工具状态（实例列表、选中态、AI 对话框源图等）
        // 仅删除 Paper.js 对象会导致“图片看起来消失，但仍被选中”的状态残留。
        try {
          if (
            deletedImageIdsFromGroup.size > 0 &&
            typeof latestImageTool?.handleImageDelete === 'function'
          ) {
            deletedImageIdsFromGroup.forEach((id) => {
              if (isPendingUploadImage(id)) return;
              try {
                latestImageTool.handleImageDelete?.(id);
                didDelete = true;
              } catch {}
            });
          }
        } catch {}

        // 删除图片（按选中ID或状态），跳过已通过组块删除的图片
        try {
          const ids = (latestImageTool?.selectedImageIds && latestImageTool.selectedImageIds.length > 0)
            ? latestImageTool.selectedImageIds
            : (latestImageTool?.imageInstances || []).filter((img: any) => img.isSelected).map((img: any) => img.id);
          if (ids && ids.length > 0 && typeof latestImageTool?.handleImageDelete === 'function') {
            ids.forEach((id: string) => {
              // 跳过已通过删除组块而删除的图片
              if (deletedImageIdsFromGroup.has(id)) return;
              if (isPendingUploadImage(id)) return;
              try { latestImageTool.handleImageDelete?.(id); didDelete = true; } catch {}
            });
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
      isAltPressedRef.current = event.altKey;
      if (event.code === 'Space' || event.key === ' ') {
        isSpacePressedRef.current = false;
        stopSpacePan();
      }
    };

    // 双击事件处理
    const handleDoubleClick = (event: MouseEvent) => {
      const latestImageTool = imageToolRef.current;

      // 🔥 修复：如果正在拖拽图片或刚刚完成拖拽，忽略双击事件
      // 这可以防止拖拽过程中意外触发双击打开全屏预览
      if (latestImageTool?.imageDragState?.isImageDragging || imageDragMovedRef.current) {
        logger.debug('🚫 拖拽中，忽略双击事件');
        return;
      }

      const point = clientToProject(canvas, event.clientX, event.clientY);

      const currentDrawMode = drawModeRef.current;
      const latestSimpleTextTool = simpleTextToolRef.current;

      // 检查是否双击了组块标题（用于编辑标题）
      const tryEditGroupBlockTitle = () => {
        try {
          const hit = paper.project.hitTest(point, {
            fill: true,
            stroke: true,
            tolerance: 6,
          } as any);
          if (hit?.item) {
            // 检查是否点击了标题文本
            if (hit.item.data?.type === 'image-group-title') {
              const groupId = hit.item.data.groupId;
              const titleText = hit.item as paper.PointText;
              const currentTitle = titleText.content || '';

              // 创建输入框进行编辑
              const inputEl = document.createElement('input');
              inputEl.type = 'text';
              inputEl.value = currentTitle;
              inputEl.style.cssText = `
                position: fixed;
                font-size: 14px;
                font-family: system-ui, -apple-system, sans-serif;
                font-weight: 500;
                padding: 4px 8px;
                border: 2px solid #3b82f6;
                border-radius: 4px;
                outline: none;
                background: white;
                min-width: 150px;
                z-index: 10000;
              `;

              // 计算输入框位置（将 Paper.js 坐标转换为屏幕坐标）
              const viewPoint = paper.view.projectToView(titleText.point);
              const canvasRect = canvas.getBoundingClientRect();
              const dpr = window.devicePixelRatio || 1;
              inputEl.style.left = `${canvasRect.left + viewPoint.x / dpr}px`;
              inputEl.style.top = `${canvasRect.top + viewPoint.y / dpr - 24}px`;

              document.body.appendChild(inputEl);
              inputEl.focus();
              inputEl.select();

              const finishEdit = (save: boolean) => {
                if (save && inputEl.value.trim()) {
                  updateGroupBlockTitle(groupId, inputEl.value.trim());
                  try { paper.view.update(); } catch {}
                  historyService.commit('edit-group-title').catch(() => {});
                  try { paperSaveService.triggerAutoSave('edit-group-title'); } catch {}
                }
                inputEl.remove();
              };

              inputEl.addEventListener('blur', () => finishEdit(true));
              inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  finishEdit(true);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  finishEdit(false);
                }
              });

              event.preventDefault();
              event.stopPropagation();
              return true;
            }

            // 检查是否点击了组块本身（也可以编辑标题）
            let current: any = hit.item;
            while (current) {
              if (current.data?.type === IMAGE_GROUP_BLOCK_TYPE) {
                const groupId = current.data.groupId;
                const titleText = findGroupBlockTitle(groupId);
                if (titleText) {
                  const currentTitle = titleText.content || '';

                  // 创建输入框进行编辑
                  const inputEl = document.createElement('input');
                  inputEl.type = 'text';
                  inputEl.value = currentTitle;
                  inputEl.style.cssText = `
                    position: fixed;
                    font-size: 14px;
                    font-family: system-ui, -apple-system, sans-serif;
                    font-weight: 500;
                    padding: 4px 8px;
                    border: 2px solid #3b82f6;
                    border-radius: 4px;
                    outline: none;
                    background: white;
                    min-width: 150px;
                    z-index: 10000;
                  `;

                  // 计算输入框位置
                  const viewPoint = paper.view.projectToView(titleText.point);
                  const canvasRect = canvas.getBoundingClientRect();
                  const dpr = window.devicePixelRatio || 1;
                  inputEl.style.left = `${canvasRect.left + viewPoint.x / dpr}px`;
                  inputEl.style.top = `${canvasRect.top + viewPoint.y / dpr - 24}px`;

                  document.body.appendChild(inputEl);
                  inputEl.focus();
                  inputEl.select();

                  const finishEdit = (save: boolean) => {
                    if (save && inputEl.value.trim()) {
                      updateGroupBlockTitle(groupId, inputEl.value.trim());
                      try { paper.view.update(); } catch {}
                      historyService.commit('edit-group-title').catch(() => {});
                      try { paperSaveService.triggerAutoSave('edit-group-title'); } catch {}
                    }
                    inputEl.remove();
                  };

                  inputEl.addEventListener('blur', () => finishEdit(true));
                  inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      finishEdit(true);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      finishEdit(false);
                    }
                  });

                  event.preventDefault();
                  event.stopPropagation();
                  return true;
                }
              }
              current = current.parent;
            }
          }
        } catch (err) {
          console.warn('hitTest group title on dblclick failed', err);
        }
        return false;
      };

      // 先检查是否双击了组块标题
      if (tryEditGroupBlockTitle()) return;

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
    const resetModifierKeys = () => {
      isAltPressedRef.current = false;
      isSpacePressedRef.current = false;
      stopSpacePan();
    };
    const handleWindowBlur = () => resetModifierKeys();
    const handleVisibilityChange = () => {
      if (document.hidden) resetModifierKeys();
    };
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove, { capture: true });
      window.removeEventListener('mouseup', handleMouseUp, { capture: true });
      window.removeEventListener('mouseleave', handleMouseUp, { capture: true });
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
