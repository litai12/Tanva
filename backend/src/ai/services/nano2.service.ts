import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Nano2GenerateRequest {
  prompt: string;
  model?: string;
  size?: string;
  resolution?: string;
  n?: number;
  image_urls?: string[];
  google_search?: boolean;
  google_image_search?: boolean;
  official_fallback?: boolean;
  quality?: 'auto' | 'low' | 'medium' | 'high';
  background?: 'auto' | 'opaque' | 'transparent';
  moderation?: 'auto' | 'low';
  output_format?: 'png' | 'jpeg' | 'webp';
  output_compression?: number;
  mask_url?: string;
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
  private readonly maxSubmitAttempts = 2;
  private readonly submitRetryDelayMs = 1200;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('NANO2_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('NANO2_API_KEY not configured');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseNumericCode(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return null;
  }

  private pickErrorMessage(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const source = payload as Record<string, any>;
    const direct = [source.message, source.msg, source.error?.message, source.error_message];
    for (const value of direct) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  }

  private async extractErrorDetails(response: Response): Promise<{
    message: string;
    rawBody: string;
    requestId?: string;
  }> {
    const requestId =
      response.headers.get('x-request-id') ||
      response.headers.get('request-id') ||
      response.headers.get('x-trace-id') ||
      response.headers.get('trace-id') ||
      undefined;

    const rawBody = await response.text().catch(() => '');
    let parsed: Record<string, any> | null = null;
    if (rawBody) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = null;
      }
    }

    const candidateMessage =
      parsed?.error?.message ||
      parsed?.message ||
      rawBody ||
      `HTTP ${response.status}`;

    const message =
      typeof candidateMessage === 'string'
        ? candidateMessage
        : JSON.stringify(candidateMessage);

    return {
      message,
      rawBody,
      requestId,
    };
  }

  async generateImage(request: Nano2GenerateRequest): Promise<{ taskId: string; status: string }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('Nano2 API key not configured');
    }

    const payload: Record<string, any> = {
      model: request.model?.trim() || 'gemini-3.1-flash-image-preview',
      prompt: request.prompt,
      size: request.size || '1:1',
      n: request.n || 1,
      ...(request.image_urls && { image_urls: request.image_urls }),
    };
    if (typeof request.resolution === 'string' && request.resolution.trim()) {
      payload.resolution = request.resolution.trim();
    }
    if (typeof request.google_search === 'boolean') {
      payload.google_search = request.google_search;
    }
    if (typeof request.google_image_search === 'boolean') {
      payload.google_image_search = request.google_image_search;
    }
    if (typeof request.official_fallback === 'boolean') {
      payload.official_fallback = request.official_fallback;
    }
    if (typeof request.quality === 'string' && request.quality.trim()) {
      payload.quality = request.quality.trim();
    }
    if (typeof request.background === 'string' && request.background.trim()) {
      payload.background = request.background.trim();
    }
    if (typeof request.moderation === 'string' && request.moderation.trim()) {
      payload.moderation = request.moderation.trim();
    }
    if (typeof request.output_format === 'string' && request.output_format.trim()) {
      payload.output_format = request.output_format.trim();
    }
    if (typeof request.output_compression === 'number' && Number.isFinite(request.output_compression)) {
      payload.output_compression = Math.max(0, Math.min(100, Math.trunc(request.output_compression)));
    }
    if (typeof request.mask_url === 'string' && request.mask_url.trim()) {
      payload.mask_url = request.mask_url.trim();
    }

    this.logger.log(
      `Nano2 request: ${JSON.stringify({
        ...payload,
        prompt: payload.prompt.substring(0, 50),
      })}`,
    );

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxSubmitAttempts; attempt += 1) {
      try {
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const details = await this.extractErrorDetails(response);
          const errorMessage = `HTTP ${response.status}${
            details.requestId ? ` [requestId=${details.requestId}]` : ''
          } - ${details.message}`;

          const shouldRetry = response.status >= 500 && attempt < this.maxSubmitAttempts;
          if (shouldRetry) {
            this.logger.warn(
              `Nano2 submit attempt ${attempt}/${this.maxSubmitAttempts} failed with upstream ${response.status}, retrying in ${this.submitRetryDelayMs}ms. ${errorMessage}`,
            );
            await this.sleep(this.submitRetryDelayMs);
            continue;
          }

          this.logger.error(
            `Nano2 submit failed: ${errorMessage}. rawBody=${details.rawBody?.slice(0, 1500) || '(empty)'}`,
          );
          throw new Error(errorMessage);
        }

        const data: Nano2TaskResponse = await response.json();
        const submitCode = this.parseNumericCode((data as any)?.code);
        if (submitCode !== null && submitCode !== 200) {
          const submitMessage = this.pickErrorMessage(data) || 'upstream submit rejected';
          throw new Error(`HTTP ${submitCode} - ${submitMessage}`);
        }
        if (!Array.isArray(data?.data) || data.data.length === 0 || !data.data[0]?.task_id) {
          throw new Error(`Nano2 submit succeeded but task_id missing. payload=${JSON.stringify(data)}`);
        }
        return {
          taskId: data.data[0].task_id,
          status: data.data[0].status,
        };
      } catch (error: any) {
        lastError =
          error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
        const isHttpError = /^HTTP\s\d{3}/.test(lastError.message);
        const shouldRetryNetworkLike = !isHttpError && attempt < this.maxSubmitAttempts;
        if (shouldRetryNetworkLike) {
          this.logger.warn(
            `Nano2 submit attempt ${attempt}/${this.maxSubmitAttempts} failed with network/unknown error (${lastError.message}), retrying in ${this.submitRetryDelayMs}ms`,
          );
          await this.sleep(this.submitRetryDelayMs);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error('Nano2 submit failed: unknown error');
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

    const codeCandidates = [
      this.parseNumericCode((json as any)?.code),
      this.parseNumericCode((json as any)?.statusCode),
      this.parseNumericCode((json as any)?.data?.code),
      this.parseNumericCode((json as any)?.error?.code),
    ];
    const businessCode = codeCandidates.find((value) => typeof value === 'number') ?? null;
    if (businessCode !== null && businessCode !== 200) {
      const message =
        this.pickErrorMessage((json as any)?.data) ||
        this.pickErrorMessage(json) ||
        'upstream task query rejected';
      throw new Error(`Failed to query task: HTTP ${businessCode}${message ? ` - ${message}` : ''}`);
    }

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

    const rawStatus = String(data.status || '').trim().toLowerCase();
    const normalizedStatus =
      rawStatus === 'succeeded' || rawStatus === 'completed' || rawStatus === 'success'
        ? 'succeeded'
        : ['failed', 'error', 'timeout', 'cancelled', 'cancel', 'exception'].includes(rawStatus)
          ? 'failed'
          : 'processing';

    return {
      status: normalizedStatus,
      imageUrl,
    };
  }
}
