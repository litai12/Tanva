/**
 * Sora2 视频生成服务
 * 使用 Banana147 模型供应商的 OpenAI Chat API 兼容接口
 * API 文档: /docs/sora2.md
 */

import type { AIError, AIServiceResponse } from '@/types/ai';

// ============ 类型定义 ============

export interface Sora2Message {
  role: 'user' | 'assistant' | 'system';
  content: Sora2Content[];
}

export type Sora2Content = Sora2TextContent | Sora2ImageContent;

export interface Sora2TextContent {
  type: 'text';
  text: string;
}

export interface Sora2ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export interface Sora2Request {
  model: string;
  stream: boolean;
  messages: Sora2Message[];
}

export interface Sora2StreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      [key: string]: any;
    };
    finish_reason: string | null;
  }>;
}

export interface Sora2CompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============ 服务类 ============

class Sora2Service {
  private readonly API_BASE = import.meta.env.VITE_SORA2_API_ENDPOINT || 'https://api1.147ai.com';
  private readonly DEFAULT_MODEL = import.meta.env.VITE_SORA2_MODEL || 'sora-2-pro-reverse';
  private apiKey: string = '';

  /**
   * 初始化服务并设置 API 密钥
   */
  setApiKey(key: string): void {
    if (!key || !key.startsWith('sk-')) {
      console.warn('⚠️ Sora2Service: Invalid API key format');
      return;
    }
    this.apiKey = key;
    console.log('✅ Sora2Service API key set');
  }

  /**
   * 生成视频（使用 stream: true）
   * @param prompt 视频描述提示词
   * @param imageUrls 可选的参考图像 URL（可多张）
   * @param onChunk 流式数据回调函数
   */
  async generateVideoStream(
    prompt: string,
    imageUrls?: string | string[],
    onChunk?: (chunk: string) => void,
    modelOverride?: string
  ): Promise<AIServiceResponse<{ fullContent: string }>> {
    if (!this.apiKey) {
      return {
        success: false,
        error: {
          code: 'API_KEY_NOT_SET',
          message: 'Sora2Service API key is not set. Please call setApiKey() first.',
          timestamp: new Date(),
        } as AIError,
      };
    }

    try {
      console.log('🎬 Sora2Service: Starting video generation stream...');
      console.log('📝 Prompt:', prompt);
      if (imageUrl) {
        console.log('🖼️ Image URL:', imageUrl);
      }

      const messages = this.buildMessages(prompt, imageUrls);
      const model = modelOverride || this.DEFAULT_MODEL;
      const request: Sora2Request = {
        model,
        stream: true,
        messages,
      };

      console.log('🎯 Sora2Service: Using model', model);

      const response = await fetch(`${this.API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`❌ Sora2Service: HTTP ${response.status}`);
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: errorData?.message || `HTTP ${response.status}`,
            timestamp: new Date(),
          } as AIError,
        };
      }

      // 处理流式响应
      const fullContent = await this.processStream(response, onChunk);

      console.log('✅ Sora2Service: Video generation stream completed');
      console.log('🎬 Generated content length:', fullContent.length);

      return {
        success: true,
        data: { fullContent },
      };
    } catch (error) {
      console.error('❌ Sora2Service error:', error);
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
   * 非流式视频生成
   */
  async generateVideo(
    prompt: string,
    imageUrls?: string | string[],
    modelOverride?: string
  ): Promise<AIServiceResponse<string>> {
    if (!this.apiKey) {
      return {
        success: false,
        error: {
          code: 'API_KEY_NOT_SET',
          message: 'Sora2Service API key is not set. Please call setApiKey() first.',
          timestamp: new Date(),
        } as AIError,
      };
    }

    try {
      console.log('🎬 Sora2Service: Starting video generation...');

      const messages = this.buildMessages(prompt, imageUrls);
      const model = modelOverride || this.DEFAULT_MODEL;
      const request: Sora2Request = {
        model,
        stream: false,
        messages,
      };

      console.log('🎯 Sora2Service: Using model', model);

      const response = await fetch(`${this.API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`❌ Sora2Service: HTTP ${response.status}`);
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: errorData?.message || `HTTP ${response.status}`,
            timestamp: new Date(),
          } as AIError,
        };
      }

      const data = (await response.json()) as Sora2CompletionResponse;
      const content = data.choices[0]?.message?.content || '';

      console.log('✅ Sora2Service: Video generation completed');

      return {
        success: true,
        data: content,
      };
    } catch (error) {
      console.error('❌ Sora2Service error:', error);
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
   * 构建消息体
   */
  private buildMessages(prompt: string, imageUrls?: string | string[]): Sora2Message[] {
    const content: Sora2Content[] = [
      {
        type: 'text',
        text: prompt,
      },
    ];

    const normalizedImages = Array.isArray(imageUrls)
      ? imageUrls
      : imageUrls
      ? [imageUrls]
      : [];

    normalizedImages
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .map((url) => url.trim())
      .forEach((url) => {
        content.push({
          type: 'image_url',
          image_url: { url },
        });
      });

    return [
      {
        role: 'user',
        content,
      },
    ];
  }

  /**
   * 处理流式响应
   */
  private async processStream(
    response: Response,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // 保留最后一行（可能不完整）
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);

            // 检查是否是结束标记
            if (jsonStr === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(jsonStr) as Sora2StreamResponse;
              const content = parsed.choices[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                onChunk?.(content);
              }
            } catch {
              console.debug('Failed to parse stream chunk:', jsonStr);
            }
          }
        }
      }

      // 处理缓冲区中的最后内容
      if (buffer && buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6);
        if (jsonStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(jsonStr) as Sora2StreamResponse;
            const content = parsed.choices[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              onChunk?.(content);
            }
          } catch {
            console.debug('Failed to parse final stream chunk:', jsonStr);
          }
        }
      }

      return fullContent;
    } finally {
      reader.releaseLock();
    }
  }
}

// 导出单例
export const sora2Service = new Sora2Service();
export default sora2Service;
