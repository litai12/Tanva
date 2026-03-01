type FlowImageAssetRecord = {
  id: string;
  blob: Blob;
  createdAt: number;
  size: number;
  contentType: string;
  projectId?: string | null;
  nodeId?: string;
};

export const FLOW_IMAGE_ASSET_PREFIX = "flow-asset:";

export const toFlowImageAssetRef = (assetId: string): string =>
  `${FLOW_IMAGE_ASSET_PREFIX}${assetId}`;

export const parseFlowImageAssetRef = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)) return null;
  const id = trimmed.slice(FLOW_IMAGE_ASSET_PREFIX.length).trim();
  return id ? id : null;
};

const DB_NAME = "tanva_flow_image_assets";
const DB_VERSION = 1;
const STORE_NAME = "images";

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
let idbAvailable = true;
const memoryFallback = new Map<string, FlowImageAssetRecord>();

const objectUrlCache = new Map<string, { url: string; refs: number }>();
const pendingObjectUrl = new Map<string, Promise<string | null>>();

const isIndexedDBAvailable = (): boolean => {
  if (typeof window === "undefined") return false;
  if (typeof indexedDB === "undefined") return false;
  return true;
};

const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      idbAvailable = false;
      reject(new Error("IndexedDB not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (db.objectStoreNames.contains(STORE_NAME)) return;

      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt", { unique: false });
      store.createIndex("projectId", "projectId", { unique: false });
      store.createIndex("nodeId", "nodeId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      idbAvailable = false;
      reject(request.error);
    };
  });
};

const getDB = async (): Promise<IDBDatabase> => {
  if (dbInstance) return dbInstance;
  if (dbPromise) return dbPromise;
  dbPromise = openDatabase();
  try {
    dbInstance = await dbPromise;
    return dbInstance;
  } catch (error) {
    dbPromise = null;
    throw error;
  }
};

const generateId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export async function putFlowImageBlobs(
  items: Array<{
    blob: Blob;
    projectId?: string | null;
    nodeId?: string;
  }>
): Promise<string[]> {
  if (!Array.isArray(items) || items.length === 0) return [];

  const records: FlowImageAssetRecord[] = items.map((item) => {
    const blob = item.blob;
    return {
      id: generateId("flow_img"),
      blob,
      createdAt: Date.now(),
      size: blob?.size ?? 0,
      contentType: blob?.type || "image/png",
      projectId: item.projectId ?? null,
      nodeId: item.nodeId,
    };
  });

  if (!idbAvailable) {
    records.forEach((r) => memoryFallback.set(r.id, r));
    return records.map((r) => r.id);
  }

  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      records.forEach((record) => {
        store.put(record);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return records.map((r) => r.id);
  } catch (error) {
    // 降级到内存（避免功能不可用）
    idbAvailable = false;
    records.forEach((r) => memoryFallback.set(r.id, r));
    return records.map((r) => r.id);
  }
}

export async function getFlowImageBlob(assetId: string): Promise<Blob | null> {
  const id = typeof assetId === "string" ? assetId.trim() : "";
  if (!id) return null;

  if (!idbAvailable) {
    return memoryFallback.get(id)?.blob ?? null;
  }

  try {
    const db = await getDB();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        const result = request.result as FlowImageAssetRecord | undefined;
        resolve(result?.blob ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    idbAvailable = false;
    return memoryFallback.get(id)?.blob ?? null;
  }
}

export async function deleteFlowImage(assetId: string): Promise<void> {
  const id = typeof assetId === "string" ? assetId.trim() : "";
  if (!id) return;

  releaseFlowImageObjectUrl(id);

  if (!idbAvailable) {
    memoryFallback.delete(id);
    return;
  }

  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    idbAvailable = false;
    memoryFallback.delete(id);
  }
}

export async function acquireFlowImageObjectUrl(
  assetId: string
): Promise<string | null> {
  const id = typeof assetId === "string" ? assetId.trim() : "";
  if (!id) return null;

  const cached = objectUrlCache.get(id);
  if (cached) {
    cached.refs += 1;
    return cached.url;
  }

  const pending =
    pendingObjectUrl.get(id) ||
    (async () => {
      const blob = await getFlowImageBlob(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      objectUrlCache.set(id, { url, refs: 0 });
      return url;
    })();

  pendingObjectUrl.set(id, pending);

  const url = await pending.finally(() => {
    pendingObjectUrl.delete(id);
  });

  if (!url) return null;
  const entry = objectUrlCache.get(id);
  if (entry) entry.refs += 1;
  return url;
}

export function releaseFlowImageObjectUrl(assetId: string): void {
  const id = typeof assetId === "string" ? assetId.trim() : "";
  if (!id) return;

  const entry = objectUrlCache.get(id);
  if (!entry) return;

  entry.refs -= 1;
  if (entry.refs > 0) return;

  try {
    URL.revokeObjectURL(entry.url);
  } catch {}
  objectUrlCache.delete(id);
}

export async function createEphemeralFlowImageObjectUrl(
  assetId: string
): Promise<{ url: string; revoke: () => void } | null> {
  const id = typeof assetId === "string" ? assetId.trim() : "";
  if (!id) return null;

  const blob = await getFlowImageBlob(id);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  return {
    url,
    revoke: () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    },
  };
}

