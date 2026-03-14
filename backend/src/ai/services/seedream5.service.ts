import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class Seedream5Service {
  private readonly logger = new Logger(Seedream5Service.name);
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ARK_API_KEY') || '';
    this.endpoint = this.config.get<string>('ARK_ENDPOINT') || 'https://ark.cn-beijing.volces.com';
  }

  async generateImage(params: {
    prompt?: string;
    size?: string;
    image_urls?: string[];
    batchMode?: boolean;
    batchCount?: number;
  }): Promise<{ imageUrl?: string; imageUrls?: string[] }> {
    const payload: any = {
      model: 'doubao-seedream-5-0-260128',
      sequential_image_generation: params.batchMode ? 'auto' : 'disabled',
      response_format: 'url',
      size: params.size || '2K',
      stream: false,
      watermark: false,
    };

    // 批量模式需要设置生成数量
    if (params.batchMode && params.batchCount) {
      payload.sequential_image_generation_options = {
        max_images: Math.min(Math.max(params.batchCount, 2), 10),
      };
    }

    // prompt 可选，但如果提供了就加入
    if (params.prompt) {
      payload.prompt = params.prompt;
    }

    // 根据图片数量设置 image 字段
    if (params.image_urls && params.image_urls.length > 0) {
      payload.image = params.image_urls.length === 1
        ? params.image_urls[0]
        : params.image_urls.slice(0, 5);
    }

    const response = await fetch(`${this.endpoint}/api/v3/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    this.logger.log(`Seedream5 API response: ${JSON.stringify(data)}`);

    const images = data.data || [];
    if (images.length === 1) {
      return { imageUrl: images[0]?.url };
    } else if (images.length > 1) {
      return { imageUrls: images.map((img: any) => img.url) };
    }

    throw new Error('No images returned from API');
  }

  async queryTask(taskId: string): Promise<{ status: string; imageUrl?: string; imageUrls?: string[] }> {
    const response = await fetch(`${this.endpoint}/api/v3/images/generations/${taskId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Query failed: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'succeeded' || data.status === 'completed') {
      const images = data.data || [];
      if (images.length === 1) {
        return { status: 'succeeded', imageUrl: images[0]?.url };
      } else if (images.length > 1) {
        return { status: 'succeeded', imageUrls: images.map((img: any) => img.url) };
      }
    }

    if (data.status === 'failed') {
      return { status: 'failed' };
    }

    return { status: data.status || 'processing' };
  }
}
