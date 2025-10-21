import { create } from 'zustand';
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';

export interface ImageHistoryItem {
  id: string;
  src: string;
  remoteUrl?: string;
  thumbnail?: string;
  title: string;
  nodeId: string;
  nodeType: 'generate' | 'image' | '3d' | 'camera';
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
            timestamp: item.timestamp ?? Date.now()
          };
          
          const existingIndex = state.history.findIndex(existing => existing.id === newItem.id);
          if (existingIndex >= 0) {
            const updated = [...state.history];
            updated[existingIndex] = { ...updated[existingIndex], ...newItem };
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
