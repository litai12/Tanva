import type { StateStorage } from 'zustand/middleware';

type StorageFactory = () => StateStorage;

const createMemoryStorage = (): StateStorage => {
  const store = new Map<string, string>();
  return {
    getItem: (name) => {
      return store.has(name) ? store.get(name)! : null;
    },
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    }
  };
};

const wrapLocalStorage = (storage: Storage, label: string, fallback: StateStorage): StateStorage => ({
  getItem: (name) => {
    try {
      const value = storage.getItem(name);
      if (value === null) {
        return fallback.getItem(name);
      }
      return value;
    } catch (error) {
      console.warn(`[persist] 读取 ${name} (${label}) 失败，使用内存缓存`, error);
      return fallback.getItem(name);
    }
  },
  setItem: (name, value) => {
    try {
      storage.setItem(name, value);
    } catch (error) {
      console.warn(`[persist] 写入 ${name} (${label}) 失败，使用内存缓存`, error);
      fallback.setItem(name, value);
    }
  },
  removeItem: (name) => {
    try {
      storage.removeItem(name);
    } catch (error) {
      console.warn(`[persist] 删除 ${name} (${label}) 失败`, error);
      fallback.removeItem(name);
    }
  }
});

export const createSafeStorage: (label: string) => StorageFactory = (label: string) => {
  const fallback = createMemoryStorage();

  return () => {
    if (typeof window === 'undefined') {
      return fallback;
    }

    try {
      const storage = window.localStorage;
      return wrapLocalStorage(storage, label, fallback);
    } catch (error) {
      console.warn(`[persist] localStorage 不可用 (${label})，使用内存缓存`, error);
      return fallback;
    }
  };
};

