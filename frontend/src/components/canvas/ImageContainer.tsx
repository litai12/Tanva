import React, { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import paper from 'paper';
import { useAIChatStore, getImageModelForProvider } from '@/stores/aiChatStore';
import { useCanvasStore } from '@/stores';
import { Sparkles, Eye, EyeOff, Wand2, Copy, Trash2, Box, Crop, ImageUp } from 'lucide-react';
import { Button } from '../ui/button';
import ImagePreviewModal, { type ImageItem } from '../ui/ImagePreviewModal';
import backgroundRemovalService from '@/services/backgroundRemovalService';
import { LoadingSpinner } from '../ui/loading-spinner';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import { convert2Dto3D } from '@/services/convert2Dto3DService';
import { uploadToOSS } from '@/services/ossUploadService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import type { Model3DData } from '@/services/model3DUploadService';
import { optimizeHdImage } from '@/services/hdUpscaleService';
import ExpandImageSelector from './ExpandImageSelector';
import { useToolStore } from '@/stores';
import aiImageService from '@/services/aiImageService';
import { useImageHistoryStore } from '@/stores/imageHistoryStore';
import { loadImageElement, trimTransparentPng } from '@/utils/imageHelper';

const HD_UPSCALE_RESOLUTION: '4k' = '4k';
const EXPAND_PRESET_PROMPT = '帮我在空白部分扩展这张图，补全内容';

type Bounds = { x: number; y: number; width: number; height: number };
const ensureDataUrlString = (imageData: string, mime: string = 'image/png'): string => {
  if (!imageData) return '';
  return imageData.startsWith('data:image') ? imageData : `data:${mime};base64,${imageData}`;
};

const normalizeImageSrc = (value?: string | null): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^data:image\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed}`;
};

const composeExpandedImage = async (
  sourceDataUrl: string,
  originalBounds: Bounds,
  targetBounds: Bounds
): Promise<{ dataUrl: string; width: number; height: number }> => {
  if (!targetBounds.width || !targetBounds.height) {
    throw new Error('请选择有效的扩展区域');
  }

  const image = await loadImageElement(sourceDataUrl);
  const safeOriginalWidth = Math.max(1, originalBounds.width);
  const safeOriginalHeight = Math.max(1, originalBounds.height);

  const scaleX = image.width / safeOriginalWidth;
  const scaleY = image.height / safeOriginalHeight;
  const scale = Number.isFinite(scaleX) && Number.isFinite(scaleY)
    ? (scaleX + scaleY) / 2
    : Number.isFinite(scaleX)
    ? scaleX
    : Number.isFinite(scaleY)
    ? scaleY
    : 1;

  const canvasWidth = Math.max(1, Math.round(targetBounds.width * scale));
  const canvasHeight = Math.max(1, Math.round(targetBounds.height * scale));
  const offsetX = Math.round((originalBounds.x - targetBounds.x) * scale);
  const offsetY = Math.round((originalBounds.y - targetBounds.y) * scale);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建扩展画布');
  }

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(image, offsetX, offsetY, image.width, image.height);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvasWidth,
    height: canvasHeight,
  };
};

interface ImageData {
  id: string;
  url?: string;
  src?: string;
  fileName?: string;
  pendingUpload?: boolean;
  localDataUrl?: string;
}

interface ImageContainerProps {
  imageData: ImageData;
  bounds: { x: number; y: number; width: number; height: number }; // Paper.js世界坐标
  isSelected?: boolean;
  visible?: boolean; // 是否可见
  drawMode?: string; // 当前绘图模式
  isSelectionDragging?: boolean; // 是否正在拖拽选择框
  layerIndex?: number; // 图层索引，用于计算z-index
  onSelect?: () => void;
  onMove?: (newPosition: { x: number; y: number }) => void; // Paper.js坐标
  onResize?: (newBounds: { x: number; y: number; width: number; height: number }) => void; // Paper.js坐标
  onDelete?: (imageId: string) => void;
  onToggleVisibility?: (imageId: string) => void; // 切换图层可见性回调
  getImageDataForEditing?: (imageId: string) => string | null; // 获取高质量图像数据的函数
  showIndividualTools?: boolean;
}

const ImageContainer: React.FC<ImageContainerProps> = ({
  imageData,
  bounds,
  isSelected = false,
  visible = true,
  drawMode = 'select',
  isSelectionDragging = false,
  layerIndex = 0,
  onSelect,
  onMove,
  onResize,
  onDelete,
  onToggleVisibility,
  getImageDataForEditing,
  showIndividualTools = true
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const enableVisibilityToggle = false; // Temporarily hide layer visibility control

  // 获取AI聊天状态
  const { setSourceImageForEditing, addImageForBlending, showDialog, sourceImageForEditing, sourceImagesForBlending } = useAIChatStore();

  // 获取画布状态 - 用于监听画布移动变化
  const { zoom, panX, panY } = useCanvasStore();

  const sharedButtonStyle = undefined;

  const sharedButtonClass =
    'p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-blue-50 hover:border-blue-300 flex items-center justify-center';
  const sharedIconClass = 'w-3.5 h-3.5';

  // 实时Paper.js坐标状态
  const [realTimeBounds, setRealTimeBounds] = useState(bounds);
  const [isPositionStable, setIsPositionStable] = useState(true);
  
  // 预览模态框状态
  const [showPreview, setShowPreview] = useState(false);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  const [isConvertingTo3D, setIsConvertingTo3D] = useState(false);
  const [isExpandingImage, setIsExpandingImage] = useState(false);
  const [isOptimizingHd, setIsOptimizingHd] = useState(false);
  const [showExpandSelector, setShowExpandSelector] = useState(false);
  
  // 获取项目ID用于上传
  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const setDrawMode = useToolStore((state) => state.setDrawMode);

  const scopedHistory = useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);

  const relatedHistoryImages = useMemo<ImageItem[]>(() => {
    return scopedHistory
      .filter((item) => !!item.src)
      .map((item) => ({
        id: item.id,
        src: normalizeImageSrc(item.src),
        title: item.title,
      }));
  }, [scopedHistory]);

  // 将Paper.js世界坐标转换为屏幕坐标（改进版）
  const convertToScreenBounds = useCallback((paperBounds: { x: number; y: number; width: number; height: number }) => {
    if (!paper.view) return paperBounds;

    try {
      const dpr = window.devicePixelRatio || 1;
      // 使用更精确的坐标转换
      const topLeft = paper.view.projectToView(new paper.Point(paperBounds.x, paperBounds.y));
      const bottomRight = paper.view.projectToView(new paper.Point(paperBounds.x + paperBounds.width, paperBounds.y + paperBounds.height));

      // 添加数值验证，防止NaN或无限值
      const result = {
        x: isFinite(topLeft.x) ? topLeft.x / dpr : paperBounds.x,
        y: isFinite(topLeft.y) ? topLeft.y / dpr : paperBounds.y,
        width: isFinite(bottomRight.x - topLeft.x) ? (bottomRight.x - topLeft.x) / dpr : paperBounds.width,
        height: isFinite(bottomRight.y - topLeft.y) ? (bottomRight.y - topLeft.y) / dpr : paperBounds.height
      };

      return result;
    } catch (error) {
      console.warn('坐标转换失败，使用原始坐标:', error);
      return paperBounds;
    }
  }, [zoom, panX, panY]); // 添加画布状态依赖，确保画布变化时函数重新创建

  // 从Paper.js获取实时坐标
  const getRealTimePaperBounds = useCallback(() => {
    try {
      // 首先尝试从所有图层中查找图片对象
      const imageGroup = paper.project?.layers?.flatMap(layer =>
        layer.children.filter(child =>
          child.data?.type === 'image' && child.data?.imageId === imageData.id
        )
      )[0];

      if (imageGroup instanceof paper.Group) {
        const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster;
        if (raster && raster.bounds && isFinite(raster.bounds.x)) {
          // 获取实际的边界信息，确保数值有效
          const realBounds = {
            x: Math.round(raster.bounds.x * 100) / 100, // 四舍五入到小数点后2位
            y: Math.round(raster.bounds.y * 100) / 100,
            width: Math.round(raster.bounds.width * 100) / 100,
            height: Math.round(raster.bounds.height * 100) / 100
          };

          // 验证bounds是否合理
          if (realBounds.width > 0 && realBounds.height > 0) {
            return realBounds;
          }
        }
      }
    } catch (error) {
      console.warn('获取Paper.js实时坐标失败:', error);
    }
    
    return bounds; // 回退到props中的bounds
  }, [imageData.id, bounds]);

  // 监听画布状态变化，强制重新计算坐标
  useEffect(() => {
    // 当画布状态变化时，强制重新计算屏幕坐标
    const newPaperBounds = getRealTimePaperBounds();
    setRealTimeBounds(newPaperBounds);
    setIsPositionStable(false);

    // 设置稳定定时器
    const stableTimer = setTimeout(() => {
      setIsPositionStable(true);
    }, 150);

    return () => {
      clearTimeout(stableTimer);
    };
  }, [zoom, panX, panY, getRealTimePaperBounds]); // 直接监听画布状态变化

  // 实时同步Paper.js状态 - 只在选中时启用
  useEffect(() => {
    if (!isSelected) return;

    let animationFrame: number;
    let isUpdating = false;
    let stableTimer: NodeJS.Timeout;

    const updateRealTimeBounds = () => {
      if (isUpdating) return;
      isUpdating = true;

      const paperBounds = getRealTimePaperBounds();

      // 检查坐标是否发生变化 - 降低阈值以获得更高精度
      const hasChanged =
        Math.abs(paperBounds.x - realTimeBounds.x) > 0.1 ||
        Math.abs(paperBounds.y - realTimeBounds.y) > 0.1 ||
        Math.abs(paperBounds.width - realTimeBounds.width) > 0.1 ||
        Math.abs(paperBounds.height - realTimeBounds.height) > 0.1;

      if (hasChanged) {
        setIsPositionStable(false);
        setRealTimeBounds(paperBounds);

        // 清除之前的稳定定时器
        if (stableTimer) {
          clearTimeout(stableTimer);
        }

        // 设置新的稳定定时器
        stableTimer = setTimeout(() => {
          setIsPositionStable(true);
        }, 150); // 增加延迟时间，确保位置真正稳定
      }

      isUpdating = false;
      animationFrame = requestAnimationFrame(updateRealTimeBounds);
    };

    // 立即更新一次，然后开始循环
    const paperBounds = getRealTimePaperBounds();
    setRealTimeBounds(paperBounds);
    animationFrame = requestAnimationFrame(updateRealTimeBounds);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
    };
  }, [isSelected, getRealTimePaperBounds]);

  // 同步Props bounds变化
  useEffect(() => {
    setRealTimeBounds(bounds);
    setIsPositionStable(true);
  }, [bounds]);


  // 使用实时坐标进行屏幕坐标转换
  const screenBounds = useMemo(() => {
    return convertToScreenBounds(realTimeBounds);
  }, [realTimeBounds, convertToScreenBounds, zoom, panX, panY]); // 添加画布状态依赖，确保完全响应画布变化

  const resolveImageDataUrl = useCallback(async (): Promise<string | null> => {
    const ensureDataUrl = async (input: string | null): Promise<string | null> => {
      if (!input) return null;
      if (input.startsWith('data:image/')) {
        return input;
      }

      if (/^https?:\/\//i.test(input) || input.startsWith('blob:')) {
        try {
          const response = await fetch(input);
          const blob = await response.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              if (typeof reader.result === 'string') {
                resolve(reader.result);
              } else {
                reject(new Error('无法读取图像数据'));
              }
            };
            reader.onerror = () => reject(reader.error ?? new Error('读取图像数据失败'));
            reader.readAsDataURL(blob);
          });
        } catch (convertError) {
          console.warn('⚠️ 无法转换远程图像为Base64，尝试使用Canvas数据', convertError);
          return null;
        }
      }

      return input;
    };

    if (getImageDataForEditing) {
      const direct = await ensureDataUrl(getImageDataForEditing(imageData.id));
      if (direct) return direct;
    }

    const urlSource = imageData.url || imageData.src || null;
    const ensuredUrl = await ensureDataUrl(urlSource);
    if (ensuredUrl) return ensuredUrl;

    console.warn('⚠️ 未找到原始图像数据，尝试从Canvas抓取');
    const imageGroup = paper.project?.layers?.flatMap(layer =>
      layer.children.filter(child =>
        child.data?.type === 'image' && child.data?.imageId === imageData.id
      )
    )[0];

    if (imageGroup) {
      const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster;
      if (raster && raster.canvas) {
        const canvasData = raster.canvas.toDataURL('image/png');
        const ensuredCanvas = await ensureDataUrl(canvasData);
        if (ensuredCanvas) return ensuredCanvas;
      }
    }

    return null;
  }, [getImageDataForEditing, imageData.id, imageData.url, imageData.src]);

  const getProcessableImageUrl = useCallback(async (): Promise<string> => {
    const imageGroup = paper.project?.layers
      ?.flatMap(layer =>
        layer.children.filter(child => child.data?.type === 'image' && child.data?.imageId === imageData.id)
      )[0];

    let rasterSource: string | null = null;
    if (imageGroup) {
      const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster | undefined;
      if (raster && raster.source) {
        rasterSource = typeof raster.source === 'string' ? raster.source : null;
      }
    }

    const currentUrl = rasterSource || imageData.url || imageData.src;
    if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
      return currentUrl;
    }

    const imageDataUrl = await resolveImageDataUrl();
    if (!imageDataUrl) {
      throw new Error('无法获取当前图片的图像数据');
    }

    const response = await fetch(imageDataUrl);
    const blob = await response.blob();

    const uploadResult = await uploadToOSS(blob, {
      dir: projectId ? `projects/${projectId}/images/` : 'uploads/images/',
      fileName: `canvas-image-${Date.now()}.png`,
      contentType: 'image/png',
      projectId,
    });

    if (!uploadResult.success || !uploadResult.url) {
      throw new Error(uploadResult.error || '当前图片上传失败');
    }

    if (!/^https?:\/\//i.test(uploadResult.url)) {
      throw new Error(`无效的图片URL: ${uploadResult.url}`);
    }

    return uploadResult.url;
  }, [imageData.id, imageData.url, imageData.src, projectId, resolveImageDataUrl]);

  // 处理AI编辑按钮点击
  const handleAIEdit = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const run = async () => {
      const imageDataUrl = await resolveImageDataUrl();
      if (!imageDataUrl) {
        console.error('❌ 无法获取图像数据');
        return;
      }
      
      // 检查是否已有图片，如果有则添加到融合模式，否则设置为编辑图片
      const hasExistingImages = sourceImageForEditing || sourceImagesForBlending.length > 0;
      
      if (hasExistingImages) {
        // 如果有编辑图片，先将其转换为融合模式
        if (sourceImageForEditing) {
          addImageForBlending(sourceImageForEditing);
          setSourceImageForEditing(null);
          console.log('🎨 将编辑图像转换为融合模式');
        }
        
        // 已有图片：添加新图片到融合模式
        addImageForBlending(imageDataUrl);
        console.log('🎨 已添加图像到融合模式');
      } else {
        // 没有现有图片：设置为编辑图片
        setSourceImageForEditing(imageDataUrl);
        console.log('🎨 已设置图像为编辑模式');
      }
      
      showDialog();
    };

    run().catch((error) => {
      console.error('获取图像数据失败:', error);
    });
  }, [resolveImageDataUrl, setSourceImageForEditing, addImageForBlending, showDialog, sourceImageForEditing, sourceImagesForBlending]);

  // 处理预览按钮点击
  const handlePreview = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowPreview(true);
    setPreviewImageId(imageData.id);
    console.log('👁️ 打开图片预览:', imageData.id);
  }, [imageData.id]);

  // 处理切换可见性按钮点击
  const handleToggleVisibility = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (onToggleVisibility) {
      onToggleVisibility(imageData.id);
      console.log('👁️‍🗨️ 切换图层可见性:', imageData.id);
    }
  }, [imageData.id, onToggleVisibility]);

  const handleCreateFlowImageNode = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const run = async () => {
      const imageDataUrl = await resolveImageDataUrl();
      if (!imageDataUrl) {
        console.warn('⚠️ 无法获取图像数据，无法创建Flow节点');
        return;
      }
      const base64 = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
      window.dispatchEvent(new CustomEvent('flow:createImageNode', {
        detail: {
          imageData: base64,
          label: 'Image'
        }
      }));
      console.log('🧩 已请求创建Flow Image节点');
    };

    run().catch((error) => {
      console.error('将图片发送到Flow失败:', error);
    });
  }, [imageData.fileName, resolveImageDataUrl]);

  const handleBackgroundRemoval = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isRemovingBackground) {
      return;
    }

    const execute = async () => {
      const baseImage = await resolveImageDataUrl();
      if (!baseImage) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: '无法获取原图，无法抠图', type: 'error' }
        }));
        return;
      }

      setIsRemovingBackground(true);
      try {
        logger.info('🎯 开始背景移除', { imageId: imageData.id });
        const result = await backgroundRemovalService.removeBackground(baseImage, 'image/png', true);
        if (!result.success || !result.imageData) {
          throw new Error(result.error || '背景移除失败');
        }

        const centerPoint = {
          x: realTimeBounds.x + realTimeBounds.width / 2,
          y: realTimeBounds.y + realTimeBounds.height / 2
        };

        const fileName = `background-removed-${Date.now()}.png`;
        window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
          detail: {
            imageData: result.imageData,
            fileName,
            smartPosition: centerPoint,
            operationType: 'background-removal',
            sourceImageId: imageData.id
          }
        }));

        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: '✨ 抠图完成，已生成新图', type: 'success' }
        }));
        logger.info('✅ 背景移除完成', { imageId: imageData.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : '背景移除失败';
        console.error('背景移除失败:', error);
        logger.error('❌ 背景移除失败', error);
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message, type: 'error' }
        }));
      } finally {
        setIsRemovingBackground(false);
      }
    };

    execute().catch((error) => {
      console.error('抠图异常:', error);
      setIsRemovingBackground(false);
    });
  }, [imageData.id, resolveImageDataUrl, isRemovingBackground, realTimeBounds]);

  // 处理2D转3D按钮点击
  const handleConvertTo3D = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isConvertingTo3D) {
      return;
    }

    const execute = async () => {
      setIsConvertingTo3D(true);
      try {
        // 获取当前选中图片的URL，优先从Paper.js的raster获取
        let imageUrl: string;
        const imageGroup = paper.project?.layers?.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId === imageData.id
          )
        )[0];
        
        let rasterSource: string | null = null;
        if (imageGroup) {
          const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster | undefined;
          if (raster && raster.source) {
            rasterSource = typeof raster.source === 'string' ? raster.source : null;
          }
        }
        
        const currentUrl = rasterSource || imageData.url || imageData.src;
        
        if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
          imageUrl = currentUrl;
        } else {
          const imageDataUrl = await resolveImageDataUrl();
          if (!imageDataUrl) {
            throw new Error('无法获取当前图片的图像数据');
          }

          const response = await fetch(imageDataUrl);
          const blob = await response.blob();

          const uploadResult = await uploadToOSS(blob, {
            dir: projectId ? `projects/${projectId}/images/` : 'uploads/images/',
            fileName: `2d-to-3d-${Date.now()}.png`,
            contentType: 'image/png',
            projectId,
          });

          if (!uploadResult.success || !uploadResult.url) {
            throw new Error(uploadResult.error || '当前图片上传失败');
          }

          imageUrl = uploadResult.url;
        }
        
        if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
          throw new Error(`无效的图片URL: ${imageUrl}`);
        }

        const convertResult = await convert2Dto3D({ imageUrl });
        
        if (!convertResult.success || !convertResult.modelUrl) {
          throw new Error(convertResult.error || '2D转3D失败');
        }

        const modelUrl = convertResult.modelUrl;
        const fileName = modelUrl.split('/').pop() || `model-${Date.now()}.glb`;

        const model3DData: Model3DData = {
          url: modelUrl,
          format: 'glb',
          fileName,
          fileSize: 0,
          defaultScale: { x: 1, y: 1, z: 1 },
          defaultRotation: { x: 0, y: 0, z: 0 },
          timestamp: Date.now(),
        };

        const modelWidth = realTimeBounds.width;
        const modelHeight = realTimeBounds.height;
        const spacing = 20;
        
        const modelStartX = realTimeBounds.x + realTimeBounds.width + spacing;
        const modelStartY = realTimeBounds.y;
        const modelEndX = modelStartX + modelWidth;
        const modelEndY = modelStartY + modelHeight;

        window.dispatchEvent(new CustomEvent('canvas:insert-model3d', {
          detail: {
            modelData: model3DData,
            size: {
              width: modelWidth,
              height: modelHeight
            },
            position: {
              start: { x: modelStartX, y: modelStartY },
              end: { x: modelEndX, y: modelEndY }
            }
          }
        }));

        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: '✨ 2D转3D完成，已生成3D模型', type: 'success' }
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : '2D转3D失败';
        logger.error('2D转3D失败', error);
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message, type: 'error' }
        }));
      } finally {
        setIsConvertingTo3D(false);
      }
    };

    execute();
  }, [imageData.id, imageData.url, imageData.src, resolveImageDataUrl, isConvertingTo3D, realTimeBounds, projectId]);

  // 处理扩图按钮点击
  const handleExpandImage = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isExpandingImage) return;
    setShowExpandSelector(true);
  }, [isExpandingImage]);

  // 处理扩图选择完成
  const aiProvider = useAIChatStore((state) => state.aiProvider);

  const handleExpandSelect = useCallback(async (
    selectedBounds: { x: number; y: number; width: number; height: number },
    expandRatios: { left: number; top: number; right: number; bottom: number }
  ) => {
    setShowExpandSelector(false);
    setIsExpandingImage(true);

    try {
      const hasExpandArea =
        !!expandRatios &&
        (expandRatios.left > 0 || expandRatios.top > 0 || expandRatios.right > 0 || expandRatios.bottom > 0);

      if (!hasExpandArea) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: '请拖拽外框扩展空白区域后再尝试', type: 'error' }
        }));
        return;
      }

      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '⏳ 正在准备扩图，请稍候...', type: 'info' }
      }));

      const baseImageDataUrl = await resolveImageDataUrl();
      if (!baseImageDataUrl) {
        throw new Error('无法获取当前图片数据');
      }

      const composed = await composeExpandedImage(baseImageDataUrl, realTimeBounds, selectedBounds);
      const normalizedSourceImage = composed.dataUrl.includes(',')
        ? composed.dataUrl.split(',')[1]
        : composed.dataUrl;

      const modelToUse = getImageModelForProvider(aiProvider);
      logger.info('🔁 调用AI扩图', {
        imageId: imageData.id,
        provider: aiProvider,
        model: modelToUse,
        targetSize: {
          width: selectedBounds.width,
          height: selectedBounds.height,
        }
      });
      console.log('🟦 扩图提示词', EXPAND_PRESET_PROMPT);

      const result = await aiImageService.editImage({
        prompt: EXPAND_PRESET_PROMPT,
        sourceImage: normalizedSourceImage,
        outputFormat: 'png',
        aiProvider,
        model: modelToUse,
        imageOnly: true,
      });

      if (!result.success || !result.data || !result.data.imageData) {
        throw new Error(result.error?.message || '扩图失败');
      }

      const expandedImageData = ensureDataUrlString(result.data.imageData);
      let finalImageData = expandedImageData;
      let placementBounds = selectedBounds;

      try {
        const trimResult = await trimTransparentPng(expandedImageData, {
          alphaThreshold: 8,
          padding: 1
        });

        if (trimResult?.changed && trimResult.originalSize.width > 0 && trimResult.originalSize.height > 0) {
          finalImageData = trimResult.dataUrl;
          const pixelToPaperX = selectedBounds.width / trimResult.originalSize.width;
          const pixelToPaperY = selectedBounds.height / trimResult.originalSize.height;

          let newX = selectedBounds.x + trimResult.cropBounds.left * pixelToPaperX;
          let newY = selectedBounds.y + trimResult.cropBounds.top * pixelToPaperY;
          let newWidth = trimResult.cropBounds.width * pixelToPaperX;
          let newHeight = trimResult.cropBounds.height * pixelToPaperY;

          const maxRight = selectedBounds.x + selectedBounds.width;
          const maxBottom = selectedBounds.y + selectedBounds.height;
          if (newX + newWidth > maxRight) {
            newWidth = maxRight - newX;
          }
          if (newY + newHeight > maxBottom) {
            newHeight = maxBottom - newY;
          }

          placementBounds = {
            x: newX,
            y: newY,
            width: Math.max(1, newWidth),
            height: Math.max(1, newHeight)
          };

          logger.info('🪄 自动裁剪PNG透明边界', {
            originalPixels: trimResult.originalSize,
            cropBounds: trimResult.cropBounds,
            placementBounds
          });
        }
      } catch (trimError) {
        console.warn('PNG透明边界裁剪失败，使用原始边界', trimError);
      }

      const originalCenter = {
        x: realTimeBounds.x + realTimeBounds.width / 2,
        y: realTimeBounds.y + realTimeBounds.height / 2,
      };
      const expandPlacementGap = Math.max(32, Math.min(120, realTimeBounds.width * 0.1));
      const expandResultCenter = {
        x: originalCenter.x - realTimeBounds.width - expandPlacementGap,
        y: originalCenter.y,
      };

      window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
        detail: {
          imageData: finalImageData,
          fileName: `expanded-${Date.now()}.png`,
          selectedImageBounds: placementBounds,
          smartPosition: expandResultCenter,
          operationType: 'expand-image',
          sourceImageId: imageData.id,
        },
      }));

      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '✨ 扩图完成，已生成新图', type: 'success' }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '扩图失败';
      logger.error('扩图失败', error);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message, type: 'error' }
      }));
    } finally {
      setIsExpandingImage(false);
      setDrawMode('select');
    }
  }, [aiProvider, imageData.id, realTimeBounds, resolveImageDataUrl, setDrawMode]);

  const handleOptimizeHdImage = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOptimizingHd) return;

    const execute = async () => {
      setIsOptimizingHd(true);
      try {
        const imageUrl = await getProcessableImageUrl();
        const resolutionLabel = HD_UPSCALE_RESOLUTION.toUpperCase();

        window.dispatchEvent(new CustomEvent('toast', {
          detail: {
            message: `⏳ 开始高清放大（${resolutionLabel}），请稍候...`,
            type: 'info',
          },
        }));

        const result = await optimizeHdImage({
          imageUrl,
          resolution: HD_UPSCALE_RESOLUTION,
          filenamePrefix: `optimize_HD_image_${HD_UPSCALE_RESOLUTION}`,
        });

        if (!result.success || !result.imageUrl) {
          throw new Error(result.error || '高清放大失败');
        }

        const placementGap = Math.max(32, Math.min(120, realTimeBounds.width * 0.2));
        const smartPosition = {
          x: realTimeBounds.x + realTimeBounds.width + placementGap,
          y: realTimeBounds.y + realTimeBounds.height / 2,
        };

        window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
          detail: {
            imageData: result.imageUrl,
            fileName: `hd-${HD_UPSCALE_RESOLUTION}-${Date.now()}.png`,
            selectedImageBounds: {
              x: realTimeBounds.x,
              y: realTimeBounds.y,
              width: realTimeBounds.width,
              height: realTimeBounds.height,
            },
            smartPosition,
            operationType: 'optimize-hd-image',
            sourceImageId: imageData.id,
          },
        }));

        window.dispatchEvent(new CustomEvent('toast', {
          detail: {
            message: `✨ 高清放大完成（${resolutionLabel}）`,
            type: 'success',
          },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : '高清放大失败';
        logger.error('高清放大失败', error);
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message, type: 'error' },
        }));
      } finally {
        setIsOptimizingHd(false);
      }
    };

    execute();
  }, [getProcessableImageUrl, imageData.id, isOptimizingHd, realTimeBounds]);

  // 处理扩图取消
  const handleExpandCancel = useCallback(() => {
    setShowExpandSelector(false);
    // 恢复画板的默认选择模式
    setDrawMode('select');
  }, [setDrawMode]);

  const basePreviewSrc = useMemo(() => {
    const candidate = getImageDataForEditing?.(imageData.id) || imageData.url || imageData.src || imageData.localDataUrl;
    return normalizeImageSrc(candidate);
  }, [getImageDataForEditing, imageData.id, imageData.url, imageData.src, imageData.localDataUrl]);

  const previewCollection = useMemo<ImageItem[]>(() => {
    const map = new Map<string, ImageItem>();
    if (basePreviewSrc) {
      map.set(imageData.id, {
        id: imageData.id,
        src: basePreviewSrc,
        title: imageData.fileName || `图片 ${imageData.id}`,
      });
    }

    relatedHistoryImages.forEach((item) => {
      if (item.id && item.src && !map.has(item.id)) {
        map.set(item.id, item);
      }
    });

    return Array.from(map.values());
  }, [basePreviewSrc, imageData.fileName, imageData.id, relatedHistoryImages]);

  const activePreviewId = previewImageId ?? imageData.id;
  const activePreviewSrc = useMemo(() => {
    if (!previewCollection.length) return '';
    const target = previewCollection.find((item) => item.id === activePreviewId);
    return target?.src || previewCollection[0]?.src || '';
  }, [activePreviewId, previewCollection]);

  useEffect(() => {
    if (!showPreview) return;
    if (!previewCollection.length) return;
    const exists = previewCollection.some((item) => item.id === activePreviewId);
    if (!exists) {
      setPreviewImageId(previewCollection[0].id);
    }
  }, [activePreviewId, previewCollection, showPreview]);

  // 已简化 - 移除了所有鼠标事件处理逻辑，让Paper.js完全处理交互

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: screenBounds.x,
        top: screenBounds.y,
        width: screenBounds.width,
        height: screenBounds.height,
        zIndex: 10 + layerIndex * 2 + (isSelected ? 1 : 0), // 大幅降低z-index，确保在对话框下方
        cursor: 'default',
        userSelect: 'none',
        pointerEvents: 'none', // 让所有鼠标事件穿透到Paper.js
        display: visible ? 'block' : 'none' // 根据visible属性控制显示/隐藏
      }}
    >
      {/* 透明覆盖层，让交互穿透到Paper.js */}
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'transparent',
          pointerEvents: 'none'
        }}
      />

      {/* 扩图选择器 - 截图时显示，隐藏小工具栏 */}
      {showExpandSelector && (
        <ExpandImageSelector
          imageBounds={realTimeBounds}
          imageId={imageData.id}
          imageUrl={imageData.url || imageData.src || ''}
          onSelect={handleExpandSelect}
          onCancel={handleExpandCancel}
        />
      )}

      {/* 图片操作按钮组 - 只在选中时显示，位于图片底部，截图时隐藏 */}
      {isSelected && showIndividualTools && !showExpandSelector && (
        <div
          className={`absolute transition-all duration-150 ease-out ${
            !isPositionStable ? 'opacity-90 translate-y-1' : 'opacity-100 translate-y-0'
          }`}
          style={{
            bottom: -60,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30,
            pointerEvents: 'auto',
          }}
        >
          <div
            className="flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={isRemovingBackground}
              className={sharedButtonClass}
              onClick={handleBackgroundRemoval}
              title={isRemovingBackground ? '正在抠图...' : '一键抠图'}
              style={sharedButtonStyle}
            >
              {isRemovingBackground ? (
                <LoadingSpinner size="sm" className="text-blue-600" />
              ) : (
                <Wand2 className={sharedIconClass} />
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isConvertingTo3D}
              className={sharedButtonClass}
              onClick={handleConvertTo3D}
              title={isConvertingTo3D ? '正在转换3D...' : '2D转3D'}
              style={sharedButtonStyle}
            >
              {isConvertingTo3D ? (
                <LoadingSpinner size="sm" className="text-blue-600" />
              ) : (
                <Box className={sharedIconClass} />
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isOptimizingHd}
              className={sharedButtonClass}
              onClick={handleOptimizeHdImage}
              title={
                isOptimizingHd
                  ? '正在高清放大...'
                  : `高清放大（${HD_UPSCALE_RESOLUTION.toUpperCase()}）`
              }
              style={sharedButtonStyle}
            >
              {isOptimizingHd ? (
                <LoadingSpinner size="sm" className="text-blue-600" />
              ) : (
                <ImageUp className={sharedIconClass} />
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isExpandingImage || showExpandSelector}
              className={sharedButtonClass}
              onClick={handleExpandImage}
              title={isExpandingImage ? '正在扩图，预计需要8-10分钟，请耐心等待...' : showExpandSelector ? '请选择扩图区域' : '扩图（预计8-10分钟）'}
              style={sharedButtonStyle}
            >
              {isExpandingImage ? (
                <LoadingSpinner size="sm" className="text-blue-600" />
              ) : (
                <Crop className={sharedIconClass} />
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={sharedButtonClass}
              onClick={handleAIEdit}
              title="添加到AI对话框进行编辑"
              style={sharedButtonStyle}
            >
              <Sparkles className={sharedIconClass} />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={sharedButtonClass}
              onClick={handlePreview}
              title="全屏预览图片"
              style={sharedButtonStyle}
            >
              <Eye className={sharedIconClass} />
            </Button>

            {enableVisibilityToggle && (
              <Button
                variant="outline"
                size="sm"
                className={sharedButtonClass}
                onClick={handleToggleVisibility}
                title="隐藏图层（可在图层面板中恢复）"
                style={sharedButtonStyle}
              >
                <EyeOff className={sharedIconClass} />
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className={sharedButtonClass}
              onClick={handleCreateFlowImageNode}
              title="复制到Flow为Image节点"
              style={sharedButtonStyle}
            >
              <Copy className={sharedIconClass} />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className={cn(sharedButtonClass, 'text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete?.(imageData.id);
              }}
              title="删除图片"
              style={sharedButtonStyle}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* 图片预览模态框 */}
      <ImagePreviewModal
        isOpen={showPreview}
        imageSrc={activePreviewSrc}
        imageTitle={imageData.fileName || `图片 ${imageData.id}`}
        onClose={() => {
          setShowPreview(false);
          setPreviewImageId(null);
        }}
        imageCollection={previewCollection}
        currentImageId={activePreviewId}
        onImageChange={(imageId: string) => setPreviewImageId(imageId)}
        collectionTitle="项目内图片"
      />
    </div>
  );
};

export default ImageContainer;
