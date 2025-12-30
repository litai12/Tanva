import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Model3DFormat, Model3DCameraState } from '@/services/model3DUploadService';
import {
  STORE_NAMES,
  idbGetAll,
  idbPut,
  idbPutBatch,
  idbDelete,
  idbClear,
  idbEnforceLimit,
  isMigrationDone,
  markMigrationDone,
  isIndexedDBAvailable,
} from '@/services/indexedDBService';

export type PersonalAssetType = '2d' | '3d' | 'svg';

export interface PersonalLibraryBase {
  id: string;
  name: string;
  type: PersonalAssetType;
  url: string;
  thumbnail?: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalImageAsset extends PersonalLibraryBase {
  type: '2d';
  width?: number;
  height?: number;
}

export interface PersonalModelAsset extends PersonalLibraryBase {
  type: '3d';
  format: Model3DFormat;
  key?: string;
  path?: string;
  defaultScale?: { x: number; y: number; z: number };
  defaultRotation?: { x: number; y: number; z: number };
  camera?: Model3DCameraState;
}

export interface PersonalSvgAsset extends PersonalLibraryBase {
  type: 'svg';
  width?: number;
  height?: number;
  /** 原始SVG内容（用于编辑） */
  svgContent?: string;
}

export type PersonalLibraryAsset = PersonalImageAsset | PersonalModelAsset | PersonalSvgAsset;

type PersonalLibraryUpdate = Partial<Omit<PersonalLibraryAsset, 'type'>>;

export interface PersonalLibraryStore {
  assets: PersonalLibraryAsset[];
  _hydrated: boolean;
  setAssets: (assets: PersonalLibraryAsset[]) => void;
  mergeAssets: (assets: PersonalLibraryAsset[]) => void;
  addAsset: (asset: PersonalLibraryAsset) => void;
  updateAsset: (id: string, patch: PersonalLibraryUpdate) => void;
  removeAsset: (id: string) => void;
  clear: () => void;
  getAssetsByType: (type: PersonalAssetType) => PersonalLibraryAsset[];
  _hydrateFromIDB: () => Promise<void>;
}

const sortByUpdatedAt = (assets: PersonalLibraryAsset[]): PersonalLibraryAsset[] =>
  [...assets].sort((a, b) => b.updatedAt - a.updatedAt);

export const createPersonalAssetId = (prefix = 'asset'): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const isHeavyInlineString = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return true;
  // 兜底：避免把大块 base64 字符串写进 localStorage
  if (trimmed.length > 4096 && !/^https?:\/\//i.test(trimmed)) return true;
  return false;
};

const normalizeTimestamps = (asset: PersonalLibraryAsset): PersonalLibraryAsset => ({
  ...asset,
  createdAt: asset.createdAt ?? Date.now(),
  updatedAt: asset.updatedAt ?? Date.now(),
});

const mergeById = (
  existing: PersonalLibraryAsset[],
  incoming: PersonalLibraryAsset[]
): PersonalLibraryAsset[] => {
  const map = new Map<string, PersonalLibraryAsset>();
  existing.forEach((asset) => map.set(asset.id, asset));
  incoming.forEach((asset) => {
    const next = normalizeTimestamps(asset);
    const prev = map.get(next.id);
    if (!prev) {
      map.set(next.id, next);
      return;
    }
    map.set(next.id, {
      ...prev,
      ...next,
      createdAt: prev.createdAt ?? next.createdAt,
      updatedAt: Math.max(prev.updatedAt ?? 0, next.updatedAt ?? 0),
    });
  });
  return sortByUpdatedAt(Array.from(map.values()));
};

// IndexedDB 持久化辅助
const STORE_NAME = STORE_NAMES.PERSONAL_LIBRARY;
const MAX_ASSETS = 500;

// 防抖写入
let writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWrites = new Map<string, PersonalLibraryAsset>();

const flushPendingWrites = async () => {
  if (pendingWrites.size === 0) return;
  const items = Array.from(pendingWrites.values());
  pendingWrites.clear();
  await idbPutBatch(STORE_NAME, items);
  await idbEnforceLimit(STORE_NAME);
};

const scheduleWrite = (asset: PersonalLibraryAsset) => {
  pendingWrites.set(asset.id, asset);
  if (writeDebounceTimer) clearTimeout(writeDebounceTimer);
  writeDebounceTimer = setTimeout(flushPendingWrites, 300);
};

// 从 localStorage 迁移
const migrateFromLocalStorage = async (): Promise<PersonalLibraryAsset[]> => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('personal-library');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const assets = parsed?.state?.assets;
    if (!Array.isArray(assets) || assets.length === 0) return [];
    console.log(`[PersonalLibrary] 从 localStorage 迁移 ${assets.length} 条记录`);
    return assets as PersonalLibraryAsset[];
  } catch (error) {
    console.warn('[PersonalLibrary] 迁移数据解析失败:', error);
    return [];
  }
};

