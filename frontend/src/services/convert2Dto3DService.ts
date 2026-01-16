/**
 * 2D转3D服务
 * 调用后端API将2D图片转换为3D模型
 */

import { logger } from "@/utils/logger";
import { fetchWithAuth } from "./authFetch";
// 后端基础地址，可通过 .env 的 VITE_API_BASE_URL 覆盖，默认 http://localhost:4000
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  "http://localhost:4000";

const buildUrl = (path: string) => {
  const base = API_BASE.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${base}/${p}`;
};

export interface Convert2Dto3DRequest {
  imageUrl: string; // OSS原生可访问的图片URL
}

export interface Convert2Dto3DResponse {
  success: boolean;
  modelUrl: string; // 3D模型访问URL (https://img.tgtai.com/view/{filename})
  promptId?: string;
  error?: string;
}

/**
 * 将2D图片转换为3D模型
 */
export async function convert2Dto3D(
  request: Convert2Dto3DRequest
): Promise<Convert2Dto3DResponse> {
  try {
    const response = await fetchWithAuth(buildUrl("/api/ai/convert-2d-to-3d"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData?.message || `HTTP ${response.status}`;
      logger.error("2D to 3D conversion failed", {
        status: response.status,
        error: errorMessage,
      });

      return {
        success: false,
        modelUrl: "",
        error: errorMessage,
      };
    }

    const data = await response.json();

    return {
      success: true,
      modelUrl: data.modelUrl,
      promptId: data.promptId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    logger.error("2D to 3D conversion error", error);

    return {
      success: false,
      modelUrl: "",
      error: message,
    };
  }
}
