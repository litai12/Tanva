import { fetchWithAuth } from './authFetch';

const apiBase =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
    : 'http://localhost:4000';

export type PromptMediaType = 'image' | 'video';
export type PromptLibrarySource = 'official' | 'custom';
export type PromptLibrarySort = 'name_asc' | 'time_asc' | 'time_desc';

export type OfficialPromptModel = {
  slug: string;
  name: string;
};

export type OfficialPromptMedia = {
  id: string;
  kind: PromptMediaType;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  order: number;
};

export type OfficialPromptItem = {
  id: string;
  title: string;
  description: string | null;
  promptText: string;
  mediaType: PromptMediaType;
  authorLabel: string;
  publishedAt: string | null;
  models: OfficialPromptModel[];
  media: OfficialPromptMedia[];
};

export type OfficialPromptFacets = {
  media: Array<{ kind: PromptMediaType; count: number }>;
  models: Array<{ slug: string; name: string; count: number }>;
  allMediaCount: number;
  allModelCount: number;
};

export type OfficialPromptPage = {
  items: OfficialPromptItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: OfficialPromptFacets;
};

export type UserPromptItem = {
  id: string;
  title: string;
  description: string | null;
  promptText: string;
  mediaType: PromptMediaType;
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserPromptInput = {
  title: string;
  description?: string;
  promptText: string;
  mediaType: PromptMediaType;
  previewUrl?: string;
};

export type PromptFavorite = {
  source: PromptLibrarySource;
  promptId: string;
  createdAt: string;
};

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      const candidate = payload?.message || payload?.error;
      message = Array.isArray(candidate) ? candidate.join('；') : candidate || message;
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
};

const addQuery = (path: string, values: Record<string, string | number | undefined>): string => {
  const url = new URL(`${apiBase}${path}`);
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && String(value).trim()) url.searchParams.set(key, String(value));
  });
  return url.toString();
};

export const promptLibraryApi = {
  async listOfficial(input: {
    query?: string;
    model?: string;
    mediaType?: PromptMediaType;
    sort?: PromptLibrarySort;
    page?: number;
    pageSize?: number;
  }): Promise<OfficialPromptPage> {
    const response = await fetchWithAuth(addQuery('/api/prompt-library/official', input), {
      timeoutMs: 20_000,
    });
    return readJson<OfficialPromptPage>(response);
  },

  async listMine(input: { query?: string; mediaType?: PromptMediaType } = {}): Promise<UserPromptItem[]> {
    const response = await fetchWithAuth(addQuery('/api/prompt-library/mine', input));
    return readJson<UserPromptItem[]>(response);
  },

  async createMine(input: UserPromptInput): Promise<UserPromptItem> {
    const response = await fetchWithAuth(`${apiBase}/api/prompt-library/mine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return readJson<UserPromptItem>(response);
  },

  async updateMine(id: string, input: Partial<UserPromptInput>): Promise<UserPromptItem> {
    const response = await fetchWithAuth(`${apiBase}/api/prompt-library/mine/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return readJson<UserPromptItem>(response);
  },

  async removeMine(id: string): Promise<{ ok: true }> {
    const response = await fetchWithAuth(`${apiBase}/api/prompt-library/mine/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return readJson<{ ok: true }>(response);
  },

  async listFavorites(): Promise<PromptFavorite[]> {
    const response = await fetchWithAuth(`${apiBase}/api/prompt-library/favorites`);
    return readJson<PromptFavorite[]>(response);
  },

  async setFavorite(source: PromptLibrarySource, promptId: string, favorite: boolean): Promise<void> {
    const response = await fetchWithAuth(
      `${apiBase}/api/prompt-library/favorites/${source}/${encodeURIComponent(promptId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite }),
      },
    );
    await readJson(response);
  },
};
