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
      model: request.model || "gemini-3-flash-preview",
      textLength: typeof data?.text === "string" ? data.text.length : undefined,
    });

    return {
      success: true,
      data: {
        text: data.text,
        model: request.model || "gemini-3-flash-preview",
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
