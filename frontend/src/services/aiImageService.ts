/**
 * AI 图像服务 - 简化版
 * 所有复杂逻辑已迁移到后端
 * 前端仅负责简单的 HTTP 调用和类型转换
 *
 * 支持多模型调用方式:
 * 1. 内部调用 (带身份认证): /api/ai/generate-image
 * 2. 公开调用 (无需认证): /api/public/ai/generate
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AIImageGenerateRequest,
  AIImageEditRequest,
  AIImageBlendRequest,
  AIImageAnalyzeRequest,
  AITextChatRequest,
  AIPaperJSGenerateRequest,
  AIImg2VectorRequest,
  AIImageResult,
  AIImageAnalysisResult,
  AITextChatResult,
  AIPaperJSResult,
  AIImg2VectorResult,
  AIServiceResponse,
  AIError,
  ToolSelectionRequest,
  ToolSelectionResult,
} from '@/types/ai';

const PUBLIC_ENDPOINT_MAP: Record<string, string> = {
  '/ai/generate-image': '/generate',
  '/ai/edit-image': '/edit',
  '/ai/blend-images': '/blend',
  '/ai/analyze-image': '/analyze',
  '/ai/text-chat': '/chat',
};

// 网络错误重试配置
const MAX_NETWORK_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// 判断是否为可重试的网络错误
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    'fetch',
    'network',
    'timeout',
    'econnreset',
    'etimedout',
    'enotfound',
    'econnrefused',
    'socket',
    'connection',
    'aborted',
  ];
  return retryablePatterns.some(pattern => message.includes(pattern));
}

// 延迟函数
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class AIImageService {
  private readonly API_BASE = import.meta.env.VITE_API_BASE || '/api';
  private readonly PUBLIC_API_BASE = '/api/public/ai';

  /**
   * 生成图像 - 使用内部认证 API
   */
  async generateImage(request: AIImageGenerateRequest): Promise<AIServiceResponse<AIImageResult>> {
    const response = await this.callAPI<AIImageResult>(
      `${this.API_BASE}/ai/generate-image`,
      request,
      'Image generation'
    );
    this.logImageResponse('Image generation', response);
    return response;
  }

  /**
   * 编辑图像 - 使用内部认证 API
   */
  async editImage(request: AIImageEditRequest): Promise<AIServiceResponse<AIImageResult>> {
    const response = await this.callAPI<AIImageResult>(
      `${this.API_BASE}/ai/edit-image`,
      request,
      'Image editing'
    );
    this.logImageResponse('Image editing', response);
    return response;
  }

  /**
   * 融合图像 - 使用内部认证 API
   */
  async blendImages(request: AIImageBlendRequest): Promise<AIServiceResponse<AIImageResult>> {
    const response = await this.callAPI<AIImageResult>(
      `${this.API_BASE}/ai/blend-images`,
      request,
      'Image blending'
    );
    this.logImageResponse('Image blending', response);
    return response;
  }

  /**
   * 分析图像 - 使用内部认证 API
   * 后端目前返回的数据字段在不同路径下不一致（可能是 text 或 analysis），
   * 这里统一归一化为 AIImageAnalysisResult，避免调用方做额外判断。
   */
  async analyzeImage(request: AIImageAnalyzeRequest): Promise<AIServiceResponse<AIImageAnalysisResult>> {
    const response = await this.callAPI<any>(
      `${this.API_BASE}/ai/analyze-image`,
      request,
      'Image analysis'
    );

    if (!response.success || !response.data) {
      return response as AIServiceResponse<AIImageAnalysisResult>;
    }

    const raw = response.data as Partial<AIImageAnalysisResult> & {
      text?: string;
      textResponse?: string;
      result?: string;
    };

    const analysisText =
      typeof raw.analysis === 'string' && raw.analysis.length
        ? raw.analysis
        : typeof raw.text === 'string' && raw.text.length
        ? raw.text
        : typeof raw.textResponse === 'string' && raw.textResponse.length
        ? raw.textResponse
        : typeof raw.result === 'string'
        ? raw.result
        : '';

    return {
      success: true,
      data: {
        analysis: analysisText,
        confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
        tags: Array.isArray(raw.tags) ? raw.tags : [],
      },
    };
  }

  /**
   * 文本对话 - 使用内部认证 API
   */
  async generateTextResponse(request: AITextChatRequest): Promise<AIServiceResponse<AITextChatResult>> {
    return this.callAPI<AITextChatResult>(
      `${this.API_BASE}/ai/text-chat`,
      request,
      'Text generation'
    );
  }

  /**
   * 工具选择 - 使用内部认证 API
   */
  async selectTool(request: ToolSelectionRequest): Promise<AIServiceResponse<ToolSelectionResult>> {
    // 转换请求格式以匹配后端期望的结构
    const backendRequest = {
      prompt: request.userInput || request.prompt || '',
      aiProvider: request.aiProvider,
      model: request.model,
      hasImages: request.hasImages,
      imageCount: request.imageCount,
      hasCachedImage: request.hasCachedImage,
      availableTools: request.availableTools,
      context: request.context,
    };

    const response = await this.callAPI<ToolSelectionResult>(
      `${this.API_BASE}/ai/tool-selection`,
      backendRequest,
      'Tool selection'
    );

    if (
      !response.success &&
      response.error?.code &&
      ['HTTP_401', 'HTTP_403', 'PUBLIC_HTTP_401', 'PUBLIC_HTTP_403'].includes(response.error.code)
    ) {
      console.warn('⚠️ Tool selection fallback triggered due to missing auth');
      return this.fallbackToolSelection(request, response.error.message);
    }

    return response;
  }

  /**
   * 打印图像请求的核心信息，方便排查“有图/无图”以及文本反馈
   */
  private logImageResponse(
    operationType: string,
    response: AIServiceResponse<AIImageResult>
  ): void {
    if (!response) {
      return;
    }

    if (!response.success) {
      console.warn(`⚠️ ${operationType}: request failed`, response.error);
      return;
    }

    const data = response.data;
    if (!data) {
      console.warn(`⚠️ ${operationType}: success but no payload`);
      return;
    }

    const textResponse =
      data.textResponse ??
      (typeof (data as any).text === 'string' ? (data as any).text : undefined) ??
      '';

    const hasImage =
      typeof data.hasImage === 'boolean'
        ? data.hasImage
        : typeof data.imageData === 'string' && data.imageData.trim().length > 0;

    console.log(`🧾 ${operationType} response payload`, {
      textResponse: textResponse || '(无文本返回)',
      hasImage,
    });
  }

  /**
   * 通用 API 调用方法（带网络错误重试）
   */
  private async callAPI<T>(
    url: string,
    request: any,
    operationType: string,
    retryCount: number = 0
  ): Promise<AIServiceResponse<T>> {
    try {
      console.log(`🌐 ${operationType}: Calling ${url}${retryCount > 0 ? ` (retry ${retryCount}/${MAX_NETWORK_RETRIES})` : ''}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 发送认证 cookie
        body: JSON.stringify(request),
      });

      if (response.status === 401 || response.status === 403) {
        console.warn(`⚠️ ${operationType}: token expired? attempting refresh...`);
        const refreshed = await this.refreshSession();
        if (refreshed) {
          return this.callAPI<T>(url, request, `${operationType} (retry)`, 0);
        }

        const fallback = await this.callPublicAPI<T>(url, request, operationType);
        if (fallback) {
          return fallback;
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`❌ ${operationType} failed: HTTP ${response.status}`);
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: errorData?.message || `HTTP ${response.status}`,
            timestamp: new Date(),
          } as AIError,
        };
      }

      const data = await response.json();
      console.log(`✅ ${operationType} succeeded`);

      return {
        success: true,
        data: data.data || data,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 检查是否可以重试
      if (retryCount < MAX_NETWORK_RETRIES && isRetryableError(err)) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount); // 指数退避
        console.warn(`⚠️ ${operationType} failed: ${err.message}, retrying in ${delay}ms... (${retryCount + 1}/${MAX_NETWORK_RETRIES})`);
        await sleep(delay);
        return this.callAPI<T>(url, request, operationType, retryCount + 1);
      }

      console.error(`❌ ${operationType} error after ${retryCount} retries:`, error);
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
          timestamp: new Date(),
        } as AIError,
      };
    }
  }

  private async callPublicAPI<T>(
    url: string,
    request: any,
    operationType: string
  ): Promise<AIServiceResponse<T> | null> {
    const publicSuffix = this.mapToPublicEndpoint(url);
    if (!publicSuffix) {
      return null;
    }

    try {
      console.log(`🌐 ${operationType}: falling back to public endpoint ${this.PUBLIC_API_BASE}${publicSuffix}`);
      const response = await fetch(`${this.PUBLIC_API_BASE}${publicSuffix}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.warn(`⚠️ ${operationType}: public endpoint failed HTTP ${response.status}`);
        return {
          success: false,
          error: {
            code: `PUBLIC_HTTP_${response.status}`,
            message: errorData?.message || `HTTP ${response.status}`,
            timestamp: new Date(),
          } as AIError,
        };
      }

      const data = await response.json();
      console.log(`✅ ${operationType}: public endpoint succeeded`);

      return {
        success: true,
        data: data.data || data,
      };
    } catch (error) {
      console.error(`❌ ${operationType}: public endpoint error`, error);
      return {
        success: false,
        error: {
          code: 'PUBLIC_NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
          timestamp: new Date(),
        } as AIError,
      };
    }
  }

  private mapToPublicEndpoint(url: string): string | null {
    const normalized = url.startsWith(this.API_BASE) ? url.slice(this.API_BASE.length) : url;
    return PUBLIC_ENDPOINT_MAP[normalized] ?? null;
  }

  private fallbackToolSelection(
    request: ToolSelectionRequest,
    reason?: string
  ): AIServiceResponse<ToolSelectionResult> {
    const available = request.availableTools || [];
    const prompt = (request.userInput || request.prompt || '').trim();
    const lowerPrompt = prompt.toLowerCase();

    const prefersImage = this.promptSuggestsImage(lowerPrompt);
    const prefersEdit = this.promptSuggestsEdit(lowerPrompt);

    const pick = (tool: string) => (available.includes(tool) ? tool : null);

    let selected =
      ((request.imageCount || 0) > 1 && pick('blendImages')) ||
      (((request.hasImages || request.hasCachedImage || prefersEdit) && pick('editImage'))) ||
      ((prefersImage && pick('generateImage'))) ||
      pick('chatResponse') ||
      available[0] ||
      'chatResponse';

    if (typeof selected !== 'string') {
      selected = 'chatResponse';
    }

    return {
      success: true,
      data: {
        selectedTool: selected,
        parameters: { prompt },
        confidence: 0.35,
        reasoning: `Fallback selection used due to missing auth${reason ? `: ${reason}` : ''}`,
      },
    };
  }

  private promptSuggestsImage(prompt: string): boolean {
    if (!prompt) return false;
    const keywords = ['image', 'picture', 'photo', 'draw', 'painting', 'render', '生成', '画', '图', '照片'];
    return keywords.some((keyword) => prompt.includes(keyword));
  }

  private promptSuggestsEdit(prompt: string): boolean {
    if (!prompt) return false;
    const keywords = ['edit', 'modify', 'adjust', 'remove', '背景', '编辑', '修改', '调整'];
    return keywords.some((keyword) => prompt.includes(keyword));
  }

  /**
   * 尝试刷新登录会话
   */
  private async refreshSession(): Promise<boolean> {
    try {
      const res = await fetch(`${this.API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        console.log('🔄 Session refresh succeeded');
        return true;
      }
      console.warn('Session refresh failed with status', res.status);
      return false;
    } catch (error) {
      console.warn('Session refresh threw error:', error);
      return false;
    }
  }

  /**
   * 检查 API 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.API_BASE}/ai/health`, {
        method: 'GET',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 估算成本
   */
  estimateCost(imageCount: number): number {
    const tokensPerImage = 1290;
    const costPer1MTokens = 30;
    return (imageCount * tokensPerImage * costPer1MTokens) / 1000000;
  }

  /**
   * 获取可用的 AI 提供商列表
   */
  async getAvailableProviders(): Promise<any> {
    try {
      const response = await fetch(`${this.PUBLIC_API_BASE}/providers`);
      if (!response.ok) throw new Error('Failed to fetch providers');
      return response.json();
    } catch (error) {
      console.error('Failed to get providers:', error);
      return [];
    }
  }

  /**
   * 生成 Paper.js 代码
   */
  async generatePaperJSCode(request: AIPaperJSGenerateRequest): Promise<AIServiceResponse<AIPaperJSResult>> {
    console.log('[AIImageService] Generating Paper.js code:', request.prompt.substring(0, 50));
    const response = await this.callAPI<AIPaperJSResult>(
      `${this.API_BASE}/ai/generate-paperjs`,
      request,
      'Paper.js code generation'
    );

    if (response.success && response.data) {
      console.log('[AIImageService] Paper.js code generated successfully');
    }

    return response;
  }

  /**
   * 图像转矢量 - 分析图像并生成 Paper.js 矢量代码
   */
  async img2Vector(request: AIImg2VectorRequest): Promise<AIServiceResponse<AIImg2VectorResult>> {
    console.log('[AIImageService] Converting image to vector');
    const response = await this.callAPI<AIImg2VectorResult>(
      `${this.API_BASE}/ai/img2vector`,
      request,
      'Image to vector conversion'
    );

    if (response.success && response.data) {
      console.log('[AIImageService] Image to vector conversion completed successfully');
      console.log('[AIImageService] Image analysis:', response.data.imageAnalysis.substring(0, 100));
    }

    return response;
  }
}

// 导出单例
export const aiImageService = new AIImageService();
export default aiImageService;
