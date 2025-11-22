/**
 * 后端 AI API 调用适配层
 * 将前端的本地调用改为调用后端 API
 */

import { v4 as uuidv4 } from 'uuid';
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
} from '@/types/ai';
import { fetchWithAuth } from './authFetch';

const API_BASE_URL = '/api';
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
const RUNNINGHUB_IMAGE_MODEL = 'runninghub-su-effect';
const MIDJOURNEY_IMAGE_MODEL = 'midjourney-fast';

type ImageResponseLogMeta = {
  endpoint: string;
  provider?: SupportedAIProvider;
  model?: string;
  prompt?: string;
};

const truncateText = (value: string, maxLength: number = 80) =>
  typeof value === 'string' && value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const logAIImageResponse = (
  meta: ImageResponseLogMeta,
  payload: { imageData?: string; textResponse?: string }
) => {
  const hasImageData = typeof payload.imageData === 'string' && payload.imageData.trim().length > 0;
  const textResponse =
    typeof payload.textResponse === 'string' && payload.textResponse.trim().length > 0
      ? payload.textResponse
      : '';
  const logger = hasImageData ? console.log : console.warn;

  logger(`${hasImageData ? '🖼️' : '📝'} [AI API] ${meta.endpoint} 响应摘要`, {
    provider: meta.provider || 'unknown',
    model: meta.model || 'unspecified',
    promptPreview: meta.prompt ? truncateText(meta.prompt, 60) : 'N/A',
    hasImageData,
    imageDataLength: payload.imageData?.length || 0,
    textResponsePreview: textResponse ? truncateText(textResponse, 80) : 'N/A'
  });

  console.log(`🧾 [AI API] ${meta.endpoint} 返回详情`, {
    textResponse: textResponse || '(无文本返回)',
    hasImage: hasImageData
  });
};

