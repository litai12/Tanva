/**
 * 简单文本工具Hook
 * 提供基础的文本创建和编辑功能
 */

import { useCallback, useRef, useState } from 'react';
import paper from 'paper';
import { logger } from '@/utils/logger';

interface TextStyle {
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  italic: boolean;
}

interface TextItem {
  id: string;
  paperText: paper.PointText;
  isSelected: boolean;
  isEditing: boolean;
  style: TextStyle;
}

interface UseSimpleTextToolProps {
  currentColor: string;
  ensureDrawingLayer: () => paper.Layer;
}

export const useSimpleTextTool = ({ currentColor, ensureDrawingLayer }: UseSimpleTextToolProps) => {
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const textIdCounter = useRef(0);
  
  // 双击检测
  const lastClickTimeRef = useRef(0);
  const lastClickTargetRef = useRef<string | null>(null);

  // 默认文本样式
  const [defaultStyle, setDefaultStyle] = useState<TextStyle>({
    fontFamily: 'Inter',
    fontWeight: 'normal',
    fontSize: 24,
    color: currentColor,
    align: 'left',
    italic: false
  });

  // 获取当前选中文本的样式
  const getSelectedTextStyle = useCallback((): TextStyle => {
    const selectedText = textItems.find(item => item.id === selectedTextId);
    return selectedText ? selectedText.style : defaultStyle;
  }, [textItems, selectedTextId, defaultStyle]);

  // 创建新文本
  const createText = useCallback((point: paper.Point, content: string = '文本', style?: Partial<TextStyle>) => {
    const drawingLayer = ensureDrawingLayer();
    const id = `text_${++textIdCounter.current}`;
    
    const textStyle = { ...defaultStyle, ...style };
    
    const paperText = new paper.PointText({
      point: [point.x, point.y],
      content: content,
      fillColor: textStyle.color,
      fontSize: textStyle.fontSize,
      fontFamily: textStyle.fontFamily,
      fontWeight: textStyle.fontWeight === 'bold' ? 'bold' : 'normal',
      fontStyle: textStyle.italic ? 'italic' : 'normal',
      justification: textStyle.align,
      visible: true
    });

    // 确保文本可以被点击检测到
    paperText.strokeColor = null; // 确保没有描边干扰
    paperText.selected = false; // 确保没有选中状态干扰

    // 添加数据标识
    paperText.data = {
      type: 'text',
      textId: id
    };

    // 将文本添加到图层中（正确的方法）
    drawingLayer.addChild(paperText);

    const textItem: TextItem = {
      id,
      paperText,
      isSelected: false, // 默认不选中，让用户主动选择
      isEditing: true,
      style: textStyle
    };

    setTextItems(prev => [...prev, textItem]);
    setSelectedTextId(id);
    setEditingTextId(id);

    logger.debug(`📝 创建简单文本: ${id}`, { content, position: point });
    return textItem;
  }, [currentColor, ensureDrawingLayer]);

  // 选择文本
  const selectText = useCallback((textId: string) => {
    setSelectedTextId(textId);
    setTextItems(prev => prev.map(item => ({
      ...item,
      isSelected: item.id === textId
    })));
  }, []);

  // 取消选择
  const deselectText = useCallback(() => {
    setSelectedTextId(null);
    setTextItems(prev => prev.map(item => ({
      ...item,
      isSelected: false
    })));
  }, []);

  // 开始编辑文本
  const startEditText = useCallback((textId: string) => {
    setEditingTextId(textId);
    setTextItems(prev => prev.map(item => ({
      ...item,
      isEditing: item.id === textId
    })));
  }, []);

  // 停止编辑文本
  const stopEditText = useCallback(() => {
    setEditingTextId(null);
    setTextItems(prev => prev.map(item => ({
      ...item,
      isEditing: false
    })));
  }, []);

  // 更新文本内容
  const updateTextContent = useCallback((textId: string, newContent: string) => {
    setTextItems(prev => prev.map(item => {
      if (item.id === textId) {
        item.paperText.content = newContent;
        return { ...item };
      }
      return item;
    }));
  }, []);

  // 删除文本
  const deleteText = useCallback((textId: string) => {
    setTextItems(prev => {
      const item = prev.find(item => item.id === textId);
      if (item) {
        item.paperText.remove();
      }
      return prev.filter(item => item.id !== textId);
    });
    
    if (selectedTextId === textId) {
      setSelectedTextId(null);
    }
    if (editingTextId === textId) {
      setEditingTextId(null);
    }
  }, [selectedTextId, editingTextId]);

  // 更新文本样式
  const updateTextStyle = useCallback((textId: string, updates: Partial<TextStyle>) => {
    setTextItems(prev => prev.map(item => {
      if (item.id === textId) {
        const newStyle = { ...item.style, ...updates };
        
        // 更新Paper.js对象的样式
        if (updates.color !== undefined) {
          item.paperText.fillColor = new paper.Color(updates.color);
        }
        if (updates.fontSize !== undefined) {
          item.paperText.fontSize = updates.fontSize;
        }
        if (updates.fontFamily !== undefined) {
          item.paperText.fontFamily = updates.fontFamily;
        }
        if (updates.fontWeight !== undefined) {
          item.paperText.fontWeight = updates.fontWeight === 'bold' ? 'bold' : 'normal';
        }
        if (updates.italic !== undefined) {
          // Note: Paper.js PointText fontStyle handling may vary by version
          // We store the italic state in our style object for consistency
          (item.paperText as any).fontStyle = updates.italic ? 'italic' : 'normal';
        }
        if (updates.align !== undefined) {
          item.paperText.justification = updates.align;
        }
        
        return { ...item, style: newStyle };
      }
      return item;
    }));
  }, []);

  // 更新默认样式（影响新创建的文本）
  const updateDefaultStyle = useCallback((updates: Partial<TextStyle>) => {
    setDefaultStyle(prev => ({ ...prev, ...updates }));
  }, []);

  // 处理画布点击 (需要从外部传入当前工具模式)
  const handleCanvasClick = useCallback((point: paper.Point, event?: any, currentDrawMode?: string) => {
    const currentTime = Date.now();
    
    // 检查是否点击了现有文本
    // Paper.js的PointText需要特殊的hitTest选项
    const hitResult = paper.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: true,
      curves: true,
      tolerance: 10,
      match: (item: any) => {
        // 直接检查所有可能的文本对象
        console.log('🔍 检查物品:', item, item.data, item.constructor.name);
        return item.data?.type === 'text' || item instanceof paper.PointText;
      }
    });

    console.log('🔍 文本点击检测:', {
      point,
      hitResult,
      hitItem: hitResult?.item,
      hitData: hitResult?.item?.data,
      currentDrawMode
    });

    // 检查hitResult是否找到了文本
    let clickedTextId = null;
    
    if (hitResult?.item?.data?.type === 'text') {
      clickedTextId = hitResult.item.data.textId;
    } else {
      // 如果hitTest没找到，手动检查所有文本的边界框
      for (const textItem of textItems) {
        const bounds = textItem.paperText.bounds;
        if (bounds && bounds.contains(point)) {
          console.log('📍 通过边界框检测到文本:', textItem.id);
          clickedTextId = textItem.id;
          break;
        }
      }
    }

    if (clickedTextId) {
      // 点击了现有文本
      const textId = clickedTextId;
      
      // 自定义双击检测：500ms内点击同一个文本
      const timeDiff = currentTime - lastClickTimeRef.current;
      const isDoubleClick = 
        timeDiff < 500 && 
        lastClickTargetRef.current === textId;
      
      console.log('点击检测:', {
        textId,
        timeDiff,
        lastTarget: lastClickTargetRef.current,
        isDoubleClick
      });
      
      // 更新点击记录
      lastClickTimeRef.current = currentTime;
      lastClickTargetRef.current = textId;
      
      if (isDoubleClick) {
        // 双击进入编辑模式
        selectText(textId);
        startEditText(textId);
        console.log('🎯 双击编辑文本:', textId);
      } else {
        // 单击选择文本
        selectText(textId);
        // 只有当点击的不是当前正在编辑的文本时，才停止编辑
        if (editingTextId && editingTextId !== textId) {
          stopEditText();
        }
        console.log('👆 单击选择文本:', textId);
      }
    } else {
      // 点击空白区域的行为取决于当前工具模式
      if (currentDrawMode === 'text') {
        // 文本工具模式：创建新文本
        deselectText();
        stopEditText();
        
        // 重置点击记录
        lastClickTimeRef.current = currentTime;
        lastClickTargetRef.current = null;
        
        // 创建新文本并立即进入编辑模式
        createText(point, '文本');
        console.log('✨ 文本工具模式：创建新文本');
      } else {
        // 其他工具模式：只取消选择
        deselectText();
        stopEditText();
        
        // 重置点击记录
        lastClickTimeRef.current = currentTime;
        lastClickTargetRef.current = null;
        
        console.log('📍 点击空白区域，取消文本选择');
      }
    }
  }, [selectText, startEditText, deselectText, stopEditText, createText]);

  // 处理键盘事件
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // 删除键
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedTextId && !editingTextId) {
      event.preventDefault();
      deleteText(selectedTextId);
      return true;
    }

    // Escape键退出编辑
    if (event.key === 'Escape' && editingTextId) {
      event.preventDefault();
      stopEditText();
      return true;
    }

    // Enter键完成编辑
    if (event.key === 'Enter' && editingTextId) {
      event.preventDefault();
      stopEditText();
      return true;
    }

    return false;
  }, [selectedTextId, editingTextId, deleteText, stopEditText]);

  // 主动创建文本的方法
  const createTextAtPoint = useCallback((point?: paper.Point) => {
    // 如果没有指定点，在画布中心创建
    const createPoint = point || new paper.Point(400, 300);
    
    // 先取消所有选择
    deselectText();
    stopEditText();
    
    // 创建新文本并立即进入编辑模式
    createText(createPoint, '文本');
    console.log('✨ 主动创建文本');
  }, [deselectText, stopEditText, createText]);

  // 处理双击事件（备选方案）
  const handleDoubleClick = useCallback((point: paper.Point) => {
    // 检查是否双击了现有文本
    const hitResult = paper.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: true,
      curves: true,
      tolerance: 10,
      match: (item: any) => {
        return item.data?.type === 'text' || item instanceof paper.PointText;
      }
    });

    let clickedTextId = null;
    
    if (hitResult?.item?.data?.type === 'text') {
      clickedTextId = hitResult.item.data.textId;
    } else {
      // 如果hitTest没找到，手动检查所有文本的边界框
      for (const textItem of textItems) {
        const bounds = textItem.paperText.bounds;
        if (bounds && bounds.contains(point)) {
          console.log('📍 通过边界框检测到文本:', textItem.id);
          clickedTextId = textItem.id;
          break;
        }
      }
    }

    if (clickedTextId) {
      console.log('🎯 原生双击编辑文本:', clickedTextId);
      
      // 如果文本已经在编辑状态，重新聚焦输入框
      if (editingTextId === clickedTextId) {
        console.log('🔄 文本已在编辑状态，触发重新聚焦');
        // 触发输入框重新聚焦和选择全部文本的事件
        setTimeout(() => {
          const inputElement = document.querySelector(`input[type="text"]`) as HTMLInputElement;
          if (inputElement) {
            inputElement.focus();
            inputElement.select();
          }
        }, 50);
      } else {
        // 文本不在编辑状态，开始编辑
        selectText(clickedTextId);
        startEditText(clickedTextId);
      }
    }
  }, [selectText, startEditText, editingTextId, textItems]);

  return {
    // 状态
    textItems,
    selectedTextId,
    editingTextId,
    defaultStyle,
    
    // 操作方法
    createText,
    createTextAtPoint,
    selectText,
    deselectText,
    startEditText,
    stopEditText,
    updateTextContent,
    updateTextStyle,
    updateDefaultStyle,
    deleteText,
    handleCanvasClick,
    handleDoubleClick,
    handleKeyDown,
    getSelectedTextStyle
  };
};