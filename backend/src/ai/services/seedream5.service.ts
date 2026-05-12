import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export type Seedream5ProviderType = 'doubao' | 'watcha';
export const SEEDREAM5_PROVIDER_SETTING_KEY = 'seedream5_provider';
export type Seedream5ModelVersion = '4.5' | '5.0';

const DOUBAO_SEEDREAM_50_MODEL = 'doubao-seedream-5-0-260128';
const DOUBAO_SEEDREAM_45_MODEL = 'doubao-seedream-4-5-251128';

interface Seedream5ProviderConfig {
  provider: Seedream5ProviderType;
  endpoint: string;
  apiKey: string;
  model: string;
  generationPath: string;
}

@Injectable()
export class Seedream5Service {
  private readonly logger = new Logger(Seedream5Service.name);
  private readonly doubaoApiKey: string;
  private readonly doubaoEndpoint: string;
  private readonly watchaApiKey: string;
  private readonly watchaEndpoint: string;
  private readonly watchaModel: string;

  private static readonly SIZE_PRESETS = new Set(['1K', '2K', '3K', '4K']);
  private static readonly DIMENSION_PATTERN = /^(\d{3,5})\s*[xX]\s*(\d{3,5})$/;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.doubaoApiKey = this.normalizeApiKey(
      this.config.get<string>('ARK_API_KEY') ||
        this.config.get<string>('DOUBAO_API_KEY') ||
        '',
    );
    this.doubaoEndpoint = this.normalizeEndpoint(
      this.config.get<string>('ARK_ENDPOINT') || 'https://ark.cn-beijing.volces.com',
    );

    this.watchaApiKey = this.normalizeApiKey(
      this.config.get<string>('WATCHA_SEEDREAM_API_KEY') ||
        this.config.get<string>('WATCHA_API_KEY') ||
        '',
    );
    this.watchaEndpoint = this.normalizeEndpoint(
      this.config.get<string>('WATCHA_SEEDREAM_ENDPOINT') ||
        'https://tokendance.agent-universe.cn/gateway/ark',
    );
    this.watchaModel =
      this.config.get<string>('WATCHA_SEEDREAM_MODEL')?.trim() || 'seedream-5.0-lite';

