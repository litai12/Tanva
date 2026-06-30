import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';

const SMART_PLACEMENT_OFFSET_HORIZONTAL = 522;
const SMART_PLACEMENT_OFFSET_VERTICAL = 552;
const UI_PREFERENCES_VERSION = 1;

const isMode = (value: unknown): value is 'chat' | 'node' =>
  value === 'chat' || value === 'node';

interface UIState {
  // 面板显示状态
  showLibraryPanel: boolean;
  showMaterialLibraryPanel: boolean; // 素材库面板（右侧，个人/团队资产）
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
  showDebugPanel: boolean; // 调试面板
  snapAlignmentEnabled: boolean; // 自动对齐开关

  // 智能落位配置
  smartPlacementOffsetHorizontal: number; // px，水平偏移 522
  smartPlacementOffsetVertical: number; // px，垂直偏移 552

  // 操作方法
  toggleLibraryPanel: () => void;
  toggleMaterialLibraryPanel: () => void;
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
  toggleDebugPanel: () => void;
  toggleSnapAlignment: () => void;

  // 设置方法
  setShowLibraryPanel: (show: boolean) => void;
  setShowMaterialLibraryPanel: (show: boolean) => void;
  setShowLayerPanel: (show: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setShowAxis: (show: boolean) => void;
  setShowBounds: (show: boolean) => void;
  setShowFlowPanel: (show: boolean) => void;
  setSmartPlacementOffsetHorizontal: (offset: number) => void;
  setSmartPlacementOffsetVertical: (offset: number) => void;
  setShowSandboxPanel: (show: boolean) => void;
  setShowTemplatePanel: (show: boolean) => void;
  setShowDebugPanel: (show: boolean) => void;
}

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
      showSandboxPanel,
      showDebugPanel,
      snapAlignmentEnabled,
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
      showSandboxPanel,
      showDebugPanel,
      snapAlignmentEnabled,
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
      showMaterialLibraryPanel: false, // 素材库面板不持久化，刷新后默认关闭
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
      showDebugPanel: persistedUIPreferences?.showDebugPanel ?? false, // 调试面板默认关闭
      snapAlignmentEnabled: persistedUIPreferences?.snapAlignmentEnabled ?? true, // 自动对齐默认开启
      smartPlacementOffsetHorizontal: SMART_PLACEMENT_OFFSET_HORIZONTAL,
      smartPlacementOffsetVertical: SMART_PLACEMENT_OFFSET_VERTICAL,

      // 切换方法
      toggleLibraryPanel: () =>
        set((state) => ({
          showLibraryPanel: !state.showLibraryPanel,
          // 右侧面板互斥：打开「库」时关闭「素材库」
          showMaterialLibraryPanel: state.showLibraryPanel ? state.showMaterialLibraryPanel : false,
        })),
      toggleMaterialLibraryPanel: () =>
        set((state) => ({
          showMaterialLibraryPanel: !state.showMaterialLibraryPanel,
          // 右侧面板互斥：打开「素材库」时关闭「库」
          showLibraryPanel: state.showMaterialLibraryPanel ? state.showLibraryPanel : false,
        })),
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
      toggleDebugPanel: () => set((state) => ({ showDebugPanel: !state.showDebugPanel })),
      toggleSnapAlignment: () => set((state) => ({ snapAlignmentEnabled: !state.snapAlignmentEnabled })),

      // 设置方法
      setShowLibraryPanel: (show) =>
        set((state) => ({
          showLibraryPanel: show,
          showMaterialLibraryPanel: show ? false : state.showMaterialLibraryPanel,
        })),
      setShowMaterialLibraryPanel: (show) =>
        set((state) => ({
          showMaterialLibraryPanel: show,
          showLibraryPanel: show ? false : state.showLibraryPanel,
        })),
      setShowLayerPanel: (show) => set({ showLayerPanel: show }),
      setShowGrid: (show) => set({ showGrid: show }),
      setShowAxis: (show) => set({ showAxis: show }),
      setShowBounds: (show) => set({ showBounds: show }),
      setShowFlowPanel: (show) => set({ showFlowPanel: show }),
      setShowSandboxPanel: (show) => set({ showSandboxPanel: show }),
      setShowTemplatePanel: (show) => set({ showTemplatePanel: show }),
      setShowDebugPanel: (show) => set({ showDebugPanel: show }),
      setSmartPlacementOffsetHorizontal: () => set(() => ({ smartPlacementOffsetHorizontal: SMART_PLACEMENT_OFFSET_HORIZONTAL })),
      setSmartPlacementOffsetVertical: () => set(() => ({ smartPlacementOffsetVertical: SMART_PLACEMENT_OFFSET_VERTICAL })),
    }),
    {
      name: 'ui-preferences',
      storage: createJSONStorage<Partial<UIState>>(() => createSafeStorage({ storageName: 'ui-preferences' })),
      version: UI_PREFERENCES_VERSION,
      migrate: (persistedState: unknown): Partial<UIState> => {
        if (!persistedState || typeof persistedState !== 'object') return {};
        const state = persistedState as Partial<UIState>;
        return {
          ...state,
          mode: isMode(state.mode) ? state.mode : 'chat',
          showLibraryPanel:
            typeof state.showLibraryPanel === 'boolean' ? state.showLibraryPanel : false,
          showLayerPanel:
            typeof state.showLayerPanel === 'boolean' ? state.showLayerPanel : false,
          showGrid: typeof state.showGrid === 'boolean' ? state.showGrid : true,
          showAxis: typeof state.showAxis === 'boolean' ? state.showAxis : false,
          showBounds: typeof state.showBounds === 'boolean' ? state.showBounds : false,
          showFlowPanel: typeof state.showFlowPanel === 'boolean' ? state.showFlowPanel : false,
          flowUIEnabled: typeof state.flowUIEnabled === 'boolean' ? state.flowUIEnabled : false,
          flowEraserActive:
            typeof state.flowEraserActive === 'boolean' ? state.flowEraserActive : false,
          focusMode: typeof state.focusMode === 'boolean' ? state.focusMode : false,
          showSandboxPanel:
            typeof state.showSandboxPanel === 'boolean' ? state.showSandboxPanel : false,
          showDebugPanel: typeof state.showDebugPanel === 'boolean' ? state.showDebugPanel : false,
          snapAlignmentEnabled:
            typeof state.snapAlignmentEnabled === 'boolean' ? state.snapAlignmentEnabled : true,
        };
      },
      merge: (persistedState, currentState) => {
        const safePersisted = persistedState && typeof persistedState === 'object' ? (persistedState as Partial<UIState>) : {};
        return {
          ...currentState,
          ...safePersisted,
          smartPlacementOffsetHorizontal: SMART_PLACEMENT_OFFSET_HORIZONTAL,
          smartPlacementOffsetVertical: SMART_PLACEMENT_OFFSET_VERTICAL,
        };
      },
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
        showSandboxPanel: state.showSandboxPanel,
        showDebugPanel: state.showDebugPanel,
        snapAlignmentEnabled: state.snapAlignmentEnabled,
      }) as Partial<UIState>,
    }
  )
);
