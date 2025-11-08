import type { FlowTemplate, TemplateIndexEntry } from '@/types/template';

// Minimal IndexedDB wrapper for user templates
const DB_NAME = 'tanva_templates';
const DB_VERSION = 1;
const STORE_TEMPLATES = 'templates';

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
        db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listUserTemplates(): Promise<Array<Pick<UserTemplateRecord,'id'|'name'|'category'|'tags'|'thumbnail'|'createdAt'|'updatedAt'>>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, 'readonly');
    const store = tx.objectStore(STORE_TEMPLATES);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = (req.result as UserTemplateRecord[]) || [];
      const mapped = list.map(t => ({ id: t.id, name: t.name, category: t.category, tags: t.tags, thumbnail: t.thumbnail, createdAt: t.createdAt, updatedAt: t.updatedAt }));
      resolve(mapped);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getUserTemplate(id: string): Promise<UserTemplateRecord | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, 'readonly');
    const store = tx.objectStore(STORE_TEMPLATES);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as UserTemplateRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function saveUserTemplate(tpl: FlowTemplate): Promise<void> {
  const db = await openDB();
  const now = new Date().toISOString();
  const rec: UserTemplateRecord = {
    ...tpl,
    createdAt: (tpl as any).createdAt || now,
    updatedAt: now,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE_TEMPLATES);
    store.put(rec);
  });
}

export async function deleteUserTemplate(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE_TEMPLATES);
    store.delete(id);
  });
}

// Built-in templates index and loader (from public directory)
let builtInIndexCache: TemplateIndexEntry[] | null = null;

export async function loadBuiltInTemplateIndex(): Promise<TemplateIndexEntry[]> {
  if (builtInIndexCache) return builtInIndexCache;
  try {
    const res = await fetch('/templates/index.json');
    if (!res.ok) throw new Error('Failed to load built-in template index');
    const data = await res.json();
    builtInIndexCache = Array.isArray(data) ? data : [];
    return builtInIndexCache;
  } catch (e) {
    console.warn('loadBuiltInTemplateIndex error', e);
    return [];
  }
}

export async function loadBuiltInTemplateByPath(path: string): Promise<FlowTemplate | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error('Failed to fetch template ' + path);
    const tpl = await res.json();
    return tpl as FlowTemplate;
  } catch (e) {
    console.warn('loadBuiltInTemplateByPath error', e);
    return null;
  }
}

export function generateId(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}

