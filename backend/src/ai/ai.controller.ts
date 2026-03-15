import {
  Body,
  Controller,
  Logger,
  Post,
  UseGuards,
  ServiceUnavailableException,
  BadGatewayException,
  InternalServerErrorException,
  HttpException,
  Get,
  Optional,
  Req,
  BadRequestException,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ImageGenerationService, ImageGenerationResult } from './image-generation.service';
import { BackgroundRemovalService } from './services/background-removal.service';
import { ImageTaskService } from './services/image-task.service';
import { AIProviderFactory } from './ai-provider.factory';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { ToolSelectionRequestDto } from './dto/tool-selection.dto';
import { RemoveBackgroundDto } from './dto/background-removal.dto';
import {
  GenerateImageDto,
  EditImageDto,
  BlendImagesDto,
  AnalyzeImageDto,
  TextChatDto,
  MidjourneyActionDto,
  MidjourneyModalDto,
  Convert2Dto3DDto,
  ExpandImageDto,
} from './dto/image-generation.dto';
import { PaperJSGenerateRequestDto, PaperJSGenerateResponseDto } from './dto/paperjs-generation.dto';
import { Img2VectorRequestDto, Img2VectorResponseDto } from './dto/img2vector.dto';
import { Convert2Dto3DService } from './services/convert-2d-to-3d.service';
import { ExpandImageService } from './services/expand-image.service';
import { MidjourneyProvider } from './providers/midjourney.provider';
import { UsersService } from '../users/users.service';
import { CreditsService } from '../credits/credits.service';
import { ServiceType } from '../credits/credits.config';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { GenerateVideoDto } from './dto/video-generation.dto';
import { CreateSora2CharacterDto } from './dto/sora2-character.dto';
import { VeoGenerateVideoDto, VeoVideoResponseDto, VeoModelsResponseDto } from './dto/veo-video.dto';
import { Sora2VideoService } from './services/sora2-video.service';
import { VeoVideoService } from './services/veo-video.service';
import { VideoProviderService } from './services/video-provider.service';
import { applyWatermarkToBase64 } from './services/watermark.util';
import { VideoWatermarkService } from './services/video-watermark.service';
import { VideoProviderRequestDto } from './dto/video-provider.dto';
import { AnalyzeVideoDto } from './dto/video-analysis.dto';
import { OssService } from '../oss/oss.service';
import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { Readable } from 'stream';
import { verify } from 'jsonwebtoken';

type GenerateImageUrlResult = {
  imageUrl: string;
  textResponse: string;
  metadata?: Record<string, any>;
};

