import { create } from 'zustand';
import { createEmptyProjectContent, type ProjectContentSnapshot } from '@/types/project';

type UpdateOptions = {
  markDirty?: boolean;
};

type HydrateOptions = {
  preserveProjectViewReady?: boolean;
};

const sameCanvasSnapshot = (
  prev: ProjectContentSnapshot['canvas'] | null | undefined,
  next: ProjectContentSnapshot['canvas'] | null | undefined
) =>
  prev === next ||
  (
    !!prev &&
    !!next &&
    prev.zoom === next.zoom &&
    prev.panX === next.panX &&
    prev.panY === next.panY
  );

const sameProjectContentSnapshot = (
  prev: ProjectContentSnapshot,
  next: ProjectContentSnapshot
) =>
  prev === next ||
  (
    prev.layers === next.layers &&
    prev.activeLayerId === next.activeLayerId &&
    sameCanvasSnapshot(prev.canvas, next.canvas) &&
    prev.paperJson === next.paperJson &&
    prev.meta === next.meta &&
    prev.assets === next.assets &&
    prev.flow === next.flow &&
    prev.aiChatSessions === next.aiChatSessions &&
    prev.aiChatActiveSessionId === next.aiChatActiveSessionId &&
    prev.updatedAt === next.updatedAt
  );

type ProjectContentState = {
  projectId: string | null;
  content: ProjectContentSnapshot | null;
  version: number;
  dirty: boolean;
  dirtySince: number | null;
  dirtyCounter: number;
  saving: boolean;
  manualSaving: boolean;
  lastSavedAt: string | null;
  lastError: string | null;
  lastWarning: string | null;
  hydrated: boolean;
  cacheValidationPending: boolean;
  projectViewReady: boolean;
  setProject: (projectId: string | null) => void;
  hydrate: (content: ProjectContentSnapshot, version: number, savedAt?: string | null, options?: HydrateOptions) => void;
  updatePartial: (partial: Partial<ProjectContentSnapshot>, options?: UpdateOptions) => void;
  setSaving: (saving: boolean) => void;
  setManualSaving: (saving: boolean) => void;
  setCacheValidationPending: (pending: boolean) => void;
  setProjectViewReady: (ready: boolean) => void;
  markSaved: (version: number, savedAt: string | null, savedAtCounter?: number) => void;
  setError: (error: string | null) => void;
  setWarning: (warning: string | null) => void;
  reset: () => void;
};

const createInitialState = (): Omit<ProjectContentState,
  'setProject' | 'hydrate' | 'updatePartial' | 'setSaving' | 'setManualSaving' | 'setCacheValidationPending' | 'setProjectViewReady' | 'markSaved' | 'setError' | 'setWarning' | 'reset'> => ({
  projectId: null,
  content: null,
  version: 1,
  dirty: false,
  dirtySince: null,
  dirtyCounter: 0,
  saving: false,
  manualSaving: false,
  lastSavedAt: null,
  lastError: null,
  lastWarning: null,
  hydrated: false,
  cacheValidationPending: false,
  projectViewReady: false,
});

export const useProjectContentStore = create<ProjectContentState>((set) => ({
  ...createInitialState(),
  setProject: (projectId) => {
    set(() => ({
      ...createInitialState(),
      projectId,
    }));
  },
  hydrate: (content, version, savedAt, options) => {
    set((state) => ({
      ...state,
      content,
      version,
      dirty: false,
      dirtySince: null,
      dirtyCounter: 0,
      saving: false,
      manualSaving: false,
      lastSavedAt: savedAt ?? state.lastSavedAt,
      lastError: null,
      lastWarning: null,
      hydrated: true,
      projectViewReady: options?.preserveProjectViewReady ? state.projectViewReady : false,
    }));
  },
  updatePartial: (partial, options) => {
    const markDirty = options?.markDirty ?? true;
    set((state) => {
      if (!state.projectId) {
        return state;
      }

      const baseContent = state.content ?? createEmptyProjectContent();
      const nextContent: ProjectContentSnapshot = {
        ...baseContent,
        ...partial,
        canvas: partial.canvas ? { ...baseContent.canvas, ...partial.canvas } : baseContent.canvas,
        updatedAt: markDirty ? new Date().toISOString() : baseContent.updatedAt,
      };

      if (partial.layers) {
        nextContent.layers = partial.layers;
      }
      if (partial.activeLayerId !== undefined) {
        nextContent.activeLayerId = partial.activeLayerId;
      }
      if (partial.updatedAt && !markDirty) {
        nextContent.updatedAt = partial.updatedAt;
      }

      if (!markDirty && state.content && sameProjectContentSnapshot(state.content, nextContent)) {
        return state;
      }

      if (!markDirty) {
        return {
          ...state,
          content: nextContent,
        };
      }

      const now = Date.now();
      return {
        ...state,
        content: nextContent,
        dirty: true,
        dirtySince: state.dirtySince ?? now,
        dirtyCounter: state.dirtyCounter + 1,
        lastError: null,
      };
    });
  },
  setSaving: (saving) => set({ saving }),
  setManualSaving: (manualSaving) => set({ manualSaving }),
  setCacheValidationPending: (cacheValidationPending) => set({ cacheValidationPending }),
  setProjectViewReady: (projectViewReady) => set({ projectViewReady }),
  markSaved: (version, savedAt, savedAtCounter?: number) => {
    set((state) => {
      // 如果提供了 savedAtCounter，检查保存期间是否有新修改
      // 只有当 dirtyCounter 没有增加时才清除 dirty 状态
      const hasNewChanges = savedAtCounter !== undefined && state.dirtyCounter > savedAtCounter;

      return {
        ...state,
        version,
        dirty: hasNewChanges ? state.dirty : false,
        dirtySince: hasNewChanges ? state.dirtySince : null,
        dirtyCounter: hasNewChanges ? state.dirtyCounter : 0,
        saving: false,
        manualSaving: false,
        lastSavedAt: savedAt ?? new Date().toISOString(),
      };
    });
  },
  setError: (error) => set((state) => ({
    lastError: error,
    saving: false,
    manualSaving: false,
    // 保存失败且确实有未落盘修改时,保留最早的脏起点(用于「已 X 分钟未保存」告警);
    // 反复失败不能把计时清零;clean 状态下的错误不该污染下一轮编辑的计时。
    dirtySince: error && state.dirty ? (state.dirtySince ?? Date.now()) : state.dirtySince,
  })),
  setWarning: (warning) => set({ lastWarning: warning }),
  reset: () => set(() => createInitialState()),
}));
