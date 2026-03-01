import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Nano2GenerateRequest {
  prompt: string;
  size?: string;
  resolution?: string;
  n?: number;
  image_urls?: string[];
  google_search?: boolean;
  google_image_search?: boolean;
}

interface Nano2TaskResponse {
  code: number;
  data: Array<{
    status: string;
    task_id: string;
  }>;
}

@Injectable()
export class Nano2Service {
  private readonly logger = new Logger(Nano2Service.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.apimart.ai/v1/images/generations';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('NANO2_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('NANO2_API_KEY not configured');
    }
  }

  async generateImage(request: Nano2GenerateRequest): Promise<{ taskId: string; status: string }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Nano2 API key not configured');
    }

    const payload = {
      model: 'gemini-3.1-flash-image-preview',
      prompt: request.prompt,
      size: request.size || '16:9',
      resolution: request.resolution || '1K',
      n: request.n || 1,
      ...(request.image_urls && { image_urls: request.image_urls }),
      ...(request.google_search && { google_search: request.google_search }),
      ...(request.google_image_search && { google_image_search: request.google_image_search }),
    };

    this.logger.log(`Nano2 request: ${JSON.stringify({ ...payload, prompt: payload.prompt.substring(0, 50) })}`);

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    const data: Nano2TaskResponse = await response.json();
    return {
      taskId: data.data[0].task_id,
      status: data.data[0].status,
    };
  }

  async queryTask(taskId: string): Promise<{ status: string; imageUrl?: string }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Nano2 API key not configured');
    }

    // 尝试 /v1/tasks/{taskId} 端点
    const queryUrl = `https://api.apimart.ai/v1/tasks/${taskId}`;
    const response = await fetch(queryUrl, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to query task: HTTP ${response.status}`);
    }

    const json = await response.json();
    this.logger.log(`Nano2 task query raw response: ${JSON.stringify(json)}`);

    // 解析响应 - API 返回格式: { code: 200, data: { status, result: { images: [{ url: [...] }] } } }
    const data = json.data || json;

    // 提取图片 URL - 格式是 result.images[0].url[0]
    let imageUrl: string | undefined;
    if (data.result?.images?.[0]?.url) {
      const urlField = data.result.images[0].url;
      imageUrl = Array.isArray(urlField) ? urlField[0] : urlField;
    } else {
      imageUrl = data.image_url || data.imageUrl;
    }

    this.logger.log(`Nano2 parsed - status: ${data.status}, imageUrl: ${imageUrl || 'not found'}`);

    return {
      status: data.status || 'processing',
      imageUrl,
    };
  }
}
