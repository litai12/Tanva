/**
 * 视频生成供应商API调用服务
 * 通过后端代理以避免 CORS 错误并保护 API Key
 */
import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type VideoProvider = "kling" | "kling-2.6" | "kling-o1" | "vidu" | "doubao";

export interface VideoGenerationRequest {
  prompt: string;
  referenceImages?: string[]; // Base64 Data URI 数组
  duration?: number;
  aspectRatio?: string;
  provider: VideoProvider;
  // Vidu 专用参数
  resolution?: "540p" | "720p" | "1080p";
  style?: "general" | "anime";
  offPeak?: boolean;
  // 豆包专用参数
  camerafixed?: boolean;
  watermark?: boolean;
  // Kling/Kling-O1 专用参数
  mode?: "std" | "pro";
  // Kling O1 视频编辑专用参数
  referenceVideo?: string;
  referenceVideoType?: "feature" | "motion" | "expression";
  keepOriginalSound?: "yes" | "no";
}

export interface VideoGenerationResult {
  taskId: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  status: string;
  error?: string;
  apiUsageId?: string; // 用于失败时退款
}

/**
 * 统一的视频生成接口（后端代理版）
 */
export async function generateVideoByProvider(
  request: VideoGenerationRequest
): Promise<VideoGenerationResult> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/ai/generate-video-provider`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * 查询任务状态（后端代理版）
 */
export async function queryVideoTask(
  provider: VideoProvider,
  taskId: string
): Promise<{ status: string; videoUrl?: string; thumbnailUrl?: string; error?: string }> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/ai/video-task/${provider}/${taskId}`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * 视频任务失败时退还积分
 */
export async function refundVideoTask(apiUsageId: string): Promise<{ success: boolean; newBalance: number }> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/ai/video-task-refund`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apiUsageId }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}
