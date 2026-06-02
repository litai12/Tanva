/**
 * 瑙嗛鐢熸垚渚涘簲鍟咥PI璋冪敤鏈嶅姟
 * 閫氳繃鍚庣浠ｇ悊浠ラ伩鍏?CORS 閿欒骞朵繚鎶?API Key
 */
import { fetchWithAuth } from "./authFetch";
import { getApiBaseUrl } from "../utils/assetProxy";

export type VideoProvider = "kling" | "kling-2.6" | "kling-o3" | "vidu" | "viduq3-pro" | "doubao" | "wan2.7";

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
  referenceImages?: string[]; // Base64 Data URI 鏁扮粍
  audioUrls?: string[];
  referenceVideos?: string[];
  videoMode?: string;
  managedModelKey?: string;
  vendorKey?: string;
  platformKey?: string;
  duration?: number;
  aspectRatio?: string;
  provider: VideoProvider;
  // Vidu 涓撶敤鍙傛暟
  resolution?: string;
  style?: "general" | "anime";
  offPeak?: boolean;
  // Seedance 1.5 Pro涓撶敤鍙傛暟
  camerafixed?: boolean;
  watermark?: boolean;
  // Kling/Kling-O1 涓撶敤鍙傛暟
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
  seed2InputTier?: "le32k" | "gt32k_le128k" | "gt128k_le256k";
  // Kling O1 瑙嗛缂栬緫涓撶敤鍙傛暟
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

export interface VideoTaskQueryResult {
  status: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * 缁熶竴鐨勮棰戠敓鎴愭帴鍙ｏ紙鍚庣浠ｇ悊鐗堬級
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
 * 鏌ヨ浠诲姟鐘舵€侊紙鍚庣浠ｇ悊鐗堬級
 */
export async function queryVideoTask(
  provider: VideoProvider,
  taskId: string
): Promise<VideoTaskQueryResult> {
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
 * 瑙嗛浠诲姟澶辫触鏃堕€€杩樼Н鍒?
 */
export async function refundVideoTask(apiUsageId: string): Promise<{ success: boolean; newBalance: number }> {
  const apiBaseUrl = getApiBaseUrl();
  const retryDelays = [0, 300, 800];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelays[attempt]));
    }
    try {
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
        const message = error.message || `HTTP ${response.status}`;
        // 4xx 通常是业务态（如已成功任务不可退款），不做重试
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`NON_RETRY:${message}`);
        }
        throw new Error(message);
      }

      return response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.startsWith("NON_RETRY:")) {
        throw new Error(lastError.message.replace(/^NON_RETRY:/, ""));
      }
      if (attempt === retryDelays.length - 1) {
        break;
      }
    }
  }

  throw lastError || new Error("Refund failed");
}

/**
 * 瑙嗛浠诲姟鎴愬姛鍚庣‘璁ょН鍒嗙姸鎬侊紙灏?pending 鏍囪涓?success锛?
 */
export async function markVideoTaskSuccess(
  apiUsageId: string,
  processingTime?: number,
  tokenUsage?: { inputTokens?: number; outputTokens?: number }
): Promise<{ success: boolean }> {
  const apiBaseUrl = getApiBaseUrl();
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/ai/video-task-success`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiUsageId,
        processingTime,
        inputTokens: tokenUsage?.inputTokens,
        outputTokens: tokenUsage?.outputTokens,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

