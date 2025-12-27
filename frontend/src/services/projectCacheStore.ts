/**
 * 项目内容本地缓存 - 使用 IndexedDB 存储
 * 用于加速页面刷新后的项目加载
 */
import type { ProjectContentSnapshot } from '@/types/project';

const DB_NAME = 'tanva_project_cache';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const CACHE_TTL_DAYS = 7;

export interface ProjectCacheEntry {
  projectId: string;
  content: ProjectContentSnapshot;
  version: number;
  updatedAt: string;
  cachedAt: string;
}

export interface ProjectMeta {
  contentVersion: number;
  updatedAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getProjectCache(projectId: string): Promise<ProjectCacheEntry | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      tx.oncomplete = () => db.close();
      tx.onabort = () => db.close();
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(projectId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.warn('[ProjectCache] 读取缓存失败:', error);
    return null;
  }
}

export async function setProjectCache(entry: ProjectCacheEntry): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
    });
  } catch (error) {
    console.warn('[ProjectCache] 写入缓存失败:', error);
  }
}

export async function deleteProjectCache(projectId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      const store = tx.objectStore(STORE_NAME);
      store.delete(projectId);
    });
  } catch (error) {
    console.warn('[ProjectCache] 删除缓存失败:', error);
  }
}

export function isCacheValid(
  cache: ProjectCacheEntry,
  projectMeta: ProjectMeta | null
): boolean {
  if (!projectMeta) return false;

  // 版本号校验
  if (cache.version < projectMeta.contentVersion) {
    return false;
  }

  // 时间戳校验
  const cacheUpdatedAt = Date.parse(cache.updatedAt);
  const projectUpdatedAt = Date.parse(projectMeta.updatedAt);
  if (!Number.isFinite(cacheUpdatedAt) || !Number.isFinite(projectUpdatedAt)) {
    return false;
  }
  if (cacheUpdatedAt < projectUpdatedAt) {
    return false;
  }

  // TTL 校验
  const cachedTime = Date.parse(cache.cachedAt);
  if (!Number.isFinite(cachedTime)) {
    return false;
  }
  const now = Date.now();
  if (now - cachedTime > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return false;
  }

  return true;
}
