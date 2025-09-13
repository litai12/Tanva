/**
 * 简单文本编辑器组件
 * 在画布上提供直接的文本编辑功能
 */

import React, { useEffect, useRef, useCallback } from 'react';
import paper from 'paper';

interface SimpleTextEditorProps {
  textItems: Array<{
    id: string;
    paperText: paper.PointText;
    isSelected: boolean;
    isEditing: boolean;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const currentEditingText = textItems.find(item => item.id === editingTextId);

  // 计算输入框位置
  const getInputPosition = useCallback(() => {
    if (!currentEditingText || !paper.view || !paper.view.element) {
      return { left: 0, top: 0, width: 100 };
    }

    try {
      const paperText = currentEditingText.paperText;
      const bounds = paperText.bounds;
      const canvasRect = paper.view.element.getBoundingClientRect();
      
      // 将Paper.js坐标转换为屏幕坐标
      const viewPoint = paper.view.projectToView(bounds.topLeft);
      
      return {
        left: canvasRect.left + viewPoint.x,
        top: canvasRect.top + viewPoint.y,
        width: Math.max(bounds.width, 100)
      };
    } catch (error) {
      console.warn('计算文本编辑位置失败:', error);
      return { left: 100, top: 100, width: 100 };
    }
  }, [currentEditingText]);

  // 处理输入变化
  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (editingTextId) {
      onUpdateContent(editingTextId, event.target.value);
    }
  }, [editingTextId, onUpdateContent]);

  // 处理键盘事件
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      onStopEdit();
    }
  }, [onStopEdit]);

  // 处理失去焦点
  const handleBlur = useCallback(() => {
    onStopEdit();
  }, [onStopEdit]);

  // 聚焦输入框
  useEffect(() => {
    if (editingTextId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTextId]);

  if (!editingTextId || !currentEditingText) {
    return null;
  }

  const position = getInputPosition();

  return (
    <input
      ref={inputRef}
      type="text"
      value={currentEditingText.paperText.content}
      onChange={handleInputChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: position.width,
        minWidth: 100,
        padding: '2px 4px',
        border: '2px solid #007AFF',
        borderRadius: '2px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        fontSize: '20px',
        fontFamily: 'Arial',
        color: currentEditingText.paperText.fillColor?.toCSS?.() || '#000000',
        outline: 'none',
        zIndex: 1000,
        pointerEvents: 'auto'
      }}
    />
  );
};

export default SimpleTextEditor;