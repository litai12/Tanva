import React, { useEffect, useRef, useCallback, useState } from 'react';
import paper from 'paper';
import { useToolStore, useCanvasStore, useLayerStore } from '@/stores';
import ImageUploadComponent from './ImageUploadComponent';
import Model3DUploadComponent from './Model3DUploadComponent';
import Model3DContainer from './Model3DContainer';
import { DrawingLayerManager } from './drawing/DrawingLayerManager';
import { logger } from '@/utils/logger';
import type { ExtendedPath } from '@/types/paper';

// 导入新的hooks
import { useImageTool } from './hooks/useImageTool';
import { useModel3DTool } from './hooks/useModel3DTool';
import { useDrawingTools } from './hooks/useDrawingTools';
import type { DrawingContext } from '@/types/canvas';

interface DrawingControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const DrawingController: React.FC<DrawingControllerProps> = ({ canvasRef }) => {
  const { drawMode, currentColor, strokeWidth, isEraser, setDrawMode } = useToolStore();
  const { zoom } = useCanvasStore();
  const pathRef = useRef<ExtendedPath | null>(null);
  const isDrawingRef = useRef(false);
  const drawingLayerManagerRef = useRef<DrawingLayerManager | null>(null);
  
  // 拖拽检测相关常量
  const DRAG_THRESHOLD = 3; // 3像素的拖拽阈值


  // 选择工具状态
  const [selectedPath, setSelectedPath] = useState<paper.Path | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<paper.Path[]>([]);
  const [isSelectionDragging, setIsSelectionDragging] = useState(false);
  const [selectionStartPoint, setSelectionStartPoint] = useState<paper.Point | null>(null);
  const selectionBoxRef = useRef<paper.Path | null>(null);

