import { create } from 'zustand';

export interface DesktopMediaPreviewItem {
  id: string;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  downloadName?: string;
}

export interface DesktopMediaPreview {
  id: string;
  title: string;
  items: DesktopMediaPreviewItem[];
  currentItemId: string;
  createdAt: string;
}

interface DesktopMediaPreviewState {
  preview: DesktopMediaPreview | null;
  open: (preview: DesktopMediaPreview) => void;
  select: (itemId: string) => void;
}

export const useDesktopMediaPreviewStore = create<DesktopMediaPreviewState>((set) => ({
  preview: null,
  open: (preview) => set({ preview }),
  select: (itemId) =>
    set((state) => {
      if (!state.preview?.items.some((item) => item.id === itemId)) return state;
      return {
        preview: {
          ...state.preview,
          currentItemId: itemId,
        },
      };
    }),
}));

export const DESKTOP_MEDIA_PREVIEW_OPEN_EVENT = 'tanva:desktop-open-media-preview';

export const openDesktopMediaPreview = (preview: DesktopMediaPreview): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<DesktopMediaPreview>(DESKTOP_MEDIA_PREVIEW_OPEN_EVENT, {
      detail: preview,
    })
  );
};
