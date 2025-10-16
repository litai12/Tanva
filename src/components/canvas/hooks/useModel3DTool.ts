/**
 * 3D模型工具Hook
 * 处理3D模型上传、占位框创建、模型实例管理、选择、移动和调整大小等功能
 */

import { useCallback, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import { paperSaveService } from '@/services/paperSaveService';
import { historyService } from '@/services/historyService';
import type { 
  Model3DInstance, 
  Model3DToolEventHandlers,
  DrawingContext 
} from '@/types/canvas';
import type { Model3DData } from '@/services/model3DUploadService';
import type { ModelAssetSnapshot } from '@/types/project';
import { useLayerStore } from '@/stores/layerStore';
import type { DrawMode } from '@/stores/toolStore';

interface UseModel3DToolProps {
  context: DrawingContext;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  eventHandlers?: Model3DToolEventHandlers;
  setDrawMode?: (mode: DrawMode) => void;
}

export const useModel3DTool = ({ context, canvasRef, eventHandlers = {}, setDrawMode }: UseModel3DToolProps) => {
  const { ensureDrawingLayer, zoom } = context;

  // 3D模型相关状态
  const [triggerModel3DUpload, setTriggerModel3DUpload] = useState(false);
  const currentModel3DPlaceholderRef = useRef<paper.Group | null>(null);
  const [model3DInstances, setModel3DInstances] = useState<Model3DInstance[]>([]);
  const [selectedModel3DIds, setSelectedModel3DIds] = useState<string[]>([]);  // 支持多选

  // ========== 创建3D模型占位框 ==========
  const create3DModelPlaceholder = useCallback((startPoint: paper.Point, endPoint: paper.Point) => {
    ensureDrawingLayer();

    // 计算占位框矩形
    const rect = new paper.Rectangle(startPoint, endPoint);
    const center = rect.center;
    const width = Math.abs(rect.width);
    const height = Math.abs(rect.height);

    // 最小尺寸限制（3D模型需要更大的空间）
    const minSize = 80;
    const finalWidth = Math.max(width, minSize);
    const finalHeight = Math.max(height, minSize);

    // 创建占位框边框（虚线矩形）
    const placeholder = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(center.subtract([finalWidth / 2, finalHeight / 2]), [finalWidth, finalHeight]),
      strokeColor: new paper.Color('#8b5cf6'),
      strokeWidth: 1,
      dashArray: [8, 4],
      fillColor: new paper.Color(0.95, 0.9, 1, 0.6) // 淡紫色背景
    });

    // 创建上传按钮背景（圆角矩形）
    const buttonSize = Math.min(finalWidth * 0.6, finalHeight * 0.3, 140);
    const buttonHeight = Math.min(45, finalHeight * 0.25);

    // 创建按钮背景
    const buttonBg = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(center.subtract([buttonSize / 2, buttonHeight / 2]), [buttonSize, buttonHeight]),
      fillColor: new paper.Color('#7c3aed'),
      strokeColor: new paper.Color('#6d28d9'),
      strokeWidth: 1
    });

    // 创建3D立方体图标
    const iconSize = Math.min(16, buttonHeight * 0.4);
    const cubeOffset = iconSize * 0.3;

    // 立方体前面
    const frontFace = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(
        center.subtract([iconSize / 2, iconSize / 2]),
        [iconSize, iconSize]
      ),
      fillColor: new paper.Color('#fff'),
      strokeColor: new paper.Color('#fff'),
      strokeWidth: 1
    });

    // 立方体顶面
    const topFace = new paper.Path([
      center.add([-iconSize / 2, -iconSize / 2]),
      center.add([iconSize / 2, -iconSize / 2]),
      center.add([iconSize / 2 + cubeOffset, -iconSize / 2 - cubeOffset]),
      center.add([-iconSize / 2 + cubeOffset, -iconSize / 2 - cubeOffset])
    ]);
    topFace.fillColor = new paper.Color('#e5e7eb');
    topFace.strokeColor = new paper.Color('#fff');
    topFace.strokeWidth = 1;

    // 立方体右侧面
    const rightFace = new paper.Path([
      center.add([iconSize / 2, -iconSize / 2]),
      center.add([iconSize / 2, iconSize / 2]),
      center.add([iconSize / 2 + cubeOffset, iconSize / 2 - cubeOffset]),
      center.add([iconSize / 2 + cubeOffset, -iconSize / 2 - cubeOffset])
    ]);
    rightFace.fillColor = new paper.Color('#d1d5db');
    rightFace.strokeColor = new paper.Color('#fff');
    rightFace.strokeWidth = 1;

    // 创建提示文字 - 调整位置，在按钮下方留出适当间距
    const textY = Math.round(center.y + buttonHeight / 2 + 25);
    const fontSize = Math.round(Math.min(14, finalWidth * 0.06, finalHeight * 0.08));
    const text = new paper.PointText({
      point: new paper.Point(Math.round(center.x), textY),
      content: '点击上传3D模型',
      fontSize: fontSize,
      fillColor: new paper.Color('#6b21a8'),
      justification: 'center'
    });

    // 创建组合
    const group = new paper.Group([placeholder, buttonBg, frontFace, topFace, rightFace, text]);
    group.data = {
      type: '3d-model-placeholder',
      bounds: { x: center.x - finalWidth / 2, y: center.y - finalHeight / 2, width: finalWidth, height: finalHeight },
      isHelper: true  // 标记为辅助元素，不显示在图层列表中
    };

    // 添加点击事件
    group.onClick = () => {
      logger.upload('🎲 点击3D模型占位框，触发上传');
      currentModel3DPlaceholderRef.current = group;
      setTriggerModel3DUpload(true);
    };

    return group;
  }, [ensureDrawingLayer]);

  // ========== 处理3D模型上传成功 ==========
  type UploadOptions = {
    skipAutoSave?: boolean;
  };

  const handleModel3DUploaded = useCallback((modelData: Model3DData, overrideId?: string, options?: UploadOptions) => {
    const placeholder = currentModel3DPlaceholderRef.current;
    if (!placeholder || !placeholder.data?.bounds) {
      logger.error('没有找到3D模型占位框');
      return;
    }

    logger.upload('✅ 3D模型上传成功，创建3D渲染实例:', modelData.fileName);

    const paperBounds = placeholder.data.bounds;
    const modelId = overrideId || `model3d_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.upload('📍 3D模型使用Paper.js坐标:', paperBounds);

    // 在Paper.js中创建3D模型的代表组
    ensureDrawingLayer();
    
    // 创建一个透明矩形用于交互
    const modelRect = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(
        paperBounds.x,
        paperBounds.y,
        paperBounds.width,
        paperBounds.height
      ),
      fillColor: null,
      strokeColor: null
    });

    // 创建Paper.js组来包含所有相关元素
    const modelGroup = new paper.Group([modelRect]);
    const resolvedPath = modelData.path || modelData.url;
    modelRect.data = {
      type: '3d-model-hit-area',
      modelId,
      isHelper: true
    };
    modelGroup.data = {
      type: '3d-model',
      modelId,
      isHelper: false,
      bounds: { ...paperBounds },
      modelData: { ...modelData, path: resolvedPath },
      url: modelData.url,
      path: resolvedPath,
      key: modelData.key,
      format: modelData.format,
      fileName: modelData.fileName,
      fileSize: modelData.fileSize,
      defaultScale: modelData.defaultScale,
      defaultRotation: modelData.defaultRotation,
      timestamp: modelData.timestamp,
      layerId: modelGroup.layer?.name ?? null
    };

    // 添加选择边框（默认隐藏，且不随选中显示，以避免与屏幕坐标的蓝色框重复）
    const selectionRect = new paper.Path.Rectangle({
      rectangle: new paper.Rectangle(
        paperBounds.x,
        paperBounds.y,
        paperBounds.width,
        paperBounds.height
      ),
      strokeColor: null, // 不渲染描边
      strokeWidth: 1,
      fillColor: null,
      visible: false, // 默认隐藏选择框
      selected: false
    });
    selectionRect.data = { 
      type: '3d-model-selection-area',
      modelId,
      isHelper: true  // 标记为辅助元素，不显示在图层列表中
    };
    selectionRect.locked = true;
    try { modelGroup.addChild(selectionRect); } catch {}

    // 创建3D模型实例 - 直接使用Paper.js坐标
    const newModel3DInstance: Model3DInstance = {
      id: modelId,
      modelData: { ...modelData, path: resolvedPath },
      bounds: paperBounds, // 存储Paper.js坐标
      isSelected: false, // 默认不选中，避免显示选择框
      visible: true,
      selectionRect: selectionRect
    };

    // 添加到3D模型实例数组
    setModel3DInstances(prev => [...prev, newModel3DInstance]);
    if (!options?.skipAutoSave) {
      try { paperSaveService.triggerAutoSave('model3d-uploaded'); } catch {}
      historyService.commit('create-model3d').catch(() => {});
    }
    // 不默认选中，让用户需要时再点击选择
    // setSelectedModel3DId(modelId);
    // eventHandlers.onModel3DSelect?.(modelId);

    // 删除占位框
    placeholder.remove();
    currentModel3DPlaceholderRef.current = null;

    // 自动切换回选择模式
    setDrawMode?.('select');

    logger.upload('🎯 3D模型实例创建完成:', modelId);
  }, [ensureDrawingLayer, eventHandlers.onModel3DSelect, setDrawMode]);

  // ========== 3D模型选择/取消选择 ==========
  // 更新3D模型选择视觉效果
  const updateModel3DSelectionVisuals = useCallback((selectedIds: string[]) => {
    setModel3DInstances(prev => prev.map(model => {
      const isSelected = selectedIds.includes(model.id);
      // 选择框由屏幕坐标的容器负责可视反馈；Paper内的 selectionRect 仅用于选择逻辑，不显示
      if (model.selectionRect) model.selectionRect.visible = false;
      return {
        ...model,
        isSelected
      };
    }));
  }, []);

  const handleModel3DSelect = useCallback((modelId: string, addToSelection: boolean = false) => {
    // 更新选择状态
    if (addToSelection) {
      // 增量选择模式
      setSelectedModel3DIds(prev => {
        if (prev.includes(modelId)) {
          // 如果已选中，则取消选择
          const newIds = prev.filter(id => id !== modelId);
          updateModel3DSelectionVisuals(newIds);
          return newIds;
        } else {
          // 否则添加到选择
          const newIds = [...prev, modelId];
          updateModel3DSelectionVisuals(newIds);
          return newIds;
        }
      });
    } else {
      // 单选模式
      setSelectedModel3DIds([modelId]);
      updateModel3DSelectionVisuals([modelId]);
    }
    
    eventHandlers.onModel3DSelect?.(modelId);
  }, [eventHandlers.onModel3DSelect, updateModel3DSelectionVisuals]);

  // 批量选择3D模型
  const handleModel3DMultiSelect = useCallback((modelIds: string[]) => {
    logger.upload(`批量选中3D模型: ${modelIds.join(', ')}`);
    setSelectedModel3DIds(modelIds);
    updateModel3DSelectionVisuals(modelIds);
    
    // 触发批量选择事件
    if (eventHandlers.onModel3DMultiSelect) {
      eventHandlers.onModel3DMultiSelect(modelIds);
    }
  }, [eventHandlers.onModel3DMultiSelect, updateModel3DSelectionVisuals]);

  const handleModel3DDeselect = useCallback(() => {
    setSelectedModel3DIds([]);
    updateModel3DSelectionVisuals([]);
    eventHandlers.onModel3DDeselect?.();
  }, [eventHandlers.onModel3DDeselect, updateModel3DSelectionVisuals]);

  // ========== 3D模型移动 ==========
  const handleModel3DMove = useCallback((modelId: string, newPosition: { x: number; y: number }) => {
    let didUpdate = false;
    setModel3DInstances(prev => prev.map(model => {
      if (model.id === modelId) {
        const newBounds = { ...model.bounds, x: newPosition.x, y: newPosition.y };

        // 更新对应的Paper.js模型组
        const modelGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === '3d-model' && child.data?.modelId === modelId
          )
        )[0];

        if (modelGroup instanceof paper.Group) {
          const deltaX = newPosition.x - model.bounds.x;
          const deltaY = newPosition.y - model.bounds.y;

          // 更新每个子元素的位置，确保selection-area也被更新
          modelGroup.children.forEach(child => {
            if (child.data?.type === '3d-model-selection-area') {
              // 更新选择区域的bounds（关键！用于点击检测）
              child.bounds = new paper.Rectangle(
                newBounds.x,
                newBounds.y,
                newBounds.width,
                newBounds.height
              );
            } else {
              // 其他子元素使用相对位移
              child.position = child.position.add(new paper.Point(deltaX, deltaY));
            }
          });
          if (modelGroup.data) {
            modelGroup.data.bounds = { ...newBounds };
          }
        }

        // 更新选择边框位置（内部使用，不显示）
        if (model.selectionRect) {
          model.selectionRect.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
          model.selectionRect.visible = false;
        }

        eventHandlers.onModel3DMove?.(modelId, newPosition);

        didUpdate = true;
        return {
          ...model,
          bounds: newBounds
        };
      }
      return model;
    }));
    if (didUpdate) {
      try { paperSaveService.triggerAutoSave('model3d-move'); } catch {}
    }
  }, [eventHandlers.onModel3DMove]);

  // ========== 3D模型调整大小 ==========
  const handleModel3DResize = useCallback((modelId: string, newBounds: { x: number; y: number; width: number; height: number }) => {
    let didUpdate = false;
    setModel3DInstances(prev => prev.map(model => {
      if (model.id === modelId) {
        // 更新对应的Paper.js模型组
        const modelGroup = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === '3d-model' && child.data?.modelId === modelId
          )
        )[0];

        if (modelGroup instanceof paper.Group && modelGroup.children.length > 0) {
          // 更新组的边界
          const rect = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );

          // 更新每个子元素，确保selection-area也被更新
          modelGroup.children.forEach(child => {
            if (child.data?.type === '3d-model-selection-area') {
              // 更新选择区域的bounds（关键！用于点击检测）
              child.bounds = rect.clone();
            }
          });

          // 最后更新整个组的边界（会缩放其他子元素）
          modelGroup.bounds = rect;
          if (modelGroup.data) {
            modelGroup.data.bounds = {
              x: newBounds.x,
              y: newBounds.y,
              width: newBounds.width,
              height: newBounds.height
            };
          }
        }

        // 更新选择边框（内部使用，不显示）
        if (model.selectionRect) {
          model.selectionRect.bounds = new paper.Rectangle(
            newBounds.x,
            newBounds.y,
            newBounds.width,
            newBounds.height
          );
          model.selectionRect.visible = false;
        }

        eventHandlers.onModel3DResize?.(modelId, newBounds);

        didUpdate = true;
        return {
          ...model,
          bounds: newBounds
        };
      }
      return model;
    }));
    if (didUpdate) {
      try { paperSaveService.triggerAutoSave('model3d-resize'); } catch {}
    }
  }, [eventHandlers.onModel3DResize]);

  // ========== 3D模型删除 ==========
  const handleModel3DDelete = useCallback((modelId: string) => {
    console.log('🗑️ 开始删除3D模型:', modelId);

    // 从Paper.js中移除3D模型对象（深度清理）
    try {
      if (paper && paper.project) {
        const matches = paper.project.getItems({
          match: (item: any) => {
            const d = item?.data || {};
            const isModelGroup = d.type === '3d-model' && d.modelId === modelId;
            return isModelGroup;
          }
        }) as paper.Item[];

        if (matches.length > 0) {
          matches.forEach((item) => {
            let target: any = item;
            while (target && !(target instanceof paper.Layer)) {
              if (target?.data?.type === '3d-model' && target?.data?.modelId === modelId) {
                try { target.remove(); } catch {}
                return;
              }
              target = target.parent;
            }
            try { item.remove(); } catch {}
          });
          try { paper.view.update(); } catch {}
          console.log('🗑️ 已从Paper.js中移除3D模型（深度清理）');
        } else {
          console.warn('未找到需要删除的3D模型对象，可能已被移除');
        }
      }
    } catch (e) {
      console.warn('删除3D模型对象时出错:', e);
    }

    // 从React状态中移除3D模型
    setModel3DInstances(prev => {
      const filtered = prev.filter(m => m.id !== modelId);
      console.log('🗑️ 已从状态中移除3D模型，剩余数量:', filtered.length);
      return filtered;
    });

    // 清理选中状态
    setSelectedModel3DIds(prev => prev.filter(id => id !== modelId));

    // 触发回调与保存
    eventHandlers.onModel3DDelete?.(modelId);
    try { paperSaveService.triggerAutoSave(); } catch {}
    historyService.commit('delete-model3d').catch(() => {});
  }, [eventHandlers.onModel3DDelete]);

  // ========== 3D模型上传错误处理 ==========
  const handleModel3DUploadError = useCallback((error: string) => {
    logger.error('3D模型上传失败:', error);
    currentModel3DPlaceholderRef.current = null;
  }, []);

  // ========== 处理上传触发完成 ==========
  const handleModel3DUploadTriggerHandled = useCallback(() => {
    setTriggerModel3DUpload(false);
  }, []);

  const hydrateFromSnapshot = useCallback((snapshots: ModelAssetSnapshot[]) => {
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      setModel3DInstances([]);
      setSelectedModel3DIds([]);
      return;
    }

    setModel3DInstances([]);
    setSelectedModel3DIds([]);

    snapshots.forEach((snap) => {
      const snapUrl = snap?.url || snap?.path;
      if (!snap || !snapUrl || !snap.bounds) return;
      if (snap.layerId) {
        try { useLayerStore.getState().activateLayer(snap.layerId); } catch {}
      }
      const start = new paper.Point(snap.bounds.x, snap.bounds.y);
      const end = new paper.Point(snap.bounds.x + snap.bounds.width, snap.bounds.y + snap.bounds.height);
      const placeholder = create3DModelPlaceholder(start, end);
      if (placeholder) {
        currentModel3DPlaceholderRef.current = placeholder;
        handleModel3DUploaded({
          url: snapUrl,
          path: snap.path ?? snapUrl,
          key: snap.key,
          format: snap.format,
          fileName: snap.fileName,
          fileSize: snap.fileSize,
          defaultScale: snap.defaultScale,
          defaultRotation: snap.defaultRotation,
          timestamp: snap.timestamp,
        }, snap.id, { skipAutoSave: true });
      }
    });

    setModel3DInstances(prev => prev.map((model) => {
      const snap = snapshots.find((s) => s.id === model.id);
      if (!snap) return model;
      const snapUrl = snap.url || snap.path || model.modelData.url;
      const snapPath = snap.path || snapUrl;
      const updatedModelData = {
        ...model.modelData,
        url: snapUrl,
        path: snapPath,
        key: snap.key ?? model.modelData.key,
        format: snap.format,
        fileName: snap.fileName ?? model.modelData.fileName,
        fileSize: snap.fileSize ?? model.modelData.fileSize,
        defaultScale: snap.defaultScale ?? model.modelData.defaultScale,
        defaultRotation: snap.defaultRotation ?? model.modelData.defaultRotation,
        timestamp: snap.timestamp ?? model.modelData.timestamp,
      };

      const updatedBounds = {
        x: snap.bounds.x,
        y: snap.bounds.y,
        width: snap.bounds.width,
        height: snap.bounds.height,
      };

      try {
        const group = paper.project.layers.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === '3d-model' && child.data?.modelId === model.id
          )
        )[0];
        if (group) {
          if (!group.data) group.data = {};
          group.data.modelData = { ...updatedModelData };
          group.data.url = updatedModelData.url;
          group.data.path = updatedModelData.path;
          group.data.key = updatedModelData.key;
          group.data.format = updatedModelData.format;
          group.data.fileName = updatedModelData.fileName;
          group.data.fileSize = updatedModelData.fileSize;
          group.data.defaultScale = updatedModelData.defaultScale;
          group.data.defaultRotation = updatedModelData.defaultRotation;
          group.data.timestamp = updatedModelData.timestamp;
          group.data.bounds = { ...updatedBounds };
          group.data.layerId = snap.layerId ?? group.data.layerId ?? null;
        }
      } catch (error) {
        console.warn('刷新3D模型元数据失败:', error);
      }

      return {
        ...model,
        modelData: updatedModelData,
        bounds: updatedBounds,
        layerId: snap.layerId ?? model.layerId,
      };
    }));
  }, [create3DModelPlaceholder, handleModel3DUploaded]);

  // ========== 同步3D模型可见性 ==========
  const syncModel3DVisibility = useCallback(() => {
    setModel3DInstances(prev => prev.map(model => {
      const paperGroup = paper.project.layers.flatMap(layer =>
        layer.children.filter(child =>
          child.data?.type === '3d-model' && child.data?.modelId === model.id
        )
      );

      const isVisible = paperGroup.some(group => group.visible);
      return {
        ...model,
        visible: isVisible
      };
    }));
  }, []);

  const createModel3DFromSnapshot = useCallback((
    snapshot: ModelAssetSnapshot,
    options?: {
      offset?: { x: number; y: number };
      idOverride?: string;
    }
  ) => {
    if (!snapshot) return null;

    const offsetX = options?.offset?.x ?? 0;
    const offsetY = options?.offset?.y ?? 0;
    const modelId = options?.idOverride || `model3d_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (snapshot.layerId) {
      try { useLayerStore.getState().activateLayer(snapshot.layerId); } catch {}
    }

    const start = new paper.Point(snapshot.bounds.x + offsetX, snapshot.bounds.y + offsetY);
    const end = new paper.Point(
      snapshot.bounds.x + snapshot.bounds.width + offsetX,
      snapshot.bounds.y + snapshot.bounds.height + offsetY
    );

    const placeholder = create3DModelPlaceholder(start, end);
    if (!placeholder) return null;

    currentModel3DPlaceholderRef.current = placeholder;

    const fallbackUrl = snapshot.url || snapshot.path || '';
    const modelData: Model3DData = {
      url: fallbackUrl,
      key: snapshot.key,
      format: snapshot.format,
      fileName: snapshot.fileName,
      fileSize: snapshot.fileSize,
      defaultScale: snapshot.defaultScale,
      defaultRotation: snapshot.defaultRotation,
      timestamp: snapshot.timestamp,
      path: snapshot.path ?? fallbackUrl,
    };

    handleModel3DUploaded(modelData, modelId);
    return modelId;
  }, [create3DModelPlaceholder, handleModel3DUploaded]);

  return {
    // 状态
    model3DInstances,
    selectedModel3DIds,  // 多选状态
    selectedModel3DId: selectedModel3DIds[0] || null,  // 向下兼容单选
    triggerModel3DUpload,

    // 占位框相关
    create3DModelPlaceholder,
    currentModel3DPlaceholderRef,

    // 3D模型上传处理
    handleModel3DUploaded,
    handleModel3DUploadError,
    handleModel3DUploadTriggerHandled,

    // 3D模型选择
    handleModel3DSelect,
    handleModel3DMultiSelect,  // 批量选择
    handleModel3DDeselect,

    // 3D模型移动和调整大小
    handleModel3DMove,
    handleModel3DResize,
    handleModel3DDelete,

    // 可见性同步
    syncModel3DVisibility,

    // 状态设置器（用于外部直接控制）
    setModel3DInstances,
    setSelectedModel3DIds,  // 设置多选状态
    setTriggerModel3DUpload,
    hydrateFromSnapshot,
    createModel3DFromSnapshot,
  };
};
