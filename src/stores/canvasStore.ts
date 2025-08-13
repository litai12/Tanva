import { create } from 'zustand';

interface CanvasState {
  // 网格系统
  gridSize: number;
  
  // 操作方法
  setGridSize: (size: number) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  // 初始状态
  gridSize: 20,
  
  // 设置方法
  setGridSize: (size) => set({ gridSize: size }),
}));