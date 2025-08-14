import { create } from 'zustand';

interface UIState {
  // 面板显示状态
  showLibraryPanel: boolean;
  showGrid: boolean;
  showAxis: boolean;
  showBounds: boolean;
  
  // 操作方法
  toggleLibraryPanel: () => void;
  toggleGrid: () => void;
  toggleAxis: () => void;
  toggleBounds: () => void;
  
  // 设置方法
  setShowLibraryPanel: (show: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setShowAxis: (show: boolean) => void;
  setShowBounds: (show: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // 初始状态
  showLibraryPanel: false,
  showGrid: true,
  showAxis: true,
  showBounds: false,
  
  // 切换方法
  toggleLibraryPanel: () => set((state) => ({ showLibraryPanel: !state.showLibraryPanel })),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleAxis: () => set((state) => ({ showAxis: !state.showAxis })),
  toggleBounds: () => set((state) => ({ showBounds: !state.showBounds })),
  
  // 设置方法
  setShowLibraryPanel: (show) => set({ showLibraryPanel: show }),
  setShowGrid: (show) => set({ showGrid: show }),
  setShowAxis: (show) => set({ showAxis: show }),
  setShowBounds: (show) => set({ showBounds: show }),
}));