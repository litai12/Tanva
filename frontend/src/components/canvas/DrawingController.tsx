import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import paper from 'paper';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Download, Trash2 } from 'lucide-react';
import { useToolStore, useCanvasStore, useLayerStore } from '@/stores';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useProjectContentStore } from '@/stores/projectContentStore';
import ImageUploadComponent from './ImageUploadComponent';
import Model3DUploadComponent from './Model3DUploadComponent';
import Model3DContainer from './Model3DContainer';
import ImageContainer from './ImageContainer';
import SelectionGroupToolbar from './SelectionGroupToolbar';
import { DrawingLayerManager } from './drawing/DrawingLayerManager';
import { AutoScreenshotService } from '@/services/AutoScreenshotService';
import { logger } from '@/utils/logger';
import { ensureImageGroupStructure } from '@/utils/paperImageGroup';
import { BoundsCalculator } from '@/utils/BoundsCalculator';
import { contextManager } from '@/services/contextManager';
import { clipboardService, type CanvasClipboardData, type PathClipboardSnapshot } from '@/services/clipboardService';
import type { ImageAssetSnapshot, ModelAssetSnapshot, TextAssetSnapshot } from '@/types/project';
import ContextMenu from '@/components/ui/context-menu';

// 导入新的hooks
import { useImageTool } from './hooks/useImageTool';
import { useModel3DTool } from './hooks/useModel3DTool';
import { useDrawingTools } from './hooks/useDrawingTools';
import { useSelectionTool } from './hooks/useSelectionTool';
import { usePathEditor } from './hooks/usePathEditor';
import { useEraserTool } from './hooks/useEraserTool';
import { useInteractionController } from './hooks/useInteractionController';
import { useQuickImageUpload } from './hooks/useQuickImageUpload';
import { useSimpleTextTool } from './hooks/useSimpleTextTool';
import SimpleTextEditor from './SimpleTextEditor';
import TextSelectionOverlay from './TextSelectionOverlay';
import type { DrawingContext, ImageInstance } from '@/types/canvas';
import { paperSaveService } from '@/services/paperSaveService';
import { historyService } from '@/services/historyService';
import type { Model3DData } from '@/services/model3DUploadService';
import { clientToProject } from '@/utils/paperCoords';
import { downloadImage, getSuggestedFileName } from '@/utils/downloadHelper';
import { applyCursorForDrawMode } from '@/utils/cursorStyles';

const isInlineImageSource = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  return value.startsWith('data:image') || value.startsWith('blob:');
};

const extractLocalImageData = (imageData: unknown): string | null => {
  if (!imageData || typeof imageData !== 'object') return null;
  const candidates = ['localDataUrl', 'dataUrl', 'previewDataUrl'];
  for (const key of candidates) {
    const candidate = (imageData as Record<string, unknown>)[key];
    if (typeof candidate === 'string' && candidate.length > 0 && isInlineImageSource(candidate)) {
      return candidate;
    }
  }
  return null;
};

// 提取图片的任何可用源（优先 inline 数据，其次远程 URL）
const extractAnyImageSource = (imageData: unknown): string | null => {
  if (!imageData || typeof imageData !== 'object') return null;
  const data = imageData as Record<string, unknown>;

  // 优先使用 inline 数据（base64/blob）
  const localData = extractLocalImageData(imageData);
  if (localData) return localData;

  // 其次使用远程 URL
  const urlCandidates = ['url', 'src', 'remoteUrl'];
  for (const key of urlCandidates) {
    const candidate = data[key];
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.startsWith('http')) {
      return candidate;
    }
  }

  return null;
};

const isEditableElement = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  const anyEl = el as any;
  return !!anyEl?.isContentEditable;
};

const fileToDataURL = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const seemsImageUrl = (text: string): boolean => {
  if (!text || !/^https?:\/\//i.test(text)) return false;
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(text)) return true;
  return false;
};

const fetchImagePayload = async (url: string): Promise<string> => {
  let payload = url;
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    if (resp.ok) {
      const blob = await resp.blob();
      if (blob.type.startsWith('image/')) {
        payload = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      }
    }
  } catch {
    // ignore fetch errors and fall back to raw URL
  }
  return payload;
};

const CANVAS_CLIPBOARD_MIME = 'application/x-tanva-canvas';
const CANVAS_CLIPBOARD_FALLBACK_TEXT = 'Tanva canvas selection';
const CANVAS_CLIPBOARD_TYPE = 'tanva-canvas';

interface DrawingControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

type ContextMenuTargetType = 'canvas' | 'selection' | 'image' | 'model3d' | 'text' | 'path';

interface CanvasContextMenuState {
  x: number;
  y: number;
  type: ContextMenuTargetType;
  targetId?: string;
}

type HitTestTarget =
  | { type: 'image'; id: string }
  | { type: 'model3d'; id: string }
  | { type: 'text'; id?: string }
  | { type: 'path'; path: paper.Path }
  | null;

