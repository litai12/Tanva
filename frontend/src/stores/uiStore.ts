import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';

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
  flowEraserActive: boolean; // 节点擦除工具开关（仅 Node 模式）
  focusMode: boolean; // 专注模式 - 仅隐藏顶部导航栏和 AI 对话框
  showSandboxPanel: boolean; // Paper.js 沙盒面板
  showTemplatePanel: boolean; // 模板库面板

  // 智能落位配置
  smartPlacementOffset: number; // px，默认 778

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
  toggleFlowEraser: () => void;
  setFlowEraser: (v: boolean) => void;
  toggleFocusMode: () => void;
  toggleSandboxPanel: () => void;
  toggleTemplatePanel: () => void;

  // 设置方法
  setShowLibraryPanel: (show: boolean) => void;
  setShowLayerPanel: (show: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setShowAxis: (show: boolean) => void;
  setShowBounds: (show: boolean) => void;
  setShowFlowPanel: (show: boolean) => void;
  setSmartPlacementOffset: (offset: number) => void;
  setShowSandboxPanel: (show: boolean) => void;
  setShowTemplatePanel: (show: boolean) => void;
}

const initialOffset = (() => {
  if (typeof window !== 'undefined') {
    try {
      const val = localStorage.getItem('tanva-smart-offset');
      const migrated = localStorage.getItem('tanva-offset-migrated');
      // 一次性迁移：旧默认值 522 → 新默认值 778
      if (!migrated && val === '522') {
        localStorage.setItem('tanva-smart-offset', '778');
        localStorage.setItem('tanva-offset-migrated', '1');
        return 778;
      }
      const n = val ? parseInt(val, 10) : NaN;
      if (!isNaN(n) && n > 0 && n < 10000) return n;
    } catch {}
  }
  return 778; // 新默认偏移
})();

const persistedUIPreferences = (() => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem('ui-preferences');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = parsed && typeof parsed === 'object' ? (parsed.state ?? parsed) : null;
    if (!state || typeof state !== 'object') return null;
    const {
      showLibraryPanel,
      showLayerPanel,
      showGrid,
      showAxis,
      showBounds,
      showFlowPanel,
      flowUIEnabled,
      mode,
      flowEraserActive,
      focusMode,
      smartPlacementOffset,
      showSandboxPanel,
    } = state as Partial<UIState>;
    return {
      showLibraryPanel,
      showLayerPanel,
      showGrid,
      showAxis,
      showBounds,
      showFlowPanel,
      flowUIEnabled,
      mode,
      flowEraserActive,
      focusMode,
      smartPlacementOffset,
      showSandboxPanel,
    };
  } catch (error) {
    console.warn('[uiStore] Failed to parse persisted ui-preferences, using defaults.', error);
    return null;
  }
})();

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // 初始状态
      showLibraryPanel: persistedUIPreferences?.showLibraryPanel ?? false,
      showLayerPanel: persistedUIPreferences?.showLayerPanel ?? false,
      showGrid: persistedUIPreferences?.showGrid ?? true,
      showAxis: persistedUIPreferences?.showAxis ?? false,
      showBounds: persistedUIPreferences?.showBounds ?? false,
      showFlowPanel: persistedUIPreferences?.showFlowPanel ?? false,
      flowUIEnabled: persistedUIPreferences?.flowUIEnabled ?? false,
      mode: persistedUIPreferences?.mode ?? 'chat',
      flowEraserActive: persistedUIPreferences?.flowEraserActive ?? false,
      focusMode: persistedUIPreferences?.focusMode ?? false,
      showSandboxPanel: persistedUIPreferences?.showSandboxPanel ?? false,
      showTemplatePanel: false, // 模板面板默认关闭，不持久化
      smartPlacementOffset: persistedUIPreferences?.smartPlacementOffset ?? initialOffset,

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
      toggleFlowEraser: () => set((state) => ({ flowEraserActive: !state.flowEraserActive })),
      setFlowEraser: (v) => set({ flowEraserActive: !!v }),
      toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
      toggleSandboxPanel: () => set((state) => ({ showSandboxPanel: !state.showSandboxPanel })),
      toggleTemplatePanel: () => set((state) => ({ showTemplatePanel: !state.showTemplatePanel })),

      // 设置方法
      setShowLibraryPanel: (show) => set({ showLibraryPanel: show }),
      setShowLayerPanel: (show) => set({ showLayerPanel: show }),
      setShowGrid: (show) => set({ showGrid: show }),
      setShowAxis: (show) => set({ showAxis: show }),
      setShowBounds: (show) => set({ showBounds: show }),
      setShowFlowPanel: (show) => set({ showFlowPanel: show }),
      setShowSandboxPanel: (show) => set({ showSandboxPanel: show }),
      setShowTemplatePanel: (show) => set({ showTemplatePanel: show }),
      setSmartPlacementOffset: (offset) => set(() => {
        const v = Math.max(16, Math.min(4096, Math.round(offset)));
        try { if (typeof window !== 'undefined') localStorage.setItem('tanva-smart-offset', String(v)); } catch {}
        return { smartPlacementOffset: v } as Partial<UIState>;
      }),
    }),
    {
      name: 'ui-preferences',
      storage: createJSONStorage<Partial<UIState>>(() => createSafeStorage({ storageName: 'ui-preferences' })),
      partialize: (state) => ({
        showLibraryPanel: state.showLibraryPanel,
        showLayerPanel: state.showLayerPanel,
        showGrid: state.showGrid,
        showAxis: state.showAxis,
        showBounds: state.showBounds,
        showFlowPanel: state.showFlowPanel,
        flowUIEnabled: state.flowUIEnabled,
        mode: state.mode,
        flowEraserActive: state.flowEraserActive,
        focusMode: state.focusMode,
        smartPlacementOffset: state.smartPlacementOffset,
        showSandboxPanel: state.showSandboxPanel,
      }) as Partial<UIState>,
    }
  )
);