@ApiTags('ai')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);
  private readonly providerDefaultImageModels: Record<string, string> = {
    gemini: 'gemini-3-pro-image-preview',
    'gemini-pro': 'gemini-3-pro-image-preview',
    banana: 'gemini-3-pro-image-preview',
    'banana-2.5': 'gemini-2.5-flash-image-preview',
    'banana-3.1': 'gemini-3.1-flash-image-preview',
    runninghub: 'runninghub-su-effect',
    midjourney: 'midjourney-fast',
    nano2: 'gemini-3.1-flash-image-preview',
    seedream5: 'doubao-seedream-5-0-260128',
  };
  private readonly providerDefaultTextModels: Record<string, string> = {
    gemini: 'gemini-3-flash-preview',
    'gemini-pro': 'gemini-3-flash-preview',
    banana: 'gemini-3-flash-preview',
    'banana-2.5': 'gemini-3-flash-preview',
    'banana-3.1': 'gemini-3-flash-preview',
    runninghub: 'gemini-3-flash-preview',
    midjourney: 'gemini-3-flash-preview',
    nano2: 'gemini-3-flash-preview',
    seedream5: 'gemini-3-flash-preview',
  };

  private getHttpErrorMessage(status: number): string {
    const messages: Record<number, string> = {
      400: '请求参数错误，请检查输入内容',
      401: 'API密钥无效或已过期，请检查配置',
      403: '权限不足，无法访问该服务',
      404: '请求的资源不存在',
      408: '请求超时，请重试',
      413: '请求数据过大，请压缩图片或减小文件大小',
      429: '请求过于频繁，请稍后重试',
      500: '服务器内部错误，请稍后重试',
      502: '网关错误，服务暂时不可用',
      503: '服务暂时不可用，请稍后重试',
      504: '网关超时，请稍后重试',
      524: '服务器处理超时，请稍后重试或简化请求内容',
    };
    return messages[status] || `服务器返回错误 ${status}`;
  }

  constructor(
    private readonly ai: AiService,
    private readonly imageGeneration: ImageGenerationService,
    private readonly backgroundRemoval: BackgroundRemovalService,
    private readonly factory: AIProviderFactory,
    private readonly convert2Dto3DService: Convert2Dto3DService,
    private readonly expandImageService: ExpandImageService,
    private readonly usersService: UsersService,
    private readonly creditsService: CreditsService,
    private readonly sora2VideoService: Sora2VideoService,
    private readonly videoWatermarkService: VideoWatermarkService,
    private readonly veoVideoService: VeoVideoService,
    private readonly videoProviderService: VideoProviderService,
    private readonly oss: OssService,
    @Optional() private readonly imageTaskService?: ImageTaskService,
  ) {}

  private extractAccessToken(req: any): string | null {
    const cookieToken = req?.cookies?.access_token;
    if (typeof cookieToken === 'string' && cookieToken.trim()) {
      return cookieToken.trim();
    }

    const authHeader = req?.headers?.authorization ?? req?.headers?.Authorization;
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * 兼容无守卫场景：优先读取 req.user，其次尝试校验 access token 提取 userId。
   */
  private resolveRequestUserId(req: any): string | null {
    const fromUser = req?.user?.id || req?.user?.sub;
    if (typeof fromUser === 'string' && fromUser.length > 0) {
      return fromUser;
    }

    const token = this.extractAccessToken(req);
    if (!token) {
      return null;
    }

    const secret = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
    try {
      const payload = verify(token, secret) as { sub?: string; id?: string };
      const fromToken = payload?.sub || payload?.id;
      return typeof fromToken === 'string' && fromToken.length > 0 ? fromToken : null;
    } catch {
      return null;
    }
  }

  /**
   * 检查用户是否可以跳过水印（管理员或水印白名单用户）
   */
  private async canSkipWatermark(req: any): Promise<boolean> {
    const userId = this.resolveRequestUserId(req);
    if (!userId) {
      return false;
    }
    try {
      const user = await this.usersService.findById(userId);
      const isAdmin = typeof user?.role === 'string' && user.role.toLowerCase() === 'admin';
      return isAdmin || user?.noWatermark === true;
    } catch (e) {
      this.logger.warn('检查水印白名单失败', e);
      return false;
    }
  }

  /**
   * 对返回的 base64 图片统一加水印；管理员/白名单用户或失败时返回原图
   */
  private async watermarkIfNeeded(
    imageData?: string | null,
    req?: any
  ): Promise<string | undefined> {
    if (!imageData) return imageData ?? undefined;

    // 检查是否可以跳过水印（管理员或白名单用户）
    const skipWatermark = await this.canSkipWatermark(req);
    if (skipWatermark) {
      return imageData;
    }

    try {
      return await applyWatermarkToBase64(imageData, { text: 'Tanvas AI' });
    } catch (error) {
      this.logger.warn('Watermark failed, fallback to original image', error as any);
      return imageData;
    }
  }

  private extractBase64Payload(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (trimmed.startsWith('data:')) {
      const commaIndex = trimmed.indexOf(',');
      return commaIndex >= 0 ? trimmed.slice(commaIndex + 1).trim() : '';
    }

    const base64Index = trimmed.indexOf('base64,');
    if (base64Index >= 0) {
      return trimmed.slice(base64Index + 'base64,'.length).trim();
    }

    return trimmed;
  }

  private inferImageMimeFromBuffer(buffer: Buffer): { mimeType: string; extension: string } {
    if (buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
      return { mimeType: 'image/png', extension: 'png' };
    }

    if (buffer.length >= 3 && buffer.subarray(0, 3).toString('hex') === 'ffd8ff') {
      return { mimeType: 'image/jpeg', extension: 'jpg' };
    }

    if (buffer.length >= 6) {
      const header = buffer.subarray(0, 6).toString('ascii');
      if (header === 'GIF87a' || header === 'GIF89a') {
        return { mimeType: 'image/gif', extension: 'gif' };
      }
    }

    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { mimeType: 'image/webp', extension: 'webp' };
    }

    throw new BadGatewayException('生成图像数据不是受支持的图片格式，无法上传。');
  }

  private async uploadGeneratedImageToOss(
    imageBase64: string,
    options?: { userId?: string }
  ): Promise<{ url: string; key: string; mimeType: string; size: number }> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException(
        'OSS 未配置或已禁用，无法上传生成图片并返回远程 URL（请配置 OSS_* 环境变量，或设置 OSS_ENABLED=true）。'
      );
    }

    const payload = this.extractBase64Payload(imageBase64).replace(/\s+/g, '');
    if (!payload) {
      throw new BadGatewayException('生成图像数据为空，无法上传。');
    }

    const decodeCandidate = (encoding: BufferEncoding): Buffer => {
      try {
        return Buffer.from(payload, encoding);
      } catch {
        return Buffer.alloc(0);
      }
    };

    let buffer = decodeCandidate('base64');
    if (!buffer.length) {
      buffer = decodeCandidate('base64url');
    }

    if (!buffer.length) {
      throw new BadGatewayException('生成图像数据解码失败（空内容），无法上传。');
    }

    let mimeType: string;
    let extension: string;
    try {
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(buffer));
    } catch (error) {
      // base64/base64url 解码结果可能不同（尤其是 URL-safe 字符）
      const bufferAlt = decodeCandidate('base64url');
      if (!bufferAlt.length) {
        throw error;
      }
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(bufferAlt));
      buffer = bufferAlt;
    }
    const randomId = crypto.randomBytes(6).toString('hex');
    const timestamp = Date.now();
    const userTag = options?.userId
      ? crypto.createHash('sha1').update(String(options.userId)).digest('hex').slice(0, 8)
      : 'anonymous';
    const key = `uploads/ai/generated/${userTag}/${timestamp}-${randomId}.${extension}`;

    const stream = Readable.from(buffer);
    const { url } = await this.oss.putStream(key, stream, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

    return { url, key, mimeType, size: buffer.length };
  }

  /**
   * 从请求中获取用户的自定义 Google API Key
   * 如果用户设置了自定义 Key 且 mode 为 'custom'，则返回该 Key
   * 否则返回 null（使用系统默认 Key）
   */
  private async getUserCustomApiKey(req: any): Promise<string | null> {
    try {
      // 如果是 API Key 认证（外部调用），不使用用户自定义 Key
      if (req.apiClient) {
        return null;
      }

      // 获取 JWT 中的用户 ID
      const userId = req.user?.sub;
      if (!userId) {
        return null;
      }

      const { apiKey, mode } = await this.usersService.getGoogleApiKey(userId);

      // 只有当 mode 为 'custom' 且有 apiKey 时才使用
      if (mode === 'custom' && apiKey) {
        this.logger.debug(`Using custom Google API Key for user ${userId.slice(0, 8)}...`);
        return apiKey;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get user custom API key:', error);
      return null;
    }
  }

  /**
   * 判断是否是支持自定义 API Key 的 provider
   * gemini 和 gemini-pro 都支持使用用户自定义的 Google API Key
   */
  private isGeminiProvider(providerName: string | null): boolean {
    return !providerName || providerName === 'gemini' || providerName === 'gemini-pro';
  }

  /**
   * 获取用户ID（从JWT或API Key认证）
   * API Key 认证不扣积分
   */
  private getUserId(req: any): string | null {
    // API Key 认证不扣积分
    if (req.apiClient) {
      return null;
    }
    return req.user?.sub || req.user?.id || null;
  }

  /**
   * 确定图像生成服务类型
   */
  private getImageGenerationServiceType(model?: string, provider?: string): ServiceType {
    // 根据 provider 和 model 确定服务类型
    if (provider === 'midjourney') {
      return 'midjourney-imagine';
    }

    if (provider === 'seedream5' || model?.includes('seedream')) {
      return 'doubao-seedream-5-0-260128';
    }

    if (model?.includes('gemini-3.1')) {
      return 'gemini-3.1-image';
    }

    // Gemini 模型
    if (model?.includes('gemini-3') || model?.includes('imagen-3')) {
      return 'gemini-3-pro-image';
    }

    return 'gemini-2.5-image';
  }

  private normalizeChannelName(channel: string | null | undefined): string | null {
    if (!channel) return null;
    const value = channel.trim().toLowerCase();
    if (!value) return null;
    if (value.includes('apimart')) return 'apimart';
    if (value === 'legacy' || value.includes('147')) return '147';
    return value;
  }

  private asRecord(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, any>;
  }

  private extractExecutionChannel(result: unknown): string | null {
    const payload = this.asRecord(result);
    if (!payload) return null;

    const metadata = this.asRecord(payload.metadata);
    if (metadata && typeof metadata.provider === 'string') {
      return this.normalizeChannelName(metadata.provider);
    }

    if (typeof payload.provider === 'string') {
      return this.normalizeChannelName(payload.provider);
    }

    return null;
  }

  private buildCreditRequestParams(
    providerName: string | null,
    extraParams?: Record<string, any>,
  ): Record<string, any> {
    const aiProvider = providerName || 'gemini';
    const channelHint = aiProvider === 'nano2'
      ? 'apimart'
      : aiProvider.startsWith('banana')
      ? '147'
      : undefined;

    return {
      ...(extraParams || {}),
      aiProvider,
      channelHint,
    };
  }

  /**
   * 预扣积分并执行操作
   * @param skipCredits 如果为 true，则跳过积分扣除（例如使用自定义 API Key 时）
   */
  private async withCredits<T>(
    req: any,
    serviceType: ServiceType,
    model: string | undefined,
    operation: () => Promise<T>,
    inputImageCount?: number,
    outputImageCount?: number,
    skipCredits?: boolean,
    requestParams?: Record<string, any>,
  ): Promise<T> {
    const userId = this.getUserId(req);

    // 如果没有用户ID（API Key认证）或明确跳过积分，直接执行操作
    if (!userId) {
      this.logger.debug('API Key authentication - skipping credits deduction');
      return operation();
    }

    if (skipCredits) {
      await this.creditsService.assertFreeUserImageQuota(
        userId,
        serviceType,
        outputImageCount,
      );
      this.logger.debug('Using custom API key - skipping credits deduction');
      const result = await operation();
      await this.creditsService.verifyAndRewardInviterSafely(userId, { skipApiUsageCheck: true });
      return result;
    }

    // 确保用户有积分账户
    await this.creditsService.getOrCreateAccount(userId);

    const startTime = Date.now();
    let apiUsageId: string | null = null;
    const sanitizedRequestParams = requestParams
      ? Object.fromEntries(
          Object.entries(requestParams).filter(([_, value]) => value !== undefined),
        )
      : undefined;

    try {
      // 预扣积分
      const deductResult = await this.creditsService.preDeductCredits({
        userId,
        serviceType,
        model,
        inputImageCount,
        outputImageCount,
        requestParams: sanitizedRequestParams,
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
      });

      apiUsageId = deductResult.apiUsageId;
      this.logger.debug(`Credits pre-deducted: ${serviceType}, apiUsageId: ${apiUsageId}`);

      // 执行实际操作
      const result = await operation();
      const executionChannel = this.extractExecutionChannel(result);

      if (apiUsageId) {
        try {
          await this.creditsService.updateApiUsageRequestParams(apiUsageId, {
            channel: executionChannel,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to update apiUsage request params: ${this.summarizeError(error)}`,
          );
        }
      }

      // 更新状态为成功
      const processingTime = Date.now() - startTime;
      await this.creditsService.updateApiUsageStatus(
        apiUsageId,
        ApiResponseStatus.SUCCESS,
        undefined,
        processingTime,
      );

      return result;
    } catch (error) {
      // 更新状态为失败并退还积分
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (apiUsageId) {
        let failedMarked = false;
        try {
          await this.creditsService.updateApiUsageStatus(
            apiUsageId,
            ApiResponseStatus.FAILED,
            errorMessage,
            processingTime,
          );
          failedMarked = true;
        } catch (statusError) {
          this.logger.error(
            `Failed to update api usage status to failed, fallback to markApiUsageFailedForUser: ${this.summarizeError(statusError)}`,
          );
        }

        if (!failedMarked) {
          try {
            await this.creditsService.markApiUsageFailedForUser(
              userId,
              apiUsageId,
              errorMessage,
              processingTime,
            );
            failedMarked = true;
          } catch (markError) {
            this.logger.error(
              `Failed to mark api usage as failed for refund fallback: ${this.summarizeError(markError)}`,
            );
          }
        }

        if (failedMarked) {
          // 退还积分
          try {
            await this.creditsService.refundCredits(userId, apiUsageId);
            this.logger.debug(`Credits refunded for failed operation: ${apiUsageId}`);
          } catch (refundError) {
            this.logger.error('Failed to refund credits:', refundError);
          }
        } else {
          this.logger.error(
            `Skip refund because api usage cannot be marked failed. apiUsageId=${apiUsageId}`,
          );
        }
      }

      throw error;
    }
  }

  private resolveImageModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultImageModels[providerName] || 'gemini-3-pro-image-preview';
    }
    return this.providerDefaultImageModels.gemini;
  }

  private resolveGeminiVideoModel(requestedModel?: string): string {
    const trimmed = requestedModel?.trim();
    if (trimmed && /^gemini-/i.test(trimmed)) {
      return trimmed;
    }
    return 'gemini-3-flash-preview';
  }

  private summarizeError(error: any): string {
    const name = error?.name ? String(error.name) : 'Error';
    const message = error?.message ? String(error.message) : String(error);
    const code = error?.code ? ` code=${String(error.code)}` : '';

    const cause = error?.cause;
    if (!cause) {
      return `${name}: ${message}${code}`;
    }

    const causeName = cause?.name ? String(cause.name) : 'Cause';
    const causeMessage = cause?.message ? String(cause.message) : String(cause);
    const causeCode = cause?.code ? ` code=${String(cause.code)}` : '';
    return `${name}: ${message}${code} (cause: ${causeName}: ${causeMessage}${causeCode})`;
  }

  private isLikelyNetworkError(error: any): boolean {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('fetch failed')) return true;

    const candidate = error?.cause || error;
    const code = candidate?.code ? String(candidate.code) : '';
    const networkCodes = new Set([
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'EPIPE',
    ]);
    return networkCodes.has(code);
  }

  private async runCommand(
    command: string,
    args: string[],
    options: { timeoutMs?: number } = {}
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
      });
    });
  }

  private async extractFramesAsDataUrls(params: {
    videoPath: string;
    maxFrames: number;
    intervalSeconds: number;
  }): Promise<string[]> {
    const os = await import('os');
    const path = await import('path');
    const fsp = await import('fs/promises');

    const framesDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'video-frames-'));
    try {
      const outputPattern = path.join(framesDir, 'frame-%03d.jpg');
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        params.videoPath,
        '-vf',
        `fps=1/${Math.max(1, Math.floor(params.intervalSeconds))}`,
        '-frames:v',
        String(Math.max(1, Math.floor(params.maxFrames))),
        outputPattern,
      ];

      try {
        await this.runCommand('ffmpeg', args, { timeoutMs: 120_000 });
      } catch (err: any) {
        const code = err?.code ? String(err.code) : '';
        if (code === 'ENOENT' || String(err?.message || '').includes('spawn ffmpeg')) {
          throw new ServiceUnavailableException('ffmpeg not installed on the server');
        }
        throw err;
      }

      const files = (await fsp.readdir(framesDir))
        .filter((f) => f.toLowerCase().endsWith('.jpg'))
        .sort();

      const dataUrls: string[] = [];
      for (const file of files) {
        const buf = await fsp.readFile(path.join(framesDir, file));
        const base64 = buf.toString('base64');
        dataUrls.push(`data:image/jpeg;base64,${base64}`);
      }
      return dataUrls;
    } finally {
      try {
        await fsp.rm(framesDir, { recursive: true, force: true });
      } catch {}
    }
  }

  private async analyzeVideoVia147ChatCompletions(params: {
    model: string;
    prompt: string;
    videoUrl: string;
  }): Promise<string> {
    const apiKey =
      process.env.BANANA_API_KEY ||
      process.env.VEO_API_KEY ||
      process.env.SORA2_API_KEY ||
      null;
    if (!apiKey) {
      throw new ServiceUnavailableException('147 API key not configured (BANANA_API_KEY)');
    }

    const apiBaseUrl = (
      process.env.VEO_API_ENDPOINT ||
      process.env.VEO_API_BASE_URL ||
      process.env.SORA2_API_ENDPOINT ||
      'https://api1.147ai.com'
    ).replace(/\/+$/, '');

    // 视频分析需要较长时间，设置 5 分钟超时
    const VIDEO_ANALYSIS_TIMEOUT = 5 * 60 * 1000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VIDEO_ANALYSIS_TIMEOUT);

    try {
      const response = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          stream: false,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: params.prompt },
                { type: 'image_url', image_url: { url: params.videoUrl } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ServiceUnavailableException(
          `147 /v1/chat/completions error: HTTP ${response.status} ${text}`.trim()
        );
      }

      const data: any = await response.json().catch(() => ({}));
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim().length) return content.trim();
      if (Array.isArray(content)) {
        const joined = content
          .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
          .join('')
          .trim();
        if (joined.length) return joined;
      }

      throw new ServiceUnavailableException('147 returned empty content');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new ServiceUnavailableException(`Video analysis timeout (${VIDEO_ANALYSIS_TIMEOUT / 1000}s)`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseAndValidateAllowedUrl(urlValue: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(urlValue);
    } catch {
      throw new BadRequestException('Invalid videoUrl');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Unsupported videoUrl protocol');
    }

    const hostname = parsed.hostname;
    const allowedHosts = this.oss.allowedPublicHosts();
    this.logger.debug(`Validating URL host: ${hostname}, allowed: ${allowedHosts.join(', ')}`);
    const isAllowed =
      allowedHosts.includes(hostname) ||
      allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));

    if (!isAllowed) {
      this.logger.warn(`URL host not allowed: ${hostname}, allowedHosts: ${allowedHosts.join(', ')}`);
      throw new BadRequestException('videoUrl host not allowed');
    }

    return parsed;
  }

  private parseAndValidateAllowedImageUrl(urlValue: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(urlValue);
    } catch {
      throw new BadRequestException('Invalid imageUrl');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Unsupported imageUrl protocol');
    }

    const hostname = parsed.hostname;
    const allowedHosts = this.oss.allowedPublicHosts();
    const isAllowed =
      allowedHosts.includes(hostname) ||
      allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));

    if (!isAllowed) {
      this.logger.warn(`Image URL host not allowed: ${hostname}`);
      throw new BadRequestException('imageUrl host not allowed');
    }

    return parsed;
  }

  private validateImageDataUrl(dataUrl: string): void {
    const match = dataUrl.match(/^data:([^;,]+)/i);
    if (!match) {
      return; // 不是 data URL，可能是纯 base64，让后续处理
    }
    const mimeType = match[1].toLowerCase();
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
      throw new BadRequestException(
        `Invalid image format: expected image/*, got ${mimeType}`,
      );
    }
  }

  private async fetchImageAsDataUrl(imageUrl: string): Promise<string> {
    const parsed = this.parseAndValidateAllowedImageUrl(imageUrl);

    // 添加 60 秒超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(parsed.toString(), {
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new BadRequestException(
          `Failed to fetch imageUrl: HTTP ${response.status} ${text}`.trim(),
        );
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      if (!contentType.startsWith('image/')) {
        throw new BadRequestException('imageUrl is not an image');
      }

      const maxBytes = 30 * 1024 * 1024;
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength && contentLength > maxBytes) {
        throw new BadRequestException('imageUrl is too large');
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new BadRequestException('imageUrl is too large');
      }

      const base64 = buffer.toString('base64');
      return `data:${contentType};base64,${base64}`;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new BadRequestException('图片下载超时（60秒）');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private resolveTextModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested text model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultTextModels[providerName] || 'gemini-3-flash-preview';
    }
    return this.providerDefaultTextModels.gemini;
  }

  private hasVectorIntent(prompt: string): boolean {
    if (!prompt) return false;
    const lower = prompt.toLowerCase();
    const keywords = [
      '矢量',
      '矢量图',
      '矢量化',
      'vector',
      'vectorize',
      'vectorization',
      'svg',
      'paperjs',
      'paper.js',
      'svg path',
      '路径代码',
      'path code',
      'vector graphic',
      'vectorgraphics',
    ];
    return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
  }

  private sanitizeAvailableTools(tools?: string[], allowVector: boolean = true): string[] {
    const defaultTools = [
      'generateImage',
      'editImage',
      'blendImages',
      'analyzeImage',
      'chatResponse',
      'generateVideo',
      'generatePaperJS',
    ];

    const base = Array.isArray(tools) && tools.length ? tools : defaultTools;
    const unique = Array.from(new Set(base.filter(Boolean)));
    const filtered = allowVector ? unique : unique.filter((tool) => tool !== 'generatePaperJS');

    if (filtered.length > 0) {
      return filtered;
    }

    return allowVector ? defaultTools : defaultTools.filter((tool) => tool !== 'generatePaperJS');
  }

  private enforceSelectedTool(selectedTool: string, allowedTools: string[]): string {
    if (allowedTools.includes(selectedTool)) {
      return selectedTool;
    }

    const fallback = allowedTools.find((tool) => tool !== 'generatePaperJS') || allowedTools[0] || 'chatResponse';
    this.logger.warn(`Selected tool "${selectedTool}" is not allowed. Falling back to "${fallback}".`);
    return fallback;
  }

  @Post('tool-selection')
  async toolSelection(@Body() dto: ToolSelectionRequestDto, @Req() req: any) {
    const allowVector = this.hasVectorIntent(dto.prompt);
    const availableTools = this.sanitizeAvailableTools(dto.availableTools, allowVector);

    // 🔥 添加详细日志
    this.logger.log('🎯 Tool selection request:', {
      aiProvider: dto.aiProvider,
      model: dto.model,
      prompt: dto.prompt.substring(0, 50) + '...',
      hasImages: dto.hasImages,
      imageCount: dto.imageCount,
      availableTools,
      allowVectorIntent: allowVector,
    });

    const providerName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;

    return this.withCredits(req, 'gemini-tool-selection', dto.model, async () => {
      if (providerName) {
        try {
          // 🔥 先规范化模型
          const normalizedModel = this.resolveImageModel(providerName, dto.model);

          this.logger.log(`[${providerName.toUpperCase()}] Using provider for tool selection`, {
            originalModel: dto.model,
            normalizedModel,
          });

          const provider = this.factory.getProvider(normalizedModel, providerName);
          const result = await provider.selectTool({
            prompt: dto.prompt,
            availableTools,
            hasImages: dto.hasImages,
            imageCount: dto.imageCount,
            hasCachedImage: dto.hasCachedImage,
            context: dto.context,
            model: normalizedModel,
          });

          if (result.success && result.data) {
            const selectedTool = this.enforceSelectedTool(result.data.selectedTool, availableTools);
            this.logger.log(`✅ [${providerName.toUpperCase()}] Tool selected: ${selectedTool}`);
            return {
              selectedTool,
              parameters: { prompt: dto.prompt },
              reasoning: result.data.reasoning,
              confidence: result.data.confidence,
            };
          }

          const message = result.error?.message ?? 'provider returned an error response';
          this.logger.warn(`⚠️ [${providerName.toUpperCase()}] provider responded with error: ${message}`);
          throw new ServiceUnavailableException(
            `[${providerName}] tool selection failed: ${message}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`⚠️ [${providerName.toUpperCase()}] provider threw exception: ${message}`);
          throw new ServiceUnavailableException(
            `[${providerName}] tool selection failed: ${message}`
          );
        }
      }

      // 🔥 降级到Google Gemini进行工具选择
      this.logger.log('📊 Falling back to Gemini tool selection');
      const result = await this.ai.runToolSelectionPrompt(dto.prompt, availableTools);
      const selectedTool = this.enforceSelectedTool(result.selectedTool, availableTools);

      this.logger.log('✅ [GEMINI] Tool selected:', selectedTool);
      return {
        selectedTool,
        parameters: { prompt: dto.prompt },
        reasoning: result.reasoning,
        confidence: result.confidence,
      };
    }, undefined, undefined, undefined, this.buildCreditRequestParams(providerName));
  }

  @Post('generate-image')
  async generateImage(@Body() dto: GenerateImageDto, @Req() req: any): Promise<GenerateImageUrlResult> {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';

    const requestedProviderName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    // 联网开关开启时，Ultra(147) 自动切换到 Nano2(Apimart) 生图链路。
    const providerName =
      requestedProviderName === 'banana-3.1' && dto.enableWebSearch
        ? 'nano2'
        : requestedProviderName;
    if (requestedProviderName !== providerName) {
      this.logger.log(
        `[generate-image] provider rerouted by web search: ${requestedProviderName} -> ${providerName}`
      );
    }
    const model = this.resolveImageModel(providerName, dto.model);
    const serviceType = this.getImageGenerationServiceType(model, providerName || undefined);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    try {
      return await this.withCredits(req, serviceType, model, async () => {
        const maxAttempts = 3;
        const retryDelaysMs = [500, 1200];

        const shouldRetryOutputError = (error: unknown): boolean => {
          if (error instanceof HttpException) {
            return error.getStatus() === 502;
          }

          const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
          if (!message) return false;

          const retryablePatterns = [
            '生成图像数据为空',
            '无图像数据',
            'no image data',
            'stream api returned no image data',
            'not supported',
            '不是受支持的图片格式',
            'base64',
          ];
          return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            if (attempt > 1) {
              this.logger.warn(`[generate-image] 重试生成第 ${attempt}/${maxAttempts} 次`);
            }

            if (providerName && providerName !== 'gemini-pro') {
              const provider = this.factory.getProvider(dto.model, providerName);
              const result = await provider.generateImage({
                prompt: dto.prompt,
                model,
                imageOnly: dto.imageOnly,
                aspectRatio: dto.aspectRatio,
                imageSize: dto.imageSize,
                thinkingLevel: dto.thinkingLevel,
                outputFormat: dto.outputFormat,
                providerOptions: dto.providerOptions,
                enableWebSearch: dto.enableWebSearch,
                imageUrls: dto.imageUrls,
                googleSearch: dto.googleSearch ?? dto.enableWebSearch,
                googleImageSearch: dto.googleImageSearch ?? dto.enableWebSearch,
              });

              if (result.success && result.data) {
                const responseMetadata: Record<string, any> = {
                  ...(result.data.metadata || {}),
                  ...(dto.enableWebSearch ? { webSearchEnabled: true } : {}),
                };
                // Midjourney 已经上传到 OSS，直接使用返回的 URL
                const existingOssUrl = responseMetadata.imageUrl;
                if (existingOssUrl && existingOssUrl.includes('oss')) {
                  return {
                    imageUrl: existingOssUrl,
                    textResponse: result.data.textResponse || '',
                    metadata: responseMetadata,
                  };
                }

                // 如果有 imageData，上传到 OSS
                if (result.data.imageData) {
                  const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
                  const upload = await this.uploadGeneratedImageToOss(watermarked || '', { userId });
                  return {
                    imageUrl: upload.url,
                    textResponse: result.data.textResponse || '',
                    metadata: {
                      ...responseMetadata,
                      imageUrl: upload.url,
                      imageKey: upload.key,
                      mimeType: upload.mimeType,
                      bytes: upload.size,
                    },
                  };
                }

                // 如果只有外部 imageUrl（如 Nano2）
                if (result.data.imageUrl || result.data.metadata?.imageUrl) {
                  const imageUrl = result.data.imageUrl || result.data.metadata?.imageUrl;

                  // 白名单用户可跳过水印，保留外链直返
                  const skipWatermark = await this.canSkipWatermark(req);
                  if (skipWatermark) {
                    return {
                      imageUrl,
                      textResponse: result.data.textResponse || '',
                      metadata: responseMetadata,
                    };
                  }

                  try {
                    // 普通用户：下载外链图片 -> 加水印 -> 上传 OSS 后返回
                    const sourceImageDataUrl = await this.fetchImageAsDataUrl(imageUrl);
                    const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
                    const upload = await this.uploadGeneratedImageToOss(watermarked || '', { userId });
                    return {
                      imageUrl: upload.url,
                      textResponse: result.data.textResponse || '',
                      metadata: {
                        ...responseMetadata,
                        imageUrl: upload.url,
                        imageKey: upload.key,
                        mimeType: upload.mimeType,
                        bytes: upload.size,
                        sourceImageUrl: imageUrl,
                      },
                    };
                  } catch (error) {
                    this.logger.error(
                      `[generate-image] 外链图片加水印失败: ${this.summarizeError(error)}`
                    );
                    throw new BadGatewayException(
                      'Nano2 图片水印处理失败，请稍后重试（必要时请配置 ALLOWED_PROXY_HOSTS）'
                    );
                  }
                }
              }
              throw new Error(result.error?.message || 'Failed to generate image');
            }

            // gemini 和 gemini-pro 都使用默认的 Gemini 服务
            const data = await this.imageGeneration.generateImage({ ...dto, customApiKey });

            const watermarked = await this.watermarkIfNeeded(data.imageData, req);
            const upload = await this.uploadGeneratedImageToOss(watermarked || '', { userId });
            return {
              imageUrl: upload.url,
              textResponse: data.textResponse || '',
              metadata: {
                ...(data.metadata || {}),
                ...(dto.enableWebSearch ? { webSearchEnabled: true } : {}),
                imageUrl: upload.url,
                imageKey: upload.key,
                mimeType: upload.mimeType,
                bytes: upload.size,
              },
            };
          } catch (error) {
            if (attempt < maxAttempts && shouldRetryOutputError(error)) {
              const delay =
                retryDelaysMs[attempt - 1] ??
                retryDelaysMs[retryDelaysMs.length - 1] ??
                0;
              this.logger.warn(
                `[generate-image] 第 ${attempt}/${maxAttempts} 次失败（${this.summarizeError(error)}），${delay}ms 后重试`
              );
              if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
              continue;
            }
            throw error;
          }
        }

        throw new InternalServerErrorException('Image generation retry loop exhausted unexpectedly');
      }, 0, 1, skipCredits, this.buildCreditRequestParams(providerName, { imageSize: dto.imageSize }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[generate-image] 失败: ${errorMessage}`);
      throw error;
    }
  }

  @Post('edit-image')
  async editImage(@Body() dto: EditImageDto, @Req() req: any): Promise<ImageGenerationResult> {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    // 根据模型选择服务类型：Fast (2.5) / Nano banana 2 (3.1) / Pro
    const serviceType = model?.includes('2.5')
      ? 'gemini-2.5-image-edit'
      : model?.includes('3.1')
      ? 'gemini-3.1-image-edit'
      : 'gemini-image-edit';
    console.log(`\n========== [editImage] ==========`);
    console.log(`dto.model: ${dto.model}`);
    console.log(`resolved model: ${model}`);
    console.log(`serviceType: ${serviceType}`);
    console.log(`=================================\n`);

    return this.withCredits(req, serviceType as any, model, async () => {
      const fallbackUrl =
        !dto.sourceImageUrl && dto.sourceImage && /^https?:\/\//i.test(dto.sourceImage)
          ? dto.sourceImage
          : dto.sourceImageUrl;

      // MJ 支持直接使用 URL，不需要转换为 base64
      const isMidjourney = providerName === 'midjourney';

      let sourceImage: string | undefined;
      if (isMidjourney && fallbackUrl) {
        // MJ: 直接使用 URL
        sourceImage = fallbackUrl;
      } else if (dto.sourceImage && !fallbackUrl) {
        sourceImage = dto.sourceImage;
      } else if (fallbackUrl) {
        sourceImage = await this.fetchImageAsDataUrl(fallbackUrl);
      }

      if (!sourceImage) {
        throw new BadRequestException('sourceImage or sourceImageUrl is required');
      }

      // 非 MJ 时验证 sourceImage 是有效的图片格式
      if (!isMidjourney || !sourceImage.startsWith('http')) {
        this.validateImageDataUrl(sourceImage);
      }

      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);
        const result = await provider.editImage({
          prompt: dto.prompt,
          sourceImage,
          model,
          imageOnly: dto.imageOnly,
          aspectRatio: dto.aspectRatio,
          imageSize: dto.imageSize,
          thinkingLevel: dto.thinkingLevel,
          outputFormat: dto.outputFormat,
          providerOptions: dto.providerOptions,
        });
        if (result.success && result.data) {
          if (result.data.imageData) {
            const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
            return {
              imageData: watermarked,
              textResponse: result.data.textResponse || '',
              metadata: result.data.metadata,
            };
          }

          const providerImageUrl = result.data.imageUrl || result.data.metadata?.imageUrl;
          if (!providerImageUrl) {
            throw new BadGatewayException('编辑成功但未返回图片数据');
          }

          const sourceImageDataUrl = await this.fetchImageAsDataUrl(providerImageUrl);
          const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
          return {
            imageData: watermarked,
            textResponse: result.data.textResponse || '',
            metadata: {
              ...(result.data.metadata || {}),
              sourceImageUrl: providerImageUrl,
            },
          };
        }
        throw new Error(result.error?.message || 'Failed to edit image');
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      const data = await this.imageGeneration.editImage({ ...dto, sourceImage, customApiKey });
      const watermarked = await this.watermarkIfNeeded(data.imageData, req);
      return { ...data, imageData: watermarked };
    }, 1, 1, skipCredits, this.buildCreditRequestParams(providerName, { imageSize: dto.imageSize }));
  }

  @Post('blend-images')
  async blendImages(@Body() dto: BlendImagesDto, @Req() req: any): Promise<ImageGenerationResult> {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    // 根据模型选择服务类型：Fast (2.5) / Nano banana 2 (3.1) / Pro
    const serviceType = model?.includes('2.5')
      ? 'gemini-2.5-image-blend'
      : model?.includes('3.1')
      ? 'gemini-3.1-image-blend'
      : 'gemini-image-blend';

    return this.withCredits(req, serviceType as any, model, async () => {
      const sourceImages = dto.sourceImages?.length
        ? await Promise.all(
            dto.sourceImages.map(async (value) =>
              /^https?:\/\//i.test(value) ? this.fetchImageAsDataUrl(value) : value,
            ),
          )
        : dto.sourceImageUrls?.length
        ? await Promise.all(dto.sourceImageUrls.map((url) => this.fetchImageAsDataUrl(url)))
        : [];

      if (!sourceImages.length) {
        throw new BadRequestException('sourceImages or sourceImageUrls is required');
      }

      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);
        const result = await provider.blendImages({
          prompt: dto.prompt,
          sourceImages,
          model,
          imageOnly: dto.imageOnly,
          aspectRatio: dto.aspectRatio,
          imageSize: dto.imageSize,
          thinkingLevel: dto.thinkingLevel,
          outputFormat: dto.outputFormat,
          providerOptions: dto.providerOptions,
        });
        if (result.success && result.data) {
          if (result.data.imageData) {
            const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
            return {
              imageData: watermarked,
              textResponse: result.data.textResponse || '',
              metadata: result.data.metadata,
            };
          }

          const providerImageUrl = result.data.imageUrl || result.data.metadata?.imageUrl;
          if (!providerImageUrl) {
            throw new BadGatewayException('融合成功但未返回图片数据');
          }

          const sourceImageDataUrl = await this.fetchImageAsDataUrl(providerImageUrl);
          const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
          return {
            imageData: watermarked,
            textResponse: result.data.textResponse || '',
            metadata: {
              ...(result.data.metadata || {}),
              sourceImageUrl: providerImageUrl,
            },
          };
        }
        throw new Error(result.error?.message || 'Failed to blend images');
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      const data = await this.imageGeneration.blendImages({ ...dto, sourceImages, customApiKey });
      const watermarked = await this.watermarkIfNeeded(data.imageData, req);
      return { ...data, imageData: watermarked };
    }, dto.sourceImages?.length || 0, 1, skipCredits, this.buildCreditRequestParams(providerName, { imageSize: dto.imageSize }));
  }

  @Post('midjourney/action')
  async midjourneyAction(@Body() dto: MidjourneyActionDto, @Req() req: any): Promise<ImageGenerationResult> {
    return this.withCredits(req, 'midjourney-variation', 'midjourney-fast', async () => {
      const provider = this.factory.getProvider('midjourney-fast', 'midjourney');
      if (!(provider instanceof MidjourneyProvider)) {
        throw new ServiceUnavailableException('Midjourney provider is unavailable.');
      }

      const result = await provider.triggerAction({
        taskId: dto.taskId,
        customId: dto.customId,
        state: dto.state,
        notifyHook: dto.notifyHook,
        chooseSameChannel: dto.chooseSameChannel,
        accountFilter: dto.accountFilter,
      });

      if (result.success && result.data) {
        const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
        return {
          imageData: watermarked,
          textResponse: result.data.textResponse || '',
          metadata: result.data.metadata,
        };
      }

      throw new ServiceUnavailableException(
        result.error?.message || 'Failed to execute Midjourney action.'
      );
    }, 0, 1);
  }

  @Post('midjourney/modal')
  async midjourneyModal(@Body() dto: MidjourneyModalDto, @Req() req: any): Promise<ImageGenerationResult> {
    return this.withCredits(req, 'midjourney-variation', 'midjourney-fast', async () => {
      const provider = this.factory.getProvider('midjourney-fast', 'midjourney');
      if (!(provider instanceof MidjourneyProvider)) {
        throw new ServiceUnavailableException('Midjourney provider is unavailable.');
      }

      const result = await provider.executeModal({
        taskId: dto.taskId,
        prompt: dto.prompt,
        maskBase64: dto.maskBase64,
      });

      if (result.success && result.data) {
        const watermarked = await this.watermarkIfNeeded(result.data.imageData, req);
        return {
          imageData: watermarked,
          textResponse: result.data.textResponse || '',
          metadata: result.data.metadata,
        };
      }

      throw new ServiceUnavailableException(
        result.error?.message || 'Failed to execute Midjourney modal action.'
      );
    }, 0, 1);
  }

  @Post('analyze-image')
  async analyzeImage(@Body() dto: AnalyzeImageDto, @Req() req: any) {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    // 根据provider判断serviceType：Fast模式使用gemini-2.5-image-analyze
    const serviceType = providerName === 'banana-2.5' ? 'gemini-2.5-image-analyze' : 'gemini-image-analyze';

    return this.withCredits(req, serviceType as any, model, async () => {
      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);
        const result = await provider.analyzeImage({
          prompt: dto.prompt,
          sourceImage: dto.sourceImage,
          model,
          providerOptions: dto.providerOptions,
        });
        if (result.success && result.data) {
          return {
            text: result.data.text,
          };
        }
        throw new Error(result.error?.message || 'Failed to analyze image');
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      return this.imageGeneration.analyzeImage({ ...dto, customApiKey });
    }, 1, 0, skipCredits);
  }

  @Post('text-chat')
  async textChat(@Body() dto: TextChatDto, @Req() req: any) {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, 'gemini-text', model, async () => {
      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);
        const result = await provider.generateText({
          prompt: dto.prompt,
          model,
          enableWebSearch: dto.enableWebSearch,
          providerOptions: dto.providerOptions,
        });
        if (result.success && result.data) {
          return {
            text: result.data.text,
          };
        }
        throw new Error(result.error?.message || 'Failed to generate text');
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      return this.imageGeneration.generateTextResponse({ ...dto, customApiKey });
    }, undefined, undefined, skipCredits);
  }

  @Post('remove-background')
  async removeBackground(@Body() dto: RemoveBackgroundDto, @Req() req: any) {
    this.logger.log('🎯 Background removal request received');

    return this.withCredits(req, 'background-removal', undefined, async () => {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
        imageData = await this.backgroundRemoval.removeBackgroundFromBase64(
          dto.imageData,
          dto.mimeType
        );
      }

      this.logger.log('✅ Background removal succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    }, 1, 1);
  }

  // 开发模式：无需认证的抠图接口
  @Post('remove-background-public')
  async removeBackgroundPublic(@Body() dto: RemoveBackgroundDto) {
    this.logger.log('🎯 Background removal (public) request received');

    try {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
        // 默认为base64
        imageData = await this.backgroundRemoval.removeBackgroundFromBase64(
          dto.imageData,
          dto.mimeType
        );
      }

      this.logger.log('✅ Background removal (public) succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('❌ Background removal (public) failed:', message);
      throw new ServiceUnavailableException({
        success: false,
        error: message,
      });
    }
  }

  @Get('background-removal-info')
  async getBackgroundRemovalInfo() {
    this.logger.log('📊 Background removal info requested');
    const info = await this.backgroundRemoval.getInfo();
    return info;
  }

  @Post('convert-2d-to-3d')
  async convert2Dto3D(@Body() dto: Convert2Dto3DDto, @Req() req: any) {
    this.logger.log('🎨 2D to 3D conversion request received');

    return this.withCredits(req, 'convert-2d-to-3d', undefined, async () => {
      const result = await this.convert2Dto3DService.convert2Dto3D(dto.imageUrl);

      return {
        success: true,
        modelUrl: result.modelUrl,
        promptId: result.promptId,
      };
    }, 1, 1);
  }

  @Post('expand-image')
  async expandImage(@Body() dto: ExpandImageDto, @Req() req: any) {
    this.logger.log('🖼️ Expand image request received');

    return this.withCredits(req, 'expand-image', undefined, async () => {
      const result = await this.expandImageService.expandImage(
        dto.imageUrl,
        dto.expandRatios,
        dto.prompt || '扩图'
      );

      return {
        success: true,
        imageUrl: result.imageUrl,
        promptId: result.promptId,
      };
    }, 1, 1);
  }

  @Post('generate-video')
  async generateVideo(@Body() dto: GenerateVideoDto, @Req() req: any) {
    const quality = dto.quality === 'sd' ? 'sd' : 'hd';
    const serviceType: ServiceType = quality === 'sd' ? 'sora-sd' : 'sora-hd';
    const selectedSoraModel =
      dto.model === 'sora-2' || dto.model === 'sora-2-vip' || dto.model === 'sora-2-pro'
        ? dto.model
        : quality === 'hd'
        ? 'sora-2-pro'
        : 'sora-2';
    const normalizedArray =
      dto.referenceImageUrls?.filter((url) => typeof url === 'string' && url.trim().length > 0) ||
      [];
    const legacySingle = dto.referenceImageUrl?.trim();
    const referenceImageUrls = legacySingle ? [...normalizedArray, legacySingle] : normalizedArray;
    const inputImageCount = referenceImageUrls.length || undefined;

    this.logger.log(
      `🎬 Video generation request received (quality=${quality}, referenceCount=${referenceImageUrls.length})`,
    );

    return this.withCredits(
      req,
      serviceType,
      selectedSoraModel,
      async () => {
        const result = await this.sora2VideoService.generateVideo({
          prompt: dto.prompt,
          referenceImageUrls,
          quality,
          aspectRatio: dto.aspectRatio,
          duration: dto.duration,
          model: dto.model,
          watermark: dto.watermark,
          thumbnail: dto.thumbnail,
          privateMode: dto.privateMode,
          style: dto.style,
          storyboard: dto.storyboard,
          characterUrl: dto.characterUrl,
          characterTimestamps: dto.characterTimestamps,
          characterTaskId: dto.characterTaskId,
        });

        if (!result?.videoUrl) {
          throw new ServiceUnavailableException(
            result?.fallbackMessage || result?.content || '视频生成失败：未返回可用的视频链接',
          );
        }

        const skipWatermark = await this.canSkipWatermark(req);
        this.logger.log(`🎬 Video generated, skipWatermark=${skipWatermark}, videoUrl=${result.videoUrl?.substring(0, 80)}...`);

        if (skipWatermark) {
          this.logger.log('🎬 User can skip watermark (admin or whitelist)');
          let proxiedUrl = result.videoUrl;
          try {
            const uploaded = await this.videoWatermarkService.uploadOriginalToOSS(result.videoUrl);
            proxiedUrl = uploaded.url;
            this.logger.log(
              `✅ Video copied to OSS without watermark: ${proxiedUrl?.substring(0, 80)}...`,
            );
          } catch (error) {
            this.logger.warn('⚠️ Video OSS copy failed, fallback to raw URL', error as any);
          }
          return {
            ...result,
            videoUrl: proxiedUrl,
            videoUrlRaw: result.videoUrl,
            videoUrlWatermarked: proxiedUrl,
            watermarkSkipped: true,
          };
        }

        this.logger.log('🎬 User needs watermark, adding...');
        try {
          const wm = await this.videoWatermarkService.addWatermarkAndUpload(result.videoUrl, {
            text: 'Tanvas AI',
          });
          this.logger.log(`✅ Video watermark success: ${wm.url?.substring(0, 80)}...`);
          return {
            ...result,
            videoUrl: wm.url,
            videoUrlRaw: result.videoUrl,
            videoUrlWatermarked: wm.url,
            watermarkSkipped: false,
          };
        } catch (error) {
          this.logger.error('❌ Video watermark failed:', error);
          return {
            ...result,
            videoUrl: result.videoUrl,
            videoUrlRaw: result.videoUrl,
            videoUrlWatermarked: result.videoUrl,
            watermarkFailed: true,
          };
        }
      },
      inputImageCount,
      0,
      undefined,
      {
        quality,
        soraModel: selectedSoraModel,
        aspectRatio: dto.aspectRatio,
        duration: dto.duration,
      },
    );
  }

  @Post('sora2/character/create')
  async createSora2Character(@Body() dto: CreateSora2CharacterDto) {
    if (!dto.url && !dto.fromTask) {
      throw new BadRequestException('参数 url 和 fromTask 需二选一');
    }
    return this.sora2VideoService.createCharacterTask({
      model: dto.model,
      timestamps: dto.timestamps,
      url: dto.url,
      fromTask: dto.fromTask,
    });
  }

  @Get('sora2/character/:taskId')
  async querySora2Character(@Param('taskId') taskId: string) {
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException('taskId 不能为空');
    }
    return this.sora2VideoService.queryCharacterTask(taskId.trim());
  }

  /**
   * 视频生成（通用供应商：可灵、Vidu、Seedance 1.5 Pro）
   * 返回 taskId 和 apiUsageId，前端在任务失败时可请求退款
   */
  @Post('generate-video-provider')
  async generateVideoProvider(@Body() dto: VideoProviderRequestDto, @Req() req: any) {
    const serviceType: ServiceType = `${dto.provider}-video` as ServiceType;
    const userId = this.getUserId(req);
    const effectiveDto: VideoProviderRequestDto = { ...dto };

    // 白名单/管理员兜底：Seedance 1.5 Pro链路即使前端传入 watermark=true，也强制关闭水印。
    if (effectiveDto.provider === 'doubao') {
      const skipWatermark = await this.canSkipWatermark(req);
      if (skipWatermark) {
        effectiveDto.watermark = false;
      }
    }

    // 如果没有用户ID（API Key认证），直接执行操作
    if (!userId) {
      this.logger.debug('API Key authentication - skipping credits deduction');
      const result = await this.videoProviderService.generateVideo(effectiveDto);
      return { ...result, apiUsageId: null };
    }

    // 确保用户有积分账户
    await this.creditsService.getOrCreateAccount(userId);

    // 预扣积分
    const deductResult = await this.creditsService.preDeductCredits({
      userId,
      serviceType,
      model: effectiveDto.provider,
      inputImageCount: effectiveDto.referenceImages?.length || undefined,
      outputImageCount: 0,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    const apiUsageId = deductResult.apiUsageId;
    this.logger.debug(`Credits pre-deducted for video: ${serviceType}, apiUsageId: ${apiUsageId}`);

    try {
      const result = await this.videoProviderService.generateVideo(effectiveDto);
      const normalizedStatus = String(result?.status || '').toLowerCase();

      if (normalizedStatus === 'failed' || normalizedStatus === 'failure') {
        throw new ServiceUnavailableException((result as any)?.error || '视频任务创建失败');
      }

      if (!result?.taskId && !result?.videoUrl) {
        throw new ServiceUnavailableException('视频任务创建失败：未返回 taskId 或 videoUrl');
      }

      // 兼容“立即出片”供应商：直接标记成功；异步任务维持 pending，交由轮询结果决定是否退款
      if (result.videoUrl) {
        await this.creditsService.updateApiUsageStatus(
          apiUsageId,
          ApiResponseStatus.SUCCESS,
          undefined,
          0,
        );
      }

      // 返回 apiUsageId，前端在任务失败时可请求退款
      return { ...result, apiUsageId };
    } catch (error) {
      // 创建任务失败，立即退款
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.creditsService.updateApiUsageStatus(
        apiUsageId,
        ApiResponseStatus.FAILED,
        errorMessage,
        0,
      );
      try {
        await this.creditsService.refundCredits(userId, apiUsageId);
        this.logger.debug(`Credits refunded for failed video task creation: ${apiUsageId}`);
      } catch (refundError) {
        this.logger.error('Failed to refund credits:', refundError);
      }
      throw error;
    }
  }

  /**
   * 视频任务失败时退还积分
   */
  @Post('video-task-refund')
  async refundVideoTask(
    @Body() body: { apiUsageId: string },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req);
    if (!userId) {
      throw new BadRequestException('需要用户认证');
    }

    const { apiUsageId } = body;
    if (!apiUsageId) {
      throw new BadRequestException('缺少 apiUsageId 参数');
    }

    try {
      // 先校验归属并标记失败（仅允许当前用户操作自己的记录）
      await this.creditsService.markApiUsageFailedForUser(
        userId,
        apiUsageId,
        '视频生成任务失败',
        0,
      );

      // 退还积分
      const result = await this.creditsService.refundCredits(userId, apiUsageId);
      this.logger.log(`✅ 视频任务积分已处理退款: apiUsageId=${apiUsageId}, balance=${result.newBalance}`);
      return { success: true, newBalance: result.newBalance };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ 视频任务积分退还失败: ${message}`);
      throw error;
    }
  }

  /**
   * 查询视频生成任务状态
   */
  @Get('video-task/:provider/:taskId')
  async queryVideoTask(
    @Param('provider') provider: 'kling' | 'kling-2.6' | 'kling-o3' | 'vidu' | 'viduq3-pro' | 'doubao',
    @Param('taskId') taskId: string,
  ) {
    return this.videoProviderService.queryTask(provider, taskId);
  }

  /**
   * 生成 Paper.js 代码
   */
  @Post('generate-paperjs')
  async generatePaperJS(@Body() dto: PaperJSGenerateRequestDto, @Req() req: any): Promise<PaperJSGenerateResponseDto> {
    this.logger.log(`📐 Paper.js code generation request: ${dto.prompt.substring(0, 50)}...`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);

    // 检查是否使用自定义 API Key（gemini 和 gemini-pro 都支持）
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, 'gemini-paperjs', model, async () => {
      const startTime = Date.now();

      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);

        const result = await provider.generatePaperJS({
          prompt: dto.prompt,
          model,
          thinkingLevel: dto.thinkingLevel,
          canvasWidth: dto.canvasWidth,
          canvasHeight: dto.canvasHeight,
        });

        if (result.success && result.data) {
          const processingTime = Date.now() - startTime;
          this.logger.log(`✅ Paper.js code generated successfully in ${processingTime}ms`);

          return {
            code: result.data.code,
            explanation: result.data.explanation,
            model,
            provider: providerName,
            createdAt: new Date().toISOString(),
            metadata: {
              canvasSize: {
                width: dto.canvasWidth || 1920,
                height: dto.canvasHeight || 1080,
              },
              processingTime,
            },
          };
        }
        throw new Error(result.error?.message || 'Failed to generate Paper.js code');
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      const result = await this.imageGeneration.generatePaperJSCode({
        prompt: dto.prompt,
        model: dto.model,
        thinkingLevel: dto.thinkingLevel,
        canvasWidth: dto.canvasWidth,
        canvasHeight: dto.canvasHeight,
        customApiKey,
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Paper.js code generated successfully in ${processingTime}ms`);

      return {
        code: result.code,
        explanation: result.explanation,
        model: result.model,
        provider: dto.aiProvider || 'gemini',
        createdAt: new Date().toISOString(),
        metadata: {
          canvasSize: {
            width: dto.canvasWidth || 1920,
            height: dto.canvasHeight || 1080,
          },
          processingTime,
        },
      };
    }, undefined, undefined, skipCredits);
  }

  @Post('img2vector')
  async img2Vector(@Body() dto: Img2VectorRequestDto, @Req() req: any): Promise<Img2VectorResponseDto> {
    this.logger.log(`🖼️ Image to vector conversion request`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);
    const normalizedModel = model?.replace(/^banana-/, '') || model;

    // 检查是否使用自定义 API Key
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;
    let fallbackProvider: string | null = null;

    return this.withCredits(req, 'gemini-img2vector', model, async () => {
      const startTime = Date.now();

      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);

        if (typeof (provider as any).img2Vector === 'function') {
          try {
            const result = await (provider as any).img2Vector({
              sourceImage: dto.sourceImage,
              prompt: dto.prompt,
              model,
              thinkingLevel: dto.thinkingLevel,
              canvasWidth: dto.canvasWidth,
              canvasHeight: dto.canvasHeight,
              style: dto.style,
            });

            if (result.success && result.data) {
              const processingTime = Date.now() - startTime;
              this.logger.log(`✅ Image to vector conversion completed in ${processingTime}ms`);

              return {
                code: result.data.code,
                imageAnalysis: result.data.imageAnalysis,
                explanation: result.data.explanation,
                model,
                provider: providerName,
                createdAt: new Date().toISOString(),
                metadata: {
                  canvasSize: {
                    width: dto.canvasWidth || 1920,
                    height: dto.canvasHeight || 1080,
                  },
                  processingTime,
                  style: dto.style || 'detailed',
                },
              };
            }

            const message = result.error?.message || 'Failed to convert image to vector';
            this.logger.error(`[${providerName}] img2vector failed: ${message}`);
            throw new InternalServerErrorException(message);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[${providerName}] img2vector threw error: ${message}`, error as any);
            throw new InternalServerErrorException(message);
          }
        }

        // 提供商未实现 img2Vector，回退到默认 Gemini 流程
        this.logger.warn(`[${providerName}] img2Vector not implemented, falling back to Gemini service`);
        fallbackProvider = providerName;
      }

      // gemini 和 gemini-pro 都使用默认的 Gemini 服务
      const result = await this.imageGeneration.img2Vector({
        sourceImage: dto.sourceImage,
        prompt: dto.prompt,
        model: normalizedModel,
        thinkingLevel: dto.thinkingLevel,
        canvasWidth: dto.canvasWidth,
        canvasHeight: dto.canvasHeight,
        style: dto.style,
        customApiKey,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[gemini] img2vector failed: ${message}`, error as any);
        throw new InternalServerErrorException(message);
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Image to vector conversion completed in ${processingTime}ms`);

      return {
        code: result.code,
        imageAnalysis: result.imageAnalysis,
        explanation: result.explanation,
        model: result.model,
        provider: fallbackProvider ? 'gemini' : dto.aiProvider || 'gemini',
        createdAt: new Date().toISOString(),
        metadata: {
          canvasSize: {
            width: dto.canvasWidth || 1920,
            height: dto.canvasHeight || 1080,
          },
          processingTime,
          style: dto.style || 'detailed',
          ...(fallbackProvider ? { fallbackProvider } : {}),
        },
      };
    }, undefined, undefined, skipCredits);
  }

  /**
   * VEO 视频生成 - 获取可用模型列表
   */
  @Get('veo/models')
  async getVeoModels(): Promise<VeoModelsResponseDto[]> {
    this.logger.log('📋 VEO models list requested');
    return this.veoVideoService.getAvailableModels();
  }

  /**
   * VEO 视频生成
   * - veo3-fast: 文字快速生成视频
   * - veo3-pro: 文字生成高质量视频（不支持垫图）
   * - veo3-pro-frames: 图片+文字生成视频（支持垫图）
   */
  @Post('veo/generate')
  async generateVeoVideo(@Body() dto: VeoGenerateVideoDto, @Req() req: any): Promise<VeoVideoResponseDto> {
    this.logger.log(`🎬 VEO video generation request: model=${dto.model}, prompt=${dto.prompt.substring(0, 50)}...`);

    // 验证：veo3-pro-frames 需要图片，其他模式不需要
    if (dto.model === 'veo3-pro-frames' && !dto.referenceImageUrl) {
      throw new BadRequestException('veo3-pro-frames 模式需要提供 referenceImageUrl 参数');
    }

    if (dto.model !== 'veo3-pro-frames' && dto.referenceImageUrl) {
      this.logger.warn(`Model ${dto.model} does not support image input, ignoring referenceImageUrl`);
    }

    const result = await this.veoVideoService.generateVideo({
      prompt: dto.prompt,
      model: dto.model,
      referenceImageUrl: dto.model === 'veo3-pro-frames' ? dto.referenceImageUrl : undefined,
    });

    return result;
  }

  /**
   * DashScope Wan2.6-t2v proxy endpoint
   */
  @Post('dashscope/generate-wan26-t2v')
  async generateWan26T2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(req, 'wan26-video', 'wan2.6-t2v', async () => {
      const dashKey = process.env.DASHSCOPE_API_KEY;
      if (!dashKey) {
        this.logger.error('DASHSCOPE_API_KEY not configured');
        return { success: false, error: { message: 'DASHSCOPE_API_KEY not configured on server' } };
      }

      const dashUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(body),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { success: false, error: { code: `HTTP_${response.status}`, message: data?.message || this.getHttpErrorMessage(response.status), details: data } };
        }

        const extractVideoUrl = (obj: any) => obj?.output?.video_url || obj?.video_url || obj?.videoUrl || (Array.isArray(obj?.output) && obj.output[0]?.video_url) || undefined;
        const videoUrlDirect = extractVideoUrl(data);
        if (videoUrlDirect) return { success: true, data };

        const taskId = data?.taskId || data?.task_id || data?.id || data?.output?.task_id || data?.result?.task_id || data?.output?.[0]?.task_id || data?.data?.task_id || data?.data?.output?.task_id;
        if (!taskId) return { success: true, data };

        const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
        const intervalMs = 15000;
        const maxAttempts = 40;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, intervalMs));
          try {
            const statusResp = await fetch(statusUrl, { method: 'GET', headers: { Authorization: `Bearer ${dashKey}`, 'Content-Type': 'application/json' } });
            if (!statusResp.ok) continue;
            const statusData = await statusResp.json().catch(() => ({}));
            const statusValue = (statusData?.output?.task_status || statusData?.status || statusData?.state || statusData?.task_status || '').toString().toLowerCase();

            if (statusValue === 'succeeded' || statusValue === 'success') {
              const finalVideoUrl = extractVideoUrl(statusData) || extractVideoUrl(statusData?.result) || extractVideoUrl(statusData?.output) || undefined;
              return { success: true, data: { taskId, status: statusValue, videoUrl: finalVideoUrl, video_url: finalVideoUrl, output: { video_url: finalVideoUrl }, raw: statusData } };
            }
            if (statusValue === 'failed' || statusValue === 'error') {
              return { success: false, error: { message: 'DashScope task failed', details: statusData } };
            }
          } catch { continue; }
        }
        return { success: false, error: { message: 'DashScope task polling timed out' } };
      } catch (error: any) {
        this.logger.error('❌ DashScope request exception', error);
        return { success: false, error: { code: 'NETWORK_ERROR', message: error?.message || String(error) } };
      }
    });
  }

  /**
   * DashScope Wan2.6-i2v proxy endpoint
   */
  @Post('dashscope/generate-wan2-6-i2v')
  async generateWan26I2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(req, 'wan26-video', 'wan2.6-i2v', async () => {
      const dashKey = process.env.DASHSCOPE_API_KEY;
      if (!dashKey) {
        this.logger.error('DASHSCOPE_API_KEY not configured');
        return {
          success: false,
          error: { message: 'DASHSCOPE_API_KEY not configured on server' },
        };
      }

      const dashUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(body),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.logger.error('DashScope i2v create task failed', {
            status: response.status,
            body: data,
          });
          return {
            success: false,
            error: {
              code: `HTTP_${response.status}`,
              message: data?.message || this.getHttpErrorMessage(response.status),
              details: data,
            },
          };
        }

        this.logger.log('✅ DashScope i2v task created', {
          resultPreview: JSON.stringify(data).slice(0, 200),
        });

        const extractVideoUrl = (obj: any) =>
          obj?.output?.video_url ||
          obj?.video_url ||
          obj?.videoUrl ||
          (Array.isArray(obj?.output) && obj.output[0]?.video_url) ||
          undefined;
        const videoUrlDirect = extractVideoUrl(data);
        if (videoUrlDirect) return { success: true, data };

        const taskId =
          data?.taskId ||
          data?.task_id ||
          data?.id ||
          data?.output?.task_id ||
          data?.result?.task_id ||
          data?.output?.[0]?.task_id ||
          data?.data?.task_id ||
          data?.data?.output?.task_id;

        if (!taskId) {
          this.logger.warn('DashScope i2v create response contains no task id and no video url', {
            dataPreview: JSON.stringify(data).slice(0, 200),
          });
          return { success: true, data };
        }

        // 异步模式：立即返回 taskId，前端轮询查询状态
        this.logger.log(`✅ DashScope i2v task created: ${taskId}`);
        return {
          success: true,
          data: {
            taskId,
            task_id: taskId,
            status: 'pending',
            raw: data,
          },
        };
      } catch (error: any) {
        this.logger.error('❌ DashScope i2v request exception', error);
        return {
          success: false,
          error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
        };
      }
    });
  }

  /**
   * DashScope 任务状态查询接口（前端轮询用）
   */
  @Get('dashscope/task/:taskId')
  async getDashscopeTaskStatus(@Param('taskId') taskId: string) {
    const dashKey = process.env.DASHSCOPE_API_KEY;
    if (!dashKey) {
      return { success: false, error: { message: 'DASHSCOPE_API_KEY not configured' } };
    }

    const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
    try {
      const resp = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${dashKey}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return { success: false, error: { code: `HTTP_${resp.status}`, details: data } };
      }

      const statusValue = (
        data?.output?.task_status || data?.status || data?.state || ''
      ).toString().toLowerCase();

      const extractVideoUrl = (obj: any) =>
        obj?.output?.video_url || obj?.video_url || obj?.videoUrl ||
        (Array.isArray(obj?.output) && obj.output[0]?.video_url) || undefined;

      const videoUrl = extractVideoUrl(data) || extractVideoUrl(data?.output);

      return {
        success: true,
        data: { taskId, status: statusValue, videoUrl, video_url: videoUrl, raw: data },
      };
    } catch (err: any) {
      return { success: false, error: { message: err?.message || String(err) } };
    }
  }

  /**
   * DashScope Wan2.6-r2v proxy endpoint
   */
  @Post('dashscope/generate-wan2-6-r2v')
  async generateWan26R2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(req, 'wan26-r2v', 'wan2.6-r2v', async () => {
      const dashKey = process.env.DASHSCOPE_API_KEY;
      if (!dashKey) {
        this.logger.error('DASHSCOPE_API_KEY not configured');
        return {
          success: false,
          error: { message: 'DASHSCOPE_API_KEY not configured on server' },
        };
      }

      const dashUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(body),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.logger.error('DashScope r2v create task failed', {
            status: response.status,
            body: data,
          });
          return {
            success: false,
            error: {
              code: `HTTP_${response.status}`,
              message: data?.message || this.getHttpErrorMessage(response.status),
              details: data,
            },
          };
        }

        this.logger.log('✅ DashScope r2v task created', {
          resultPreview: JSON.stringify(data).slice(0, 200),
        });

        const extractVideoUrl = (obj: any) =>
          obj?.output?.video_url ||
          obj?.video_url ||
          obj?.videoUrl ||
          (Array.isArray(obj?.output) && obj.output[0]?.video_url) ||
          undefined;
        const videoUrlDirect = extractVideoUrl(data);
        if (videoUrlDirect) return { success: true, data };

        const taskId =
          data?.taskId ||
          data?.task_id ||
          data?.id ||
          data?.output?.task_id ||
          data?.result?.task_id ||
          data?.output?.[0]?.task_id ||
          data?.data?.task_id ||
          data?.data?.output?.task_id;
        if (!taskId) {
          this.logger.warn('DashScope r2v create response contains no task id and no video url', {
            dataPreview: JSON.stringify(data).slice(0, 200),
          });
          return { success: true, data };
        }

        const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
        const intervalMs = 15000;
        const maxAttempts = 40;
        this.logger.log(
          `🔁 Start polling DashScope r2v task ${taskId} (${maxAttempts} attempts, ${intervalMs}ms interval)`
        );
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, intervalMs));
          try {
            const statusResp = await fetch(statusUrl, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${dashKey}`,
                'Content-Type': 'application/json',
              },
            });
            if (!statusResp.ok) {
              const errBody = await statusResp.text().catch(() => '');
              this.logger.warn('DashScope r2v status check non-OK', {
                status: statusResp.status,
                body: errBody,
              });
              continue;
            }
            const statusData = await statusResp.json().catch(() => ({}));
            this.logger.debug(
              `🔎 DashScope r2v status response (attempt ${attempt + 1}): ${JSON.stringify(statusData).slice(0, 200)}`
            );
            const statusValue = (
              statusData?.output?.task_status ||
              statusData?.status ||
              statusData?.state ||
              statusData?.task_status ||
              ''
            )
              .toString()
              .toLowerCase();

            if (statusValue === 'succeeded' || statusValue === 'success') {
              const finalVideoUrl =
                extractVideoUrl(statusData) ||
                extractVideoUrl(statusData?.result) ||
                extractVideoUrl(statusData?.output) ||
                undefined;
              this.logger.log(
                `✅ DashScope r2v task ${taskId} succeeded, videoUrl: ${String(finalVideoUrl).slice(0, 120)}`
              );
              return {
                success: true,
                data: {
                  taskId,
                  status: statusValue,
                  videoUrl: finalVideoUrl,
                  video_url: finalVideoUrl,
                  output: { video_url: finalVideoUrl },
                  raw: statusData,
                },
              };
            }
            if (statusValue === 'failed' || statusValue === 'error') {
              const failureCode =
                statusData?.output?.code ||
                statusData?.code ||
                statusData?.output?.error_code ||
                statusData?.output?.error?.code;
              const failureMessage =
                statusData?.output?.message ||
                statusData?.message ||
                statusData?.output?.error?.message ||
                statusData?.output?.error_message ||
                statusData?.output?.error?.msg ||
                statusData?.output?.reason;
              const message =
                typeof failureMessage === 'string' && failureMessage.trim().length > 0
                  ? (failureCode ? `${String(failureCode)}: ${failureMessage}` : failureMessage)
                  : 'DashScope r2v task failed';

              this.logger.error(`❌ DashScope r2v task ${taskId} failed`, {
                message,
                raw: statusData,
              });
              return {
                success: false,
                error: { message, details: statusData },
              };
            }
          } catch (err: any) {
            this.logger.warn('DashScope r2v polling exception, will retry', err);
          }
        }
        this.logger.warn(
          `⏳ DashScope r2v task ${taskId} polling timed out after ${maxAttempts} attempts`
        );
        return {
          success: false,
          error: { message: 'DashScope r2v task polling timed out' },
        };
      } catch (error: any) {
        this.logger.error('❌ DashScope r2v request exception', error);
        return {
          success: false,
          error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
        };
      }
    });
  }

  /**
   * 视频分析 - 使用 Gemini File API 分析视频内容
   */
  @Post('analyze-video')
  async analyzeVideo(@Body() dto: AnalyzeVideoDto, @Req() req: any) {
    this.logger.log(`🎥 Video analysis request: ${dto.videoUrl?.substring(0, 50)}...`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveGeminiVideoModel(dto.model);

    return this.withCredits(req, 'gemini-video-analyze', model, async () => {
      const startTime = Date.now();
      const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB
      const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

      const parsedUrl = this.parseAndValidateAllowedUrl(dto.videoUrl);

      let tempFile: string | null = null;
      let uploadedFileName: string | null = null;
      let geminiClient: GoogleGenAI | null = null;
      let stage = 'download_video';

      try {
        // 147(Banana) 直接视频理解：优先走 /v1/chat/completions + image_url=videoUrl，不需要先下载视频
        // 若失败（不支持该 URL/格式/模型），再降级到抽帧方案（需要下载+ffmpeg）。
        if (providerName && providerName !== 'gemini-pro') {
          if (providerName === 'banana' || providerName === 'banana-2.5' || providerName === 'banana-3.1') {
            stage = 'direct_video_understanding';
            try {
              const analysisText = await this.analyzeVideoVia147ChatCompletions({
                model,
                prompt: dto.prompt || '分析这个视频的内容，描述视频中的场景、动作和关键信息',
                videoUrl: parsedUrl.toString(),
              });
              const processingTime = Date.now() - startTime;
              this.logger.log(
                `✅ Video analysis (147 direct) completed in ${processingTime}ms`
              );
              return {
                analysis: analysisText,
                text: analysisText,
                model,
                provider: providerName,
                processingTime,
              };
            } catch (err: any) {
              // 147 直接视频理解失败，不再降级到 ffmpeg 抽帧方案
              // 因为 ffmpeg 需要服务器安装，不适合云部署环境
              this.logger.error(
                `❌ 147 direct video understanding failed: ${this.summarizeError(err)}`
              );
              throw err;
            }
          }
        }

        // 从 OSS URL 下载视频（流式写入临时文件，避免大文件占用内存）
        stage = 'download_video';
        this.logger.log('📥 Downloading video from OSS...');
        const videoResponse = await fetch(parsedUrl.toString(), { redirect: 'follow' });
        if (!videoResponse.ok) {
          throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
        }
        // 防止跳转到非白名单域名
        this.parseAndValidateAllowedUrl(videoResponse.url);
        if (!videoResponse.body) {
          throw new Error('Empty video response body');
        }

        const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
        const contentLengthHeader = videoResponse.headers.get('content-length');
        if (contentLengthHeader) {
          const size = Number(contentLengthHeader);
          if (Number.isFinite(size) && size > MAX_VIDEO_BYTES) {
            throw new BadRequestException('Video file too large');
          }
        }

        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const { pipeline } = await import('stream/promises');
        const { Readable, Transform } = await import('stream');

        const ext = (() => {
          const map: Record<string, string> = {
            'video/mp4': '.mp4',
            'video/quicktime': '.mov',
            'video/x-msvideo': '.avi',
            'video/mpeg': '.mpeg',
            'video/3gpp': '.3gp',
            'video/x-flv': '.flv',
          };
          return map[contentType.split(';')[0].trim().toLowerCase()] || '.mp4';
        })();

        tempFile = path.join(os.tmpdir(), `video-${Date.now()}${ext}`);

        let received = 0;
        const limiter = new Transform({
          transform(chunk, _enc, cb) {
            received += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
            if (received > MAX_VIDEO_BYTES) {
              cb(new BadRequestException('Video file too large'));
              return;
            }
            cb(null, chunk);
          },
        });

        await pipeline(
          Readable.fromWeb(videoResponse.body as any),
          limiter,
          fs.createWriteStream(tempFile)
        );

        this.logger.log(`📦 Video downloaded: ${received} bytes, type: ${contentType}`);

        // 非 Google provider：抽帧 -> 走现有图片分析/文本总结链路（国内可用，如 banana/147）
        if (providerName && providerName !== 'gemini-pro') {
          stage = 'extract_frames';
          const provider = this.factory.getProvider(dto.model, providerName);
          const maxFrames = 8;
          const intervalSeconds = 3;
          this.logger.log(`🖼️ Extracting frames via ffmpeg (maxFrames=${maxFrames}, every ${intervalSeconds}s)...`);
          const frames = await this.extractFramesAsDataUrls({
            videoPath: tempFile,
            maxFrames,
            intervalSeconds,
          });
          if (!frames.length) {
            throw new ServiceUnavailableException('Failed to extract frames from video');
          }

          stage = 'analyze_frames';
          const visionModel = this.resolveImageModel(providerName, dto.model);
          const framePrompt =
            '请描述这一帧画面（场景、人物、动作、字幕/界面元素），尽量客观，不要编造。';
          const frameAnalyses: string[] = [];
          for (let i = 0; i < frames.length; i++) {
            const result = await provider.analyzeImage({
              prompt: framePrompt,
              sourceImage: frames[i],
              model: visionModel,
              providerOptions: dto.providerOptions,
            });
            if (!result.success || !result.data) {
              throw new ServiceUnavailableException(
                result.error?.message || 'Failed to analyze extracted frame'
              );
            }
            frameAnalyses.push(result.data.text);
          }

          stage = 'summarize';
          const userPrompt =
            dto.prompt || '分析这个视频的内容，描述视频中的场景、动作和关键信息';
          const summaryPrompt = [
            '你将获得从同一段视频抽帧得到的多帧描述，请根据这些信息总结整段视频。',
            `用户分析要求：${userPrompt}`,
            '抽帧描述：',
            ...frameAnalyses.map((t, idx) => `${idx + 1}. ${t}`),
            '请输出：1) 视频整体内容概述 2) 关键场景/动作 3) 可能的时间线(如可推断) 4) 关键信息/字幕(如有)。',
          ].join('\n');

          const textResult = await provider.generateText({
            prompt: summaryPrompt,
            model,
            providerOptions: dto.providerOptions,
          });
          if (!textResult.success || !textResult.data) {
            throw new ServiceUnavailableException(
              textResult.error?.message || 'Failed to summarize video frames'
            );
          }

          const analysisText = textResult.data.text || '';
          const processingTime = Date.now() - startTime;
          this.logger.log(`✅ Video analysis (frame-based) completed in ${processingTime}ms`);
          return {
            analysis: analysisText,
            text: analysisText,
            model,
            provider: providerName,
            processingTime,
            frameCount: frames.length,
          };
        }

        // Google Gemini 路径：上传到 File API 再分析（需要能直连 Google）
        const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('GOOGLE_GEMINI_API_KEY not configured');
        }
        geminiClient = new GoogleGenAI({ apiKey });

        // 使用 Gemini File API 上传视频
        stage = 'upload_to_gemini';
        this.logger.log('📤 Uploading video to Gemini File API...');
        const uploadResult = await geminiClient.files.upload({
          file: tempFile,
          config: { mimeType: contentType, displayName: `video-analysis-${Date.now()}` },
        });

        uploadedFileName = uploadResult.name || null;
        if (!uploadedFileName) {
          throw new Error('Gemini file upload returned empty file name');
        }
        this.logger.log(`✅ Video uploaded to Gemini: ${uploadedFileName}`);

        // 等待文件处理完成（带超时）
        stage = 'wait_processing';
        const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
        let file = uploadResult;
        while (file.state === 'PROCESSING') {
          if (Date.now() > deadline) {
            throw new ServiceUnavailableException('Video processing timed out');
          }
          this.logger.log('⏳ Waiting for video processing...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          file = await geminiClient.files.get({ name: uploadedFileName });
        }

        if (file.state === 'FAILED') {
          throw new Error('Video processing failed');
        }

        // 使用 Gemini 分析视频
        stage = 'generate_content';
        const prompt = dto.prompt || '分析这个视频的内容，描述视频中的场景、动作和关键信息';

        this.logger.log('🔍 Analyzing video with Gemini...');
        const result = await geminiClient.models.generateContent({
          model,
          contents: [
            { text: prompt },
            {
              fileData: {
                mimeType: file.mimeType,
                fileUri: file.uri,
              },
            },
          ],
        });

        const analysisText = result.text || '';
        const processingTime = Date.now() - startTime;

        this.logger.log(`✅ Video analysis completed in ${processingTime}ms`);

        return {
          analysis: analysisText,
          text: analysisText,
          model,
          provider: 'gemini',
          processingTime,
        };
      } catch (error: any) {
        const processingTime = Date.now() - startTime;
        const summary = this.summarizeError(error);
        this.logger.error(
          `❌ Video analysis failed at ${stage} after ${processingTime}ms: ${summary}`,
          error?.stack || summary
        );
        if (error instanceof HttpException) {
          throw error;
        }
        if (this.isLikelyNetworkError(error)) {
          throw new ServiceUnavailableException(`Video analysis failed at ${stage}: ${summary}`);
        }
        throw new InternalServerErrorException(`Video analysis failed at ${stage}: ${summary}`);
      } finally {
        try {
          if (tempFile) {
            const fsp = await import('fs/promises');
            await fsp.unlink(tempFile);
          }
        } catch {}

        try {
          if (uploadedFileName) {
            await geminiClient?.files.delete({ name: uploadedFileName });
          }
        } catch {}
      }
    }, 1, 0);
  }

  /**
   * 异步图像生成 - 创建任务
   */
  @Post('generate-image-async')
  async generateImageAsync(@Body() dto: GenerateImageDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('图像任务服务未启用');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 创建任务
    const task = await this.imageTaskService.createTask(
      userId,
      'generate',
      dto.prompt,
      { ...dto, model },
      providerName || 'gemini',
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 异步图像编辑 - 创建任务
   */
  @Post('edit-image-async')
  async editImageAsync(@Body() dto: EditImageDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('图像任务服务未启用');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 如果提供了 URL，先下载图片
    let sourceImage = dto.sourceImage;
    if (dto.sourceImageUrl && !sourceImage) {
      sourceImage = await this.fetchImageAsDataUrl(dto.sourceImageUrl);
    }

    const task = await this.imageTaskService.createTask(
      userId,
      'edit',
      dto.prompt,
      { ...dto, sourceImage, model },
      providerName || 'gemini',
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 异步图像混合 - 创建任务
   */
  @Post('blend-images-async')
  async blendImagesAsync(@Body() dto: BlendImagesDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('图像任务服务未启用');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 如果提供了 URL，先下载图片
    let sourceImages = dto.sourceImages || [];
    if (dto.sourceImageUrls && dto.sourceImageUrls.length > 0 && sourceImages.length === 0) {
      sourceImages = await Promise.all(
        dto.sourceImageUrls.map((url) => this.fetchImageAsDataUrl(url))
      );
    }

    const task = await this.imageTaskService.createTask(
      userId,
      'blend',
      dto.prompt,
      { ...dto, sourceImages, model },
      providerName || 'gemini',
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 查询图像任务状态
   */
  @Get('image-task/:taskId')
  async getImageTaskStatus(@Param('taskId') taskId: string, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('图像任务服务未启用');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const task = await this.imageTaskService.getTaskStatus(taskId, userId);

    return {
      status: task.status,
      imageUrl: task.imageUrl,
      thumbnailUrl: task.thumbnailUrl,
      textResponse: task.textResponse,
      error: task.error,
      progress: task.status === 'processing' ? 50 : task.status === 'succeeded' ? 100 : 0,
    };
  }
}
