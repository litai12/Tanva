/**
 * Base64 缓存管理服务
 * 实现 LRU 淘汰机制，将 Base64 数据持久化到 IndexedDB
 */

// ============ 配置常量 ============
const MAX_MEMORY_CACHE_SIZE = 50 * 1024 * 1024;  // 内存缓存上限 50MB
const MAX_MEMORY_ENTRIES = 20;                    // 内存最多保留 20 条
const IDB_STORE_NAME = 'base64Cache';
const IDB_MAX_ENTRIES = 100;                      // IndexedDB 最多 100 条

// ============ 类型定义 ============
interface Base64CacheEntry {
  id: string;                    // 图片唯一标识
  base64: string;                // Base64 数据
  size: number;                  // 数据大小（字节）
  lastAccess: number;            // 最后访问时间戳
  remoteUrl?: string;            // 对应的远程 URL（用于重新获取）
  projectId?: string | null;     // 项目 ID
}

// ============ IndexedDB 操作（独立实现，避免循环依赖） ============
const DB_NAME = 'tanva_base64_cache';
const DB_VERSION = 1;

let cacheDbInstance: IDBDatabase | null = null;
let cacheDbPromise: Promise<IDBDatabase> | null = null;
let idbAvailable = true;

function openCacheDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      idbAvailable = false;
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        const store = db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' });
        store.createIndex('lastAccess', 'lastAccess', { unique: false });
        store.createIndex('projectId', 'projectId', { unique: false });
        store.createIndex('size', 'size', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      idbAvailable = false;
      reject(request.error);
    };
  });
}

async function getCacheDB(): Promise<IDBDatabase> {
  if (cacheDbInstance) return cacheDbInstance;
  if (cacheDbPromise) return cacheDbPromise;

  cacheDbPromise = openCacheDatabase();
  try {
    cacheDbInstance = await cacheDbPromise;
    return cacheDbInstance;
  } catch (error) {
    cacheDbPromise = null;
    throw error;
  }
}

// ============ Base64CacheService 类 ============
class Base64CacheService {
  private memoryCache: Map<string, Base64CacheEntry> = new Map();
  private totalMemorySize: number = 0;
  private accessOrder: string[] = [];  // LRU 访问顺序队列

  /**
   * 获取 Base64 数据
   * 优先级：内存 -> IndexedDB -> 远程 URL
   */
  async getBase64(id: string, fallbackUrl?: string): Promise<string | null> {
    // 1. 检查内存缓存
    const memEntry = this.memoryCache.get(id);
    if (memEntry) {
      this.updateAccessOrder(id);
      memEntry.lastAccess = Date.now();
      return memEntry.base64;
    }

    // 2. 检查 IndexedDB
    const idbEntry = await this.getFromIDB(id);
    if (idbEntry) {
      // 加载到内存（可能触发 LRU 淘汰）
      await this.loadToMemory(idbEntry);
      return idbEntry.base64;
    }

    // 3. 从远程 URL 获取
    if (fallbackUrl && /^https?:\/\//i.test(fallbackUrl)) {
      try {
        const dataUrl = await this.fetchFromUrl(fallbackUrl);
        if (dataUrl) {
          await this.setBase64(id, dataUrl, { remoteUrl: fallbackUrl });
          return dataUrl;
        }
      } catch (error) {
        console.warn('[Base64Cache] 从 URL 获取失败:', error);
      }
    }

    return null;
  }

  /**
   * 存储 Base64 数据
   */
  async setBase64(id: string, base64: string, options?: {
    remoteUrl?: string;
    projectId?: string | null;
  }): Promise<void> {
    const size = base64.length;

    const entry: Base64CacheEntry = {
      id,
      base64,
      size,
      lastAccess: Date.now(),
      remoteUrl: options?.remoteUrl,
      projectId: options?.projectId,
    };

    // 写入内存
    const existingEntry = this.memoryCache.get(id);
    if (existingEntry) {
      this.totalMemorySize -= existingEntry.size;
    }

    this.memoryCache.set(id, entry);
    this.totalMemorySize += size;
    this.updateAccessOrder(id);

    // 异步写入 IndexedDB
    this.persistToIDB(entry).catch(err => {
      console.warn('[Base64Cache] 写入 IndexedDB 失败:', err);
    });

    // 检查是否需要 LRU 淘汰
    await this.evictFromMemory();
  }

  /**
   * 检查是否存在缓存
   */
  has(id: string): boolean {
    return this.memoryCache.has(id);
  }

  /**
   * 从内存中移除（保留 IndexedDB）
   */
  evictFromMemoryOnly(id: string): void {
    const entry = this.memoryCache.get(id);
    if (entry) {
      this.totalMemorySize -= entry.size;
      this.memoryCache.delete(id);
      const index = this.accessOrder.indexOf(id);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
    }
  }

