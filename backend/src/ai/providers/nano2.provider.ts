import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider } from './ai-provider.interface';
import { Nano2Service } from '../services/nano2.service';
import { TencentVodAigcService } from '../services/tencent-vod-aigc.service';

type BananaImageRoute = 'normal' | 'stable';
type GptImage2Quality = 'auto' | 'low' | 'medium' | 'high';
type GptImage2Background = 'auto' | 'opaque' | 'transparent';
type GptImage2Moderation = 'auto' | 'low';
type GptImage2OutputFormat = 'png' | 'jpeg' | 'webp';
const GPT_IMAGE_2_ROUTE_LOG_TAG = '[GPT-IMAGE-2-ROUTE]';

@Injectable()
export class Nano2Provider implements IAIProvider {
  private readonly logger = new Logger(Nano2Provider.name);
  private available = false;

  constructor(
    private readonly config: ConfigService,
    private readonly nano2Service: Nano2Service,
    private readonly tencentVodAigcService: TencentVodAigcService,
  ) {}

  async initialize(): Promise<void> {
    const apiKey = this.config.get<string>('NANO2_API_KEY');
    const apimartReady = !!apiKey;
    const tencentReady = this.tencentVodAigcService.isAvailable();
    this.available = apimartReady || tencentReady;
    this.logger.log(
      `Nano2 provider initialized: ${this.available ? 'available' : 'unavailable'} (apimart=${apimartReady}, tencent=${tencentReady})`,
    );
  }

  isAvailable(): boolean {
    return this.available;
  }

  getProviderInfo(): any {
    return { name: 'nano2', model: 'gpt-image-2' };
  }

