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
  textItems?: Array<{ id: string; paperText: paper.PointText }>;
  onImageSelect: (imageId: string, addToSelection?: boolean) => void;
  onImageMultiSelect: (imageIds: string[]) => void;
  onModel3DSelect: (modelId: string, addToSelection?: boolean) => void;
  onModel3DMultiSelect: (modelIds: string[]) => void;
  onImageDeselect: () => void;
  onModel3DDeselect: () => void;
  onTextSelect?: (textId: string, addToSelection?: boolean) => void;
  onTextMultiSelect?: (textIds: string[]) => void;
  onTextDeselect?: () => void;
}

export const useSelectionTool = ({
  zoom,
  imageInstances,
  model3DInstances,
  textItems = [],
  onImageSelect,
  onImageMultiSelect,
  onModel3DSelect,
  onModel3DMultiSelect,
  onImageDeselect,
  onModel3DDeselect,
  onTextSelect,
  onTextMultiSelect,
  onTextDeselect
}: UseSelectionToolProps) => {

  // ========== 选择工具状态 ==========
  const [selectedPath, setSelectedPath] = useState<paper.Path | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<paper.Path[]>([]);
  const [isSelectionDragging, setIsSelectionDragging] = useState(false);
  const [selectionStartPoint, setSelectionStartPoint] = useState<paper.Point | null>(null);
  const selectionBoxRef = useRef<paper.Path | null>(null);

  const isHelperOrSelectionItem = useCallback((item: paper.Item | null | undefined): boolean => {
    if (!item) return true;
    const data = item.data || {};
    if (data.isHelper || data.isSelectionHelper || data.isResizeHandle) {
      return true;
    }
    const type = data.type;
    if (type === 'image-selection-area' || type === '3d-model-selection-area' || type === 'selection-box') {
      return true;
    }
    return false;
  }, []);

  const isPlaceholderItem = useCallback((item: paper.Item | null | undefined): boolean => {
    let current: paper.Item | null | undefined = item;
    while (current) {
      const type = current.data?.type;
      if (type === 'image-placeholder' || type === '3d-model-placeholder') {
        return true;
      }
      current = current.parent as paper.Item | null | undefined;
    }
    return false;
  }, []);

  const collectPathsFromItem = useCallback((item: paper.Item | null | undefined, accumulator: paper.Path[]) => {
    if (!item || !item.bounds) return;
    if (isHelperOrSelectionItem(item)) return;
    if (isPlaceholderItem(item)) return;

    if (item instanceof paper.Path) {
      if (!accumulator.includes(item)) {
        accumulator.push(item);
      }
      return;
    }

    if (item instanceof paper.CompoundPath) {
      const children = (item as any).children as paper.Path[] | undefined;
      children?.forEach((child) => collectPathsFromItem(child, accumulator));
      return;
    }

    if (item instanceof paper.Group) {
      const children = (item as any).children as paper.Item[] | undefined;
      children?.forEach((child) => collectPathsFromItem(child, accumulator));
    }
  }, [isHelperOrSelectionItem, isPlaceholderItem]);

  // ========== 路径选择功能 ==========

  // 选择路径并启用编辑模式
  const handlePathSelect = useCallback((path: paper.Path, preserveExisting: boolean = false) => {
    // 取消之前选中的路径
    if (!preserveExisting && selectedPath && selectedPath !== path) {
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

  type SelectionBoxOptions = {
    selectFlowNodes?: boolean;
    selectPaths?: boolean;
    selectImages?: boolean;
    selectModels?: boolean;
    selectTexts?: boolean;
  };

  // 检查图层是否可见
  const isLayerVisible = useCallback((imageId: string) => {
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
        // 返回图层的可见状态
        return currentLayer.visible;
      }
    }
    return true; // 默认可见（兜底）
  }, []);

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
  const finishSelectionBox = useCallback((endPoint: paper.Point, options?: SelectionBoxOptions) => {
    if (!isSelectionDragging || !selectionStartPoint) return;
    const selectFlowNodes = options?.selectFlowNodes !== false;
    const selectPaths = options?.selectPaths !== false;
    const selectImages = options?.selectImages !== false;
    const selectModels = options?.selectModels !== false;
    const selectTexts = options?.selectTexts !== false;

    // 清除选择框
    if (selectionBoxRef.current) {
      selectionBoxRef.current.remove();
      selectionBoxRef.current = null;
    }

    // 先清除所有之前的选择（包括节点）
    onImageDeselect();
    onModel3DDeselect();
    onTextDeselect?.();

    // 清除 React Flow 节点选择
    try {
      const tanvaFlow = (window as any).tanvaFlow;
      if (tanvaFlow?.deselectAllNodes) {
        tanvaFlow.deselectAllNodes();
      }
    } catch (error) {
      console.warn('清除节点选择失败:', error);
    }

    // 创建选择区域
    const selectionRect = new paper.Rectangle(selectionStartPoint, endPoint);
    const selectedPathsInBox: paper.Path[] = [];

    // 收集要选择的对象
    const selectedImages: string[] = [];
    const selectedModels: string[] = [];
    const selectedTexts: string[] = [];
    const selectedNodeIds: string[] = [];

    // 检查图片实例是否与选择框相交
    if (selectImages) {
      for (const image of imageInstances) {
        const imageBounds = new paper.Rectangle(image.bounds.x, image.bounds.y, image.bounds.width, image.bounds.height);
        if (selectionRect.intersects(imageBounds)) {
          // 检查图层是否可见，只有可见的图层才能被选中
          if (isLayerVisible(image.id)) {
            selectedImages.push(image.id);
            logger.upload('选择框收集图片:', image.id);
          } else {
            logger.debug('选择框：图层不可见，跳过选择:', image.id);
          }
        }
      }
    }

    // 检查3D模型实例是否与选择框相交
    if (selectModels) {
      for (const model of model3DInstances) {
        const modelBounds = new paper.Rectangle(model.bounds.x, model.bounds.y, model.bounds.width, model.bounds.height);
        if (selectionRect.intersects(modelBounds)) {
          selectedModels.push(model.id);
          logger.upload('选择框收集3D模型:', model.id);
        }
      }
    }

    // 检查文本实例是否与选择框相交
    if (selectTexts) {
      for (const textItem of textItems) {
        if (textItem.paperText && textItem.paperText.bounds) {
          const textBounds = textItem.paperText.bounds;
          if (selectionRect.intersects(textBounds)) {
            if (!selectedTexts.includes(textItem.id)) {
              selectedTexts.push(textItem.id);
              logger.upload('选择框收集文本:', textItem.id);
            }
          }
        }
      }
    }

    if (selectPaths) {
      // 遍历所有图层中的所有路径（排除特殊图层）
      paper.project.layers.forEach(layer => {
        // 跳过网格和背景图层
        if (layer.name === 'grid' || layer.name === 'background') return;

        layer.children.forEach((item) => {
          if (!item || !item.bounds) return;
          if (!selectionRect.contains(item.bounds)) return;
          collectPathsFromItem(item, selectedPathsInBox);
        });
      });
    }

    // 更新路径选择状态
    // 清除之前的路径选择
    selectedPaths.forEach(path => {
      path.selected = false;
      if ((path as any).originalStrokeWidth) {
        path.strokeWidth = (path as any).originalStrokeWidth;
      }
    });

    if (selectPaths) {
      // 如果有新的路径被选中
      if (selectedPathsInBox.length > 0) {
        // 选择框内的所有路径，启用编辑模式
        selectedPathsInBox.forEach(path => {
          path.selected = true;
          path.fullySelected = true; // 显示所有控制点
          if (!(path as any).originalStrokeWidth) {
            (path as any).originalStrokeWidth = path.strokeWidth;
          }
          path.strokeWidth = (path as any).originalStrokeWidth + 1;
        });
        logger.debug(`选择了${selectedPathsInBox.length}个路径`);
      }
    }

    setSelectedPaths(selectedPathsInBox);
    setSelectedPath(null); // 清除单个选择

    // 处理所有类型的选择（同时支持多种类型）
    let totalSelected = 0;

    // 选择所有框内图片
    if (selectedImages.length > 0) {
      onImageMultiSelect(selectedImages);
      logger.upload(`选择框选中${selectedImages.length}个图片: ${selectedImages.join(', ')}`);
      totalSelected += selectedImages.length;
    }

    // 选择所有框包3D模型
    if (selectedModels.length > 0) {
      onModel3DMultiSelect(selectedModels);
      logger.upload(`选择框选中${selectedModels.length}个3D模型: ${selectedModels.join(', ')}`);
      totalSelected += selectedModels.length;
    }

    // 选择所有框内文本
    if (selectedTexts.length > 0 && onTextMultiSelect) {
      onTextMultiSelect(selectedTexts);
      logger.upload(`选择框选中${selectedTexts.length}个文本: ${selectedTexts.join(', ')}`);
      totalSelected += selectedTexts.length;
    }

    if (selectPaths) {
      // 路径已经在上面处理过了
      totalSelected += selectedPathsInBox.length;
    }

    if (selectFlowNodes) {
      // 检查并选择 React Flow 节点
      try {
        const tanvaFlow = (window as any).tanvaFlow;
        if (tanvaFlow?.selectNodesInBox && paper.view) {
          // 将 Paper.js 坐标转换为屏幕坐标（相对于视口的坐标）
          const dpr = window.devicePixelRatio || 1;
          const topLeftView = paper.view.projectToView(selectionStartPoint);
          const bottomRightView = paper.view.projectToView(endPoint);

          // 确保坐标顺序正确
          const viewX = Math.min(topLeftView.x, bottomRightView.x) / dpr;
          const viewY = Math.min(topLeftView.y, bottomRightView.y) / dpr;
          const viewWidth = Math.abs(bottomRightView.x - topLeftView.x) / dpr;
          const viewHeight = Math.abs(bottomRightView.y - topLeftView.y) / dpr;

          // 获取画布元素的位置，转换为全局屏幕坐标
          const canvas = paper.view.element as HTMLCanvasElement;
          if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const screenRect = {
              x: viewX + rect.left,
              y: viewY + rect.top,
              width: viewWidth,
              height: viewHeight
            };

            const nodeIds = tanvaFlow.selectNodesInBox(screenRect);
            selectedNodeIds.push(...nodeIds);
            if (nodeIds.length > 0) {
              logger.upload(`选择框选中${nodeIds.length}个节点: ${nodeIds.join(', ')}`);
              totalSelected += nodeIds.length;
            }
          }
        }
      } catch (error) {
        console.warn('选择节点失败:', error);
      }
    }

    // 输出总计
    if (totalSelected > 0) {
      logger.debug(`框选完成：总共选中 ${totalSelected} 个元素`);
    }

    // 重置状态
    setIsSelectionDragging(false);
    setSelectionStartPoint(null);
  }, [isSelectionDragging, selectionStartPoint, selectedPaths, onImageMultiSelect, onModel3DMultiSelect, onTextMultiSelect, onImageDeselect, onModel3DDeselect, onTextDeselect, imageInstances, model3DInstances, isLayerVisible]);

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

    // 清除Paper.js原生选择状态（避免残留的原生选择框）
    if (paper.project) {
      paper.project.deselectAll();
    }

    // 清除其他选择
    onModel3DDeselect();
    onImageDeselect();
    onTextDeselect?.();

    // 清除 React Flow 节点选择
    try {
      const tanvaFlow = (window as any).tanvaFlow;
      if (tanvaFlow?.deselectAllNodes) {
        tanvaFlow.deselectAllNodes();
      }
    } catch (error) {
      console.warn('清除节点选择失败:', error);
    }

    // 强制更新Paper.js视图，确保所有视觉状态同步
    paper.view.update();
  }, [selectedPaths, handlePathDeselect, onModel3DDeselect, onImageDeselect, onTextDeselect]);

  // ========== 点击检测功能 ==========

  // 检测点击位置的对象类型和具体对象
  const detectClickedObject = useCallback((point: paper.Point) => {
    // 使用Paper.js的hitTest进行点击检测（允许命中占位符，用于选中/删除）
    const hitResult = paper.project.hitTest(point, {
      segments: true,
      stroke: true,
      fill: true,
      tolerance: 5 / zoom // 根据缩放调整容差
    });

    // 首先检查是否点击在图片或3D模型区域内
    let imageClicked = null;
    let modelClicked = null;

    // 检查图片实例 - 反向遍历以选择最上层的图片
    for (let i = imageInstances.length - 1; i >= 0; i--) {
      const image = imageInstances[i];
      if (point.x >= image.bounds.x &&
        point.x <= image.bounds.x + image.bounds.width &&
        point.y >= image.bounds.y &&
        point.y <= image.bounds.y + image.bounds.height) {
        // 检查图层是否可见，只有可见的图层才能被选中
        if (isLayerVisible(image.id)) {
          imageClicked = image.id;
          break;
        } else {
          // 如果图层不可见，记录日志但跳过选择
          logger.debug('图层不可见，跳过选择:', image.id);
        }
      }
    }

    // 如果没有点击图片，检查3D模型实例 - 反向遍历以选择最上层的模型
    if (!imageClicked) {
      for (let i = model3DInstances.length - 1; i >= 0; i--) {
        const model = model3DInstances[i];
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
  }, [zoom, imageInstances, model3DInstances, isLayerVisible]);

  // 处理选择模式下的点击
  const handleSelectionClick = useCallback((point: paper.Point, ctrlPressed: boolean = false) => {
    const { hitResult, imageClicked, modelClicked } = detectClickedObject(point);

    // 检查是否点击了文本
    let textClicked: string | null = null;
    if (!imageClicked && !modelClicked) {
      // 反向遍历以选择最上层的文本
      for (let i = textItems.length - 1; i >= 0; i--) {
        const textItem = textItems[i];
        if (textItem.paperText && textItem.paperText.bounds) {
          if (textItem.paperText.bounds.contains(point)) {
            textClicked = textItem.id;
            break;
          }
        }
      }
    }

    if (imageClicked) {
      // 如果按住Ctrl键，进行增量选择
      if (ctrlPressed) {
        onImageSelect(imageClicked, true);
        logger.upload(`增量选中图片: ${imageClicked}`);
      } else {
        // 否则单选
        const clickedImage = imageInstances.find(img => img.id === imageClicked);
        if (!clickedImage?.isSelected) {
          clearAllSelections();
        }
        // 🔥 始终调用 onImageSelect，确保 AI 对话框同步更新
        onImageSelect(imageClicked);
        logger.upload('选中图片:', imageClicked);
      }
      return { type: 'image', id: imageClicked };
    } else if (modelClicked) {
      // 选中3D模型
      if (ctrlPressed) {
        onModel3DSelect(modelClicked, true);
        logger.upload(`增量选中3D模型: ${modelClicked}`);
      } else {
        clearAllSelections();
        onModel3DSelect(modelClicked);
        logger.upload('选中3D模型:', modelClicked);
      }
      return { type: '3d-model', id: modelClicked };
    } else if (textClicked && onTextSelect) {
      // 选中文本
      if (ctrlPressed) {
        onTextSelect(textClicked, true);
        logger.upload(`增量选中文本: ${textClicked}`);
      } else {
        clearAllSelections();
        onTextSelect(textClicked);
        logger.upload('选中文本:', textClicked);
      }
      return { type: 'text', id: textClicked };
    } else if (hitResult?.item) {
      const isPath = hitResult.item instanceof paper.Path;
      const path = isPath ? (hitResult.item as paper.Path) : null;
      const pathLayer = path?.layer;

      if (pathLayer && (pathLayer.name === "grid" || pathLayer.name === "background")) {
        logger.debug('忽略背景/网格图层中的对象');
        clearAllSelections();
        startSelectionBox(point);
        return { type: 'selection-box-start', point };
      }

      // 检查是否属于占位符组（2D图片或3D模型占位符）
      // 🔥 不再使用 placeholderGroup 引用，改为向上查找占位符组
      let foundPlaceholderGroup: paper.Group | null = null;
      let currentItem: paper.Item | null = hitResult.item;

      // 向上遍历父级查找占位符组
      while (currentItem) {
        if (currentItem.data?.type === 'image-placeholder' || currentItem.data?.type === '3d-model-placeholder') {
          foundPlaceholderGroup = currentItem as paper.Group;
          break;
        }
        currentItem = currentItem.parent as paper.Item;
      }

      if (foundPlaceholderGroup) {
        // 允许直接选中占位框，便于删除
        const mainPath = foundPlaceholderGroup.children?.find?.(
          (child: any) => child instanceof paper.Path && !(child as any).data?.uploadHotspotType
        ) as paper.Path | undefined;

        const targetPath = mainPath || (isPath ? (hitResult.item as paper.Path) : null);

        if (targetPath) {
          clearAllSelections();
          handlePathSelect(targetPath);
          setSelectedPaths([targetPath]);
          logger.debug('选中占位符:', foundPlaceholderGroup.data?.type);
          return { type: 'path', path: targetPath };
        }

        // 如果未找到合适的路径，则保持原逻辑，开始选择框
        clearAllSelections();
        startSelectionBox(point);
        return { type: 'selection-box-start', point };
      }

      if (path) {
        // 点击到了有效路径，选择它
        if (ctrlPressed) {
          // Ctrl键增量选择路径
          if (selectedPaths.includes(path)) {
            // 如果已选中，取消选择
            path.selected = false;
            path.fullySelected = false;
            if ((path as any).originalStrokeWidth) {
              path.strokeWidth = (path as any).originalStrokeWidth;
            }
            setSelectedPaths(prev => prev.filter(p => p !== path));
          } else {
            // 添加到选择
            handlePathSelect(path, true);
            setSelectedPaths(prev => [...prev, path]);
          }
        } else {
          // 单击：清除其他选择，只选择这个路径
          const isAlreadySelected =
            selectedPath === path || selectedPaths.includes(path);

          if (!isAlreadySelected) {
            clearAllSelections();
            handlePathSelect(path);
            setSelectedPaths([path]);
          } else {
            handlePathSelect(path, true);
            setSelectedPaths(prev => prev.includes(path) ? prev : [...prev, path]);
          }
        }
        logger.debug('选中路径:', path);
        return { type: 'path', path };
      }

      // 非 Path 类型但命中了元素（例如 PointText），按空白处理，开启选择框
      clearAllSelections();
      startSelectionBox(point);
      return { type: 'selection-box-start', point };
    } else {
      // 点击空白区域，先取消所有选择（包括分组）
      clearAllSelections();
      logger.debug('点击空白区域，取消所有选择');

      // 然后开始选择框拖拽
      startSelectionBox(point);
      return { type: 'selection-box-start', point };
    }
  }, [
    imageInstances,
    model3DInstances,
    textItems,
    zoom,
    clearAllSelections,
    onImageSelect,
    onModel3DSelect,
    onTextSelect,
    handlePathSelect,
    startSelectionBox,
    detectClickedObject,
    selectedPath,
    selectedPaths
  ]);

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
