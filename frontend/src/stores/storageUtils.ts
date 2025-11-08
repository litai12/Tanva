import type { StateStorage } from 'zustand/middleware';

interface SafeStorageOptions {
  /**
   * 名称用于调试日志，便于区分不同 store
   */
  storageName?: string;
  /**
   * 当写入值与上次相同时是否跳过写入（默认 true）
   */
  skipIfUnchanged?: boolean;
}

const globalMemoryFallback = new Map<string, string>();
const globalLastWritten = new Map<string, string>();
const warnedQuota = new Set<string>();

const isQuotaExceeded = (error: unknown): boolean => {
  if (!error) return false;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.code === 22;
  }
  const message = (error as Error)?.message ?? '';
  return message.includes('QuotaExceeded');
};

/**
 * 创建一个具备容错能力的 storage，优先使用 localStorage，
 * 当遇到配额限制或访问失败时自动降级到内存 Map，
 * 并可跳过重复写入以减少高频 setItem。
 */
export const createSafeStorage = (options?: SafeStorageOptions): StateStorage => {
  const storageName = options?.storageName ?? 'zustand-storage';
  const skipIfUnchanged = options?.skipIfUnchanged !== false;
  const pendingWrites = new Map<string, string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lifecycleBound = false;

  const getFromLocalStorage = (key: string): string | null => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      if (!warnedQuota.has(storageName)) {
        console.warn(`[storage:${storageName}] 读取 localStorage 失败，已使用内存回退:`, error);
        warnedQuota.add(storageName);
      }
      return null;
    }
  };

  const setToLocalStorage = (key: string, value: string) => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      if (isQuotaExceeded(error) && !warnedQuota.has(storageName)) {
        console.warn(`[storage:${storageName}] localStorage 配额已满，已切换为内存存储以继续运行。`);
        warnedQuota.add(storageName);
      } else if (!warnedQuota.has(storageName)) {
        console.warn(`[storage:${storageName}] 写入 localStorage 失败，已使用内存回退:`, error);
        warnedQuota.add(storageName);
      }
      throw error;
    }
  };

  const flushPending = () => {
    if (!pendingWrites.size) {
      return;
    }

    const entries = Array.from(pendingWrites.entries());
    pendingWrites.clear();
    flushTimer = null;

    for (const [key, value] of entries) {
      try {
        setToLocalStorage(key, value);
      } catch {
        // 失败时保持内存回退
      } finally {
        globalMemoryFallback.set(key, value);
        globalLastWritten.set(key, value);
      }
    }
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) {
      return;
    }
    flushTimer = setTimeout(flushPending, 150);

    if (
      !lifecycleBound &&
      typeof window !== 'undefined' &&
      typeof document !== 'undefined'
    ) {
      lifecycleBound = true;
      const handleVisibility = () => {
        if (document.visibilityState === 'hidden') {
          flushPending();
        }
      };
      const handleBeforeUnload = () => {
        flushPending();
      };
      window.addEventListener('visibilitychange', handleVisibility);
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
  };

  return {
    getItem: (key) => {
      const localValue = getFromLocalStorage(key);
      if (localValue !== null) {
        globalMemoryFallback.set(key, localValue);
        globalLastWritten.set(key, localValue);
        return localValue;
      }
      return globalMemoryFallback.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (skipIfUnchanged) {
        const previousPending = pendingWrites.get(key);
        if (previousPending === value) {
          return;
        }
        const previous = globalLastWritten.get(key);
        if (previous === value) {
          return;
        }
      }

      pendingWrites.set(key, value);
      globalMemoryFallback.set(key, value);
      globalLastWritten.set(key, value);
      scheduleFlush();
    },
    removeItem: (key) => {
      pendingWrites.delete(key);
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.removeItem(key);
        } catch (error) {
          if (!warnedQuota.has(storageName)) {
            console.warn(`[storage:${storageName}] 删除 localStorage 失败，已在内存中清理:`, error);
            warnedQuota.add(storageName);
          }
        }
      }
      globalMemoryFallback.delete(key);
      globalLastWritten.delete(key);
    }
  };
};
