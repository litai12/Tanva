// API client for global image history endpoints.
import { fetchWithAuth } from "./authFetch";

const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

export interface GlobalImageHistoryItem {
  id: string;
  imageUrl: string;
  prompt?: string;
  sourceType: string;
  sourceProjectId?: string;
  sourceProjectName?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface CreateGlobalImageHistoryDto {
  imageUrl: string;
  prompt?: string;
  sourceType: string;
  sourceProjectId?: string;
  sourceProjectName?: string;
  metadata?: Record<string, any>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      msg = d?.message || d?.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const globalImageHistoryApi = {
  async list(params?: {
    limit?: number;
    cursor?: string;
    sourceType?: string;
    sourceProjectId?: string;
  }): Promise<{
    items: GlobalImageHistoryItem[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.cursor) searchParams.set("cursor", params.cursor);
    if (params?.sourceType) searchParams.set("sourceType", params.sourceType);
    if (params?.sourceProjectId) {
      searchParams.set("sourceProjectId", params.sourceProjectId);
    }

    const url = `${base}/api/global-image-history?${searchParams.toString()}`;
    const res = await fetchWithAuth(url);
    return json(res);
  },

  async getCount(): Promise<{ count: number }> {
    const res = await fetchWithAuth(`${base}/api/global-image-history/count`);
    return json(res);
  },

  async create(
    dto: CreateGlobalImageHistoryDto
  ): Promise<GlobalImageHistoryItem> {
    const res = await fetchWithAuth(`${base}/api/global-image-history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dto),
    });
    return json(res);
  },

  async delete(id: string): Promise<{ success: boolean }> {
    const res = await fetchWithAuth(`${base}/api/global-image-history/${id}`, {
      method: "DELETE",
    });
    return json(res);
  },
};
