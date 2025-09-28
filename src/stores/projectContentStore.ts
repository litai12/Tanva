import { create } from 'zustand';
import { createEmptyProjectContent, type ProjectContentSnapshot } from '@/types/project';

type UpdateOptions = {
  markDirty?: boolean;
};

type ProjectContentState = {
  projectId: string | null;
  content: ProjectContentSnapshot | null;
  version: number;
  dirty: boolean;
  dirtySince: number | null;
  dirtyCounter: number;
  saving: boolean;
  lastSavedAt: string | null;
  lastError: string | null;
  hydrated: boolean;
  setProject: (projectId: string | null) => void;
  hydrate: (content: ProjectContentSnapshot, version: number, savedAt?: string | null) => void;
  updatePartial: (partial: Partial<ProjectContentSnapshot>, options?: UpdateOptions) => void;
  setSaving: (saving: boolean) => void;
  markSaved: (version: number, savedAt: string | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
};

const createInitialState = (): Omit<ProjectContentState,
  'setProject' | 'hydrate' | 'updatePartial' | 'setSaving' | 'markSaved' | 'setError' | 'reset'> => ({
  projectId: null,
  content: null,
  version: 1,
  dirty: false,
  dirtySince: null,
  dirtyCounter: 0,
  saving: false,
  lastSavedAt: null,
  lastError: null,
  hydrated: false,
});

export const useProjectContentStore = create<ProjectContentState>((set) => ({
  ...createInitialState(),
  setProject: (projectId) => {
    set(() => ({
      ...createInitialState(),
      projectId,
    }));
  },
  hydrate: (content, version, savedAt) => {
    set((state) => ({
      ...state,
      content,
      version,
      dirty: false,
      dirtySince: null,
      dirtyCounter: 0,
      saving: false,
      lastSavedAt: savedAt ?? state.lastSavedAt,
      lastError: null,
      hydrated: true,
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
  markSaved: (version, savedAt) => {
    set((state) => ({
      ...state,
      version,
      dirty: false,
      dirtySince: null,
      dirtyCounter: 0,
      saving: false,
      lastSavedAt: savedAt ?? new Date().toISOString(),
    }));
  },
  setError: (error) => set((state) => ({
    lastError: error,
    saving: false,
    dirtySince: error ? Date.now() : state.dirtySince,
  })),
  reset: () => set(() => createInitialState()),
}));
