import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';
import {
  AIProviderResponse,
  AnalysisResult,
  IAIProvider,
  ImageAnalysisRequest,
  ImageBlendRequest,
  ImageEditRequest,
  ImageGenerationRequest,
  ImageResult,
  PaperJSGenerateRequest,
  PaperJSResult,
  ProviderOptionsPayload,
  TextChatRequest,
  TextResult,
  ToolSelectionRequest,
  ToolSelectionResult,
} from './ai-provider.interface';
import { normalizeGeminiImageSize } from '../image-size.util';

// 图片生成/编辑链路上游可能跑很久（大图 + 4K），把 undici 默认 5 分钟
// 的 headers/body 超时放宽到 20 分钟，避免在等上游时被本地 fetch 砍断。
const LONG_RUNNING_TIMEOUT_MS = 20 * 60 * 1000;

// 应用层：单次图片请求超时 15 分钟，超时后重试
const IMAGE_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const IMAGE_MAX_RETRIES = 2;
const IMAGE_RETRY_DELAYS = [5_000, 15_000];

@Injectable()
export class NewApiProvider implements IAIProvider {
  private readonly logger = new Logger(NewApiProvider.name);
  private readonly httpDispatcher = new Agent({
    headersTimeout: LONG_RUNNING_TIMEOUT_MS,
    bodyTimeout: LONG_RUNNING_TIMEOUT_MS,
    connectTimeout: 10_000,
    keepAliveTimeout: 60_000,
  });
  private available = false;
  private baseUrl = 'http://localhost:4458';
  private apiKey = '';
  private vipApiKey = '';
  private svipApiKey = '';

  constructor(private readonly config: ConfigService) {}

  async initialize(): Promise<void> {
    this.baseUrl = this.normalizeBaseUrl(
      this.config.get<string>('NEW_API_BASE_URL') ||
        process.env.NEW_API_BASE_URL ||
        'http://localhost:4458',
    );
    this.apiKey =
      this.config.get<string>('NEW_API_KEY') ||
      process.env.NEW_API_KEY ||
      this.config.get<string>('NEW_API_TOKEN') ||
      process.env.NEW_API_TOKEN ||
      '';
    this.vipApiKey =
      this.config.get<string>('NEW_API_KEY_VIP') ||
      process.env.NEW_API_KEY_VIP ||
      '';
    this.svipApiKey =
      this.config.get<string>('NEW_API_KEY_SVIP') ||
      process.env.NEW_API_KEY_SVIP ||
      '';
    this.available = !!this.apiKey;
    this.logger.log(
      `new-api provider initialized: ${this.available ? 'available' : 'unavailable'} (${this.baseUrl})`,
    );
  }

  isAvailable(): boolean {
    return this.available;
  }

  getProviderInfo() {
    return {
      name: 'new-api',
      version: 'openai-compatible',
      supportedModels: ['gemini', 'gpt-image-2', 'sora-2', 'kling-v3', 'wan2.7-videoedit'],
    };
  }

  async generateImage(
    request: ImageGenerationRequest,
  ): Promise<AIProviderResponse<ImageResult>> {
    const payload: Record<string, unknown> = {
      model: this.resolveUltraModel(request.model || 'gemini-2.5-flash-image-preview', request.providerOptions),
      prompt: request.prompt,
      n: this.resolveImageCount(request),
      size: request.aspectRatio || '1:1',
      resolution: this.normalizeResolution(request.imageSize),
      image_urls: request.imageUrls,
      quality: request.quality,
      background: request.background,
      moderation: request.moderation,
      output_format: request.outputFormat,
      output_compression: request.outputCompression,
      google_search: request.googleSearch ?? request.enableWebSearch,
      google_image_search: request.googleImageSearch ?? request.enableWebSearch,
      official_fallback: request.officialFallback,
    };

    return this.callImageEndpoint(payload, 'IMAGE_GENERATION_FAILED', request.providerOptions);
  }