const generateUUID = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore and fall back
  }

  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex
        .slice(8, 10)
        .join('')}-${hex.slice(10, 16).join('')}`;
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
  if (provider === 'runninghub') return RUNNINGHUB_IMAGE_MODEL;
  if (provider === 'midjourney') return MIDJOURNEY_IMAGE_MODEL;
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

  if (!metadata.outputFormat) {
    metadata.outputFormat = outputFormat || 'png';
  }

  return {
    id: generateUUID(),
    imageData: data.imageData,
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
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    const resolvedModel = resolveDefaultModel(request.model, request.aiProvider);

    logAIImageResponse(
      {
        endpoint: 'generate-image',
        provider: request.aiProvider,
        model: resolvedModel,
        prompt: request.prompt
      },
      {
        imageData: data.imageData,
        textResponse: data.textResponse
      }
    );

    // 构建返回结果
    return {
      success: true,
      data: mapBackendImageResult({
        data,
        prompt: request.prompt,
        model: resolvedModel,
        outputFormat: request.outputFormat || 'png',
      }),
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
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
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    lastResponse = await performGenerateImageRequest(request);

    if (!lastResponse.success || !lastResponse.data) {
      return lastResponse;
    }

    if (lastResponse.data.hasImage && lastResponse.data.imageData) {
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn('⚠️ Flow generate success but no image returned, auto retrying', {
        nextAttempt: attempt + 1,
        maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
        provider: request.aiProvider,
        model: request.model,
        textResponse: lastResponse.data.textResponse,
      });
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  return lastResponse ?? {
    success: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'Image generation failed without a response',
      timestamp: new Date(),
    },
  };
}

async function performEditImageRequest(
  request: AIImageEditRequest
): Promise<AIServiceResponse<AIImageResult>> {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/edit-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    const resolvedModel = resolveDefaultModel(request.model, request.aiProvider);

    logAIImageResponse(
      {
        endpoint: 'edit-image',
        provider: request.aiProvider,
        model: resolvedModel,
        prompt: request.prompt
      },
      {
        imageData: data.imageData,
        textResponse: data.textResponse
      }
    );

    return {
      success: true,
      data: mapBackendImageResult({
        data,
        prompt: request.prompt,
        model: resolvedModel,
        outputFormat: request.outputFormat || 'png',
      }),
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 编辑图像 - 通过后端 API（在缺少图像数据时自动补偿重试）
 */
export async function editImageViaAPI(request: AIImageEditRequest): Promise<AIServiceResponse<AIImageResult>> {
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    lastResponse = await performEditImageRequest(request);

    if (!lastResponse.success || !lastResponse.data) {
      return lastResponse;
    }

    if (lastResponse.data.hasImage && lastResponse.data.imageData) {
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn('⚠️ Edit image success but no image returned, auto retrying', {
        nextAttempt: attempt + 1,
        maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
        provider: request.aiProvider,
        model: request.model,
        textResponse: lastResponse.data.textResponse,
      });
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  return lastResponse ?? {
    success: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'Image edit failed without a response',
      timestamp: new Date(),
    },
  };
}

async function performBlendImagesRequest(
  request: AIImageBlendRequest
): Promise<AIServiceResponse<AIImageResult>> {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/blend-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    const resolvedModel = resolveDefaultModel(request.model, request.aiProvider);

    logAIImageResponse(
      {
        endpoint: 'blend-images',
        provider: request.aiProvider,
        model: resolvedModel,
        prompt: request.prompt
      },
      {
        imageData: data.imageData,
        textResponse: data.textResponse
      }
    );

    return {
      success: true,
      data: mapBackendImageResult({
        data,
        prompt: request.prompt,
        model: resolvedModel,
        outputFormat: request.outputFormat || 'png',
      }),
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 融合图像 - 通过后端 API（在缺少图像数据时自动补偿重试）
 */
export async function blendImagesViaAPI(request: AIImageBlendRequest): Promise<AIServiceResponse<AIImageResult>> {
  let lastResponse: AIServiceResponse<AIImageResult> | undefined;

  for (let attempt = 1; attempt <= MAX_IMAGE_GENERATION_ATTEMPTS; attempt++) {
    lastResponse = await performBlendImagesRequest(request);

    if (!lastResponse.success || !lastResponse.data) {
      return lastResponse;
    }

    if (lastResponse.data.hasImage && lastResponse.data.imageData) {
      return lastResponse;
    }

    if (attempt < MAX_IMAGE_GENERATION_ATTEMPTS) {
      console.warn('⚠️ Blend images success but no image returned, auto retrying', {
        nextAttempt: attempt + 1,
        maxAttempts: MAX_IMAGE_GENERATION_ATTEMPTS,
        provider: request.aiProvider,
        model: request.model,
        textResponse: lastResponse.data.textResponse,
      });
      await sleep(NO_IMAGE_RETRY_DELAY_MS);
    }
  }

  return lastResponse ?? {
    success: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message: 'Image blend failed without a response',
      timestamp: new Date(),
    },
  };
}

type MidjourneyActionParams = MidjourneyActionRequest & {
  displayPrompt?: string;
  actionLabel?: string;
};

export async function midjourneyActionViaAPI(
  params: MidjourneyActionParams
): Promise<AIServiceResponse<AIImageResult>> {
  const { displayPrompt, actionLabel, ...payload } = params;

  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/midjourney/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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
    const mapped = mapBackendImageResult({
      data,
      prompt: displayPrompt || actionLabel || 'Midjourney 操作',
      model: MIDJOURNEY_IMAGE_MODEL,
    });

    mapped.metadata = {
      ...(mapped.metadata ?? {}),
      actionLabel,
    };

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
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
  const { displayPrompt, ...payload } = params;

  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/midjourney/modal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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
    const mapped = mapBackendImageResult({
      data,
      prompt: displayPrompt || 'Midjourney 调整',
      model: MIDJOURNEY_IMAGE_MODEL,
    });

    return {
      success: true,
      data: mapped,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 分析图像 - 通过后端 API
 */
export async function analyzeImageViaAPI(request: AIImageAnalyzeRequest): Promise<AIServiceResponse<AIImageAnalysisResult>> {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/analyze-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    return {
      success: true,
      data: {
        analysis: data.text,
        confidence: 0.95,
        tags: [],
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
        timestamp: new Date(),
      },
    };
  }
}

/**
 * 文本对话 - 通过后端 API
 */
export async function generateTextResponseViaAPI(request: AITextChatRequest): Promise<AIServiceResponse<AITextChatResult>> {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ai/text-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    return {
      success: true,
      data: {
        text: data.text,
        model: 'gemini-2.5-flash',
        webSearchResult: data.webSearchResult || undefined,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
        timestamp: new Date(),
      },
    };
  }
}
