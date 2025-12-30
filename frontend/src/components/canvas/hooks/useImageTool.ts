/**
 * 2D图片工具Hook
 * 处理图片上传、占位框创建、图片实例管理、选择、移动和调整大小等功能
 */

import { useCallback, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import { historyService } from '@/services/historyService';
import { paperSaveService } from '@/services/paperSaveService';
import { isGroup, isRaster } from '@/utils/paperCoords';
import { syncImageGroupBlocksForImageIds, findImagePaperItem } from '@/utils/paperImageGroupBlock';
import type {
  ImageInstance,
  ImageDragState,
  ImageResizeState,
  ImageToolEventHandlers,
  DrawingContext,
  StoredImageAsset,
} from '@/types/canvas';
import type { ImageAssetSnapshot } from '@/types/project';
import { useLayerStore } from '@/stores/layerStore';

interface UseImageToolProps {
  context: DrawingContext;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  eventHandlers?: ImageToolEventHandlers;
}

export const useImageTool = ({ context, canvasRef, eventHandlers = {} }: UseImageToolProps) => {
  const { ensureDrawingLayer, zoom } = context;

  // 图片相关状态
  const [triggerImageUpload, setTriggerImageUpload] = useState(false);
  const currentPlaceholderRef = useRef<paper.Group | null>(null);
  const [imageInstances, setImageInstances] = useState<ImageInstance[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);  // 支持多选
  const [selectedPlaceholderId, setSelectedPlaceholderId] = useState<string | null>(null);  // 占位框选中状态
  const placeholdersRef = useRef<Map<string, paper.Group>>(new Map());  // 存储所有占位框

  // 图片拖拽状态
  const [imageDragState, setImageDragState] = useState<ImageDragState>({
    isImageDragging: false,
    dragImageId: null,
    imageDragStartPoint: null,
    imageDragStartBounds: null,
    groupImageIds: undefined,
    groupStartBounds: undefined,
  });

  // 图片调整大小状态
  const [imageResizeState, setImageResizeState] = useState<ImageResizeState>({
    isImageResizing: false,
    resizeImageId: null,
    resizeDirection: null,
    resizeStartBounds: null,
    resizeStartPoint: null,
  });

  // ========== 创建图片占位框 ==========
  const createImagePlaceholder = useCallback((startPoint: paper.Point, endPoint: paper.Point) => {
    ensureDrawingLayer();

    // 计算占位框矩形
    const rect = new paper.Rectangle(startPoint, endPoint);
    const center = rect.center;
    const width = Math.abs(rect.width);
    const height = Math.abs(rect.height);

    // 最小尺寸限制
    const minSize = 50;
    const finalWidth = Math.max(width, minSize);
    const finalHeight = Math.max(height, minSize);

    // 创建占位框边框（虚线矩形）
    const placeholder = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(center.subtract([finalWidth / 2, finalHeight / 2]), [finalWidth, finalHeight]),
      strokeColor: new paper.Color('#60a5fa'), // 更柔和的蓝色边框
      strokeWidth: 1,
      dashArray: [8, 6],
      fillColor: new paper.Color(0.94, 0.97, 1, 0.8) // 淡蓝色半透明背景
    });

    // 创建上传按钮背景（圆角矩形）
    const buttonSize = Math.min(finalWidth * 0.5, finalHeight * 0.25, 120);
    const buttonHeight = Math.min(40, finalHeight * 0.2);

    // 创建按钮背景
    const buttonBg = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(center.subtract([buttonSize / 2, buttonHeight / 2]), [buttonSize, buttonHeight]),
      fillColor: new paper.Color('#3b82f6'), // 更现代的蓝色
      strokeColor: new paper.Color('#2563eb'), // 深蓝色边框
      strokeWidth: 1
    });

    // 创建"+"图标（更粗更圆润）
    const iconSize = Math.min(14, buttonHeight * 0.35);
    const hLine = new paper.Path.Line({
      from: center.subtract([iconSize / 2, 0]),
      to: center.add([iconSize / 2, 0]),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 3,
      strokeCap: 'round'
    });
    const vLine = new paper.Path.Line({
      from: center.subtract([0, iconSize / 2]),
      to: center.add([0, iconSize / 2]),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 3,
      strokeCap: 'round'
    });

    // 上传按钮组合，单独承载点击事件
    const buttonGroup = new paper.Group([buttonBg, hLine, vLine]);
    buttonGroup.data = {
      uploadHotspotType: 'image'
    };

    // 创建提示文字 - 调整位置，在按钮下方留出适当间距
    const textY = Math.round(center.y + buttonHeight / 2 + 20); // 对齐到像素边界
    const fontSize = Math.round(Math.min(14, finalWidth * 0.06, finalHeight * 0.08)); // 确保字体大小为整数
    const text = new paper.PointText({
      point: new paper.Point(Math.round(center.x), textY),
      content: '点击上传图片',
      fontSize: fontSize,
      fillColor: new paper.Color('#1e40af'), // 深蓝色文字，与按钮呼应
      justification: 'center'
    });

    // 生成唯一ID
    const placeholderId = `image-placeholder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 创建组合
    const group = new paper.Group([placeholder, buttonGroup, text]);
    group.data = {
      type: 'image-placeholder',
      placeholderId: placeholderId,
      bounds: { x: center.x - finalWidth / 2, y: center.y - finalHeight / 2, width: finalWidth, height: finalHeight },
      isHelper: true,  // 标记为辅助元素，不显示在图层列表中
      placeholderMinSize: minSize
    };
    const attachPlaceholderMeta = (item: any) => {
      if (item) {
        // 🔥 使用 placeholderGroupId 而不是直接引用，避免循环引用导致序列化失败
        item.data = { ...(item.data || {}), placeholderGroupId: placeholderId, placeholderType: 'image', isHelper: true };
      }
    };
    [placeholder, buttonGroup, buttonBg, hLine, vLine, text].forEach(attachPlaceholderMeta);

    // 仅按钮区域触发上传
    const triggerUpload = () => {
      logger.upload('📸 点击图片上传按钮，触发上传');
      currentPlaceholderRef.current = group;
      setTriggerImageUpload(true);
    };
    buttonGroup.onClick = triggerUpload;

    // 点击占位框（非按钮区域）选中占位框
    placeholder.onClick = () => {
      setSelectedPlaceholderId(placeholderId);
      // 更新选中样式
      placeholder.strokeColor = new paper.Color('#2563eb');
      placeholder.strokeWidth = 2;
    };

    // 存储占位框引用
    placeholdersRef.current.set(placeholderId, group);

    return group;
  }, [ensureDrawingLayer]);

  // ========== 处理图片上传成功 ==========
  const handleImageUploaded = useCallback((
    asset: StoredImageAsset,
    options?: { suppressAutoSave?: boolean; autoSaveReason?: string }
  ) => {
    const placeholder = currentPlaceholderRef.current;
    if (!placeholder || !placeholder.data?.bounds) {
      logger.error('没有找到图片占位框');
      return;
    }

    if (!asset || !asset.url) {
      logger.error('无有效图片资源');
      return;
    }

    const suppressAutoSave = Boolean(options?.suppressAutoSave);
    const autoSaveReason = options?.autoSaveReason || 'image-uploaded';

    logger.upload('✅ 图片上传成功，创建图片实例');

    const paperBounds = placeholder.data.bounds;
    const imageId = asset.id || `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.upload('📍 图片使用Paper.js坐标:', paperBounds);

    // 在Paper.js中创建图片的代表组
    ensureDrawingLayer();

    // 创建Paper.js的Raster对象来显示图片
    const raster = new paper.Raster();
    (raster as any).crossOrigin = 'anonymous';

    // 等待图片加载完成后设置位置
    raster.onLoad = () => {
      // 🔥 若 Raster source 被切换（dataURL → OSS URL 等）会再次触发 onLoad：
      // 避免重复创建选择元素/触发状态更新，导致命中/拖拽异常与闪烁
      const alreadyInitialized = Boolean((raster as any)?.data?.__tanvaImageInitialized);
      if (alreadyInitialized) {
        const stored = (raster as any)?.data?.__tanvaBounds as
          | { x: number; y: number; width: number; height: number }
          | undefined;
        if (
          stored &&
          Number.isFinite(stored.x) &&
          Number.isFinite(stored.y) &&
          Number.isFinite(stored.width) &&
          Number.isFinite(stored.height) &&
          stored.width > 0 &&
          stored.height > 0
        ) {
          const rect = new paper.Rectangle(stored.x, stored.y, stored.width, stored.height);
          try { raster.bounds = rect.clone(); } catch {}
          try {
            const parent: any = raster.parent;
            if (parent && parent.className === 'Group' && Array.isArray(parent.children)) {
              parent.children.forEach((child: any) => {
                if (!child || child === raster) return;
                const data = child.data || {};
                if (data.type === 'image-selection-area' || data.isSelectionBorder || data.isImageHitRect) {
                  try { child.bounds = rect.clone(); } catch {}
                  return;
                }
                if (data.isResizeHandle) {
                  const direction = data.direction;
                  let x = rect.x;
                  let y = rect.y;
                  if (direction === 'ne' || direction === 'se') x = rect.x + rect.width;
                  if (direction === 'sw' || direction === 'se') y = rect.y + rect.height;
                  try { child.position = new paper.Point(x, y); } catch {}
                }
              });
            }
          } catch {}
        }
        try { paper.view.update(); } catch {}
        return;
      }

      // 存储原始尺寸信息
      const originalWidth = raster.width;
      const originalHeight = raster.height;
      const aspectRatio = originalWidth / originalHeight;

      raster.data = {
        ...(raster.data || {}),
        type: 'image',
        imageId,
        originalWidth,
        originalHeight,
        aspectRatio
      };

      // 检查是否启用原始尺寸模式
      const useOriginalSize = localStorage.getItem('tanva-use-original-size') === 'true';
      let finalBounds;

      if (useOriginalSize) {
        // 原始尺寸模式：使用图片的真实像素尺寸，以占位框中心为基准
        const centerX = paperBounds.x + paperBounds.width / 2;
        const centerY = paperBounds.y + paperBounds.height / 2;

        finalBounds = new paper.Rectangle(
          centerX - originalWidth / 2,
          centerY - originalHeight / 2,
          originalWidth,
          originalHeight
        );
      } else {
        // 标准模式：根据占位框和图片比例，计算保持比例的实际大小
        const boxAspectRatio = paperBounds.width / paperBounds.height;

        if (aspectRatio > boxAspectRatio) {
          // 图片更宽，以宽度为准
          const newWidth = paperBounds.width;
          const newHeight = newWidth / aspectRatio;
          const yOffset = (paperBounds.height - newHeight) / 2;

          finalBounds = new paper.Rectangle(
            paperBounds.x,
            paperBounds.y + yOffset,
            newWidth,
            newHeight
          );
        } else {
          // 图片更高，以高度为准
          const newHeight = paperBounds.height;
          const newWidth = newHeight * aspectRatio;
          const xOffset = (paperBounds.width - newWidth) / 2;

          finalBounds = new paper.Rectangle(
            paperBounds.x + xOffset,
            paperBounds.y,
            newWidth,
            newHeight
          );
        }
      }

      // 设置图片边界（保持比例）
      raster.bounds = finalBounds;

      // 添加选择框和控制点
      addImageSelectionElements(raster, finalBounds, imageId);

      // 更新React状态中的bounds为实际尺寸
      setImageInstances(prev => prev.map(img =>
        img.id === imageId ? {
          ...img,
          bounds: {
            x: finalBounds.x,
            y: finalBounds.y,
            width: finalBounds.width,
            height: finalBounds.height
          },
          imageData: {
            ...img.imageData,
            url: asset.url,
            src: asset.url,
            key: asset.key || img.imageData.key,
            fileName: asset.fileName || img.imageData.fileName,
            width: originalWidth,
            height: originalHeight,
            contentType: asset.contentType || img.imageData.contentType,
            pendingUpload: asset.pendingUpload,
            localDataUrl: asset.localDataUrl,
          }
        } : img
      ));

      if (!suppressAutoSave) {
        try { paperSaveService.triggerAutoSave('image-loaded'); } catch {}
      }

      // 标记初始化完成并缓存 bounds，防止后续 source 切换重复初始化/命中异常
      try {
        if (!raster.data) raster.data = {};
        (raster.data as any).__tanvaImageInitialized = true;
        (raster.data as any).__tanvaBounds = {
          x: finalBounds.x,
          y: finalBounds.y,
          width: finalBounds.width,
          height: finalBounds.height
        };
      } catch {}

      paper.view.update();
    };

    raster.onError = (error: unknown) => {
      logger.error('图片加载失败', error);
    };

    // 在监听器绑定后再设置资源，确保跨域标记和回调生效
    raster.source = asset.url;

    // 创建Paper.js组来包含所有相关元素（仅包含Raster，避免“隐形框”扩大边界）
    const imageGroup = new paper.Group([raster]);
    imageGroup.data = {
      type: 'image',
      imageId: imageId,
      isHelper: false
    };

    // 创建图片实例
    const newImageInstance: ImageInstance = {
      id: imageId,
      imageData: {
        id: imageId,
        url: asset.url,
        src: asset.url,
        key: asset.key,
        fileName: asset.fileName,
        width: asset.width,
        height: asset.height,
        contentType: asset.contentType,
        pendingUpload: asset.pendingUpload,
        localDataUrl: asset.localDataUrl,
      },
      bounds: {
        x: paperBounds.x,
        y: paperBounds.y,
        width: paperBounds.width,
        height: paperBounds.height
      },
      isSelected: false,  // 默认不选中，避免显示选择框
      visible: true,
      layerId: paper.project.activeLayer.name
    };

    setImageInstances(prev => [...prev, newImageInstance]);
    // 不默认选中，让用户需要时再点击选择
    // setSelectedImageId(imageId);
    // eventHandlers.onImageSelect?.(imageId);

    // 清理占位框
    placeholder.remove();
    currentPlaceholderRef.current = null;

    logger.upload('🖼️ 图片实例创建完成:', imageId);
    if (!suppressAutoSave) {
      try { paperSaveService.triggerAutoSave(autoSaveReason); } catch {}
    }
  }, [ensureDrawingLayer, eventHandlers.onImageSelect]);

  // ========== 添加图片选择元素 ==========
  const addImageSelectionElements = useCallback((raster: paper.Raster, bounds: paper.Rectangle, imageId: string) => {
    const parentGroup = raster.parent;
    if (!isGroup(parentGroup)) return;

    // 清理旧的选择元素，避免重复（例如 Raster source 被切换导致 onLoad 再次触发）
    try {
      const children = [...(parentGroup.children || [])];
      children.forEach((child) => {
        const data = child?.data || {};
        if (data.isSelectionBorder || data.isResizeHandle || data.type === 'image-selection-area') {
          try { child.remove(); } catch {}
        }
      });
    } catch {}

    // 添加选择区域（透明点击热区），避免 Raster hitTest/异步加载导致点击命中不稳定
    const selectionArea = new paper.Path.Rectangle({
      rectangle: bounds,
      fillColor: new paper.Color(0, 0, 0, 0.001),
      strokeColor: null,
      visible: true,
      selected: false,
    });
    selectionArea.data = {
      type: 'image-selection-area',
      imageId,
      isHelper: true,
    };
    try { selectionArea.insertAbove(raster); } catch { parentGroup.addChild(selectionArea); }

    // 添加选择框（默认隐藏）
    const selectionBorder = new paper.Path.Rectangle({
      rectangle: bounds,
      strokeColor: new paper.Color('#3b82f6'),
      strokeWidth: 1,
      fillColor: null,
      selected: false,
      visible: false  // 默认隐藏选择框
    });
    selectionBorder.data = {
      isSelectionBorder: true,
      isHelper: true  // 标记为辅助元素
    };
    parentGroup.addChild(selectionBorder);

    // 添加四个角的调整控制点
    const handleSize = 12;
    const handleColor = new paper.Color('#3b82f6');

    // 创建调整控制点
    const handles = [
      { direction: 'nw', position: [bounds.left, bounds.top] },
      { direction: 'ne', position: [bounds.right, bounds.top] },
      { direction: 'sw', position: [bounds.left, bounds.bottom] },
      { direction: 'se', position: [bounds.right, bounds.bottom] }
    ];

    handles.forEach(({ direction, position }) => {
                    const handle = new paper.Path.Rectangle({
                        point: [position[0] - handleSize / 2, position[1] - handleSize / 2],
                        size: [handleSize, handleSize],
                        fillColor: 'white',  // 改为白色填充（空心效果）
                        strokeColor: handleColor,  // 蓝色边框
                        strokeWidth: 1,  // 增加边框宽度让空心效果更明显
                        selected: false,
                        visible: false  // 默认隐藏控制点
                      });
      handle.data = {
        isResizeHandle: true,
        direction,
        imageId,
        isHelper: true  // 标记为辅助元素
      };
      parentGroup.addChild(handle);
    });
  }, []);

  // ========== 获取图像的base64数据 ==========
  const getImageDataForEditing = useCallback((imageId: string): string | null => {
    const imageInstance = imageInstances.find(img => img.id === imageId);
    if (!imageInstance) return null;

    try {
      // 🎯 优先使用原始图片数据（高质量）
      // 这样可以避免canvas缩放导致的质量损失
      const primarySrc = imageInstance.imageData?.url || imageInstance.imageData?.src;
      if (primarySrc) {
        return primarySrc;
      }

      // 备用方案：从Paper.js获取（已缩放，可能质量较低）
      console.warn('⚠️ AI编辑：未找到原始图片数据，使用canvas数据（可能已缩放）');
      // 🔥 使用 findImagePaperItem 进行深度搜索
      const imageGroup = findImagePaperItem(imageId);

      if (!imageGroup) return null;

      const raster = isGroup(imageGroup)
        ? imageGroup.children.find(child => isRaster(child)) as paper.Raster
        : (isRaster(imageGroup) ? imageGroup as paper.Raster : null);
      if (!raster || !raster.canvas) return null;

      // 将canvas转换为base64（已缩放，可能质量较低）
      return raster.canvas.toDataURL('image/png');
    } catch (error) {
      console.error('获取图像数据失败:', error);
      return null;
    }
  }, [imageInstances]);

  // 检查图层是否可见
  const isLayerVisible = useCallback((imageId: string) => {
    // 🔥 使用 findImagePaperItem 进行深度搜索
    const imageGroup = findImagePaperItem(imageId);

    if (isGroup(imageGroup) || isRaster(imageGroup)) {
      // 获取图片所在的图层
      const currentLayer = imageGroup.layer;
      if (currentLayer) {
        // 返回图层的可见状态
        return currentLayer.visible;
      }
    }
    return true; // 默认可见（兜底）
  }, []);

  // ========== 图片选择/取消选择 ==========
  // 更新图片选择视觉效果
  const updateImageSelectionVisuals = useCallback((selectedIds: string[]) => {
    setImageInstances(prev => prev.map(img => {
      const isSelected = selectedIds.includes(img.id);

      // 控制选择框和控制点的可见性
      // 🔥 使用 findImagePaperItem 进行深度搜索
      const imageGroup = findImagePaperItem(img.id);

      if (isGroup(imageGroup)) {
        imageGroup.children.forEach(child => {
          if (child.data?.isSelectionBorder || child.data?.isResizeHandle) {
            child.visible = isSelected;
          }
        });
      }

      return {
        ...img,
        isSelected
      };
    }));
    paper.view.update();
  }, []);

  const handleImageSelect = useCallback((imageId: string, addToSelection: boolean = false) => {
    // 检查图层是否可见，只有可见的图层才能被选中
    if (!isLayerVisible(imageId)) {
      logger.debug('图层不可见，无法选中图片:', imageId);
      return;
    }

    // 更新选择状态
    if (addToSelection) {
      // 增量选择模式
      setSelectedImageIds(prev => {
        if (prev.includes(imageId)) {
          // 如果已选中，则取消选择
          const newIds = prev.filter(id => id !== imageId);
          updateImageSelectionVisuals(newIds);
          return newIds;
        } else {
          // 否则添加到选择
          const newIds = [...prev, imageId];
          updateImageSelectionVisuals(newIds);
          return newIds;
        }
      });
    } else {
      // 单选模式
      setSelectedImageIds([imageId]);
      updateImageSelectionVisuals([imageId]);
    }
    
    eventHandlers.onImageSelect?.(imageId);
  }, [eventHandlers.onImageSelect, isLayerVisible, updateImageSelectionVisuals]);

  // 批量选择图片
  const handleImageMultiSelect = useCallback((imageIds: string[]) => {
    // 过滤出可见图层的图片
    const visibleImageIds = imageIds.filter(id => isLayerVisible(id));
    
    logger.upload(`批量选中图片: ${visibleImageIds.join(', ')}`);
    setSelectedImageIds(visibleImageIds);
    updateImageSelectionVisuals(visibleImageIds);
    
    // 触发批量选择事件
    if (eventHandlers.onImageMultiSelect) {
      eventHandlers.onImageMultiSelect(visibleImageIds);
    }
  }, [eventHandlers.onImageMultiSelect, isLayerVisible, updateImageSelectionVisuals]);

  const handleImageDeselect = useCallback(() => {
    setSelectedImageIds([]);
    updateImageSelectionVisuals([]);
    eventHandlers.onImageDeselect?.();
  }, [eventHandlers.onImageDeselect, updateImageSelectionVisuals]);

  // 辅助函数：检查是否为 Raster 对象（兼容生产环境）
  const isRasterItem = useCallback((item: paper.Item): boolean => {
    return item.className === 'Raster' || item instanceof paper.Raster;
  }, []);

  const applyBoundsToPaperImage = useCallback((imageId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!paper?.project) return false;

    // 🔥 使用 findImagePaperItem 进行深度搜索
    const imageGroup = findImagePaperItem(imageId);

    const rect = new paper.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);

    if (isGroup(imageGroup)) {
      imageGroup.children.forEach(child => {
        if (isRasterItem(child)) {
          child.bounds = rect.clone();
          try {
            if (!child.data) child.data = {};
            (child.data as any).__tanvaBounds = { ...bounds };
          } catch {}
          return;
        }
        if (child.data?.isSelectionBorder) {
          child.bounds = rect.clone();
          return;
        }
        if (child.data?.type === 'image-selection-area') {
          child.bounds = rect.clone();
          return;
        }
        if (child.data?.isResizeHandle) {
          const direction = child.data.direction;
          let x = bounds.x;
          let y = bounds.y;
          if (direction === 'ne' || direction === 'se') x = bounds.x + bounds.width;
          if (direction === 'sw' || direction === 'se') y = bounds.y + bounds.height;
          child.position = new paper.Point(x, y);
          return;
        }
        if (child.data?.isImageHitRect) {
          child.bounds = rect.clone();
          return;
        }
      });
      return true;
    }

    if (isRaster(imageGroup)) {
      imageGroup.bounds = rect;
      try {
        if (!imageGroup.data) imageGroup.data = {};
        (imageGroup.data as any).__tanvaBounds = { ...bounds };
      } catch {}
      return true;
    }

    return false;
  }, [isRasterItem]);

  // ========== 历史快速回放：仅应用 bounds（避免全量重建导致闪烁） ==========
  const applyBoundsFromSnapshot = useCallback((snapshots: ImageAssetSnapshot[]) => {
    if (!Array.isArray(snapshots) || snapshots.length === 0) return;

    const boundsById = new Map<string, { x: number; y: number; width: number; height: number }>();
    snapshots.forEach((snap) => {
      const id = snap?.id;
      const b = snap?.bounds;
      if (!id || !b) return;
      boundsById.set(id, { x: b.x, y: b.y, width: b.width, height: b.height });
    });
    if (boundsById.size === 0) return;

    const changedIds: string[] = [];
    boundsById.forEach((b, id) => {
      const didUpdate = applyBoundsToPaperImage(id, b);
      if (didUpdate) changedIds.push(id);
    });

    if (changedIds.length === 0) return;

    setImageInstances((prev) =>
      prev.map((img) => {
        const b = boundsById.get(img.id);
        if (!b) return img;
        const cur = img.bounds;
        if (cur.x === b.x && cur.y === b.y && cur.width === b.width && cur.height === b.height) return img;
        return { ...img, bounds: { ...cur, ...b } };
      })
    );

    try { syncImageGroupBlocksForImageIds(changedIds); } catch {}
    try { paper.view.update(); } catch {}
  }, [applyBoundsToPaperImage]);

  const applyPaperMoveToImage = useCallback((imageId: string, newPosition: { x: number; y: number }) => {
    // 🔥 使用 findImagePaperItem 进行深度搜索，确保能找到嵌套的图片组
    const imageGroup = findImagePaperItem(imageId);

    if (isGroup(imageGroup)) {
      // 获取实际的Raster对象来获取真实尺寸
      // 使用 className 检查以兼容生产环境（instanceof 在压缩后可能失效）
      const raster = imageGroup.children.find(child => isRasterItem(child));
      const actualBounds = (() => {
        const direct = raster ? raster.bounds : imageGroup.bounds;
        if (direct && direct.width > 0 && direct.height > 0) return direct;

        const raw = (raster as any)?.data?.__tanvaBounds || (imageGroup as any)?.data?.__tanvaBounds;
        if (!raw || typeof raw !== 'object') return direct;
        const x = (raw as any)?.x;
        const y = (raw as any)?.y;
        const width = (raw as any)?.width;
        const height = (raw as any)?.height;
        const valid =
          typeof x === 'number' && Number.isFinite(x) &&
          typeof y === 'number' && Number.isFinite(y) &&
          typeof width === 'number' && Number.isFinite(width) &&
          typeof height === 'number' && Number.isFinite(height) &&
          width > 0 &&
          height > 0;
        if (!valid) return direct;
        try {
          return new paper.Rectangle(x, y, width, height);
        } catch {
          return direct;
        }
      })();

      if (actualBounds && actualBounds.width > 0 && actualBounds.height > 0) {
        // 使用实际的图片尺寸而不是React状态中的尺寸
        const actualWidth = actualBounds.width;
        const actualHeight = actualBounds.height;
        // 确保 Raster bounds 已有有效尺寸，避免拖拽时把图片“压扁”为0
        try {
          if (raster && raster.bounds && (raster.bounds.width <= 0 || raster.bounds.height <= 0)) {
            raster.bounds = actualBounds.clone();
          }
        } catch {}

        // 更新组内所有子元素的位置（设置绝对位置，保持尺寸不变）
        imageGroup.children.forEach(child => {
          if (isRasterItem(child)) {
            // 使用 bounds 而不是 position，避免云端环境下 position 设置不生效的问题
            child.bounds = new paper.Rectangle(
              newPosition.x,
              newPosition.y,
              actualWidth,
              actualHeight
            );
          } else if (child.data?.isSelectionBorder) {
            // 设置选择框的绝对位置和尺寸（使用实际图片尺寸）
            child.bounds = new paper.Rectangle(
              newPosition.x,
              newPosition.y,
              actualWidth,
              actualHeight
            );
          } else if (child.data?.type === 'image-selection-area') {
            // 更新选择区域的bounds（关键！用于点击检测）
            child.bounds = new paper.Rectangle(
              newPosition.x,
              newPosition.y,
              actualWidth,
              actualHeight
            );
          } else if (child.data?.isResizeHandle) {
            // 重新定位控制点到绝对位置（使用实际图片尺寸）
            const direction = child.data.direction;
            let handlePosition;

            switch (direction) {
              case 'nw':
                handlePosition = [newPosition.x, newPosition.y];
                break;
              case 'ne':
                handlePosition = [newPosition.x + actualWidth, newPosition.y];
                break;
              case 'sw':
                handlePosition = [newPosition.x, newPosition.y + actualHeight];
                break;
              case 'se':
                handlePosition = [newPosition.x + actualWidth, newPosition.y + actualHeight];
                break;
              default:
                handlePosition = [newPosition.x, newPosition.y];
            }

            child.position = new paper.Point(handlePosition[0], handlePosition[1]);
          } else if (child.data?.isImageHitRect) {
            // 更新碰撞检测矩形的bounds（由ensureImageGroupStructure创建）
            child.bounds = new paper.Rectangle(
              newPosition.x,
              newPosition.y,
              actualWidth,
              actualHeight
            );
          }
        });

        // 同步缓存 bounds（用于后续 source 切换二次 onLoad 时恢复显示尺寸）
        try {
          if (raster && (raster as any).data) {
            (raster as any).data.__tanvaBounds = {
              x: newPosition.x,
              y: newPosition.y,
              width: actualWidth,
              height: actualHeight
            };
          }
        } catch {}
      }

      return;
    }

    if (isRaster(imageGroup)) {
      const resolvedBounds = (() => {
        const direct = imageGroup.bounds;
        if (direct && direct.width > 0 && direct.height > 0) return direct;
        const raw = (imageGroup.data as any)?.__tanvaBounds;
        if (!raw || typeof raw !== 'object') return direct;
        const x = (raw as any)?.x;
        const y = (raw as any)?.y;
        const width = (raw as any)?.width;
        const height = (raw as any)?.height;
        const valid =
          typeof x === 'number' && Number.isFinite(x) &&
          typeof y === 'number' && Number.isFinite(y) &&
          typeof width === 'number' && Number.isFinite(width) &&
          typeof height === 'number' && Number.isFinite(height) &&
          width > 0 &&
          height > 0;
        if (!valid) return direct;
        try {
          return new paper.Rectangle(x, y, width, height);
        } catch {
          return direct;
        }
      })();

      if (!resolvedBounds || resolvedBounds.width <= 0 || resolvedBounds.height <= 0) {
        return;
      }

      const actualWidth = resolvedBounds.width;
      const actualHeight = resolvedBounds.height;
      imageGroup.position = new paper.Point(
        newPosition.x + actualWidth / 2,
        newPosition.y + actualHeight / 2
      );
      try {
        if (!imageGroup.data) imageGroup.data = {};
        (imageGroup.data as any).__tanvaBounds = {
          x: newPosition.x,
          y: newPosition.y,
          width: actualWidth,
          height: actualHeight
        };
      } catch {}
    }
  }, [isRasterItem]);

  const handleImagesMove = useCallback((
    moves: Array<{ id: string; position: { x: number; y: number } }>,
    skipPaperUpdate = false
  ) => {
    const validMoves = Array.isArray(moves)
      ? moves.filter((m): m is { id: string; position: { x: number; y: number } } => !!m?.id && !!m?.position)
      : [];
    if (validMoves.length === 0) return;

    const positionsById = new Map<string, { x: number; y: number }>();
    validMoves.forEach(({ id, position }) => positionsById.set(id, position));

    if (!skipPaperUpdate) {
      validMoves.forEach(({ id, position }) => {
        try { applyPaperMoveToImage(id, position); } catch {}
      });
      try { syncImageGroupBlocksForImageIds(validMoves.map((m) => m.id)); } catch {}
      try { paper.view.update(); } catch {}
    }

    setImageInstances((prev) =>
      prev.map((img) => {
        const pos = positionsById.get(img.id);
        if (!pos) return img;
        const cur = img.bounds;
        if (cur.x === pos.x && cur.y === pos.y) return img;
        return { ...img, bounds: { ...cur, x: pos.x, y: pos.y } };
      })
    );

    validMoves.forEach(({ id, position }) => {
      eventHandlers.onImageMove?.(id, position);
    });
  }, [applyPaperMoveToImage, eventHandlers.onImageMove]);

  // ========== 图片移动 ==========
  const handleImageMove = useCallback((imageId: string, newPosition: { x: number; y: number }, skipPaperUpdate = false) => {
    handleImagesMove([{ id: imageId, position: newPosition }], skipPaperUpdate);
  }, [handleImagesMove]);

  // ========== 批量切换图片可见性（用于拖拽到库时隐藏克隆副本） ==========
  const setImagesVisibility = useCallback((imageIds: string[], visible: boolean) => {
    if (!imageIds || imageIds.length === 0) return;
    const idSet = new Set(imageIds);

    try {
      const items = paper.project?.getItems({
        match: (item: any) => {
          const data = item?.data || {};
          const isImageGroup = data.type === 'image' && typeof data.imageId === 'string';
          const isRasterWithId = isRasterItem(item) && typeof data.imageId === 'string';
          return (isImageGroup || isRasterWithId) && idSet.has(data.imageId);
        }
      }) as paper.Item[] | undefined;

      items?.forEach((item) => {
        try {
          item.visible = visible;
        } catch {}
      });
      paper.view?.update();
    } catch (error) {
      console.warn('[ImageTool] 切换图片可见性失败:', error);
    }

    setImageInstances((prev) =>
      prev.map((img) => (idSet.has(img.id) ? { ...img, visible } : img))
    );
  }, [isRasterItem]);

  // 直接更新，避免复杂的节流逻辑

  // ========== 图片调整大小 ==========
  const handleImageResize = useCallback((imageId: string, newBounds: { x: number; y: number; width: number; height: number }) => {
    // 立即更新Paper.js对象，不等待React状态
    // 🔥 使用 findImagePaperItem 进行深度搜索
    const imageGroup = findImagePaperItem(imageId);

    if (isGroup(imageGroup)) {
      // 找到图片Raster元素并调整大小和位置
      // 使用 className 检查以兼容生产环境（instanceof 在压缩后可能失效）
      const raster = imageGroup.children.find(child => isRasterItem(child));
      if (raster && raster.data?.originalWidth && raster.data?.originalHeight) {
        // 直接设置bounds，避免scale操作的闪烁
        raster.bounds = new paper.Rectangle(
          newBounds.x,
          newBounds.y,
          newBounds.width,
          newBounds.height
        );
        try {
          if (!raster.data) raster.data = {};
          (raster.data as any).__tanvaBounds = { ...newBounds };
        } catch {}
      }

      // 更新选择框、选择区域和控制点
      imageGroup.children.forEach(child => {
        if (child.data?.isSelectionBorder) {
          child.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        } else if (child.data?.type === 'image-selection-area') {
          // 更新选择区域的bounds（关键！用于点击检测）
          child.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        } else if (child.data?.isResizeHandle) {
          // 重新定位控制点
          const direction = child.data.direction;
          let handlePosition;

          switch (direction) {
            case 'nw':
              handlePosition = [newBounds.x, newBounds.y];
              break;
            case 'ne':
              handlePosition = [newBounds.x + newBounds.width, newBounds.y];
              break;
            case 'sw':
              handlePosition = [newBounds.x, newBounds.y + newBounds.height];
              break;
            case 'se':
              handlePosition = [newBounds.x + newBounds.width, newBounds.y + newBounds.height];
              break;
            default:
              handlePosition = [newBounds.x, newBounds.y];
          }

          child.position = new paper.Point(handlePosition[0], handlePosition[1]);
        } else if (child.data?.isImageHitRect) {
          // 更新碰撞检测矩形的bounds（由ensureImageGroupStructure创建）
          child.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
        }
      });
      try { syncImageGroupBlocksForImageIds([imageId]); } catch {}
      try { paper.view.update(); } catch {}
    } else if (isRaster(imageGroup)) {
      imageGroup.bounds = new paper.Rectangle(
        newBounds.x,
        newBounds.y,
        newBounds.width,
        newBounds.height
      );
      try {
        if (!imageGroup.data) imageGroup.data = {};
        (imageGroup.data as any).__tanvaBounds = { ...newBounds };
      } catch {}
      try { syncImageGroupBlocksForImageIds([imageId]); } catch {}
      try { paper.view.update(); } catch {}
    }

    // 简化React状态更新
    setImageInstances(prev => prev.map(img => {
      if (img.id === imageId) {
        return { ...img, bounds: newBounds };
      }
      return img;
    }));
    eventHandlers.onImageResize?.(imageId, newBounds);
    try { paperSaveService.triggerAutoSave(); } catch {}
    try { historyService.commit('resize-image').catch(() => {}); } catch {}
  }, [eventHandlers.onImageResize, isRasterItem]);

  // ========== 图片删除 ==========
  const handleImageDelete = useCallback((imageId: string) => {
    logger.debug('🗑️ 开始删除图片:', imageId);

    // 从Paper.js中移除图片对象（深度清理，防止残留）
    try {
      if (paper && paper.project) {
        const matches = paper.project.getItems({
          match: (item: any) => {
            const d = item?.data || {};
            const isImageGroup = d.type === 'image' && d.imageId === imageId;
            const isRasterWithId = isRaster(item) && (d.imageId === imageId);
            return isImageGroup || isRasterWithId;
          }
        }) as paper.Item[];

        if (matches.length > 0) {
          matches.forEach((item) => {
            let target: any = item;
            while (target && !(target instanceof paper.Layer)) {
              if (target?.data?.type === 'image' && target?.data?.imageId === imageId) {
                try { target.remove(); } catch {}
                return;
              }
              target = target.parent;
            }
            try { item.remove(); } catch {}
          });
          try { syncImageGroupBlocksForImageIds([imageId]); } catch {}
          try { paper.view.update(); } catch {}
          logger.debug('🗑️ 已从Paper.js中移除图片（深度清理）');
        } else {
          console.warn('未找到需要删除的图片对象，可能已被移除');
        }
      }
    } catch (e) {
      console.warn('删除Paper对象时出错:', e);
    }

    // 从React状态中移除图片
    setImageInstances(prev => {
      const filtered = prev.filter(img => img.id !== imageId);
      logger.debug('🗑️ 已从状态中移除图片，剩余图片数量:', filtered.length);
      return filtered;
    });

    // 如果删除的是当前选中的图片，清除选中状态
    if (selectedImageIds.includes(imageId)) {
      setSelectedImageIds(prev => prev.filter(id => id !== imageId));
      logger.debug('🗑️ 已清除选中状态');
    }

    // 调用删除回调
    eventHandlers.onImageDelete?.(imageId);
    try { paperSaveService.triggerAutoSave(); } catch {}
    historyService.commit('delete-image').catch(() => {});
  }, [selectedImageIds[0], eventHandlers.onImageDelete]);

  // ========== 图片上传错误处理 ==========
  const handleImageUploadError = useCallback((error: string) => {
    logger.error('图片上传失败:', error);
    currentPlaceholderRef.current = null;
  }, []);

  // ========== 处理上传触发完成 ==========
  const handleUploadTriggerHandled = useCallback(() => {
    setTriggerImageUpload(false);
  }, []);

  // ========== 删除占位框 ==========
  const deletePlaceholder = useCallback((placeholderId?: string) => {
    const idToDelete = placeholderId || selectedPlaceholderId;
    if (!idToDelete) return false;

    const placeholder = placeholdersRef.current.get(idToDelete);
    if (placeholder) {
      try {
        placeholder.remove();
        placeholdersRef.current.delete(idToDelete);
        if (selectedPlaceholderId === idToDelete) {
          setSelectedPlaceholderId(null);
        }
        if (currentPlaceholderRef.current?.data?.placeholderId === idToDelete) {
          currentPlaceholderRef.current = null;
        }
        paper.view?.update();
        logger.debug('🗑️ 已删除图片占位框:', idToDelete);
        return true;
      } catch (e) {
        console.warn('删除占位框失败:', e);
      }
    }
    return false;
  }, [selectedPlaceholderId]);

  // ========== 取消选中占位框 ==========
  const deselectPlaceholder = useCallback(() => {
    if (selectedPlaceholderId) {
      const placeholder = placeholdersRef.current.get(selectedPlaceholderId);
      if (placeholder) {
        // 恢复默认样式
        const border = placeholder.children?.[0];
        if (border instanceof paper.Path) {
          border.strokeColor = new paper.Color('#60a5fa');
          border.strokeWidth = 1;
        }
      }
      setSelectedPlaceholderId(null);
    }
  }, [selectedPlaceholderId]);

  const hydrateFromSnapshot = useCallback((snapshots: ImageAssetSnapshot[]) => {
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      setImageInstances([]);
      setSelectedImageIds([]);
      return;
    }

    // 为了避免重复，先清理当前 Paper.js 里的图片分组（data.type === 'image'）
    try {
      if (paper && paper.project) {
        const toRemove: paper.Item[] = [];
        (paper.project.layers || []).forEach((layer: any) => {
          const children = layer?.children || [];
          children.forEach((child: any) => {
            if (child?.data?.type === 'image') {
              toRemove.push(child);
            }
          });
        });
        toRemove.forEach((item) => {
          try { item.remove(); } catch {}
        });
      }
    } catch {}

    setImageInstances([]);
    setSelectedImageIds([]);

    snapshots.forEach((snap) => {
      const resolvedUrl = snap?.url || snap?.localDataUrl;
      if (!snap || !resolvedUrl || !snap.bounds) return;
      if (snap.layerId) {
        try { useLayerStore.getState().activateLayer(snap.layerId); } catch {}
      }
      const start = new paper.Point(snap.bounds.x, snap.bounds.y);
      const end = new paper.Point(snap.bounds.x + snap.bounds.width, snap.bounds.y + snap.bounds.height);
      const placeholder = createImagePlaceholder(start, end);
      if (placeholder) {
        currentPlaceholderRef.current = placeholder;
        handleImageUploaded({
          id: snap.id,
          url: resolvedUrl,
          src: resolvedUrl,
          key: snap.key,
          fileName: snap.fileName,
          width: snap.width,
          height: snap.height,
          contentType: snap.contentType,
          pendingUpload: snap.pendingUpload,
          localDataUrl: snap.localDataUrl ?? resolvedUrl,
        }, { suppressAutoSave: true });
      }
    });

    setImageInstances(prev => prev.map((img) => {
      const snap = snapshots.find((s) => s.id === img.id);
      if (!snap) return img;
      return {
        ...img,
        layerId: snap.layerId ?? img.layerId,
        bounds: {
          x: snap.bounds.x,
          y: snap.bounds.y,
          width: snap.bounds.width,
          height: snap.bounds.height,
        },
        imageData: {
          ...img.imageData,
          url: snap.url ?? img.imageData.url ?? snap.localDataUrl,
          src: snap.url ?? snap.localDataUrl ?? img.imageData.src,
          key: snap.key ?? img.imageData.key,
          fileName: snap.fileName ?? img.imageData.fileName,
          width: snap.width ?? img.imageData.width,
          height: snap.height ?? img.imageData.height,
          contentType: snap.contentType ?? img.imageData.contentType,
          pendingUpload: snap.pendingUpload ?? img.imageData.pendingUpload,
          localDataUrl: snap.localDataUrl ?? img.imageData.localDataUrl,
        },
      };
    }));
  }, [createImagePlaceholder, handleImageUploaded, setImageInstances, setSelectedImageIds]);

  const createImageFromSnapshot = useCallback((
    snapshot: ImageAssetSnapshot,
    options?: {
      offset?: { x: number; y: number };
      idOverride?: string;
    }
  ) => {
    if (!snapshot) return null;

    const source = snapshot.localDataUrl || snapshot.src || snapshot.url;
    if (!source) {
      console.warn('复制的图片缺少有效的资源地址，无法粘贴');
      return null;
    }

    const offsetX = options?.offset?.x ?? 0;
    const offsetY = options?.offset?.y ?? 0;
    const imageId = options?.idOverride || `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (snapshot.layerId) {
      try { useLayerStore.getState().activateLayer(snapshot.layerId); } catch {}
    }

    const start = new paper.Point(snapshot.bounds.x + offsetX, snapshot.bounds.y + offsetY);
    const end = new paper.Point(
      snapshot.bounds.x + snapshot.bounds.width + offsetX,
      snapshot.bounds.y + snapshot.bounds.height + offsetY
    );

    const placeholder = createImagePlaceholder(start, end);
    if (!placeholder) return null;

    currentPlaceholderRef.current = placeholder;

    const asset = {
      id: imageId,
      url: source,
      src: source,
      key: snapshot.key,
      fileName: snapshot.fileName,
      width: snapshot.width ?? snapshot.bounds.width,
      height: snapshot.height ?? snapshot.bounds.height,
      contentType: snapshot.contentType,
      pendingUpload: snapshot.pendingUpload,
      localDataUrl: snapshot.localDataUrl,
    } as StoredImageAsset;

    handleImageUploaded(asset);
    return imageId;
  }, [createImagePlaceholder, handleImageUploaded]);

  return {
    // 状态
    imageInstances,
    selectedImageIds,  // 多选状态
    selectedImageId: selectedImageIds[0] || null,  // 向下兼容单选
    triggerImageUpload,
    imageDragState,
    imageResizeState,

    // 占位框相关
    createImagePlaceholder,
    currentPlaceholderRef,
    selectedPlaceholderId,
    deletePlaceholder,
    deselectPlaceholder,
    placeholdersRef,

    // 图片上传处理
    handleImageUploaded,
    handleImageUploadError,
    handleUploadTriggerHandled,

    // 图片选择
    handleImageSelect,
    handleImageMultiSelect,  // 批量选择
    handleImageDeselect,

    // 图片移动和调整大小
    handleImageMove,
    handleImagesMove,
    handleImageResize,
    handleImageDelete,

    // 状态设置器（用于外部直接控制）
    setImageInstances,
    setSelectedImageIds,  // 设置多选状态
    setTriggerImageUpload,
    setImageDragState,
    setImageResizeState,

    // AI编辑功能
    getImageDataForEditing,
    hydrateFromSnapshot,
    createImageFromSnapshot,
    setImagesVisibility,
    applyBoundsFromSnapshot,
  };
};
