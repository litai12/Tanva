import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  STORE_NAMES,
  idbGetAll,
  idbPutBatch,
  idbDelete,
  idbClear,
  idbEnforceLimit,
  isMigrationDone,
  markMigrationDone,
  isIndexedDBAvailable,
} from '@/services/indexedDBService';

const normalizeValue = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getCanonicalSrc = (item: { src?: string | null; remoteUrl?: string | null }):
  string | null => normalizeValue(item.remoteUrl?.startsWith('http') ? item.remoteUrl : item.src);

const shouldSkipHistoryItem = (item: { nodeId: string; nodeType: ImageHistoryItem['nodeType'] }) =>
  item.nodeId === 'canvas' && item.nodeType === 'image';

const normalizeLocalImageSrc = (src?: string | null): string | null => {
  const normalized = normalizeValue(src);
  if (!normalized) return null;
  if (normalized.startsWith('data:') || normalized.startsWith('http')) return normalized;
  // 兼容：若调用方传入原始 base64（无 dataURL 前缀），默认按 png 处理
  return `data:image/png;base64,${normalized}`;
};

// 获取用于运行时展示/去重的 src（优先 URL；无 URL 时允许 dataURL 作为内存态历史）
const getStorageFriendlySrc = (item: { src?: string | null; remoteUrl?: string | null }): string | null => {
  const remote = normalizeValue(item.remoteUrl);
  if (remote && remote.startsWith('http')) return remote;

  const local = normalizeLocalImageSrc(item.src);
  if (!local) return null;
  return local;
};

export interface ImageHistoryItem {
  id: string;
  src: string;
  remoteUrl?: string;
  thumbnail?: string; // 已弃用，不再存储，保留字段兼容性
  title: string;
  nodeId: string;
  nodeType: 'generate' | 'generatePro' | 'generatePro4' | 'image' | 'imagePro' | '3d' | 'camera' | 'midjourney';
  projectId?: string | null;
  timestamp: number;
}

interface ImageHistoryStore {
  history: ImageHistoryItem[];
  _hydrated: boolean;
  addImage: (item: Omit<ImageHistoryItem, 'timestamp'> & { timestamp?: number }) => void;
  updateImage: (id: string, patch: Partial<ImageHistoryItem>) => void;
  removeImage: (id: string) => void;
  clearHistory: () => void;
  getImagesByNode: (nodeId: string) => ImageHistoryItem[];
  getCurrentImage: (nodeId: string) => ImageHistoryItem | undefined;
  cleanupInvalidEntries: () => void;
  _hydrateFromIDB: () => Promise<void>;
}

// 最大历史记录数量
const MAX_HISTORY_SIZE = 50;

// IndexedDB 持久化辅助函数
const STORE_NAME = STORE_NAMES.IMAGE_HISTORY;

// 防抖写入
let writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWrites = new Map<string, ImageHistoryItem>();

const getPersistableHistoryItem = (item: ImageHistoryItem): ImageHistoryItem | null => {
  const remoteUrl = normalizeValue(item.remoteUrl);
  if (remoteUrl && remoteUrl.startsWith('http')) {
    return {
      ...item,
      src: remoteUrl,
      remoteUrl,
      thumbnail: undefined,
    };
  }

  const src = normalizeValue(item.src);
  if (src && src.startsWith('http')) {
    return {
      ...item,
      src,
      remoteUrl: item.remoteUrl ?? src,
      thumbnail: undefined,
    };
  }

  // dataURL/base64 等大字段仅保留内存态，不写入 IndexedDB
  return null;
};

const flushPendingWrites = async () => {
  if (pendingWrites.size === 0) return;

  const items = Array.from(pendingWrites.values());
  pendingWrites.clear();

  await idbPutBatch(STORE_NAME, items);

  // 执行 LRU 清理
  await idbEnforceLimit(STORE_NAME);
};

const scheduleWrite = (item: ImageHistoryItem) => {
  const persistable = getPersistableHistoryItem(item);
  if (!persistable) return;
  pendingWrites.set(persistable.id, persistable);

  if (writeDebounceTimer) {
    clearTimeout(writeDebounceTimer);
  }

  writeDebounceTimer = setTimeout(flushPendingWrites, 300);
};

// 从 localStorage 迁移数据到 IndexedDB
const migrateFromLocalStorage = async (): Promise<ImageHistoryItem[]> => {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem('image-history');
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const history = parsed?.state?.history;

    if (!Array.isArray(history) || history.length === 0) return [];

    console.log(`[ImageHistory] 从 localStorage 迁移 ${history.length} 条记录到 IndexedDB`);
    return history as ImageHistoryItem[];
  } catch (error) {
    console.warn('[ImageHistory] 迁移数据解析失败:', error);
    return [];
  }
};