  private normalizeRoute(raw: unknown): BananaImageRoute | null {
    if (typeof raw !== 'string') return null;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'normal' || normalized === 'apimart') return 'normal';
    if (normalized === 'stable' || normalized === 'tencent') return 'stable';
    return null;
  }

  private resolveUserRoute(providerOptions?: Record<string, any>): BananaImageRoute {
    const nested = this.normalizeRoute(providerOptions?.banana?.imageRoute);
    if (nested) return nested;
    const legacy = this.normalizeRoute(providerOptions?.bananaImageRoute);
    if (legacy) return legacy;
    return 'normal';
  }

  private isGptImage2Model(model: string): boolean {
    return model.toLowerCase().includes('gpt-image-2');
  }

  private normalizeResolution(rawResolution: unknown, isGptImage2Model: boolean): string {
    const normalized = String(rawResolution || '1K').trim().toUpperCase();
    if (normalized === '2K') return isGptImage2Model ? '2k' : '2K';
    if (normalized === '4K') return isGptImage2Model ? '4k' : '4K';
    return isGptImage2Model ? '1k' : '1K';
  }

  private normalizeImageSizeToken(rawImageSize: unknown): '1K' | '2K' | '4K' {
    const normalized = String(rawImageSize || '1K').trim().toUpperCase();
    if (normalized === '2K') return '2K';
    if (normalized === '4K') return '4K';
    return '1K';
  }

  private toTencentFileInfos(
    imageUrls?: unknown,
  ): Array<{ type: 'File' | 'Url'; fileId?: string; url?: string }> {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) return [];

    const results: Array<{ type: 'File' | 'Url'; fileId?: string; url?: string }> = [];
    for (const raw of imageUrls) {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) continue;

      const prefixed = value.match(/^(?:tencent-fileid:|fileid:)(.+)$/i);
      if (prefixed?.[1]) {
        const fileId = prefixed[1].trim();
        if (fileId) {
          results.push({ type: 'File', fileId });
          continue;
        }
      }

      if (/^\d{6,}$/.test(value)) {
        results.push({ type: 'File', fileId: value });
        continue;
      }

      if (/^https?:\/\//i.test(value)) {
        results.push({ type: 'Url', url: value });
      }
    }

    return results;
  }

  private resolveTencentGptImage2Version(
    quality: GptImage2Quality | undefined,
    imageSize: '1K' | '2K' | '4K',
  ): 'image2_low' | 'image2_medium' | 'image2_high' {
    if (quality === 'high') return 'image2_high';
    if (quality === 'medium') return 'image2_medium';
    if (quality === 'low') return 'image2_low';

    if (imageSize === '4K') return 'image2_high';
    if (imageSize === '2K') return 'image2_medium';
    return 'image2_low';
  }

  private normalizeOutputFormat(raw: unknown): GptImage2OutputFormat | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'png' || normalized === 'jpeg' || normalized === 'webp') {
      return normalized as GptImage2OutputFormat;
    }
    return undefined;
  }

  private normalizeQuality(raw: unknown): GptImage2Quality | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'auto' || normalized === 'low' || normalized === 'medium' || normalized === 'high') {
      return normalized as GptImage2Quality;
    }
    return undefined;
  }

  private normalizeBackground(raw: unknown): GptImage2Background | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'auto' || normalized === 'opaque' || normalized === 'transparent') {
      return normalized as GptImage2Background;
    }
    return undefined;
  }

  private normalizeModeration(raw: unknown): GptImage2Moderation | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'auto' || normalized === 'low') {
      return normalized as GptImage2Moderation;
    }
    return undefined;
  }

  private normalizeOutputCompression(raw: unknown): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Math.max(0, Math.min(100, Math.trunc(raw)));
  }

  private isUpstream5xxError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return /HTTP\s5\d\d/.test(message);
  }

  private async generateGptImage2ViaTencent(request: {
    prompt: string;
    imageUrls: unknown;
    requestedModel: string;
    requestedSize: string;
    resolution: string;
    quality?: GptImage2Quality;
    userRoute: BananaImageRoute;
    negativePrompt?: unknown;
    enhancePrompt?: unknown;
    sessionContext?: unknown;
    sessionId?: unknown;
  }): Promise<any> {
    this.logger.log(
      `${GPT_IMAGE_2_ROUTE_LOG_TAG} matched stable route -> tencent_vod_aigc (model=${request.requestedModel})`,
    );

    if (!this.tencentVodAigcService.isAvailable()) {
      throw new Error(
        'Tencent VOD AIGC credentials are not configured. Please set TENCENT_VOD_SECRET_ID/TENCENT_VOD_SECRET_KEY/TENCENT_VOD_SUB_APP_ID.',
      );
    }

    const fileInfos = this.toTencentFileInfos(request.imageUrls);
    if (Array.isArray(request.imageUrls) && request.imageUrls.length > 0 && fileInfos.length === 0) {
      return {
        success: false,
        error: {
          message: 'Tencent reference images require Tencent FileId or public URL.',
        },
      };
    }

    const imageSize = this.normalizeImageSizeToken(request.resolution);
    const modelVersion = this.resolveTencentGptImage2Version(request.quality, imageSize);
    const negativePrompt =
      typeof request.negativePrompt === 'string' && request.negativePrompt.trim()
        ? request.negativePrompt.trim()
        : undefined;
    const enhancePrompt =
      request.enhancePrompt === 'Disabled' || request.enhancePrompt === 'Enabled'
        ? request.enhancePrompt
        : 'Enabled';
    const sessionContext =
      typeof request.sessionContext === 'string' && request.sessionContext.trim()
        ? request.sessionContext.trim()
        : undefined;
    const sessionId =
      typeof request.sessionId === 'string' && request.sessionId.trim()
        ? request.sessionId.trim()
        : undefined;

    this.logger.log(
      `[Nano2/Image/Tencent] route=${request.userRoute}, requestedModel=${request.requestedModel}, mapped=OG/${modelVersion}, size=${request.requestedSize}, resolution=${imageSize}, refs=${fileInfos.length}`,
    );

    let taskId = '';
    let requestId: string | undefined;
    let taskResult: Awaited<ReturnType<TencentVodAigcService['waitForImageResult']>>;
    try {
      const created = await this.tencentVodAigcService.createImageTask({
        prompt: request.prompt,
        modelName: 'OG',
        modelVersion,
        fileInfos,
        aspectRatio: request.requestedSize,
        imageSize,
        negativePrompt,
        enhancePrompt,
        sessionContext,
        sessionId,
      });
      taskId = created.taskId;
      requestId = created.requestId;
      this.logger.log(
        `${GPT_IMAGE_2_ROUTE_LOG_TAG} Tencent task submitted taskId=${taskId}, requestId=${requestId || 'n/a'}`,
      );

      taskResult = await this.tencentVodAigcService.waitForImageResult(taskId, {
        maxWaitMs: 15 * 60 * 1000,
        maxPollAttempts: 320,
      });
      if (!taskResult.imageUrl) {
        throw new Error(`Tencent task ${taskId} completed but image URL is missing.`);
      }
      this.logger.log(
        `${GPT_IMAGE_2_ROUTE_LOG_TAG} Tencent task completed taskId=${taskId}, imageUrl=${taskResult.imageUrl}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${GPT_IMAGE_2_ROUTE_LOG_TAG} Tencent route failed taskId=${taskId || 'n/a'} error=${message}`,
      );
      throw error;
    }

    return {
      success: true,
      data: {
        imageData: null,
        imageUrl: taskResult.imageUrl,
        textResponse: 'Image generated successfully',
        metadata: {
          taskId,
          requestId: taskResult.requestId || requestId,
          imageUrl: taskResult.imageUrl,
          provider: 'tencent',
          aiProvider: 'nano2',
          channel: 'tencent_vod_aigc',
          model: request.requestedModel,
          upstreamModelName: 'OG',
          upstreamModelVersion: modelVersion,
          route: request.userRoute,
          resolution: imageSize,
        },
      },
    };
  }

  async generateImage(request: any): Promise<any> {
    const requestedModel =
      typeof request.model === 'string' && request.model.trim()
        ? request.model.trim()
        : 'gemini-3.1-flash-image-preview';
    const isGptImage2Model = this.isGptImage2Model(requestedModel);
    const userRoute = this.resolveUserRoute(request.providerOptions);
    const useTencentStableRoute = isGptImage2Model && userRoute === 'stable';
    // Stable route is now handled by Tencent; keep legacy official-profile flag disabled.
    const useOfficialProfile = false;
    const upstreamModel = requestedModel;
    const requestedSize = (() => {
      const raw = request.aspectRatio ?? (isGptImage2Model ? '1:1' : '16:9');
      return typeof raw === 'string' && raw.trim() ? raw.trim() : (isGptImage2Model ? '1:1' : '16:9');
    })();

    const normalizedResolution = this.normalizeResolution(
      request.resolution || request.imageSize || '1K',
      isGptImage2Model,
    );

    if (isGptImage2Model) {
      this.logger.log(
        `${GPT_IMAGE_2_ROUTE_LOG_TAG} decision route=${userRoute}, useTencentStableRoute=${useTencentStableRoute}, model=${requestedModel}, resolution=${normalizedResolution}`,
      );
    }

    if (useTencentStableRoute) {
      return this.generateGptImage2ViaTencent({
        prompt: request.prompt,
        imageUrls: request.imageUrls || request.image_urls,
        requestedModel,
        requestedSize,
        resolution: normalizedResolution,
        quality: this.normalizeQuality(request.quality),
        userRoute,
        negativePrompt: request.negativePrompt ?? request.negative_prompt,
        enhancePrompt: request.enhancePrompt,
        sessionContext: request.sessionContext,
        sessionId: request.sessionId,
      });
    }

    this.logger.log(
      `[Nano2/Image] route=${userRoute}, requestedModel=${requestedModel}, upstreamModel=${upstreamModel}, size=${requestedSize}, resolution=${normalizedResolution}`,
    );
    if (isGptImage2Model) {
      this.logger.log(`${GPT_IMAGE_2_ROUTE_LOG_TAG} using apimart path (route=${userRoute})`);
    }

    const outputFormat = this.normalizeOutputFormat(request.outputFormat ?? request.output_format);
    const outputCompression = this.normalizeOutputCompression(
      request.outputCompression ?? request.output_compression,
    );
    const maskUrl =
      typeof request.maskUrl === 'string'
        ? request.maskUrl.trim()
        : typeof request.mask_url === 'string'
          ? request.mask_url.trim()
          : '';

    const officialBackground = this.normalizeBackground(request.background) ?? 'auto';
    const sanitizedOfficialBackground = officialBackground === 'transparent' ? 'auto' : officialBackground;
    if (useOfficialProfile && officialBackground === 'transparent') {
      this.logger.warn(
        '[Nano2/Image] gpt-image-2-official does not support transparent background, downgraded to auto',
      );
    }

    const buildSubmitRequest = (resolution: string) => ({
      prompt: request.prompt,
      model: upstreamModel,
      size: requestedSize,
      n: 1,
      image_urls: request.imageUrls || request.image_urls,
      resolution,
      ...(isGptImage2Model
        ? useOfficialProfile
          ? {
              quality: this.normalizeQuality(request.quality) ?? 'auto',
              background: sanitizedOfficialBackground,
              moderation: this.normalizeModeration(request.moderation) ?? 'auto',
              output_format: outputFormat ?? 'png',
              ...((outputFormat === 'jpeg' || outputFormat === 'webp') &&
              typeof outputCompression === 'number'
                ? { output_compression: outputCompression }
                : {}),
              ...(maskUrl ? { mask_url: maskUrl } : {}),
            }
          : {
              official_fallback:
                typeof request.officialFallback === 'boolean' ? request.officialFallback : false,
            }
        : {
            google_search: request.googleSearch,
            google_image_search: request.googleImageSearch,
          }),
    });

    let finalResolution = normalizedResolution;
    let result;
    try {
      result = await this.nano2Service.generateImage(buildSubmitRequest(finalResolution));
    } catch (error) {
      const shouldFallbackTo2k =
        useOfficialProfile &&
        finalResolution === '4k' &&
        this.isUpstream5xxError(error);
      if (!shouldFallbackTo2k) {
        throw error;
      }

      finalResolution = '2k';
      this.logger.warn(
        `[Nano2/Image] Official 4k request failed with upstream 5xx, retrying once with 2k. size=${requestedSize}, model=${upstreamModel}`,
      );
      result = await this.nano2Service.generateImage(buildSubmitRequest(finalResolution));
    }

    this.logger.log(`Nano2 task submitted: ${result.taskId}`);

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
                model: upstreamModel,
                route: userRoute,
                resolution: finalResolution,
              },
            },
          };
        }

        this.logger.warn(`Nano2 task ${result.taskId} succeeded but no imageUrl found`);
        return {
          success: false,
          error: { message: 'Nano2 task completed but no image URL returned' },
        };
      }

      if (taskResult.status === 'failed' || taskResult.status === 'error') {
        return {
          success: false,
          error: { message: 'Nano2 image generation failed' },
        };
      }

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
