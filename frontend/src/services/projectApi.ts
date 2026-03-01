import {
  createEmptyProjectContent,
  type FlowGraphSnapshot,
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

export type WorkflowHistoryEntry = {
  updatedAt: string;
  version: number;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
};

export type WorkflowHistoryDetail = WorkflowHistoryEntry & {
  userId: string;
  projectId: string;
  flow: FlowGraphSnapshot;
};

// 后端基础地址，统一从 .env 中读取：
// 例如在 .env.development / .env.production 中配置：
// VITE_API_BASE_URL="https://your-backend-domain.com"
// 如果不配置，则默认 http://localhost:4000
const base =
  import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000";

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

type ProjectContentResponse = {
  content: ProjectContentSnapshot;
  version: number;
  updatedAt: string | null;
};

// 开发环境 StrictMode / 路由切换等场景下，可能对同一项目触发多次并发 getContent。
// 这里做“同 projectId 的 in-flight 去重”，避免重复下载超大 JSON（10MB+）。
const inFlightGetContent = new Map<string, Promise<ProjectContentResponse>>();

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
  async getContent(id: string): Promise<{
    content: ProjectContentSnapshot;
    version: number;
    updatedAt: string | null;
  }> {
    const existing = inFlightGetContent.get(id);
    if (existing) return existing;

    const promise = (async (): Promise<ProjectContentResponse> => {
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
    })().finally(() => {
      inFlightGetContent.delete(id);
    });

    inFlightGetContent.set(id, promise);
    return promise;
  },
  async saveContent(
    id: string,
    payload: { content: ProjectContentSnapshot; version?: number; createWorkflowHistory?: boolean }
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
        createWorkflowHistory: payload.createWorkflowHistory,
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

  async listWorkflowHistory(id: string, payload?: { limit?: number }): Promise<WorkflowHistoryEntry[]> {
    const limit = payload?.limit ? `?limit=${payload.limit}` : "";
    const res = await fetchWithAuth(`${base}/api/projects/${id}/workflow-history${limit}`);
    return json<WorkflowHistoryEntry[]>(res);
  },

  async getWorkflowHistory(id: string, updatedAt: string): Promise<WorkflowHistoryDetail> {
    const res = await fetchWithAuth(`${base}/api/projects/${id}/workflow-history/${encodeURIComponent(updatedAt)}`);
    return json<WorkflowHistoryDetail>(res);
  },
};
