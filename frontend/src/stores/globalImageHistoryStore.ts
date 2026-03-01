import { create } from 'zustand';
import {
  globalImageHistoryApi,
  type GlobalImageHistoryItem,
  type CreateGlobalImageHistoryDto,
} from '@/services/globalImageHistoryApi';

interface GlobalImageHistoryStore {
  items: GlobalImageHistoryItem[];
  isLoading: boolean;
  hasMore: boolean;
  nextCursor?: string;
  totalCount: number;

  // Actions
  fetchItems: (reset?: boolean) => Promise<void>;
  fetchCount: () => Promise<void>;
  addItem: (dto: CreateGlobalImageHistoryDto) => Promise<GlobalImageHistoryItem | null>;
  deleteItem: (id: string) => Promise<boolean>;
  reset: () => void;
}

export const useGlobalImageHistoryStore = create<GlobalImageHistoryStore>((set, get) => ({
  items: [],
  isLoading: false,
  hasMore: true,
  nextCursor: undefined,
  totalCount: 0,

  fetchItems: async (reset = false) => {
    const state = get();
    if (state.isLoading) return;
    if (!reset && !state.hasMore) return;

    set({ isLoading: true });

    try {
      const cursor = reset ? undefined : state.nextCursor;
      const result = await globalImageHistoryApi.list({ limit: 20, cursor });

      set((s) => ({
        items: reset ? result.items : [...s.items, ...result.items],
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        isLoading: false,
      }));
    } catch (error) {
      console.error('[GlobalImageHistory] 获取列表失败:', error);
      set({ isLoading: false });
    }
  },

  fetchCount: async () => {
    try {
      const { count } = await globalImageHistoryApi.getCount();
      set({ totalCount: count });
    } catch (error) {
      console.error('[GlobalImageHistory] 获取数量失败:', error);
    }
  },

  addItem: async (dto) => {
    try {
      const item = await globalImageHistoryApi.create(dto);
      set((s) => ({
        items: [item, ...s.items],
        totalCount: s.totalCount + 1,
      }));
      return item;
    } catch (error) {
      console.error('[GlobalImageHistory] 添加失败:', error);
      return null;
    }
  },

  deleteItem: async (id) => {
    try {
      const result = await globalImageHistoryApi.delete(id);
      if (result.success) {
        set((s) => ({
          items: s.items.filter((item) => item.id !== id),
          totalCount: Math.max(0, s.totalCount - 1),
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('[GlobalImageHistory] 删除失败:', error);
      return false;
    }
  },

  reset: () => {
    set({
      items: [],
      isLoading: false,
      hasMore: true,
      nextCursor: undefined,
      totalCount: 0,
    });
  },
}));
