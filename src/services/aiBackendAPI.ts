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
 * 生成图像 - 通过后端 API
 */
export async function generateImageViaAPI(request: AIImageGenerateRequest): Promise<AIServiceResponse<AIImageResult>> {
  try {
    const response = await fetch(`${API_BASE_URL}/ai/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
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

    // 构建返回结果
    return {
      success: true,
      data: {
        id: crypto.randomUUID(),
        imageData: data.imageData,
        textResponse: data.textResponse,
        prompt: request.prompt,
        model: request.model || 'gemini-2.5-flash-image',
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
    const response = await fetch(`${API_BASE_URL}/ai/edit-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
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
        id: crypto.randomUUID(),
        imageData: data.imageData,
        textResponse: data.textResponse,
        prompt: request.prompt,
        model: request.model || 'gemini-2.5-flash-image',
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
    const response = await fetch(`${API_BASE_URL}/ai/blend-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
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
        id: crypto.randomUUID(),
        imageData: data.imageData,
        textResponse: data.textResponse,
        prompt: request.prompt,
        model: request.model || 'gemini-2.5-flash-image',
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
    const response = await fetch(`${API_BASE_URL}/ai/analyze-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
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
    const response = await fetch(`${API_BASE_URL}/ai/text-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
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
