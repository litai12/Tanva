/**
 * 文本选择框覆盖层组件
 * 显示选中文本的边框和操作手柄
 */

import React, { useCallback, useMemo } from 'react';
import paper from 'paper';

interface TextSelectionOverlayProps {
  textItems: Array<{
    id: string;
    paperText: paper.PointText;
    isSelected: boolean;
    isEditing: boolean;
  }>;
  selectedTextId: string | null;
  editingTextId: string | null;
}

const TextSelectionOverlay: React.FC<TextSelectionOverlayProps> = ({
  textItems,
  selectedTextId,
  editingTextId
}) => {
  const selectedText = textItems.find(item => item.id === selectedTextId);

  // 计算选择框位置
  const getSelectionBounds = useCallback(() => {
    if (!selectedText || !selectedText.paperText || !paper.view || !paper.view.element) {
      return null;
    }

    try {
      const bounds = selectedText.paperText.bounds;
      const canvasRect = paper.view.element.getBoundingClientRect();
      
      // 将Paper.js坐标转换为屏幕坐标
      const topLeft = paper.view.projectToView(bounds.topLeft);
      const bottomRight = paper.view.projectToView(bounds.bottomRight);
      
      const padding = 4; // 选择框的内边距
      
      return {
        left: canvasRect.left + topLeft.x - padding,
        top: canvasRect.top + topLeft.y - padding,
        width: bottomRight.x - topLeft.x + padding * 2,
        height: bottomRight.y - topLeft.y + padding * 2
      };
    } catch (error) {
      console.warn('计算文本选择框位置失败:', error);
      return null;
    }
  }, [selectedText]);

  const selectionBounds = useMemo(() => getSelectionBounds(), [getSelectionBounds]);

  // 如果没有选中文本或正在编辑，不显示选择框
  if (!selectedTextId || !selectedText || editingTextId === selectedTextId || !selectionBounds) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: selectionBounds.left,
        top: selectionBounds.top,
        width: selectionBounds.width,
        height: selectionBounds.height,
        border: '1px solid #007AFF',
        backgroundColor: 'transparent',
        pointerEvents: 'none', // 不阻挡鼠标事件
        zIndex: 999,
        boxSizing: 'border-box'
      }}
    >
      {/* 四个角的方块手柄 - 白色填充，蓝色边框 */}
      <div
        style={{
          position: 'absolute',
          top: -3,
          left: -3,
          width: 6,
          height: 6,
          backgroundColor: 'white',
          border: '1px solid #007AFF',
          borderRadius: '1px',
          cursor: 'nw-resize'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: -3,
          right: -3,
          width: 6,
          height: 6,
          backgroundColor: 'white',
          border: '1px solid #007AFF',
          borderRadius: '1px',
          cursor: 'ne-resize'
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -3,
          left: -3,
          width: 6,
          height: 6,
          backgroundColor: 'white',
          border: '1px solid #007AFF',
          borderRadius: '1px',
          cursor: 'sw-resize'
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -3,
          right: -3,
          width: 6,
          height: 6,
          backgroundColor: 'white',
          border: '1px solid #007AFF',
          borderRadius: '1px',
          cursor: 'se-resize'
        }}
      />
    </div>
  );
};

export default TextSelectionOverlay;