  /**
   * 完全删除（内存 + IndexedDB）
   */
  async remove(id: string): Promise<void> {
    this.evictFromMemoryOnly(id);
    await this.deleteFromIDB(id);
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    this.totalMemorySize = 0;
    this.accessOrder = [];
    await this.clearIDB();
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    memorySize: number;
    memorySizeMB: string;
    memoryCount: number;
    maxMemorySize: number;
    maxMemoryEntries: number;
  } {
    return {
      memorySize: this.totalMemorySize,
      memorySizeMB: (this.totalMemorySize / (1024 * 1024)).toFixed(2),
      memoryCount: this.memoryCache.size,
      maxMemorySize: MAX_MEMORY_CACHE_SIZE,
      maxMemoryEntries: MAX_MEMORY_ENTRIES,
    };
  }

  // ============ 私有方法 ============

  /**
   * 更新 LRU 访问顺序
   */
  private updateAccessOrder(id: string): void {
    const index = this.accessOrder.indexOf(id);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(id);
  }

  /**
   * LRU 淘汰：当内存超限时，将最久未访问的条目移到 IndexedDB
   */
  private async evictFromMemory(): Promise<void> {
    while (
      this.totalMemorySize > MAX_MEMORY_CACHE_SIZE ||
      this.memoryCache.size > MAX_MEMORY_ENTRIES
    ) {
      const oldestId = this.accessOrder.shift();
      if (!oldestId) break;

      const entry = this.memoryCache.get(oldestId);
      if (!entry) continue;

      // 确保已写入 IndexedDB
      await this.persistToIDB(entry);

      // 从内存移除
      this.memoryCache.delete(oldestId);
      this.totalMemorySize -= entry.size;

      console.log(
        `[Base64Cache] LRU 淘汰: ${oldestId.slice(0, 20)}..., ` +
        `释放 ${(entry.size / 1024).toFixed(2)}KB, ` +
        `剩余 ${this.memoryCache.size} 条 / ${(this.totalMemorySize / (1024 * 1024)).toFixed(2)}MB`
      );
    }
  }

  /**
   * 加载到内存
   */
  private async loadToMemory(entry: Base64CacheEntry): Promise<void> {
    entry.lastAccess = Date.now();

    const existingEntry = this.memoryCache.get(entry.id);
    if (existingEntry) {
      this.totalMemorySize -= existingEntry.size;
    }

    this.memoryCache.set(entry.id, entry);
    this.totalMemorySize += entry.size;
    this.updateAccessOrder(entry.id);

    // 检查是否需要淘汰
    await this.evictFromMemory();
  }

  /**
   * 从远程 URL 获取图片并转换为 Base64
   */
  private async fetchFromUrl(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.warn('[Base64Cache] fetchFromUrl 失败:', url, error);
      return null;
    }
  }

  // ============ IndexedDB 操作 ============

  private async getFromIDB(id: string): Promise<Base64CacheEntry | null> {
    if (!idbAvailable) return null;

    try {
      const db = await getCacheDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('[Base64Cache] IDB 读取失败:', error);
      return null;
    }
  }

  private async persistToIDB(entry: Base64CacheEntry): Promise<void> {
    if (!idbAvailable) return;

    try {
      const db = await getCacheDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const request = store.put(entry);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      // 检查 IndexedDB 是否超限
      await this.cleanupIDB();
    } catch (error) {
      console.warn('[Base64Cache] IDB 写入失败:', error);
    }
  }

  private async deleteFromIDB(id: string): Promise<void> {
    if (!idbAvailable) return;

    try {
      const db = await getCacheDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('[Base64Cache] IDB 删除失败:', error);
    }
  }

  private async clearIDB(): Promise<void> {
    if (!idbAvailable) return;

    try {
      const db = await getCacheDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('[Base64Cache] IDB 清空失败:', error);
    }
  }

  private async cleanupIDB(): Promise<void> {
    if (!idbAvailable) return;

    try {
      const db = await getCacheDB();
      const count = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (count > IDB_MAX_ENTRIES) {
        const deleteCount = count - IDB_MAX_ENTRIES;
        console.log(`[Base64Cache] IDB 清理: 删除 ${deleteCount} 条旧记录`);

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
          const store = tx.objectStore(IDB_STORE_NAME);
          const index = store.index('lastAccess');
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
      }
    } catch (error) {
      console.warn('[Base64Cache] IDB 清理失败:', error);
    }
  }
}

// 导出单例实例
export const base64CacheService = new Base64CacheService();
