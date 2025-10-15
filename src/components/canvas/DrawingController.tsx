import React, { useEffect, useRef, useCallback } from 'react';
import paper from 'paper';
import { useToolStore, useCanvasStore, useLayerStore } from '@/stores';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useProjectContentStore } from '@/stores/projectContentStore';
import ImageUploadComponent from './ImageUploadComponent';
import Model3DUploadComponent from './Model3DUploadComponent';
import Model3DContainer from './Model3DContainer';
import ImageContainer from './ImageContainer';
import { DrawingLayerManager } from './drawing/DrawingLayerManager';
import { AutoScreenshotService } from '@/services/AutoScreenshotService';
import { logger } from '@/utils/logger';
import { ensureImageGroupStructure } from '@/utils/paperImageGroup';
import { contextManager } from '@/services/contextManager';
import { clipboardService, type CanvasClipboardData, type PathClipboardSnapshot } from '@/services/clipboardService';
import type { ImageAssetSnapshot, ModelAssetSnapshot, TextAssetSnapshot } from '@/types/project';

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
import type { DrawingContext } from '@/types/canvas';
import { paperSaveService } from '@/services/paperSaveService';

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

interface DrawingControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const DrawingController: React.FC<DrawingControllerProps> = ({ canvasRef }) => {
  const { drawMode, currentColor, fillColor, strokeWidth, isEraser, hasFill, setDrawMode } = useToolStore();
  const { zoom } = useCanvasStore();
  const { toggleVisibility } = useLayerStore();
  const { setSourceImageForEditing, showDialog: showAIDialog } = useAIChatStore();
  const projectId = useProjectContentStore((s) => s.projectId);
  const projectAssets = useProjectContentStore((s) => s.content?.assets);
  const drawingLayerManagerRef = useRef<DrawingLayerManager | null>(null);
  const lastDrawModeRef = useRef<string>(drawMode);

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
        console.log('🧪 Testing Paper.js save manually...');
        paperSaveService.triggerAutoSave();
      };

      (window as any).testPaperState = () => {
        console.log('🔍 Paper.js状态检查:', {
          hasPaper: !!paper,
          hasProject: !!paper?.project,
          hasView: !!paper?.view,
          projectLayers: paper?.project?.layers?.length || 0,
          layerNames: paper?.project?.layers?.map(l => l.name) || []
        });
      };
    }

    // 监听 Paper.js 项目恢复事件
    const handleProjectRecovery = (event: CustomEvent) => {
      console.log('🔄 收到Paper.js项目恢复请求，重新初始化图层管理器...');

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

        console.log('✅ Paper.js项目恢复完成');
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

  // ========== 初始化图片工具Hook ==========
  const imageTool = useImageTool({
    context: drawingContext,
    canvasRef,
    eventHandlers: {
      onImageSelect: (imageId) => console.log('图片选中:', imageId),
      onImageDeselect: () => console.log('取消图片选择')
    }
  });
  // ========== 初始化快速图片上传Hook ==========
  const quickImageUpload = useQuickImageUpload({
    context: drawingContext,
    canvasRef,
    projectId,
  });
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
      console.log('🎪 [DEBUG] DrawingController收到quickImageAdded事件:', imageInstance);

      if (imageInstance) {
        const alreadyExists = imageTool.imageInstances.some(inst => inst.id === imageInstance.id);
        if (!alreadyExists) {
          imageTool.setImageInstances(prev => [...prev, imageInstance]);
          logger.upload('快速上传的图片已添加到实例管理');
          console.log('✅ [DEBUG] 图片实例已添加到imageTool管理');
        } else {
          console.log('ℹ️ [DEBUG] quickImageAdded: 实例已存在，跳过重复添加', imageInstance.id);
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
            console.log('🧷 已将图片位置信息写入缓存（覆盖为当前实例）:', { id: imageInstance.id, bounds: imageInstance.bounds });
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
    const isEditableElement = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      const anyEl = el as any;
      if (anyEl.isContentEditable) return true;
      return false;
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
      // 简单判断：常见图片后缀或 data:image/ 开头
      if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(text)) return true;
      return false;
    };

    const handlePaste = async (e: ClipboardEvent) => {
      try {
        // 若焦点在可编辑元素中，放行默认粘贴行为
        const active = document.activeElement as Element | null;
        if (isEditableElement(active)) return;

        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

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
              await quickImageUpload.handleQuickImageUploaded?.(dataUrl, file.name);
            } catch (err) {
              console.error('粘贴图片处理失败:', err);
            }
            return; // 已处理首个图片项
          }
        }

        // 无图片项时，尝试处理文本中的图片URL
        const text = clipboardData.getData('text/plain');
        if (seemsImageUrl(text)) {
          e.preventDefault();
          try {
            // 尝试优先拉取为 Blob 转 DataURL，避免跨域导出受限
            let payload: string = text;
            try {
              const ctrl = new AbortController();
              const id = setTimeout(() => ctrl.abort(), 5000);
              const resp = await fetch(text, { signal: ctrl.signal });
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
              // 拉取失败则退回直接使用URL（可能受CORS限制，仅用于展示）
            }

            await quickImageUpload.handleQuickImageUploaded?.(payload, undefined);
          } catch (err) {
            console.error('粘贴URL处理失败:', err);
          }
        }
      } catch (err) {
        console.error('处理粘贴事件出错:', err);
      }
    };

    window.addEventListener('paste', handlePaste as EventListener);
    return () => window.removeEventListener('paste', handlePaste as EventListener);
  }, [quickImageUpload]);

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
        sourceImages
      } = event.detail;
      
      console.log('🎨 [DEBUG] 收到AI图片快速上传触发事件:', { 
        fileName, 
        hasSelectedBounds: !!selectedImageBounds,
        hasSmartPosition: !!smartPosition,
        operationType,
        sourceImageId,
        sourceImages: sourceImages?.length
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
          sourceImages
        );
        console.log('✅ [DEBUG] 已调用智能排版快速上传处理函数');
      }
    };

    window.addEventListener('triggerQuickImageUpload', handleTriggerQuickUpload as EventListener);

    return () => {
      window.removeEventListener('triggerQuickImageUpload', handleTriggerQuickUpload as EventListener);
    };
  }, [quickImageUpload]);



  // ========== 初始化3D模型工具Hook ==========
  const model3DTool = useModel3DTool({
    context: drawingContext,
    canvasRef,
    eventHandlers: {
      onModel3DSelect: (modelId) => console.log('3D模型选中:', modelId),
      onModel3DDeselect: () => console.log('取消3D模型选择')
    },
    setDrawMode
  });

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
        console.log('路径创建:', path);
      },
      onPathComplete: (path) => {
        console.log('路径完成:', path);

        // 检查 Paper.js 项目状态后再触发保存
        if (paper && paper.project && paper.view) {
          paperSaveService.triggerAutoSave();
        } else {
          console.warn('⚠️ Paper.js项目状态异常，跳过自动保存');
        }
      },
      onDrawStart: (mode) => {
        console.log('开始绘制:', mode);
      },
      onDrawEnd: (mode) => {
        console.log('结束绘制:', mode);

        // 检查 Paper.js 项目状态后再触发保存
        if (paper && paper.project && paper.view) {
          paperSaveService.triggerAutoSave();
        } else {
          console.warn('⚠️ Paper.js项目状态异常，跳过自动保存');
        }
      }
    }
  });

  // ========== 初始化选择工具Hook ==========
  const selectionTool = useSelectionTool({
    zoom,
    imageInstances: imageTool.imageInstances,
    model3DInstances: model3DTool.model3DInstances,
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
          const imageDataForCache = inlineSource || localDataUrl || cachedBeforeSelect?.imageData || null;
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
            return cachedBeforeSelect?.remoteUrl ?? null;
          })();

          // 将该图片作为最新缓存，并写入位置信息（中心通过bounds在需要时计算）
          if (imageDataForCache) {
            contextManager.cacheLatestImage(
              imageDataForCache,
              img.id,
              cachedBeforeSelect?.prompt || '用户选择的图片',
              {
                bounds: img.bounds,
                layerId: img.layerId,
                remoteUrl
              }
            );
            console.log('📌 已基于选中图片更新缓存位置:', { id: img.id, bounds: img.bounds });
          } else {
            console.warn('⚠️ 选中图片缺少可缓存的数据，跳过缓存更新', {
              imageId,
              hasInlineSource: !!inlineSource,
              hasLocalDataUrl: !!localDataUrl,
              hadCachedImage: !!cachedBeforeSelect?.imageData,
              hasRemoteUrl: !!remoteUrl
            });
          }
        }
      } catch (e) {
        console.warn('更新缓存位置失败:', e);
      }
    },
    onImageMultiSelect: imageTool.handleImageMultiSelect,
    onModel3DSelect: model3DTool.handleModel3DSelect,
    onModel3DMultiSelect: model3DTool.handleModel3DMultiSelect,
    onImageDeselect: imageTool.handleImageDeselect,
    onModel3DDeselect: model3DTool.handleModel3DDeselect
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
      console.log('🧹 收到 paper-project-cleared 事件，重置前端实例状态');

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

  // 🔄 当 projectId 变化时，清空所有实例状态，防止旧项目数据残留
  useEffect(() => {
    if (!projectId) return; // 避免初始化时清空

    console.log('🔄 项目ID变化，清空所有实例:', projectId);

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
  }, [projectId]); // 只监听 projectId，避免无限循环

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
      console.log('🛑 检测到已从 paperJson 恢复，跳过 snapshot 回填以避免重复');
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
  const handleScreenshot = useCallback(async () => {
    try {
      logger.debug('🖼️ 用户触发截图...');

      // 延迟一点，确保UI状态稳定
      await new Promise(resolve => setTimeout(resolve, 100));

      // 调试信息
      console.log('截图前的状态:', {
        imageCount: imageTool.imageInstances.length,
        model3DCount: model3DTool.model3DInstances.length,
        images: imageTool.imageInstances,
        models: model3DTool.model3DInstances
      });

      // 使用带回调的截图模式，同时下载和传入AI对话框
      const result = await AutoScreenshotService.captureAutoScreenshot(
        imageTool.imageInstances,
        model3DTool.model3DInstances,
        {
          format: 'png',
          quality: 0.92,
          scale: 2,
          padding: 0, // 无边距，与内容尺寸完全一致
          autoDownload: true, // 同时下载文件，方便检查质量
          filename: 'artboard-screenshot',
          // 截图完成后的回调，直接传入AI聊天
          onComplete: (dataUrl: string, filename: string) => {
            console.log('🎨 截图完成，同时下载文件和传入AI对话框...', { filename });
            
            // 将截图设置为AI编辑源图片
            setSourceImageForEditing(dataUrl);
            
            // 显示AI对话框
            showAIDialog();
            
            console.log('✅ 截图已下载到本地并传入AI对话框');
          }
        }
      );

      if (result.success) {
        logger.debug('✅ 截图成功生成:', result.filename);
        console.log('截图成功！已下载到本地并传入AI对话框:', result.filename);
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
  }, [imageTool.imageInstances, model3DTool.model3DInstances, setDrawMode, setSourceImageForEditing, showAIDialog]);

  // 监听截图工具的激活
  useEffect(() => {
    if (drawMode === 'screenshot') {
      // 当选择截图工具时，立即执行截图
      handleScreenshot();
    }
  }, [drawMode, handleScreenshot]);

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
      const paperSelected = (paper.project?.getSelectedItems?.() ?? []).filter((item): item is paper.Path => item instanceof paper.Path);
      paperSelected.forEach((path) => pathSet.add(path));
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
  } = simpleTextTool;

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

          const strokeWidth = snapshot.strokeWidth ?? item.data?.originalStrokeWidth ?? item.strokeWidth ?? strokeWidthRef.current ?? strokeWidth;
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

  const editingTextId = simpleTextTool.editingTextId;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      logger.debug('画布键盘事件', {
        key: event.key,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        defaultPrevented: event.defaultPrevented,
      });
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

      if (isCopy) {
        const handled = handleCanvasCopy();
        if (handled) {
          event.preventDefault();
        }
        return;
      }

      if (isPaste) {
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

  // 图元上移处理函数（在同一图层内调整顺序）
  const handleImageLayerMoveUp = useCallback((imageId: string) => {
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
          // 在同一图层内查找其他图片元素（排除辅助元素）
          const imageItemsInLayer = currentLayer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId
          );

          // 找到当前图片在图层内的索引
          const currentIndex = imageItemsInLayer.indexOf(imageGroup);

          // 如果不是最顶层，可以上移
          if (currentIndex < imageItemsInLayer.length - 1) {
            // 获取上面的图片元素
            const nextImageItem = imageItemsInLayer[currentIndex + 1];
            if (nextImageItem) {
              // 将当前图片插入到上面图片的前面
              imageGroup.insertAbove(nextImageItem);
              console.log(`⬆️ 图片 ${imageId} 在图层内上移 (图层: ${currentLayer.name})`);
              console.log(`📊 图层内顺序: ${imageItemsInLayer.map(item => item.data?.imageId).join(' → ')}`);
            }
          } else {
            console.log('📍 图片已在图层内最顶层');
          }
        }
      } else {
        console.warn('未找到对应的图片图层组');
      }
    } catch (error) {
      console.error('图元上移失败:', error);
    }
  }, []);

  // 图元下移处理函数（在同一图层内调整顺序）
  const handleImageLayerMoveDown = useCallback((imageId: string) => {
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
          // 在同一图层内查找其他图片元素（排除辅助元素）
          const imageItemsInLayer = currentLayer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId
          );

          // 找到当前图片在图层内的索引
          const currentIndex = imageItemsInLayer.indexOf(imageGroup);

          // 如果不是最底层，可以下移
          if (currentIndex > 0) {
            // 获取下面的图片元素
            const prevImageItem = imageItemsInLayer[currentIndex - 1];
            if (prevImageItem) {
              // 将当前图片插入到下面图片的后面
              imageGroup.insertBelow(prevImageItem);
              console.log(`⬇️ 图片 ${imageId} 在图层内下移 (图层: ${currentLayer.name})`);
              console.log(`📊 图层内顺序: ${imageItemsInLayer.map(item => item.data?.imageId).join(' → ')}`);
            }
          } else {
            console.log('📍 图片已在图层内最底层');
          }
        }
      } else {
        console.warn('未找到对应的图片图层组');
      }
    } catch (error) {
      console.error('图元下移失败:', error);
    }
  }, []);

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
          
          console.log(`👁️ 切换图层可见性: ${currentLayer.name} (storeId: ${layerStoreId})`);
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

    // 也定期检查以确保同步
    const intervalId = setInterval(updateImageLayerIds, 1000);

    return () => {
      window.removeEventListener('layerOrderChanged', handleLayerOrderChanged);
      clearInterval(intervalId);
    };
  }, [imageTool]);

  // 监听图层面板触发的实例更新事件
  useEffect(() => {
    // 处理图片实例更新
    const handleImageInstanceUpdate = (event: CustomEvent) => {
      const { imageId, layerId } = event.detail;
      console.log(`🔄 DrawingController收到图片实例更新事件: ${imageId} → 图层${layerId}`);
      
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
      console.log(`🔄 DrawingController收到3D模型实例更新事件: ${modelId} → 图层${layerId}`);
      
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

                  return {
                    id: ensuredImageId,
                    imageData: {
                      id: ensuredImageId,
                      url: remoteUrl,
                      src: inlineDataUrl || remoteUrl,
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
                  imageInstances.push({
                    id: ensuredImageId,
                    imageData: {
                      id: ensuredImageId,
                      url: remoteUrl,
                      src: inlineDataUrl || remoteUrl,
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
                const modelData = model3DGroup.data.modelData || {
                  url: model3DGroup.data.url || '',
                  path: model3DGroup.data.url || '',
                  format: model3DGroup.data.format || 'glb',
                  fileName: model3DGroup.data.fileName || 'model',
                  fileSize: model3DGroup.data.fileSize || 0,
                  defaultScale: model3DGroup.data.defaultScale || { x: 1, y: 1, z: 1 },
                  defaultRotation: model3DGroup.data.defaultRotation || { x: 0, y: 0, z: 0 },
                  timestamp: model3DGroup.data.timestamp || Date.now(),
                };

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
          console.log(`🧩 已从 Paper 恢复 ${imageInstances.length} 张图片实例`);
        }

        // 更新文字实例
        simpleTextTool.hydrateFromPaperItems(textInstances);
        try { (window as any).tanvaTextItems = textInstances; } catch {}
        if (textInstances.length > 0) {
          console.log(`📝 已从 Paper 恢复 ${textInstances.length} 个文字实例`);
        }

        // 更新3D模型实例
        if (model3DInstances.length > 0) {
          model3DTool.setModel3DInstances(model3DInstances);
          model3DTool.setSelectedModel3DIds([]);
          try { (window as any).tanvaModel3DInstances = model3DInstances; } catch {}
          console.log(`🎮 已从 Paper 恢复 ${model3DInstances.length} 个3D模型实例`);
        }

        // 输出总结
        const total = imageInstances.length + textInstances.length + model3DInstances.length;
        if (total > 0) {
          console.log(`✅ 从 Paper.js 共恢复 ${total} 个实例（图片${imageInstances.length}，文字${textInstances.length}，3D${model3DInstances.length}）`);
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

      console.log('收到图层面板选择事件:', type, itemId);

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
            onMoveLayerUp={(imageId) => handleImageLayerMoveUp(imageId)}
            onMoveLayerDown={(imageId) => handleImageLayerMoveDown(imageId)}
            onToggleVisibility={(imageId) => handleImageToggleVisibility(imageId)}
            getImageDataForEditing={imageTool.getImageDataForEditing}
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
            onSelect={() => model3DTool.handleModel3DSelect(model.id)}
            onMove={(newPosition) => model3DTool.handleModel3DMove(model.id, newPosition)}
            onResize={(newBounds) => model3DTool.handleModel3DResize(model.id, newBounds)}
          />
        );
      })}

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
      />

      {/* 简单文本编辑器 */}
      <SimpleTextEditor
        textItems={simpleTextTool.textItems}
        editingTextId={simpleTextTool.editingTextId}
        onUpdateContent={simpleTextTool.updateTextContent}
        onStopEdit={simpleTextTool.stopEditText}
      />
    </>
  );
};

export default DrawingController;
