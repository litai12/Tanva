import { create } from 'zustand';
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';

const normalizeValue = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getCanonicalSrc = (item: { src?: string | null; remoteUrl?: string | null }):
  string | null => normalizeValue(item.remoteUrl?.startsWith('http') ? item.remoteUrl : item.src);

export interface ImageHistoryItem {
  id: string;
  src: string;
  remoteUrl?: string;
  thumbnail?: string;
  title: string;
  nodeId: string;
  nodeType: 'generate' | 'image' | '3d' | 'camera';
  projectId?: string | null;
  timestamp: number;
}

interface ImageHistoryStore {
  history: ImageHistoryItem[];
  addImage: (item: Omit<ImageHistoryItem, 'timestamp'> & { timestamp?: number }) => void;
  updateImage: (id: string, patch: Partial<ImageHistoryItem>) => void;
  removeImage: (id: string) => void;
  clearHistory: () => void;
  getImagesByNode: (nodeId: string) => ImageHistoryItem[];
  getCurrentImage: (nodeId: string) => ImageHistoryItem | undefined;
}

export const useImageHistoryStore = create<ImageHistoryStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        history: [],
        
        addImage: (item) => set((state) => {
          const canonicalSrc = getCanonicalSrc(item);
          if (!canonicalSrc) {
            return state;
          }

          const projectKey = item.projectId ?? null;
          const preferredSrc = (() => {
            if (item.remoteUrl && item.remoteUrl.startsWith('http')) return item.remoteUrl;
            if (item.src?.startsWith('http')) return item.src;
            return item.src;
          })();

          const newItem: ImageHistoryItem = {
            ...item,
            src: preferredSrc,
            remoteUrl: item.remoteUrl || (preferredSrc?.startsWith('http') ? preferredSrc : undefined),
            thumbnail: item.thumbnail,
            projectId: projectKey,
            timestamp: item.timestamp ?? Date.now()
          };
          
          // 先按同 projectId + 同源链接去重，避免同一张图出现多条
          const existingIndex = state.history.findIndex(existing => {
            const existingProject = existing.projectId ?? null;
            if (existingProject !== projectKey) return false;
            return getCanonicalSrc(existing) === canonicalSrc;
          });

          if (existingIndex >= 0) {
            const updated = [...state.history];
            const existing = updated[existingIndex];
            updated[existingIndex] = {
              ...existing,
              ...newItem,
              id: existing.id, // 保留原有id，避免 key 抖动
              projectId: projectKey,
              timestamp: newItem.timestamp ?? existing.timestamp
            };
            return { history: updated };
          }
          
          const updatedHistory = [newItem, ...state.history];
          if (updatedHistory.length > 50) {
            updatedHistory.length = 50;
          }
          return { history: updatedHistory };
        }),

        updateImage: (id, patch) => set((state) => {
          const updated = state.history.map((item) =>
            item.id === id
              ? { ...item, ...patch, timestamp: patch.timestamp ?? item.timestamp }
              : item
          );
          return { history: updated };
        }),
        
        removeImage: (id) => set((state) => ({
          history: state.history.filter(item => item.id !== id)
        })),
        
        clearHistory: () => set({ history: [] }),
        
        getImagesByNode: (nodeId) => {
          const { history } = get();
          return history.filter(item => item.nodeId === nodeId);
        },
        
        getCurrentImage: (nodeId) => {
          const { history } = get();
          return history.find(item => item.nodeId === nodeId);
        }
      }),
      {
        name: 'image-history',
        storage: createJSONStorage<Partial<ImageHistoryStore>>(() => createSafeStorage({ storageName: 'image-history' })),
        partialize: (state) => ({
          history: state.history
        }) as Partial<ImageHistoryStore>
      }
    )
  )
);
