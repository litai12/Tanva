/**
 * 简单文本编辑器组件
 * 在画布上提供直接的文本编辑功能
 */

import React, { useEffect, useRef, useCallback } from 'react';
import paper from 'paper';
import { projectToClient } from '@/utils/paperCoords';
import { useToolStore } from '@/stores/toolStore';

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
  const { setDrawMode, isEraser } = useToolStore(state => ({ 
    setDrawMode: state.setDrawMode, 
    isEraser: state.isEraser 
  }));

  // 计算输入框位置
  const getInputPosition = useCallback(() => {
    if (!currentEditingText || !paper.view || !paper.view.element) {
      return { left: 0, top: 0, width: 100 };
    }

    try {
      const paperText = currentEditingText.paperText;
      const bounds = paperText.bounds;
      const canvasEl = paper.view.element as HTMLCanvasElement;
      const tl = projectToClient(canvasEl, bounds.topLeft);
      return {
        left: tl.x,
        top: tl.y,
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
      // 回车或Esc后切换到选择工具（橡皮擦模式下不切换）
      if (!isEraser) {
        setDrawMode('select');
      }
    }
  }, [onStopEdit, setDrawMode]);

  // 处理失去焦点
  const handleBlur = useCallback((event: React.FocusEvent) => {
    // 延迟处理失焦，给双击事件一些时间处理
    setTimeout(() => {
      // 只有当输入框真的失去焦点时才停止编辑
      // 检查当前活动元素是否仍然是这个输入框
      if (inputRef.current && document.activeElement !== inputRef.current) {
        onStopEdit();
        // 失去焦点后也切换到选择工具（橡皮擦模式下不切换）
        if (!isEraser) {
          setDrawMode('select');
        }
      }
    }, 100);
  }, [onStopEdit, setDrawMode]);

  // 聚焦输入框
  useEffect(() => {
    if (editingTextId && inputRef.current) {
      // 确保输入框获得焦点并选择全部内容
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 10);
    }
  }, [editingTextId]);

  // 添加点击处理，防止点击输入框时失去编辑状态
  const handleInputClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 确保输入框保持焦点
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

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
      onClick={handleInputClick}
      onDoubleClick={(e) => {
        // 双击选择全部文字内容并确保保持编辑状态
        e.stopPropagation();
        const target = e.target as HTMLInputElement;
        
        // 确保输入框获得焦点
        target.focus();
        
        // 选择所有文本
        target.select();
        
        console.log('📝 输入框双击，选择全部文字并保持编辑状态');
      }}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: position.width,
        minWidth: 100,
        padding: '2px 4px',
        border: '1px solid #007AFF',
        borderRadius: '2px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        // 编辑时的输入字号固定为 24px，便于输入
        fontSize: '24px',
        fontFamily: 'Arial',
        color: currentEditingText.paperText.fillColor?.toCSS?.(true) || '#000000',
        outline: 'none',
        zIndex: 1000,
        pointerEvents: 'auto'
      }}
    />
  );
};

export default SimpleTextEditor;
