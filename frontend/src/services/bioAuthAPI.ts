/**
 * 生物认证 API 客户端
 * 通过后端代理调用火山引擎活体检测接口，以避免 CORS 错误并保护 API Key
 */

import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type BioAuthStatus = "processing" | "active" | "failed";

export interface StartBioAuthResult {
  taskId: string;
}

export interface BioAuthStatusResult {
  status: BioAuthStatus;
  errorMessage?: string;
}

/**
 * 启动生物认证任务（通过后端代理）
 */
export async function startBioAuth(imageUrl: string): Promise<StartBioAuthResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(`${apiBaseUrl}/api/bio-auth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * 查询生物认证任务状态
 */
export async function getBioAuthStatus(taskId: string): Promise<BioAuthStatusResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/bio-auth/${encodeURIComponent(taskId)}/status`
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}
