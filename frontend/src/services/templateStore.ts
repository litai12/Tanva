import type { FlowTemplate, TemplateIndexEntry } from "@/types/template";
import {
  fetchPublicTemplateIndex,
  fetchPublicTemplateById,
} from "./publicTemplateService";
import { fetchWithAuth } from "./authFetch";

// Minimal IndexedDB wrapper for user templates
const DB_NAME = "tanva_templates";
const DB_VERSION = 1;
const STORE_TEMPLATES = "templates";
const API_BASE =
  import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

let didAttemptRemoteMigration = false;

type UserTemplateRecord = FlowTemplate & {
  createdAt: string;
  updatedAt: string;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
        db.createObjectStore(STORE_TEMPLATES, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listLocalTemplateRecords(): Promise<UserTemplateRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, "readonly");
    const store = tx.objectStore(STORE_TEMPLATES);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as UserTemplateRecord[]) || []);
    req.onerror = () => reject(req.error);
  });
}

async function listLocalUserTemplates(): Promise<
  Array<
    Pick<
      UserTemplateRecord,
      | "id"
      | "name"
      | "category"
      | "tags"
      | "thumbnail"
      | "createdAt"
      | "updatedAt"
    >
  >
> {
  const list = await listLocalTemplateRecords();
  return list.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    tags: t.tags,
    thumbnail: t.thumbnail,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}

async function getLocalUserTemplate(
  id: string
): Promise<UserTemplateRecord | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, "readonly");
    const store = tx.objectStore(STORE_TEMPLATES);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as UserTemplateRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function saveLocalUserTemplate(tpl: FlowTemplate): Promise<void> {
  const db = await openDB();
  const now = new Date().toISOString();
  const rec: UserTemplateRecord = {
    ...tpl,
    createdAt: (tpl as any).createdAt || now,
    updatedAt: now,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE_TEMPLATES);
    store.put(rec);
  });
}

async function deleteLocalUserTemplate(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE_TEMPLATES);
    store.delete(id);
  });
}

async function clearLocalTemplates(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_TEMPLATES).clear();
  });
}

async function parseHttpError(res: Response): Promise<string> {
  let msg = `HTTP ${res.status}`;
  try {
    const data = await res.json();
    msg = data?.message || data?.error || msg;
  } catch {}
  return msg;
}

async function listRemoteUserTemplates(): Promise<
  Array<
    Pick<
      UserTemplateRecord,
      | "id"
      | "name"
      | "category"
      | "tags"
      | "thumbnail"
      | "createdAt"
      | "updatedAt"
    >
  >
> {
  const res = await fetchWithAuth(`${API_BASE}/api/user-templates`);
  if (!res.ok) {
    throw new Error(await parseHttpError(res));
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((item: any) => ({
    id: String(item?.id || ""),
    name: String(item?.name || "未命名模板"),
    category: typeof item?.category === "string" ? item.category : undefined,
    tags: Array.isArray(item?.tags)
      ? item.tags.filter((t: unknown) => typeof t === "string")
      : [],
    thumbnail:
      typeof item?.thumbnail === "string" ? item.thumbnail : undefined,
    createdAt: String(item?.createdAt || new Date().toISOString()),
    updatedAt: String(item?.updatedAt || item?.createdAt || new Date().toISOString()),
  }));
}

async function getRemoteUserTemplate(
  id: string
): Promise<UserTemplateRecord | undefined> {
  const res = await fetchWithAuth(
    `${API_BASE}/api/user-templates/${encodeURIComponent(id)}`
  );
  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new Error(await parseHttpError(res));
  }
  const data = (await res.json()) as UserTemplateRecord;
  return data;
}

async function saveRemoteUserTemplate(tpl: FlowTemplate): Promise<void> {
  const res = await fetchWithAuth(`${API_BASE}/api/user-templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: tpl }),
  });
  if (!res.ok) {
    throw new Error(await parseHttpError(res));
  }
}

async function deleteRemoteUserTemplate(id: string): Promise<void> {
  const res = await fetchWithAuth(
    `${API_BASE}/api/user-templates/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok) {
    throw new Error(await parseHttpError(res));
  }
}

async function migrateLocalTemplatesIfNeeded(
  remoteList: Array<
    Pick<
      UserTemplateRecord,
      | "id"
      | "name"
      | "category"
      | "tags"
      | "thumbnail"
      | "createdAt"
      | "updatedAt"
    >
  >
) {
  if (didAttemptRemoteMigration) return remoteList;
  didAttemptRemoteMigration = true;
  if (remoteList.length > 0) return remoteList;

  const localRecords = await listLocalTemplateRecords();
  if (!localRecords.length) return remoteList;

  let migratedCount = 0;
  for (const tpl of localRecords) {
    try {
      await saveRemoteUserTemplate(tpl);
      migratedCount += 1;
    } catch (error) {
      console.warn("[templateStore] migrate local template failed:", tpl.id, error);
    }
  }
  if (!migratedCount) return remoteList;

  try {
    await clearLocalTemplates();
  } catch {}
  return listRemoteUserTemplates();
}

export async function listUserTemplates(): Promise<
  Array<
    Pick<
      UserTemplateRecord,
      | "id"
      | "name"
      | "category"
      | "tags"
      | "thumbnail"
      | "createdAt"
      | "updatedAt"
    >
  >
> {
  try {
    const remoteList = await listRemoteUserTemplates();
    return await migrateLocalTemplatesIfNeeded(remoteList);
  } catch (error) {
    console.warn("[templateStore] list remote templates failed, fallback local", error);
    return listLocalUserTemplates();
  }
}

export async function getUserTemplate(
  id: string
): Promise<UserTemplateRecord | undefined> {
  try {
    return await getRemoteUserTemplate(id);
  } catch (error) {
    console.warn("[templateStore] get remote template failed, fallback local", error);
    return getLocalUserTemplate(id);
  }
}

export async function saveUserTemplate(tpl: FlowTemplate): Promise<void> {
  try {
    await saveRemoteUserTemplate(tpl);
  } catch (error) {
    console.warn("[templateStore] save remote template failed, fallback local", error);
    await saveLocalUserTemplate(tpl);
  }
}

export async function deleteUserTemplate(id: string): Promise<void> {
  try {
    await deleteRemoteUserTemplate(id);
  } catch (error) {
    console.warn("[templateStore] delete remote template failed, fallback local", error);
    await deleteLocalUserTemplate(id);
  }
}

// Built-in templates index and loader (from public directory)
let builtInIndexCache: TemplateIndexEntry[] | null = null;

export async function loadBuiltInTemplateIndex(): Promise<
  TemplateIndexEntry[]
> {
  if (builtInIndexCache) return builtInIndexCache;
  try {
    const data = await fetchPublicTemplateIndex();
    builtInIndexCache = data;
    return builtInIndexCache;
  } catch (e) {
    console.warn("loadBuiltInTemplateIndex error", e);
    return [];
  }
}

export async function loadBuiltInTemplateById(
  templateId: string
): Promise<FlowTemplate | null> {
  try {
    return await fetchPublicTemplateById(templateId);
  } catch (e) {
    console.warn("loadBuiltInTemplateById error", e);
    return null;
  }
}

export function generateId(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}
