/**
 * 项目内容本地缓存 - 使用 IndexedDB 存储
 * 用于加速页面刷新后的项目加载
 */
import type { ProjectContentSnapshot } from '@/types/project';

const DB_NAME = 'tanva_project_cache';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const CACHE_TTL_DAYS = 7;
const CACHE_SCHEMA_VERSION = 2;
const MAX_CACHE_ENTRIES_PER_USER = 30;
const MAX_CACHE_BYTES_PER_USER = 150 * 1024 * 1024;

export interface ProjectCacheEntry {
  projectId: string;
  userId?: string | null;
  content: ProjectContentSnapshot;
  version: number;
  updatedAt: string;
  cachedAt: string;
  lastAccessedAt?: string;
  sizeBytes?: number;
  schemaVersion?: number;
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

type ProjectCacheOptions = {
  userId?: string | null;
  allowLegacyWithoutUser?: boolean;
};

const nowIso = () => new Date().toISOString();

function estimateContentSizeBytes(content: ProjectContentSnapshot): number {
  try {
    return new Blob([JSON.stringify(content)]).size;
  } catch {
    try {
      return JSON.stringify(content).length;
    } catch {
      return 0;
    }
  }
}

function normalizeCacheEntry(entry: ProjectCacheEntry): ProjectCacheEntry {
  const cachedAt = entry.cachedAt || nowIso();
  return {
    ...entry,
    cachedAt,
    lastAccessedAt: entry.lastAccessedAt || cachedAt,
    sizeBytes: entry.sizeBytes ?? estimateContentSizeBytes(entry.content),
    schemaVersion: CACHE_SCHEMA_VERSION,
  };
}

function matchesCacheUser(
  cache: ProjectCacheEntry,
  options?: ProjectCacheOptions
): boolean {
  const expectedUserId = options?.userId?.trim();
  if (!expectedUserId) return true;
  if (cache.userId === expectedUserId) return true;
  return !cache.userId && options?.allowLegacyWithoutUser === true;
}

async function readProjectCacheRaw(projectId: string): Promise<ProjectCacheEntry | null> {
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

async function putProjectCacheRaw(entry: ProjectCacheEntry): Promise<void> {
  const normalized = normalizeCacheEntry(entry);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    const store = tx.objectStore(STORE_NAME);
    store.put(normalized);
  });
}

export async function getProjectCache(
  projectId: string,
  options?: ProjectCacheOptions
): Promise<ProjectCacheEntry | null> {
  const cache = await readProjectCacheRaw(projectId);
  if (!cache || !matchesCacheUser(cache, options)) return null;

  const touched = {
    ...cache,
    lastAccessedAt: nowIso(),
    schemaVersion: cache.schemaVersion ?? CACHE_SCHEMA_VERSION,
    sizeBytes: cache.sizeBytes ?? estimateContentSizeBytes(cache.content),
  };
  putProjectCacheRaw(touched).catch(() => {});
  return touched;
}

export async function setProjectCache(entry: ProjectCacheEntry): Promise<void> {
  try {
    await putProjectCacheRaw({
      ...entry,
      cachedAt: entry.cachedAt || nowIso(),
      lastAccessedAt: nowIso(),
    });
    pruneProjectCache(entry.userId ?? null).catch(() => {});
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

async function getAllProjectCaches(): Promise<ProjectCacheEntry[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      tx.oncomplete = () => db.close();
      tx.onabort = () => db.close();
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as ProjectCacheEntry[]);
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.warn('[ProjectCache] 读取全部缓存失败:', error);
    return [];
  }
}

export async function pruneProjectCache(userId?: string | null): Promise<void> {
  const entries = await getAllProjectCaches();
  const now = Date.now();
  const targetUserId = userId?.trim() || null;
  const candidates = entries.filter((entry) => {
    if (!targetUserId) return true;
    return entry.userId === targetUserId;
  });

  const expiredIds = candidates
    .filter((entry) => {
      const cachedTime = Date.parse(entry.cachedAt);
      return !Number.isFinite(cachedTime) ||
        now - cachedTime > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    })
    .map((entry) => entry.projectId);

  const fresh = candidates.filter((entry) => !expiredIds.includes(entry.projectId));
  fresh.sort((a, b) => {
    const at = Date.parse(a.lastAccessedAt || a.cachedAt) || 0;
    const bt = Date.parse(b.lastAccessedAt || b.cachedAt) || 0;
    return bt - at;
  });

  const idsToDelete = new Set(expiredIds);
  let totalBytes = 0;
  fresh.forEach((entry, index) => {
    const size = entry.sizeBytes ?? estimateContentSizeBytes(entry.content);
    totalBytes += size;
    if (index >= MAX_CACHE_ENTRIES_PER_USER || totalBytes > MAX_CACHE_BYTES_PER_USER) {
      idsToDelete.add(entry.projectId);
    }
  });

  await Promise.all(Array.from(idsToDelete).map((id) => deleteProjectCache(id)));
}

export function isCacheFresh(cache: ProjectCacheEntry): boolean {
  const cachedTime = Date.parse(cache.cachedAt);
  if (!Number.isFinite(cachedTime)) return false;
  return Date.now() - cachedTime <= CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
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

  if (cache.version === projectMeta.contentVersion) {
    return isCacheFresh(cache);
  }

  // 旧项目可能没有可靠的 contentVersion，此时才用 updatedAt 兜底。
  if (!Number.isFinite(projectMeta.contentVersion) || projectMeta.contentVersion <= 0) {
    const cacheUpdatedAt = Date.parse(cache.updatedAt);
    const projectUpdatedAt = Date.parse(projectMeta.updatedAt);
    if (!Number.isFinite(cacheUpdatedAt) || !Number.isFinite(projectUpdatedAt)) {
      return false;
    }
    if (cacheUpdatedAt < projectUpdatedAt) {
      return false;
    }
  }

  if (!isCacheFresh(cache)) {
    return false;
  }

  return true;
}
