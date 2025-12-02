import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Unit } from '@/lib/unitUtils';
import { isValidUnit } from '@/lib/unitUtils';
import { createSafeStorage } from './storageUtils';

// 网格样式枚举
export const GridStyle = {
  LINES: 'lines',    // 线条网格
  DOTS: 'dots',      // 点阵网格
  SOLID: 'solid'     // 纯色背景
} as const;

export type GridStyle = typeof GridStyle[keyof typeof GridStyle];

interface CanvasState {
  // 网格系统
  gridSize: number;
  gridStyle: GridStyle;
  gridDotSize: number;        // 点阵半径（像素，随缩放）
  gridColor: string;          // 网格颜色（十六进制）
  gridBgColor: string;        // 网格背景颜色（SOLID样式下生效）
  gridBgEnabled: boolean;     // 是否启用底色（LINES/DOTS下也可叠加）
  
  // 视口状态
  zoom: number;
  panX: number;
  panY: number;
  isHydrated: boolean;        // 标记持久化状态是否恢复完成
  hasInitialCenterApplied: boolean; // 是否已经执行过首次居中逻辑
  
  // 交互状态
  isDragging: boolean;        // 是否正在拖拽画布
  
  // 单位系统
  units: Unit;                // 当前显示单位
  scaleRatio: number;         // 1像素对应多少米
  showScaleBar: boolean;      // 显示比例尺
  
  // 操作方法
  setGridSize: (size: number) => void;
  setGridStyle: (style: GridStyle) => void;
  setGridDotSize: (size: number) => void;
  setGridColor: (color: string) => void;
  setGridBgColor: (color: string) => void;
  setGridBgEnabled: (enabled: boolean) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  panBy: (deltaX: number, deltaY: number) => void;
  resetView: () => void;
  markInitialCenterApplied: () => void;
  setHydrated: (hydrated: boolean) => void;
  
  // 交互状态操作方法
  setDragging: (dragging: boolean) => void;
  
  // 单位系统操作方法
  setUnits: (units: Unit) => void;
  setScaleRatio: (ratio: number) => void;
  toggleScaleBar: () => void;
}

export const useCanvasStore = create<CanvasState>()(
  subscribeWithSelector(
    persist(
      (set, get, api) => ({
      // 初始状态
      gridSize: 32,
      gridStyle: GridStyle.LINES, // 默认使用线条网格
      gridDotSize: 1,
      gridColor: '#000000',
      gridBgColor: '#f7f7f7',
      gridBgEnabled: false,
      zoom: 1.0,
      panX: 0,
      panY: 0,
      isHydrated: false,
      hasInitialCenterApplied: false,
      
      // 交互状态初始值
      isDragging: false,    // 默认未拖拽
      
      // 单位系统初始状态
      units: 'm',           // 默认米单位
      scaleRatio: 0.1,      // 默认1像素=0.1米
      showScaleBar: true,   // 默认显示比例尺
      
      // 设置方法
      setGridSize: (size) => set({ gridSize: size }),
      setGridStyle: (style) => set({ gridStyle: style }),
      setGridDotSize: (size) => set({ gridDotSize: Math.max(1, Math.min(4, Math.round(size))) }),
      setGridColor: (color) => set({ gridColor: color }),
      setGridBgColor: (color) => set({ gridBgColor: color }),
      setGridBgEnabled: (enabled) => set({ gridBgEnabled: !!enabled }),
      setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(3, zoom)) }), // 限制缩放范围 10%-300%
      setPan: (x, y) => set({ panX: x, panY: y }),
      panBy: (deltaX, deltaY) => {
        const { panX, panY } = get();
        set({ panX: panX + deltaX, panY: panY + deltaY });
      },
      resetView: () => set({ zoom: 1.0, panX: 0, panY: 0 }),
      markInitialCenterApplied: () => set({ hasInitialCenterApplied: true }),
      setHydrated: (hydrated) => set({ isHydrated: hydrated }),
      
      // 交互状态操作方法
      setDragging: (dragging) => set({ isDragging: dragging }),
      
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
        storage: createJSONStorage<Partial<CanvasState>>(() => createSafeStorage({ storageName: 'canvas-settings' })),
        // 内存优化：只持久化用户偏好设置，不持久化频繁变化的视口状态
        // zoom, panX, panY 会频繁变化（缩放、拖拽时），不应该每次都写入 localStorage
        partialize: (state) => ({
          // 网格偏好（不常变化）
          gridSize: state.gridSize,
          gridStyle: state.gridStyle,
          gridDotSize: state.gridDotSize,
          gridColor: state.gridColor,
          gridBgColor: state.gridBgColor,
          gridBgEnabled: state.gridBgEnabled,
          // 单位偏好（不常变化）
          units: state.units,
          scaleRatio: state.scaleRatio,
          showScaleBar: state.showScaleBar,
          // 注意：不再持久化 zoom, panX, panY, hasInitialCenterApplied
          // 这些值会在每次缩放/拖拽时频繁变化，持久化会导致性能问题
        }) as Partial<CanvasState>,
      }
    )
  )
);

if (typeof window !== 'undefined' && 'persist' in useCanvasStore) {
  useCanvasStore.persist?.onFinishHydration((state) => {
    if (typeof state.hasInitialCenterApplied !== 'boolean') {
      useCanvasStore.setState({ hasInitialCenterApplied: false });
    }
    useCanvasStore.setState({ isHydrated: true });
  });
}

// 性能优化：导出常用的选择器
export const useCanvasUnits = () => useCanvasStore((state) => state.units);
export const useCanvasZoom = () => useCanvasStore((state) => state.zoom);
export const useCanvasGrid = () => useCanvasStore((state) => ({ 
  gridSize: state.gridSize,
  gridStyle: state.gridStyle
}));
export const useCanvasScale = () => useCanvasStore((state) => ({
  scaleRatio: state.scaleRatio,
  showScaleBar: state.showScaleBar,
  zoom: state.zoom,
  units: state.units
}));
