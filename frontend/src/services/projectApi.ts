import {
  createEmptyProjectContent,
  type ProjectContentSnapshot,
} from "@/types/project";
import { fetchWithAuth } from "./authFetch";

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

const viteEnv =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env
    : undefined;

// 后端基础地址，统一从 .env 中读取：
// 例如在 .env.development / .env.production 中配置：
// VITE_API_BASE_URL="https://your-backend-domain.com"
// 如果不配置，则默认走相对路径 "/api"（配合 Vite 代理一起用）
const base =
  viteEnv?.VITE_API_BASE_URL && viteEnv.VITE_API_BASE_URL.trim().length > 0
    ? viteEnv.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "";

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

export const projectApi = {
  async list(): Promise<Project[]> {
    const res = await fetchWithAuth(`${base}/api/projects`);
    return json<Project[]>(res);
  },
  async create(payload: { name?: string }): Promise<Project> {
    const res = await fetchWithAuth(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<Project>(res);
  },
  async get(id: string): Promise<Project> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}`);
    return json<Project>(res);
  },
  async update(
    id: string,
    payload: { name?: string; thumbnailUrl?: string | null }
  ): Promise<Project> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<Project>(res);
  },
  async remove(id: string): Promise<{ ok: boolean }> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}`, {
      method: "DELETE",
    });
    return json<{ ok: boolean }>(res);
  },
  async getContent(
    id: string
  ): Promise<{
    content: ProjectContentSnapshot;
    version: number;
    updatedAt: string | null;
  }> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}/content`);
    const data = await json<{
      content: ProjectContentSnapshot | null;
      version: number;
      updatedAt: string | null;
    }>(res);
    return {
      content: data.content ?? createEmptyProjectContent(),
      version: data.version ?? 1,
      updatedAt: data.updatedAt,
    };
  },
  async saveContent(
    id: string,
    payload: { content: ProjectContentSnapshot; version?: number }
  ): Promise<{
    version: number;
    updatedAt: string | null;
    thumbnailUrl?: string;
  }> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: payload.content,
        version: payload.version,
      }),
    });
    const data = await json<{
      version: number;
      updatedAt: string | null;
      thumbnailUrl?: string;
    }>(res);
    return {
      version: data.version,
      updatedAt: data.updatedAt,
      thumbnailUrl: data.thumbnailUrl,
    };
  },
};
