import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Unit } from '@/lib/unitUtils';
import { isValidUnit } from '@/lib/unitUtils';
import { createSafeStorage } from './storageUtils';
import { useProjectStore } from './projectStore';

// 视口持久化：使用独立存储，降低高频写入对主 store 的影响
const VIEWPORT_STORAGE_PREFIX = 'canvas-viewport-v1';
type ViewportSnapshot = { panX: number; panY: number; zoom: number };

const getViewportStorageKey = (projectId?: string | null) =>
  `${VIEWPORT_STORAGE_PREFIX}:${projectId || 'global'}`;

const readViewportSnapshot = (projectId?: string | null): ViewportSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const storage = createSafeStorage({ storageName: 'canvas-viewport' });
    const raw = storage.getItem(getViewportStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Number.isFinite(parsed.panX) &&
      Number.isFinite(parsed.panY) &&
      Number.isFinite(parsed.zoom)
    ) {
      return { panX: parsed.panX, panY: parsed.panY, zoom: parsed.zoom };
    }
  } catch (e) {
    console.warn('读取视口缓存失败，使用默认值:', e);
  }
  return null;
};

const initialProjectId = typeof window !== 'undefined' ? useProjectStore.getState().currentProjectId : null;
const initialViewport = readViewportSnapshot(initialProjectId);

// 网格样式枚举
export const GridStyle = {
  LINES: 'lines',    // 线条网格
  DOTS: 'dots',      // 点阵网格
  SOLID: 'solid'     // 纯色背景
} as const;

export type GridStyle = typeof GridStyle[keyof typeof GridStyle];

const GRID_SETTINGS_VERSION = 1;

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

  // 缩放设置
  zoomSensitivity: number;    // 滚轮缩放灵敏度 (1-10)
  
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

  // 缩放设置操作方法
  setZoomSensitivity: (sensitivity: number) => void;
}

export const useCanvasStore = create<CanvasState>()(
  subscribeWithSelector(
    persist(
      (set, get, _api) => ({
      // 初始状态
      gridSize: 32,
      gridStyle: GridStyle.SOLID, // 默认使用纯色背景
      gridDotSize: 1,
      gridColor: '#000000',
      gridBgColor: '#f7f7f7',
      gridBgEnabled: false,
      zoom: initialViewport?.zoom ?? 1.0,
      panX: initialViewport?.panX ?? 0,
      panY: initialViewport?.panY ?? 0,
      isHydrated: false,
      // 如果视口有缓存，视为已初始化过居中逻辑，避免覆盖用户视角
      hasInitialCenterApplied: !!initialViewport,
      
      // 交互状态初始值
      isDragging: false,    // 默认未拖拽
      
      // 单位系统初始状态
      units: 'm',           // 默认米单位
      scaleRatio: 0.1,      // 默认1像素=0.1米
      showScaleBar: true,   // 默认显示比例尺

      // 缩放设置初始状态
      zoomSensitivity: 3,   // 默认灵敏度3（范围1-10，较低值更平滑）
      
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

      // 缩放设置操作方法
      setZoomSensitivity: (sensitivity) => {
        const validSensitivity = Math.max(1, Math.min(10, Math.round(sensitivity))); // 限制范围 1-10
        set({ zoomSensitivity: validSensitivity });
      },
      }),
      {
        name: 'canvas-settings', // localStorage 键名
        storage: createJSONStorage<Partial<CanvasState>>(() => createSafeStorage({ storageName: 'canvas-settings' })),
        version: GRID_SETTINGS_VERSION,
        migrate: (persistedState: unknown, version): Partial<CanvasState> => {
          if (!persistedState || typeof persistedState !== 'object') {
            // 返回一个空的偏好配置，由 zustand 使用初始状态补全
            return {};
          }
          const state = persistedState as Partial<CanvasState>;

          // 版本 0 -> 1：将默认网格样式迁移为纯色
          if (version < GRID_SETTINGS_VERSION) {
            const migratedState: Partial<CanvasState> = { ...state };
            if (!migratedState.gridStyle || migratedState.gridStyle === GridStyle.LINES) {
              migratedState.gridStyle = GridStyle.SOLID;
            }
            return migratedState;
          }

          return state;
        },
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
          // 缩放偏好（不常变化）
          zoomSensitivity: state.zoomSensitivity,
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

// 持久化视口状态（pan/zoom），避免刷新后视角重置
if (typeof window !== 'undefined') {
  const viewportStorage = createSafeStorage({ storageName: 'canvas-viewport' });
  let lastSnapshot: ViewportSnapshot | null = initialViewport ?? null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let currentProjectId = initialProjectId;

  const schedulePersist = (snapshot: ViewportSnapshot) => {
    // 避免无意义写入
    if (
      lastSnapshot &&
      lastSnapshot.panX === snapshot.panX &&
      lastSnapshot.panY === snapshot.panY &&
      lastSnapshot.zoom === snapshot.zoom
    ) {
      return;
    }

    if (persistTimer) {
      clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
      try {
        viewportStorage.setItem(
          getViewportStorageKey(currentProjectId),
          JSON.stringify({
            panX: snapshot.panX,
            panY: snapshot.panY,
            zoom: snapshot.zoom,
          })
        );
        lastSnapshot = snapshot;
      } catch (e) {
        console.warn('写入视口缓存失败:', e);
      }
    }, 150);
  };

  // 监听视口变化，持久化
  useCanvasStore.subscribe(
    (state) => ({ panX: state.panX, panY: state.panY, zoom: state.zoom }),
    (viewport) => schedulePersist(viewport)
  );

  // 监听项目切换：加载对应项目的视角并覆盖当前视角
  try {
    useProjectStore.subscribe(
      (state) => state.currentProjectId,
      (projectId) => {
        currentProjectId = projectId;
        const snapshot = readViewportSnapshot(projectId) ?? readViewportSnapshot(null);
        if (snapshot) {
          useCanvasStore.setState({
            panX: snapshot.panX,
            panY: snapshot.panY,
            zoom: snapshot.zoom,
            hasInitialCenterApplied: true,
          });
          lastSnapshot = snapshot;
        }
      }
    );
  } catch (e) {
    console.warn('项目切换时读取视口失败:', e);
  }
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
