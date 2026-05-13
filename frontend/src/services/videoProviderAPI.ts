/**
 * 视频生成供应商API调用服务
 * 通过后端代理以避免 CORS 错误并保护 API Key
 */
import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type VideoProvider = "kling" | "kling-2.6" | "kling-o3" | "vidu" | "viduq3-pro" | "doubao";

const buildIdempotencyKey = (scope: string): string => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${scope}-${Date.now()}-${crypto.randomUUID()}`;
    }
  } catch {
    // noop
  }
  return `${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export interface VideoGenerationRequest {
  prompt?: string;
  referenceImages?: string[]; // Base64 Data URI 数组
  audioUrls?: string[];
  referenceVideos?: string[];
  videoMode?: string;
  managedModelKey?: string;
  vendorKey?: string;
  platformKey?: string;
  duration?: number;
  aspectRatio?: string;
  provider: VideoProvider;
  // Vidu 专用参数
  resolution?: string;
  style?: "general" | "anime";
  offPeak?: boolean;
  // Seedance 1.5 Pro专用参数
  camerafixed?: boolean;
  watermark?: boolean;
  // Kling/Kling-O1 专用参数
  mode?: "std" | "pro";
  sound?: string;
  klingModel?: "kling-v2-1" | "kling-v2-6" | "kling-v3-0" | "kling-o3" | "kling-v3-omni";
  klingStoryboardMode?: "single" | "intelligence" | "customize";
  klingStoryboardScript?: string;
  viduModel?: "q2" | "q3";
  viduModelVariant?: "q2" | "q2-pro" | "q2-turbo" | "q3" | "q3-pro" | "q3-turbo";
  seedanceModel?:
    | "seedance-1.5-pro"
    | "seedance-2.0"
    | "seed-2.0-pro"
    | "seed-2.0-lite"
    | "seed-2.0-mini"
    | "seedance-2.0-fast";
  // Kling O1 视频编辑专用参数
  referenceVideo?: string;
  referenceVideoType?: "feature" | "motion" | "expression";
  keepOriginalSound?: "yes" | "no";
  generateAudio?: boolean;
  idempotencyKey?: string;
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
  const idempotencyKey =
    typeof request.idempotencyKey === "string" && request.idempotencyKey.trim().length > 0
      ? request.idempotencyKey.trim().slice(0, 128)
      : buildIdempotencyKey("video-provider");
  const { idempotencyKey: _idempotencyKey, ...payload } = request;
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/ai/generate-video-provider`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
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

/**
 * 视频任务成功后确认积分状态（将 pending 标记为 success）
 */
export async function markVideoTaskSuccess(
  apiUsageId: string,
  processingTime?: number
): Promise<{ success: boolean }> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/ai/video-task-success`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apiUsageId, processingTime }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}
