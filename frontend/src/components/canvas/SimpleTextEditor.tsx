/**
 * 简单文本编辑器组件
 * 在画布上提供直接的文本编辑功能
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import paper from 'paper';
import { projectToClient } from '@/utils/paperCoords';
import { useToolStore } from '@/stores/toolStore';
import { useCanvasStore } from '@/stores/canvasStore';

interface TextStyle {
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  italic: boolean;
}

interface SimpleTextEditorProps {
  textItems: Array<{
    id: string;
    paperText: paper.PointText;
    isSelected: boolean;
    isEditing: boolean;
    style?: TextStyle;
  }>;
  editingTextId: string | null;
  onUpdateContent: (textId: string, content: string) => void;
  onStopEdit: () => void;
}

const SimpleTextEditor: React.FC<SimpleTextEditorProps> = ({
  textItems,
  editingTextId,
  onUpdateContent,
  onStopEdit
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentEditingText = textItems.find(item => item.id === editingTextId);
  const setDrawMode = useToolStore(state => state.setDrawMode);
  const zoom = useCanvasStore(state => state.zoom);

  // 强制更新位置的状态
  const [, forceUpdate] = useState(0);

  // 获取文本样式（从 Paper.js 对象或 style 属性）
  const getTextStyle = useCallback(() => {
    if (!currentEditingText) {
      return {
        fontSize: 32,
        fontFamily: 'sans-serif',
        fontWeight: 'normal' as const,
        fontStyle: 'normal',
        color: '#000000'
      };
    }

    const paperText = currentEditingText.paperText;
    const style = currentEditingText.style;

    const fontSize = style?.fontSize ?? (typeof paperText.fontSize === 'number' ? paperText.fontSize : 32);
    return {
      fontSize,
      fontFamily: style?.fontFamily ?? paperText.fontFamily ?? 'sans-serif',
      fontWeight: (style?.fontWeight ?? paperText.fontWeight ?? 'normal') as 'normal' | 'bold',
      fontStyle: style?.italic ? 'italic' : ((paperText as any).fontStyle ?? 'normal'),
      color: style?.color ?? paperText.fillColor?.toCSS?.(true) ?? '#000000'
    };
  }, [currentEditingText]);

  // 计算输入框位置和尺寸
  const getInputPosition = useCallback(() => {
    if (!currentEditingText || !paper.view || !paper.view.element) {
      return { left: 0, top: 0, width: 200, height: 50 };
    }

    try {
      const paperText = currentEditingText.paperText;
      const bounds = paperText.bounds;
      const canvasEl = paper.view.element as HTMLCanvasElement;
      const tl = projectToClient(canvasEl, bounds.topLeft);

      // 计算实际显示尺寸（考虑缩放）
      const rawFontSize = getTextStyle().fontSize * zoom;
      // 限制字体大小在合理范围内
      const clampedFontSize = Math.min(Math.max(rawFontSize, 12), 72);
      const minWidth = Math.max(bounds.width * zoom, 150);
      const minHeight = Math.max(bounds.height * zoom, clampedFontSize * 1.5);

      return {
        left: tl.x,
        top: tl.y,
        width: minWidth,
        height: minHeight
      };
    } catch (error) {
      console.warn('计算文本编辑位置失败:', error);
      return { left: 100, top: 100, width: 200, height: 50 };
    }
  }, [currentEditingText, zoom, getTextStyle]);

  // 处理输入变化
  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (editingTextId) {
      onUpdateContent(editingTextId, event.target.value);
    }
  }, [editingTextId, onUpdateContent]);

  // 处理键盘事件
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    // Escape 退出编辑
    if (event.key === 'Escape') {
      event.preventDefault();
      onStopEdit();
      setDrawMode('select');
      return;
    }

    // Enter 不加 Shift 时退出编辑（Shift+Enter 换行）
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onStopEdit();
      setDrawMode('select');
      return;
    }

    // Ctrl+A / Cmd+A 全选当前文本框内容
    if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
      event.stopPropagation(); // 阻止冒泡到画布的全选处理
      // 让浏览器默认全选行为生效
    }
  }, [onStopEdit, setDrawMode]);

  // 处理失去焦点
  const handleBlur = useCallback(() => {
    // 延迟处理失焦，给双击事件一些时间处理
    setTimeout(() => {
      // 只有当输入框真的失去焦点时才停止编辑
      if (textareaRef.current && document.activeElement !== textareaRef.current) {
        onStopEdit();
        setDrawMode('select');
      }
    }, 150);
  }, [onStopEdit, setDrawMode]);

  // 聚焦输入框
  useEffect(() => {
    if (editingTextId && textareaRef.current) {
      // 确保输入框获得焦点并选择全部内容
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.select();
        }
      }, 10);
    }
  }, [editingTextId]);

  // 监听画布缩放/平移变化，更新编辑器位置
  useEffect(() => {
    const handleViewChange = () => {
      forceUpdate(n => n + 1);
    };

    // 监听 paper.view 变化
    if (paper.view) {
      paper.view.on('resize', handleViewChange);
    }

    return () => {
      if (paper.view) {
        paper.view.off('resize', handleViewChange);
      }
    };
  }, []);

  // 添加点击处理，防止点击输入框时失去编辑状态
  const handleInputClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  // 双击全选
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const target = e.target as HTMLTextAreaElement;
    target.focus();
    target.select();
  }, []);

  if (!editingTextId || !currentEditingText) {
    return null;
  }

  const position = getInputPosition();
  const textStyle = getTextStyle();

  // 计算显示字体大小（应用缩放，但设置合理的上下限）
  const rawDisplayFontSize = textStyle.fontSize * zoom;
  // 限制显示字体大小在 12px - 72px 之间，避免过大或过小
  const displayFontSize = Math.min(Math.max(rawDisplayFontSize, 12), 72);

  return (
    <textarea
      ref={textareaRef}
      value={currentEditingText.paperText.content}
      onChange={handleInputChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={handleInputClick}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: position.width,
        minWidth: 150,
        height: position.height,
        minHeight: displayFontSize * 1.5,
        padding: '2px 4px',
        border: '2px solid #3b82f6',
        borderRadius: '4px',
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        // 同步实际文本样式
        fontSize: `${displayFontSize}px`,
        fontFamily: textStyle.fontFamily,
        fontWeight: textStyle.fontWeight,
        fontStyle: textStyle.fontStyle,
        color: textStyle.color,
        lineHeight: 1.2,
        outline: 'none',
        zIndex: 1000,
        pointerEvents: 'auto',
        resize: 'none',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        // 文本对齐
        textAlign: currentEditingText.style?.align ?? 'left'
      }}
    />
  );
};

export default SimpleTextEditor;
