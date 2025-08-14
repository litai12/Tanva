import { create } from 'zustand';

interface CanvasState {
  // 网格系统
  gridSize: number;
  
  // 视口状态
  zoom: number;
  panX: number;
  panY: number;
  
  // 操作方法
  setGridSize: (size: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  panBy: (deltaX: number, deltaY: number) => void;
  resetView: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // 初始状态
  gridSize: 20,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  
  // 设置方法
  setGridSize: (size) => set({ gridSize: size }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(3, zoom)) }), // 限制缩放范围 10%-300%
  setPan: (x, y) => set({ panX: x, panY: y }),
  panBy: (deltaX, deltaY) => {
    const { panX, panY } = get();
    set({ panX: panX + deltaX, panY: panY + deltaY });
  },
  resetView: () => set({ zoom: 1.0, panX: 0, panY: 0 }),
}));