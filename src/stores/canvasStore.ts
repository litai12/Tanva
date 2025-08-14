import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Unit } from '@/lib/unitUtils';

interface CanvasState {
  // 网格系统
  gridSize: number;
  
  // 视口状态
  zoom: number;
  panX: number;
  panY: number;
  
  // 单位系统
  units: Unit;                // 当前显示单位
  scaleRatio: number;         // 1像素对应多少米
  showScaleBar: boolean;      // 显示比例尺
  
  // 操作方法
  setGridSize: (size: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  panBy: (deltaX: number, deltaY: number) => void;
  resetView: () => void;
  
  // 单位系统操作方法
  setUnits: (units: Unit) => void;
  setScaleRatio: (ratio: number) => void;
  toggleScaleBar: () => void;
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      // 初始状态
      gridSize: 20,
      zoom: 1.0,
      panX: 0,
      panY: 0,
      
      // 单位系统初始状态
      units: 'm',           // 默认米单位
      scaleRatio: 0.1,      // 默认1像素=0.1米
      showScaleBar: true,   // 默认显示比例尺
      
      // 设置方法
      setGridSize: (size) => set({ gridSize: size }),
      setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(3, zoom)) }), // 限制缩放范围 10%-300%
      setPan: (x, y) => set({ panX: x, panY: y }),
      panBy: (deltaX, deltaY) => {
        const { panX, panY } = get();
        set({ panX: panX + deltaX, panY: panY + deltaY });
      },
      resetView: () => set({ zoom: 1.0, panX: 0, panY: 0 }),
      
      // 单位系统操作方法
      setUnits: (units) => set({ units }),
      setScaleRatio: (ratio) => set({ scaleRatio: Math.max(0.001, ratio) }), // 限制最小比例尺
      toggleScaleBar: () => set((state) => ({ showScaleBar: !state.showScaleBar })),
    }),
    {
      name: 'canvas-settings', // localStorage 键名
      // 只持久化特定的状态，不包括视口状态（zoom, panX, panY）
      partialize: (state) => ({
        gridSize: state.gridSize,
        units: state.units,
        scaleRatio: state.scaleRatio,
        showScaleBar: state.showScaleBar,
      }),
    }
  )
);