  async editImage(request: ImageEditRequest): Promise<AIProviderResponse<ImageResult>> {
    const payload: Record<string, unknown> = {
      model: this.resolveUltraModel(request.model || 'gemini-2.5-flash-image-preview', request.providerOptions),
      prompt: request.prompt,
      n: 1,
      size: request.aspectRatio || '1:1',
      resolution: this.normalizeResolution(request.imageSize),
      image_urls: [this.toImageReference(request.sourceImage)],
      output_format: request.outputFormat,
    };

    return this.callImageEndpoint(payload, 'IMAGE_EDIT_FAILED', request.providerOptions);
  }

  async blendImages(request: ImageBlendRequest): Promise<AIProviderResponse<ImageResult>> {
    const payload: Record<string, unknown> = {
      model: this.resolveUltraModel(request.model || 'gemini-2.5-flash-image-preview', request.providerOptions),
      prompt: request.prompt,
      n: 1,
      size: request.aspectRatio || '1:1',
      resolution: this.normalizeResolution(request.imageSize),
      image_urls: request.sourceImages.map((item) => this.toImageReference(item)),
      output_format: request.outputFormat,
    };

    return this.callImageEndpoint(payload, 'IMAGE_BLEND_FAILED', request.providerOptions);
  }

  async analyzeImage(
    request: ImageAnalysisRequest,
  ): Promise<AIProviderResponse<AnalysisResult>> {
    const imageUrls = [
      ...(request.sourceImage ? [request.sourceImage] : []),
      ...(request.sourceImages || []),
    ].map((item) => this.toImageReference(item));

    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: request.prompt || '请分析这张图片。' },
      ...imageUrls.map((url) => ({
        type: 'image_url',
        image_url: { url },
      })),
    ];

    const result = await this.chat(
      {
        model: request.model || 'gemini-3.1-pro',
        messages: [{ role: 'user', content }],
      },
      request.providerOptions,
    );

    if (!result.success) return result as AIProviderResponse<AnalysisResult>;
    return {
      success: true,
      data: {
        text: result.data?.text || '',
        tags: [],
      },
    };
  }

  async generateText(request: TextChatRequest): Promise<AIProviderResponse<TextResult>> {
    return this.chat(
      {
        model: request.model || 'gemini-3.1-pro',
        messages: [{ role: 'user', content: request.prompt }],
        ...(request.enableWebSearch ? { tools: [{ type: 'web_search_preview' }] } : {}),
        ...(request.thinkingLevel ? { thinking_level: request.thinkingLevel } : {}),
      },
      request.providerOptions,
    );
  }

  async selectTool(
    request: ToolSelectionRequest,
  ): Promise<AIProviderResponse<ToolSelectionResult>> {
    const prompt = [
      '你是工具选择器。只返回 JSON：{"selectedTool":"...","reasoning":"...","confidence":0.0}',
      `用户输入：${request.prompt}`,
      `可用工具：${(request.availableTools || []).join(', ') || '未提供'}`,
      `上下文：${request.context || ''}`,
      `图片：${request.hasImages ? `${request.imageCount || 1} 张` : '无'}`,
    ].join('\n');

    const result = await this.generateText({
      prompt,
      model: request.model || 'gemini-3.1-pro',
      providerOptions: request.providerOptions,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    const raw = result.data?.text || '';
    const parsed = this.parseJsonObject(raw);
    const selectedTool =
      typeof parsed?.selectedTool === 'string'
        ? parsed.selectedTool
        : request.availableTools?.[0] || 'chat';

    return {
      success: true,
      data: {
        selectedTool,
        reasoning:
          typeof parsed?.reasoning === 'string'
            ? parsed.reasoning
            : 'new-api selected a fallback tool',
        confidence:
          typeof parsed?.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5,
      },
    };
  }

  async generatePaperJS(
    request: PaperJSGenerateRequest,
  ): Promise<AIProviderResponse<PaperJSResult>> {
    const result = await this.generateText({
      prompt: request.prompt,
      model: request.model || 'gemini-3.1-pro',
      thinkingLevel: request.thinkingLevel,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }
    return {
      success: true,
      data: {
        code: result.data?.text || '',
        metadata: result.data?.metadata,
      },
    };
  }

  async img2Vector(request: {
    sourceImage: string;
    prompt?: string;
    model?: string;
    thinkingLevel?: 'high' | 'low';
    canvasWidth?: number;
    canvasHeight?: number;
    style?: 'simple' | 'detailed' | 'artistic';
  }): Promise<
    AIProviderResponse<{
      code: string;
      imageAnalysis: string;
      explanation?: string;
    }>
  > {
    const imageUrl = this.toImageReference(request.sourceImage);
    const prompt = [
      '请分析这张图片，并生成可在 Paper.js 中运行的矢量绘制代码。',
      `画布尺寸：${request.canvasWidth || 1920}x${request.canvasHeight || 1080}`,
      `风格：${request.style || 'detailed'}`,
      request.prompt ? `用户补充要求：${request.prompt}` : '',
      '输出必须包含：',
      '1. imageAnalysis: 对图片内容的简短分析',
      '2. code: 完整 Paper.js JavaScript 代码',
      '3. explanation: 简短说明',
      '请只返回 JSON 对象，不要 Markdown 代码块。',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.chat({
      model: request.model || 'gemini-3.1-pro',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      ...(request.thinkingLevel ? { thinking_level: request.thinkingLevel } : {}),
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    const raw = result.data?.text || '';
    const parsed = this.parseJsonObject(raw);
    const code =
      typeof parsed?.code === 'string'
        ? parsed.code
        : this.extractCodeBlock(raw) || raw;

    return {
      success: true,
      data: {
        code,
        imageAnalysis:
          typeof parsed?.imageAnalysis === 'string' ? parsed.imageAnalysis : '',
        explanation:
          typeof parsed?.explanation === 'string' ? parsed.explanation : undefined,
      },
    };
  }

  private static readonly ULTRA_CAPABLE_MODELS = new Set([
    'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image-preview',
  ]);

  private resolveApiKey(providerOptions?: ProviderOptionsPayload, resolvedModel?: string): string {
    const imageRoute =
      providerOptions?.banana?.imageRoute ||
      (typeof (providerOptions as any)?.bananaImageRoute === 'string'
        ? (providerOptions as any).bananaImageRoute
        : undefined);

    // 极速路线仅对真正支持 ultra 的模型生效，其他模型降级走普通路线
    if (
      imageRoute === 'ultra' &&
      this.svipApiKey &&
      resolvedModel &&
      NewApiProvider.ULTRA_CAPABLE_MODELS.has(resolvedModel)
    ) {
      return this.svipApiKey;
    }
    if (imageRoute === 'stable' && this.vipApiKey) return this.vipApiKey;

    // 通过模型路由系统选中 new_api 渠道时也走 VIP key
    const vendorKey = (providerOptions as any)?.vendorKey;
    const platformKey = (providerOptions as any)?.platformKey;
    if ((vendorKey === 'new_api' || platformKey === 'new_api') && this.vipApiKey) {
      return this.vipApiKey;
    }

    return this.apiKey;
  }

  private static readonly MODEL_ALIAS_MAP: Record<string, string> = {
    'gemini-3.1-image': 'gemini-3.1-flash-image-preview',
    'gemini-3.1-image-edit': 'gemini-3.1-flash-image-preview',
    'gemini-3.1-image-blend': 'gemini-3.1-flash-image-preview',
    'gemini-3.1-image-analyze': 'gemini-3.1-flash-image-preview',
    'gemini-2.5-image': 'gemini-2.5-flash-image-preview',
    // 兜底：裸名（无 -preview）规整为 new-api 实际配置的渠道模型名，避免 503 无可用渠道
    'gemini-2.5-flash-image': 'gemini-2.5-flash-image-preview',
    'gemini-2.5-image-edit': 'gemini-2.5-flash-image-preview',
    'gemini-2.5-image-blend': 'gemini-2.5-flash-image-preview',
    'gemini-2.5-image-analyze': 'gemini-2.5-flash-image-preview',
    'gemini-3-pro-image': 'gemini-3-pro-image-preview',
    'gemini-3-pro-image-edit': 'gemini-3-pro-image-preview',
    'gemini-3-pro-image-blend': 'gemini-3-pro-image-preview',
    'gemini-3-pro-image-analyze': 'gemini-3-pro-image-preview',
    'gemini-image-edit': 'gemini-3-pro-image-preview',
    'gemini-image-blend': 'gemini-3-pro-image-preview',
    'gemini-image-analyze': 'gemini-3-pro-image-preview',
  };

  private normalizeUpstreamModel(model: string): string {
    return NewApiProvider.MODEL_ALIAS_MAP[model] || model;
  }

  // 上游始终发真模型名；vip / svip 路线通过 API key 切到 new-api 对应分组
  private resolveUltraModel(model: string, _providerOptions?: ProviderOptionsPayload): string {
    return this.normalizeUpstreamModel(model);
  }

  private isRetryableImageError(error: unknown): boolean {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('abort') ||
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('econnreset') ||
      msg.includes('socket') ||
      msg.includes('hang') ||
      msg.includes('wall-clock')
    );
  }

  private async callImageEndpoint(
    payload: Record<string, unknown>,
    errorCode: string,
    providerOptions?: ProviderOptionsPayload,
  ): Promise<AIProviderResponse<ImageResult>> {
    const apiKey = this.resolveApiKey(providerOptions, payload.model as string | undefined);
    let lastError: unknown;

    for (let attempt = 1; attempt <= IMAGE_MAX_RETRIES + 1; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(new Error(`image request timed out after ${IMAGE_REQUEST_TIMEOUT_MS / 60_000}min`)),
        IMAGE_REQUEST_TIMEOUT_MS,
      );

      try {
        const result = await this.requestJson(
          '/v1/images/generations',
          {
            method: 'POST',
            body: JSON.stringify(this.stripUndefined(payload)),
            signal: controller.signal,
          },
          apiKey,
        );
        clearTimeout(timeoutId);

        const imageUrls = this.extractImageUrls(result);
        const imageData = this.extractImageData(result);
        const textResponse =
          this.extractText(result) ||
          (imageUrls.length > 0 || imageData ? 'Image generated successfully' : '');

        return {
          success: true,
          data: {
            imageUrl: imageUrls[0],
            imageData,
            textResponse,
            hasImage: imageUrls.length > 0 || !!imageData,
            metadata: {
              provider: 'new-api',
              model: payload.model,
              imageUrls,
              raw: result,
            },
          },
        };
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;

        if (attempt <= IMAGE_MAX_RETRIES && this.isRetryableImageError(error)) {
          const delay = IMAGE_RETRY_DELAYS[attempt - 1] ?? IMAGE_RETRY_DELAYS.at(-1)!;
          this.logger.warn(
            `image endpoint attempt ${attempt} failed: ${(error as Error).message}, retrying in ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return this.errorResponse(errorCode, error);
      }
    }

    return this.errorResponse(errorCode, lastError);
  }

  private async chat(
    payload: Record<string, unknown>,
    providerOptions?: ProviderOptionsPayload,
  ): Promise<AIProviderResponse<TextResult>> {
    try {
      if (typeof payload.model === 'string') {
        payload = { ...payload, model: this.normalizeUpstreamModel(payload.model) };
      }
      const result = await this.requestJson(
        '/v1/chat/completions',
        {
          method: 'POST',
          body: JSON.stringify(this.stripUndefined({ ...payload, stream: false })),
        },
        this.resolveApiKey(providerOptions),
      );
      return {
        success: true,
        data: {
          text: this.extractText(result),
          metadata: {
            provider: 'new-api',
            model: payload.model,
            raw: result,
          },
        },
      };
    } catch (error) {
      return this.errorResponse('TEXT_GENERATION_FAILED', error);
    }
  }

  private async requestJson(path: string, init: RequestInit, apiKey?: string): Promise<any> {
    const key = apiKey || this.apiKey;
    if (!key) {
      throw new Error('NEW_API_KEY 未配置');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      // @ts-expect-error undici 在 Node fetch 上扩展了 dispatcher 字段
      dispatcher: this.httpDispatcher,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    if (!text || !text.trim()) {
      this.logger.warn(
        `new-api empty response body: status=${response.status} url=${this.baseUrl}${path} content-type=${response.headers.get('content-type') ?? 'none'}`,
      );
    }
    const data = text ? this.parseJsonObject(text) || text : {};
    if (response.ok && typeof data === 'string') {
      this.logger.warn(
        `new-api response not JSON: status=${response.status} url=${this.baseUrl}${path} preview=${String(data).slice(0, 200)}`,
      );
    }
    if (!response.ok) {
      const message =
        typeof data === 'object' && data
          ? data.error?.message || data.message || JSON.stringify(data)
          : String(data || `HTTP ${response.status}`);
      throw new Error(`new-api HTTP ${response.status}: ${message}`);
    }
    return data;
  }

  private errorResponse<T>(code: string, error: unknown): AIProviderResponse<T> {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    this.logger.error(message);
    return {
      success: false,
      error: {
        code,
        message,
        details: error,
      },
    };
  }

  private extractText(result: any): string {
    const choice = result?.choices?.[0];
    const content = choice?.message?.content ?? choice?.text;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => part?.text || part?.content || '')
        .filter(Boolean)
        .join('');
    }
    if (typeof result?.output_text === 'string') return result.output_text;
    if (typeof result?.text === 'string') return result.text;
    if (typeof result?.data?.text === 'string') return result.data.text;
    return '';
  }

  private extractCodeBlock(text: string): string {
    const match = text.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
    return match?.[1]?.trim() || '';
  }

  private extractImageUrls(result: any): string[] {
    const candidates = [
      ...(Array.isArray(result?.data) ? result.data : []),
      ...(Array.isArray(result?.images) ? result.images : []),
      ...(Array.isArray(result?.output) ? result.output : []),
    ];
    const urls = new Set<string>();
    for (const item of candidates) {
      const value =
        item?.url ||
        item?.image_url ||
        item?.imageUrl ||
        item?.b64_json_url ||
        item?.content?.url;
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
        urls.add(value);
      }
    }
    for (const key of ['url', 'image_url', 'imageUrl']) {
      const value = result?.[key] || result?.data?.[key];
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
        urls.add(value);
      }
    }
    return Array.from(urls);
  }

  private extractImageData(result: any): string | undefined {
    const candidates = [
      ...(Array.isArray(result?.data) ? result.data : []),
      ...(Array.isArray(result?.images) ? result.images : []),
      result,
      result?.data,
    ];
    for (const item of candidates) {
      const value = item?.b64_json || item?.imageData || item?.image_data;
      if (typeof value === 'string' && value.trim()) {
        return value.replace(/^data:image\/[^;]+;base64,/i, '');
      }
    }
    return undefined;
  }

  private toImageReference(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) return trimmed;
    if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
    return `data:image/png;base64,${trimmed.replace(/^data:image\/[^;]+;base64,/i, '')}`;
  }

  private normalizeResolution(value: unknown): string | undefined {
    // 前端的 "0.5K" 需转换成 Gemini API 实际枚举 "512"，否则上游返回 invalid argument
    return normalizeGeminiImageSize(value);
  }

  private resolveImageCount(request: ImageGenerationRequest): number {
    if (!request.batchMode) return 1;
    const count = Number(request.batchCount);
    if (!Number.isFinite(count)) return 1;
    return Math.max(1, Math.min(10, Math.floor(count)));
  }

  private normalizeBaseUrl(value: string): string {
    return value.trim().replace(/\/+$/, '');
  }

  private stripUndefined(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
  }

  private parseJsonObject(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      const match = value.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
}
