/**
 * 统一的 IndexedDB 存储服务
 * 提供连接池管理、自动降级、LRU 清理等功能
 */

const DB_NAME = 'tanva_unified_storage';
const DB_VERSION = 2;

// Store 配置
export const STORE_NAMES = {
  IMAGE_HISTORY: 'imageHistory',
  PERSONAL_LIBRARY: 'personalLibrary',
  AI_CHAT_SESSIONS: 'aiChatSessions',
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

// 每个 store 的最大记录数
const MAX_ENTRIES: Record<StoreName, number> = {
  [STORE_NAMES.IMAGE_HISTORY]: 50,
  [STORE_NAMES.PERSONAL_LIBRARY]: 500,
  [STORE_NAMES.AI_CHAT_SESSIONS]: 50,
};

// LRU 清理所用的索引名
const LRU_INDEX_NAMES: Record<StoreName, string> = {
  [STORE_NAMES.IMAGE_HISTORY]: 'timestamp',
  [STORE_NAMES.PERSONAL_LIBRARY]: 'updatedAt',
  [STORE_NAMES.AI_CHAT_SESSIONS]: 'updatedAt',
};

// 连接池
let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
let isClosing = false;

// 降级标记
let idbAvailable = true;
const memoryFallback = new Map<string, Map<string, unknown>>();

/**
 * 检查 IndexedDB 是否可用
 */
function checkIndexedDBAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof indexedDB === 'undefined') return false;
  return true;
}

/**
 * 打开数据库连接
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!checkIndexedDBAvailable()) {
      idbAvailable = false;
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 创建 imageHistory store
      if (!db.objectStoreNames.contains(STORE_NAMES.IMAGE_HISTORY)) {
        const imageStore = db.createObjectStore(STORE_NAMES.IMAGE_HISTORY, {
          keyPath: 'id'
        });
        imageStore.createIndex('timestamp', 'timestamp', { unique: false });
        imageStore.createIndex('nodeId', 'nodeId', { unique: false });
        imageStore.createIndex('projectId', 'projectId', { unique: false });
      }

      // 创建 personalLibrary store
      if (!db.objectStoreNames.contains(STORE_NAMES.PERSONAL_LIBRARY)) {
        const libraryStore = db.createObjectStore(STORE_NAMES.PERSONAL_LIBRARY, {
          keyPath: 'id'
        });
        libraryStore.createIndex('type', 'type', { unique: false });
        libraryStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 创建 aiChatSessions store
      if (!db.objectStoreNames.contains(STORE_NAMES.AI_CHAT_SESSIONS)) {
        const chatStore = db.createObjectStore(STORE_NAMES.AI_CHAT_SESSIONS, {
          keyPath: 'id'
        });
        chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      // 监听连接关闭
      db.onclose = () => {
        if (!isClosing) {
          console.warn('[IndexedDB] 连接意外关闭，将在下次操作时重连');
          dbInstance = null;
          dbPromise = null;
        }
      };

      db.onerror = (event) => {
        console.error('[IndexedDB] 数据库错误:', event);
      };

      resolve(db);
    };

    request.onerror = () => {
      idbAvailable = false;
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn('[IndexedDB] 数据库被阻塞，可能有其他标签页正在升级');
    };
  });
}

/**
 * 获取数据库连接（连接池）
 */
async function getDB(): Promise<IDBDatabase> {
  if (dbInstance && !isClosing) {
    return dbInstance;
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = openDatabase();

  try {
    dbInstance = await dbPromise;
    return dbInstance;
  } catch (error) {
    dbPromise = null;
    throw error;
  }
}

/**
 * 关闭数据库连接
 */
export function closeDB(): void {
  if (dbInstance) {
    isClosing = true;
    dbInstance.close();
    dbInstance = null;
    dbPromise = null;
    isClosing = false;
  }
}

/**
 * 获取内存降级存储
 */
function getMemoryStore(storeName: StoreName): Map<string, unknown> {
  if (!memoryFallback.has(storeName)) {
    memoryFallback.set(storeName, new Map());
  }
  return memoryFallback.get(storeName)!;
}

// ==================== 核心 CRUD 操作 ====================

/**
 * 获取单条记录
 */
export async function idbGet<T>(
  storeName: StoreName,
  key: string
): Promise<T | null> {
  // 降级到内存
  if (!idbAvailable) {
    const store = getMemoryStore(storeName);
    return (store.get(key) as T) ?? null;
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`[IndexedDB] 读取失败，降级到内存:`, error);
    const store = getMemoryStore(storeName);
    return (store.get(key) as T) ?? null;
  }
}

/**
 * 获取所有记录
 */
