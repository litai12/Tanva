/**
 * 统一的 IndexedDB 存储服务
 * 提供与 Zustand StateStorage 接口兼容的 IndexedDB 适配器
 * 使用同步缓存层 + 异步后台更新机制
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { StateStorage } from 'zustand/middleware';

const DB_NAME = 'tanva_storage';
const DB_VERSION = 1;
const STORE_NAME = 'zustand_storage';

interface StorageRecord {
  key: string;
  value: string;
  updatedAt: number;
}

// 全局数据库连接缓存（按数据库名称）
const dbPromises = new Map<string, Promise<IDBPDatabase>>();

/**
 * 打开或获取 IndexedDB 数据库连接
 */
function getDB(dbName: string = DB_NAME, storeName: string = STORE_NAME): Promise<IDBPDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not available'));
  }

  const cacheKey = `${dbName}:${storeName}`;
  let dbPromise = dbPromises.get(cacheKey);

  if (!dbPromise) {
    dbPromise = openDB(dbName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'key' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      },
    });
    dbPromises.set(cacheKey, dbPromise);
  }

  return dbPromise;
}

/**
 * 检查 IndexedDB 是否可用
 */
function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * 创建 IndexedDB 版本的 StateStorage
 * 
 * 注意：由于 Zustand 的 StateStorage 接口是同步的，但 IndexedDB 是异步的，
 * 我们使用同步内存缓存 + 异步后台更新的策略。
 */
export function createIndexedDBStorage(options: {
  dbName?: string;
  storeName?: string;
  storageName?: string;
}): StateStorage {
  const storageName = options.storageName ?? 'indexeddb-storage';
  const dbName = options.dbName ?? DB_NAME;
  const storeName = options.storeName ?? STORE_NAME;

  // 同步内存缓存（用于立即读取）
  const syncCache = new Map<string, string>();
  // 待写入队列（用于批量异步写入）
  const pendingWrites = new Map<string, string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;

  // 初始化：从 IndexedDB 加载所有数据到内存缓存
  const initialize = async (): Promise<void> => {
    if (isInitialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        if (!isIndexedDBAvailable()) {
          console.warn(`[storage:${storageName}] IndexedDB 不可用`);
          isInitialized = true;
          return;
        }

        const db = await getDB(dbName, storeName);
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const allRecords = await store.getAll();

        for (const record of allRecords) {
          if (record && typeof record === 'object' && 'key' in record && 'value' in record) {
            syncCache.set(record.key, record.value);
          }
        }

        isInitialized = true;
      } catch (error) {
        console.warn(`[storage:${storageName}] 初始化失败:`, error);
        isInitialized = true; // 即使失败也标记为已初始化，避免重复尝试
      }
    })();

    return initPromise;
  };

  // 异步刷新待写入队列
  const flushPending = async (): Promise<void> => {
    if (pendingWrites.size === 0) return;

    const entries = Array.from(pendingWrites.entries());
    pendingWrites.clear();
    flushTimer = null;

    if (!isIndexedDBAvailable()) {
      return;
    }

    try {
      const db = await getDB(dbName, storeName);
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      for (const [key, value] of entries) {
        const record: StorageRecord = {
          key,
          value,
          updatedAt: Date.now(),
        };
        await store.put(record);
      }

      await tx.done;
    } catch (error) {
      console.warn(`[storage:${storageName}] 批量写入失败:`, error);
      // 写入失败时，数据仍在内存缓存中，不会丢失
    }
  };

  // 调度刷新（防抖）
  const scheduleFlush = () => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushPending().catch(console.error);
    }, 150);

    // 页面卸载时立即刷新
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const handleBeforeUnload = () => {
        if (pendingWrites.size > 0) {
          // 使用同步方式尝试最后一次写入（可能不完整，但尽力而为）
          flushPending().catch(() => {});
        }
      };
      window.addEventListener('beforeunload', handleBeforeUnload, { once: true });
    }
  };

  // 确保初始化（同步触发，异步执行）
  if (typeof window !== 'undefined') {
    initialize().catch(console.error);
  }

  return {
    getItem: (key: string): string | null => {
      // 如果已初始化，直接从内存缓存读取
      if (isInitialized) {
        return syncCache.get(key) ?? null;
      }

      // 如果未初始化，尝试同步从 localStorage 读取（向后兼容）
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          const value = window.localStorage.getItem(key);
          if (value !== null) {
            syncCache.set(key, value);
            return value;
          }
        } catch (error) {
          // localStorage 可能不可用
        }
      }

      // 如果内存缓存中有，返回它
      return syncCache.get(key) ?? null;
    },

    setItem: (key: string, value: string): void => {
      // 立即更新内存缓存（同步）
      syncCache.set(key, value);
      pendingWrites.set(key, value);

      // 异步写入 IndexedDB
      scheduleFlush();

      // 如果 IndexedDB 不可用，尝试写入 localStorage（降级）
      if (!isIndexedDBAvailable() && typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(key, value);
        } catch (error) {
          // localStorage 也可能失败，但数据已在内存中
        }
      }
    },

    removeItem: (key: string): void => {
      // 从内存缓存删除
      syncCache.delete(key);
      pendingWrites.delete(key);

      // 异步从 IndexedDB 删除
      if (isIndexedDBAvailable()) {
        getDB(dbName, storeName)
          .then(async (db) => {
            const tx = db.transaction(storeName, 'readwrite');
            await tx.objectStore(storeName).delete(key);
            await tx.done;
          })
          .catch((error) => {
            console.warn(`[storage:${storageName}] 删除失败:`, error);
          });
      }

      // 从 localStorage 删除（如果存在）
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.removeItem(key);
        } catch (error) {
          // 忽略错误
        }
      }
    },
  };
}