    if (!this.doubaoApiKey) {
      this.logger.warn(
        'Doubao Seedream key missing. Please set ARK_API_KEY (or DOUBAO_API_KEY).',
      );
    }
    if (!this.watchaApiKey) {
      this.logger.warn(
        'Watcha Seedream key missing. Please set WATCHA_SEEDREAM_API_KEY.',
      );
    }
  }

  private normalizeApiKey(value?: string): string {
    if (!value) return '';
    let key = value.trim();
    if (
      (key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))
    ) {
      key = key.slice(1, -1).trim();
    }
    if (/^Bearer\s+/i.test(key)) {
      key = key.replace(/^Bearer\s+/i, '').trim();
    }
    return key;
  }

  private normalizeEndpoint(endpoint: string): string {
    return endpoint.trim().replace(/\/+$/, '');
  }

  private buildUrl(base: string, path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  }

  private normalizeSize(size?: string): string {
    const raw = typeof size === 'string' ? size.trim() : '';
    if (!raw) return '2K';

    const compact = raw.replace(/\s+/g, '');
    const upper = compact.toUpperCase();
    if (Seedream5Service.SIZE_PRESETS.has(upper)) {
      return upper;
    }

    const dimMatch = compact.match(Seedream5Service.DIMENSION_PATTERN);
    if (dimMatch) {
      const width = Number.parseInt(dimMatch[1], 10);
      const height = Number.parseInt(dimMatch[2], 10);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return `${width}x${height}`;
      }
    }

    this.logger.warn(`Seedream5 size "${raw}" is invalid, fallback to 2K`);
    return '2K';
  }

  private normalizeSizeForProvider(
    provider: Seedream5ProviderType,
    size: string,
  ): string {
    if (provider === 'watcha' && size.toUpperCase() === '3K') {
      this.logger.warn('Watcha Seedream does not document 3K size, fallback to 2K');
      return '2K';
    }
    return size;
  }

  private async getConfiguredProvider(): Promise<Seedream5ProviderType> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: SEEDREAM5_PROVIDER_SETTING_KEY },
      });
      if (setting && (setting.value === 'doubao' || setting.value === 'watcha')) {
        return setting.value;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to read seedream5 provider setting: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
    return 'doubao';
  }

  private normalizeDoubaoModelVersion(value?: string): Seedream5ModelVersion | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === '4.5' || normalized === '4-5') return '4.5';
    if (normalized === '5.0' || normalized === '5-0' || normalized === '5') return '5.0';
    return null;
  }

  private resolveDoubaoModel(options?: {
    requestedModel?: string;
    requestedModelVersion?: string;
  }): string {
    const requestedModel = options?.requestedModel?.trim().toLowerCase() || '';
    if (requestedModel.includes('seedream-4-5') || requestedModel.includes('seedream-4.5')) {
      return DOUBAO_SEEDREAM_45_MODEL;
    }
    if (requestedModel.includes('seedream-5-0') || requestedModel.includes('seedream-5.0')) {
      return DOUBAO_SEEDREAM_50_MODEL;
    }

    const requestedModelVersion = this.normalizeDoubaoModelVersion(options?.requestedModelVersion);
    if (requestedModelVersion === '4.5') {
      return DOUBAO_SEEDREAM_45_MODEL;
    }
    return DOUBAO_SEEDREAM_50_MODEL;
  }

  private async resolveProviderConfig(options?: {
    requestedModel?: string;
    requestedModelVersion?: string;
  }): Promise<Seedream5ProviderConfig> {
    const provider = await this.getConfiguredProvider();

    if (provider === 'watcha') {
      if (!this.watchaApiKey) {
        throw new Error(
          'Seedream5 watcha provider selected, but WATCHA_SEEDREAM_API_KEY is not configured',
        );
      }
      return {
        provider: 'watcha',
        endpoint: this.watchaEndpoint,
        apiKey: this.watchaApiKey,
        model: this.watchaModel,
        generationPath: '/v3/images/generations',
      };
    }

    if (!this.doubaoApiKey) {
      throw new Error('Seedream5 Doubao key not configured (ARK_API_KEY or DOUBAO_API_KEY)');
    }
    return {
      provider: 'doubao',
      endpoint: this.doubaoEndpoint,
      apiKey: this.doubaoApiKey,
      model: this.resolveDoubaoModel({
        requestedModel: options?.requestedModel,
        requestedModelVersion: options?.requestedModelVersion,
      }),
      generationPath: '/api/v3/images/generations',
    };
  }

  async getProviderExecutionInfo(): Promise<{
    provider: Seedream5ProviderType;
    model: string;
    endpoint: string;
  }> {
    return this.getProviderExecutionInfoWithOptions();
  }

  async getProviderExecutionInfoWithOptions(options?: {
    requestedModel?: string;
    requestedModelVersion?: string;
  }): Promise<{
    provider: Seedream5ProviderType;
    model: string;
    endpoint: string;
  }> {
    const config = await this.resolveProviderConfig(options);
    return {
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint,
    };
  }

  async generateImage(params: {
    prompt?: string;
    size?: string;
    image_urls?: string[];
    batchMode?: boolean;
    batchCount?: number;
    model?: string;
    modelVersion?: string;
  }): Promise<{ imageUrl?: string; imageUrls?: string[] }> {
    const providerConfig = await this.resolveProviderConfig({
      requestedModel: params.model,
      requestedModelVersion: params.modelVersion,
    });
    const normalizedSize = this.normalizeSizeForProvider(
      providerConfig.provider,
      this.normalizeSize(params.size),
    );

    const payload: any = {
      model: providerConfig.model,
      sequential_image_generation: params.batchMode ? 'auto' : 'disabled',
      response_format: 'url',
      size: normalizedSize,
      stream: false,
      watermark: false,
    };

    if (params.batchMode && params.batchCount) {
      payload.sequential_image_generation_options = {
        max_images: Math.min(Math.max(params.batchCount, 2), 10),
      };
    }

    if (params.prompt) {
      payload.prompt = params.prompt;
    }

    if (params.image_urls && params.image_urls.length > 0) {
      payload.image =
        params.image_urls.length === 1
          ? params.image_urls[0]
          : params.image_urls.slice(0, 5);
    }

    const requestUrl = this.buildUrl(providerConfig.endpoint, providerConfig.generationPath);
    this.logger.log(
      `Seedream5 request provider=${providerConfig.provider}, model=${providerConfig.model}, size=${normalizedSize}, imageCount=${params.image_urls?.length || 0}, batchMode=${!!params.batchMode}, url=${requestUrl}`,
    );

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || error.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const images = Array.isArray(data.data) ? data.data : [];
    const imageUrls = images
      .map((img: any) => (typeof img?.url === 'string' ? img.url : ''))
      .filter((url: string) => !!url);

    if (imageUrls.length === 1) {
      return { imageUrl: imageUrls[0] };
    }
    if (imageUrls.length > 1) {
      return { imageUrls };
    }

    throw new Error('No image URL returned from Seedream5 provider');
  }

  async queryTask(taskId: string): Promise<{
    status: string;
    imageUrl?: string;
    imageUrls?: string[];
  }> {
    const providerConfig = await this.resolveProviderConfig();
    const response = await fetch(
      `${this.buildUrl(providerConfig.endpoint, providerConfig.generationPath)}/${taskId}`,
      {
        headers: { Authorization: `Bearer ${providerConfig.apiKey}` },
      },
    );

    if (!response.ok) {
      throw new Error(`Query failed: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'succeeded' || data.status === 'completed') {
      const images = Array.isArray(data.data) ? data.data : [];
      const imageUrls = images
        .map((img: any) => (typeof img?.url === 'string' ? img.url : ''))
        .filter((url: string) => !!url);

      if (imageUrls.length === 1) {
        return { status: 'succeeded', imageUrl: imageUrls[0] };
      }
      if (imageUrls.length > 1) {
        return { status: 'succeeded', imageUrls };
      }
    }

    if (data.status === 'failed') {
      return { status: 'failed' };
    }

    return { status: data.status || 'processing' };
  }
}
