import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider } from './ai-provider.interface';
import { Nano2Service } from '../services/nano2.service';

@Injectable()
export class Nano2Provider implements IAIProvider {
  private readonly logger = new Logger(Nano2Provider.name);
  private available = false;

  constructor(
    private readonly config: ConfigService,
    private readonly nano2Service: Nano2Service,
  ) {}

  async initialize(): Promise<void> {
    const apiKey = this.config.get<string>('NANO2_API_KEY');
    this.available = !!apiKey;
    this.logger.log(`Nano2 provider initialized: ${this.available ? 'available' : 'unavailable'}`);
  }

  isAvailable(): boolean {
    return this.available;
  }

  getProviderInfo(): any {
    return { name: 'nano2', model: 'gemini-3.1-flash-image-preview' };
  }

  async generateImage(request: any): Promise<any> {
    // 1. 提交任务
    const result = await this.nano2Service.generateImage({
      prompt: request.prompt,
      size: request.aspectRatio || '16:9',
      resolution: request.resolution || request.imageSize || '1K',
      n: 1,
      image_urls: request.imageUrls || request.image_urls,
      google_search: request.googleSearch,
      google_image_search: request.googleImageSearch,
    });

    this.logger.log(`Nano2 task submitted: ${result.taskId}`);

    // 2. 轮询等待任务完成
    const maxAttempts = 120; // 最多轮询 120 次
    const pollInterval = 3000; // 每 3 秒轮询一次，总计最长 6 分钟

    // 初始等待 10 秒，让任务有时间开始处理
    await new Promise((resolve) => setTimeout(resolve, 10000));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let taskResult;
      try {
        taskResult = await this.nano2Service.queryTask(result.taskId);
      } catch (err: any) {
        // 如果是 404，任务可能还未注册，继续等待
        if (err.message?.includes('404')) {
          this.logger.warn(`Nano2 task ${result.taskId} not found yet (attempt ${attempt}), retrying...`);
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          continue;
        }
        throw err;
      }

      this.logger.log(`Nano2 task ${result.taskId} status: ${taskResult.status} (attempt ${attempt})`);

      if (taskResult.status === 'succeeded' || taskResult.status === 'completed') {
        if (taskResult.imageUrl) {
          return {
            success: true,
            data: {
              imageData: null,
              imageUrl: taskResult.imageUrl,
              textResponse: 'Image generated successfully',
              metadata: {
                taskId: result.taskId,
                imageUrl: taskResult.imageUrl,
              },
            },
          };
        } else {
          // 任务成功但没有图片 URL，视为失败
          this.logger.warn(`Nano2 task ${result.taskId} succeeded but no imageUrl found`);
          return {
            success: false,
            error: { message: 'Nano2 task completed but no image URL returned' },
          };
        }
      }

      if (taskResult.status === 'failed' || taskResult.status === 'error') {
        return {
          success: false,
          error: { message: 'Nano2 image generation failed' },
        };
      }

      // 等待后再进行下一次轮询
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return {
      success: false,
      error: { message: 'Nano2 image generation timeout' },
    };
  }

  async editImage(request: any): Promise<any> {
    throw new Error('Nano2 does not support image editing');
  }

  async blendImages(request: any): Promise<any> {
    throw new Error('Nano2 does not support image blending');
  }

  async analyzeImage(request: any): Promise<any> {
    throw new Error('Nano2 does not support image analysis');
  }

  async generateText(request: any): Promise<any> {
    throw new Error('Nano2 does not support text generation');
  }

  async selectTool(request: any): Promise<any> {
    throw new Error('Nano2 does not support tool selection');
  }

  async generatePaperJS(request: any): Promise<any> {
    throw new Error('Nano2 does not support PaperJS generation');
  }
}