export const useImageHistoryStore = create<ImageHistoryStore>()(
  subscribeWithSelector(
    (set, get) => ({
      history: [],
      _hydrated: false,

      addImage: (item) => {
        if (shouldSkipHistoryItem(item)) {
          return;
        }
        set((state) => {
          const projectKey = item.projectId ?? null;

          const storageSrc = getStorageFriendlySrc(item);
          if (!storageSrc) {
            return state;
          }

          const canonicalSrc = getCanonicalSrc({
            src: storageSrc,
            remoteUrl: item.remoteUrl,
          });
          if (!canonicalSrc) {
            return state;
          }

          const newItem: ImageHistoryItem = {
            ...item,
            src: storageSrc,
            remoteUrl:
              item.remoteUrl || (storageSrc.startsWith('http') ? storageSrc : undefined),
            thumbnail: undefined,
            projectId: projectKey,
            timestamp: item.timestamp ?? Date.now(),
          };

          // 去重逻辑
          const existingIndex = state.history.findIndex((existing) => {
            const existingProject = existing.projectId ?? null;
            if (existingProject !== projectKey) return false;
            return getCanonicalSrc(existing) === canonicalSrc;
          });

          let finalItem: ImageHistoryItem;

          if (existingIndex >= 0) {
            const updated = [...state.history];
            const existing = updated[existingIndex];

            const shouldKeepExistingSrc =
              existing.src?.startsWith('http') && !storageSrc.startsWith('http');

            finalItem = {
              ...existing,
              ...newItem,
              src: shouldKeepExistingSrc ? existing.src : storageSrc,
              remoteUrl: existing.remoteUrl || newItem.remoteUrl,
              id: existing.id,
              projectId: projectKey,
              timestamp: newItem.timestamp ?? existing.timestamp,
            };

            updated[existingIndex] = finalItem;

            // 异步写入 IndexedDB
            scheduleWrite(finalItem);

            return { history: updated };
          }

          finalItem = newItem;
          const updatedHistory = [newItem, ...state.history];
          if (updatedHistory.length > MAX_HISTORY_SIZE) {
            updatedHistory.length = MAX_HISTORY_SIZE;
          }

          // 异步写入 IndexedDB
          scheduleWrite(finalItem);

          return { history: updatedHistory };
        });
      },

      updateImage: (id, patch) => set((state) => {
        const updated = state.history.map((item) => {
          if (item.id !== id) return item;

          const newSrc = patch.src
            ? getStorageFriendlySrc({ src: patch.src, remoteUrl: patch.remoteUrl })
            : item.src;

          const updatedItem = {
            ...item,
            ...patch,
            src: newSrc || item.src,
            thumbnail: undefined,
            timestamp: patch.timestamp ?? item.timestamp
          };

          // 异步写入 IndexedDB
          scheduleWrite(updatedItem);

          return updatedItem;
        });
        return { history: updated };
      }),

      removeImage: (id) => {
        // 异步从 IndexedDB 删除
        idbDelete(STORE_NAME, id).catch((err) => {
          console.warn('[ImageHistory] 删除 IndexedDB 记录失败:', err);
        });

        set((state) => ({
          history: state.history.filter(item => item.id !== id)
        }));
      },

      clearHistory: () => {
        // 异步清空 IndexedDB
        idbClear(STORE_NAME).catch((err) => {
          console.warn('[ImageHistory] 清空 IndexedDB 失败:', err);
        });

        set({ history: [] });
      },

      getImagesByNode: (nodeId) => {
        const { history } = get();
        return history.filter(item => item.nodeId === nodeId);
      },

      getCurrentImage: (nodeId) => {
        const { history } = get();
        return history.find(item => item.nodeId === nodeId);
      },

      cleanupInvalidEntries: () => set((state) => {
        const validHistory = state.history.filter(item => {
          const hasValidUrl = item.src?.startsWith('http') || item.remoteUrl?.startsWith('http');
          if (!hasValidUrl) {
            // 异步从 IndexedDB 删除无效记录
            idbDelete(STORE_NAME, item.id).catch(() => {});
            console.log('🗑️ [ImageHistory] 清理无效条目:', item.id, item.title);
          }
          return hasValidUrl;
        });

        if (validHistory.length !== state.history.length) {
          console.log(`🧹 [ImageHistory] 清理了 ${state.history.length - validHistory.length} 条无效记录`);
        }

        return { history: validHistory };
      }),

      _hydrateFromIDB: async () => {
        if (get()._hydrated) return;

        try {
          // 检查是否需要从 localStorage 迁移
          if (!isMigrationDone(STORE_NAME) && isIndexedDBAvailable()) {
            const legacyData = await migrateFromLocalStorage();
            if (legacyData.length > 0) {
              // 写入 IndexedDB（仅持久化远程 URL，避免 base64 超配额）
              const persistableItems = legacyData
                .map(getPersistableHistoryItem)
                .filter(Boolean) as ImageHistoryItem[];
              await idbPutBatch(STORE_NAME, persistableItems);
              // 标记迁移完成
              markMigrationDone(STORE_NAME);
              // 清理 localStorage
              if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('image-history');
              }
              console.log('[ImageHistory] 迁移完成，已清理 localStorage');
            } else {
              markMigrationDone(STORE_NAME);
            }
          }

          // 从 IndexedDB 加载数据
          const items = await idbGetAll<ImageHistoryItem>(STORE_NAME);
          const sorted = items.sort((a, b) => b.timestamp - a.timestamp);

          set({
            history: sorted.slice(0, MAX_HISTORY_SIZE),
            _hydrated: true
          });

          // 延迟清理无效条目
          setTimeout(() => {
            get().cleanupInvalidEntries();
          }, 1000);

          console.log(`[ImageHistory] 从 IndexedDB 加载了 ${sorted.length} 条记录`);
        } catch (error) {
          console.warn('[ImageHistory] IndexedDB 加载失败:', error);
          set({ _hydrated: true });
        }
      }
    })
  )
);

// 自动初始化：在浏览器环境下自动从 IndexedDB 加载数据
if (typeof window !== 'undefined') {
  setTimeout(() => {
    useImageHistoryStore.getState()._hydrateFromIDB();
  }, 100);
}
