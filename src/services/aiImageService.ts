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
  AIImageResult,
  AIImageAnalysisResult,
  AITextChatResult,
  AIServiceResponse,
  AIError,
} from '@/types/ai';

class AIImageService {
  private readonly API_BASE = '/api';
  private readonly PUBLIC_API_BASE = '/api/public/ai';

  /**
   * 生成图像 - 使用内部认证 API
   */
  async generateImage(request: AIImageGenerateRequest): Promise<AIServiceResponse<AIImageResult>> {
    return this.callAPI<AIImageResult>(
      `${this.API_BASE}/ai/generate-image`,
      request,
      'Image generation'
    );
  }

  /**
   * 编辑图像 - 使用内部认证 API
   */
  async editImage(request: AIImageEditRequest): Promise<AIServiceResponse<AIImageResult>> {
    return this.callAPI<AIImageResult>(
      `${this.API_BASE}/ai/edit-image`,
      request,
      'Image editing'
    );
  }

  /**
   * 融合图像 - 使用内部认证 API
   */
  async blendImages(request: AIImageBlendRequest): Promise<AIServiceResponse<AIImageResult>> {
    return this.callAPI<AIImageResult>(
      `${this.API_BASE}/ai/blend-images`,
      request,
      'Image blending'
    );
  }

  /**
   * 分析图像 - 使用内部认证 API
   */
  async analyzeImage(request: AIImageAnalyzeRequest): Promise<AIServiceResponse<AIImageAnalysisResult>> {
    return this.callAPI<AIImageAnalysisResult>(
      `${this.API_BASE}/ai/analyze-image`,
      request,
      'Image analysis'
    );
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
  async selectTool(request: any): Promise<AIServiceResponse<any>> {
    return this.callAPI<any>(
      `${this.API_BASE}/ai/tool-selection`,
      request,
      'Tool selection'
    );
  }

  /**
   * 通用 API 调用方法
   */
  private async callAPI<T>(
    url: string,
    request: any,
    operationType: string
  ): Promise<AIServiceResponse<T>> {
    try {
      console.log(`🌐 ${operationType}: Calling ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 发送认证 cookie
        body: JSON.stringify(request),
      });

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
      console.error(`❌ ${operationType} error:`, error);
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
}

// 导出单例
export const aiImageService = new AIImageService();
export default aiImageService;
