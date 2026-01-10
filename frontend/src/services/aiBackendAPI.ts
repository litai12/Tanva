/**
 * 后端 AI API 调用适配层
 * 将前端的本地调用改为调用后端 API
 */

import { v4 as uuidv4 } from "uuid";
import type {
  AIImageGenerateRequest,
  AIImageEditRequest,
  AIImageBlendRequest,
  AIImageAnalyzeRequest,
  AITextChatRequest,
  AIImageResult,
  AIImageAnalysisResult,
  AITextChatResult,
  AIServiceResponse,
  SupportedAIProvider,
  MidjourneyActionRequest,
  MidjourneyModalRequest,
} from "@/types/ai";
import { fetchWithAuth } from "./authFetch";
import { logger } from "@/utils/logger";

// 后端基础地址，统一从 .env 读取；无配置则默认 http://localhost:4000
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL &&
  import.meta.env.VITE_API_BASE_URL.trim().length > 0
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
    : "http://localhost:4000") + "/api";
const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview";
const RUNNINGHUB_IMAGE_MODEL = "runninghub-su-effect";
const MIDJOURNEY_IMAGE_MODEL = "midjourney-fast";

const getTimestamp = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const logApiTiming = (
  endpoint: string,
  startTime: number,
  meta?: Record<string, any>
) => {
  const duration = getTimestamp() - startTime;
  logger.perf(`AI API ${endpoint}`, duration, meta);
};

type ImageResponseLogMeta = {
  endpoint: string;
  provider?: SupportedAIProvider;
  model?: string;
  prompt?: string;
};

const truncateText = (value: string, maxLength: number = 80) =>
  typeof value === "string" && value.length > maxLength
    ? `${value.slice(0, maxLength)}...`
    : value;

const logAIImageResponse = (
  meta: ImageResponseLogMeta,
  payload: { imageData?: string; textResponse?: string }
) => {
  const hasImageData =
    typeof payload.imageData === "string" &&
    payload.imageData.trim().length > 0;
  const textResponse =
    typeof payload.textResponse === "string" &&
    payload.textResponse.trim().length > 0
      ? payload.textResponse
      : "";
  const logger = hasImageData ? console.log : console.warn;

  logger(`${hasImageData ? "🖼️" : "📝"} [AI API] ${meta.endpoint} 响应摘要`, {
    provider: meta.provider || "unknown",
    model: meta.model || "unspecified",
    promptPreview: meta.prompt ? truncateText(meta.prompt, 60) : "N/A",
    hasImageData,
    imageDataLength: payload.imageData?.length || 0,
    textResponsePreview: textResponse ? truncateText(textResponse, 80) : "N/A",
  });

  console.log(`🧾 [AI API] ${meta.endpoint} 返回详情`, {
    textResponse: textResponse || "(无文本返回)",
    hasImage: hasImageData,
  });
};

