/**
 * 选择框覆盖层组件
 * 在React Flow节点之上显示选择框，确保选择框始终可见
 */

import React, { useEffect, useState } from 'react';
import paper from 'paper';

interface SelectionBoxBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const SelectionBoxOverlay: React.FC = () => {
  const [boxBounds, setBoxBounds] = useState<SelectionBoxBounds | null>(null);

  useEffect(() => {
    // 监听选择框更新事件
    const handleSelectionBoxUpdate = (event: CustomEvent) => {
      const { startPoint, currentPoint } = event.detail;

      if (!startPoint || !currentPoint || !paper.view?.element) {
        setBoxBounds(null);
        return;
      }

      // 将Paper.js坐标转换为屏幕坐标
      const canvas = paper.view.element as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      const startView = paper.view.projectToView(startPoint);
      const currentView = paper.view.projectToView(currentPoint);

      const startX = startView.x / dpr + rect.left;
      const startY = startView.y / dpr + rect.top;
      const currentX = currentView.x / dpr + rect.left;
      const currentY = currentView.y / dpr + rect.top;

      // 计算选择框的位置和大小
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      setBoxBounds({ left, top, width, height });
    };

    const handleSelectionBoxClear = () => {
      setBoxBounds(null);
    };

    window.addEventListener('selection-box-update', handleSelectionBoxUpdate as EventListener);
    window.addEventListener('selection-box-clear', handleSelectionBoxClear);

    return () => {
      window.removeEventListener('selection-box-update', handleSelectionBoxUpdate as EventListener);
      window.removeEventListener('selection-box-clear', handleSelectionBoxClear);
    };
  }, []);

  if (!boxBounds) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: boxBounds.left,
        top: boxBounds.top,
        width: boxBounds.width,
        height: boxBounds.height,
        border: '1px dashed #007AFF',
        background: 'rgba(0, 122, 255, 0.1)',
        pointerEvents: 'none',
        zIndex: 10000, // 确保在React Flow节点之上
      }}
    />
  );
};

export default SelectionBoxOverlay;
