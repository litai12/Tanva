import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Unit } from '@/lib/unitUtils';
import { isValidUnit } from '@/lib/unitUtils';

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
  subscribeWithSelector(
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
      
      // 单位系统操作方法（增强类型安全）
      setUnits: (units) => {
        if (!isValidUnit(units)) {
          console.warn(`Invalid unit: ${units}. Falling back to 'm'.`);
          return set({ units: 'm' });
        }
        set({ units });
      },
      setScaleRatio: (ratio) => {
        const validRatio = Math.max(0.001, Math.min(1000, ratio)); // 限制范围 0.001-1000
        set({ scaleRatio: validRatio });
      },
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
  )
);

// 性能优化：导出常用的选择器
export const useCanvasUnits = () => useCanvasStore((state) => state.units);
export const useCanvasZoom = () => useCanvasStore((state) => state.zoom);
export const useCanvasGrid = () => useCanvasStore((state) => ({ 
  gridSize: state.gridSize
}));
export const useCanvasScale = () => useCanvasStore((state) => ({
  scaleRatio: state.scaleRatio,
  showScaleBar: state.showScaleBar,
  zoom: state.zoom,
  units: state.units
}));