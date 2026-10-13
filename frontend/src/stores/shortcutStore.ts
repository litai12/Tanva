import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';
import { findShortcutConflict, getEffectiveBindings, isEditableShortcutTarget, matchesShortcutBinding, normalizeShortcutBinding, sanitizeShortcutOverrides, SHORTCUT_ACTIONS } from '../utils/keyboardShortcuts';
import type { ShortcutAction, ShortcutActionId, ShortcutOverrides } from '../utils/keyboardShortcuts';

export type ShortcutUpdateResult = { ok: true } | { ok: false; error: 'invalid' | 'conflict'; conflict?: ShortcutAction };

interface ShortcutState {
  overrides: ShortcutOverrides;
  settingsOpen: boolean;
  recordingActionId: ShortcutActionId | null;
  setBinding: (id: ShortcutActionId, binding: string) => ShortcutUpdateResult;
  clearBinding: (id: ShortcutActionId) => void;
  resetBinding: (id: ShortcutActionId) => ShortcutUpdateResult;
  resetAll: () => void;
  setSettingsOpen: (open: boolean) => void;
  setRecordingActionId: (id: ShortcutActionId | null) => void;
  matchesShortcut: (id: ShortcutActionId, event: KeyboardEvent) => boolean;
}

export const useShortcutStore = create<ShortcutState>()(persist((set, get) => ({
  overrides: {},
  settingsOpen: false,
  recordingActionId: null,
  setBinding: (id, binding) => {
    const normalized = normalizeShortcutBinding(binding);
    if (!normalized) return { ok: false, error: 'invalid' };
    const conflict = findShortcutConflict(id, normalized, get().overrides);
    if (conflict) return { ok: false, error: 'conflict', conflict };
    set((state) => ({ overrides: { ...state.overrides, [id]: [normalized] } }));
    return { ok: true };
  },
  clearBinding: (id) => set((state) => ({ overrides: { ...state.overrides, [id]: [] } })),
  resetBinding: (id) => {
    const defaults = SHORTCUT_ACTIONS.find((action) => action.id === id)!.defaultBindings;
    for (const binding of defaults) {
      const conflict = findShortcutConflict(id, binding, get().overrides);
      if (conflict) return { ok: false, error: 'conflict', conflict };
    }
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[id];
      return { overrides };
    });
    return { ok: true };
  },
  resetAll: () => set({ overrides: {}, recordingActionId: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open, ...(open ? {} : { recordingActionId: null }) }),
  setRecordingActionId: (id) => set({ recordingActionId: id }),
  matchesShortcut: (id, event) => {
    if (event.defaultPrevented || isShortcutSuppressed(event)) return false;
    if (isEditableShortcutTarget(event) && !(id === 'save' && (event.ctrlKey || event.metaKey))) return false;
    return getEffectiveBindings(id, get().overrides).some((binding) => matchesShortcutBinding(binding, event));
  },
}), {
  name: 'keyboard-shortcuts',
  version: 1,
  storage: createJSONStorage(() => createSafeStorage({ storageName: 'keyboard-shortcuts' })),
  partialize: (state) => ({ overrides: state.overrides }),
  merge: (persisted, current) => ({ ...current, overrides: sanitizeShortcutOverrides((persisted as Partial<ShortcutState> | undefined)?.overrides) }),
}));

/** Runtime listeners read current state, avoiding stale closures after rebinding. */
export const isShortcutSuppressed = (event?: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean => {
  const state = useShortcutStore.getState();
  return state.settingsOpen || state.recordingActionId !== null || !!event?.isComposing || event?.keyCode === 229;
};