const DrawingController: React.FC<DrawingControllerProps> = ({ canvasRef }) => {
  const { drawMode, currentColor, fillColor, strokeWidth, isEraser, hasFill, setDrawMode } = useToolStore();
  const zoom = useCanvasStore((state) => state.zoom);
  const panX = useCanvasStore((state) => state.panX);
  const panY = useCanvasStore((state) => state.panY);
  const { toggleVisibility } = useLayerStore();
  const { setSourceImageForEditing, showDialog: showAIDialog } = useAIChatStore();
  const projectId = useProjectContentStore((s) => s.projectId);
  const projectAssets = useProjectContentStore((s) => s.content?.assets);
  const drawingLayerManagerRef = useRef<DrawingLayerManager | null>(null);
  const lastDrawModeRef = useRef<string>(drawMode);
  const [isGroupCapturePending, setIsGroupCapturePending] = useState(false);
  const [modelCapturePending, setModelCapturePending] = useState<Record<string, boolean>>({});
  const [contextMenuState, setContextMenuState] = useState<CanvasContextMenuState | null>(null);
  const handleCanvasPasteRef = useRef<() => boolean>(() => false);

  // 内存优化：使用 ref 存储频繁变化的值，避免闭包重建
  const zoomRef = useRef(zoom);
  const panRef = useRef({ x: panX, y: panY });

  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = { x: panX, y: panY };
  }, [zoom, panX, panY]);

  // 根据当前工具切换画布光标（图片/3D 工具展示对应图标）
  useEffect(() => {
    applyCursorForDrawMode(canvasRef.current, drawMode);

    return () => {
      applyCursorForDrawMode(canvasRef.current, null);
    };
  }, [canvasRef, drawMode]);

  // 初始化图层管理器
  useEffect(() => {
    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }

    // 初始化Paper.js保存服务
    paperSaveService.init();

    // Expose paperSaveService globally for testing (development only)
    if (import.meta.env.DEV) {
      (window as any).testPaperSave = () => {
        logger.debug('🧪 Testing Paper.js save manually...');
        paperSaveService.triggerAutoSave();
      };

      (window as any).testPaperState = () => {
        logger.debug('🔍 Paper.js状态检查:', {
          hasPaper: !!paper,
          hasProject: !!paper?.project,
          hasView: !!paper?.view,
          projectLayers: paper?.project?.layers?.length || 0,
          layerNames: paper?.project?.layers?.map(l => l.name) || []
        });
      };
    }

    // 监听 Paper.js 项目恢复事件
    const handleProjectRecovery = (_event: CustomEvent) => {
      logger.debug('🔄 收到Paper.js项目恢复请求，重新初始化图层管理器...');

      try {
        // 重新创建图层管理器
        if (drawingLayerManagerRef.current) {
          drawingLayerManagerRef.current.cleanup();
        }
        drawingLayerManagerRef.current = new DrawingLayerManager();

        // 触发 paper-ready 事件
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('paper-ready', {
            detail: { recovered: true, timestamp: Date.now() }
          }));
        }, 100);

        logger.debug('✅ Paper.js项目恢复完成');
      } catch (error) {
        console.error('❌ Paper.js项目恢复失败:', error);
      }
    };

    // 添加恢复事件监听器
    window.addEventListener('paper-project-recovery-needed', handleProjectRecovery as EventListener);

    return () => {
      if (drawingLayerManagerRef.current) {
        drawingLayerManagerRef.current.cleanup();
        drawingLayerManagerRef.current = null;
      }
      // 清理保存服务
      paperSaveService.cleanup();

      // 移除恢复事件监听器
      window.removeEventListener('paper-project-recovery-needed', handleProjectRecovery as EventListener);
    };
  }, []);

  // 确保绘图图层存在并激活
  const ensureDrawingLayer = () => {
    // 首先检查 Paper.js 项目状态
    if (!paper || !paper.project || !paper.view) {
      console.warn('⚠️ Paper.js项目未初始化，尝试恢复...');

      // 触发项目恢复
      window.dispatchEvent(new CustomEvent('paper-project-recovery-needed', {
        detail: { source: 'ensureDrawingLayer', timestamp: Date.now() }
      }));

      return null;
    }

    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }

    try {
      return drawingLayerManagerRef.current.ensureDrawingLayer();
    } catch (error) {
      console.error('❌ 确保绘图图层失败:', error);

      // 尝试重新创建图层管理器
      try {
        drawingLayerManagerRef.current = new DrawingLayerManager();
        return drawingLayerManagerRef.current.ensureDrawingLayer();
      } catch (retryError) {
        console.error('❌ 重试创建绘图图层失败:', retryError);
        return null;
      }
    }
  };

  // ========== 初始化绘图上下文 ==========
  const drawingContext: DrawingContext = {
    ensureDrawingLayer: () => ensureDrawingLayer() ?? useLayerStore.getState().ensureActiveLayer(),
    zoom,
  };

  // 内存优化：使用 ref 存储实例数组，避免大型闭包
  const imageInstancesRef = useRef<ImageInstance[]>([]);

  // ========== 初始化图片工具Hook ==========
  const imageTool = useImageTool({
    context: drawingContext,
    canvasRef,
    eventHandlers: {
      onImageSelect: (imageId) => logger.debug('图片选中:', imageId),
      onImageDeselect: () => logger.debug('取消图片选择'),
      onImageDelete: (imageId) => {
        try {
          // 尝试找到被删除的实例，提取其源数据用于同步到AI对话框
          const instance = imageInstancesRef.current.find((img) => img.id === imageId);
          const imageSourceForAI = instance ? extractAnyImageSource(instance.imageData) : null;
          if (!imageSourceForAI) return;

          const aiStore = useAIChatStore.getState();

          // 若当前编辑/分析源图就是这张，被删除后清空
          if (aiStore.sourceImageForEditing === imageSourceForAI) {
            aiStore.setSourceImageForEditing(null);
          }
          if (aiStore.sourceImageForAnalysis === imageSourceForAI) {
            aiStore.setSourceImageForAnalysis(null);
          }

          // 从多图融合列表中移除被删除的画布图片
          const blendIndex = aiStore.sourceImagesForBlending.findIndex(
            (img) => img === imageSourceForAI
          );
          if (blendIndex >= 0) {
            aiStore.removeImageFromBlending(blendIndex);
          }
        } catch (error) {
          console.warn('同步删除图片到AI对话框失败:', error);
        }
      }
    }
  });

  imageInstancesRef.current = imageTool.imageInstances;

  // ========== 初始化快速图片上传Hook ==========
  const quickImageUpload = useQuickImageUpload({
    context: drawingContext,
    canvasRef,
    projectId,
  });
  const uploadImageToCanvas = quickImageUpload.handleQuickImageUploaded;
  // ========== 监听drawMode变化，处理快速上传 ==========
  useEffect(() => {
    // 只在drawMode变化时触发，避免重复触发
    if (drawMode === 'quick-image' && lastDrawModeRef.current !== 'quick-image') {
      logger.tool('触发快速图片上传');
      quickImageUpload.triggerQuickImageUpload();
      // 触发后立即切换回选择模式
      setTimeout(() => {
        setDrawMode('select');
      }, 100);
    }
    lastDrawModeRef.current = drawMode;
  }, [drawMode, quickImageUpload, setDrawMode]);

  // ========== 监听快速上传的图片并添加到实例管理 ==========
  useEffect(() => {
    const handleQuickImageAdded = (event: CustomEvent) => {
      const imageInstance = event.detail;
      logger.debug('🎪 [DEBUG] DrawingController收到quickImageAdded事件:', {
        id: imageInstance.id,
        bounds: imageInstance.bounds,
        layerId: imageInstance.layerId,
        hasRemoteUrl: !!(imageInstance.imageData?.url && !imageInstance.imageData.url.startsWith('data:')),
        hasInlineData: !!(imageInstance.imageData?.src && imageInstance.imageData.src.startsWith('data:')),
      });

      if (imageInstance) {
        const alreadyExists = imageTool.imageInstances.some(inst => inst.id === imageInstance.id);
        if (!alreadyExists) {
          imageTool.setImageInstances(prev => [...prev, imageInstance]);
          logger.upload('快速上传的图片已添加到实例管理');
          logger.debug('✅ [DEBUG] 图片实例已添加到imageTool管理');
        } else {
          logger.debug('ℹ️ [DEBUG] quickImageAdded: 实例已存在，跳过重复添加', imageInstance.id);
        }

        // 同步缓存位置信息（如果该图片刚被缓存为最新）
        try {
          const cached = contextManager.getCachedImage();
          const rawSource = imageInstance.imageData?.src;
          const inlineSource = isInlineImageSource(rawSource) ? rawSource : null;
          const localDataUrl = extractLocalImageData(imageInstance.imageData);
          const imageDataForCache = inlineSource || localDataUrl || cached?.imageData || null;
          const remoteUrl = (() => {
            if (inlineSource) {
              return imageInstance.imageData?.url ?? cached?.remoteUrl ?? null;
            }
            if (typeof rawSource === 'string' && rawSource.length > 0) {
              return rawSource;
            }
            if (typeof imageInstance.imageData?.url === 'string' && imageInstance.imageData.url.length > 0) {
              return imageInstance.imageData.url;
            }
            return cached?.remoteUrl ?? null;
          })();

          if (imageDataForCache) {
            contextManager.cacheLatestImage(
              imageDataForCache,
              imageInstance.id,
              cached?.prompt || '快速上传图片',
              {
                bounds: imageInstance.bounds,
                layerId: imageInstance.layerId,
                remoteUrl
              }
            );
            logger.debug('🧷 已将图片位置信息写入缓存（覆盖为当前实例）:', { id: imageInstance.id, bounds: imageInstance.bounds });
          } else {
            console.warn('⚠️ 未找到可缓存的图像数据，保持现有缓存', {
              imageId: imageInstance.id,
              hasInlineSource: !!inlineSource,
              hasLocalDataUrl: !!localDataUrl,
              hadCachedImage: !!cached?.imageData,
              hasRemoteUrl: !!remoteUrl
            });
          }
        } catch (e) {
          console.warn('写入缓存位置信息失败:', e);
        }
      }
    };

    window.addEventListener('quickImageAdded', handleQuickImageAdded as EventListener);

    return () => {
      window.removeEventListener('quickImageAdded', handleQuickImageAdded as EventListener);
    };
  }, [imageTool]);

  // ========== 粘贴到画布：从剪贴板粘贴图片 ==========
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      void (async () => {
        try {
          // 若焦点在可编辑元素中，放行默认粘贴行为
          const active = document.activeElement as Element | null;
          if (isEditableElement(active)) return;

          const clipboardData = e.clipboardData;
          if (!clipboardData) return;

          // 先尝试处理画布内的结构化剪贴板数据
          const rawCanvasData =
            clipboardData.getData(CANVAS_CLIPBOARD_MIME) ||
            clipboardData.getData('application/json');
          if (rawCanvasData) {
            try {
              const parsed = JSON.parse(rawCanvasData);
              const payload: CanvasClipboardData | null =
                parsed?.type === CANVAS_CLIPBOARD_TYPE ? parsed.data : (parsed?.images && parsed?.paths ? parsed : null);
              if (payload) {
                clipboardService.setCanvasData(payload);
                const handled = handleCanvasPasteRef.current();
                if (handled) {
                  e.preventDefault();
                  return;
                }
              }
            } catch (err) {
              logger.warn('解析画布剪贴板数据失败', err);
            }
          }

          // 优先处理图片项
          const items = clipboardData.items;
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item && item.kind === 'file' && item.type.startsWith('image/')) {
              const file = item.getAsFile();
              if (!file) continue;

              // 阻止默认粘贴（避免在页面其它位置插入）
              e.preventDefault();
              try {
                const dataUrl = await fileToDataURL(file);
                // 直接复用快速上传放置逻辑，默认落在视口中心
                await uploadImageToCanvas?.(dataUrl, file.name);
              } catch (err) {
                console.error('粘贴图片处理失败:', err);
              }
              return; // 已处理首个图片项
            }
          }

          // 无图片项时，尝试处理文本中的图片URL
          const text = clipboardData.getData('text/plain')?.trim();
          if (text && seemsImageUrl(text)) {
            e.preventDefault();
            try {
              const payload = await fetchImagePayload(text);
              await uploadImageToCanvas?.(payload, undefined);
            } catch (err) {
              console.error('粘贴URL处理失败:', err);
            }
          }
        } catch (err) {
          console.error('处理粘贴事件出错:', err);
        }
      })();
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [uploadImageToCanvas]);

  // ========== 拖拽图片到画布 ==========
  useEffect(() => {
    const isEventInsideCanvas = (event: DragEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const { clientX, clientY } = event;
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    };

    const handleDragOver = (event: DragEvent) => {
      if (!isEventInsideCanvas(event)) return;
      const items = Array.from(event.dataTransfer?.items || []);
      const _hasImageFile = items.some((item) => item.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/'));
      const _hasPotentialUrl = items.some((item) => item.kind === 'string');
      // 只要落在画布上且存在可处理的条目就阻止默认行为，避免浏览器打开文件
      event.preventDefault();
      try {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
      } catch {
        // ignore
      }
    };

    const handleDrop = (event: DragEvent) => {
      void (async () => {
        if (!isEventInsideCanvas(event)) return;
        const canvas = canvasRef.current;
        if (!canvas || !paper?.project) return;
        const dt = event.dataTransfer;
        if (!dt) return;

        const projectPoint = clientToProject(canvas, event.clientX, event.clientY);
        const imageFiles = Array.from(dt.files || []).filter((file) => file.type && file.type.startsWith('image/'));

        if (imageFiles.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          const file = imageFiles[0];
          try {
            const dataUrl = await fileToDataURL(file);
            await uploadImageToCanvas?.(dataUrl, file.name, undefined, { x: projectPoint.x, y: projectPoint.y }, 'manual');
          } catch (err) {
            console.error('处理拖拽图片失败:', err);
          }
          return;
        }

        const uriList = dt.getData('text/uri-list');
        const plainText = dt.getData('text/plain');
        const text = (uriList || plainText || '').trim();
        if (!text || !seemsImageUrl(text)) return;

        event.preventDefault();
        event.stopPropagation();
        try {
          const payload = await fetchImagePayload(text);
          await uploadImageToCanvas?.(payload, undefined, undefined, { x: projectPoint.x, y: projectPoint.y }, 'manual');
        } catch (err) {
          console.error('拖拽图片链接处理失败:', err);
        }
      })();
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [canvasRef, uploadImageToCanvas]);

  // ========== 监听AI生成图片的快速上传触发事件 ==========
  useEffect(() => {
    const handleTriggerQuickUpload = (event: CustomEvent) => {
      const {
        imageData,
        fileName,
        selectedImageBounds,
        smartPosition,
        operationType,
        sourceImageId,
        sourceImages,
        videoInfo,
        placeholderId,
        preferHorizontal  // 🔥 新增：是否优先横向排列
      } = event.detail;

      logger.debug('🎨 [DEBUG] 收到AI图片快速上传触发事件:', {
        fileName,
        hasSelectedBounds: !!selectedImageBounds,
        hasSmartPosition: !!smartPosition,
        operationType,
        sourceImageId,
        sourceImages: sourceImages?.length,
        preferHorizontal
      });

      if (imageData && quickImageUpload.handleQuickImageUploaded) {
        // 直接调用快速上传的处理函数，传递智能排版相关参数
        quickImageUpload.handleQuickImageUploaded(
          imageData,
          fileName,
          selectedImageBounds,
          smartPosition,
          operationType,
          sourceImageId,
          sourceImages,
          { videoInfo, placeholderId, preferHorizontal }  // 🔥 传递 preferHorizontal
        );
        logger.debug('✅ [DEBUG] 已调用智能排版快速上传处理函数');
      }
    };

    window.addEventListener('triggerQuickImageUpload', handleTriggerQuickUpload as EventListener);

    return () => {
      window.removeEventListener('triggerQuickImageUpload', handleTriggerQuickUpload as EventListener);
    };
  }, [quickImageUpload]);

  // 使用 ref 存储 quickImageUpload 的最新引用，避免 useEffect 重复执行
  const quickImageUploadRef = useRef(quickImageUpload);
  useEffect(() => {
    quickImageUploadRef.current = quickImageUpload;
  }, [quickImageUpload]);

  // 监听预测占位符事件，提前在画布上标记预计位置与尺寸
  useEffect(() => {
    const handlePredictPlaceholder = (event: CustomEvent) => {
      console.log('🎯 [DrawingController] 收到占位符事件:', event.detail);
      const detail = event.detail || {};
      const action = detail.action || 'add';
      const placeholderId = detail.placeholderId as string | undefined;
      const preferSmartLayout = Boolean(detail.preferSmartLayout);
      const smartPosition = detail.smartPosition as { x: number; y: number } | undefined;
      const sourceImageId = detail.sourceImageId as string | undefined;
      const sourceImages = detail.sourceImages as string[] | undefined;

      if (!placeholderId) {
        console.warn('🎯 [DrawingController] 缺少 placeholderId');
        return;
      }

      if (action === 'remove') {
        console.log('🎯 [DrawingController] 移除占位符:', placeholderId);
        quickImageUploadRef.current.removePredictedPlaceholder(placeholderId);
        return;
      }

      const groupId = detail.groupId as string | undefined;
      const groupIndex = typeof detail.groupIndex === 'number' ? detail.groupIndex : undefined;
      const groupTotal = typeof detail.groupTotal === 'number' ? detail.groupTotal : undefined;
      const preferHorizontal = Boolean(detail.preferHorizontal);
      const groupAnchor = detail.groupAnchor as { x: number; y: number } | undefined;
      const center = detail.center as { x: number; y: number } | undefined;
      const width = detail.width as number | undefined;
      const height = detail.height as number | undefined;
      const operationType = detail.operationType as string | undefined;
      const layoutAnchor = groupAnchor || center || smartPosition || null;

      console.log('🎯 [DrawingController] 占位符参数:', { center, width, height, operationType, groupId, groupIndex, groupTotal });

      let resolvedCenter = center;
      if ((preferSmartLayout || !resolvedCenter) && typeof quickImageUploadRef.current.calculateSmartPosition === 'function') {
        const smart = smartPosition ??
          quickImageUploadRef.current.calculateSmartPosition(
            operationType || 'generate',
            sourceImageId,
            sourceImages,
            placeholderId,
            {
              groupId,
              groupIndex,
              groupTotal,
              anchorCenter: layoutAnchor,
              preferHorizontal
            }
          );
        if (smart && Number.isFinite(smart.x) && Number.isFinite(smart.y)) {
          resolvedCenter = { x: smart.x, y: smart.y };
          console.log('🎯 [DrawingController] 使用智能排版位置:', resolvedCenter);
        }
      }

      if (!resolvedCenter && paper?.view?.center) {
        resolvedCenter = { x: paper.view.center.x, y: paper.view.center.y };
      }

      if (!resolvedCenter || typeof width !== 'number' || typeof height !== 'number') {
        console.warn('🎯 [DrawingController] 参数不完整，跳过显示');
        return;
      }

      console.log('🎯 [DrawingController] 调用 showPredictedPlaceholder');
      quickImageUploadRef.current.showPredictedPlaceholder({
        placeholderId,
        center: resolvedCenter,
        width,
        height,
        operationType,
        preferSmartLayout,
        smartPosition,
        sourceImageId,
        sourceImages,
        groupId,
        groupIndex,
        groupTotal,
        preferHorizontal,
        groupAnchor: layoutAnchor || undefined
      });
    };

    window.addEventListener('predictImagePlaceholder', handlePredictPlaceholder as EventListener);
    console.log('🎯 [DrawingController] 已注册占位符事件监听器');
    return () => {
      window.removeEventListener('predictImagePlaceholder', handlePredictPlaceholder as EventListener);
    };
  }, []); // 空依赖数组，只注册一次

  // 监听占位符进度更新事件
  useEffect(() => {
    const handleUpdateProgress = (event: CustomEvent) => {
      const detail = event.detail || {};
      const placeholderId = detail.placeholderId as string | undefined;
      const progress = detail.progress as number | undefined;

      if (!placeholderId || typeof progress !== 'number') return;

      quickImageUploadRef.current.updatePlaceholderProgress(placeholderId, progress);
    };

    window.addEventListener('updatePlaceholderProgress', handleUpdateProgress as EventListener);
    return () => {
      window.removeEventListener('updatePlaceholderProgress', handleUpdateProgress as EventListener);
    };
  }, []); // 空依赖数组，只注册一次

  // ========== 初始化3D模型工具Hook ==========
  const model3DTool = useModel3DTool({
    context: drawingContext,
    canvasRef,
    eventHandlers: {
      onModel3DSelect: (modelId) => logger.debug('3D模型选中:', modelId),
      onModel3DDeselect: () => logger.debug('取消3D模型选择')
    },
    setDrawMode
  });

  // 内存优化：3D模型实例也使用 ref
  const model3DInstancesRef = useRef(model3DTool.model3DInstances);
  useEffect(() => {
    model3DInstancesRef.current = model3DTool.model3DInstances;
  }, [model3DTool.model3DInstances]);

  useEffect(() => {
    const handleInsertModelFromLibrary = (event: CustomEvent) => {
      const detail = event.detail as { 
        modelData?: Partial<Model3DData>; 
        size?: { width: number; height: number };
        position?: { start: { x: number; y: number }; end: { x: number; y: number } };
      } | undefined;
      if (!detail?.modelData) return;
      
      // 如果提供了位置信息，使用提供的位置；否则使用画布中心
      let start: paper.Point;
      let end: paper.Point;
      
      if (detail.position) {
        // 使用提供的位置（例如从图片旁边）
        start = new paper.Point(detail.position.start.x, detail.position.start.y);
        end = new paper.Point(detail.position.end.x, detail.position.end.y);
      } else {
        // 默认使用画布中心
        const center = paper?.view?.center ?? new paper.Point(0, 0);
        const width = detail.size?.width ?? 320;
        const height = detail.size?.height ?? 240;
        start = new paper.Point(center.x - width / 2, center.y - height / 2);
        end = new paper.Point(center.x + width / 2, center.y + height / 2);
      }
      
      const placeholder = model3DTool.create3DModelPlaceholder(start, end);
      if (!placeholder) return;
      model3DTool.currentModel3DPlaceholderRef.current = placeholder;
      const normalized: Model3DData = {
        url: detail.modelData.url || detail.modelData.path || '',
        path: detail.modelData.path || detail.modelData.url || '',
        key: detail.modelData.key,
        format: detail.modelData.format || 'glb',
        fileName: detail.modelData.fileName || '模型.glb',
        fileSize: detail.modelData.fileSize ?? 0,
        defaultScale: detail.modelData.defaultScale || { x: 1, y: 1, z: 1 },
        defaultRotation: detail.modelData.defaultRotation || { x: 0, y: 0, z: 0 },
        timestamp: detail.modelData.timestamp || Date.now(),
        camera: detail.modelData.camera,
      };
      model3DTool.handleModel3DUploaded(normalized);
    };

    window.addEventListener('canvas:insert-model3d', handleInsertModelFromLibrary as EventListener);
    return () => window.removeEventListener('canvas:insert-model3d', handleInsertModelFromLibrary as EventListener);
  }, [model3DTool]);

  // ========== 初始化绘图工具Hook ==========
  const drawingTools = useDrawingTools({
    context: drawingContext,
    currentColor,
    fillColor,
    strokeWidth,
    isEraser,
    hasFill,
    eventHandlers: {
      onPathCreate: (path) => {
        logger.debug('路径创建:', path);
      },
      onPathComplete: (path) => {
        logger.debug('路径完成:', path);

        // 检查 Paper.js 项目状态后再触发保存
        if (paper && paper.project && paper.view) {
          paperSaveService.triggerAutoSave();
        } else {
          console.warn('⚠️ Paper.js项目状态异常，跳过自动保存');
        }
      },
      onDrawStart: (mode) => {
        logger.debug('开始绘制:', mode);
      },
      onDrawEnd: (mode) => {
        logger.debug('结束绘制:', mode);

        // 检查 Paper.js 项目状态后再触发保存
        if (paper && paper.project && paper.view) {
          paperSaveService.triggerAutoSave();
        } else {
          console.warn('⚠️ Paper.js项目状态异常，跳过自动保存');
        }
      }
    }
  });

  // ========== 初始化路径编辑器Hook ==========
  const pathEditor = usePathEditor({
    zoom
  });

  // ========== 初始化橡皮擦工具Hook ==========
  const eraserTool = useEraserTool({
    context: drawingContext,
    strokeWidth
  });

  // ========== 初始化简单文本工具Hook ==========
  const simpleTextTool = useSimpleTextTool({
    currentColor,
    ensureDrawingLayer: drawingContext.ensureDrawingLayer,
  });

  // ========== 初始化选择工具Hook ==========
  const selectionTool = useSelectionTool({
    zoom,
    imageInstances: imageTool.imageInstances,
    model3DInstances: model3DTool.model3DInstances,
    textItems: simpleTextTool.textItems,
    onImageSelect: (imageId, addToSelection) => {
      // 先执行原有选择逻辑
      imageTool.handleImageSelect(imageId, addToSelection);
      try {
        // 在当前实例列表中查找该图片，获取其最新bounds
        const img = imageTool.imageInstances.find(i => i.id === imageId);
        if (img && img.bounds) {
          const cachedBeforeSelect = contextManager.getCachedImage();
          const primarySource = img.imageData?.src ?? img.imageData?.url;
          const inlineSource = isInlineImageSource(primarySource) ? primarySource : null;
          const localDataUrl = extractLocalImageData(img.imageData);
          // 🔥 不再使用 cachedBeforeSelect?.imageData 作为 fallback，避免显示错误的图片
          const imageDataForCache = inlineSource || localDataUrl || null;
          const remoteUrl = (() => {
            if (inlineSource) {
              return img.imageData?.url ?? cachedBeforeSelect?.remoteUrl ?? null;
            }
            if (typeof primarySource === 'string' && primarySource.length > 0) {
              return primarySource;
            }
            if (typeof img.imageData?.url === 'string' && img.imageData.url.length > 0) {
              return img.imageData.url;
            }
            return null; // 🔥 不再使用 cachedBeforeSelect?.remoteUrl
          })();

          // 将该图片作为最新缓存，并写入位置信息（中心通过bounds在需要时计算）
          const dataToCache = imageDataForCache || remoteUrl;
          if (dataToCache) {
            contextManager.cacheLatestImage(
              dataToCache,
              img.id,
              '用户选择的图片',
              {
                bounds: img.bounds,
                layerId: img.layerId,
                remoteUrl
              }
            );
            logger.debug('📌 已基于选中图片更新缓存位置:', { id: img.id, bounds: img.bounds });
          } else {
            console.warn('⚠️ 选中图片缺少可缓存的数据，跳过缓存更新', {
              imageId,
              hasInlineSource: !!inlineSource,
              hasLocalDataUrl: !!localDataUrl,
              hasRemoteUrl: !!remoteUrl
            });
          }

          // 🔥 同步选中图片到AI对话框
          // 优先使用 inline 数据，其次使用远程 URL
          const imageSourceForAI = imageDataForCache || remoteUrl;
          if (addToSelection) {
            // 多选模式：收集所有选中图片的数据
            const allSelectedImages: string[] = [];
            // 先添加已选中的图片
            for (const instance of imageTool.imageInstances) {
              if (instance.isSelected && instance.id !== imageId) {
                const data = extractAnyImageSource(instance.imageData);
                if (data) allSelectedImages.push(data);
              }
            }
            // 添加当前选中的图片
            if (imageSourceForAI) allSelectedImages.push(imageSourceForAI);
            useAIChatStore.getState().setSourceImagesFromCanvas(allSelectedImages);
          } else {
            // 单选模式：只设置当前图片
            if (imageSourceForAI) {
              useAIChatStore.getState().setSourceImagesFromCanvas([imageSourceForAI]);
            }
          }
        }
      } catch (e) {
        console.warn('更新缓存位置失败:', e);
      }
    },
    onImageMultiSelect: (imageIds) => {
      // 先执行原有多选逻辑
      imageTool.handleImageMultiSelect(imageIds);

      // 🔥 同步多选图片到AI对话框
      try {
        const selectedImages: string[] = [];
        for (const id of imageIds) {
          const img = imageTool.imageInstances.find(i => i.id === id);
          if (img) {
            const imageData = extractAnyImageSource(img.imageData);
            if (imageData) selectedImages.push(imageData);
          }
        }
        useAIChatStore.getState().setSourceImagesFromCanvas(selectedImages);
      } catch (e) {
        console.warn('同步多选图片到AI对话框失败:', e);
      }
    },
    onModel3DSelect: model3DTool.handleModel3DSelect,
    onModel3DMultiSelect: model3DTool.handleModel3DMultiSelect,
    onImageDeselect: () => {
      // 先执行原有取消选择逻辑
      imageTool.handleImageDeselect();
      // 🔥 清空AI对话框中的图片
      useAIChatStore.getState().setSourceImagesFromCanvas([]);
    },
    onModel3DDeselect: model3DTool.handleModel3DDeselect,
    onTextSelect: (textId, addToSelection) => {
      if (addToSelection) {
        // 多选模式：保持现有选择
        simpleTextTool.selectText(textId, true);
      } else {
        // 单选模式：取消其他选择
        simpleTextTool.deselectText();
        simpleTextTool.selectText(textId, false);
      }
    },
    onTextMultiSelect: (textIds) => {
      simpleTextTool.selectMultipleTexts(textIds);
    },
    onTextDeselect: () => {
      simpleTextTool.deselectText();
    }
  });

  const selectedTextItems = useMemo(
    () => simpleTextTool.textItems.filter((item) => item.isSelected && item.paperText),
    [simpleTextTool.textItems]
  );

  const hasSelection = useMemo(() => {
    const imageCount = imageTool.selectedImageIds?.length ?? 0;
    const modelCount = model3DTool.selectedModel3DIds?.length ?? 0;
    const pathCount =
      (selectionTool.selectedPath ? 1 : 0) + (selectionTool.selectedPaths?.length ?? 0);
    const textCount = selectedTextItems.length;
    return imageCount > 0 || modelCount > 0 || pathCount > 0 || textCount > 0;
  }, [
    imageTool.selectedImageIds,
    model3DTool.selectedModel3DIds,
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    selectedTextItems,
  ]);

  const hasSelectionRef = useRef(hasSelection);
  useEffect(() => {
    hasSelectionRef.current = hasSelection;
  }, [hasSelection]);

  const selectionSnapshotRef = useRef<{
    imageIds: string[];
    modelIds: string[];
    textId: string | null;
    paths: paper.Path[];
  }>({
    imageIds: [],
    modelIds: [],
    textId: null,
    paths: [],
  });

  useEffect(() => {
    selectionSnapshotRef.current = {
      imageIds: [...(imageTool.selectedImageIds ?? [])],
      modelIds: [...(model3DTool.selectedModel3DIds ?? [])],
      textId: simpleTextTool.selectedTextId ?? null,
      paths: [
        ...(selectionTool.selectedPath ? [selectionTool.selectedPath] : []),
        ...((selectionTool.selectedPaths ?? []) as paper.Path[]),
      ].filter((path): path is paper.Path => !!path),
    };
  }, [
    imageTool.selectedImageIds,
    model3DTool.selectedModel3DIds,
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    simpleTextTool.selectedTextId,
  ]);

  const {
    createImageFromSnapshot,
    handleImageMultiSelect,
    setSelectedImageIds,
  } = imageTool;
  const {
    createModel3DFromSnapshot,
    handleModel3DMultiSelect,
    setSelectedModel3DIds,
  } = model3DTool;
  const {
    clearAllSelections,
    setSelectedPaths,
    setSelectedPath,
    handlePathSelect: selectToolHandlePathSelect,
  } = selectionTool;
  const {
    createText: createSimpleText,
    stopEditText,
    selectText: selectSimpleText,
    deselectText: deselectSimpleText,
    deleteText: deleteSimpleText,
  } = simpleTextTool;
  const modelPlaceholderRef = model3DTool.currentModel3DPlaceholderRef;
  const resetImageInstances = imageTool.setImageInstances;
  const resetSelectedImageIds = imageTool.setSelectedImageIds;
  const resetModelInstances = model3DTool.setModel3DInstances;
  const resetModelSelections = model3DTool.setSelectedModel3DIds;
  const clearTextItems = simpleTextTool.clearAllTextItems;
  const clearSelections = selectionTool.clearAllSelections;
  const imagePlaceholderRef = imageTool.currentPlaceholderRef;

  useEffect(() => {
    const handlePaperCleared = () => {
      logger.debug('🧹 收到 paper-project-cleared 事件，重置前端实例状态');

      resetImageInstances([]);
      resetSelectedImageIds([]);
      if (imagePlaceholderRef?.current) {
        try { imagePlaceholderRef.current.remove(); } catch {}
        imagePlaceholderRef.current = null;
      }

      resetModelInstances([]);
      resetModelSelections([]);
      if (modelPlaceholderRef?.current) {
        try { modelPlaceholderRef.current.remove(); } catch {}
        modelPlaceholderRef.current = null;
      }

      clearTextItems();
      clearSelections();

      try { (window as any).tanvaImageInstances = []; } catch {}
      try { (window as any).tanvaModel3DInstances = []; } catch {}
      try { (window as any).tanvaTextItems = []; } catch {}
    };

    window.addEventListener('paper-project-cleared', handlePaperCleared);
    return () => {
      window.removeEventListener('paper-project-cleared', handlePaperCleared);
    };
  }, [
    resetImageInstances,
    resetSelectedImageIds,
    resetModelInstances,
    resetModelSelections,
    clearTextItems,
    clearSelections,
    imagePlaceholderRef,
    modelPlaceholderRef
  ]);

  // 记录上一次处理的 projectId，避免重复清空
  const lastProcessedProjectIdRef = useRef<string | null>(null);
  const clearingInProgressRef = useRef(false);

  // 🔄 当 projectId 变化时，清空所有实例状态，防止旧项目数据残留
  useEffect(() => {
    if (!projectId) return; // 避免初始化时清空

    // 避免对同一个 projectId 重复执行清空操作
    if (lastProcessedProjectIdRef.current === projectId) {
      return;
    }

    // 避免并发执行
    if (clearingInProgressRef.current) {
      return;
    }

    lastProcessedProjectIdRef.current = projectId;
    clearingInProgressRef.current = true;

    logger.debug('🔄 项目ID变化，清空所有实例:', projectId);

    // 直接同步执行，但使用稳定的函数引用
    try {
      // 清空图片实例
      imageTool.setImageInstances([]);
      imageTool.setSelectedImageIds([]);

      // 清空3D模型实例
      model3DTool.setModel3DInstances([]);
      model3DTool.setSelectedModel3DIds([]);

      // 清空文本实例
      simpleTextTool.clearAllTextItems();

      // 清空选择工具状态
      selectionTool.clearAllSelections();
    } finally {
      clearingInProgressRef.current = false;
    }
  }, [projectId, imageTool, model3DTool, simpleTextTool, selectionTool]);

  useEffect(() => {
    if (!projectAssets) return;
    if (!paper || !paper.project) return;

    // 只允许进行一次基于快照的初始回填，避免用户删除后又被回填复原
    const hydratedFlagKey = '__tanva_initial_assets_hydrated__';
    const alreadyHydrated = typeof window !== 'undefined' && (window as any)[hydratedFlagKey];
    if (alreadyHydrated) return;

    // 如果已经从 paperJson 恢复过内容，则这次也不需要 snapshot 回填
    const restoredFromPaper = typeof window !== 'undefined' && (window as any).tanvaPaperRestored;
    if (restoredFromPaper) {
      logger.debug('🛑 检测到已从 paperJson 恢复，跳过 snapshot 回填以避免重复');
      try { (window as any).tanvaPaperRestored = false; } catch {}
      // 视为已回填一次，避免后续空场景再次触发
      try { (window as any)[hydratedFlagKey] = true; } catch {}
      return;
    }

    const hasExisting =
      imageTool.imageInstances.length > 0 ||
      model3DTool.model3DInstances.length > 0 ||
      simpleTextTool.textItems.length > 0;
    if (hasExisting) return;

    try {
      if (projectAssets.images?.length) {
        imageTool.hydrateFromSnapshot(projectAssets.images);
      }
      if (projectAssets.models?.length) {
        model3DTool.hydrateFromSnapshot(projectAssets.models);
      }
      if (projectAssets.texts?.length) {
        simpleTextTool.hydrateFromSnapshot(projectAssets.texts);
      }
      // 标记为已回填
      try { (window as any)[hydratedFlagKey] = true; } catch {}
    } catch (error) {
      console.warn('资产回填失败:', error);
    }
  }, [
    projectAssets,
    imageTool.imageInstances,
    model3DTool.model3DInstances,
    simpleTextTool.textItems,
    imageTool.hydrateFromSnapshot,
    model3DTool.hydrateFromSnapshot,
    simpleTextTool.hydrateFromSnapshot,
  ]);

  // 暴露文本工具状态到全局，供工具栏使用
  useEffect(() => {
    (window as any).tanvaTextTool = simpleTextTool;
  }, [simpleTextTool]);

  // ========== 截图功能处理 ==========
  const currentSelectedPath = selectionTool.selectedPath;
  const currentSelectedPaths = selectionTool.selectedPaths;
  const currentSelectedImageIds = imageTool.selectedImageIds;
  const currentSelectedModelIds = model3DTool.selectedModel3DIds;

  const handleScreenshot = useCallback(async () => {
    try {
      logger.debug('🖼️ 用户触发截图...');

      // 延迟一点，确保UI状态稳定
      await new Promise(resolve => setTimeout(resolve, 100));

      // 使用 ref 获取最新实例，避免闭包捕获大量数据
      const currentImageInstances = imageInstancesRef.current;
      const currentModel3DInstances = model3DInstancesRef.current;

      // 调试信息
      logger.debug('截图前的状态:', {
        imageCount: currentImageInstances.length,
        model3DCount: currentModel3DInstances.length,
        images: currentImageInstances,
        models: currentModel3DInstances
      });

      // 使用带回调的截图模式，同时下载和传入AI对话框
      const selectedPaperItemsSet = new Set<paper.Item>();
      if (currentSelectedPath) {
        selectedPaperItemsSet.add(currentSelectedPath);
      }
      if (Array.isArray(currentSelectedPaths)) {
        currentSelectedPaths.forEach((path) => {
          if (path) selectedPaperItemsSet.add(path);
        });
      }
      simpleTextTool.textItems
        .filter((item) => item.isSelected && item.paperText)
        .forEach((item) => selectedPaperItemsSet.add(item.paperText));

      const manualSelection = {
        paperItems: Array.from(selectedPaperItemsSet),
        imageIds: Array.isArray(currentSelectedImageIds) ? [...currentSelectedImageIds] : [],
        modelIds: Array.isArray(currentSelectedModelIds) ? [...currentSelectedModelIds] : [],
      };

      const result = await AutoScreenshotService.captureAutoScreenshot(
        currentImageInstances,
        currentModel3DInstances,
        {
          format: 'png',
          quality: 0.92,
          scale: 2,
          padding: 0, // 无边距，与内容尺寸完全一致
          autoDownload: true, // 同时下载文件，方便检查质量
          filename: 'artboard-screenshot',
          selection: manualSelection,
          // 截图完成后的回调，直接传入AI聊天
          onComplete: (dataUrl: string, filename: string) => {
            logger.debug('🎨 截图完成，同时下载文件和传入AI对话框...', { filename });

            // 将截图设置为AI编辑源图片
            setSourceImageForEditing(dataUrl);

            // 显示AI对话框
            showAIDialog();

            logger.debug('✅ 截图已下载到本地并传入AI对话框');
          }
        }
      );

      if (result.success) {
        logger.debug('✅ 截图成功生成:', result.filename);
        logger.debug('截图成功！已下载到本地并传入AI对话框:', result.filename);
      } else {
        logger.error('❌ 截图失败:', result.error);
        console.error('截图失败:', result.error);
        alert(`截图失败: ${result.error}`);
      }

    } catch (error) {
      logger.error('截图过程出错:', error);
      console.error('截图过程出错:', error);
      alert('截图失败，请重试');
    } finally {
      // 无论成功失败，都切换回选择模式
      setDrawMode('select');
    }
  }, [
    currentSelectedPath,
    currentSelectedPaths,
    currentSelectedImageIds,
    currentSelectedModelIds,
    // 移除 imageTool.imageInstances 和 model3DTool.model3DInstances 依赖
    // 改用 refs，避免每次实例变化都重建回调
    setDrawMode,
    setSourceImageForEditing,
    showAIDialog
  ]);

  // 监听截图工具的激活
  useEffect(() => {
    if (drawMode === 'screenshot') {
      // 当选择截图工具时，立即执行截图
      handleScreenshot();
    }
  }, [drawMode, handleScreenshot]);

  // ========== 组合选择工具栏 ==========
  const selectedImageInstances = useMemo(() => {
    if (!imageTool.selectedImageIds?.length) return [];
    const set = new Set(imageTool.selectedImageIds);
    return imageTool.imageInstances.filter((instance) => set.has(instance.id));
  }, [imageTool.imageInstances, imageTool.selectedImageIds]);

  const selectedModelInstances = useMemo(() => {
    if (!model3DTool.selectedModel3DIds?.length) return [];
    const set = new Set(model3DTool.selectedModel3DIds);
    return model3DTool.model3DInstances.filter((instance) => set.has(instance.id));
  }, [model3DTool.model3DInstances, model3DTool.selectedModel3DIds]);

  const selectedPaperItems = useMemo(() => {
    const set = new Set<paper.Item>();
    if (selectionTool.selectedPath) set.add(selectionTool.selectedPath);
    if (Array.isArray(selectionTool.selectedPaths)) {
      selectionTool.selectedPaths.forEach((item) => {
        if (item) set.add(item);
      });
    }
    selectedTextItems.forEach(({ paperText }) => {
      if (paperText) set.add(paperText);
    });
    return Array.from(set);
  }, [selectionTool.selectedPath, selectionTool.selectedPaths, selectedTextItems]);

  const groupSelectionCount = selectedImageInstances.length + selectedModelInstances.length + selectedPaperItems.length;
  const isGroupSelection = groupSelectionCount >= 2;

  const groupPaperBounds = useMemo(() => {
    if (!isGroupSelection) return null;
    const bounds = BoundsCalculator.calculateSelectionBounds(
      selectedImageInstances,
      selectedModelInstances,
      selectedPaperItems,
      0
    );
    if (bounds.isEmpty) return null;
    return bounds;
  }, [isGroupSelection, selectedImageInstances, selectedModelInstances, selectedPaperItems]);

  const paperRectToScreen = useCallback((rect: { x: number; y: number; width: number; height: number } | null) => {
    if (!rect || !paper.view) return null;
    try {
      const dpr = window.devicePixelRatio || 1;
      const topLeft = paper.view.projectToView(new paper.Point(rect.x, rect.y));
      const bottomRight = paper.view.projectToView(new paper.Point(rect.x + rect.width, rect.y + rect.height));
      if (
        !Number.isFinite(topLeft.x) ||
        !Number.isFinite(topLeft.y) ||
        !Number.isFinite(bottomRight.x) ||
        !Number.isFinite(bottomRight.y)
      ) {
        return null;
      }
      return {
        x: topLeft.x / dpr,
        y: topLeft.y / dpr,
        width: (bottomRight.x - topLeft.x) / dpr,
        height: (bottomRight.y - topLeft.y) / dpr,
      };
    } catch (error) {
      console.warn('Group toolbar 坐标转换失败:', error);
      return null;
    }
  }, [zoom, panX, panY]);

  const groupScreenBounds = useMemo(() => paperRectToScreen(groupPaperBounds), [groupPaperBounds, paperRectToScreen]);

  const getCameraSmartPosition = useCallback((bounds?: { x: number; y: number; width: number; height: number }) => {
    if (!bounds) return undefined;
    const gap = Math.max(48, Math.min(160, bounds.height * 0.25));
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2 + bounds.height + gap,
    };
  }, []);

  const executeGroupCapture = useCallback(async (options?: { sendToDialog?: boolean }) => {
    if (!isGroupSelection || !groupPaperBounds) return;
    if (isGroupCapturePending) return;
    setIsGroupCapturePending(true);
    const sendToDialog = options?.sendToDialog ?? false;
    try {
      const selection = {
        paperItems: selectedPaperItems,
        imageIds: [...(imageTool.selectedImageIds ?? [])],
        modelIds: [...(model3DTool.selectedModel3DIds ?? [])],
      };
      const result = await AutoScreenshotService.captureAutoScreenshot(
        imageTool.imageInstances,
        model3DTool.model3DInstances,
        {
          format: 'png',
          includeBackground: false,
          autoDownload: false,
          selection,
        }
      );

      if (result.success && result.dataUrl) {
        const captureBounds = result.bounds ?? groupPaperBounds;
        const boundsPayload = {
          x: captureBounds.x,
          y: captureBounds.y,
          width: captureBounds.width,
          height: captureBounds.height,
        };
        const smartPosition = getCameraSmartPosition(boundsPayload);
        const shouldAddToCanvas = !sendToDialog;

        if (shouldAddToCanvas) {
          if (quickImageUpload.handleQuickImageUploaded) {
            await quickImageUpload.handleQuickImageUploaded(
              result.dataUrl,
              `group-${Date.now()}.png`,
              boundsPayload,
              smartPosition,
              'camera'
            );
          } else {
            window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
              detail: {
                imageData: result.dataUrl,
                fileName: `group-${Date.now()}.png`,
                selectedImageBounds: boundsPayload,
                smartPosition,
                operationType: 'camera',
              }
            }));
          }
        }

        if (sendToDialog) {
          setSourceImageForEditing(result.dataUrl);
          showAIDialog();
        }

        const successMessage = sendToDialog ? '组合图层已发送到对话框' : '已生成组合图层';
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: successMessage, type: 'success' }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: result.error || '组合失败，请重试', type: 'error' }
        }));
      }
    } catch (error) {
      console.error('Group capture failed:', error);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '组合失败，请重试', type: 'error' }
      }));
    } finally {
      setIsGroupCapturePending(false);
    }
  }, [
    isGroupSelection,
    groupPaperBounds,
    isGroupCapturePending,
    imageTool.imageInstances,
    model3DTool.model3DInstances,
    imageTool.selectedImageIds,
    model3DTool.selectedModel3DIds,
    selectedPaperItems,
    quickImageUpload.handleQuickImageUploaded,
    getCameraSmartPosition,
    setSourceImageForEditing,
    showAIDialog,
  ]);

  const handleGroupCapture = useCallback(() => {
    void executeGroupCapture({ sendToDialog: false });
  }, [executeGroupCapture]);

  const handleModelCapture = useCallback(async (modelId: string) => {
    let abort = false;
    setModelCapturePending((prev) => {
      if (prev[modelId]) {
        abort = true;
        return prev;
      }
      return { ...prev, [modelId]: true };
    });
    if (abort) return;

    const targetModel = model3DTool.model3DInstances.find((model) => model.id === modelId);
    if (!targetModel) {
      setModelCapturePending((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '未找到对应的3D模型', type: 'error' },
      }));
      return;
    }

    try {
      const selection = {
        paperItems: [] as paper.Item[],
        imageIds: [] as string[],
        modelIds: [modelId],
      };
      const result = await AutoScreenshotService.captureAutoScreenshot(
        imageTool.imageInstances,
        model3DTool.model3DInstances,
        {
          format: 'png',
          includeBackground: false,
          autoDownload: false,
          selection,
        }
      );

      if (result.success && result.dataUrl) {
        const captureBounds = result.bounds ?? targetModel.bounds;
        const boundsPayload = {
          x: captureBounds.x,
          y: captureBounds.y,
          width: captureBounds.width,
          height: captureBounds.height,
        };
        const fileName = `model-${Date.now()}.png`;
        const smartPosition = getCameraSmartPosition(boundsPayload);

        if (quickImageUpload.handleQuickImageUploaded) {
          await quickImageUpload.handleQuickImageUploaded(
            result.dataUrl,
            fileName,
            boundsPayload,
            smartPosition,
            'camera'
          );
        } else {
          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: result.dataUrl,
              fileName,
              selectedImageBounds: boundsPayload,
              smartPosition,
              operationType: 'camera',
            }
          }));
        }

        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: '已生成3D截图', type: 'success' }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: result.error || '截图失败，请重试', type: 'error' }
        }));
      }
    } catch (error) {
      console.error('3D capture failed:', error);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '截图失败，请重试', type: 'error' }
      }));
    } finally {
      setModelCapturePending((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  }, [
    imageTool.imageInstances,
    model3DTool.model3DInstances,
    quickImageUpload.handleQuickImageUploaded,
    getCameraSmartPosition,
  ]);

  const handleModelSelectFromOverlay = useCallback((modelId: string, addToSelection: boolean = false) => {
    if (!addToSelection) {
      clearSelections();
    }
    model3DTool.handleModel3DSelect(modelId, addToSelection);
  }, [clearSelections, model3DTool]);

  // ========== 初始化交互控制器Hook ==========
  useInteractionController({
    canvasRef,
    drawMode,
    zoom,
    selectionTool,
    pathEditor,
    drawingTools,
    imageTool,
    model3DTool,
    simpleTextTool,
    performErase: eraserTool.performErase,
    setDrawMode,
    isEraser
  });

  const collectCanvasClipboardData = useCallback((): CanvasClipboardData | null => {
    const selectedImageIdsSet = new Set<string>(
      (imageTool.selectedImageIds && imageTool.selectedImageIds.length > 0
        ? imageTool.selectedImageIds
        : imageTool.imageInstances.filter((img) => img.isSelected).map((img) => img.id)) ?? []
    );
    const imageSnapshots: ImageAssetSnapshot[] = imageTool.imageInstances
      .filter((img) => selectedImageIdsSet.has(img.id))
      .map((img) => {
        const source = img.imageData.localDataUrl || img.imageData.src || img.imageData.url;
        if (!source) {
          console.warn('图片缺少可复制的资源，已跳过', img.id);
          return null;
        }
        return {
          id: img.id,
          url: img.imageData.url || source,
          src: img.imageData.src || source,
          key: img.imageData.key,
          fileName: img.imageData.fileName,
          width: img.imageData.width ?? img.bounds.width,
          height: img.imageData.height ?? img.bounds.height,
          contentType: img.imageData.contentType,
          pendingUpload: img.imageData.pendingUpload,
          localDataUrl: img.imageData.localDataUrl,
          bounds: { ...img.bounds },
          layerId: img.layerId ?? null,
        } as ImageAssetSnapshot;
      })
      .filter((snapshot): snapshot is ImageAssetSnapshot => snapshot !== null);

    const selectedModelIdsSet = new Set<string>(
      (model3DTool.selectedModel3DIds && model3DTool.selectedModel3DIds.length > 0
        ? model3DTool.selectedModel3DIds
        : model3DTool.model3DInstances.filter((model) => model.isSelected).map((model) => model.id)) ?? []
    );
    const modelSnapshots: ModelAssetSnapshot[] = model3DTool.model3DInstances
      .filter((model) => selectedModelIdsSet.has(model.id))
      .map((model) => ({
        id: model.id,
        url: model.modelData.url,
        key: model.modelData.key,
        format: model.modelData.format,
        fileName: model.modelData.fileName,
        fileSize: model.modelData.fileSize,
        defaultScale: model.modelData.defaultScale,
        defaultRotation: model.modelData.defaultRotation,
        timestamp: model.modelData.timestamp,
        path: model.modelData.path ?? model.modelData.url,
        bounds: { ...model.bounds },
        layerId: model.layerId ?? null,
      }));

    const pathSet = new Set<paper.Path>();
    if (selectionTool.selectedPath) pathSet.add(selectionTool.selectedPath);
    if (Array.isArray(selectionTool.selectedPaths)) {
      selectionTool.selectedPaths.forEach((p) => {
        if (p) pathSet.add(p);
      });
    }
    try {
      const selected = Array.isArray(paper.project?.selectedItems) ? paper.project!.selectedItems : [];
      selected.filter((item): item is paper.Path => item instanceof paper.Path).forEach((path) => pathSet.add(path));
    } catch {
      // ignore
    }
    const pathSnapshots: PathClipboardSnapshot[] = Array.from(pathSet)
      .filter((path) => !!path && path.isInserted() && !(path.data && path.data.isHelper))
      .map((path) => ({
        json: path.exportJSON({ asString: true }),
        layerName: path.layer?.name,
        position: { x: path.position.x, y: path.position.y },
        strokeWidth: path.data?.originalStrokeWidth ?? path.strokeWidth,
        strokeColor: path.strokeColor ? path.strokeColor.toCSS(true) : undefined,
        fillColor: path.fillColor ? path.fillColor.toCSS(true) : undefined,
      }));
    logger.debug('准备复制的路径数量:', pathSnapshots.length, { setSize: pathSet.size });

    const textSnapshots: TextAssetSnapshot[] = (simpleTextTool.textItems || [])
      .filter((item) => item.isSelected)
      .map((item) => ({
        id: item.id,
        content: item.paperText.content ?? '',
        position: { x: item.paperText.position.x, y: item.paperText.position.y },
        style: { ...item.style },
        layerId: item.paperText.layer?.name ?? null,
      }));

    const hasAny =
      imageSnapshots.length > 0 ||
      modelSnapshots.length > 0 ||
      pathSnapshots.length > 0 ||
      textSnapshots.length > 0;

    if (!hasAny) return null;

    return {
      images: imageSnapshots,
      models: modelSnapshots,
      texts: textSnapshots,
      paths: pathSnapshots,
    };
  }, [
    imageTool.imageInstances,
    imageTool.selectedImageIds,
    model3DTool.model3DInstances,
    model3DTool.selectedModel3DIds,
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    simpleTextTool.textItems,
  ]);

  const handleCanvasCopy = useCallback(() => {
    const payload = collectCanvasClipboardData();
    if (!payload) {
      logger.debug('复制失败：未找到可复制的画布对象');
      return false;
    }
    clipboardService.setCanvasData(payload);
    logger.debug('画布内容已复制到剪贴板:', {
      images: payload.images.length,
      models: payload.models.length,
      texts: payload.texts.length,
      paths: payload.paths.length,
    });
    return true;
  }, [collectCanvasClipboardData]);

  const handleCanvasPaste = useCallback(() => {
    const payload = clipboardService.getCanvasData();
    if (!payload) return false;
    logger.debug('尝试从剪贴板粘贴画布内容:', {
      images: payload.images.length,
      models: payload.models.length,
      texts: payload.texts.length,
      paths: payload.paths.length,
    });

    const offset = { x: 32, y: 32 };

    clearAllSelections();
    deselectSimpleText();

    const newImageIds: string[] = [];
    payload.images.forEach((snapshot) => {
      const id = createImageFromSnapshot?.(snapshot, { offset });
      if (id) newImageIds.push(id);
    });

    const newModelIds: string[] = [];
    payload.models.forEach((snapshot) => {
      const id = createModel3DFromSnapshot?.(snapshot, { offset });
      if (id) newModelIds.push(id);
    });

    const newTextIds: string[] = [];
    payload.texts.forEach((snapshot) => {
      if (snapshot.layerId) {
        try { useLayerStore.getState().activateLayer(snapshot.layerId); } catch {}
      }
      const point = new paper.Point(snapshot.position.x + offset.x, snapshot.position.y + offset.y);
      const created = createSimpleText(point, snapshot.content, snapshot.style);
      if (created) {
        newTextIds.push(created.id);
        stopEditText();
      }
    });

    const newPaths: paper.Path[] = [];
    const offsetVector = new paper.Point(offset.x, offset.y);
    payload.paths.forEach((snapshot) => {
      try {
        const prevLayer = paper.project.activeLayer;
        if (snapshot.layerName) {
          const targetLayer = paper.project.layers.find((layer) => layer.name === snapshot.layerName);
          if (targetLayer) targetLayer.activate();
          else drawingContext.ensureDrawingLayer();
        }
        if (!snapshot.layerName) {
          drawingContext.ensureDrawingLayer();
        }

        const imported = paper.project.importJSON(snapshot.json);
        const items = Array.isArray(imported) ? imported : [imported];
        items.forEach((item) => {
          if (!(item instanceof paper.Path)) {
            try { item.remove(); } catch {}
            return;
          }

          paper.project.activeLayer.addChild(item);
          item.translate(offsetVector);
          item.visible = true;
          try { item.bringToFront(); } catch {}

          const selectedBefore = item.selected;
          if (selectedBefore) {
            item.selected = false;
            item.fullySelected = false;
          }

          const strokeWidth = snapshot.strokeWidth ?? item.data?.originalStrokeWidth ?? item.strokeWidth ?? 1;
          item.strokeWidth = strokeWidth;
          item.data = { ...(item.data || {}), originalStrokeWidth: strokeWidth };

          if (snapshot.strokeColor) {
            try { item.strokeColor = new paper.Color(snapshot.strokeColor); } catch {}
          }
          if (typeof snapshot.fillColor === 'string') {
            try { item.fillColor = new paper.Color(snapshot.fillColor); } catch {}
          }

          if (selectedBefore) {
            item.selected = true;
            item.fullySelected = true;
          }

          newPaths.push(item);
          logger.debug('粘贴重建路径:', {
            layer: item.layer?.name,
            strokeWidth: item.strokeWidth,
            originalStrokeWidth: strokeWidth,
            bounds: item.bounds && {
              x: Math.round(item.bounds.x),
              y: Math.round(item.bounds.y),
              width: Math.round(item.bounds.width),
              height: Math.round(item.bounds.height),
            },
          });
        });

        if (prevLayer && prevLayer.isInserted()) {
          prevLayer.activate();
        }
      } catch (error) {
        console.warn('粘贴路径失败:', error);
      }
    });

    const hasNew =
      newImageIds.length > 0 ||
      newModelIds.length > 0 ||
      newPaths.length > 0 ||
      newTextIds.length > 0;

    if (!hasNew) {
      logger.debug('粘贴失败：剪贴板数据为空或无法重建对象');
      return false;
    }

    logger.debug('粘贴创建的对象数量:', {
      images: newImageIds.length,
      models: newModelIds.length,
      paths: newPaths.length,
      texts: newTextIds.length,
    });

    if (newImageIds.length > 0 && typeof handleImageMultiSelect === 'function') {
      handleImageMultiSelect(newImageIds);
    } else {
      setSelectedImageIds([]);
    }

    if (newModelIds.length > 0 && typeof handleModel3DMultiSelect === 'function') {
      handleModel3DMultiSelect(newModelIds);
    } else {
      setSelectedModel3DIds([]);
    }

    if (newPaths.length > 0) {
      newPaths.forEach((path) => {
        try { path.selected = true; path.fullySelected = true; } catch {}
        try { selectToolHandlePathSelect?.(path); } catch {}
      });
      setSelectedPaths?.(newPaths);
      setSelectedPath?.(newPaths[newPaths.length - 1]);
    } else {
      setSelectedPaths?.([]);
      setSelectedPath?.(null);
    }

    if (newTextIds.length > 0) {
      selectSimpleText(newTextIds[newTextIds.length - 1]);
    }

    try { paper.view.update(); } catch {}
    try { historyService.commit('paste-canvas').catch(() => {}); } catch {}
    try { paperSaveService.triggerAutoSave(); } catch {}

    return true;
  }, [
    clearAllSelections,
    createImageFromSnapshot,
    createModel3DFromSnapshot,
    createSimpleText,
    deselectSimpleText,
    handleImageMultiSelect,
    handleModel3DMultiSelect,
    selectSimpleText,
    setSelectedImageIds,
    setSelectedModel3DIds,
    setSelectedPath,
    setSelectedPaths,
    stopEditText,
  ]);

  // 供粘贴事件处理器调用最新的粘贴逻辑
  handleCanvasPasteRef.current = handleCanvasPaste;

  const editingTextId = simpleTextTool.editingTextId;

  // 监听画布指针事件，标记当前剪贴板域为 canvas，避免 Flow 的快捷键拦截
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const target = event.target as Node | null;
      if (target && canvas.contains(target)) {
        clipboardService.setActiveZone('canvas');
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, [canvasRef]);

  // 在按下复制/粘贴快捷键前标记画布为激活区域，防止 Flow 层截获
  useEffect(() => {
    const handleKeyPreCapture = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase?.() || '';
      if ((key !== 'c' && key !== 'v') || !(event.metaKey || event.ctrlKey)) return;
      if (!hasSelectionRef.current && !clipboardService.getCanvasData()) return;

      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const canvas = canvasRef.current;
      const fromCanvas = !!canvas && path.includes(canvas);
      const fromFlowOverlay = path.some((el) => {
        return el instanceof Element && el.classList?.contains('tanva-flow-overlay');
      });
      if (!fromCanvas || fromFlowOverlay) {
        return; // 不在画布区域的快捷键，不强制切换到画布
      }

      clipboardService.setActiveZone('canvas');
    };
    window.addEventListener('keydown', handleKeyPreCapture, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyPreCapture, { capture: true });
  }, []);

  // 复制事件：同步画布选择到系统剪贴板，避免默认粘贴落入外部内容
  useEffect(() => {
    const handleCopyEvent = (event: ClipboardEvent) => {
      try {
        const active = document.activeElement as Element | null;
        if (isEditableElement(active) || editingTextId) return;

        // 若当前剪贴板激活区为 Flow，且事件不是从画布冒泡上来，则让 Flow 处理
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const canvas = canvasRef.current;
        const fromCanvas = !!canvas && path.includes(canvas);
        const zone = clipboardService.getZone();
        if (zone !== 'canvas' && !fromCanvas) return;

        const handled = handleCanvasCopy();
        if (!handled) return;

        const payload = clipboardService.getCanvasData();
        if (!payload) return;

        const serialized = JSON.stringify({
          type: CANVAS_CLIPBOARD_TYPE,
          version: 1,
          data: payload,
        });

        if (event.clipboardData) {
          event.clipboardData.setData(CANVAS_CLIPBOARD_MIME, serialized);
          event.clipboardData.setData('application/json', serialized);
          event.clipboardData.setData('text/plain', CANVAS_CLIPBOARD_FALLBACK_TEXT);
          event.preventDefault();
        } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(serialized).catch(() => {});
        }
      } catch (error) {
        logger.warn('复制画布到系统剪贴板失败', error);
      }
    };

    window.addEventListener('copy', handleCopyEvent);
    return () => window.removeEventListener('copy', handleCopyEvent);
  }, [handleCanvasCopy, editingTextId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ⚪ DEBUG日志已关闭 - 键盘事件频繁，不需要每次都打印
      // logger.debug('画布键盘事件', {
      //   key: event.key,
      //   ctrl: event.ctrlKey,
      //   meta: event.metaKey,
      //   defaultPrevented: event.defaultPrevented,
      // });
      if (event.defaultPrevented) return;

      const isCopy = (event.key === 'c' || event.key === 'C') && (event.metaKey || event.ctrlKey);
      const isPaste = (event.key === 'v' || event.key === 'V') && (event.metaKey || event.ctrlKey);
      if (!isCopy && !isPaste) return;

      const active = document.activeElement as Element | null;
      const tagName = active?.tagName?.toLowerCase();
      const isEditable =
        !!active &&
        ((tagName === 'input' || tagName === 'textarea') || (active as any).isContentEditable);

      if (isEditable || editingTextId) return;

      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const canvas = canvasRef.current;
      const fromCanvas = !!canvas && path.includes(canvas);
      const zone = clipboardService.getZone();

      if (isCopy) {
        if (zone !== 'canvas' && !fromCanvas) return;
        const handled = handleCanvasCopy();
        if (handled) {
          // 继续让浏览器触发原生 copy 事件以写入系统剪贴板
        }
        return;
      }

      if (isPaste) {
        if (zone !== 'canvas' && !fromCanvas) return;
        const handled = handleCanvasPaste();
        if (handled) {
          event.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleCanvasCopy, handleCanvasPaste, editingTextId]);

  // ========== 图元顺序调整处理 ==========
  const adjustItemOrderWithinLayer = useCallback((
    itemType: 'image' | '3d-model',
    targetId: string,
    direction: 'up' | 'down',
  ) => {
    try {
      if (!paper?.project) return;
      const idKey = itemType === 'image' ? 'imageId' : 'modelId';
      const group = paper.project.layers.flatMap((layer) =>
        layer.children.filter((child) =>
          child.data?.type === itemType && child.data?.[idKey] === targetId,
        )
      )[0];

      if (!(group instanceof paper.Group) || !group.layer) {
        console.warn(`未找到可调整顺序的 ${itemType} 元素`, targetId);
        return;
      }

      const siblings = group.layer.children.filter(
        (child) => child.data?.type === itemType && child.data?.[idKey],
      );
      const currentIndex = siblings.indexOf(group);
      if (currentIndex === -1) return;

      if (direction === 'up') {
        if (currentIndex >= siblings.length - 1) return;
        const nextItem = siblings[currentIndex + 1];
        group.insertAbove(nextItem);
      } else {
        if (currentIndex <= 0) return;
        const prevItem = siblings[currentIndex - 1];
        group.insertBelow(prevItem);
      }

      try { paper.view.update(); } catch {}
      try { paperSaveService.triggerAutoSave('item-reorder'); } catch {}
      try { historyService.commit(`${itemType}-${direction}-layer`).catch(() => {}); } catch {}
    } catch (error) {
      console.error('调整元素顺序失败:', error);
    }
  }, []);

  const handleImageLayerMoveUp = useCallback((imageId: string) => {
    adjustItemOrderWithinLayer('image', imageId, 'up');
  }, [adjustItemOrderWithinLayer]);

  const handleImageLayerMoveDown = useCallback((imageId: string) => {
    adjustItemOrderWithinLayer('image', imageId, 'down');
  }, [adjustItemOrderWithinLayer]);

  const handleModelLayerMoveUp = useCallback((modelId: string) => {
    adjustItemOrderWithinLayer('3d-model', modelId, 'up');
  }, [adjustItemOrderWithinLayer]);

  const handleModelLayerMoveDown = useCallback((modelId: string) => {
    adjustItemOrderWithinLayer('3d-model', modelId, 'down');
  }, [adjustItemOrderWithinLayer]);

  // 处理图片图层可见性切换
  const handleImageToggleVisibility = useCallback((imageId: string) => {
    try {
      // 找到对应的Paper.js图层组
      const imageGroup = paper.project.layers.flatMap(layer =>
        layer.children.filter(child =>
          child.data?.type === 'image' && child.data?.imageId === imageId
        )
      )[0];

      if (imageGroup instanceof paper.Group) {
        // 获取图片所在的图层
        const currentLayer = imageGroup.layer;
        if (currentLayer) {
          // 从图层名称获取图层store ID (layer_${id} -> id)
          const layerStoreId = currentLayer.name.replace('layer_', '');
          
          // 调用图层store的切换可见性函数
          toggleVisibility(layerStoreId);
          
          logger.debug(`👁️ 切换图层可见性: ${currentLayer.name} (storeId: ${layerStoreId})`);
        } else {
          console.warn('图片没有关联的图层');
        }
      } else {
        console.warn('未找到对应的图片图层组');
      }
    } catch (error) {
      console.error('切换图层可见性失败:', error);
    }
  }, [toggleVisibility]);

  const handleDownloadImage = useCallback(async (imageId: string) => {
    try {
      const instance = imageTool.imageInstances.find((img) => img.id === imageId);
      if (!instance) {
        console.warn('下载失败：未找到图片实例', imageId);
        return;
      }

      let dataUrl: string | null = null;
      if (typeof imageTool.getImageDataForEditing === 'function') {
        try {
          dataUrl = imageTool.getImageDataForEditing(imageId);
        } catch (error) {
          console.warn('获取高质量图片数据失败，尝试备用地址', error);
        }
      }

      if (!dataUrl) {
        dataUrl =
          instance.imageData?.localDataUrl ||
          instance.imageData?.src ||
          instance.imageData?.url ||
          null;
      }

      if (!dataUrl) {
        console.warn('下载失败：缺少可用的图片数据', imageId);
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: '无法获取图像数据，下载失败', type: 'error' }
        }));
        return;
      }

      const fileName = getSuggestedFileName(instance.imageData?.fileName, 'image');
      downloadImage(dataUrl, fileName);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '已开始下载图片', type: 'success' }
      }));
    } catch (error) {
      console.error('下载图片失败:', error);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '下载失败，请稍后再试', type: 'error' }
      }));
    }
  }, [imageTool.imageInstances, imageTool.getImageDataForEditing]);

  const resolveContextTarget = useCallback((event: MouseEvent): HitTestTarget => {
    const canvas = canvasRef.current;
    if (!canvas || !paper?.project) return null;

    const projectPoint = clientToProject(canvas, event.clientX, event.clientY);
    const zoomValue = Math.max(zoomRef.current || 1, 0.01);
    const tolerance = 6 / zoomValue;

    let hitResult: paper.HitResult | null = null;
    try {
      hitResult = paper.project.hitTest(projectPoint, {
        segments: true,
        stroke: true,
        fill: true,
        bounds: true,
        tolerance,
        handles: false,
      });
    } catch {
      hitResult = null;
    }

    if (!hitResult?.item) return null;

    let current: paper.Item | null = hitResult.item;
    while (current) {
      const data = current.data || {};

      // 检查是否在占位框内部（占位框的子元素不应该被单独选中）
      // 🔥 使用 placeholderGroupId 而不是 placeholderGroup 引用
      if (data.placeholderGroupId || data.placeholderType) {
        // 这是占位框的子元素，不应该被选中
        return null;
      }

      if (data.isHelper || data.isSelectionHelper || data.isResizeHandle) {
        current = current.parent;
        continue;
      }
      if ((data.type === 'image-placeholder' || data.type === '3d-model-placeholder' || data.type === 'selection-box')) {
        current = current.parent;
        continue;
      }
      if ((data.type === 'image-selection-area' || data.type === '3d-model-selection-area') && current.parent) {
        current = current.parent;
        continue;
      }

      if (data.type === 'image' && data.imageId) {
        return { type: 'image', id: data.imageId };
      }
      if (data.type === '3d-model' && data.modelId) {
        return { type: 'model3d', id: data.modelId };
      }
      if (data.type === 'text' && data.textId) {
        return { type: 'text', id: data.textId };
      }
      if (current instanceof paper.PointText) {
        const textId = data.textId || current.data?.textId;
        return { type: 'text', id: textId };
      }
      if (current instanceof paper.Path && !data.isHelper) {
        const layerName = current.layer?.name;
        if (layerName === 'grid' || layerName === 'background') {
          current = current.parent;
          continue;
        }
        return { type: 'path', path: current };
      }

      current = current.parent;
    }

    return null;
  }, [canvasRef]);

  const ensureSelectionForTarget = useCallback((target: HitTestTarget) => {
    if (!target) return;

    if (target.type === 'image' && target.id) {
      const alreadySelected = selectionSnapshotRef.current.imageIds.includes(target.id);
      if (!alreadySelected) {
        clearSelections();
        deselectSimpleText();
        imageTool.handleImageSelect(target.id);
      }
      return;
    }

    if (target.type === 'model3d' && target.id) {
      const alreadySelected = selectionSnapshotRef.current.modelIds.includes(target.id);
      if (!alreadySelected) {
        clearSelections();
        deselectSimpleText();
        model3DTool.handleModel3DSelect(target.id);
      }
      return;
    }

    if (target.type === 'text' && target.id) {
      if (selectionSnapshotRef.current.textId !== target.id) {
        clearSelections();
        selectSimpleText(target.id);
      }
      return;
    }

    if (target.type === 'path') {
      const alreadySelected = selectionSnapshotRef.current.paths.some((path) => path === target.path);
      if (!alreadySelected) {
        clearSelections();
        deselectSimpleText();
        selectToolHandlePathSelect(target.path);
        setSelectedPath(target.path);
    setSelectedPaths([target.path]);
      }
    }
  }, [
    clearSelections,
    deselectSimpleText,
    imageTool.handleImageSelect,
    model3DTool.handleModel3DSelect,
    selectSimpleText,
    selectToolHandlePathSelect,
    setSelectedPath,
    setSelectedPaths,
  ]);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const handleContextMenu = (event: MouseEvent) => {
      const target = resolveContextTarget(event);
      if (target) {
        ensureSelectionForTarget(target);
        setContextMenuState({
          x: event.clientX,
          y: event.clientY,
          type: target.type as ContextMenuTargetType,
          targetId: 'id' in target ? target.id : undefined,
        });
      } else {
        const fallbackType: ContextMenuTargetType = hasSelectionRef.current ? 'selection' : 'canvas';
        setContextMenuState({
          x: event.clientX,
          y: event.clientY,
          type: fallbackType,
        });
      }
      event.preventDefault();
      event.stopPropagation();
    };

    canvasElement.addEventListener('contextmenu', handleContextMenu);
    return () => {
      canvasElement.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [canvasRef, ensureSelectionForTarget, resolveContextTarget]);

  const handleDeleteSelection = useCallback(() => {
    let didDelete = false;

    const pathTargets: paper.Path[] = [];
    if (selectionTool.selectedPath) pathTargets.push(selectionTool.selectedPath);
    if (Array.isArray(selectionTool.selectedPaths)) {
      selectionTool.selectedPaths.forEach((path) => {
        if (path && !pathTargets.includes(path)) {
          pathTargets.push(path);
        }
      });
    }

    if (pathTargets.length > 0) {
      const removedPlaceholders = new Set<paper.Group>();
      pathTargets.forEach((path) => {
        // 🔥 不再使用 placeholderGroup 引用，改为向上查找占位符组
        let foundPlaceholderGroup: paper.Group | undefined;
        let node: any = path;
        while (node) {
          // 检查是否有 placeholderGroupId（新方式）或直接是占位符类型
          if (node.data?.type === 'image-placeholder' || node.data?.type === '3d-model-placeholder') {
            foundPlaceholderGroup = node as paper.Group;
            break;
          }
          node = node.parent;
        }

        const target: paper.Item = foundPlaceholderGroup || path;
        if (foundPlaceholderGroup) {
          if (!removedPlaceholders.has(foundPlaceholderGroup)) {
            try {
              // 确保删除整个占位框组及其所有子元素
              foundPlaceholderGroup.remove();
              didDelete = true;
            } catch {}
            removedPlaceholders.add(foundPlaceholderGroup);
          }
        } else {
          try { target.remove(); didDelete = true; } catch {}
        }
      });
      setSelectedPaths([]);
      setSelectedPath(null);
    }

    if ((imageTool.selectedImageIds?.length ?? 0) > 0 && typeof imageTool.handleImageDelete === 'function') {
      imageTool.selectedImageIds!.forEach((id) => {
        try { imageTool.handleImageDelete?.(id); didDelete = true; } catch {}
      });
    }

    if ((model3DTool.selectedModel3DIds?.length ?? 0) > 0 && typeof model3DTool.handleModel3DDelete === 'function') {
      model3DTool.selectedModel3DIds!.forEach((id) => {
        try { model3DTool.handleModel3DDelete?.(id); didDelete = true; } catch {}
      });
    }

    if (simpleTextTool.selectedTextId) {
      deleteSimpleText(simpleTextTool.selectedTextId);
      didDelete = true;
    }

    // 删除选中的图片占位框
    if (imageTool.selectedPlaceholderId) {
      try {
        imageTool.deletePlaceholder?.(imageTool.selectedPlaceholderId);
        didDelete = true;
      } catch {}
    }

    // 删除选中的3D模型占位框
    if (model3DTool.selectedPlaceholderId) {
      try {
        model3DTool.deletePlaceholder?.(model3DTool.selectedPlaceholderId);
        didDelete = true;
      } catch {}
    }

    if (didDelete) {
      try { paper.view.update(); } catch {}
      try { historyService.commit('delete-selection-contextmenu').catch(() => {}); } catch {}
      clearSelections();
      deselectSimpleText();
    }
  }, [
    clearSelections,
    deleteSimpleText,
    deselectSimpleText,
    imageTool.handleImageDelete,
    imageTool.selectedImageIds,
    imageTool.selectedPlaceholderId,
    imageTool.deletePlaceholder,
    model3DTool.handleModel3DDelete,
    model3DTool.selectedModel3DIds,
    model3DTool.selectedPlaceholderId,
    model3DTool.deletePlaceholder,
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    setSelectedPath,
    setSelectedPaths,
    simpleTextTool.selectedTextId,
  ]);

  const closeContextMenu = useCallback(() => setContextMenuState(null), []);

  const contextMenuItems = useMemo(() => {
    if (!contextMenuState) return [];

    const canCopy = hasSelection && contextMenuState.type !== 'canvas';
    const canPaste = !!clipboardService.getCanvasData();

    const items: Array<{
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
      disabled?: boolean;
    }> = [
      {
        label: '复制',
        icon: <Copy className="w-4 h-4" />,
        onClick: () => { handleCanvasCopy(); },
        disabled: !canCopy,
      },
      {
        label: '粘贴',
        icon: <ClipboardPaste className="w-4 h-4" />,
        onClick: () => { handleCanvasPaste(); },
        disabled: !canPaste,
      },
    ];

    if (contextMenuState.type === 'image' && contextMenuState.targetId) {
      const targetId = contextMenuState.targetId;
      items.push(
        {
          label: '下载图片',
          icon: <Download className="w-4 h-4" />,
          onClick: () => handleDownloadImage(targetId),
        },
        {
          label: '上移一层',
          icon: <ArrowUp className="w-4 h-4" />,
          onClick: () => handleImageLayerMoveUp(targetId),
        },
        {
          label: '下移一层',
          icon: <ArrowDown className="w-4 h-4" />,
          onClick: () => handleImageLayerMoveDown(targetId),
        },
      );
    } else if (contextMenuState.type === 'model3d' && contextMenuState.targetId) {
      const targetId = contextMenuState.targetId;
      items.push(
        {
          label: '上移一层',
          icon: <ArrowUp className="w-4 h-4" />,
          onClick: () => handleModelLayerMoveUp(targetId),
        },
        {
          label: '下移一层',
          icon: <ArrowDown className="w-4 h-4" />,
          onClick: () => handleModelLayerMoveDown(targetId),
        },
      );
    }

    items.push({
      label: '删除',
      icon: <Trash2 className="w-4 h-4" />,
      onClick: handleDeleteSelection,
      disabled: !hasSelection,
    });

    return items;
  }, [
    contextMenuState,
    handleCanvasCopy,
    handleCanvasPaste,
    handleDeleteSelection,
    handleDownloadImage,
    handleImageLayerMoveDown,
    handleImageLayerMoveUp,
    handleModelLayerMoveDown,
    handleModelLayerMoveUp,
    hasSelection,
  ]);

  // 同步图片和3D模型的可见性状态
  useEffect(() => {
    const syncVisibilityStates = () => {
      // 同步图片可见性
      imageTool.setImageInstances(prev => prev.map(image => {
        const paperGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId === image.id
          )
        )[0];

        if (paperGroup) {
          return { ...image, visible: paperGroup.visible };
        }
        return image;
      }));

      // 同步3D模型可见性
      model3DTool.setModel3DInstances(prev => prev.map(model => {
        const paperGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === '3d-model' && child.data?.modelId === model.id
          )
        )[0];

        if (paperGroup) {
          return { ...model, visible: paperGroup.visible };
        }
        return model;
      }));
    };

    // 监听图层可见性变化事件
    const handleVisibilitySync = () => {
      syncVisibilityStates();
    };

    window.addEventListener('layerVisibilityChanged', handleVisibilitySync);

    return () => {
      window.removeEventListener('layerVisibilityChanged', handleVisibilitySync);
    };
  }, [imageTool, model3DTool]);

  // 将图片和3D模型实例暴露给图层面板使用
  useEffect(() => {
    (window as any).tanvaImageInstances = imageTool.imageInstances;
    (window as any).tanvaModel3DInstances = model3DTool.model3DInstances;
    (window as any).tanvaTextItems = simpleTextTool.textItems;
  }, [imageTool.imageInstances, model3DTool.model3DInstances, simpleTextTool.textItems]);

  // 监听图层顺序变化并更新图像的layerId
  useEffect(() => {
    const updateImageLayerIds = () => {
      imageTool.setImageInstances(prev => prev.map(image => {
        const imageGroup = paper.project?.layers?.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' &&
            child.data?.imageId === image.id
          )
        )[0];

        if (imageGroup && imageGroup.layer) {
          const layerName = imageGroup.layer.name;
          if (layerName && layerName.startsWith('layer_')) {
            const newLayerId = layerName.replace('layer_', '');
            if (newLayerId !== image.layerId) {
              return { ...image, layerId: newLayerId };
            }
          }
        }
        return image;
      }));
    };

    // 监听图层变化事件
    const handleLayerOrderChanged = () => {
      updateImageLayerIds();
    };

    window.addEventListener('layerOrderChanged', handleLayerOrderChanged);

    // 移除定期检查 - 使用事件驱动替代轮询，避免内存泄漏和性能问题
    // 原因：setInterval 会持续消耗资源，且 layerOrderChanged 事件已经能覆盖大部分场景

    return () => {
      window.removeEventListener('layerOrderChanged', handleLayerOrderChanged);
    };
  }, [imageTool]);

  // 监听图层面板触发的实例更新事件
  useEffect(() => {
    // 处理图片实例更新
    const handleImageInstanceUpdate = (event: CustomEvent) => {
      const { imageId, layerId } = event.detail;
      logger.debug(`🔄 DrawingController收到图片实例更新事件: ${imageId} → 图层${layerId}`);
      
      imageTool.setImageInstances(prev => prev.map(image => {
        if (image.id === imageId) {
          return { 
            ...image, 
            layerId: layerId,
            layerIndex: parseInt(layerId) || 0 
          };
        }
        return image;
      }));
    };

    // 处理3D模型实例更新
    const handleModel3DInstanceUpdate = (event: CustomEvent) => {
      const { modelId, layerId } = event.detail;
      logger.debug(`🔄 DrawingController收到3D模型实例更新事件: ${modelId} → 图层${layerId}`);
      
      model3DTool.setModel3DInstances(prev => prev.map(model => {
        if (model.id === modelId) {
          return { 
            ...model, 
            layerId: layerId,
            layerIndex: parseInt(layerId) || 0 
          };
        }
        return model;
      }));
    };

    // 添加事件监听器
    window.addEventListener('imageInstanceUpdated', handleImageInstanceUpdate as EventListener);
    window.addEventListener('model3DInstanceUpdated', handleModel3DInstanceUpdate as EventListener);

    return () => {
      window.removeEventListener('imageInstanceUpdated', handleImageInstanceUpdate as EventListener);
      window.removeEventListener('model3DInstanceUpdated', handleModel3DInstanceUpdate as EventListener);
    };
  }, [imageTool, model3DTool]);

  // 历史恢复：清空实例并基于快照资产回填 UI 覆盖层
  useEffect(() => {
    const handler = (event: CustomEvent) => {
      try {
        const assets = event.detail?.assets;
        // 清空现有实例
        imageTool.setImageInstances([]);
        imageTool.setSelectedImageIds([]);
        model3DTool.setModel3DInstances([]);
        model3DTool.setSelectedModel3DIds([]);
        simpleTextTool.clearAllTextItems();

        if (assets) {
          if (assets.images?.length) {
            imageTool.hydrateFromSnapshot(assets.images);
          }
          if (assets.models?.length) {
            model3DTool.hydrateFromSnapshot(assets.models);
          }
          if (assets.texts?.length) {
            simpleTextTool.hydrateFromSnapshot(assets.texts);
          }
        }
      } catch (e) {
        console.warn('历史恢复回填失败:', e);
      }
    };
    window.addEventListener('history-restore', handler as EventListener);
    return () => window.removeEventListener('history-restore', handler as EventListener);
  }, [imageTool, model3DTool, simpleTextTool]);

  // 从已反序列化的 Paper 项目重建图片、文字和3D模型实例
  useEffect(() => {
    const rebuildFromPaper = () => {
      try {
        if (!paper || !paper.project) return;

        const imageInstances: any[] = [];
        const textInstances: any[] = [];
        const model3DInstances: any[] = [];

        // 扫描所有图层
        (paper.project.layers || []).forEach((layer: any) => {
          const children = layer?.children || [];
          children.forEach((item: any) => {
            // ========== 处理图片 ==========
            let imageGroup: any | null = null;
            if (item?.data?.type === 'image' && item?.data?.imageId) {
              imageGroup = item;
            } else if (item?.className === 'Raster' || item instanceof (paper as any).Raster) {
              // 兼容只有 Raster 的情况
              imageGroup = item.parent && item.parent.className === 'Group' ? item.parent : null;
              if (imageGroup && !(imageGroup.data && imageGroup.data.type === 'image')) {
                // 为旧内容补上标记
                if (!imageGroup.data) imageGroup.data = {};
                imageGroup.data.type = 'image';
                imageGroup.data.imageId = `img_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
              }
            }

            if (imageGroup) {
              const raster = imageGroup.children.find(
                (c: any) => c.className === 'Raster' || c instanceof (paper as any).Raster
              ) as paper.Raster | undefined;

              if (raster) {
                const ensuredImageId =
                  imageGroup.data?.imageId ||
                  (raster.data && raster.data.imageId) ||
                  `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                if (!imageGroup.data) imageGroup.data = {};
                imageGroup.data.type = 'image';
                imageGroup.data.imageId = ensuredImageId;

                const metadataFromRaster = {
                  originalWidth: raster.data?.originalWidth as number | undefined,
                  originalHeight: raster.data?.originalHeight as number | undefined,
                  fileName: raster.data?.fileName as string | undefined,
                  uploadMethod: raster.data?.uploadMethod as string | undefined,
                  aspectRatio: raster.data?.aspectRatio as number | undefined,
                  remoteUrl: raster.data?.remoteUrl as string | undefined
                };

                // 记录来源：优先使用远程URL，其次使用非data的source，最后使用内联data
                const sourceUrl = typeof raster.source === 'string' ? raster.source : undefined;
                const remoteUrl = metadataFromRaster.remoteUrl || (sourceUrl && !sourceUrl.startsWith('data:') ? sourceUrl : undefined);
                const inlineDataUrl = sourceUrl && sourceUrl.startsWith('data:') ? sourceUrl : undefined;

                // 统一设置raster.data，提前补上id以便后续事件使用
                raster.data = {
                  ...(raster.data || {}),
                  type: 'image',
                  imageId: ensuredImageId,
                  ...metadataFromRaster
                };

                const buildImageInstance = () => {
                  if (!raster.bounds || raster.bounds.width <= 0 || raster.bounds.height <= 0) {
                    return null;
                  }

                  const boundsRect = raster.bounds as paper.Rectangle;
                  const computedMetadata = {
                    ...metadataFromRaster,
                    originalWidth: metadataFromRaster.originalWidth || boundsRect.width,
                    originalHeight: metadataFromRaster.originalHeight || boundsRect.height,
                    aspectRatio:
                      metadataFromRaster.aspectRatio ||
                      (boundsRect.height ? boundsRect.width / boundsRect.height : undefined),
                    remoteUrl: metadataFromRaster.remoteUrl || remoteUrl
                  };

                  ensureImageGroupStructure({
                    raster,
                    imageId: ensuredImageId,
                    group: imageGroup,
                    metadata: computedMetadata,
                    ensureImageRect: true,
                    ensureSelectionArea: true
                  });

                  try { paper.view?.update(); } catch {}

                  const resolvedUrl = remoteUrl ?? inlineDataUrl ?? '';
                  const resolvedSrc = inlineDataUrl ?? remoteUrl ?? resolvedUrl;

                  return {
                    id: ensuredImageId,
                    imageData: {
                      id: ensuredImageId,
                      url: resolvedUrl,
                      src: resolvedSrc,
                      fileName: computedMetadata.fileName,
                      pendingUpload: false
                    },
                    bounds: {
                      x: boundsRect.x,
                      y: boundsRect.y,
                      width: boundsRect.width,
                      height: boundsRect.height
                    },
                    isSelected: false,
                    visible: imageGroup.visible !== false,
                    layerId: layer?.name
                  };
                };

                const hasValidBounds =
                  !!raster.bounds && raster.bounds.width > 0 && raster.bounds.height > 0;

                if (hasValidBounds) {
                  const imageInstance = buildImageInstance();
                  if (imageInstance) {
                    imageInstances.push(imageInstance);
                  }
                } else {
                  // 尚未加载完成的Raster：先记录占位实例，待onLoad完成后再补齐尺寸与辅助元素
                  const resolvedUrl = remoteUrl ?? inlineDataUrl ?? '';
                  const resolvedSrc = inlineDataUrl ?? remoteUrl ?? resolvedUrl;

                  imageInstances.push({
                    id: ensuredImageId,
                    imageData: {
                      id: ensuredImageId,
                      url: resolvedUrl,
                      src: resolvedSrc,
                      fileName: metadataFromRaster.fileName,
                      pendingUpload: raster.data?.pendingUpload ?? false
                    },
                    bounds: {
                      x: raster.position?.x ?? 0,
                      y: raster.position?.y ?? 0,
                      width: 0,
                      height: 0
                    },
                    isSelected: false,
                    visible: imageGroup.visible !== false,
                    layerId: layer?.name
                  });

                  const previousOnLoad = raster.onLoad;
                  raster.onLoad = () => {
                    const loadedInstance = buildImageInstance();
                    if (loadedInstance) {
                      imageTool.setImageInstances((prev) => {
                        const updated = [...prev];
                        const index = updated.findIndex(img => img.id === ensuredImageId);
                        if (index >= 0) {
                          updated[index] = {
                            ...updated[index],
                            ...loadedInstance,
                            imageData: {
                              ...updated[index].imageData,
                              ...loadedInstance.imageData
                            }
                          };
                        } else {
                          updated.push(loadedInstance);
                        }
                        try { (window as any).tanvaImageInstances = updated; } catch {}
                        return updated;
                      });
                      try { paper.view?.update(); } catch {}
                    }

                    if (typeof previousOnLoad === 'function') {
                      try {
                        previousOnLoad.call(raster);
                      } catch (err) {
                        console.warn('重建图片时执行原始Raster onLoad失败:', err);
                      }
                    }
                  };
                }
              }
            }

            // ========== 处理文字 ==========
            if (item?.className === 'PointText' || item instanceof (paper as any).PointText) {
              const pointText = item as any;
              // 跳过辅助文本
              if (pointText.data?.isHelper) return;

              // 生成或使用已有的 text ID
              let textId = pointText.data?.textId;
              if (!textId) {
                textId = `text_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                if (!pointText.data) pointText.data = {};
                pointText.data.textId = textId;
              }

              // 确保设置 type 标记（关键！用于点击检测）
              if (!pointText.data.type) {
                pointText.data.type = 'text';
              }

              // 提取样式信息
              const style = {
                fontFamily: pointText.fontFamily || 'sans-serif',
                fontWeight: (pointText.fontWeight === 'bold' || pointText.fontWeight === '700') ? 'bold' : 'normal',
                fontSize: pointText.fontSize || 24,
                color: pointText.fillColor ? pointText.fillColor.toCSS(true) : '#000000',
                align: 'left',
                italic: pointText.fontStyle === 'italic' || false,
              };

              // 构建文字实例
              textInstances.push({
                id: textId,
                paperText: pointText,
                isSelected: false,
                isEditing: false,
                style: style,
              });
            }

            // ========== 处理3D模型 ==========
            if (item?.data?.type === '3d-model' && item?.data?.modelId) {
              const model3DGroup = item;
              const modelId = model3DGroup.data.modelId;

              // 从group中查找占位符矩形来获取bounds
              const placeholder = model3DGroup.children?.find((c: any) =>
                c?.data?.isPlaceholder || c?.className === 'Path'
              );

              if (placeholder && placeholder.bounds) {
                const b = placeholder.bounds as any;

                // 从data中恢复模型数据
                const stored = model3DGroup.data?.modelData || {};
                const resolvedUrl = stored.url || model3DGroup.data?.url || model3DGroup.data?.path || '';
                const resolvedPath = stored.path || model3DGroup.data?.path || resolvedUrl;
                const modelData = {
                  url: resolvedUrl,
                  path: resolvedPath,
                  key: stored.key ?? model3DGroup.data?.key,
                  format: stored.format || model3DGroup.data?.format || 'glb',
                  fileName: stored.fileName || model3DGroup.data?.fileName || 'model',
                  fileSize: stored.fileSize ?? model3DGroup.data?.fileSize ?? 0,
                  defaultScale: stored.defaultScale || model3DGroup.data?.defaultScale || { x: 1, y: 1, z: 1 },
                  defaultRotation: stored.defaultRotation || model3DGroup.data?.defaultRotation || { x: 0, y: 0, z: 0 },
                  timestamp: stored.timestamp ?? model3DGroup.data?.timestamp ?? Date.now(),
                  camera: stored.camera || model3DGroup.data?.camera,
                };

                try {
                  if (model3DGroup.data) {
                    model3DGroup.data.modelData = { ...modelData };
                    model3DGroup.data.url = modelData.url;
                    model3DGroup.data.path = modelData.path;
                    model3DGroup.data.key = modelData.key;
                    model3DGroup.data.format = modelData.format;
                    model3DGroup.data.fileName = modelData.fileName;
                    model3DGroup.data.fileSize = modelData.fileSize;
                    model3DGroup.data.defaultScale = modelData.defaultScale;
                    model3DGroup.data.defaultRotation = modelData.defaultRotation;
                    model3DGroup.data.timestamp = modelData.timestamp;
                    model3DGroup.data.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
                    model3DGroup.data.layerId = layer?.name ?? model3DGroup.data.layerId ?? null;
                    model3DGroup.data.camera = modelData.camera;
                  }
                } catch (error) {
                  console.warn('刷新3D模型数据失败:', error);
                }

                // 确保存在选择区域（用于点击检测）
                const hasSelectionArea = !!model3DGroup.children?.find((c: any) =>
                  c?.data?.type === '3d-model-selection-area'
                );
                if (!hasSelectionArea) {
                  try {
                    const selectionArea = new (paper as any).Path.Rectangle({
                      rectangle: new (paper as any).Rectangle(b.x, b.y, b.width, b.height),
                      fillColor: new (paper as any).Color(0, 0, 0, 0.001), // 几乎透明但可点击
                      strokeColor: null,
                      selected: false,
                      visible: true,
                    });
                    selectionArea.data = {
                      type: '3d-model-selection-area',
                      modelId: modelId,
                      isHelper: true
                    };
                    model3DGroup.addChild(selectionArea);
                  } catch {}
                }

                // 构建3D模型实例
                model3DInstances.push({
                  id: modelId,
                  modelData: modelData,
                  bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
                  isSelected: false,
                  visible: model3DGroup.visible !== false,
                  layerId: layer?.name,
                });
              }
            }
          });
        });

        // 更新图片实例
        if (imageInstances.length > 0) {
          imageTool.setImageInstances((prev) => {
            const prevMap = new Map(prev.map(item => [item.id, item]));
            const merged: typeof prev = [];

            imageInstances.forEach(instance => {
              const previous = prevMap.get(instance.id);
              if (previous) {
                prevMap.delete(instance.id);
              }

              const boundsToUse = previous && previous.bounds.width > 0 && previous.bounds.height > 0
                ? previous.bounds
                : instance.bounds;

              merged.push({
                ...instance,
                ...previous,
                bounds: boundsToUse,
                imageData: {
                  ...(instance.imageData || {}),
                  ...(previous?.imageData || {})
                },
                isSelected: false,
                visible: instance.visible
              });
            });

            // 如果还有遗留的旧实例（理论上不会发生），保留它们以免数据丢失
            prevMap.forEach(item => merged.push(item));

            try { (window as any).tanvaImageInstances = merged; } catch {}
            return merged;
          });
          imageTool.setSelectedImageIds([]);
          logger.debug(`🧩 已从 Paper 恢复 ${imageInstances.length} 张图片实例`);
        }

        // 更新文字实例
        simpleTextTool.hydrateFromPaperItems(textInstances);
        try { (window as any).tanvaTextItems = textInstances; } catch {}
        if (textInstances.length > 0) {
          logger.debug(`📝 已从 Paper 恢复 ${textInstances.length} 个文字实例`);
        }

        // 更新3D模型实例
        if (model3DInstances.length > 0) {
          model3DTool.setModel3DInstances(model3DInstances);
          model3DTool.setSelectedModel3DIds([]);
          try { (window as any).tanvaModel3DInstances = model3DInstances; } catch {}
          logger.debug(`🎮 已从 Paper 恢复 ${model3DInstances.length} 个3D模型实例`);
        }

        // 输出总结
        const total = imageInstances.length + textInstances.length + model3DInstances.length;
        if (total > 0) {
          logger.debug(`✅ 从 Paper.js 共恢复 ${total} 个实例（图片${imageInstances.length}，文字${textInstances.length}，3D${model3DInstances.length}）`);
        }
      } catch (e) {
        console.warn('从Paper重建实例失败:', e);
      }
    };

    window.addEventListener('paper-project-changed', rebuildFromPaper as EventListener);
    return () => window.removeEventListener('paper-project-changed', rebuildFromPaper as EventListener);
  }, [imageTool, simpleTextTool, model3DTool]);

  // 监听图层面板的选择事件
  useEffect(() => {
    const handleLayerItemSelected = (event: CustomEvent) => {
      const { item, type, itemId } = event.detail;

      logger.debug('收到图层面板选择事件:', type, itemId);

      // 清除之前的所有选择
      selectionTool.clearAllSelections();

      // 根据类型进行相应的选择处理
      if (type === 'image') {
        const imageData = item.data;
        if (imageData?.imageId) {
          imageTool.handleImageSelect(imageData.imageId);
        }
      } else if (type === 'model3d') {
        const modelData = item.data;
        if (modelData?.modelId) {
          model3DTool.handleModel3DSelect(modelData.modelId);
        }
      } else if (item instanceof paper.Path) {
        selectionTool.handlePathSelect(item);
      }
    };

    // 添加事件监听器
    window.addEventListener('layerItemSelected', handleLayerItemSelected as EventListener);

    return () => {
      // 清理事件监听器
      window.removeEventListener('layerItemSelected', handleLayerItemSelected as EventListener);
    };
  }, [selectionTool, imageTool, model3DTool]);

  return (
    <>
      {/* 图片上传组件 */}
      <ImageUploadComponent
        onImageUploaded={imageTool.handleImageUploaded}
        onUploadError={imageTool.handleImageUploadError}
        trigger={imageTool.triggerImageUpload}
        onTriggerHandled={imageTool.handleUploadTriggerHandled}
        projectId={projectId}
      />

      {/* 快速图片上传组件（居中） */}
      <ImageUploadComponent
        onImageUploaded={quickImageUpload.handleQuickImageUploaded}
        onUploadError={quickImageUpload.handleQuickUploadError}
        trigger={quickImageUpload.triggerQuickUpload}
        onTriggerHandled={quickImageUpload.handleQuickUploadTriggerHandled}
        projectId={projectId}
      />

      {/* 3D模型上传组件 */}
      <Model3DUploadComponent
        onModel3DUploaded={model3DTool.handleModel3DUploaded}
        onUploadError={model3DTool.handleModel3DUploadError}
        trigger={model3DTool.triggerModel3DUpload}
        onTriggerHandled={model3DTool.handleModel3DUploadTriggerHandled}
        projectId={projectId}
      />

      {/* 图片UI覆盖层实例 */}
      {imageTool.imageInstances.map((image) => {
        
        return (
          <ImageContainer
            key={image.id}
            imageData={{
              id: image.id,
              url: image.imageData?.url,
              src: image.imageData?.src,
              localDataUrl: image.imageData?.localDataUrl,
              fileName: image.imageData?.fileName,
              pendingUpload: image.imageData?.pendingUpload,
            }}
            bounds={image.bounds}
            isSelected={imageTool.selectedImageIds.includes(image.id)}
            visible={image.visible}
            drawMode={drawMode}
            isSelectionDragging={selectionTool.isSelectionDragging}
            onSelect={() => imageTool.handleImageSelect(image.id)}
            onMove={(newPosition) => imageTool.handleImageMove(image.id, newPosition)}
            onResize={(newBounds) => imageTool.handleImageResize(image.id, newBounds)}
            onDelete={(imageId) => imageTool.handleImageDelete?.(imageId)}
            onToggleVisibility={(imageId) => handleImageToggleVisibility(imageId)}
            getImageDataForEditing={imageTool.getImageDataForEditing}
            showIndividualTools={!isGroupSelection}
          />
        );
      })}

      {/* 3D模型渲染实例 */}
      {model3DTool.model3DInstances.map((model) => {
        
        return (
          <Model3DContainer
            key={model.id}
            modelData={model.modelData}
            modelId={model.id}
            bounds={model.bounds}
            isSelected={model.isSelected}
            visible={model.visible}
            drawMode={drawMode}
            isSelectionDragging={selectionTool.isSelectionDragging}
            onMove={(newPosition) => model3DTool.handleModel3DMove(model.id, newPosition)}
            onResize={(newBounds) => model3DTool.handleModel3DResize(model.id, newBounds)}
            onDeselect={() => model3DTool.handleModel3DDeselect()}
            onCameraChange={(camera) => model3DTool.handleModel3DCameraChange(model.id, camera)}
            onDelete={() => model3DTool.handleModel3DDelete(model.id)}
            onCapture={() => handleModelCapture(model.id)}
            isCapturePending={!!modelCapturePending[model.id]}
            showIndividualTools={!isGroupSelection}
            onSelect={(addToSelection) => handleModelSelectFromOverlay(model.id, !!addToSelection)}
          />
        );
      })}

      {isGroupSelection && groupScreenBounds && (
        <SelectionGroupToolbar
          bounds={groupScreenBounds}
          selectedCount={groupSelectionCount}
          onCapture={handleGroupCapture}
          isCapturing={isGroupCapturePending}
        />
      )}

      {/* 文本选择框覆盖层 */}
      <TextSelectionOverlay
        textItems={simpleTextTool.textItems}
        selectedTextId={simpleTextTool.selectedTextId}
        editingTextId={simpleTextTool.editingTextId}
        isDragging={simpleTextTool.isDragging}
        isResizing={simpleTextTool.isResizing}
        onTextDragStart={simpleTextTool.startTextDrag}
        onTextDrag={simpleTextTool.dragText}
        onTextDragEnd={simpleTextTool.endTextDrag}
        onTextResizeStart={simpleTextTool.startTextResize}
        onTextResize={simpleTextTool.resizeTextDrag}
        onTextResizeEnd={simpleTextTool.endTextResize}
        onTextDoubleClick={simpleTextTool.startEditText}
      />

      {/* 简单文本编辑器 */}
      <SimpleTextEditor
        textItems={simpleTextTool.textItems}
        editingTextId={simpleTextTool.editingTextId}
        onUpdateContent={simpleTextTool.updateTextContent}
        onStopEdit={simpleTextTool.stopEditText}
      />

      {contextMenuState && contextMenuItems.length > 0 && (
        <ContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
};

export default DrawingController;