  // 路径编辑状态
  const [isPathDragging, setIsPathDragging] = useState(false);
  const [isSegmentDragging, setIsSegmentDragging] = useState(false);
  const [dragStartPoint, setDragStartPoint] = useState<paper.Point | null>(null);
  const [draggedSegment, setDraggedSegment] = useState<paper.Segment | null>(null);
  const [draggedPath, setDraggedPath] = useState<paper.Path | null>(null);
  

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
  const ensureDrawingLayer = useCallback(() => {
    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }
    return drawingLayerManagerRef.current.ensureDrawingLayer();
  }, []);

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
      onImageSelect: (imageId) => logger.upload('图片选中:', imageId),
      onImageDeselect: () => logger.upload('取消图片选择')
    }
  });

  // ========== 初始化3D模型工具Hook ==========
  const model3DTool = useModel3DTool({
    context: drawingContext,
    canvasRef,
    eventHandlers: {
      onModel3DSelect: (modelId) => logger.upload('3D模型选中:', modelId),
      onModel3DDeselect: () => logger.upload('取消3D模型选择')
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
      onPathCreate: (path) => logger.drawing('路径创建:', path),
      onPathComplete: (path) => logger.drawing('路径完成:', path),
      onDrawStart: (mode) => logger.drawing('开始绘制:', mode),
      onDrawEnd: (mode) => logger.drawing('结束绘制:', mode)
    }
  });

  // ========== 使用绘图工具Hook的函数 ==========
  
  // 从绘图工具hook中获取所有绘图相关函数和状态
  const {
    startFreeDraw,
    continueFreeDraw,
    startRectDraw,
    updateRectDraw,
    startCircleDraw,
    updateCircleDraw,
    startLineDraw,
    updateLineDraw,
    finishLineDraw,
    createLinePath,
    startImageDraw,
    updateImageDraw,
    start3DModelDraw,
    update3DModelDraw,
    finishDraw: drawingFinishDraw,
    pathRef: drawingPathRef,
    isDrawingRef: drawingIsDrawingRef,
    initialClickPoint,
    hasMoved
  } = drawingTools;

  // 同步hook的pathRef和isDrawingRef到组件级别的ref
  pathRef.current = drawingPathRef.current;
  isDrawingRef.current = drawingIsDrawingRef.current;
  
  // 直接使用hook提供的状态值，无需重复的ref



  // 这些函数直接在组件中使用，不需要重新赋值

  // Use the 3D model hook's deselect handler
  const handleModel3DDeselect = model3DTool.handleModel3DDeselect;

  // Use the image hook's deselect handler
  const handleImageDeselect = imageTool.handleImageDeselect;

  // Use the 3D model hook's select handler
  const handleModel3DSelect = model3DTool.handleModel3DSelect;

  // Use the image hook's select handler
  const handleImageSelect = imageTool.handleImageSelect;

  // 选择路径并启用编辑模式
  const handlePathSelect = useCallback((path: paper.Path) => {
    // 取消之前选中的路径
    if (selectedPath && selectedPath !== path) {
      selectedPath.selected = false;
      selectedPath.fullySelected = false;
      // 恢复原始样式
      if ((selectedPath as any).originalStrokeWidth) {
        selectedPath.strokeWidth = (selectedPath as any).originalStrokeWidth;
      }
    }

    // 选中新路径并启用编辑模式
    path.selected = true;
    path.fullySelected = true; // 显示所有控制点

    // 保存原始线宽并增加选中时的线宽  
    if (!(path as any).originalStrokeWidth) {
      (path as any).originalStrokeWidth = path.strokeWidth;
    }
    path.strokeWidth = (path as any).originalStrokeWidth + 1; // 稍微加粗但不太明显

    setSelectedPath(path);
    logger.debug('选择路径并启用编辑模式:', path);
    logger.debug('路径段数:', path.segments.length);
  }, [selectedPath]);

  // 取消路径选择
  const handlePathDeselect = useCallback(() => {
    if (selectedPath) {
      selectedPath.selected = false;
      selectedPath.fullySelected = false;
      // 恢复原始线宽
      if ((selectedPath as any).originalStrokeWidth) {
        selectedPath.strokeWidth = (selectedPath as any).originalStrokeWidth;
      }
      setSelectedPath(null);
      logger.debug('取消路径选择');
    }
  }, [selectedPath]);

  // 开始选择框绘制
  const startSelectionBox = useCallback((point: paper.Point) => {
    setIsSelectionDragging(true);
    setSelectionStartPoint(point);

    // 创建选择框
    const rect = new paper.Rectangle(point, point);
    selectionBoxRef.current = new paper.Path.Rectangle(rect);
    selectionBoxRef.current.strokeColor = new paper.Color('#007AFF');
    selectionBoxRef.current.strokeWidth = 1;
    selectionBoxRef.current.dashArray = [5, 5];
    selectionBoxRef.current.fillColor = new paper.Color(0, 122, 255, 0.1); // 半透明蓝色
    // 标记为辅助元素，不显示在图层列表中
    selectionBoxRef.current.data = { isHelper: true, type: 'selection-box' };

    logger.debug('开始选择框拖拽');
  }, []);

  // 更新选择框
  const updateSelectionBox = useCallback((currentPoint: paper.Point) => {
    if (!isSelectionDragging || !selectionStartPoint || !selectionBoxRef.current) return;

    // 更新选择框大小
    const rect = new paper.Rectangle(selectionStartPoint, currentPoint);
    selectionBoxRef.current.remove();
    selectionBoxRef.current = new paper.Path.Rectangle(rect);
    selectionBoxRef.current.strokeColor = new paper.Color('#007AFF');
    selectionBoxRef.current.strokeWidth = 1;
    selectionBoxRef.current.dashArray = [5, 5];
    selectionBoxRef.current.fillColor = new paper.Color(0, 122, 255, 0.1);
    // 标记为辅助元素，不显示在图层列表中
    selectionBoxRef.current.data = { isHelper: true, type: 'selection-box' };
  }, [isSelectionDragging, selectionStartPoint]);

  // 完成选择框并选择框内对象
  const finishSelectionBox = useCallback((endPoint: paper.Point) => {
    if (!isSelectionDragging || !selectionStartPoint) return;

    // 清除选择框
    if (selectionBoxRef.current) {
      selectionBoxRef.current.remove();
      selectionBoxRef.current = null;
    }

    // 创建选择区域
    const selectionRect = new paper.Rectangle(selectionStartPoint, endPoint);
    const selectedPathsInBox: paper.Path[] = [];

    // 收集要选择的对象
    const selectedImages: string[] = [];
    const selectedModels: string[] = [];

    // 检查图片实例是否与选择框相交
    for (const image of imageTool.imageInstances) {
      const imageBounds = new paper.Rectangle(image.bounds.x, image.bounds.y, image.bounds.width, image.bounds.height);
      if (selectionRect.intersects(imageBounds)) {
        selectedImages.push(image.id);
        logger.upload('选择框收集图片:', image.id);
      }
    }

    // 检查3D模型实例是否与选择框相交
    for (const model of model3DTool.model3DInstances) {
      const modelBounds = new paper.Rectangle(model.bounds.x, model.bounds.y, model.bounds.width, model.bounds.height);
      if (selectionRect.intersects(modelBounds)) {
        selectedModels.push(model.id);
        logger.upload('选择框收集3D模型:', model.id);
      }
    }

    // 遍历绘图图层中的所有路径
    const drawingLayer = paper.project.layers.find(layer => layer.name === "drawing");
    if (drawingLayer) {
      drawingLayer.children.forEach((item) => {
        if (item instanceof paper.Path) {
          // 检查路径是否在选择框内
          if (selectionRect.contains(item.bounds)) {
            // 跳过选择区域对象，只处理实际绘制的路径
            if (item.data && (item.data.type === 'image-selection-area' || item.data.type === '3d-model-selection-area')) {
              return; // 跳过选择区域对象
            }

            // 检查是否属于占位符组（2D图片或3D模型占位符）
            let isPlaceholder = false;
            let currentItem: paper.Item = item;

            // 向上遍历父级查找占位符组
            while (currentItem && currentItem.parent) {
              const parent = currentItem.parent;
              if (parent instanceof paper.Group && parent.data) {
                const parentData = parent.data;
                if (parentData.type === 'image-placeholder' || parentData.type === '3d-model-placeholder') {
                  isPlaceholder = true;
                  break;
                }
              }
              currentItem = parent as paper.Item;
            }

            // 只选择非占位符的路径
            if (!isPlaceholder) {
              selectedPathsInBox.push(item);
            }
          }
        }
      });
    }

    // 更新选择状态
    if (selectedPathsInBox.length > 0) {
      // 清除之前的选择
      selectedPaths.forEach(path => {
        path.selected = false;
        if ((path as any).originalStrokeWidth) {
          path.strokeWidth = (path as any).originalStrokeWidth;
        }
      });

      // 选择框内的所有路径，启用编辑模式
      selectedPathsInBox.forEach(path => {
        path.selected = true;
        path.fullySelected = true; // 显示所有控制点
        if (!(path as any).originalStrokeWidth) {
          (path as any).originalStrokeWidth = path.strokeWidth;
        }
        path.strokeWidth = (path as any).originalStrokeWidth + 1;
      });

      setSelectedPaths(selectedPathsInBox);
      setSelectedPath(null); // 清除单个选择
      logger.debug(`选择了${selectedPathsInBox.length}个路径`);
    }

    // 处理图片和3D模型的选择（在选择框完成后）
    if (selectedImages.length > 0) {
      // 目前只支持选择单个图片，取第一个
      handleImageSelect(selectedImages[0]);
      logger.upload(`选择框选中图片: ${selectedImages[0]}`);
    } else if (selectedModels.length > 0) {
      // 目前只支持选择单个3D模型，取第一个
      handleModel3DSelect(selectedModels[0]);
      logger.upload(`选择框选中3D模型: ${selectedModels[0]}`);
    }

    // 重置状态
    setIsSelectionDragging(false);
    setSelectionStartPoint(null);
  }, [isSelectionDragging, selectionStartPoint, selectedPaths, handleImageSelect, handleModel3DSelect, imageTool.imageInstances, model3DTool.model3DInstances]);

  // 清除所有选择
  const clearAllSelections = useCallback(() => {
    // 清除单个路径选择
    handlePathDeselect();

    // 清除多个路径选择
    selectedPaths.forEach(path => {
      path.selected = false;
      path.fullySelected = false;
      if ((path as any).originalStrokeWidth) {
        path.strokeWidth = (path as any).originalStrokeWidth;
      }
    });
    setSelectedPaths([]);

    // 清除其他选择
    handleModel3DDeselect();
    handleImageDeselect();
  }, [selectedPaths, handlePathDeselect, handleModel3DDeselect, handleImageDeselect]);

  // 检测鼠标位置是否在控制点上
  const getSegmentAt = useCallback((point: paper.Point, path: paper.Path): paper.Segment | null => {
    if (!path.segments) return null;

    const tolerance = 8 / zoom; // 根据缩放调整容差

    for (let i = 0; i < path.segments.length; i++) {
      const segment = path.segments[i];
      const distance = segment.point.getDistance(point);
      if (distance <= tolerance) {
        return segment;
      }
    }
    return null;
  }, [zoom]);

  // 开始拖拽控制点
  const startSegmentDrag = useCallback((segment: paper.Segment, startPoint: paper.Point) => {
    setIsSegmentDragging(true);
    setDraggedSegment(segment);
    setDragStartPoint(startPoint);
    logger.debug('开始拖拽控制点');
  }, []);

  // 更新控制点位置
  const updateSegmentDrag = useCallback((currentPoint: paper.Point) => {
    if (!isSegmentDragging || !draggedSegment) return;

    draggedSegment.point = currentPoint;
    logger.debug('更新控制点位置:', currentPoint);
  }, [isSegmentDragging, draggedSegment]);

  // 结束控制点拖拽
  const finishSegmentDrag = useCallback(() => {
    if (isSegmentDragging) {
      setIsSegmentDragging(false);
      setDraggedSegment(null);
      setDragStartPoint(null);
      logger.debug('结束控制点拖拽');
    }
  }, [isSegmentDragging]);

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

  // 同步图片和3D模型的可见性状态
  const syncVisibilityStates = useCallback(() => {
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
  }, []);

  // 监听图层可见性变化事件
  useEffect(() => {
    const handleVisibilitySync = () => {
      syncVisibilityStates();
    };

    window.addEventListener('layerVisibilityChanged', handleVisibilitySync);

    return () => {
      window.removeEventListener('layerVisibilityChanged', handleVisibilitySync);
    };
  }, [syncVisibilityStates]);

  // 将图片和3D模型实例暴露给图层面板使用
  useEffect(() => {
    (window as any).tanvaImageInstances = imageTool.imageInstances;
    (window as any).tanvaModel3DInstances = model3DTool.model3DInstances;
  }, [imageTool.imageInstances, model3DTool.model3DInstances]);

  // 监听图层顺序变化并更新图像的layerId
  useEffect(() => {
    // 更新所有图像实例的layerId（如果它们的Paper.js组在不同图层）
    const updateImageLayerIds = () => {
      imageTool.setImageInstances(prev => prev.map(image => {
        // 查找对应的Paper.js图像组
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
  }, []);

  // 处理图片移动
  // Use the image hook's move handler
  const handleImageMove = imageTool.handleImageMove;

  // Use the image hook's resize handler
  const handleImageResize = imageTool.handleImageResize;

  // Use the 3D model hook's move handler
  const handleModel3DMove = model3DTool.handleModel3DMove;

  // Use the 3D model hook's resize handler
  const handleModel3DResize = model3DTool.handleModel3DResize;

  // 橡皮擦功能 - 删除与橡皮擦路径相交的绘图内容
  const performErase = useCallback((eraserPath: paper.Path) => {
    const drawingLayer = ensureDrawingLayer();
    if (!drawingLayer) return;

    // 获取橡皮擦路径的边界
    const eraserBounds = eraserPath.bounds;
    const tolerance = strokeWidth + 5; // 橡皮擦容差

    // 遍历绘图图层中的所有路径
    const itemsToRemove: paper.Item[] = [];
    drawingLayer.children.forEach((item) => {
      if (item instanceof paper.Path && item !== eraserPath) {
        // 检查路径是否与橡皮擦区域相交
        if (item.bounds.intersects(eraserBounds)) {
          // 更精确的相交检测
          const intersections = item.getIntersections(eraserPath);
          if (intersections.length > 0) {
            itemsToRemove.push(item);
          } else {
            // 检查路径上的点是否在橡皮擦容差范围内
            for (const segment of item.segments) {
              const distance = eraserPath.getNearestLocation(segment.point)?.distance || Infinity;
              if (distance < tolerance) {
                itemsToRemove.push(item);
                break;
              }
            }
          }
        }
      }
    });

    // 删除相交的路径
    itemsToRemove.forEach(item => item.remove());

    logger.debug(`🧹 橡皮擦删除了 ${itemsToRemove.length} 个路径`);
  }, [strokeWidth, ensureDrawingLayer]);

  // 完成绘制
  const finishDraw = useCallback(() => {
    // 处理画线类工具的特殊情况：如果用户只是点击而没有拖拽，清理状态
    if ((drawMode === 'free' || drawMode === 'rect' || drawMode === 'circle') && !pathRef.current && initialClickPoint) {
      // 用户只是点击了但没有拖拽，清理状态通过hook的setDrawingState处理
      // 不需要手动设置ref，hook会处理状态重置
      isDrawingRef.current = false;
      return;
    }

    if (pathRef.current) {
      // 如果是橡皮擦模式，执行擦除操作然后删除橡皮擦路径
      if (isEraser) {
        performErase(pathRef.current);
        pathRef.current.remove(); // 删除橡皮擦路径本身
      } else if (drawMode === 'image') {
        // 图片模式：创建占位框
        const startPoint = pathRef.current?.startPoint;
        if (startPoint) {
          const endPoint = new paper.Point(
            pathRef.current.bounds.x + pathRef.current.bounds.width,
            pathRef.current.bounds.y + pathRef.current.bounds.height
          );

          // 删除临时绘制的矩形
          pathRef.current.remove();

          // 创建图片占位框
          imageTool.createImagePlaceholder(startPoint, endPoint);

          // 自动切换到选择模式
          setDrawMode('select');
        }
      } else if (drawMode === '3d-model') {
        // 3D模型模式：创建占位框
        const startPoint = pathRef.current?.startPoint;
        if (startPoint) {
          const endPoint = new paper.Point(
            pathRef.current.bounds.x + pathRef.current.bounds.width,
            pathRef.current.bounds.y + pathRef.current.bounds.height
          );

          // 删除临时绘制的矩形
          pathRef.current.remove();

          // 创建3D模型占位框
          model3DTool.create3DModelPlaceholder(startPoint, endPoint);

          // 自动切换到选择模式
          setDrawMode('select');
        }
      } else {
        // 普通绘制模式：在绘制完成时进行一次平滑处理
        if (drawMode === 'free' && pathRef.current.segments && pathRef.current.segments.length > 2) {
          pathRef.current.smooth({ type: 'geometric', factor: 0.4 });
        }
      }

      // 清理临时引用
      if (pathRef.current) delete pathRef.current.startPoint;

      logger.drawing(`绘制完成: ${isEraser ? '橡皮擦操作' : drawMode === 'image' ? '图片占位框，已切换到选择模式' : drawMode === '3d-model' ? '3D模型占位框，已切换到选择模式' : '普通绘制'}`);
      pathRef.current = null;

      // 触发 Paper.js 的 change 事件，确保图层面板更新
      if (paper.project) {
        paper.project.emit('change');
      }
    }

    // 清理所有绘制状态
    isDrawingRef.current = false;
    // 状态重置通过hook的setDrawingState处理
  }, [isEraser, performErase, drawMode, imageTool.createImagePlaceholder, model3DTool.create3DModelPlaceholder, setDrawMode]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;

    // 鼠标按下事件处理
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return; // 只响应左键点击

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // 转换为 Paper.js 坐标系
      const point = paper.view.viewToProject(new paper.Point(x, y));

      // 在选择模式下进行点击检测
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
        
        // 如果有选中的路径，检查是否点击在控制点上
        if (selectedPath) {
          const segment = getSegmentAt(point, selectedPath);
          if (segment) {
            // 点击在控制点上，开始控制点拖拽
            startSegmentDrag(segment, point);
            return;
          }

          // 检查是否点击在路径本身上（非控制点）
          const pathHitResult = paper.project.hitTest(point, {
            stroke: true,
            tolerance: 5 / zoom
          });

          if (pathHitResult && pathHitResult.item === selectedPath) {
            // 点击在路径上，开始路径拖拽
            startPathDrag(selectedPath, point);
            return;
          }
        }

        // 使用Paper.js的hitTest进行点击检测
        const hitResult = paper.project.hitTest(point, {
          segments: true,
          stroke: true,
          fill: true,
          tolerance: 5 / zoom // 根据缩放调整容差
        });

        // 首先检查是否点击在图片或3D模型区域内
        let imageClicked = null;
        let modelClicked = null;

        // 检查图片实例
        for (const image of imageTool.imageInstances) {
          if (point.x >= image.bounds.x &&
            point.x <= image.bounds.x + image.bounds.width &&
            point.y >= image.bounds.y &&
            point.y <= image.bounds.y + image.bounds.height) {
            imageClicked = image.id;
            // 如果点击的是已选中的图像，准备开始拖拽
            if (image.isSelected) {
              imageTool.setImageDragState({
                isImageDragging: true,
                dragImageId: image.id,
                imageDragStartPoint: point,
                imageDragStartBounds: { x: image.bounds.x, y: image.bounds.y }
              });
            }
            break;
          }
        }

        // 如果没有点击图片，检查3D模型实例
        if (!imageClicked) {
          for (const model of model3DTool.model3DInstances) {
            if (point.x >= model.bounds.x &&
              point.x <= model.bounds.x + model.bounds.width &&
              point.y >= model.bounds.y &&
              point.y <= model.bounds.y + model.bounds.height) {
              modelClicked = model.id;
              break;
            }
          }
        }

        if (imageClicked) {
          // 如果图片未选中，先选中它
          const clickedImage = imageTool.imageInstances.find(img => img.id === imageClicked);
          if (!clickedImage?.isSelected) {
            clearAllSelections();
            handleImageSelect(imageClicked);
            logger.upload('选中图片:', imageClicked);
          }
          // 如果已经选中，拖拽状态已经在上面设置
        } else if (modelClicked) {
          // 选中3D模型
          clearAllSelections();
          handleModel3DSelect(modelClicked);
          logger.upload('选中3D模型:', modelClicked);
        } else if (hitResult && hitResult.item instanceof paper.Path) {
          // 检查路径是否在网格图层或其他背景图层中，如果是则不选择
          const path = hitResult.item as paper.Path;
          const pathLayer = path.layer;

          if (pathLayer && (pathLayer.name === "grid" || pathLayer.name === "background")) {
            logger.debug('忽略背景/网格图层中的对象');
            // 取消所有选择
            clearAllSelections();
            // 开始选择框拖拽
            startSelectionBox(point);
          } else {
            // 检查是否属于占位符组（2D图片或3D模型占位符）
            let isPlaceholder = false;
            let currentItem: paper.Item = hitResult.item;

            // 向上遍历父级查找占位符组
            while (currentItem && currentItem.parent) {
              const parent = currentItem.parent;
              if (parent instanceof paper.Group && parent.data) {
                const parentData = parent.data;
                if (parentData.type === 'image-placeholder' || parentData.type === '3d-model-placeholder') {
                  isPlaceholder = true;
                  logger.debug('忽略占位符中的对象:', parentData.type);
                  break;
                }
              }
              currentItem = parent as paper.Item;
            }

            if (isPlaceholder) {
              // 取消所有选择，开始选择框拖拽
              clearAllSelections();
              startSelectionBox(point);
            } else {
              // 点击到了有效路径，选择它
              clearAllSelections(); // 先清除之前的选择
              handlePathSelect(path);
              logger.debug('选中路径:', path);
            }
          }
        } else {
          // 点击空白区域，先取消所有选择
          clearAllSelections();
          logger.debug('点击空白区域，取消所有选择');

          // 然后开始选择框拖拽
          startSelectionBox(point);
        }
        return;
      }

      logger.drawing(`开始绘制: 模式=${drawMode}, 坐标=(${x.toFixed(1)}, ${y.toFixed(1)})`);

      if (drawMode === 'free') {
        // 开始自由绘制
        startFreeDraw(point);
      } else if (drawMode === 'line') {
        // 直线绘制模式：第一次点击开始，第二次点击完成
        if (!pathRef.current?.startPoint) {
          // 第一次点击：开始绘制直线（仅记录起始位置）
          // 状态管理交给hook处理
          startLineDraw(point);
          // 直线模式使用拖拽检测机制
        } else {
          // 第二次点击：完成直线绘制
          finishLineDraw(point);
        }
      } else if (drawMode === 'rect') {
        // 开始绘制矩形
        startRectDraw(point);
      } else if (drawMode === 'circle') {
        // 开始绘制圆形
        startCircleDraw(point);
      } else if (drawMode === 'image') {
        // 开始创建图片占位框
        startImageDraw(point);
      } else if (drawMode === '3d-model') {
        // 开始创建3D模型占位框
        start3DModelDraw(point);
      }

      isDrawingRef.current = true;
    };

    // 鼠标移动事件处理
    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const point = paper.view.viewToProject(new paper.Point(x, y));

      // 在选择模式下处理各种拖拽
      if (drawMode === 'select') {
        // 处理控制点拖拽
        if (isSegmentDragging) {
          updateSegmentDrag(point);
          return;
        }

        // 处理路径拖拽
        if (isPathDragging) {
          updatePathDrag(point);
          return;
        }
        
        // 处理图像拖拽
        if (imageTool.imageDragState.isImageDragging && imageTool.imageDragState.dragImageId && imageTool.imageDragState.imageDragStartPoint && imageTool.imageDragState.imageDragStartBounds) {
          const deltaX = point.x - imageTool.imageDragState.imageDragStartPoint.x;
          const deltaY = point.y - imageTool.imageDragState.imageDragStartPoint.y;
          
          const newPosition = {
            x: imageTool.imageDragState.imageDragStartBounds.x + deltaX,
            y: imageTool.imageDragState.imageDragStartBounds.y + deltaY
          };
          
          // 直接调用handleImageMove，不跳过Paper.js更新
          handleImageMove(imageTool.imageDragState.dragImageId, newPosition, false);
          return;
        }
        
        // 处理图像调整大小
        if (imageTool.imageResizeState.isImageResizing && imageTool.imageResizeState.resizeImageId && imageTool.imageResizeState.resizeDirection && imageTool.imageResizeState.resizeStartBounds && imageTool.imageResizeState.resizeStartPoint) {
          // 获取原始宽高比
          const aspectRatio = imageTool.imageResizeState.resizeStartBounds.width / imageTool.imageResizeState.resizeStartBounds.height;
          
          let newBounds = imageTool.imageResizeState.resizeStartBounds.clone();
          
          // 根据拖拽方向调整边界，保持宽高比
          // 使用更精确的方式：让控制点跟随鼠标，同时保持宽高比
          
          if (imageTool.imageResizeState.resizeDirection === 'se') {
            // 右下角：计算鼠标到左上角的向量
            const dx = point.x - imageTool.imageResizeState.resizeStartBounds.x;
            const dy = point.y - imageTool.imageResizeState.resizeStartBounds.y;
            
            // 将鼠标位置投影到保持宽高比的对角线上
            // 对角线方向向量: (1, 1/aspectRatio)
            const diagonalX = 1;
            const diagonalY = 1 / aspectRatio;
            
            // 计算投影长度
            const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);
            
            // 计算新的宽高
            newBounds.width = Math.max(50, projectionLength * diagonalX);
            newBounds.height = newBounds.width / aspectRatio;
            
          } else if (imageTool.imageResizeState.resizeDirection === 'nw') {
            // 左上角：计算鼠标到右下角的向量
            const dx = imageTool.imageResizeState.resizeStartBounds.right - point.x;
            const dy = imageTool.imageResizeState.resizeStartBounds.bottom - point.y;
            
            // 将鼠标位置投影到保持宽高比的对角线上
            const diagonalX = 1;
            const diagonalY = 1 / aspectRatio;
            
            // 计算投影长度
            const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);
            
            // 计算新的宽高
            newBounds.width = Math.max(50, projectionLength * diagonalX);
            newBounds.height = newBounds.width / aspectRatio;
            newBounds.x = imageTool.imageResizeState.resizeStartBounds.right - newBounds.width;
            newBounds.y = imageTool.imageResizeState.resizeStartBounds.bottom - newBounds.height;
            
          } else if (imageTool.imageResizeState.resizeDirection === 'ne') {
            // 右上角：计算鼠标到左下角的向量
            const dx = point.x - imageTool.imageResizeState.resizeStartBounds.x;
            const dy = imageTool.imageResizeState.resizeStartBounds.bottom - point.y;
            
            // 将鼠标位置投影到保持宽高比的对角线上
            const diagonalX = 1;
            const diagonalY = 1 / aspectRatio;
            
            // 计算投影长度
            const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);
            
            // 计算新的宽高
            newBounds.width = Math.max(50, projectionLength * diagonalX);
            newBounds.height = newBounds.width / aspectRatio;
            newBounds.y = imageTool.imageResizeState.resizeStartBounds.bottom - newBounds.height;
            
          } else if (imageTool.imageResizeState.resizeDirection === 'sw') {
            // 左下角：计算鼠标到右上角的向量
            const dx = imageTool.imageResizeState.resizeStartBounds.right - point.x;
            const dy = point.y - imageTool.imageResizeState.resizeStartBounds.y;
            
            // 将鼠标位置投影到保持宽高比的对角线上
            const diagonalX = 1;
            const diagonalY = 1 / aspectRatio;
            
            // 计算投影长度
            const projectionLength = (dx * diagonalX + dy * diagonalY) / (diagonalX * diagonalX + diagonalY * diagonalY);
            
            // 计算新的宽高
            newBounds.width = Math.max(50, projectionLength * diagonalX);
            newBounds.height = newBounds.width / aspectRatio;
            newBounds.x = imageTool.imageResizeState.resizeStartBounds.right - newBounds.width;
          }
          
          // 更新图像边界
          handleImageResize(imageTool.imageResizeState.resizeImageId, {
            x: newBounds.x,
            y: newBounds.y,
            width: newBounds.width,
            height: newBounds.height
          });
          
          // 强制Paper.js重新渲染
          paper.view.update();
          
          return;
        }

        // 处理选择框拖拽
        if (isSelectionDragging) {
          updateSelectionBox(point);
          return;
        }

        // 鼠标悬停时更改光标样式
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
        
        if (selectedPath) {
          const segment = getSegmentAt(point, selectedPath);
          if (segment) {
            canvas.style.cursor = 'crosshair'; // 控制点上显示十字光标
            return;
          }

          const hitResult = paper.project.hitTest(point, {
            stroke: true,
            tolerance: 5 / zoom
          });

          if (hitResult && hitResult.item === selectedPath) {
            canvas.style.cursor = 'move'; // 路径上显示移动光标
            return;
          }
        }

        canvas.style.cursor = 'default'; // 默认光标
        return;
      }

      // 直线模式：检查拖拽阈值或跟随鼠标
      if (drawMode === 'line') {
        // 如果有初始点击位置且未移动，检查阈值
        if (initialClickPoint && !hasMoved) {
          const distance = initialClickPoint.getDistance(point);
          if (distance >= DRAG_THRESHOLD) {
            // 状态更新交给hook处理
            createLinePath(initialClickPoint);
          }
        }
        // 如果正在绘制直线，跟随鼠标
        if (pathRef.current?.startPoint) {
          updateLineDraw(point);
        }
        return;
      }

      // 对于绘制模式，检查是否应该处理移动事件
      // 注意：由于延迟创建机制，我们不能简单依赖 isDrawingRef.current
      
      // 对于自由绘制模式，pathRef.current 可能还未创建（延迟创建机制）
      if (drawMode === 'free') {
        // 继续自由绘制
        continueFreeDraw(point);
      } else if (drawMode === 'rect') {
        // 更新矩形
        updateRectDraw(point);
      } else if (drawMode === 'circle') {
        // 更新圆形
        updateCircleDraw(point);
      } else if (drawMode === 'image') {
        // 更新图片占位框
        updateImageDraw(point);
      } else if (drawMode === '3d-model') {
        // 更新3D模型占位框
        update3DModelDraw(point);
      }
    };

    // 鼠标抬起事件处理
    const handleMouseUp = (event: MouseEvent) => {
      // 在选择模式下处理各种拖拽结束
      if (drawMode === 'select') {
        // 处理控制点拖拽结束
        if (isSegmentDragging) {
          finishSegmentDrag();
          return;
        }

        // 处理路径拖拽结束
        if (isPathDragging) {
          finishPathDrag();
          return;
        }
        
        // 处理图像拖拽结束
        if (imageTool.imageDragState.isImageDragging) {
          // 结束拖拽状态（不需要再次更新位置，因为mousemove中已经实时更新了）
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
          // 不需要重新选择，控制点已经在拖动过程中更新了
          return;
        }

        // 处理选择框完成
        if (isSelectionDragging) {
          const rect = canvas.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          const point = paper.view.viewToProject(new paper.Point(x, y));
          finishSelectionBox(point);
          return;
        }
      }

      // 对于绘图模式，只有在实际开始绘制或有移动时才调用 finishDraw
      if (drawMode === 'line' || drawMode === 'free' || drawMode === 'rect' || drawMode === 'circle' || drawMode === 'image' || drawMode === '3d-model') {
        // 只有在实际有绘制活动时才调用finishDraw
        if (isDrawingRef.current || pathRef.current || hasMoved || initialClickPoint) {
          logger.debug(`🎨 ${drawMode}模式结束，交给finishDraw处理`);
          drawingFinishDraw(drawMode, performErase, imageTool.createImagePlaceholder, model3DTool.create3DModelPlaceholder, setDrawMode);
        }
      } else if (isDrawingRef.current) {
        logger.drawing(`结束绘制: 模式=${drawMode}`);
        drawingFinishDraw(drawMode, performErase, imageTool.createImagePlaceholder, model3DTool.create3DModelPlaceholder, setDrawMode);
      }
      isDrawingRef.current = false;
    };

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
  }, [canvasRef, drawMode, currentColor, strokeWidth, isEraser, zoom, startFreeDraw, continueFreeDraw, startLineDraw, updateLineDraw, finishLineDraw, createLinePath, startRectDraw, updateRectDraw, startCircleDraw, updateCircleDraw, startImageDraw, updateImageDraw, start3DModelDraw, update3DModelDraw, drawingFinishDraw, performErase, handleModel3DDeselect, handleImageDeselect, handlePathSelect, handlePathDeselect, startSelectionBox, updateSelectionBox, finishSelectionBox, clearAllSelections, isSelectionDragging, getSegmentAt, startSegmentDrag, updateSegmentDrag, finishSegmentDrag, startPathDrag, updatePathDrag, finishPathDrag, isSegmentDragging, isPathDragging, selectedPath, imageTool.imageInstances, model3DTool.model3DInstances, handleImageSelect, handleModel3DSelect, imageTool.imageDragState.isImageDragging, imageTool.imageDragState.dragImageId, imageTool.imageDragState.imageDragStartPoint, imageTool.imageDragState.imageDragStartBounds, handleImageMove, handleImageResize, imageTool.imageResizeState.isImageResizing, imageTool.imageResizeState.resizeImageId, imageTool.imageResizeState.resizeDirection, imageTool.imageResizeState.resizeStartBounds, imageTool.imageResizeState.resizeStartPoint, imageTool.createImagePlaceholder, model3DTool.create3DModelPlaceholder, setDrawMode, initialClickPoint, hasMoved]);

  // 监听图层面板的选择事件
  useEffect(() => {
    const handleLayerItemSelected = (event: CustomEvent) => {
      const { item, type, itemId } = event.detail;
      
      logger.debug('收到图层面板选择事件:', type, itemId);
      
      // 清除之前的所有选择
      clearAllSelections();
      
      // 根据类型进行相应的选择处理
      if (type === 'image') {
        // 对于图片，查找对应的imageId并选择
        const imageData = item.data;
        if (imageData?.imageId) {
          handleImageSelect(imageData.imageId);
        }
      } else if (type === 'model3d') {
        // 对于3D模型，查找对应的modelId并选择
        const modelData = item.data;
        if (modelData?.modelId) {
          handleModel3DSelect(modelData.modelId);
        }
      } else if (item instanceof paper.Path) {
        // 对于路径，使用统一的路径选择逻辑
        handlePathSelect(item);
      }
    };

    // 添加事件监听器
    window.addEventListener('layerItemSelected', handleLayerItemSelected as EventListener);

    return () => {
      // 清理事件监听器
      window.removeEventListener('layerItemSelected', handleLayerItemSelected as EventListener);
    };
  }, [clearAllSelections, handleImageSelect, handleModel3DSelect, handlePathSelect]);

  return (
    <>
      {/* 图片上传组件 */}
      <ImageUploadComponent
        onImageUploaded={imageTool.handleImageUploaded}
        onUploadError={imageTool.handleImageUploadError}
        trigger={imageTool.triggerImageUpload}
        onTriggerHandled={imageTool.handleUploadTriggerHandled}
      />

      {/* 图片现在完全在Paper.js中渲染和管理，不再需要React组件 */}

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
          isSelectionDragging={isSelectionDragging}
          onSelect={() => handleModel3DSelect(model.id)}
          onMove={(newPosition) => handleModel3DMove(model.id, newPosition)}
          onResize={(newBounds) => handleModel3DResize(model.id, newBounds)}
        />
      ))}
    </>
  );
};

export default DrawingController;