const generateUUID = () => {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore and fall back
  }

  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
        .slice(6, 8)
        .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
    }
  } catch {
    // ignore and fall back
  }

  try {
    return uuidv4();
  } catch {
    // ignore final fallback
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const MAX_IMAGE_GENERATION_ATTEMPTS = 3;
const NO_IMAGE_RETRY_DELAY_MS = 800;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveDefaultModel = (
  requestModel: string | undefined,
  provider: SupportedAIProvider | undefined
): string => {
  if (requestModel) return requestModel;
  if (provider === "runninghub") return RUNNINGHUB_IMAGE_MODEL;
  if (provider === "midjourney") return MIDJOURNEY_IMAGE_MODEL;
  return DEFAULT_IMAGE_MODEL;
};

type BackendImagePayload = {
  imageData?: string;
  textResponse?: string;
  metadata?: Record<string, any>;
};

const mapBackendImageResult = ({
  data,
  prompt,
  model,
  outputFormat,
}: {
  data: BackendImagePayload;
  prompt: string;
  model: string;
  outputFormat?: string;
}): AIImageResult => {
  const metadata: Record<string, any> = {
    ...(data.metadata ?? {}),
  };

  // 确保 imageData 带 data URI 前缀，避免裸 base64 无法直接展示
  const normalizedImageData =
    typeof data.imageData === "string" && data.imageData.trim().length > 0
      ? data.imageData.startsWith("data:")
        ? data.imageData
        : `data:image/${
            metadata.outputFormat || outputFormat || "png"
          };base64,${data.imageData}`
      : undefined;

  if (!metadata.outputFormat) {
    metadata.outputFormat = outputFormat || "png";
  }

  return {
    id: generateUUID(),
    imageData: normalizedImageData,
    textResponse: data.textResponse,
    prompt,
    model,
    createdAt: new Date(),
    hasImage: !!data.imageData,
    metadata,
  };
};

async function performGenerateImageRequest(
  request: AIImageGenerateRequest
): Promise<AIServiceResponse<AIImageResult>> {
  // 🔍 调试日志：前端发送的完整请求参数
  console.log("🚀 [Frontend → Backend] generate-image 请求参数:", {
    aiProvider: request.aiProvider,
    model: request.model,
    imageSize: request.imageSize,
    aspectRatio: request.aspectRatio,
    thinkingLevel: request.thinkingLevel,
    imageOnly: request.imageOnly,
    prompt: request.prompt?.substring(0, 50) + "...",
  });
  
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/generate-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    const resolvedModel = resolveDefaultModel(
      request.model,
      request.aiProvider
    );

    logAIImageResponse(
      {
        endpoint: "generate-image",
        provider: request.aiProvider,
        model: resolvedModel,
        prompt: request.prompt,
      },
      {
        imageData: data.imageData,
        textResponse: data.textResponse,
      }
    );

    // 构建返回结果
    return {
      success: true,
      data: mapBackendImageResult({
        data,
        prompt: request.prompt,
        model: resolvedModel,
        outputFormat: request.outputFormat || "png",
      }),
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 生成图像 - 通过后端 API（在缺少图像数据时自动补偿重试）
 */
export async function generateImageViaAPI(
  request: AIImageGenerateRequest
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    attempts = attempt;
    lastResponse = await performGenerateImageRequest(request);

    if (!lastResponse.success || !lastResponse.data) {
      logApiTiming("generate-image", startedAt, {
        success: false,
        attempts,
        provider: request.aiProvider,
        model: resolveDefaultModel(request.model, request.aiProvider),
        status: lastResponse.error?.code,
      });
      return lastResponse;
    }

    if (lastResponse.data.hasImage && lastResponse.data.imageData) {
      logApiTiming("generate-image", startedAt, {
        success: true,
        attempts,
        provider: request.aiProvider,
        model: lastResponse.data.model,
      });
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn(
        "⚠️ Flow generate success but no image returned, auto retrying",
        {
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: request.model,
          textResponse: lastResponse.data.textResponse,
        }
      );
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  logApiTiming("generate-image", startedAt, {
    success: lastResponse?.success ?? false,
    attempts,
    provider: request.aiProvider,
    model:
      lastResponse?.data?.model ||
      resolveDefaultModel(request.model, request.aiProvider),
  });
  return (
    lastResponse ?? {
      success: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "Image generation failed without a response",
        timestamp: new Date(),
      },
    }
  );
}

async function performEditImageRequest(
  request: AIImageEditRequest
): Promise<AIServiceResponse<AIImageResult>> {
  // 🔍 调试日志：前端发送的完整请求参数
  console.log("🚀 [Frontend → Backend] edit-image 请求参数:", {
    aiProvider: request.aiProvider,
    model: request.model,
    imageSize: request.imageSize,
    aspectRatio: request.aspectRatio,
    thinkingLevel: request.thinkingLevel,
    imageOnly: request.imageOnly,
    prompt: request.prompt?.substring(0, 50) + "...",
    sourceImageLength: request.sourceImage?.length || 0,
  });
  
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/edit-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    const resolvedModel = resolveDefaultModel(
      request.model,
      request.aiProvider
    );

    logAIImageResponse(
      {
        endpoint: "edit-image",
        provider: request.aiProvider,
        model: resolvedModel,
        prompt: request.prompt,
      },
      {
        imageData: data.imageData,
        textResponse: data.textResponse,
      }
    );

    return {
      success: true,
      data: mapBackendImageResult({
        data,
        prompt: request.prompt,
        model: resolvedModel,
        outputFormat: request.outputFormat || "png",
      }),
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 编辑图像 - 通过后端 API（在缺少图像数据时自动补偿重试）
 */
export async function editImageViaAPI(
  request: AIImageEditRequest
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    attempts = attempt;
    lastResponse = await performEditImageRequest(request);

    if (!lastResponse.success || !lastResponse.data) {
      logApiTiming("edit-image", startedAt, {
        success: false,
        attempts,
        provider: request.aiProvider,
        model: resolveDefaultModel(request.model, request.aiProvider),
        status: lastResponse.error?.code,
      });
      return lastResponse;
    }

    if (lastResponse.data.hasImage && lastResponse.data.imageData) {
      logApiTiming("edit-image", startedAt, {
        success: true,
        attempts,
        provider: request.aiProvider,
        model: lastResponse.data.model,
      });
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn(
        "⚠️ Edit image success but no image returned, auto retrying",
        {
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: request.model,
          textResponse: lastResponse.data.textResponse,
        }
      );
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  logApiTiming("edit-image", startedAt, {
    success: lastResponse?.success ?? false,
    attempts,
    provider: request.aiProvider,
    model:
      lastResponse?.data?.model ||
      resolveDefaultModel(request.model, request.aiProvider),
  });
  return (
    lastResponse ?? {
      success: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "Image edit failed without a response",
        timestamp: new Date(),
      },
    }
  );
}

async function performBlendImagesRequest(
  request: AIImageBlendRequest
): Promise<AIServiceResponse<AIImageResult>> {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/blend-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    const resolvedModel = resolveDefaultModel(
      request.model,
      request.aiProvider
    );

    logAIImageResponse(
      {
        endpoint: "blend-images",
        provider: request.aiProvider,
        model: resolvedModel,
        prompt: request.prompt,
      },
      {
        imageData: data.imageData,
        textResponse: data.textResponse,
      }
    );

    return {
      success: true,
      data: mapBackendImageResult({
        data,
        prompt: request.prompt,
        model: resolvedModel,
        outputFormat: request.outputFormat || "png",
      }),
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 融合图像 - 通过后端 API（在缺少图像数据时自动补偿重试）
 */
export async function blendImagesViaAPI(
  request: AIImageBlendRequest
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    attempts = attempt;
    lastResponse = await performBlendImagesRequest(request);

    if (!lastResponse.success || !lastResponse.data) {
      logApiTiming("blend-images", startedAt, {
        success: false,
        attempts,
        provider: request.aiProvider,
        model: resolveDefaultModel(request.model, request.aiProvider),
        status: lastResponse.error?.code,
      });
      return lastResponse;
    }

    if (lastResponse.data.hasImage && lastResponse.data.imageData) {
      logApiTiming("blend-images", startedAt, {
        success: true,
        attempts,
        provider: request.aiProvider,
        model: lastResponse.data.model,
      });
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn(
        "⚠️ Blend images success but no image returned, auto retrying",
        {
          nextAttempt: attempt + 1,
          maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
          provider: request.aiProvider,
          model: request.model,
          textResponse: lastResponse.data.textResponse,
        }
      );
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  logApiTiming("blend-images", startedAt, {
    success: lastResponse?.success ?? false,
    attempts,
    provider: request.aiProvider,
    model:
      lastResponse?.data?.model ||
      resolveDefaultModel(request.model, request.aiProvider),
  });
  return (
    lastResponse ?? {
      success: false,
      error: {
        code: "UNKNOWN_ERROR",
        message: "Image blend failed without a response",
        timestamp: new Date(),
      },
    }
  );
}

type MidjourneyActionParams = MidjourneyActionRequest & {
  displayPrompt?: string;
  actionLabel?: string;
};

export async function midjourneyActionViaAPI(
  params: MidjourneyActionParams
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  const { displayPrompt, actionLabel, ...payload } = params;

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/midjourney/action`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("midjourney-action", startedAt, {
        success: false,
        status: response.status,
        action: actionLabel,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    const mapped = mapBackendImageResult({
      data,
      prompt: displayPrompt || actionLabel || "Midjourney 操作",
      model: MIDJOURNEY_IMAGE_MODEL,
    });

    mapped.metadata = {
      ...(mapped.metadata ?? {}),
      actionLabel,
    };

    logApiTiming("midjourney-action", startedAt, {
      success: true,
      action: actionLabel,
    });

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    logApiTiming("midjourney-action", startedAt, {
      success: false,
      action: actionLabel,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

type MidjourneyModalParams = MidjourneyModalRequest & {
  displayPrompt?: string;
};

export async function midjourneyModalViaAPI(
  params: MidjourneyModalParams
): Promise<AIServiceResponse<AIImageResult>> {
  const startedAt = getTimestamp();
  const { displayPrompt, ...payload } = params;

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/midjourney/modal`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("midjourney-modal", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    const mapped = mapBackendImageResult({
      data,
      prompt: displayPrompt || "Midjourney 调整",
      model: MIDJOURNEY_IMAGE_MODEL,
    });

    logApiTiming("midjourney-modal", startedAt, {
      success: true,
    });

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    logApiTiming("midjourney-modal", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 分析图像 - 通过后端 API
 */
export async function analyzeImageViaAPI(
  request: AIImageAnalyzeRequest
): Promise<AIServiceResponse<AIImageAnalysisResult>> {
  const startedAt = getTimestamp();
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/analyze-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("analyze-image", startedAt, {
        success: false,
        status: response.status,
        provider: request.aiProvider,
        model: request.model,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    logApiTiming("analyze-image", startedAt, {
      success: true,
      provider: request.aiProvider,
      model: request.model,
      textLength: typeof data?.text === "string" ? data.text.length : undefined,
    });

    return {
      success: true,
      data: {
        analysis: data.text,
        confidence: 0.95,
        tags: [],
      },
    };
  } catch (error) {
    logApiTiming("analyze-image", startedAt, {
      success: false,
      provider: request.aiProvider,
      model: request.model,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 文本对话 - 通过后端 API
 */
export async function generateTextResponseViaAPI(
  request: AITextChatRequest
): Promise<AIServiceResponse<AITextChatResult>> {
  const startedAt = getTimestamp();
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/text-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("text-chat", startedAt, {
        success: false,
        status: response.status,
        provider: request.aiProvider,
        model: request.model,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();

    logApiTiming("text-chat", startedAt, {
      success: true,
      provider: request.aiProvider,
      model: request.model || "gemini-2.5-flash",
      textLength: typeof data?.text === "string" ? data.text.length : undefined,
    });

    return {
      success: true,
      data: {
        text: data.text,
        model: "gemini-2.5-flash",
        webSearchResult: data.webSearchResult || undefined,
      },
    };
  } catch (error) {
    logApiTiming("text-chat", startedAt, {
      success: false,
      provider: request.aiProvider,
      model: request.model,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

export interface VideoGenerationRequest {
  prompt: string;
  referenceImageUrls?: string[];
  quality?: "hd" | "sd";
  /** 画面比例，仅极速 Sora2 使用。例如 '16:9' | '9:16' */
  aspectRatio?: "16:9" | "9:16";
  /** 时长（秒，仅极速 Sora2 使用）。字符串形式以兼容后端 DTO。 */
  duration?: "10" | "15" | "25";
}

export interface VideoGenerationResult {
  videoUrl: string;
  content: string;
  referencedUrls: string[];
  thumbnailUrl?: string;
  status?: string;
  taskId?: string;
  taskInfo?: Record<string, any> | null;
  /** 备选方案提示信息 */
  fallbackMessage?: string;
}

export async function generateVideoViaAPI(
  request: VideoGenerationRequest
): Promise<AIServiceResponse<VideoGenerationResult>> {
  const startedAt = getTimestamp();
  try {
    const referenceImageUrls = (request.referenceImageUrls || []).filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0
    );
    const payload: VideoGenerationRequest = {
      ...request,
      referenceImageUrls: referenceImageUrls.length
        ? referenceImageUrls
        : undefined,
    };

    const response = await fetchWithAuth(`${API_BASE_URL}/ai/generate-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-video", startedAt, {
        success: false,
        status: response.status,
        quality: request.quality,
        references: referenceImageUrls.length,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-video", startedAt, {
      success: true,
      quality: request.quality,
      references: referenceImageUrls.length,
      hasThumbnail: Boolean((data as any)?.thumbnailUrl),
    });
    return {
      success: true,
      data,
    };
  } catch (error) {
    logApiTiming("generate-video", startedAt, {
      success: false,
      quality: request.quality,
      references: Array.isArray(request.referenceImageUrls)
        ? request.referenceImageUrls.length
        : 0,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 调用后端代理的 DashScope Wan2.6-t2v 文生视频接口
 */
export async function generateWan26T2VViaAPI(request: {
  prompt: string;
  audioUrl?: string;
  parameters?: {
    size?: string;
    duration?: 5 | 10;
    shot_type?: "single" | "multi";
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest = {
    model: "wan2.6-t2v",
    input: {
      prompt: request.prompt,
      ...(request.audioUrl && { audio_url: request.audioUrl }),
    },
    parameters: request.parameters || {},
  };

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-wan26-t2v`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-wan2-6-t2v", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-wan2-6-t2v", startedAt, { success: true });
    return data;
  } catch (error) {
    logApiTiming("generate-wan2-6-t2v", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 调用后端代理的 DashScope Wan2.6-i2v 图生视频接口
 */
export async function generateWan26I2VViaAPI(request: {
  prompt: string;
  imgUrl: string;
  audioUrl?: string;
  parameters?: {
    resolution?: "720P" | "1080P";
    duration?: 5 | 10 | 15;
    shot_type?: "single" | "multi";
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest = {
    model: "wan2.6-i2v",
    input: {
      img_url: request.imgUrl,
      prompt: request.prompt,
      ...(request.audioUrl && { audio_url: request.audioUrl }),
    },
    parameters: request.parameters || {},
  };

  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-wan2-6-i2v`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-wan2-6-i2v", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-wan2-6-i2v", startedAt, { success: true });
    return data;
  } catch (error) {
    logApiTiming("generate-wan2-6-i2v", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 调用后端代理的 DashScope Wan2.6 统一接口
 * 前端根据是否有 imgUrl 自动判断调用 T2V 还是 I2V
 */
export async function generateWan26ViaAPI(request: {
  prompt: string;
  imgUrl?: string;
  audioUrl?: string;
  parameters?: {
    size?: string;
    resolution?: string;
    duration?: number;
    shot_type?: "single" | "multi";
  };
}): Promise<AIServiceResponse<any>> {
  const sizeMapping: Record<string, string> = {
    "16:9": "1280*720",
    "9:16": "720*1280",
    "1:1": "960*960",
    "4:3": "1088*832",
    "3:4": "832*1088",
  };

  if (request.imgUrl) {
    return generateWan26I2VViaAPI({
      prompt: request.prompt,
      imgUrl: request.imgUrl,
      audioUrl: request.audioUrl,
      parameters: {
        resolution: request.parameters?.resolution as
          | "720P"
          | "1080P"
          | undefined,
        duration: request.parameters?.duration as 5 | 10 | 15 | undefined,
        shot_type: request.parameters?.shot_type,
      },
    });
  } else {
    const mappedSize = request.parameters?.size
      ? sizeMapping[request.parameters.size] || request.parameters.size
      : undefined;

    return generateWan26T2VViaAPI({
      prompt: request.prompt,
      audioUrl: request.audioUrl,
      parameters: {
        size: mappedSize,
        duration: request.parameters?.duration as 5 | 10 | undefined,
        shot_type: request.parameters?.shot_type,
      },
    });
  }
}

/**
 * 调用后端代理的 DashScope Wan2.6-r2v 参考视频生成视频接口
 */
export async function generateWan26R2VViaAPI(request: {
  prompt: string;
  referenceVideoUrls: string[];
  parameters?: {
    size?: string;
    duration?: 5 | 10;
    shot_type?: "single" | "multi";
  };
}): Promise<AIServiceResponse<any>> {
  const startedAt = getTimestamp();
  const dashscopeRequest = {
    model: "wan2.6-r2v",
    input: {
      prompt: request.prompt,
      reference_video_urls: request.referenceVideoUrls,
    },
    parameters: request.parameters || {},
  };
  try {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/ai/dashscope/generate-wan2-6-r2v`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dashscopeRequest),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("generate-wan2-6-r2v", startedAt, {
        success: false,
        status: response.status,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data = await response.json();
    logApiTiming("generate-wan2-6-r2v", startedAt, { success: true });
    // 直接返回后端响应，不再二次包装
    return data;
  } catch (error) {
    logApiTiming("generate-wan2-6-r2v", startedAt, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

// ==================== 统一 Chat 接口 ====================

/**
 * 统一 Chat 模式
 */
export type UnifiedChatMode =
  | "auto"
  | "text"
  | "generate"
  | "edit"
  | "blend"
  | "analyze"
  | "video"
  | "vector"
  | "pdf";

/**
 * 统一 Chat 工具类型
 */
export type UnifiedChatTool =
  | "generateImage"
  | "editImage"
  | "blendImages"
  | "analyzeImage"
  | "chatResponse"
  | "generateVideo"
  | "generatePaperJS"
  | "analyzePdf";

/**
 * 统一 Chat 附件
 */
export interface UnifiedChatAttachments {
  images?: string[]; // base64 图片数组
  pdf?: string; // base64 PDF
  pdfFileName?: string;
}

/**
 * 图片生成选项
 */
export interface UnifiedImageOptions {
  aspectRatio?:
    | "1:1"
    | "2:3"
    | "3:2"
    | "3:4"
    | "4:3"
    | "4:5"
    | "5:4"
    | "9:16"
    | "16:9"
    | "21:9";
  imageSize?: "1K" | "2K" | "4K";
  outputFormat?: "jpeg" | "png" | "webp";
  thinkingLevel?: "high" | "low";
  imageOnly?: boolean;
}

/**
 * 视频生成选项
 */
export interface UnifiedVideoOptions {
  quality?: "hd" | "sd";
  aspectRatio?: "16:9" | "9:16";
  duration?: "10" | "15" | "25";
  referenceImageUrls?: string[];
}

/**
 * 矢量图生成选项
 */
export interface UnifiedVectorOptions {
  thinkingLevel?: "high" | "low";
  canvasWidth?: number;
  canvasHeight?: number;
}

/**
 * 统一 Chat 请求
 */
export interface UnifiedChatRequest {
  prompt: string;
  mode?: UnifiedChatMode;
  attachments?: UnifiedChatAttachments;
  aiProvider?: SupportedAIProvider;
  model?: string;
  imageOptions?: UnifiedImageOptions;
  videoOptions?: UnifiedVideoOptions;
  vectorOptions?: UnifiedVectorOptions;
  context?: string;
  enableWebSearch?: boolean;
  providerOptions?: Record<string, unknown>;
}

/**
 * 统一 Chat 响应数据
 */
export interface UnifiedChatResponseData {
  text?: string;
  imageData?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  code?: string;
  explanation?: string;
  analysis?: string;
  metadata?: Record<string, unknown>;
  webSearchResult?: unknown;
}

/**
 * 统一 Chat 响应
 */
export interface UnifiedChatResponse {
  success: boolean;
  tool: UnifiedChatTool;
  data: UnifiedChatResponseData;
  reasoning?: string;
  model?: string;
  provider?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 统一 Chat API - 整合所有 AI 功能的单一入口
 *
 * 优势：
 * - 前端只需一次 API 调用
 * - 后端自动判断意图并执行对应操作
 * - 统一的请求和响应格式
 *
 * @example
 * // 文生图
 * const result = await unifiedChatViaAPI({
 *   prompt: "画一只可爱的猫",
 *   mode: "auto", // 后端自动判断为 generateImage
 * });
 *
 * @example
 * // 图片编辑
 * const result = await unifiedChatViaAPI({
 *   prompt: "把背景改成蓝色",
 *   attachments: { images: [base64Image] },
 *   mode: "edit",
 * });
 *
 * @example
 * // 文本对话
 * const result = await unifiedChatViaAPI({
 *   prompt: "你好",
 *   mode: "text",
 * });
 */
export async function unifiedChatViaAPI(
  request: UnifiedChatRequest
): Promise<AIServiceResponse<UnifiedChatResponse>> {
  const startedAt = getTimestamp();

  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("unified-chat", startedAt, {
        success: false,
        status: response.status,
        mode: request.mode,
        provider: request.aiProvider,
      });
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: errorData?.message || `HTTP ${response.status}`,
          timestamp: new Date(),
        },
      };
    }

    const data: UnifiedChatResponse = await response.json();

    logApiTiming("unified-chat", startedAt, {
      success: data.success,
      tool: data.tool,
      mode: request.mode,
      provider: request.aiProvider,
      model: data.model,
    });

    // 如果后端返回了错误
    if (!data.success) {
      return {
        success: false,
        error: {
          code: data.error?.code || "CHAT_ERROR",
          message: data.error?.message || "Chat failed",
          timestamp: new Date(),
        },
      };
    }

    // 处理图片数据格式 - 确保带 data URI 前缀
    if (data.data.imageData) {
      const imageData = data.data.imageData;
      if (!imageData.startsWith("data:")) {
        data.data.imageData = `data:image/png;base64,${imageData}`;
      }
    }

    return {
      success: true,
      data,
    };
  } catch (error) {
    logApiTiming("unified-chat", startedAt, {
      success: false,
      mode: request.mode,
      provider: request.aiProvider,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Network error",
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 将统一 Chat 响应转换为 AIImageResult 格式
 * 用于兼容现有的消息系统
 */
export function mapUnifiedChatToImageResult(
  response: UnifiedChatResponse,
  prompt: string
): AIImageResult {
  return {
    id: generateUUID(),
    imageData: response.data.imageData,
    textResponse:
      response.data.text ||
      response.data.analysis ||
      response.data.explanation,
    prompt,
    model: response.model || "unknown",
    createdAt: new Date(),
    hasImage: !!response.data.imageData,
    metadata: {
      tool: response.tool,
      provider: response.provider,
      ...(response.data.metadata || {}),
    },
  };
}

// ==================== SSE 流式 Chat 接口 ====================

/**
 * SSE 事件类型
 */
export type SSEEventType =
  | "start" // 开始处理
  | "tool" // 工具选择完成
  | "chunk" // 文本内容块
  | "image" // 图片数据
  | "video" // 视频数据
  | "code" // 代码数据
  | "done" // 完成
  | "error"; // 错误

/**
 * SSE 事件数据
 */
export interface SSEEventData {
  type: SSEEventType;

  // start 事件
  tool?: UnifiedChatTool;
  model?: string;
  provider?: string;

  // chunk 事件 - 增量文本
  text?: string;

  // image 事件
  imageData?: string;

  // video 事件
  videoUrl?: string;
  thumbnailUrl?: string;

  // code 事件
  code?: string;
  explanation?: string;

  // done 事件 - 完整响应
  data?: UnifiedChatResponseData;
  reasoning?: string;

  // error 事件
  error?: {
    code: string;
    message: string;
  };
}

/**
 * SSE 流式回调函数类型
 */
export interface SSECallbacks {
  /** 开始处理时调用 */
  onStart?: (data: {
    tool: UnifiedChatTool;
    model?: string;
    provider?: string;
  }) => void;

  /** 收到文本块时调用 */
  onChunk?: (text: string) => void;

  /** 收到图片时调用 */
  onImage?: (data: { imageData: string; text?: string }) => void;

  /** 收到视频时调用 */
  onVideo?: (data: { videoUrl: string; thumbnailUrl?: string }) => void;

  /** 收到代码时调用 */
  onCode?: (data: { code: string; explanation?: string }) => void;

  /** 完成时调用 */
  onDone?: (data: UnifiedChatResponseData) => void;

  /** 错误时调用 */
  onError?: (error: { code: string; message: string }) => void;
}

/**
 * 统一 Chat SSE 流式 API
 * 支持实时文字流式输出，适用于纯文本对话和图片分析
 *
 * @example
 * // 流式文本对话
 * await unifiedChatStreamViaAPI(
 *   { prompt: "你好", mode: "text" },
 *   {
 *     onChunk: (text) => console.log("收到文本:", text),
 *     onDone: (data) => console.log("完成:", data),
 *   }
 * );
 */
export async function unifiedChatStreamViaAPI(
  request: UnifiedChatRequest,
  callbacks: SSECallbacks
): Promise<void> {
  const startedAt = getTimestamp();

  try {
    // 使用 credentials: 'include' 携带 cookie 认证（与 fetchWithAuth 保持一致）
    const response = await fetch(`${API_BASE_URL}/ai/chat-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logApiTiming("unified-chat-stream", startedAt, {
        success: false,
        status: response.status,
        mode: request.mode,
        provider: request.aiProvider,
      });

      callbacks.onError?.({
        code: `HTTP_${response.status}`,
        message: errorData?.message || `HTTP ${response.status}`,
      });
      return;
    }

    if (!response.body) {
      callbacks.onError?.({
        code: "NO_BODY",
        message: "Response body is null",
      });
      return;
    }

    // 读取 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 数据行
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // 保留未完整的行

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          if (jsonStr.trim()) {
            try {
              const event: SSEEventData = JSON.parse(jsonStr);
              handleSSEEvent(event, callbacks);
            } catch (parseError) {
              console.warn("SSE parse error:", parseError, "line:", line);
            }
          }
        }
      }
    }

    // 处理剩余的 buffer
    if (buffer.startsWith("data: ")) {
      const jsonStr = buffer.slice(6);
      if (jsonStr.trim()) {
        try {
          const event: SSEEventData = JSON.parse(jsonStr);
          handleSSEEvent(event, callbacks);
        } catch (parseError) {
          console.warn("SSE parse error (final):", parseError);
        }
      }
    }

    logApiTiming("unified-chat-stream", startedAt, {
      success: true,
      mode: request.mode,
      provider: request.aiProvider,
    });
  } catch (error) {
    logApiTiming("unified-chat-stream", startedAt, {
      success: false,
      mode: request.mode,
      provider: request.aiProvider,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    callbacks.onError?.({
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "Network error",
    });
  }
}

/**
 * 处理单个 SSE 事件
 */
function handleSSEEvent(event: SSEEventData, callbacks: SSECallbacks): void {
  switch (event.type) {
    case "start":
      callbacks.onStart?.({
        tool: event.tool!,
        model: event.model,
        provider: event.provider,
      });
      break;

    case "chunk":
      if (event.text) {
        callbacks.onChunk?.(event.text);
      }
      break;

    case "image":
      if (event.imageData) {
        // 确保 imageData 带 data URI 前缀
        let imageData = event.imageData;
        if (!imageData.startsWith("data:")) {
          imageData = `data:image/png;base64,${imageData}`;
        }
        callbacks.onImage?.({
          imageData,
          text: event.text,
        });
      }
      break;

    case "video":
      if (event.videoUrl) {
        callbacks.onVideo?.({
          videoUrl: event.videoUrl,
          thumbnailUrl: event.thumbnailUrl,
        });
      }
      break;

    case "code":
      if (event.code) {
        callbacks.onCode?.({
          code: event.code,
          explanation: event.explanation,
        });
      }
      break;

    case "done":
      if (event.data) {
        // 处理图片数据格式
        if (event.data.imageData && !event.data.imageData.startsWith("data:")) {
          event.data.imageData = `data:image/png;base64,${event.data.imageData}`;
        }
        callbacks.onDone?.(event.data);
      }
      break;

    case "error":
      callbacks.onError?.(
        event.error || { code: "UNKNOWN", message: "Unknown error" }
      );
      break;
  }
}
