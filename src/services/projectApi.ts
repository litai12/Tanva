import { createEmptyProjectContent, type ProjectContentSnapshot } from '@/types/project';

export type Project = {
  id: string;
  name: string;
  ossPrefix: string;
  mainKey: string;
  contentVersion: number;
  createdAt: string;
  updatedAt: string;
  mainUrl?: string;
  thumbnailUrl?: string;
};

const base = '';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = await res.json(); msg = d?.message || d?.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...(init || {}), credentials: 'include' });
  if (res.status !== 401) return res;
  // 尝试刷新一次
  try {
    const r = await fetch(`/api/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (r.ok) {
      return fetch(input, { ...(init || {}), credentials: 'include' });
    }
  } catch {}
  return res; // 返回401
}

export const projectApi = {
  async list(): Promise<Project[]> {
    const res = await fetchWithAuth(`${base}/api/projects`);
    return json<Project[]>(res);
  },
  async create(payload: { name?: string }): Promise<Project> {
    const res = await fetchWithAuth(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return json<Project>(res);
  },
  async get(id: string): Promise<Project> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}`);
    return json<Project>(res);
  },
  async update(id: string, payload: { name?: string }): Promise<Project> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return json<Project>(res);
  },
  async remove(id: string): Promise<{ ok: boolean }> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}`, { method: 'DELETE' });
    return json<{ ok: boolean }>(res);
  },
  async getContent(id: string): Promise<{ content: ProjectContentSnapshot; version: number; updatedAt: string | null }> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}/content`);
    const data = await json<{ content: ProjectContentSnapshot | null; version: number; updatedAt: string | null }>(res);
    return {
      content: data.content ?? createEmptyProjectContent(),
      version: data.version ?? 1,
      updatedAt: data.updatedAt,
    };
  },
  async saveContent(id: string, payload: { content: ProjectContentSnapshot; version?: number }): Promise<{ version: number; updatedAt: string | null }> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: payload.content, version: payload.version }),
    });
    const data = await json<{ version: number; updatedAt: string | null }>(res);
    return {
      version: data.version,
      updatedAt: data.updatedAt,
    };
  },
};
