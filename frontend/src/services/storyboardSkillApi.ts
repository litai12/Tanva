import { fetchWithAuth } from './authFetch';

const base =
  import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000';

export type StoryboardSkill = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type UpsertStoryboardSkill = {
  id?: string;
  name: string;
  content: string;
};

const json = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.message || payload?.error || message;
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
};

export const storyboardSkillApi = {
  async list(): Promise<StoryboardSkill[]> {
    const response = await fetchWithAuth(`${base}/api/storyboard-skills`);
    return json<StoryboardSkill[]>(response);
  },

  async upsert(input: UpsertStoryboardSkill): Promise<StoryboardSkill> {
    const response = await fetchWithAuth(`${base}/api/storyboard-skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return json<StoryboardSkill>(response);
  },

  async remove(id: string): Promise<{ ok: true }> {
    const response = await fetchWithAuth(
      `${base}/api/storyboard-skills/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    return json<{ ok: true }>(response);
  },
};
