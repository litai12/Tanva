/**
 * 选择工具Hook
 * 处理选择框绘制、路径选择、区域选择等功能
 */

import { useCallback, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import type { ImageInstance, Model3DInstance } from '@/types/canvas';

interface UseSelectionToolProps {
  zoom: number;
  imageInstances: ImageInstance[];
  model3DInstances: Model3DInstance[];
  onImageSelect: (imageId: string) => void;
  onModel3DSelect: (modelId: string) => void;
  onImageDeselect: () => void;
  onModel3DDeselect: () => void;
}

export const useSelectionTool = ({
  zoom,
  imageInstances,
  model3DInstances,
  onImageSelect,
  onModel3DSelect,
  onImageDeselect,
  onModel3DDeselect
}: UseSelectionToolProps) => {

  // ========== 选择工具状态 ==========
  const [selectedPath, setSelectedPath] = useState<paper.Path | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<paper.Path[]>([]);
  const [isSelectionDragging, setIsSelectionDragging] = useState(false);
  const [selectionStartPoint, setSelectionStartPoint] = useState<paper.Point | null>(null);
  const selectionBoxRef = useRef<paper.Path | null>(null);

  // ========== 路径选择功能 ==========

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

  // ========== 选择框功能 ==========

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
    for (const image of imageInstances) {
      const imageBounds = new paper.Rectangle(image.bounds.x, image.bounds.y, image.bounds.width, image.bounds.height);
      if (selectionRect.intersects(imageBounds)) {
        selectedImages.push(image.id);
        logger.upload('选择框收集图片:', image.id);
      }
    }

    // 检查3D模型实例是否与选择框相交
    for (const model of model3DInstances) {
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
      onImageSelect(selectedImages[0]);
      logger.upload(`选择框选中图片: ${selectedImages[0]}`);
    } else if (selectedModels.length > 0) {
      // 目前只支持选择单个3D模型，取第一个
      onModel3DSelect(selectedModels[0]);
      logger.upload(`选择框选中3D模型: ${selectedModels[0]}`);
    }

    // 重置状态
    setIsSelectionDragging(false);
    setSelectionStartPoint(null);
  }, [isSelectionDragging, selectionStartPoint, selectedPaths, onImageSelect, onModel3DSelect, imageInstances, model3DInstances]);

  // ========== 清除所有选择 ==========
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
    onModel3DDeselect();
    onImageDeselect();
  }, [selectedPaths, handlePathDeselect, onModel3DDeselect, onImageDeselect]);

  // ========== 点击检测功能 ==========

  // 检测点击位置的对象类型和具体对象
  const detectClickedObject = useCallback((point: paper.Point) => {
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
    for (const image of imageInstances) {
      if (point.x >= image.bounds.x &&
        point.x <= image.bounds.x + image.bounds.width &&
        point.y >= image.bounds.y &&
        point.y <= image.bounds.y + image.bounds.height) {
        imageClicked = image.id;
        break;
      }
    }

    // 如果没有点击图片，检查3D模型实例
    if (!imageClicked) {
      for (const model of model3DInstances) {
        if (point.x >= model.bounds.x &&
          point.x <= model.bounds.x + model.bounds.width &&
          point.y >= model.bounds.y &&
          point.y <= model.bounds.height) {
          modelClicked = model.id;
          break;
        }
      }
    }

    return {
      hitResult,
      imageClicked,
      modelClicked
    };
  }, [zoom, imageInstances, model3DInstances]);

  // 处理选择模式下的点击
  const handleSelectionClick = useCallback((point: paper.Point) => {
    const { hitResult, imageClicked, modelClicked } = detectClickedObject(point);

    if (imageClicked) {
      // 如果图片未选中，先选中它
      const clickedImage = imageInstances.find(img => img.id === imageClicked);
      if (!clickedImage?.isSelected) {
        clearAllSelections();
        onImageSelect(imageClicked);
        logger.upload('选中图片:', imageClicked);
      }
      return { type: 'image', id: imageClicked };
    } else if (modelClicked) {
      // 选中3D模型
      clearAllSelections();
      onModel3DSelect(modelClicked);
      logger.upload('选中3D模型:', modelClicked);
      return { type: '3d-model', id: modelClicked };
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
        return { type: 'selection-box-start', point };
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
          return { type: 'selection-box-start', point };
        } else {
          // 点击到了有效路径，选择它
          clearAllSelections(); // 先清除之前的选择
          handlePathSelect(path);
          logger.debug('选中路径:', path);
          return { type: 'path', path };
        }
      }
    } else {
      // 点击空白区域，先取消所有选择
      clearAllSelections();
      logger.debug('点击空白区域，取消所有选择');

      // 然后开始选择框拖拽
      startSelectionBox(point);
      return { type: 'selection-box-start', point };
    }
  }, [imageInstances, model3DInstances, zoom, clearAllSelections, onImageSelect, onModel3DSelect, handlePathSelect, startSelectionBox, detectClickedObject]);

  return {
    // 状态
    selectedPath,
    selectedPaths,
    isSelectionDragging,
    selectionStartPoint,

    // 路径选择
    handlePathSelect,
    handlePathDeselect,

    // 选择框功能
    startSelectionBox,
    updateSelectionBox,
    finishSelectionBox,

    // 通用功能
    clearAllSelections,
    detectClickedObject,
    handleSelectionClick,

    // 状态设置器（供外部直接控制）
    setSelectedPath,
    setSelectedPaths,
    setIsSelectionDragging,
    setSelectionStartPoint,
  };
};