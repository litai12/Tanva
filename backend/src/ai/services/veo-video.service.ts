import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type VeoModel = 'veo3-fast' | 'veo3-pro' | 'veo3-pro-frames';

export interface VeoGenerateVideoOptions {
  prompt: string;
  model: VeoModel;
  referenceImageUrl?: string; // 仅 veo3-pro-frames 支持垫图
}

export interface VeoVideoResult {
  success: boolean;
  taskId?: string;
  videoUrl?: string;
  downloadUrl?: string;
  previewUrl?: string;
  rawContent?: string;
  error?: string;
}

@Injectable()
export class VeoVideoService {
  private readonly logger = new Logger(VeoVideoService.name);
  private readonly apiBaseUrl: string;
  private readonly apiKey: string | null;

  constructor(private readonly configService: ConfigService) {
    this.apiBaseUrl =
      (
        this.configService.get<string>('VEO_API_ENDPOINT') ??
        this.configService.get<string>('VEO_API_BASE_URL') ??
        'https://api1.147ai.com'
      ).replace(/\/$/, '');

    this.apiKey =
      this.configService.get<string>('VEO_API_KEY') ??
      this.configService.get<string>('BANANA_API_KEY') ??
      this.configService.get<string>('SORA2_API_KEY') ??
      null;

    if (!this.apiKey) {
      this.logger.warn('VEO API key not configured. Set VEO_API_KEY (or BANANA_API_KEY / SORA2_API_KEY).');
    }
  }

  /**
   * 生成视频
   */
  async generateVideo(options: VeoGenerateVideoOptions): Promise<VeoVideoResult> {
    const { prompt, model, referenceImageUrl } = options;

    this.logger.log(`🎬 VEO video generation started: model=${model}, prompt=${prompt.substring(0, 50)}...`);

    // 构建消息内容
    const messages = this.buildMessages(prompt, model, referenceImageUrl);

    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'VEO API key not configured on the server (VEO_API_KEY).',
        };
      }

      const response = await fetch(`${this.apiBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: false, // 非流式，等待完整结果
          messages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`VEO API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          error: `API error: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      this.logger.debug('VEO API response:', JSON.stringify(data, null, 2));

      // 解析响应
      return this.parseResponse(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`VEO video generation failed: ${message}`);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * 流式生成视频（用于实时进度更新）
   */
  async *generateVideoStream(options: VeoGenerateVideoOptions): AsyncGenerator<string, VeoVideoResult, unknown> {
    const { prompt, model, referenceImageUrl } = options;

    this.logger.log(`🎬 VEO video stream started: model=${model}`);

    const messages = this.buildMessages(prompt, model, referenceImageUrl);

    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'VEO API key not configured on the server (VEO_API_KEY).',
        };
      }

      const response = await fetch(`${this.apiBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`VEO API stream error: ${response.status}`);
        return {
          success: false,
          error: `API error: ${response.status} - ${errorText}`,
        };
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          error: 'No response body',
        };
      }

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                yield content;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      // 解析最终结果
      return this.parseContentForUrls(fullContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`VEO video stream failed: ${message}`);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * 构建消息内容
   */
  private buildMessages(prompt: string, model: VeoModel, referenceImageUrl?: string): any[] {
    const messages: any[] = [
      {
        role: 'system',
        content: 'You are a helpful assistant.',
      },
    ];

    // veo3-pro-frames 支持垫图
    if (model === 'veo3-pro-frames' && referenceImageUrl) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: referenceImageUrl,
            },
          },
        ],
      });
    } else {
      // veo3-fast 和 veo3-pro 只支持文字
      messages.push({
        role: 'user',
        content: prompt,
      });
    }

    return messages;
  }

  /**
   * 解析 API 响应
   */
  private parseResponse(data: any): VeoVideoResult {
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      return {
        success: false,
        error: 'Empty response from API',
      };
    }

    return this.parseContentForUrls(content);
  }

  /**
   * 从内容中解析视频 URL
   */
  private parseContentForUrls(content: string): VeoVideoResult {
    this.logger.debug('Parsing content for URLs:', content);

    // 提取任务 ID
    const taskIdMatch = content.match(/任务ID[：:]\s*`?([^`\s\n]+)`?/);
    const taskId = taskIdMatch?.[1];

    // 提取在线观看链接
    const watchMatch = content.match(/\[▶️\s*在线观看\]\(([^)]+)\)/);
    const videoUrl = watchMatch?.[1];

    // 提取下载链接
    const downloadMatch = content.match(/\[⏬\s*下载视频\]\(([^)]+)\)/);
    const downloadUrl = downloadMatch?.[1];

    // 提取数据预览链接
    const previewMatch = content.match(/\[数据预览\]\(([^)]+)\)/);
    const previewUrl = previewMatch?.[1];

    if (videoUrl || downloadUrl) {
      this.logger.log(`✅ VEO video generated: ${videoUrl || downloadUrl}`);
      return {
        success: true,
        taskId,
        videoUrl,
        downloadUrl,
        previewUrl,
        rawContent: content,
      };
    }

    // 检查是否还在处理中
    if (content.includes('等待处理中') || content.includes('开始生成视频')) {
      return {
        success: false,
        taskId,
        previewUrl,
        rawContent: content,
        error: 'Video is still being generated',
      };
    }

    return {
      success: false,
      rawContent: content,
      error: 'Could not parse video URL from response',
    };
  }

  /**
   * 获取模型描述
   */
  getModelDescription(model: VeoModel): string {
    const descriptions: Record<VeoModel, string> = {
      'veo3-fast': '文字快速生成视频（速度快）',
      'veo3-pro': '文字生成视频（高质量，不支持垫图）',
      'veo3-pro-frames': '图片+文字生成视频（支持垫图）',
    };
    return descriptions[model] || model;
  }

  /**
   * 获取可用模型列表
   */
  getAvailableModels(): { model: VeoModel; description: string; supportsImage: boolean }[] {
    return [
      { model: 'veo3-fast', description: '文字快速生成视频', supportsImage: false },
      { model: 'veo3-pro', description: '文字生成高质量视频', supportsImage: false },
      { model: 'veo3-pro-frames', description: '图片+文字生成视频', supportsImage: true },
    ];
  }
}
