export type Project = {
  id: string;
  name: string;
  ossPrefix: string;
  mainKey: string;
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

export const projectApi = {
  async list(): Promise<Project[]> {
    const res = await fetch(`${base}/api/projects`, { credentials: 'include' });
    return json<Project[]>(res);
  },
  async create(payload: { name?: string }): Promise<Project> {
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return json<Project>(res);
  },
  async update(id: string, payload: { name?: string }): Promise<Project> {
    const res = await fetch(`${base}/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    return json<Project>(res);
  },
  async remove(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${base}/api/projects/${id}`, { method: 'DELETE', credentials: 'include' });
    return json<{ ok: boolean }>(res);
  }
};
