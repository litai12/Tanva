import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface ImageHistoryItem {
  id: string;
  src: string;
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
  subscribeWithSelector((set, get) => ({
    history: [],
    
    addImage: (item) => set((state) => {
      const newItem: ImageHistoryItem = {
        ...item,
        timestamp: Date.now()
      };
      
      // 添加到历史记录开头，最多保留50张图片
      const updatedHistory = [newItem, ...state.history].slice(0, 50);
      
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
  }))
);