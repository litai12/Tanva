import { create } from 'zustand';
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware';
import { createSafeStorage } from './storageUtils';
import type { Model3DFormat, Model3DCameraState } from '@/services/model3DUploadService';

export type PersonalAssetType = '2d' | '3d';

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

export type PersonalLibraryAsset = PersonalImageAsset | PersonalModelAsset;

type PersonalLibraryUpdate = Partial<Omit<PersonalLibraryAsset, 'type'>>;

export interface PersonalLibraryStore {
  assets: PersonalLibraryAsset[];
  setAssets: (assets: PersonalLibraryAsset[]) => void;
  mergeAssets: (assets: PersonalLibraryAsset[]) => void;
  addAsset: (asset: PersonalLibraryAsset) => void;
  updateAsset: (id: string, patch: PersonalLibraryUpdate) => void;
  removeAsset: (id: string) => void;
  clear: () => void;
  getAssetsByType: (type: PersonalAssetType) => PersonalLibraryAsset[];
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

export const usePersonalLibraryStore = create<PersonalLibraryStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        assets: [],
        setAssets: (assets) =>
          set(() => ({
            assets: sortByUpdatedAt(assets.map(normalizeTimestamps)),
          })),
        mergeAssets: (assets) =>
          set((state) => ({
            assets: mergeById(state.assets, assets),
          })),
        addAsset: (asset) =>
          set((state) => {
            const nextAsset = normalizeTimestamps(asset);
            const without = state.assets.filter((item) => item.id !== nextAsset.id);
            return {
              assets: sortByUpdatedAt([nextAsset, ...without]),
            };
          }),
        updateAsset: (id, patch) =>
          set((state) => ({
            assets: sortByUpdatedAt(
              state.assets.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      ...patch,
                      updatedAt: patch.updatedAt ?? Date.now(),
                    }
                  : item
              )
            ),
          })),
        removeAsset: (id) =>
          set((state) => ({
            assets: state.assets.filter((item) => item.id !== id),
          })),
        clear: () => set({ assets: [] }),
        getAssetsByType: (type) => get().assets.filter((item) => item.type === type),
      }),
      {
        name: 'personal-library',
        storage: createJSONStorage<Partial<PersonalLibraryStore>>(() =>
          createSafeStorage({ storageName: 'personal-library' })
        ),
        partialize: (state) => ({
          assets: state.assets
            .map((asset) => {
              const next: any = { ...asset };
              if (isHeavyInlineString(next.thumbnail)) {
                delete next.thumbnail;
              }
              // data/blob URL 刷新后不可用且可能很大，避免持久化无效引用
              if (
                typeof next.url === 'string' &&
                isHeavyInlineString(next.url) &&
                !/^https?:\/\//i.test(next.url.trim())
              ) {
                return null;
              }
              return next as PersonalLibraryAsset;
            })
            .filter(Boolean) as PersonalLibraryAsset[],
        }),
      }
    )
  )
);
