import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { persist } from 'zustand/middleware';
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
  addImage: (item: Omit<ImageHistoryItem, 'timestamp'>) => void;
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
            timestamp: Date.now()
          };
          
          // 避免重复ID（保留最新）
          const filtered = state.history.filter(existing => existing.id !== newItem.id);
          const updatedHistory = [newItem, ...filtered].slice(0, 50);
          
          return { history: updatedHistory };
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
        storage: createSafeStorage({ storageName: 'image-history' }),
        partialize: (state) => ({
          history: state.history
        })
      }
    )
  )
);