export const usePersonalLibraryStore = create<PersonalLibraryStore>()(
  subscribeWithSelector(
    (set, get) => ({
      assets: [],
      _hydrated: false,

      setAssets: (assets) => {
        const normalized = sortByUpdatedAt(assets.map(normalizeTimestamps));
        set({ assets: normalized });
        // 批量写入 IndexedDB
        normalized.forEach(scheduleWrite);
      },

      mergeAssets: (assets) => {
        set((state) => {
          const merged = mergeById(state.assets, assets);
          // 批量写入 IndexedDB
          merged.forEach(scheduleWrite);
          return { assets: merged };
        });
      },

      addAsset: (asset) => {
        set((state) => {
          const nextAsset = normalizeTimestamps(asset);
          const without = state.assets.filter((item) => item.id !== nextAsset.id);
          const newAssets = sortByUpdatedAt([nextAsset, ...without]);
          // 写入 IndexedDB
          scheduleWrite(nextAsset);
          return { assets: newAssets };
        });
      },
      updateAsset: (id, patch) => {
        set((state) => {
          const updated = state.assets.map((item) => {
            if (item.id !== id) return item;
            const updatedItem = {
              ...item,
              ...patch,
              updatedAt: patch.updatedAt ?? Date.now(),
            };
            scheduleWrite(updatedItem as PersonalLibraryAsset);
            return updatedItem;
          });
          return { assets: sortByUpdatedAt(updated) };
        });
      },

      removeAsset: (id) => {
        idbDelete(STORE_NAME, id).catch((err) => {
          console.warn('[PersonalLibrary] 删除失败:', err);
        });
        set((state) => ({
          assets: state.assets.filter((item) => item.id !== id),
        }));
      },

      clear: () => {
        idbClear(STORE_NAME).catch((err) => {
          console.warn('[PersonalLibrary] 清空失败:', err);
        });
        set({ assets: [] });
      },

      getAssetsByType: (type) => get().assets.filter((item) => item.type === type),

      _hydrateFromIDB: async () => {
        if (get()._hydrated) return;

        try {
          // 检查是否需要从 localStorage 迁移
          if (!isMigrationDone(STORE_NAME) && isIndexedDBAvailable()) {
            const legacyData = await migrateFromLocalStorage();
            if (legacyData.length > 0) {
              await idbPutBatch(STORE_NAME, legacyData);
              markMigrationDone(STORE_NAME);
              if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('personal-library');
              }
              console.log('[PersonalLibrary] 迁移完成');
            } else {
              markMigrationDone(STORE_NAME);
            }
          }

          // 从 IndexedDB 加载
          const items = await idbGetAll<PersonalLibraryAsset>(STORE_NAME);
          const sorted = sortByUpdatedAt(items);

          set({
            assets: sorted.slice(0, MAX_ASSETS),
            _hydrated: true
          });

          console.log(`[PersonalLibrary] 加载了 ${sorted.length} 条记录`);
        } catch (error) {
          console.warn('[PersonalLibrary] 加载失败:', error);
          set({ _hydrated: true });
        }
      }
    })
  )
);

// 自动初始化
if (typeof window !== 'undefined') {
  setTimeout(() => {
    usePersonalLibraryStore.getState()._hydrateFromIDB();
  }, 150);
}