/**
 * 数据迁移：从 localStorage 迁移到 IndexedDB
 */
export async function migrateFromLocalStorage(
  localStorageKey: string,
  storageName?: string
): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  if (!isIndexedDBAvailable()) {
    console.warn(`[migration] IndexedDB 不可用，跳过迁移 ${localStorageKey}`);
    return;
  }

  try {
    const value = window.localStorage.getItem(localStorageKey);
    if (value === null) {
      return; // 没有数据需要迁移
    }

    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record: StorageRecord = {
      key: localStorageKey,
      value,
      updatedAt: Date.now(),
    };

    await store.put(record);
    await tx.done;

    // 迁移成功后，从 localStorage 删除（可选，保留作为备份）
    // window.localStorage.removeItem(localStorageKey);

    console.log(`[migration] 成功迁移 ${localStorageKey} 到 IndexedDB`);
  } catch (error) {
    console.warn(`[migration] 迁移 ${localStorageKey} 失败:`, error);
  }
}

/**
 * 批量迁移多个 localStorage key
 */
export async function migrateMultipleFromLocalStorage(
  keys: string[],
  storageName?: string
): Promise<void> {
  for (const key of keys) {
    await migrateFromLocalStorage(key, storageName);
  }
}

/**
 * 清理过期的存储记录
 */
export async function cleanupExpiredRecords(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
  if (!isIndexedDBAvailable()) {
    return;
  }

  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('updatedAt');

    const cutoff = Date.now() - maxAge;
    const range = IDBKeyRange.upperBound(cutoff);
    const records = await index.getAll(range);

    for (const record of records) {
      await store.delete(record.key);
    }

    await tx.done;
    console.log(`[cleanup] 清理了 ${records.length} 条过期记录`);
  } catch (error) {
    console.warn('[cleanup] 清理失败:', error);
  }
}

/**
 * 获取存储使用情况（估算）
 */
export async function getStorageUsage(): Promise<{
  recordCount: number;
  estimatedSize: number;
}> {
  if (!isIndexedDBAvailable()) {
    return { recordCount: 0, estimatedSize: 0 };
  }

  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const allRecords = await store.getAll();

    let totalSize = 0;
    for (const record of allRecords) {
      if (record && typeof record === 'object' && 'value' in record) {
        // 估算：每个字符约 2 字节（UTF-16），加上对象开销
        totalSize += (record.value?.length ?? 0) * 2 + 100; // 100 字节对象开销估算
      }
    }

    return {
      recordCount: allRecords.length,
      estimatedSize: totalSize,
    };
  } catch (error) {
    console.warn('[storage] 获取使用情况失败:', error);
    return { recordCount: 0, estimatedSize: 0 };
  }
}

