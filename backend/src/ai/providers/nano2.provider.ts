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
    return { name: 'nano2', model: 'gpt-image-2' };
  }

  async generateImage(request: any): Promise<any> {
    const requestedModel =
      typeof request.model === 'string' && request.model.trim()
        ? request.model.trim()
        : 'gemini-3.1-flash-image-preview';
    const isGptImage2Model = requestedModel.toLowerCase() === 'gpt-image-2';
    const requestedSize = request.aspectRatio || (isGptImage2Model ? '1:1' : '16:9');

    const normalizedResolution = (() => {
      const rawResolution = request.resolution || request.imageSize || '1K';
      const normalized = String(rawResolution).trim().toUpperCase();
      if (normalized === '2K') return isGptImage2Model ? '2k' : '2K';
      if (normalized === '4K') return isGptImage2Model ? '4k' : '4K';
      return isGptImage2Model ? '1k' : '1K';
    })();

    // 1. 鎻愪氦浠诲姟
    const result = await this.nano2Service.generateImage({
      prompt: request.prompt,
      model: requestedModel,
      size: requestedSize,
      n: 1,
      image_urls: request.imageUrls || request.image_urls,
      resolution: normalizedResolution,
      ...(isGptImage2Model
        ? {
            official_fallback:
              typeof request.officialFallback === 'boolean'
                ? request.officialFallback
                : false,
          }
        : {}),
      ...(!isGptImage2Model
        ? {
            google_search: request.googleSearch,
            google_image_search: request.googleImageSearch,
          }
        : {}),
    });

    this.logger.log(`Nano2 task submitted: ${result.taskId}`);

    // 2. 杞绛夊緟浠诲姟瀹屾垚
    const pollingWindowMs = 15 * 60 * 1000;
    const pollIntervalMs = 3000;
    const initialDelayMs = 10000;
    const startedAt = Date.now();
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    await sleep(initialDelayMs);

    let attempt = 0;
    while (Date.now() - startedAt < pollingWindowMs) {
      attempt += 1;
      let taskResult;
      try {
        taskResult = await this.nano2Service.queryTask(result.taskId);
      } catch (err: any) {
        // 濡傛灉鏄?404锛屼换鍔″彲鑳借繕鏈敞鍐岋紝缁х画绛夊緟
        if (err.message?.includes('404')) {
          this.logger.warn(`Nano2 task ${result.taskId} not found yet (attempt ${attempt}), retrying...`);
          await sleep(pollIntervalMs);
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
                provider: 'nano2',
                aiProvider: 'nano2',
                model: requestedModel,
              },
            },
          };
        } else {
          // 浠诲姟鎴愬姛浣嗘病鏈夊浘鐗?URL锛岃涓哄け璐?
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

      // 绛夊緟鍚庡啀杩涜涓嬩竴娆¤疆璇?
      await sleep(pollIntervalMs);
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


