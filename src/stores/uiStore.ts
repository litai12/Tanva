import { create } from 'zustand';

interface UIState {
  // 面板显示状态
  showLibraryPanel: boolean;
  showLayerPanel: boolean;
  showGrid: boolean;
  showAxis: boolean;
  showBounds: boolean;
  showFlowPanel: boolean; // Flow 工具面板
  flowUIEnabled: boolean; // 是否渲染Flow相关UI（主工具按钮+浮动面板）
  mode: 'chat' | 'node'; // 全局模式

  // 智能落位配置
  smartPlacementOffset: number; // px，默认 522

  // 操作方法
  toggleLibraryPanel: () => void;
  toggleLayerPanel: () => void;
  toggleGrid: () => void;
  toggleAxis: () => void;
  toggleBounds: () => void;
  toggleFlowPanel: () => void;
  setFlowUIEnabled: (enabled: boolean) => void;
  toggleMode: () => void;
  setMode: (m: 'chat' | 'node') => void;

  // 设置方法
  setShowLibraryPanel: (show: boolean) => void;
  setShowLayerPanel: (show: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setShowAxis: (show: boolean) => void;
  setShowBounds: (show: boolean) => void;
  setShowFlowPanel: (show: boolean) => void;
  setSmartPlacementOffset: (offset: number) => void;
}

const initialOffset = (() => {
  if (typeof window !== 'undefined') {
    const val = localStorage.getItem('tanva-smart-offset');
    const n = val ? parseInt(val, 10) : NaN;
    if (!isNaN(n) && n > 0 && n < 10000) return n;
  }
  return 522; // 默认 512 + 10
})();

export const useUIStore = create<UIState>((set) => ({
  // 初始状态
  showLibraryPanel: false,
  showLayerPanel: false,
  showGrid: true,
  showAxis: false,
  showBounds: false,
  showFlowPanel: false,
  flowUIEnabled: false,
  mode: 'chat',
  smartPlacementOffset: initialOffset,

  // 切换方法
  toggleLibraryPanel: () => set((state) => ({ showLibraryPanel: !state.showLibraryPanel })),
  toggleLayerPanel: () => set((state) => ({ showLayerPanel: !state.showLayerPanel })),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleAxis: () => set((state) => ({ showAxis: !state.showAxis })),
  toggleBounds: () => set((state) => ({ showBounds: !state.showBounds })),
  toggleFlowPanel: () => set((state) => ({ showFlowPanel: !state.showFlowPanel })),
  setFlowUIEnabled: (enabled) => set({ flowUIEnabled: !!enabled }),
  toggleMode: () => set((state) => ({ mode: state.mode === 'chat' ? 'node' : 'chat' })),
  setMode: (m) => set({ mode: m }),

  // 设置方法
  setShowLibraryPanel: (show) => set({ showLibraryPanel: show }),
  setShowLayerPanel: (show) => set({ showLayerPanel: show }),
  setShowGrid: (show) => set({ showGrid: show }),
  setShowAxis: (show) => set({ showAxis: show }),
  setShowBounds: (show) => set({ showBounds: show }),
  setShowFlowPanel: (show) => set({ showFlowPanel: show }),
  setSmartPlacementOffset: (offset) => set(() => {
    const v = Math.max(16, Math.min(4096, Math.round(offset)));
    try { if (typeof window !== 'undefined') localStorage.setItem('tanva-smart-offset', String(v)); } catch {}
    return { smartPlacementOffset: v } as Partial<UIState>;
  }),
}));
