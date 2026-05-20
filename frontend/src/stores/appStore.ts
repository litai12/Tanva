/**
 * 应用级复合状态管理
 * 每个 hook 使用细粒度选择器，只在真正用到的字段变化时才触发重渲染。
 * 整个 canvasStore / uiStore 订阅会因 zoom/pan 等高频字段导致无关组件重渲染。
 */

import { useCanvasStore } from './canvasStore';
import { useUIStore } from './uiStore';

// 复合选择器：网格相关状态
export const useGridState = () => {
  const gridSize = useCanvasStore((s) => s.gridSize);
  const showGrid = useUIStore((s) => s.showGrid);
  const showAxis = useUIStore((s) => s.showAxis);
  return { gridSize, showGrid, showAxis };
};

// 复合选择器：比例尺相关状态
export const useScaleBarState = () => {
  const scaleRatio = useCanvasStore((s) => s.scaleRatio);
  const showScaleBar = useCanvasStore((s) => s.showScaleBar);
  const zoom = useCanvasStore((s) => s.zoom);
  const units = useCanvasStore((s) => s.units);
  return { scaleRatio, showScaleBar, zoom, units };
};

// 复合选择器：视口相关状态
export const useViewportState = () => {
  const zoom = useCanvasStore((s) => s.zoom);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  return { zoom, panX, panY };
};

// 复合选择器：UI面板状态
export const useUIState = () => {
  const showLibraryPanel = useUIStore((s) => s.showLibraryPanel);
  const showBounds = useUIStore((s) => s.showBounds);
  const showGrid = useUIStore((s) => s.showGrid);
  const showAxis = useUIStore((s) => s.showAxis);
  return { showLibraryPanel, showBounds, showGrid, showAxis };
};

// 类型安全的操作 hooks
// Zustand action 函数引用永远稳定，直接从 getState() 取即可，无需订阅 store
export const useCanvasActions = () => ({
  setGridSize: useCanvasStore((s) => s.setGridSize),
  setZoom: useCanvasStore((s) => s.setZoom),
  setPan: useCanvasStore((s) => s.setPan),
  setViewport: useCanvasStore((s) => s.setViewport),
  panBy: useCanvasStore((s) => s.panBy),
  resetView: useCanvasStore((s) => s.resetView),
  setUnits: useCanvasStore((s) => s.setUnits),
  setScaleRatio: useCanvasStore((s) => s.setScaleRatio),
  toggleScaleBar: useCanvasStore((s) => s.toggleScaleBar),
  toggleGrid: useUIStore((s) => s.toggleGrid),
  toggleAxis: useUIStore((s) => s.toggleAxis),
  toggleLibraryPanel: useUIStore((s) => s.toggleLibraryPanel),
  toggleBounds: useUIStore((s) => s.toggleBounds),
});

// 开发工具：状态调试（仅 dev 使用，全量订阅可接受）
export const useStateDebug = () => {
  const canvasState = useCanvasStore();
  const uiState = useUIStore();
  return { canvas: canvasState, ui: uiState, timestamp: Date.now() };
};
