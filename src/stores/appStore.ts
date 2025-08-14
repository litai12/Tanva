/**
 * 应用级复合状态管理
 * 提供性能优化的选择器和跨store的状态同步
 */

import { useCanvasStore } from './canvasStore';
import { useUIStore } from './uiStore';
import { useMemo } from 'react';

// 复合选择器：网格相关状态
export const useGridState = () => {
  const { gridSize } = useCanvasStore();
  const { showGrid, showAxis } = useUIStore();
  
  return useMemo(() => ({
    gridSize,
    showGrid,
    showAxis,
  }), [gridSize, showGrid, showAxis]);
};

// 复合选择器：比例尺相关状态
export const useScaleBarState = () => {
  const { scaleRatio, showScaleBar, zoom, units } = useCanvasStore();
  
  return useMemo(() => ({
    scaleRatio,
    showScaleBar,
    zoom,
    units,
  }), [scaleRatio, showScaleBar, zoom, units]);
};

// 复合选择器：视口相关状态
export const useViewportState = () => {
  const { zoom, panX, panY } = useCanvasStore();
  
  return useMemo(() => ({
    zoom,
    panX,
    panY,
  }), [zoom, panX, panY]);
};

// 复合选择器：UI面板状态
export const useUIState = () => {
  const { showLibraryPanel, showBounds } = useUIStore();
  const { showGrid, showAxis } = useUIStore();
  
  return useMemo(() => ({
    showLibraryPanel,
    showBounds,
    showGrid,
    showAxis,
  }), [showLibraryPanel, showBounds, showGrid, showAxis]);
};

// 类型安全的状态更新 hooks
export const useCanvasActions = () => {
  const canvasStore = useCanvasStore();
  const uiStore = useUIStore();
  
  return useMemo(() => ({
    // Canvas 操作
    setGridSize: canvasStore.setGridSize,
    setZoom: canvasStore.setZoom,
    setPan: canvasStore.setPan,
    panBy: canvasStore.panBy,
    resetView: canvasStore.resetView,
    setUnits: canvasStore.setUnits,
    setScaleRatio: canvasStore.setScaleRatio,
    toggleScaleBar: canvasStore.toggleScaleBar,
    
    // UI 操作
    toggleGrid: uiStore.toggleGrid,
    toggleAxis: uiStore.toggleAxis,
    toggleLibraryPanel: uiStore.toggleLibraryPanel,
    toggleBounds: uiStore.toggleBounds,
  }), [canvasStore, uiStore]);
};

// 开发工具：状态调试
export const useStateDebug = () => {
  const canvasState = useCanvasStore();
  const uiState = useUIStore();
  
  return useMemo(() => ({
    canvas: canvasState,
    ui: uiState,
    timestamp: Date.now(),
  }), [canvasState, uiState]);
};