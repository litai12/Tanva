import { create } from 'zustand';
import {
  globalImageHistoryApi,
  type GlobalImageHistoryItem,
  type CreateGlobalImageHistoryDto,
} from '@/services/globalImageHistoryApi';

interface GlobalImageHistoryQuery {
  sourceType?: string;
  sourceProjectId?: string;
  search?: string;
}

const normalizeQuery = (query?: GlobalImageHistoryQuery): GlobalImageHistoryQuery => {
  const sourceType = query?.sourceType?.trim();
  const sourceProjectId = query?.sourceProjectId?.trim();
  const search = query?.search?.trim();
  return {
    sourceType: sourceType || undefined,
    sourceProjectId: sourceProjectId || undefined,
    search: search || undefined,
  };
};

const isSameQuery = (a: GlobalImageHistoryQuery, b: GlobalImageHistoryQuery): boolean => {
  return (
    (a.sourceType || undefined) === (b.sourceType || undefined) &&
    (a.sourceProjectId || undefined) === (b.sourceProjectId || undefined) &&
    (a.search || undefined) === (b.search || undefined)
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface GlobalImageHistoryStore {
  items: GlobalImageHistoryItem[];
  isLoading: boolean;
  hasMore: boolean;
  nextCursor?: string;
  totalCount: number;
  currentQuery: GlobalImageHistoryQuery;

  // Actions
  fetchItems: (options?: { reset?: boolean; query?: GlobalImageHistoryQuery }) => Promise<void>;
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
  currentQuery: {},

  fetchItems: async (options) => {
    const reset = options?.reset ?? false;
    const requestedQuery = normalizeQuery(options?.query);
    const state = get();
    const nextQuery = Object.keys(requestedQuery).length > 0
      ? requestedQuery
      : state.currentQuery;
    const queryChanged = !isSameQuery(state.currentQuery, nextQuery);
    const shouldReset = reset || queryChanged;

    if (state.isLoading) return;
    if (!shouldReset && !state.hasMore) return;

    set((s) => ({
      isLoading: true,
      currentQuery: nextQuery,
      ...(shouldReset
        ? {
            items: [],
            hasMore: true,
            nextCursor: undefined,
          }
        : {
            items: s.items,
            hasMore: s.hasMore,
            nextCursor: s.nextCursor,
          }),
    }));

    try {
      const latest = get();
      const cursor = shouldReset ? undefined : latest.nextCursor;
      const result = await globalImageHistoryApi.list({
        limit: 20,
        cursor,
        sourceType: nextQuery.sourceType,
        sourceProjectId: nextQuery.sourceProjectId,
        search: nextQuery.search,
      });

      set((s) => ({
        items: shouldReset ? result.items : [...s.items, ...result.items],
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
    const maxAttempts = 3;
    const retryDelays = [300, 800];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const item = await globalImageHistoryApi.create(dto);
        set((s) => ({
          items: [item, ...s.items],
          totalCount: s.totalCount + 1,
        }));
        return item;
      } catch (error) {
        if (attempt >= maxAttempts) {
          console.error('[GlobalImageHistory] 添加失败:', error);
          return null;
        }
        await sleep(retryDelays[attempt - 1] ?? 1200);
      }
    }
    return null;
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
      currentQuery: {},
    });
  },
}));
