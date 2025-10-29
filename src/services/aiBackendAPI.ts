/**
 * 后端 AI API 调用适配层
 * 将前端的本地调用改为调用后端 API
 */

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
} from '@/types/ai';

const API_BASE_URL = '/api';

/**
 * 执行带有自动令牌刷新的 fetch 请求
 * 如果收到 401，尝试刷新令牌并重试
 */
async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...(init || {}), credentials: 'include' });

  if (res.status !== 401) {
    return res;
  }

  // 尝试刷新令牌
  try {
    const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (refreshRes.ok) {
      // 令牌刷新成功，重试原始请求
      return fetch(input, { ...(init || {}), credentials: 'include' });
    }
  } catch (error) {
    // 刷新失败，继续返回原始 401 响应
    console.error('Token refresh failed:', error);
  }

  // 返回原始的 401 响应
  return res;
}

/**
 * 生成图像 - 通过后端 API
 */
export async function generateImageViaAPI(request: AIImageGenerateRequest): Promise<AIServiceResponse<AIImageResult>> {
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

    const resolvedModel =
      request.model || (request.aiProvider === 'runninghub' ? 'runninghub-su-effect' : 'gemini-2.5-flash-image');

    // 构建返回结果
    return {
      success: true,
      data: {
        id: crypto.randomUUID(),
        imageData: data.imageData,
        textResponse: data.textResponse,
        prompt: request.prompt,
        model: resolvedModel,
        createdAt: new Date(),
        hasImage: !!data.imageData,
        metadata: {
          outputFormat: request.outputFormat || 'png',
        },
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
 * 编辑图像 - 通过后端 API
 */
export async function editImageViaAPI(request: AIImageEditRequest): Promise<AIServiceResponse<AIImageResult>> {
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

    const resolvedModel =
      request.model || (request.aiProvider === 'runninghub' ? 'runninghub-su-effect' : 'gemini-2.5-flash-image');

    return {
      success: true,
      data: {
        id: crypto.randomUUID(),
        imageData: data.imageData,
        textResponse: data.textResponse,
        prompt: request.prompt,
        model: resolvedModel,
        createdAt: new Date(),
        hasImage: !!data.imageData,
        metadata: {
          outputFormat: request.outputFormat || 'png',
        },
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
 * 融合图像 - 通过后端 API
 */
export async function blendImagesViaAPI(request: AIImageBlendRequest): Promise<AIServiceResponse<AIImageResult>> {
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

    const resolvedModel =
      request.model || (request.aiProvider === 'runninghub' ? 'runninghub-su-effect' : 'gemini-2.5-flash-image');

    return {
      success: true,
      data: {
        id: crypto.randomUUID(),
        imageData: data.imageData,
        textResponse: data.textResponse,
        prompt: request.prompt,
        model: resolvedModel,
        createdAt: new Date(),
        hasImage: !!data.imageData,
        metadata: {
          outputFormat: request.outputFormat || 'png',
        },
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
        model: 'gemini-2.0-flash',
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
