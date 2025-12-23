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
  nodeType: 'generate' | 'generatePro' | 'generatePro4' | 'image' | '3d' | 'camera';
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
  // 新增：清理无效的历史记录（没有有效 URL 的记录）
  cleanupInvalidEntries: () => void;
}

// 最大历史记录数量
const MAX_HISTORY_SIZE = 50;

export const useImageHistoryStore = create<ImageHistoryStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        history: [],

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
              thumbnail: undefined, // 不再存储 thumbnail，节省内存
              projectId: projectKey,
              timestamp: item.timestamp ?? Date.now(),
            };

            // 先按同 projectId + 同源链接去重，避免同一张图出现多条
            const existingIndex = state.history.findIndex((existing) => {
              const existingProject = existing.projectId ?? null;
              if (existingProject !== projectKey) return false;
              return getCanonicalSrc(existing) === canonicalSrc;
            });

            if (existingIndex >= 0) {
              const updated = [...state.history];
              const existing = updated[existingIndex];

              // 如果现有记录有 URL 而新记录是 dataURL（内存态），保留现有 URL
              const shouldKeepExistingSrc =
                existing.src?.startsWith('http') && !storageSrc.startsWith('http');

              updated[existingIndex] = {
                ...existing,
                ...newItem,
                src: shouldKeepExistingSrc ? existing.src : storageSrc,
                remoteUrl: existing.remoteUrl || newItem.remoteUrl,
                id: existing.id, // 保留原有id，避免 key 抖动
                projectId: projectKey,
                timestamp: newItem.timestamp ?? existing.timestamp,
              };
              return { history: updated };
            }

            const updatedHistory = [newItem, ...state.history];
            if (updatedHistory.length > MAX_HISTORY_SIZE) {
              updatedHistory.length = MAX_HISTORY_SIZE;
            }
            return { history: updatedHistory };
          });
        },

        updateImage: (id, patch) => set((state) => {
          const updated = state.history.map((item) => {
            if (item.id !== id) return item;

            // 内存优化：更新时也确保使用 URL 而非 base64
            const newSrc = patch.src ? getStorageFriendlySrc({ src: patch.src, remoteUrl: patch.remoteUrl }) : item.src;

            return {
              ...item,
              ...patch,
              src: newSrc || item.src,
              thumbnail: undefined, // 不存储 thumbnail
              timestamp: patch.timestamp ?? item.timestamp
            };
          });
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
        },

        // 清理无效条目（没有有效 URL 的记录）
        cleanupInvalidEntries: () => set((state) => {
          const validHistory = state.history.filter(item => {
            // 只保留有有效 URL 的记录
            const hasValidUrl = item.src?.startsWith('http') || item.remoteUrl?.startsWith('http');
            if (!hasValidUrl) {
              console.log('🗑️ [ImageHistory] 清理无效条目:', item.id, item.title);
            }
            return hasValidUrl;
          });

          if (validHistory.length !== state.history.length) {
            console.log(`🧹 [ImageHistory] 清理了 ${state.history.length - validHistory.length} 条无效记录`);
          }

          return { history: validHistory };
        })
      }),
      {
        name: 'image-history',
        storage: createJSONStorage<Partial<ImageHistoryStore>>(() => createSafeStorage({ storageName: 'image-history' })),
        partialize: (state) => ({
          // 只持久化有有效 URL 的记录，避免存储 base64
          history: state.history.filter(item =>
            item.src?.startsWith('http') || item.remoteUrl?.startsWith('http')
          ).map(item => ({
            ...item,
            thumbnail: undefined // 确保不存储 thumbnail
          }))
        }) as Partial<ImageHistoryStore>,
        // 加载时清理无效数据
        onRehydrateStorage: () => (state) => {
          if (state) {
            // 延迟清理，确保 store 已初始化
            setTimeout(() => {
              state.cleanupInvalidEntries();
            }, 1000);
          }
        }
      }
    )
  )
);
