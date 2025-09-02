import React, { useEffect, useRef, useCallback } from 'react';
import paper from 'paper';
import { useToolStore, useCanvasStore } from '@/stores';
import ImageUploadComponent from './ImageUploadComponent';
import Model3DUploadComponent from './Model3DUploadComponent';
import Model3DContainer from './Model3DContainer';
import { DrawingLayerManager } from './drawing/DrawingLayerManager';
import { AutoScreenshotService } from '@/services/AutoScreenshotService';
import { logger } from '@/utils/logger';

// 导入新的hooks
import { useImageTool } from './hooks/useImageTool';
import { useModel3DTool } from './hooks/useModel3DTool';
import { useDrawingTools } from './hooks/useDrawingTools';
import { useSelectionTool } from './hooks/useSelectionTool';
import { usePathEditor } from './hooks/usePathEditor';
import { useEraserTool } from './hooks/useEraserTool';
import { useInteractionController } from './hooks/useInteractionController';
import { useQuickImageUpload } from './hooks/useQuickImageUpload';
import type { DrawingContext } from '@/types/canvas';

interface DrawingControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const DrawingController: React.FC<DrawingControllerProps> = ({ canvasRef }) => {
  const { drawMode, currentColor, strokeWidth, isEraser, setDrawMode } = useToolStore();
  const { zoom } = useCanvasStore();
  const drawingLayerManagerRef = useRef<DrawingLayerManager | null>(null);
  const lastDrawModeRef = useRef<string>(drawMode);

  // 初始化图层管理器
  useEffect(() => {
    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }
    return () => {
      if (drawingLayerManagerRef.current) {
        drawingLayerManagerRef.current.cleanup();
        drawingLayerManagerRef.current = null;
      }
    };
  }, []);

  // 确保绘图图层存在并激活
  const ensureDrawingLayer = () => {
    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }
    return drawingLayerManagerRef.current.ensureDrawingLayer();
  };

  // ========== 初始化绘图上下文 ==========
  const drawingContext: DrawingContext = {
    ensureDrawingLayer,
    zoom
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
    canvasRef
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
      if (imageInstance) {
        // 添加到图片实例管理
        imageTool.setImageInstances(prev => [...prev, imageInstance]);
        logger.upload('快速上传的图片已添加到实例管理');
      }
    };

    window.addEventListener('quickImageAdded', handleQuickImageAdded as EventListener);

    return () => {
      window.removeEventListener('quickImageAdded', handleQuickImageAdded as EventListener);
    };
  }, [imageTool]);

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
    strokeWidth,
    isEraser,
    eventHandlers: {
      onPathCreate: (path) => console.log('路径创建:', path),
      onPathComplete: (path) => console.log('路径完成:', path),
      onDrawStart: (mode) => console.log('开始绘制:', mode),
      onDrawEnd: (mode) => console.log('结束绘制:', mode)
    }
  });

  // ========== 初始化选择工具Hook ==========
  const selectionTool = useSelectionTool({
    zoom,
    imageInstances: imageTool.imageInstances,
    model3DInstances: model3DTool.model3DInstances,
    onImageSelect: imageTool.handleImageSelect,
    onModel3DSelect: model3DTool.handleModel3DSelect,
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

      const result = await AutoScreenshotService.quickScreenshot(
        imageTool.imageInstances,
        model3DTool.model3DInstances
      );

      if (result.success) {
        logger.debug('✅ 截图成功生成:', result.filename);
        console.log('截图成功！文件已下载:', result.filename);
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
  }, [imageTool.imageInstances, model3DTool.model3DInstances, setDrawMode]);

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
    performErase: eraserTool.performErase,
    setDrawMode
  });

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
  }, [imageTool.imageInstances, model3DTool.model3DInstances]);

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
      />

      {/* 快速图片上传组件（居中） */}
      <ImageUploadComponent
        onImageUploaded={quickImageUpload.handleQuickImageUploaded}
        onUploadError={quickImageUpload.handleQuickUploadError}
        trigger={quickImageUpload.triggerQuickUpload}
        onTriggerHandled={quickImageUpload.handleQuickUploadTriggerHandled}
      />

      {/* 3D模型上传组件 */}
      <Model3DUploadComponent
        onModel3DUploaded={model3DTool.handleModel3DUploaded}
        onUploadError={model3DTool.handleModel3DUploadError}
        trigger={model3DTool.triggerModel3DUpload}
        onTriggerHandled={model3DTool.handleModel3DUploadTriggerHandled}
      />

      {/* 3D模型渲染实例 */}
      {model3DTool.model3DInstances.map((model) => (
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
      ))}
    </>
  );
};

export default DrawingController;