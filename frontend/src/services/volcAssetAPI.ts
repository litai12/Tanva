/**
 * 火山引擎素材库API客户端
 * 通过后端代理以避免 CORS 错误并保护 API Key
 */
import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type VolcAssetStatus = "processing" | "active" | "failed";

export interface UploadAssetResult {
  assetId: string;
  status: VolcAssetStatus;
  errorMessage?: string;
}

export interface AssetStatusResult {
  status: VolcAssetStatus;
  errorMessage?: string;
}

export async function getVolcAssetStatus(assetId: string): Promise<AssetStatusResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/volc-asset/${encodeURIComponent(assetId)}/status`
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * 上传素材到火山引擎素材库（通过 URL 拉取）
 */
export async function uploadVolcAsset(sourceUrl: string): Promise<UploadAssetResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/volc-asset/upload`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sourceUrl, assetType: "image" }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { message?: string }).message || `HTTP ${response.status}`);
  }

  return response.json();
}

