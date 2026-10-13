/**
 * 文本工具Hook
 * 处理文本创建、编辑、选择、移动等功能
 */

import { isShortcutSuppressed, useShortcutStore } from '@/stores/shortcutStore';
import { useCallback, useRef, useEffect } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';
import { useTextStore, useTextActions, useCurrentTextStyle } from '@/stores/textStore';
import type { 
  TextInstance, 
  TextToolEventHandlers,
  CreateTextParams,
  TextDragState,
  TextResizeState
} from '@/types/text';
import type { DrawingContext } from '@/types/canvas';

interface UseTextToolProps {
  context: DrawingContext;
  eventHandlers?: TextToolEventHandlers;
}

export const useTextTool = ({ 
  context, 
  eventHandlers = {} 
}: UseTextToolProps) => {
  const { ensureDrawingLayer } = context;
  
  // Store hooks
  const textInstances = useTextStore(state => Array.from(state.textInstances.values()));
  const selectedTextIds = useTextStore(state => state.selectedTextIds);
  const toolState = useTextStore(state => state.toolState);
  const currentStyle = useCurrentTextStyle();
  const textActions = useTextActions();
  
  // 拖拽和调整大小状态
  const dragStateRef = useRef<TextDragState>({
    isTextDragging: false,
    dragTextId: null,
    textDragStartPoint: null,
    textDragStartBounds: null
  });
  
  const resizeStateRef = useRef<TextResizeState>({
    isTextResizing: false,
    resizeTextId: null,
    resizeDirection: null,
    resizeStartBounds: null,
    resizeStartPoint: null
  });

  // 创建Paper.js文本对象
  const createPaperText = useCallback((textInstance: TextInstance): paper.PointText => {
    const drawingLayer = ensureDrawingLayer();
    
    const paperText = new paper.PointText({
      point: [textInstance.position.x, textInstance.position.y],
      content: textInstance.content,
      fillColor: textInstance.style.fontColor,
      fontSize: textInstance.style.fontSize,
      fontFamily: textInstance.style.fontFamily,
      fontWeight: textInstance.style.fontWeight === 'bold' ? 'bold' : 'normal',
      visible: textInstance.visible
    });

    // 设置文本样式
    if (textInstance.style.fontStyle === 'italic') {
      (paperText as any).fontStyle = 'italic';
    }
    
    // 设置透明度
    if (textInstance.style.opacity < 1) {
      paperText.opacity = textInstance.style.opacity;
    }

    // 添加文本标识
    paperText.data = {
      type: 'text',
      textId: textInstance.id,
      isText: true
    };

    // 设置图层
    drawingLayer.addChild(paperText);

    logger.debug(`📝 创建Paper.js文本对象: ${textInstance.id}`);
    return paperText;
  }, [ensureDrawingLayer]);

  // 更新Paper.js文本对象
  const updatePaperText = useCallback((textInstance: TextInstance) => {
    if (!textInstance.paperItem) return;

    const paperText = textInstance.paperItem as paper.PointText;
    
    // 更新内容
    if (paperText.content !== textInstance.content) {
      paperText.content = textInstance.content;
    }

    // 更新位置
    paperText.point = new paper.Point(textInstance.position.x, textInstance.position.y);

    // 更新样式
    paperText.fillColor = new paper.Color(textInstance.style.fontColor);
    paperText.fontSize = textInstance.style.fontSize;
    paperText.fontFamily = textInstance.style.fontFamily;
    paperText.fontWeight = textInstance.style.fontWeight === 'bold' ? 'bold' : 'normal';
    (paperText as any).fontStyle = textInstance.style.fontStyle === 'italic' ? 'italic' : 'normal';
    paperText.opacity = textInstance.style.opacity;
    paperText.visible = textInstance.visible;

    // 只更新边界信息，不触发状态更新
    const bounds = paperText.bounds;
    if (textInstance.bounds.width !== bounds.width || textInstance.bounds.height !== bounds.height) {
      // 只有在尺寸真正变化时才更新
      textActions.updateText(textInstance.id, {
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        }
      });
    }
  }, [textActions]);

  // 创建选择框
  const createSelectionRect = useCallback((textInstance: TextInstance): paper.Path | undefined => {
    if (!textInstance.paperItem) return undefined;

    const bounds = textInstance.paperItem.bounds;
    const padding = 4;
    
    const selectionRect = new paper.Path.Rectangle({
      rectangle: bounds.expand(padding),
      strokeColor: '#007AFF',
      strokeWidth: 1,
      strokeDashArray: [4, 4],
      fillColor: 'transparent'
    });

    selectionRect.data = {
      type: 'text-selection',
      textId: textInstance.id,
      isSelection: true
    };

    return selectionRect;
  }, []);

  // 更新选择框
  const updateSelectionRect = useCallback((textInstance: TextInstance) => {
    if (!textInstance.selectionRect || !textInstance.paperItem) return;

    const bounds = textInstance.paperItem.bounds;
    const padding = 4;
    
    // 更新选择框路径
    const newRect = new paper.Rectangle(bounds.expand(padding));
    textInstance.selectionRect.segments = [];
    textInstance.selectionRect.add(newRect.topLeft);
    textInstance.selectionRect.add(newRect.topRight);
    textInstance.selectionRect.add(newRect.bottomRight);
    textInstance.selectionRect.add(newRect.bottomLeft);
    textInstance.selectionRect.closed = true;
  }, []);

  // 创建文本
  const createText = useCallback((params: CreateTextParams): TextInstance => {
    const textInstance = textActions.createText(params);
    
    // 创建Paper.js对象
    const paperText = createPaperText(textInstance);
    textInstance.paperItem = paperText;

    // 触发事件
    eventHandlers.onTextCreate?.(textInstance);

    logger.debug(`✨ 创建文本: ${textInstance.id}`, { content: params.content });
    return textInstance;
  }, [textActions, createPaperText, eventHandlers]);

  // 点击处理 - 创建新文本或选择现有文本
  const handleCanvasClick = useCallback((point: paper.Point, event: PointerEvent) => {
    const hitResult = paper.project.hitTest(point, {
      fill: true,
      stroke: true,
      tolerance: 5
    });

    if (hitResult?.item?.data?.isText) {
      // 点击了现有文本
      const textId = hitResult.item.data.textId;
      const isMultiSelect = event.ctrlKey || event.metaKey;
      
      textActions.selectText(textId, isMultiSelect);
      eventHandlers.onTextSelect?.(textId);
      
      // 双击进入编辑模式
      if (event.detail === 2) {
        textActions.startEditText(textId);
        eventHandlers.onEditStart?.(textId);
      }
    } else {
      // 点击了空白区域，创建新文本
      if (!event.ctrlKey && !event.metaKey) {
        textActions.deselectText();
        eventHandlers.onTextDeselect?.();
      }

      // 创建新文本
      const newText = createText({
        content: '新文本',
        position: { x: point.x, y: point.y },
        style: currentStyle
      });

      // 立即进入编辑模式
      textActions.selectText(newText.id);
      textActions.startEditText(newText.id);
      eventHandlers.onEditStart?.(newText.id);
    }
  }, [textActions, createText, currentStyle, eventHandlers]);

  // 拖拽开始
  const handleDragStart = useCallback((point: paper.Point, event: PointerEvent) => {
    const hitResult = paper.project.hitTest(point, {
      fill: true,
      stroke: true,
      tolerance: 5
    });

    if (hitResult?.item?.data?.isText) {
      const textId = hitResult.item.data.textId;
      const textInstance = useTextStore.getState().getTextById(textId);
      
      if (textInstance) {
        dragStateRef.current = {
          isTextDragging: true,
          dragTextId: textId,
          textDragStartPoint: point,
          textDragStartBounds: { ...textInstance.position }
        };

        // 如果不是多选模式且该文本未被选中，则选中它
        if (!event.ctrlKey && !event.metaKey && !useTextStore.getState().isTextSelected(textId)) {
          textActions.selectText(textId);
        }

        logger.debug(`🤏 开始拖拽文本: ${textId}`);
        return true;
      }
    }
    
    return false;
  }, [textActions]);

  // 拖拽中
  const handleDragMove = useCallback((point: paper.Point) => {
    const dragState = dragStateRef.current;
    
    if (!dragState.isTextDragging || !dragState.dragTextId || !dragState.textDragStartPoint) {
      return false;
    }

    const deltaX = point.x - dragState.textDragStartPoint.x;
    const deltaY = point.y - dragState.textDragStartPoint.y;

    // 移动选中的所有文本
    const selectedTexts = useTextStore.getState().getSelectedTexts();
    selectedTexts.forEach(text => {
      const newPosition = {
        x: text.position.x + deltaX,
        y: text.position.y + deltaY
      };
      
      if (text.paperItem) {
        text.paperItem.position = new paper.Point(newPosition.x, newPosition.y);
      }
    });

    return true;
  }, []);

  // 拖拽结束
  const handleDragEnd = useCallback((point: paper.Point) => {
    const dragState = dragStateRef.current;
    
    if (!dragState.isTextDragging || !dragState.dragTextId || !dragState.textDragStartPoint) {
      return false;
    }

    const deltaX = point.x - dragState.textDragStartPoint.x;
    const deltaY = point.y - dragState.textDragStartPoint.y;

    // 更新文本位置状态
    const selectedTexts = useTextStore.getState().getSelectedTexts();
    selectedTexts.forEach(text => {
      const newPosition = {
        x: text.position.x + deltaX,
        y: text.position.y + deltaY
      };
      
      textActions.moveText(text.id, newPosition);
      eventHandlers.onTextMove?.(text.id, newPosition);
    });

    // 重置拖拽状态
    dragStateRef.current = {
      isTextDragging: false,
      dragTextId: null,
      textDragStartPoint: null,
      textDragStartBounds: null
    };

    logger.debug(`✅ 完成拖拽文本`);
    return true;
  }, [textActions, eventHandlers]);

  // 删除选中的文本
  const deleteSelectedTexts = useCallback(() => {
    const selectedTexts = useTextStore.getState().getSelectedTexts();
    
    selectedTexts.forEach(text => {
      // 移除Paper.js对象
      if (text.paperItem) {
        text.paperItem.remove();
      }
      
      if (text.selectionRect) {
        text.selectionRect.remove();
      }
      
      // 从状态中删除
      textActions.deleteText(text.id);
      eventHandlers.onTextDelete?.(text.id);
    });

    logger.debug(`🗑️ 删除了 ${selectedTexts.length} 个文本`);
  }, [textActions, eventHandlers]);

  // 键盘事件处理
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (isShortcutSuppressed(event)) return false;
    const matchesShortcut = useShortcutStore.getState().matchesShortcut;
    // 删除键
    if (matchesShortcut('delete', event) && !toolState.isEditing) {
      event.preventDefault();
      deleteSelectedTexts();
      return true;
    }

    // Escape键退出编辑
    if (event.key === 'Escape' && toolState.isEditing) {
      event.preventDefault();
      textActions.stopEditText();
      return true;
    }

    // Enter键完成编辑
    if (event.key === 'Enter' && toolState.isEditing && !event.shiftKey) {
      event.preventDefault();
      textActions.stopEditText();
      return true;
    }

    // Ctrl+A 全选文本
    if (matchesShortcut('selectAll', event) && !toolState.isEditing) {
      event.preventDefault();
      const allTexts = useTextStore.getState().getAllTexts();
      allTexts.forEach(text => {
        textActions.selectText(text.id, true);
      });
      return true;
    }

    return false;
  }, [toolState.isEditing, textActions, deleteSelectedTexts]);

  // 同步Paper.js对象和状态
  useEffect(() => {
    textInstances.forEach(textInstance => {
      // 创建或更新Paper.js对象
      if (!textInstance.paperItem) {
        textInstance.paperItem = createPaperText(textInstance);
      } else {
        updatePaperText(textInstance);
      }

      // 处理选择状态
      if (textInstance.isSelected) {
        if (!textInstance.selectionRect) {
          textInstance.selectionRect = createSelectionRect(textInstance);
        } else {
          updateSelectionRect(textInstance);
        }
      } else {
        if (textInstance.selectionRect) {
          textInstance.selectionRect.remove();
          textInstance.selectionRect = undefined;
        }
      }
    });
  }, [textInstances]); // 只依赖textInstances

  // 清理函数
  useEffect(() => {
    return () => {
      // 组件卸载时清理所有Paper.js对象
      textInstances.forEach(textInstance => {
        if (textInstance.paperItem) {
          textInstance.paperItem.remove();
        }
        if (textInstance.selectionRect) {
          textInstance.selectionRect.remove();
        }
      });
    };
  }, []);

  return {
    // 状态
    textInstances,
    selectedTextIds,
    toolState,
    currentStyle,
    
    // 操作方法
    createText,
    handleCanvasClick,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleKeyDown,
    deleteSelectedTexts,
    
    // 拖拽状态
    isDragging: dragStateRef.current.isTextDragging,
    isResizing: resizeStateRef.current.isTextResizing,
    
    // 工具方法
    updatePaperText,
    createSelectionRect,
    updateSelectionRect
  };
};
