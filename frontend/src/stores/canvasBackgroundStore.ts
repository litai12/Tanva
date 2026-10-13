import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';
import {
  normalizeHexColor,
  sanitizeBackgroundPreferences,
  type CanvasBackgroundPreferences,
  type CanvasColorScheme,
} from '../utils/canvasBackground';

interface CanvasBackgroundState {
  byScheme: CanvasBackgroundPreferences;
  setBackground: (scheme: CanvasColorScheme, color: string | null) => void;
}

export const useCanvasBackgroundStore = create<CanvasBackgroundState>()(persist(
  (set) => ({
    byScheme: { light: null, dark: null },
    setBackground: (scheme, color) => {
      const normalized = color === null ? null : normalizeHexColor(color);
      if (color !== null && !normalized) return;
      set((state) => ({ byScheme: { ...state.byScheme, [scheme]: normalized } }));
    },
  }),
  {
    name: 'tanva-canvas-background',
    storage: createJSONStorage(() => createSafeStorage({ storageName: 'canvas-background' })),
    partialize: (state) => ({ byScheme: state.byScheme }),
    merge: (persisted, current) => {
      const record = persisted && typeof persisted === 'object'
        ? persisted as Record<string, unknown> : {};
      return { ...current, byScheme: sanitizeBackgroundPreferences(record.byScheme) };
    },
  },
));
