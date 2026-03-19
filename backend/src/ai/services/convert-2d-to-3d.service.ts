import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class Convert2Dto3DService {
  private readonly logger = new Logger(Convert2Dto3DService.name);
  private readonly submitUrl: string;
  private readonly queryUrl: string;
  private readonly apiKey: string;
  private readonly modelVersion: string;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;

  constructor(private readonly config: ConfigService) {
    const baseUrl =
      (this.config.get<string>('HUNYUAN_3D_BASE_URL') || 'https://api.ai3d.cloud.tencent.com').replace(
        /\/+$/,
        '',
      );

    this.submitUrl = `${baseUrl}/v1/ai3d/submit`;
    this.queryUrl = `${baseUrl}/v1/ai3d/query`;
    this.apiKey = (this.config.get<string>('HUNYUAN_3D_API_KEY') || '').trim();
    this.modelVersion = (this.config.get<string>('HUNYUAN_3D_MODEL') || '3.1').trim();
    this.pollIntervalMs = Number(this.config.get<string>('HUNYUAN_3D_POLL_INTERVAL_MS') || 5000);
    this.maxWaitMs = Number(this.config.get<string>('HUNYUAN_3D_MAX_WAIT_MS') || 10 * 60 * 1000);
  }

  async convert2Dto3D(imageUrl: string): Promise<{ modelUrl: string; promptId?: string }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('HUNYUAN_3D_API_KEY is not configured');
    }

    if (!imageUrl || typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
      throw new ServiceUnavailableException('Invalid image URL provided');
    }

    const jobId = await this.submitJob(imageUrl);
    const modelUrl = await this.waitForModelUrl(jobId, imageUrl);

    return {
      modelUrl,
      promptId: jobId,
    };
  }

  private async submitJob(imageUrl: string): Promise<string> {
    const payloadCandidates: Array<Record<string, any>> = [
      // 官方云 API 文档参数：ImageUrl 为字符串
      {
        Model: this.modelVersion,
        ImageUrl: imageUrl,
      },
      // 兼容你提供的接入文档格式：ImageUrl.Url
      {
        Model: this.modelVersion,
        ImageUrl: {
          Url: imageUrl,
        },
      },
      // 兜底：部分网关大小写差异
      {
        Model: this.modelVersion,
        ImageUrl: {
          url: imageUrl,
        },
      },
      // 兜底：不传 Model，让服务端走默认模型
      {
        ImageUrl: imageUrl,
      },
    ];

    let lastError: unknown;
    for (let i = 0; i < payloadCandidates.length; i++) {
      const payload = payloadCandidates[i];
      try {
        const response = await this.fetchJson(this.submitUrl, payload);
        const upstreamError = this.extractTencentError(response);
        if (upstreamError?.code) {
          if (upstreamError.code === 'ResourceInsufficient') {
            throw new ServiceUnavailableException(
              `Hunyuan resource insufficient: ${upstreamError.message || '资源不足，请检查 API Key 归属账号的混元3D可用额度/配额'}`,
            );
          }
          // 存在上游显式错误时，避免误判为“missing JobId”
          throw new ServiceUnavailableException(
            `Hunyuan submit failed: ${upstreamError.code}${upstreamError.message ? ` - ${upstreamError.message}` : ''}`,
          );
        }
        const jobId = this.extractJobId(response);
        if (jobId) {
          return jobId;
        }
        this.logger.warn(
          `Hunyuan submit attempt ${i + 1}/${payloadCandidates.length} missing JobId, payload=${JSON.stringify(
            payload,
          )}, response=${JSON.stringify(response)}`,
        );
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Hunyuan submit attempt ${i + 1}/${payloadCandidates.length} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (lastError instanceof ServiceUnavailableException) {
      throw lastError;
    }
    throw new ServiceUnavailableException('Hunyuan submit failed: missing JobId');
  }

  private async waitForModelUrl(jobId: string, sourceImageUrl: string): Promise<string> {
    const deadline = Date.now() + this.maxWaitMs;

    while (Date.now() < deadline) {
      const response = await this.fetchJson(this.queryUrl, { JobId: jobId });
      const modelUrl = this.extractModelUrl(response, sourceImageUrl);
      if (modelUrl) {
        return modelUrl;
      }

      const status = this.extractStatus(response);
      if (status) {
        if (this.isFailureStatus(status)) {
          throw new ServiceUnavailableException(`Hunyuan task failed: ${status}`);
        }
        if (this.isSuccessStatus(status)) {
          this.logger.error(
            `Hunyuan task marked success but no model url found, jobId=${jobId}, response=${JSON.stringify(
              response,
            )}`,
          );
          throw new ServiceUnavailableException('Hunyuan task finished but model URL is missing');
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }

    throw new ServiceUnavailableException(`Hunyuan task timeout after ${this.maxWaitMs}ms`);
  }

  private async fetchJson(url: string, body: Record<string, any>): Promise<any> {
    const timeoutMs = Math.max(30_000, Math.min(this.maxWaitMs, 180_000));
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.normalizeApiKey(this.apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.error(`Hunyuan API error: ${response.status} ${response.statusText} ${errorText}`);
        throw new ServiceUnavailableException(
          `Hunyuan API request failed: ${response.status} ${response.statusText}${
            errorText ? ` - ${errorText}` : ''
          }`,
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException('Hunyuan API request timeout');
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Hunyuan API request failed: ${message}`, error);
      throw new ServiceUnavailableException(`Hunyuan API request failed: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private normalizeApiKey(value: string): string {
    return value.replace(/^Bearer\s+/i, '').trim();
  }

  private extractJobId(payload: any): string | null {
    const candidateKeys = ['JobId', 'jobId', 'job_id', 'TaskId', 'taskId', 'task_id'];
    for (const key of candidateKeys) {
      const value = this.readValueByKey(payload, key);
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return null;
  }

  private extractStatus(payload: any): string | null {
    const candidateKeys = ['Status', 'status', 'TaskStatus', 'taskStatus', 'State', 'state'];
    for (const key of candidateKeys) {
      const value = this.readValueByKey(payload, key);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  private isSuccessStatus(status: string): boolean {
    const value = status.toLowerCase();
    return ['succeeded', 'success', 'done', 'completed', 'complete', 'finished', 'finish', 'ok'].includes(value);
  }

  private isFailureStatus(status: string): boolean {
    const value = status.toLowerCase();
    return ['failed', 'error', 'canceled', 'cancelled', 'timeout'].includes(value);
  }

  private extractModelUrl(payload: any, sourceImageUrl: string): string | null {
    const candidates: string[] = [];
    this.collectUrls(payload, candidates);
    const uniqueCandidates = Array.from(new Set(candidates));
    const modelCandidates = uniqueCandidates.filter((value) => this.isLikelyModelUrl(value, sourceImageUrl));
    if (!modelCandidates.length) return null;

    modelCandidates.sort((a, b) => this.scoreModelUrl(b) - this.scoreModelUrl(a));
    return modelCandidates[0];
  }

  private collectUrls(node: any, bucket: string[]): void {
    if (!node) return;

    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (/^https?:\/\//i.test(trimmed)) bucket.push(trimmed);
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) this.collectUrls(item, bucket);
      return;
    }

    if (typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node as Record<string, any>)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^https?:\/\//i.test(trimmed) && /url|download|file|model|mesh|obj|glb|gltf/i.test(key)) {
          bucket.push(trimmed);
        }
      }
      this.collectUrls(value, bucket);
    }
  }

  private isLikelyModelUrl(url: string, sourceImageUrl: string): boolean {
    if (!/^https?:\/\//i.test(url)) return false;
    if (sourceImageUrl && url === sourceImageUrl) return false;

    const lower = url.toLowerCase();
    const pathLower = this.urlPathLower(url);
    const modelExt = ['.glb', '.gltf', '.fbx', '.obj', '.stl', '.usdz', '.usdc', '.ply', '.zip'];
    if (modelExt.some((ext) => pathLower.includes(ext) || lower.includes(ext))) return true;

    const imageExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
    if (imageExt.some((ext) => pathLower.includes(ext) || lower.includes(ext))) return false;

    return /model|mesh|download|file/i.test(lower);
  }

  private urlPathLower(url: string): string {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  private scoreModelUrl(url: string): number {
    const lower = url.toLowerCase();
    const pathLower = this.urlPathLower(url);

    const extScores: Array<[string, number]> = [
      ['.glb', 100],
      ['.gltf', 95],
      ['.fbx', 80],
      ['.obj', 75],
      ['.stl', 70],
      ['.usdz', 65],
      ['.usdc', 60],
      ['.ply', 55],
      ['.zip', 10],
    ];

    for (const [ext, score] of extScores) {
      if (pathLower.includes(ext) || lower.includes(ext)) return score;
    }

    if (/thumbnail|preview|poster|cover/i.test(lower)) return -20;

    let score = 30;
    if (/model|mesh|download|file/i.test(lower)) score += 10;
    if (/output|result|artifact|resource/i.test(lower)) score += 10;
    return score;
  }

  private readValueByKey(node: any, key: string): unknown {
    if (!node) return undefined;

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = this.readValueByKey(item, key);
        if (found !== undefined) return found;
      }
      return undefined;
    }

    if (typeof node !== 'object') return undefined;

    if (Object.prototype.hasOwnProperty.call(node, key)) {
      return (node as Record<string, unknown>)[key];
    }

    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = this.readValueByKey(value, key);
      if (found !== undefined) return found;
    }

    return undefined;
  }

  private extractTencentError(payload: any): { code?: string; message?: string } | null {
    if (!payload || typeof payload !== 'object') return null;
    const response = (payload as any).Response;
    const error = response?.Error;
    if (!error || typeof error !== 'object') return null;
    const code = typeof error.Code === 'string' ? error.Code : undefined;
    const message = typeof error.Message === 'string' ? error.Message : undefined;
    if (!code && !message) return null;
    return { code, message };
  }
}
