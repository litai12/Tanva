import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DesktopSurfaceMode = 'closed' | 'docked' | 'maximized';

const MIN_SURFACE_WIDTH = 320;
const MAX_SURFACE_WIDTH = 1440;

export const clampDesktopSurfaceWidth = (width: number): number =>
  Math.min(MAX_SURFACE_WIDTH, Math.max(MIN_SURFACE_WIDTH, Math.round(width)));

interface DesktopSurfaceState {
  activePluginId: string | null;
  lastPluginId: string | null;
  manuallyDismissedPluginId: string | null;
  mode: DesktopSurfaceMode;
  widthByPluginId: Record<string, number>;
  open: (pluginId: string, mode?: Exclude<DesktopSurfaceMode, 'closed'>) => void;
  requestOpen: (pluginId: string, mode?: Exclude<DesktopSurfaceMode, 'closed'>) => void;
  close: () => void;
  dismiss: (pluginId?: string) => void;
  clearManualDismissal: (pluginId?: string) => void;
  maximize: () => void;
  restore: () => void;
  toggle: (fallbackPluginId?: string) => void;
  setDockedWidth: (pluginId: string, width: number) => void;
}

export const useDesktopSurfaceStore = create<DesktopSurfaceState>()(
  persist(
    (set, get) => ({
      activePluginId: null,
      lastPluginId: null,
      manuallyDismissedPluginId: null,
      mode: 'closed',
      widthByPluginId: {},
      open: (pluginId, mode = 'docked') =>
        set({
          activePluginId: pluginId,
          lastPluginId: pluginId,
          manuallyDismissedPluginId: null,
          mode,
        }),
      requestOpen: (pluginId, mode = 'docked') => {
        if (get().manuallyDismissedPluginId === pluginId) return;
        set({ activePluginId: pluginId, lastPluginId: pluginId, mode });
      },
      close: () => set({ activePluginId: null, mode: 'closed' }),
      dismiss: (pluginId) => {
        const state = get();
        const dismissedPluginId = pluginId || state.activePluginId;
        set({
          activePluginId: null,
          mode: 'closed',
          manuallyDismissedPluginId: dismissedPluginId || state.manuallyDismissedPluginId,
        });
      },
      clearManualDismissal: (pluginId) =>
        set((state) => ({
          manuallyDismissedPluginId:
            !pluginId || state.manuallyDismissedPluginId === pluginId
              ? null
              : state.manuallyDismissedPluginId,
        })),
      maximize: () => {
        if (!get().activePluginId) return;
        set({ mode: 'maximized' });
      },
      restore: () => {
        if (!get().activePluginId) return;
        set({ mode: 'docked' });
      },
      toggle: (fallbackPluginId) => {
        const state = get();
        if (state.mode !== 'closed' && state.activePluginId) {
          state.close();
          return;
        }
        const pluginId = state.lastPluginId || fallbackPluginId;
        if (pluginId) state.open(pluginId, 'docked');
      },
      setDockedWidth: (pluginId, width) =>
        set((state) => ({
          widthByPluginId: {
            ...state.widthByPluginId,
            [pluginId]: clampDesktopSurfaceWidth(width),
          },
        })),
    }),
    {
      name: 'tanva:desktop-surface:v2',
      partialize: (state) => ({
        lastPluginId: state.lastPluginId,
        widthByPluginId: state.widthByPluginId,
      }),
    }
  )
);
