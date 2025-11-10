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

export const usePersonalLibraryStore = create<PersonalLibraryStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        assets: [],
        addAsset: (asset) =>
          set((state) => {
            const nextAsset: PersonalLibraryAsset = {
              ...asset,
              createdAt: asset.createdAt ?? Date.now(),
              updatedAt: asset.updatedAt ?? Date.now(),
            };
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
          assets: state.assets,
        }),
      }
    )
  )
);