export async function idbGetAll<T>(storeName: StoreName): Promise<T[]> {
  // 降级到内存
  if (!idbAvailable) {
    const store = getMemoryStore(storeName);
    return Array.from(store.values()) as T[];
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`[IndexedDB] 读取全部失败，降级到内存:`, error);
    const store = getMemoryStore(storeName);
    return Array.from(store.values()) as T[];
  }
}

/**
 * 写入单条记录
 */
export async function idbPut<T extends { id: string }>(
  storeName: StoreName,
  data: T
): Promise<void> {
  // 降级到内存
  if (!idbAvailable) {
    const store = getMemoryStore(storeName);
    store.set(data.id, data);
    return;
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`[IndexedDB] 写入失败，降级到内存:`, error);
    const store = getMemoryStore(storeName);
    store.set(data.id, data);
  }
}

/**
 * 批量写入记录
 */
export async function idbPutBatch<T extends { id: string }>(
  storeName: StoreName,
  items: T[]
): Promise<void> {
  if (items.length === 0) return;

  // 降级到内存
  if (!idbAvailable) {
    const store = getMemoryStore(storeName);
    items.forEach(item => store.set(item.id, item));
    return;
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);

      items.forEach(item => store.put(item));
    });
  } catch (error) {
    console.warn(`[IndexedDB] 批量写入失败，降级到内存:`, error);
    const store = getMemoryStore(storeName);
    items.forEach(item => store.set(item.id, item));
  }
}

/**
 * 删除单条记录
 */
export async function idbDelete(
  storeName: StoreName,
  key: string
): Promise<void> {
  // 降级到内存
  if (!idbAvailable) {
    const store = getMemoryStore(storeName);
    store.delete(key);
    return;
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`[IndexedDB] 删除失败:`, error);
    const store = getMemoryStore(storeName);
    store.delete(key);
  }
}

/**
 * 清空整个 store
 */
export async function idbClear(storeName: StoreName): Promise<void> {
  // 降级到内存
  if (!idbAvailable) {
    const store = getMemoryStore(storeName);
    store.clear();
    return;
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`[IndexedDB] 清空失败:`, error);
    const store = getMemoryStore(storeName);
    store.clear();
  }
}

/**
 * 获取记录数量
 */
export async function idbCount(storeName: StoreName): Promise<number> {
  if (!idbAvailable) {
    return getMemoryStore(storeName).size;
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`[IndexedDB] 计数失败:`, error);
    return getMemoryStore(storeName).size;
  }
}

// ==================== LRU 清理 ====================

/**
 * 按时间戳删除最旧的记录（LRU 清理）
 */
export async function idbDeleteOldest(
  storeName: StoreName,
  deleteCount: number,
  indexName: string = 'timestamp'
): Promise<void> {
  if (!idbAvailable || deleteCount <= 0) return;

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);

      // 按时间戳升序遍历（最旧的在前）
      const request = index.openCursor();
      let deleted = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && deleted < deleteCount) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn(`[IndexedDB] LRU 清理失败:`, error);
  }
}

/**
 * 强制执行记录数量限制
 */
export async function idbEnforceLimit(storeName: StoreName): Promise<void> {
  const maxEntries = MAX_ENTRIES[storeName];
  if (!maxEntries) return;

  const count = await idbCount(storeName);
  if (count > maxEntries) {
    const deleteCount = count - maxEntries;
    console.log(`[IndexedDB] ${storeName} 超出限制，清理 ${deleteCount} 条旧记录`);
    const indexName = LRU_INDEX_NAMES[storeName] ?? 'timestamp';
    await idbDeleteOldest(storeName, deleteCount, indexName);
  }
}

// ==================== 索引查询 ====================

/**
 * 通过索引查询记录
 */
export async function idbGetByIndex<T>(
  storeName: StoreName,
  indexName: string,
  value: IDBValidKey
): Promise<T[]> {
  if (!idbAvailable) {
    return [];
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);

      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn(`[IndexedDB] 索引查询失败:`, error);
    return [];
  }
}

// ==================== 数据迁移 ====================

const MIGRATION_KEY_PREFIX = 'tanva_idb_migrated_';

/**
 * 检查是否已完成迁移
 */
export function isMigrationDone(storeName: StoreName): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(MIGRATION_KEY_PREFIX + storeName) === 'true';
}

/**
 * 标记迁移完成
 */
export function markMigrationDone(storeName: StoreName): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(MIGRATION_KEY_PREFIX + storeName, 'true');
}

/**
 * 检查 IndexedDB 是否可用
 */
export function isIndexedDBAvailable(): boolean {
  return idbAvailable && checkIndexedDBAvailable();
}
