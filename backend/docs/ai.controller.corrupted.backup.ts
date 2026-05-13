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
  ForbiddenException,
  Param,
  Query,
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
import { MinimaxSpeechDto } from './dto/minimax-speech.dto';
import { MinimaxMusicDto } from './dto/minimax-music.dto';
import { TencentSpeechDto } from './dto/tencent-speech.dto';
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
import { ModelRoutingService } from './services/model-routing.service';
import { MinimaxSpeechService } from './services/minimax-speech.service';
import { MinimaxMusicService } from './services/minimax-music.service';
import { TencentSpeechService } from './services/tencent-speech.service';
import { PrismaService } from '../prisma/prisma.service';
import { applyWatermarkToBase64 } from './services/watermark.util';
import { VideoWatermarkService } from './services/video-watermark.service';
import {
  createAsyncTask,
  updateAsyncTask,
  getAsyncTaskResult,
} from './services/async-video-task.store';
import { VideoProviderRequestDto } from './dto/video-provider.dto';
import { AnalyzeVideoDto } from './dto/video-analysis.dto';
import { VolcEnhanceVideoDto } from './dto/volc-enhance-video.dto';
import { OssService } from '../oss/oss.service';
import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { Readable } from 'stream';
import { verify } from 'jsonwebtoken';
import { OpenObserveTelemetryService } from '../telemetry/openobserve-telemetry.service';
import { captureTraceContext, runWithSpan, type PersistedTraceContext } from '../telemetry/tracing';

type GenerateImageUrlResult = {
  imageUrl: string;
  textResponse: string;
  metadata?: Record<string, any>;
};

type TraceableReq = {
  id?: string;
  traceId?: string;
  headers?: Record<string, unknown>;
};

const MANAGED_IMAGE_KEY_REGEX = /^(projects|uploads|templates|videos|ai)\//i;
const FREE_TIER_BENEFITS_SETTING_KEY = 'membership_free_tier_benefits';
const PRIVILEGED_ADMIN_ROLES = new Set(['admin', 'normal_admin']);
const BANANA_ROUTE_SUCCESS_RATE_SERVICE_TYPES = [
  'gemini-2.5-image',
  'gemini-3-pro-image',
  'gemini-3.1-image',
  'gpt-image-2',
  'gemini-2.5-image-edit',
  'gemini-image-edit',
  'gemini-3.1-image-edit',
  'gemini-2.5-image-blend',
  'gemini-image-blend',
  'gemini-3.1-image-blend',
  'gemini-2.5-image-analyze',
  'gemini-image-analyze',
  'gemini-3.1-image-analyze',
  'gemini-video-analyze',
  'gemini-text',
  'gemini-prompt-optimize',
] as const;

type BananaRouteKey = 'normal' | 'stable';

type BananaRouteSuccessRateStats = {
  route: BananaRouteKey;
  totalCalls: number;
  completedCalls: number;
  successfulCalls: number;
  failedCalls: number;
  pendingCalls: number;
  successRate: number | null;
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
    gemini: 'gemini-3.1-pro',
    'gemini-pro': 'gemini-3.1-pro',
    banana: 'gemini-3-flash-preview',
    'banana-2.5': 'gemini-2.5-flash',
    'banana-3.1': 'gemini-3.1-pro-preview',
    runninghub: 'gemini-3.1-pro',
    midjourney: 'gemini-3.1-pro',
    nano2: 'gemini-3.1-pro-preview',
    seedream5: 'gemini-3.1-pro',
  };
  private readonly providerDefaultAnalyzeModels: Record<string, string> = {
    gemini: 'gemini-3.1-pro',
    'gemini-pro': 'gemini-3.1-pro',
    banana: 'gemini-3-pro-image-preview',
    'banana-2.5': 'gemini-2.5-flash-image-preview',
    'banana-3.1': 'gemini-3.1-flash-image-preview',
    runninghub: 'gemini-3.1-pro',
    midjourney: 'gemini-3.1-pro',
    nano2: 'gemini-3.1-flash-image-preview',
    seedream5: 'gemini-3.1-pro',
  };

  private getHttpErrorMessage(status: number): string {
    const messages: Record<number, string> = {
      400: '璇锋眰鍙傛暟閿欒锛岃妫€鏌ヨ緭鍏ュ唴瀹?',
      401: 'API瀵嗛挜鏃犳晥鎴栧凡杩囨湡锛岃妫€鏌ラ厤缃?',
      403: '鏉冮檺涓嶈冻锛屾棤娉曡闂鏈嶅姟',
      404: '璇锋眰鐨勮祫婧愪笉瀛樺湪',
      408: '璇锋眰瓒呮椂锛岃閲嶈瘯',
      413: '璇锋眰鏁版嵁杩囧ぇ锛岃鍘嬬缉鍥剧墖鎴栧噺灏忔枃浠跺ぇ灏?',
      429: '璇锋眰杩囦簬棰戠箒锛岃绋嶅悗閲嶈瘯',
      464: '涓婃父浠诲姟澶辫触锛岃绋嶅悗閲嶈瘯',
      500: '鏈嶅姟鍣ㄥ唴閮ㄩ敊璇紝璇风◢鍚庨噸璇?',
      502: '缃戝叧閿欒锛屾湇鍔℃殏鏃朵笉鍙敤',
      503: '鏈嶅姟鏆傛椂涓嶅彲鐢紝璇风◢鍚庨噸璇?',
      504: '缃戝叧瓒呮椂锛岃绋嶅悗閲嶈瘯',
      524: '鏈嶅姟鍣ㄥ鐞嗚秴鏃讹紝璇风◢鍚庨噸璇曟垨绠€鍖栬姹傚唴瀹?',
    };
    return messages[status] || `鏈嶅姟鍣ㄨ繑鍥為敊璇?${status}`;
  }

  private normalizeSeedance2Access(value: unknown): 'enabled' | 'disabled' {
    return this.normalizePlanFeatureAccess(value);
  }

  private normalizePlanFeatureAccess(value: unknown): 'enabled' | 'disabled' {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (
      normalized === 'enabled' ||
      normalized === 'allow' ||
      normalized === 'on' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'vip' ||
      normalized === 'supported' ||
      normalized === 'support' ||
      normalized === '鏀寔' ||
      normalized === '鍙敤' ||
      normalized === '1'
    ) {
      return 'enabled';
    }
    if (typeof value === 'boolean') {
      return value ? 'enabled' : 'disabled';
    }
    if (typeof value === 'number') {
      return value > 0 ? 'enabled' : 'disabled';
    }
    return 'disabled';
  }

  private normalizeNoWatermarkAccess(value: unknown): 'enabled' | 'disabled' {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (
      normalized === 'enabled' ||
      normalized === 'allow' ||
      normalized === 'on' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'vip' ||
      normalized === 'supported' ||
      normalized === 'support' ||
      normalized === '鏀寔' ||
      normalized === '鍙敤' ||
      normalized === '1'
    ) {
      return 'enabled';
    }

    if (typeof value === 'boolean') {
      return value ? 'enabled' : 'disabled';
    }
    if (typeof value === 'number') {
      return value > 0 ? 'enabled' : 'disabled';
    }
    return 'disabled';
  }

  private async resolveUserNoWatermarkAccess(userId: string): Promise<'enabled' | 'disabled'> {
    const now = new Date();
    const subscription = await this.prisma.userMembershipSubscription.findFirst({
      where: {
        userId,
        status: 'active',
        currentPeriodStartAt: { lte: now },
        currentPeriodEndAt: { gt: now },
      },
      select: {
        membershipPlanId: true,
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!subscription?.membershipPlanId) {
      return 'disabled';
    }

    const plan = await this.prisma.membershipPlan.findUnique({
      where: { id: subscription.membershipPlanId },
      select: { metadata: true },
    });

    if (plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)) {
      const metadata = plan.metadata as Record<string, unknown>;
      const explicitNoWatermark =
        metadata.noWatermarkAccess ??
        metadata.removeWatermarkAccess ??
        metadata.watermarkFree ??
        metadata.noWatermark;

      // No default VIP bypass: must be explicitly enabled on the membership plan.
      if (
        explicitNoWatermark === undefined ||
        explicitNoWatermark === null ||
        explicitNoWatermark === ''
      ) {
        return 'disabled';
      }
      return this.normalizeNoWatermarkAccess(explicitNoWatermark);
    }

    // Plan metadata absent: default to disabled.
    return 'disabled';
  }

  private async resolveUserSeedance2Access(userId: string): Promise<'enabled' | 'disabled'> {
    const subscription = await this.prisma.userMembershipSubscription.findFirst({
      where: {
        userId,
        status: 'active',
        currentPeriodStartAt: { lte: new Date() },
        currentPeriodEndAt: { gt: new Date() },
      },
      select: {
        membershipPlanId: true,
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (subscription?.membershipPlanId) {
      const plan = await this.prisma.membershipPlan.findUnique({
        where: { id: subscription.membershipPlanId },
        select: { metadata: true },
      });
      if (plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)) {
        return this.normalizeSeedance2Access(
          (plan.metadata as Record<string, unknown>).seedance2Access,
        );
      }
      return 'disabled';
    }

    const freeTierSetting = await this.prisma.systemSetting.findUnique({
      where: { key: FREE_TIER_BENEFITS_SETTING_KEY },
      select: { value: true },
    });
    if (!freeTierSetting?.value) {
      return 'disabled';
    }

    try {
      const parsed = JSON.parse(freeTierSetting.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return this.normalizeSeedance2Access(
          (parsed as Record<string, unknown>).seedance2Access,
        );
      }
    } catch {
      return 'disabled';
    }

    return 'disabled';
  }

  private async resolveUserHappyhorseAccess(userId: string): Promise<'enabled' | 'disabled'> {
    const paidOrder = await this.prisma.paymentOrder.findFirst({
      where: {
        userId,
        status: 'paid',
        paidAt: { not: null },
      },
      select: { id: true },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (paidOrder) {
      return 'enabled';
    }

    const subscription = await this.prisma.userMembershipSubscription.findFirst({
      where: {
        userId,
        status: 'active',
        currentPeriodStartAt: { lte: new Date() },
        currentPeriodEndAt: { gt: new Date() },
      },
      select: {
        membershipPlanId: true,
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!subscription?.membershipPlanId) {
      return 'disabled';
    }

    const plan = await this.prisma.membershipPlan.findUnique({
      where: { id: subscription.membershipPlanId },
      select: { metadata: true },
    });

    if (plan?.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)) {
      const metadata = plan.metadata as Record<string, unknown>;
      return this.normalizePlanFeatureAccess(
        metadata.happyhorseAccess ?? metadata.happyhorseVideoAccess,
      );
    }

    return 'disabled';
  }

  private async assertHappyhorseEntitlement(userId: string | null): Promise<void> {
    if (!userId) {
      throw new ForbiddenException('蹇箰椹粎鏀寔宸插厖鍊兼垨宸插紑閫氬搴斿椁愭潈鐩婄殑浠樿垂鐢ㄦ埛浣跨敤');
    }

    const access = await this.resolveUserHappyhorseAccess(userId);
    if (access !== 'enabled') {
      throw new ForbiddenException('蹇箰椹粎鏀寔宸插厖鍊兼垨宸插紑閫氬搴斿椁愭潈鐩婄殑浠樿垂鐢ㄦ埛浣跨敤');
    }
  }

  private async assertSeedance2Entitlement(
    userId: string | null,
    dto: VideoProviderRequestDto,
    req: any,
  ): Promise<void> {
    const normalizedProvider = String(dto.provider || '').trim().toLowerCase();
    const normalizedSeedanceModel = String(dto.seedanceModel || '').trim().toLowerCase();
    const isSeedance2Request =
      normalizedProvider === 'doubao' &&
      (normalizedSeedanceModel === 'seedance-2.0' ||
        normalizedSeedanceModel === '2.0' ||
        normalizedSeedanceModel === 'seed-2.0-pro' ||
        normalizedSeedanceModel === 'seedance-2.0-pro' ||
        normalizedSeedanceModel === 'seed-2-0-pro' ||
        normalizedSeedanceModel === '2.0-pro' ||
        normalizedSeedanceModel === 'seed-2.0-lite' ||
        normalizedSeedanceModel === 'seedance-2.0-lite' ||
        normalizedSeedanceModel === 'seed-2-0-lite' ||
        normalizedSeedanceModel === '2.0-lite' ||
        normalizedSeedanceModel === 'seed-2.0-mini' ||
        normalizedSeedanceModel === 'seedance-2.0-mini' ||
        normalizedSeedanceModel === 'seed-2-0-mini' ||
        normalizedSeedanceModel === '2.0-mini' ||
        normalizedSeedanceModel === 'seedance-2.0-fast' ||
        normalizedSeedanceModel === '2.0-fast');

    if (!isSeedance2Request || !userId) {
      return;
    }

    const access = await this.resolveSeedance2CombinedAccess(userId, req);
    if (!access.allowed) {
      throw new BadRequestException(
        'Seedance 2.0 / Seed 2.0 series requires VIP access or watermark whitelist access',
      );
    }
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
    private readonly modelRoutingService: ModelRoutingService,
    private readonly minimaxSpeechService: MinimaxSpeechService,
    private readonly tencentSpeechService: TencentSpeechService,
    private readonly minimaxMusicService: MinimaxMusicService,
    private readonly prisma: PrismaService,
    private readonly oss: OssService,
    private readonly telemetryService: OpenObserveTelemetryService,
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
   * 鍏煎鏃犲畧鍗満鏅細浼樺厛璇诲彇 req.user锛屽叾娆″皾璇曟牎楠?access token 鎻愬彇 userId銆?   */
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

  private normalizeRole(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  private isPrivilegedAdminRole(role: unknown): boolean {
    const normalized = this.normalizeRole(role);
    return normalized.length > 0 && PRIVILEGED_ADMIN_ROLES.has(normalized);
  }

  private isSeedance20Model(seedanceModel: unknown): boolean {
    const normalized = typeof seedanceModel === 'string' ? seedanceModel.trim().toLowerCase() : '';
    return (
      normalized === 'seedance-2.0' ||
      normalized === '2.0' ||
      normalized === 'seed-2.0-pro' ||
      normalized === 'seedance-2.0-pro' ||
      normalized === 'seed-2-0-pro' ||
      normalized === '2.0-pro' ||
      normalized === 'seed-2.0-lite' ||
      normalized === 'seedance-2.0-lite' ||
      normalized === 'seed-2-0-lite' ||
      normalized === '2.0-lite' ||
      normalized === 'seed-2.0-mini' ||
      normalized === 'seedance-2.0-mini' ||
      normalized === 'seed-2-0-mini' ||
      normalized === '2.0-mini' ||
      normalized === 'seedance-2.0-fast' ||
      normalized === '2.0-fast'
    );
  }

  private async resolveSeedance2CombinedAccess(
    userId: string,
    req: any,
  ): Promise<{
    allowed: boolean;
    byVip: boolean;
    byWhitelist: boolean;
    byAdmin: boolean;
  }> {
    let byAdmin = this.isPrivilegedAdminRole(req?.user?.role);
    let byWhitelist = false;

    try {
      const user = await this.usersService.findById(userId);
      byAdmin = byAdmin || this.isPrivilegedAdminRole(user?.role);
      byWhitelist = byAdmin || user?.noWatermark === true;
    } catch (e) {
      this.logger.warn('Failed to resolve watermark whitelist for Seedance 2.0 access check', e);
      byWhitelist = await this.canSkipWatermark(req);
    }

    const byVip = (await this.resolveUserSeedance2Access(userId)) === 'enabled';

    return {
      allowed: byVip || byWhitelist,
      byVip,
      byWhitelist,
      byAdmin,
    };
  }

  private async canSkipWatermark(req: any): Promise<boolean> {
    const userId = this.resolveRequestUserId(req);
    if (!userId) {
      return false;
    }
    try {
      const user = await this.usersService.findById(userId);
      if (this.isPrivilegedAdminRole(user?.role) || user?.noWatermark === true) {
        return true;
      }
      return (await this.resolveUserNoWatermarkAccess(userId)) === 'enabled';
    } catch (e) {
      this.logger.warn('妫€鏌ユ按鍗扮櫧鍚嶅崟澶辫触', e);
      return false;
    }
  }

  /**
   * 瀵硅繑鍥炵殑 base64 鍥剧墖缁熶竴鍔犳按鍗帮紱绠＄悊鍛?鐧藉悕鍗曠敤鎴锋垨澶辫触鏃惰繑鍥炲師鍥?   */
  private async watermarkIfNeeded(
    imageData?: string | null,
    req?: any
  ): Promise<string | undefined> {
    if (!imageData) return imageData ?? undefined;

    // 妫€鏌ユ槸鍚﹀彲浠ヨ烦杩囨按鍗帮紙绠＄悊鍛樻垨鐧藉悕鍗曠敤鎴凤級
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

    throw new BadGatewayException('鐢熸垚鍥惧儚鏁版嵁涓嶆槸鍙楁敮鎸佺殑鍥剧墖鏍煎紡锛屾棤娉曚笂浼犮€?');
  }

  private async uploadGeneratedImageToOss(
    imageBase64: string,
    options?: { userId?: string }
  ): Promise<{ url: string; key: string; mimeType: string; size: number }> {
    if (!this.oss.isEnabled()) {
      throw new ServiceUnavailableException(
        'OSS 鏈厤缃垨宸茬鐢紝鏃犳硶涓婁紶鐢熸垚鍥剧墖骞惰繑鍥炶繙绋?URL锛堣閰嶇疆 OSS_* 鐜鍙橀噺锛屾垨璁剧疆 OSS_ENABLED=true锛夈€?'
      );
    }

    const payload = this.extractBase64Payload(imageBase64).replace(/\s+/g, '');
    if (!payload) {
      throw new BadGatewayException('鐢熸垚鍥惧儚鏁版嵁涓虹┖锛屾棤娉曚笂浼犮€?');
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
      throw new BadGatewayException('鐢熸垚鍥惧儚鏁版嵁瑙ｇ爜澶辫触锛堢┖鍐呭锛夛紝鏃犳硶涓婁紶銆?');
    }

    let mimeType: string;
    let extension: string;
    try {
      ({ mimeType, extension } = this.inferImageMimeFromBuffer(buffer));
    } catch (error) {
      // base64/base64url 瑙ｇ爜缁撴灉鍙兘涓嶅悓锛堝挨鍏舵槸 URL-safe 瀛楃锛?
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
   * 浠庤姹備腑鑾峰彇鐢ㄦ埛鐨勮嚜瀹氫箟 Google API Key
   * 濡傛灉鐢ㄦ埛璁剧疆浜嗚嚜瀹氫箟 Key 涓?mode 涓?'custom'锛屽垯杩斿洖璇?Key
   * 鍚﹀垯杩斿洖 null锛堜娇鐢ㄧ郴缁熼粯璁?Key锛?   */
  private async getUserCustomApiKey(req: any): Promise<string | null> {
    try {
      // 濡傛灉鏄?API Key 璁よ瘉锛堝閮ㄨ皟鐢級锛屼笉浣跨敤鐢ㄦ埛鑷畾涔?Key
      if (req.apiClient) {
        return null;
      }

      // 鑾峰彇 JWT 涓殑鐢ㄦ埛 ID
      const userId = req.user?.sub;
      if (!userId) {
        return null;
      }

      const { apiKey, mode } = await this.usersService.getGoogleApiKey(userId);

      // 鍙湁褰?mode 涓?'custom' 涓旀湁 apiKey 鏃舵墠浣跨敤
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
   * 鍒ゆ柇鏄惁鏄敮鎸佽嚜瀹氫箟 API Key 鐨?provider
   * gemini 鍜?gemini-pro 閮芥敮鎸佷娇鐢ㄧ敤鎴疯嚜瀹氫箟鐨?Google API Key
   */
  private isGeminiProvider(providerName: string | null): boolean {
    return !providerName || providerName === 'gemini' || providerName === 'gemini-pro';
  }

  /**
   * 鑾峰彇鐢ㄦ埛ID锛堜粠JWT鎴朅PI Key璁よ瘉锛?   * API Key 璁よ瘉涓嶆墸绉垎
   */
  private getUserId(req: any): string | null {
    // API Key 璁よ瘉涓嶆墸绉垎
    if (req.apiClient) {
      return null;
    }
    return req.user?.sub || req.user?.id || null;
  }

  private extractIdempotencyKey(
    req: any,
    requestBody?: Record<string, any>,
  ): string | undefined {
    const pickHeader = (headerName: string): string | undefined => {
      const raw = req?.headers?.[headerName];
      if (Array.isArray(raw)) {
        const first = raw.find((item) => typeof item === 'string' && item.trim().length > 0);
        return typeof first === 'string' ? first.trim() : undefined;
      }
      if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
      }
      return undefined;
    };

    const bodyKey =
      requestBody && typeof requestBody.idempotencyKey === 'string'
        ? requestBody.idempotencyKey.trim()
        : '';
    const key =
      pickHeader('idempotency-key') ||
      pickHeader('Idempotency-Key') ||
      pickHeader('x-idempotency-key') ||
      pickHeader('x-request-id') ||
      (bodyKey.length > 0 ? bodyKey : undefined);
    if (!key) return undefined;
    return key.slice(0, 128);
  }

  /**
   * 纭畾鍥惧儚鐢熸垚鏈嶅姟绫诲瀷
   */
  private getImageGenerationServiceType(model?: string, provider?: string): ServiceType {
    const normalizedModel = model?.trim().toLowerCase();

    if (normalizedModel?.includes('gpt-image-2')) {
      return 'gpt-image-2';
    }

    // 鏍规嵁 provider 鍜?model 纭畾鏈嶅姟绫诲瀷
    if (provider === 'midjourney') {
      return 'midjourney-imagine';
    }

    if (provider === 'seedream5' || normalizedModel?.includes('seedream')) {
      return 'doubao-seedream-5-0-260128';
    }

    if (normalizedModel?.includes('gemini-3.1')) {
      return 'gemini-3.1-image';
    }

    // Gemini 妯″瀷
    if (normalizedModel?.includes('gemini-3') || normalizedModel?.includes('imagen-3')) {
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
    if (value === 'stable' || value.includes('tencent') || value.includes('nano')) return 'tencent';
    return value;
  }

  private asRecord(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, any>;
  }

  private hasNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private hasNonEmptyStringInList(value: unknown): boolean {
    return Array.isArray(value) && value.some((item) => this.hasNonEmptyString(item));
  }

  private hasImagePayload(result: unknown): boolean {
    const payload = this.asRecord(result);
    if (!payload) return false;
    const metadata = this.asRecord(payload.metadata);

    if (this.hasNonEmptyString(payload.imageData)) return true;
    if (this.hasNonEmptyString(payload.imageUrl)) return true;
    if (this.hasNonEmptyStringInList(payload.imageUrls)) return true;
    if (this.hasNonEmptyStringInList(payload.images)) return true;

    if (!metadata) return false;
    if (this.hasNonEmptyString(metadata.imageData)) return true;
    if (this.hasNonEmptyString(metadata.imageUrl)) return true;
    if (this.hasNonEmptyStringInList(metadata.imageUrls)) return true;
    if (this.hasNonEmptyStringInList(metadata.images)) return true;

    return false;
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
    providerOptions?: Record<string, any>,
  ): Record<string, any> {
    const aiProvider = providerName || 'gemini';
    const bananaImageRoute = this.resolveBananaImageRouteFromProviderOptions(
      providerOptions,
    );
    const explicitChannelHint =
      typeof extraParams?.channelHint === 'string' && extraParams.channelHint.trim()
        ? extraParams.channelHint.trim()
        : undefined;
    const channelHint =
      bananaImageRoute === 'stable'
        ? 'tencent'
        : bananaImageRoute === 'normal'
        ? 'apimart'
        : aiProvider === 'nano2'
        ? 'apimart'
        : aiProvider.startsWith('banana')
        ? '147'
        : explicitChannelHint;

    return {
      ...(extraParams || {}),
      aiProvider,
      channelHint,
      ...(bananaImageRoute ? { bananaImageRoute } : {}),
    };
  }

  private normalizeRouteKey(value: unknown): BananaRouteKey | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'normal') return 'normal';
    if (normalized === 'stable') return 'stable';
    return null;
  }

  private resolveRouteFromApiUsageParams(requestParams: unknown): BananaRouteKey {
    const params = this.asRecord(requestParams);
    const providerOptions = this.asRecord(params?.providerOptions);
    const bananaOptions = this.asRecord(providerOptions?.banana);
    const explicitRoute =
      this.normalizeRouteKey(params?.bananaImageRoute) ||
      this.normalizeRouteKey(providerOptions?.bananaImageRoute) ||
      this.normalizeRouteKey(bananaOptions?.imageRoute);
    if (explicitRoute) return explicitRoute;

    const channelCandidates = [
      params?.channel,
      params?.executionChannel,
      params?.providerChannel,
      params?.channelHint,
      params?.routedProvider,
      params?.provider,
    ];

    for (const candidate of channelCandidates) {
      if (typeof candidate !== 'string') continue;
      const normalized = this.normalizeChannelName(candidate);
      if (normalized === 'tencent') return 'stable';
      if (normalized === 'apimart' || normalized === '147') return 'normal';
    }

    return 'normal';
  }

  private buildClientDayRange(timezoneOffsetMinutes?: string): {
    startAt: Date;
    endAt: Date;
    timezoneOffsetMinutes: number;
  } {
    const parsedOffset = Number.parseInt(String(timezoneOffsetMinutes ?? ''), 10);
    const fallbackOffset = new Date().getTimezoneOffset();
    const offset =
      Number.isFinite(parsedOffset) && Math.abs(parsedOffset) <= 14 * 60
        ? parsedOffset
        : fallbackOffset;
    const now = Date.now();
    const localNow = new Date(now - offset * 60_000);
    localNow.setUTCHours(0, 0, 0, 0);
    const startAt = new Date(localNow.getTime() + offset * 60_000);
    const endAt = new Date(startAt.getTime() + 24 * 60 * 60_000);
    return { startAt, endAt, timezoneOffsetMinutes: offset };
  }

  private createRouteSuccessRateStats(route: BananaRouteKey): BananaRouteSuccessRateStats {
    return {
      route,
      totalCalls: 0,
      completedCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      pendingCalls: 0,
      successRate: null,
    };
  }

  @Get('banana-route-success-rates')
  async getBananaRouteSuccessRates(
    @Query('timezoneOffsetMinutes') timezoneOffsetMinutes?: string,
  ) {
    const { startAt, endAt, timezoneOffsetMinutes: resolvedOffset } =
      this.buildClientDayRange(timezoneOffsetMinutes);
    const byRoute: Record<BananaRouteKey, BananaRouteSuccessRateStats> = {
      normal: this.createRouteSuccessRateStats('normal'),
      stable: this.createRouteSuccessRateStats('stable'),
    };

    const records = await this.prisma.apiUsageRecord.findMany({
      where: {
        serviceType: { in: [...BANANA_ROUTE_SUCCESS_RATE_SERVICE_TYPES] },
        responseStatus: {
          in: [
            ApiResponseStatus.SUCCESS,
            ApiResponseStatus.FAILED,
            ApiResponseStatus.PENDING,
          ],
        },
        createdAt: {
          gte: startAt,
          lt: endAt,
        },
      },
      select: {
        responseStatus: true,
        requestParams: true,
      },
    });

    for (const record of records) {
      const route = this.resolveRouteFromApiUsageParams(record.requestParams);
      const stats = byRoute[route];
      stats.totalCalls += 1;
      if (record.responseStatus === ApiResponseStatus.SUCCESS) {
        stats.successfulCalls += 1;
        stats.completedCalls += 1;
      } else if (record.responseStatus === ApiResponseStatus.FAILED) {
        stats.failedCalls += 1;
        stats.completedCalls += 1;
      } else if (record.responseStatus === ApiResponseStatus.PENDING) {
        stats.pendingCalls += 1;
      }
    }

    for (const stats of Object.values(byRoute)) {
      stats.successRate =
        stats.completedCalls > 0
          ? Math.round((stats.successfulCalls / stats.completedCalls) * 100)
          : null;
    }

    return {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      timezoneOffsetMinutes: resolvedOffset,
      routes: byRoute,
    };
  }

  private summarizeRequestPrompt(prompt?: string | null): string | undefined {
    if (typeof prompt !== 'string') return undefined;
    const trimmed = prompt.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private extractRenderableRequestImageRefs(values: unknown[]): string[] {
    const candidates: string[] = [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) continue;
      if (/^[A-Za-z0-9+/=]{80,}$/.test(trimmed)) continue;
      if (!candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    }
    return candidates;
  }

  private buildRequestPromptAndImageParams(
    prompt: string | undefined | null,
    imageRefs?: unknown[],
  ): Record<string, any> {
    const requestPrompt = this.summarizeRequestPrompt(prompt);
    const requestThumbnailUrls = this.extractRenderableRequestImageRefs(
      Array.isArray(imageRefs) ? imageRefs : [],
    );

    return {
      ...(requestPrompt ? { requestPrompt } : {}),
      ...(requestThumbnailUrls[0] ? { requestThumbnailUrl: requestThumbnailUrls[0] } : {}),
      ...(requestThumbnailUrls.length > 0 ? { requestThumbnailUrls } : {}),
    };
  }

  private async buildVideoProviderCreditParams(
    dto: VideoProviderRequestDto,
  ): Promise<Record<string, any>> {
    const params: Record<string, any> = {
      aiProvider: dto.provider,
      ...this.buildRequestPromptAndImageParams(dto.prompt, dto.referenceImages),
    };

    const preferredVendorKey =
      typeof dto.vendorKey === 'string' && dto.vendorKey.trim().length > 0
        ? dto.vendorKey.trim()
        : undefined;

    if (typeof dto.managedModelKey === 'string' && dto.managedModelKey.trim().length > 0) {
      params.managedModelKey = dto.managedModelKey.trim();
    }

    if (preferredVendorKey) {
      params.vendorKey = preferredVendorKey;
    }

    if (typeof dto.platformKey === 'string' && dto.platformKey.trim().length > 0) {
      params.platformKey = dto.platformKey.trim();
    }

    if (dto.klingModel) {
      params.klingModel = dto.klingModel;
    }

    if (dto.viduModel) {
      params.viduModel = dto.viduModel;
    }
    if (dto.viduModelVariant) {
      params.viduModelVariant = dto.viduModelVariant;
    }

    if (dto.seedanceModel) {
      params.seedanceModel = dto.seedanceModel;
    }

    if (typeof dto.mode === 'string' && dto.mode.trim().length > 0) {
      params.mode = dto.mode.trim().toLowerCase();
    }

    if (typeof dto.sound !== 'undefined') {
      params.sound = dto.sound;
      if (typeof dto.sound === 'boolean') {
        params.hasAudio = dto.sound;
      } else if (typeof dto.sound === 'string') {
        const normalizedSound = dto.sound.trim().toLowerCase();
        if (['on', 'true', 'yes', '1'].includes(normalizedSound)) {
          params.hasAudio = true;
        } else if (['off', 'false', 'no', '0'].includes(normalizedSound)) {
          params.hasAudio = false;
        }
      }
    }

    if (typeof dto.duration === 'number' && Number.isFinite(dto.duration)) {
      const normalizedDuration = Math.round(dto.duration);
      params.duration = normalizedDuration;
      params.durationSec = normalizedDuration;
    }

    if (typeof dto.resolution === 'string' && dto.resolution.trim().length > 0) {
      params.resolution = dto.resolution.trim().toUpperCase();
    }

    if (typeof dto.aspectRatio === 'string' && dto.aspectRatio.trim().length > 0) {
      params.aspectRatio = dto.aspectRatio.trim();
    }

    if (typeof dto.videoMode === 'string' && dto.videoMode.trim().length > 0) {
      const normalizedVideoMode = dto.videoMode.trim().toLowerCase();
      params.videoMode = normalizedVideoMode;
      params.generationMode = normalizedVideoMode;
    }

    if (typeof dto.klingStoryboardMode === 'string' && dto.klingStoryboardMode.trim().length > 0) {
      params.klingStoryboardMode = dto.klingStoryboardMode.trim().toLowerCase();
    }

    if (typeof dto.generateAudio === 'boolean') {
      params.generateAudio = dto.generateAudio;
      params.hasAudio = dto.generateAudio;
    }

    if (typeof dto.watermark === 'boolean') {
      params.watermark = dto.watermark;
    }

    if (typeof dto.offPeak === 'boolean') {
      params.offPeak = dto.offPeak;
    }

    const referenceImageCount = Array.isArray(dto.referenceImages) ? dto.referenceImages.length : 0;
    const referenceVideoCount = Array.isArray(dto.referenceVideos) ? dto.referenceVideos.length : 0;
    const audioCount = Array.isArray(dto.audioUrls) ? dto.audioUrls.length : 0;
    params.referenceImageCount = referenceImageCount;
    params.referenceVideoCount = referenceVideoCount;
    params.audioInputCount = audioCount;
    const normalizedVideoMode =
      typeof dto.videoMode === 'string' && dto.videoMode.trim().length > 0
        ? dto.videoMode.trim().toLowerCase()
        : '';

    if (referenceVideoCount > 0 || typeof dto.referenceVideo === 'string') {
      params.inputType = 'video';
      params.referenceVideo = true;
      params.hasVideoInput = true;
    } else if (referenceImageCount > 0) {
      params.inputType =
        dto.provider === 'doubao' && audioCount > 0 ? 'image_audio' : 'image';
      params.hasVideoInput = false;
    } else if (normalizedVideoMode === 'text' || normalizedVideoMode === 'text2video') {
      params.inputType = 'text';
      params.hasVideoInput = false;
    } else if (normalizedVideoMode) {
      params.inputType = dto.provider === 'doubao' ? 'image' : 'text';
      params.hasVideoInput = false;
    }

    if (dto.provider === 'doubao' && typeof params.inputType !== 'string') {
      params.inputType = normalizedVideoMode === 'text' ? 'text' : 'image';
    }

    const hasPricingParam = (key: string): boolean => {
      const value = params[key];
      return value !== undefined && value !== null && value !== '';
    };

    const assignPricingDefault = (key: string, value: unknown): void => {
      if (value === undefined || value === null || value === '') return;

      if (key === 'duration' || key === 'durationSec') {
        if (hasPricingParam('duration') || hasPricingParam('durationSec')) return;
        const duration = Number(value);
        if (!Number.isFinite(duration) || duration <= 0) return;
        const normalizedDuration = Math.round(duration);
        params.duration = normalizedDuration;
        params.durationSec = normalizedDuration;
        return;
      }

      if (hasPricingParam(key)) return;

      if (key === 'resolution' && typeof value === 'string') {
        const normalizedResolution = value.trim().toUpperCase();
        if (normalizedResolution) params.resolution = normalizedResolution;
        return;
      }

      params[key] = value;

      if (key === 'sound') {
        if (typeof value === 'boolean') {
          params.hasAudio = value;
        } else if (typeof value === 'string') {
          const normalizedSound = value.trim().toLowerCase();
          if (['on', 'true', 'yes', '1'].includes(normalizedSound)) {
            params.hasAudio = true;
          } else if (['off', 'false', 'no', '0'].includes(normalizedSound)) {
            params.hasAudio = false;
          }
        }
      }
    };

    const applyManagedPricingDefaults = (
      route: Awaited<ReturnType<typeof this.modelRoutingService.resolveVideoModel>>,
    ) => {
      const pricing = route?.vendor?.pricing;
      if (!pricing || typeof pricing !== 'object') return;
      const displayConfig = (pricing as Record<string, any>).displayConfig;
      const defaultSelections =
        displayConfig && typeof displayConfig === 'object' && !Array.isArray(displayConfig)
          ? (displayConfig as Record<string, any>).defaultSelections
          : null;
      if (!defaultSelections || typeof defaultSelections !== 'object' || Array.isArray(defaultSelections)) {
        return;
      }

      for (const [key, value] of Object.entries(defaultSelections)) {
        assignPricingDefault(key, value);
      }
    };

    const assignRouteParams = (
      route: Awaited<ReturnType<typeof this.modelRoutingService.resolveVideoModel>>,
    ) => {
      if (!route) return false;
      params.modelKey = route.model.modelKey;
      params.vendorKey = route.vendor.vendorKey;
      params.platformKey = route.vendor.platformKey || route.vendor.vendorKey;
      params.route = route.route;
      params.providerChannel = route.vendor.platformKey || route.vendor.vendorKey;
      params.routedProvider = route.vendor.provider || dto.provider;
      applyManagedPricingDefaults(route);
      return true;
    };

    const normalizedKlingModel =
      typeof dto.klingModel === 'string' ? dto.klingModel.trim().toLowerCase() : '';

    if (
      (dto.provider === 'kling' ||
        dto.provider === 'kling-2.6' ||
        dto.provider === 'kling-o3') &&
      normalizedKlingModel === 'kling-v3-0'
    ) {
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel('kling-3.0', preferredVendorKey),
      );
      return params;
    }

    if (
      (dto.provider === 'kling' || dto.provider === 'kling-2.6') &&
      (normalizedKlingModel === '' || normalizedKlingModel === 'kling-v2-6')
    ) {
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel('kling-2.6', preferredVendorKey),
      );
      return params;
    }

    if (dto.provider === 'kling-o3') {
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel('kling-o3', preferredVendorKey),
      );
      return params;
    }

    if (dto.provider === 'vidu' || dto.provider === 'viduq3-pro') {
      const normalized = String(dto.viduModel || '').trim().toLowerCase();
      const isQ3Family =
        normalized === 'q3' ||
        normalized === 'q3-pro' ||
        normalized === 'q3pro' ||
        normalized === 'q3-turbo' ||
        normalized === 'q3turbo' ||
        normalized === 'q3-mix' ||
        normalized === 'q3mix';
      const modelKey =
        isQ3Family
          ? 'vidu-q3'
          : 'vidu-q2';
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel(modelKey, preferredVendorKey),
      );
      return params;
    }

    if (dto.provider === 'doubao') {
      const normalized = String(dto.seedanceModel || '').trim().toLowerCase();
      const modelKey = this.isSeedance20Model(normalized) ? 'seedance-2.0' : 'seedance-1.5';
      assignRouteParams(
        await this.modelRoutingService.resolveVideoModel(modelKey, preferredVendorKey),
      );
      return params;
    }

    params.routedProvider = dto.provider;
    params.providerChannel = dto.provider;
    return params;
  }

  private resolveVideoProviderServiceType(dto: VideoProviderRequestDto): ServiceType {
    const normalizedKlingModel =
      typeof dto.klingModel === 'string' ? dto.klingModel.trim().toLowerCase() : '';

    if (
      (dto.provider === 'kling' ||
        dto.provider === 'kling-2.6' ||
        dto.provider === 'kling-o3') &&
      normalizedKlingModel === 'kling-v3-0'
    ) {
      return 'kling-3.0-video';
    }

    if (
      (dto.provider === 'kling' || dto.provider === 'kling-2.6') &&
      (normalizedKlingModel === '' || normalizedKlingModel === 'kling-v2-6')
    ) {
      return 'kling-2.6-video';
    }

    return `${dto.provider}-video` as ServiceType;
  }

  private emitVideoProviderGenerationTaskLog(params: {
    stage: 'queued' | 'processing' | 'succeeded' | 'failed';
    userId: string | null;
    provider: string;
    prompt?: string;
    status: string;
    taskId: string;
    apiUsageId?: string | null;
    requestParams?: Record<string, any>;
    error?: string | null;
  }): void {
    const { requestParams } = params;
    void this.telemetryService.ingestGenerationTask({
      traceId: null,
      taskId: params.taskId,
      taskType: 'video-provider',
      stage: params.stage,
      userId: params.userId,
      provider: params.provider,
      prompt: typeof params.prompt === 'string' ? params.prompt.slice(0, 500) : null,
      status: params.status,
      error: params.error || null,
      metadata: {
        apiUsageId: params.apiUsageId || null,
        modelKey: requestParams?.modelKey || null,
        vendorKey: requestParams?.vendorKey || null,
        platformKey: requestParams?.platformKey || null,
        route: requestParams?.route || null,
        providerChannel: requestParams?.providerChannel || null,
        routedProvider: requestParams?.routedProvider || null,
        klingModel: requestParams?.klingModel || null,
        viduModel: requestParams?.viduModelVariant || requestParams?.viduModel || null,
        seedanceModel: requestParams?.seedanceModel || null,
      },
      receivedAt: new Date().toISOString(),
    });
  }

  private async buildSora2CreditParams(params: {
    selectedSoraModel: string;
    quality: 'sd' | 'hd';
    aspectRatio?: string;
    duration?: string;
  }): Promise<Record<string, any>> {
    const requestParams: Record<string, any> = {
      quality: params.quality,
      soraModel: params.selectedSoraModel,
      aspectRatio: params.aspectRatio,
      duration: params.duration,
    };

    const route = await this.modelRoutingService.resolveVideoModel('sora-2');
    if (route) {
      requestParams.modelKey = route.model.modelKey;
      requestParams.vendorKey = route.vendor.vendorKey;
      requestParams.platformKey = route.vendor.platformKey || route.vendor.vendorKey;
      requestParams.route = route.route;
      requestParams.providerChannel = route.vendor.platformKey || route.vendor.vendorKey;
      requestParams.routedProvider = route.vendor.provider || params.selectedSoraModel;
    } else {
      requestParams.providerChannel = params.selectedSoraModel;
      requestParams.routedProvider = params.selectedSoraModel;
    }

    return requestParams;
  }

  /**
   * DashScope async video endpoints锛氫粎鍒涘缓寮傛浠诲姟銆佸皻鏈骇鍑鸿棰戞椂锛岀Н鍒嗚褰曚繚鎸?pending锛屽苟鎶?apiUsageId 杩斿洖缁欏墠绔敤浜庡け璐ラ€€娆俱€?   */
  private isDashscopeVideoAsyncPending(result: any): boolean {
    if (!result || result.success !== true || !result.data) return false;
    const d = result.data;
    const videoUrl =
      d.videoUrl ||
      d.video_url ||
      d.output?.video_url ||
      (Array.isArray(d.output) && d.output[0]?.video_url) ||
      d.raw?.output?.video_url ||
      d.raw?.video_url;
    if (videoUrl) return false;
    const taskId = d.taskId || d.task_id;
    return typeof taskId === 'string' && taskId.length > 0;
  }

  private async delay(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async markFailedAndRefundWithRetry(params: {
    userId: string;
    apiUsageId: string;
    serviceType: string;
    errorMessage: string;
    processingTime: number;
  }): Promise<boolean> {
    const markRetryDelaysMs = [0, 120, 360];
    const refundRetryDelaysMs = [0, 150, 420];

    for (let markAttempt = 0; markAttempt < markRetryDelaysMs.length; markAttempt++) {
      if (markAttempt > 0) {
        await this.delay(markRetryDelaysMs[markAttempt]);
      }

      let failedMarked = false;
      try {
        await this.creditsService.updateApiUsageStatus(
          params.apiUsageId,
          ApiResponseStatus.FAILED,
          params.errorMessage,
          params.processingTime,
        );
        failedMarked = true;
      } catch (statusError) {
        this.logger.warn(
          `[${params.serviceType}] mark-failed attempt ${markAttempt + 1} updateApiUsageStatus failed: ${this.summarizeError(
            statusError,
          )}`,
        );
      }

      if (!failedMarked) {
        try {
          await this.creditsService.markApiUsageFailedForUser(
            params.userId,
            params.apiUsageId,
            params.errorMessage,
            params.processingTime,
          );
          failedMarked = true;
        } catch (markError) {
          this.logger.warn(
            `[${params.serviceType}] mark-failed attempt ${markAttempt + 1} markApiUsageFailedForUser failed: ${this.summarizeError(
              markError,
            )}`,
          );
        }
      }

      if (!failedMarked) continue;

      for (let refundAttempt = 0; refundAttempt < refundRetryDelaysMs.length; refundAttempt++) {
        if (refundAttempt > 0) {
          await this.delay(refundRetryDelaysMs[refundAttempt]);
        }
        try {
          await this.creditsService.refundCredits(params.userId, params.apiUsageId);
          return true;
        } catch (refundError) {
          this.logger.warn(
            `[${params.serviceType}] refund attempt ${refundAttempt + 1} failed: ${this.summarizeError(
              refundError,
            )}`,
          );
        }
      }
    }

    return false;
  }

  /**
   * 棰勬墸绉垎骞舵墽琛屾搷浣?   * @param skipCredits 濡傛灉涓?true锛屽垯璺宠繃绉垎鎵ｉ櫎锛堜緥濡備娇鐢ㄨ嚜瀹氫箟 API Key 鏃讹級
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
    creditOptions?: {
      /** 鑻ヨ繑鍥炰綋涓?{ success: false }锛圚TTP 浠?200锛夛紝瑙嗕负澶辫触骞堕€€娆?*/
      treatReturnedFailureAsError?: boolean;
      /** 涓?true 鏃朵笉灏嗘湰娆¤皟鐢ㄦ爣涓烘垚鍔燂紙淇濇寔 pending锛夛紝鐢ㄤ簬寮傛浠诲姟鍚庣画鐢卞墠绔‘璁ゅけ璐ュ苟閫€娆?*/
      skipFinalizeSuccessIf?: (result: T) => boolean;
      /** 瀵?success=true 鐨勮繑鍥炰綋鍋氶澶栨牎楠岋紝鏍￠獙澶辫触鏃舵寜澶辫触澶勭悊骞堕€€娆?*/
      validateSuccessResult?: (result: T) => boolean | { ok: boolean; message?: string };
      /** 鍦ㄥ垱寤虹Н鍒嗘祦姘村悗閫忓嚭 apiUsageId锛屼究浜庡紓姝ラ摼璺拷鍔?telemetry 鍏宠仈瀛楁 */
      onApiUsageId?: (apiUsageId: string) => void;
    },
  ): Promise<T> {
    const userId = this.getUserId(req);

    // 濡傛灉娌℃湁鐢ㄦ埛ID锛圓PI Key璁よ瘉锛夋垨鏄庣‘璺宠繃绉垎锛岀洿鎺ユ墽琛屾搷浣?
    if (!userId) {
      this.logger.debug('API Key authentication - skipping credits deduction');
      return operation();
    }

    if (skipCredits) {
      await this.creditsService.assertFreeUserUsageQuota(
        userId,
        serviceType,
        outputImageCount,
      );
      this.logger.debug('Using custom API key - skipping credits deduction');
      const result = await operation();
      await this.creditsService.verifyAndRewardInviterSafely(userId, { skipApiUsageCheck: true });
      return result;
    }

    // 纭繚鐢ㄦ埛鏈夌Н鍒嗚处鎴?
    await this.creditsService.getOrCreateAccount(userId);

    const startTime = Date.now();
    let apiUsageId: string | null = null;
    const sanitizedRequestParams = requestParams
      ? Object.fromEntries(
          Object.entries(requestParams).filter(([_, value]) => value !== undefined),
        )
      : undefined;
    const idempotencyKey = this.extractIdempotencyKey(req, sanitizedRequestParams);

    try {
      // 棰勬墸绉垎
      const deductResult = await this.creditsService.preDeductCredits({
        userId,
        serviceType,
        model,
        inputImageCount,
        outputImageCount,
        requestParams: sanitizedRequestParams,
        ipAddress: req.ip,
        userAgent: req.headers?.['user-agent'],
        idempotencyKey,
      });

      apiUsageId = deductResult.apiUsageId;
      this.logger.debug(`Credits pre-deducted: ${serviceType}, apiUsageId: ${apiUsageId}`);
      creditOptions?.onApiUsageId?.(apiUsageId);

      // 鎵ц瀹為檯鎿嶄綔
      const result = await operation();

      if (
        creditOptions?.treatReturnedFailureAsError &&
        result &&
        typeof result === 'object' &&
        'success' in (result as object) &&
        (result as any).success === false
      ) {
        const errPayload = (result as any).error;
        const msg =
          typeof errPayload?.message === 'string' && errPayload.message.trim().length > 0
            ? errPayload.message.trim()
            : typeof errPayload?.code === 'string'
              ? errPayload.code
              : '鎿嶄綔澶辫触';
        throw new BadRequestException(msg);
      }

      const validateOutcome = creditOptions?.validateSuccessResult?.(result);
      if (validateOutcome !== undefined) {
        const normalized =
          typeof validateOutcome === 'boolean'
            ? { ok: validateOutcome, message: undefined }
            : validateOutcome;
        if (!normalized?.ok) {
          const message =
            typeof normalized?.message === 'string' && normalized.message.trim().length > 0
              ? normalized.message.trim()
              : 'Operation succeeded but response payload is invalid';
          throw new BadGatewayException(message);
        }
      }

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

      const deferFinalize = Boolean(
        creditOptions?.skipFinalizeSuccessIf &&
          apiUsageId &&
          creditOptions.skipFinalizeSuccessIf(result),
      );
      if (deferFinalize) {
        return { ...(result as object), apiUsageId } as T;
      }

      // 鏇存柊鐘舵€佷负鎴愬姛
      const processingTime = Date.now() - startTime;
      await this.creditsService.updateApiUsageStatus(
        apiUsageId,
        ApiResponseStatus.SUCCESS,
        undefined,
        processingTime,
      );

      return result;
    } catch (error) {
      // 鏇存柊鐘舵€佷负澶辫触骞堕€€杩樼Н鍒?
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[${serviceType}] Operation failed - attempting credits refund: ` +
        `userId=${userId}, apiUsageId=${apiUsageId}, processingTime=${processingTime}ms, ` +
        `error=${this.summarizeError(error)}`
      );

      if (apiUsageId) {
        const refunded = await this.markFailedAndRefundWithRetry({
          userId,
          apiUsageId,
          serviceType,
          errorMessage,
          processingTime,
        });
        if (refunded) {
          this.logger.warn(
            `[${serviceType}] Credits successfully refunded for failed operation: ` +
              `userId=${userId}, apiUsageId=${apiUsageId}`,
          );
        } else {
          this.logger.error(
            `[${serviceType}] CRITICAL: Failed to mark failed/refund after retries. ` +
              `userId=${userId}, apiUsageId=${apiUsageId}`,
          );
        }
      } else {
        this.logger.error(
          `[${serviceType}] CRITICAL: No apiUsageId available for refund. ` +
          `userId=${userId}, error=${this.summarizeError(error)}`
        );
      }

      if (this.isPrismaPoolTimeoutError(error)) {
        this.logger.warn(
          `Prisma connection pool timeout during ${serviceType}: ${this.summarizeError(error)}`,
        );
        throw new ServiceUnavailableException('鏁版嵁搴撶箒蹇欙紝璇风◢鍚庨噸璇?');
      }

      // 浠呭湪宸茬粡瀹屾垚棰勬墸璐瑰苟杩涘叆涓婃父璋冪敤闃舵鏃讹紝鎵嶅皢 quota/rate-limit 褰掔被涓轰笂娓?429
      if (apiUsageId && this.isRateLimitOrQuotaError(error)) {
        throw new HttpException('涓婃父妯″瀷棰濆害涓嶈冻鎴栬姹傝繃浜庨绻侊紝璇风◢鍚庨噸璇?, 429');
      }

      const mappedUpstreamError = this.mapUpstreamErrorToHttpException(error);
      if (mappedUpstreamError) {
        throw mappedUpstreamError;
      }

      throw error;
    }
  }

  private resolveImageModel(providerName: string | null, requestedModel?: string): string {
    const rawModel = requestedModel?.trim();
    const model =
      rawModel === 'gemini-3-flash-preview' ||
      rawModel === 'gemini-3-flash' ||
      rawModel === 'gemini-3-pro-preview'
        ? 'gemini-3-pro-image-preview'
        : rawModel;
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultImageModels[providerName] || 'gemini-3-pro-image-preview';
    }
    return this.providerDefaultImageModels.gemini;
  }

  private resolveAnalyzeModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested analyze model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultAnalyzeModels[providerName] || 'gemini-3.1-pro';
    }
    return this.providerDefaultAnalyzeModels.gemini;
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

  private extractHttpStatusFromError(error: any): number | null {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      return Number.isFinite(status) ? status : null;
    }

    const candidates = [
      error?.message,
      error?.cause?.message,
      error?.response?.message,
      typeof error?.response === 'string' ? error.response : '',
    ]
      .filter(Boolean)
      .map((value) => String(value));

    for (const message of candidates) {
      const match =
        message.match(/\bHTTP[_\s:]?(\d{3})\b/i) ||
        message.match(/\bstatus[_\s:]?(\d{3})\b/i);
      if (!match) continue;
      const status = Number(match[1]);
      if (Number.isFinite(status)) return status;
    }

    return null;
  }

  private isTimeoutLikeError(error: any): boolean {
    const messages = [
      error?.message,
      error?.cause?.message,
      error?.response?.message,
      typeof error?.response === 'string' ? error.response : '',
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return messages.some((message) => {
      return (
        message.includes('524') ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('gateway timeout') ||
        message.includes('aborterror') ||
        message.includes('aborted')
      );
    });
  }

  private mapUpstreamErrorToHttpException(error: any): HttpException | null {
    const status = this.extractHttpStatusFromError(error);

    if (status === 464) {
      return new BadGatewayException('涓婃父浠诲姟澶辫触锛岃绋嶅悗閲嶈瘯');
    }

    if (status === 524 || this.isTimeoutLikeError(error)) {
      return new HttpException('鏈嶅姟鍣ㄥ鐞嗚秴鏃讹紝璇风◢鍚庨噸璇?, 524');
    }

    return null;
  }

  private isRateLimitOrQuotaError(error: any): boolean {
    if (error instanceof HttpException && error.getStatus() === 429) {
      return true;
    }

    const messages = [
      error?.message,
      error?.cause?.message,
      error?.response?.message,
      typeof error?.response === 'string' ? error.response : '',
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return messages.some((message) => {
      return (
        message.includes('429') ||
        message.includes('too many requests') ||
        message.includes('rate limit') ||
        message.includes('quota') ||
        message.includes('resource has been exhausted')
      );
    });
  }

  private getTraceId(req: TraceableReq | any): string | null {
    const direct = typeof req?.traceId === 'string' ? req.traceId.trim() : '';
    if (direct) return direct;
    const header = typeof req?.headers?.['x-trace-id'] === 'string'
      ? req.headers['x-trace-id'].trim()
      : '';
    return header || null;
  }

  private getRequestId(req: TraceableReq | any): string | null {
    const requestId = typeof req?.id === 'string' ? req.id.trim() : '';
    return requestId || null;
  }

  private getTraceContext(req: TraceableReq | any): PersistedTraceContext {
    return captureTraceContext({
      traceId: this.getTraceId(req),
      parentRequestId: this.getRequestId(req),
    });
  }

  private isPrismaPoolTimeoutError(error: any): boolean {
    const candidates = [error, error?.cause];
    return candidates.some((candidate) => {
      if (!candidate) return false;
      const code = candidate?.code ? String(candidate.code) : '';
      const message = candidate?.message ? String(candidate.message).toLowerCase() : '';
      return (
        code === 'P2024' ||
        message.includes('timed out fetching a new connection from the connection pool') ||
        message.includes('connection pool timeout')
      );
    });
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
          throw new ServiceUnavailableException('鏈嶅姟鍣ㄦ湭瀹夎 ffmpeg锛岃鑱旂郴杩愮淮澶勭悊');
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
      throw new ServiceUnavailableException('147 API Key 鏈厤缃紙BANANA_API_KEY锛夛紝璇锋鏌ュ悗绔幆澧冨彉閲?');
    }

    const apiBaseUrl = (
      process.env.VEO_API_ENDPOINT ||
      process.env.VEO_API_BASE_URL ||
      process.env.SORA2_API_ENDPOINT ||
      'https://api1.147ai.com'
    ).replace(/\/+$/, '');

    // 瑙嗛鍒嗘瀽闇€瑕佽緝闀挎椂闂达紝璁剧疆 5 鍒嗛挓瓒呮椂
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

      throw new ServiceUnavailableException('147 AI 杩斿洖浜嗙┖鍐呭锛岃绋嶅悗閲嶈瘯');
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
      throw new BadRequestException('瑙嗛 URL 鏍煎紡鏃犳晥');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('瑙嗛 URL 鍙敮鎸?http/https 鍗忚');
    }

    const hostname = parsed.hostname;
    const allowedHosts = this.oss.allowedPublicHosts();
    this.logger.debug(`Validating URL host: ${hostname}, allowed: ${allowedHosts.join(', ')}`);
    const isAllowed =
      allowedHosts.includes(hostname) ||
      allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));

    if (!isAllowed) {
      this.logger.warn(`URL host not allowed: ${hostname}, allowedHosts: ${allowedHosts.join(', ')}`);
      throw new BadRequestException('瑙嗛 URL 鍩熷悕涓嶅湪鍏佽鍒楄〃涓紝璇蜂娇鐢ㄧ櫧鍚嶅崟鍐呯殑鍩熷悕');
    }

    return parsed;
  }

  private normalizeManagedImageKey(raw?: string | null): string | null {
    const value =
      typeof raw === 'string' ? raw.trim().replace(/^\/+/, '') : '';
    if (!value) return null;
    return MANAGED_IMAGE_KEY_REGEX.test(value) ? value : null;
  }

  private resolveBucketOriginImageUrl(key: string): string | null {
    const normalizedKey = this.normalizeManagedImageKey(key);
    if (!normalizedKey) return null;
    const hosts = this.oss.publicHosts();
    const bucketOriginHost = hosts[0];
    if (!bucketOriginHost) return null;
    return `https://${bucketOriginHost}/${normalizedKey}`;
  }

  private extractManagedAssetKeyFromImageRef(
    input?: string | null,
    visited: Set<string> = new Set(),
  ): string | null {
    const trimmed = typeof input === 'string' ? input.trim() : '';
    if (!trimmed) return null;
    if (visited.has(trimmed)) return null;
    visited.add(trimmed);

    const direct = this.normalizeManagedImageKey(trimmed);
    if (direct) return direct;

    try {
      const parsed = new URL(trimmed);
      const fromPath = this.normalizeManagedImageKey(parsed.pathname);
      if (fromPath) return fromPath;

      const fromQueryKey = this.normalizeManagedImageKey(
        parsed.searchParams.get('key'),
      );
      if (fromQueryKey) return fromQueryKey;

      const nestedUrl = parsed.searchParams.get('url');
      if (nestedUrl && nestedUrl !== trimmed) {
        const nestedKey = this.extractManagedAssetKeyFromImageRef(
          nestedUrl,
          visited,
        );
        if (nestedKey) return nestedKey;
      }
    } catch {
      // ignore
    }

    return null;
  }

  private normalizeImageUrlForUpstream(urlValue: string): string {
    const trimmed = typeof urlValue === 'string' ? urlValue.trim() : '';
    if (!trimmed) return '';

    const managedKey = this.extractManagedAssetKeyFromImageRef(trimmed);
    if (!managedKey) return trimmed;

    return (
      this.resolveBucketOriginImageUrl(managedKey) ||
      this.oss.publicUrl(managedKey)
    );
  }

  private normalizeImageUrlsForUpstream(urls: string[]): string[] {
    const out: string[] = [];
    for (const value of urls) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed) continue;
      out.push(this.normalizeImageUrlForUpstream(trimmed));
    }
    return out;
  }

  private isBananaProviderName(providerName: string | null | undefined): boolean {
    const normalized = (providerName || '').trim().toLowerCase();
    return normalized === 'banana' || normalized.startsWith('banana-');
  }

  private resolveBananaImageRouteFromProviderOptions(
    providerOptions?: Record<string, any>,
  ): 'normal' | 'stable' | null {
    const nestedRouteRaw = providerOptions?.banana?.imageRoute;
    const nestedRoute =
      typeof nestedRouteRaw === 'string' ? nestedRouteRaw.trim().toLowerCase() : '';
    if (nestedRoute === 'normal' || nestedRoute === 'stable') {
      return nestedRoute as 'normal' | 'stable';
    }

    const legacyRouteRaw = providerOptions?.bananaImageRoute;
    const legacyRoute =
      typeof legacyRouteRaw === 'string' ? legacyRouteRaw.trim().toLowerCase() : '';
    if (legacyRoute === 'normal' || legacyRoute === 'stable') {
      return legacyRoute as 'normal' | 'stable';
    }

    return null;
  }

  private async getBananaImageProviderMode(
    providerOptions?: Record<string, any>,
  ): Promise<string> {
    const userRoute = this.resolveBananaImageRouteFromProviderOptions(providerOptions);
    if (userRoute) {
      return userRoute === 'stable' ? 'tencent' : 'apimart';
    }

    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: 'banana_provider' },
      });
      return (setting?.value || 'auto').trim().toLowerCase();
    } catch {
      return 'auto';
    }
  }

  private async normalizeSourceImageForTencentForced(
    source: string,
    userId: string,
    context: string,
  ): Promise<string> {
    const value = typeof source === 'string' ? source.trim() : '';
    if (!value) {
      throw new BadRequestException(`Tencent ${context} source image is empty`);
    }

    if (/^(?:tencent-fileid:|fileid:)/i.test(value) || /^\d{6,}$/.test(value)) {
      return value;
    }

    if (/^https?:\/\//i.test(value)) {
      return this.normalizeImageUrlForUpstream(value);
    }

    const upload = await this.uploadGeneratedImageToOss(value, { userId });
    this.logger.log(
      `[${context}] Tencent forced source uploaded to OSS: key=${upload.key}`,
    );
    return upload.url;
  }

  private looksLikeSignedAssetUrl(url: string): boolean {
    return /[?&](?:X-Amz|X-Tos|OSSAccessKeyId|Signature|Expires|x-oss-signature)=/i.test(url);
  }

  private isOwnManagedImageUrl(urlValue: string): boolean {
    const trimmed = typeof urlValue === 'string' ? urlValue.trim() : '';
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return false;
    if (this.looksLikeSignedAssetUrl(trimmed)) return false;

    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      const ownHosts = this.oss.publicHosts().map((item) => item.toLowerCase());
      const hostMatched = ownHosts.some(
        (allowed) => host === allowed || host.endsWith(`.${allowed}`),
      );
      if (!hostMatched) return false;
      return this.normalizeManagedImageKey(parsed.pathname) !== null;
    } catch {
      return false;
    }
  }

  private collectProviderImageUrls(resultData: unknown): string[] {
    const payload = this.asRecord(resultData);
    if (!payload) return [];

    const metadata = this.asRecord(payload.metadata);
    const candidates: string[] = [];
    const pushUrl = (value: unknown) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!/^https?:\/\//i.test(trimmed)) return;
      if (!candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    };
    const pushUrlList = (value: unknown) => {
      if (!Array.isArray(value)) return;
      value.forEach((item) => pushUrl(item));
    };

    pushUrl(payload.imageUrl);
    pushUrlList(payload.imageUrls);
    pushUrlList(payload.images);

    if (metadata) {
      pushUrl(metadata.imageUrl);
      pushUrlList(metadata.imageUrls);
      pushUrlList(metadata.images);
      pushUrl(metadata.sourceImageUrl);
      pushUrlList(metadata.sourceImageUrls);
    }

    return candidates;
  }

  private async persistProviderImageUrlToManaged(
    imageUrl: string,
    req: any,
    userId: string,
  ): Promise<{
    url: string;
    sourceImageUrl: string;
    uploaded: boolean;
    key?: string;
    mimeType?: string;
    bytes?: number;
  }> {
    const sourceImageUrl = imageUrl.trim();
    if (this.isOwnManagedImageUrl(sourceImageUrl)) {
      return { url: sourceImageUrl, sourceImageUrl, uploaded: false };
    }

    const sourceImageDataUrl = await this.fetchImageAsDataUrl(sourceImageUrl);
    const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
    const upload = await this.uploadGeneratedImageToOss(watermarked || '', { userId });

    return {
      url: upload.url,
      sourceImageUrl,
      uploaded: true,
      key: upload.key,
      mimeType: upload.mimeType,
      bytes: upload.size,
    };
  }

  private parseAndValidateAllowedImageUrl(urlValue: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(urlValue);
    } catch {
      throw new BadRequestException('鍥剧墖 URL 鏍煎紡鏃犳晥');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('鍥剧墖 URL 鍙敮鎸?http/https 鍗忚');
    }

    const hostname = parsed.hostname;
    const allowedHosts = this.oss.allowedPublicHosts();
    const isAllowed =
      allowedHosts.includes(hostname) ||
      allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));

    if (!isAllowed) {
      this.logger.warn(`Image URL host not allowed: ${hostname}`);
      throw new BadRequestException('鍥剧墖 URL 鍩熷悕涓嶅湪鍏佽鍒楄〃涓紝璇蜂娇鐢ㄧ櫧鍚嶅崟鍐呯殑鍩熷悕');
    }

    return parsed;
  }

  private validateImageDataUrl(dataUrl: string): void {
    const match = dataUrl.match(/^data:([^;,]+)/i);
    if (!match) {
      return; // 涓嶆槸 data URL锛屽彲鑳芥槸绾?base64锛岃鍚庣画澶勭悊
    }
    const mimeType = match[1].toLowerCase();
    if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
      throw new BadRequestException(
        `Invalid image format: expected image/*, got ${mimeType}`,
      );
    }
  }

  private buildImageFetchCandidates(parsed: URL): string[] {
    const candidates: string[] = [];
    const pushCandidate = (candidate?: string | null) => {
      const value = typeof candidate === 'string' ? candidate.trim() : '';
      if (!value) return;
      if (!candidates.includes(value)) {
        candidates.push(value);
      }
    };

    pushCandidate(parsed.toString());

    const managedKey = this.extractManagedAssetKeyFromImageRef(parsed.toString());
    if (managedKey) {
      pushCandidate(this.resolveBucketOriginImageUrl(managedKey));
      pushCandidate(this.oss.publicUrl(managedKey));
    }

    return candidates;
  }

  private normalizeWanI2VBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    if (typeof next.input.img_url === 'string' && next.input.img_url.trim()) {
      next.input.img_url = this.normalizeImageUrlForUpstream(next.input.img_url);
    }

    return next;
  }

  private inferWanResolutionFromSize(size: unknown): '720P' | '1080P' | undefined {
    if (typeof size !== 'string') return undefined;
    const trimmed = size.trim();
    if (!trimmed) return undefined;

    const explicitTier = trimmed.toUpperCase();
    if (explicitTier === '720P' || explicitTier === '1080P') {
      return explicitTier;
    }

    const match = trimmed.match(/^\s*(\d+)\s*[*xX]\s*(\d+)\s*$/);
    if (!match) return undefined;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;

    return Math.max(width, height) >= 1500 ? '1080P' : '720P';
  }

  private buildWanCreditRequestParams(
    body: any,
    options: {
      managedModelKey: 'wan-2.6' | 'wan-2.6-r2v' | 'wan-2.7';
      generationMode: 't2v' | 'i2v' | 'r2v';
      requestPrompt?: string | null;
      requestThumbnailUrls?: unknown[];
      hasAudio?: boolean;
    },
  ): Record<string, any> {
    const parameters =
      body?.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
        ? body.parameters
        : {};
    const resolution =
      (typeof parameters.resolution === 'string' && parameters.resolution.trim().length > 0
        ? parameters.resolution.trim().toUpperCase()
        : undefined) || this.inferWanResolutionFromSize(parameters.size);
    const durationRaw = Number(parameters.duration);
    const duration =
      Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : undefined;

    return {
      managedModelKey: options.managedModelKey,
      modelKey: options.managedModelKey,
      vendorKey: 'dashscope',
      platformKey: 'dashscope',
      aiProvider: 'dashscope',
      generationMode: options.generationMode,
      ...(resolution ? { resolution } : {}),
      ...(duration ? { duration, durationSec: duration } : {}),
      ...(typeof options.hasAudio === 'boolean' ? { hasAudio: options.hasAudio } : {}),
      ...this.buildRequestPromptAndImageParams(
        options.requestPrompt,
        Array.isArray(options.requestThumbnailUrls) ? options.requestThumbnailUrls : [],
      ),
    };
  }

  private normalizeWan27I2VBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    const rawMedia = next.input.media;
    if (Array.isArray(rawMedia)) {
      next.input.media = rawMedia
        .map((item: any) => {
          if (!item || typeof item !== 'object') return null;
          const mediaItem: any = { ...item };
          if (typeof mediaItem.url === 'string' && mediaItem.url.trim()) {
            mediaItem.url = this.normalizeImageUrlForUpstream(mediaItem.url);
          }
          return mediaItem;
        })
        .filter((value: any) => value && typeof value.url === 'string' && value.url.trim());
    }

    return next;
  }

  private normalizeWanR2VBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    const rawReferenceVideos = next.input.reference_video_urls;
    if (Array.isArray(rawReferenceVideos)) {
      next.input.reference_video_urls = rawReferenceVideos
        .map((item: unknown) => {
          if (typeof item !== 'string') return '';
          const trimmed = item.trim();
          if (!trimmed) return '';
          return this.normalizeImageUrlForUpstream(trimmed);
        })
        .filter((value: string) => Boolean(value));
    }

    return next;
  }

  /**
   * 鍏辩敤锛氳疆璇?DashScope 寮傛瑙嗛浠诲姟锛岃繑鍥炴渶缁堣棰?URL 鎴栧け璐?瓒呮椂閿欒銆?   * 浠呬緵鏂版帴鍏ョ殑 endpoint 浣跨敤锛涚幇鏈?wan26-* / wan27-* 鍚勮嚜鐨?inline 杞淇濇寔涓嶅彉锛堥伩鍏嶈繛甯﹀洖褰掞級銆?   */
  private async pollDashScopeVideoTask(
    dashKey: string,
    taskId: string,
    label: string,
  ): Promise<
    | { success: true; data: any }
    | { success: false; error: { message: string; details?: any } }
  > {
    const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
    const intervalMs = 15000;
    const maxAttempts = 40;

    const extractVideoUrl = (obj: any) =>
      obj?.output?.video_url ||
      obj?.video_url ||
      obj?.videoUrl ||
      (Array.isArray(obj?.output) && obj.output[0]?.video_url) ||
      undefined;

    this.logger.log(
      `馃攣 Start polling DashScope ${label} task ${taskId} (${maxAttempts} attempts, ${intervalMs}ms interval)`,
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
          this.logger.warn(`DashScope ${label} status check non-OK`, {
            status: statusResp.status,
            body: errBody,
          });
          continue;
        }
        const statusData = await statusResp.json().catch(() => ({}));
        this.logger.debug(
          `馃攷 DashScope ${label} status (attempt ${attempt + 1}): ${JSON.stringify(statusData).slice(0, 200)}`,
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
          if (!finalVideoUrl) {
            this.logger.warn(
              `DashScope ${label} task ${taskId} succeeded but no video URL`,
              { dataPreview: JSON.stringify(statusData).slice(0, 400) },
            );
            return {
              success: false,
              error: {
                message: 'DashScope 浠诲姟宸插畬鎴愪絾鏈繑鍥炶棰戝湴鍧€',
                details: statusData,
              },
            };
          }
          this.logger.log(
            `鉁?DashScope ${label} task ${taskId} succeeded, videoUrl: ${String(finalVideoUrl).slice(0, 120)}`,
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
              ? failureCode
                ? `${String(failureCode)}: ${failureMessage}`
                : failureMessage
              : `DashScope ${label} task failed`;
          this.logger.error(`鉂?DashScope ${label} task ${taskId} failed`, {
            message,
            raw: statusData,
          });
          return {
            success: false,
            error: { message, details: statusData },
          };
        }
      } catch (err: any) {
        this.logger.warn(`DashScope ${label} polling exception, will retry`, err);
      }
    }
    this.logger.warn(
      `鈴?DashScope ${label} task ${taskId} polling timed out after ${maxAttempts} attempts`,
    );
    return {
      success: false,
      error: { message: `DashScope ${label} task polling timed out` },
    };
  }

  private static readonly HAPPYHORSE_MODEL_WHITELIST = new Set<string>([
    'happyhorse-1.0-t2v',
    'happyhorse-1.0-i2v',
    'happyhorse-1.0-r2v',
    'happyhorse-1.0-video-edit',
  ]);

  private resolveHappyhorseModelOrThrow(body: any): string {
    const raw = typeof body?.model === 'string' ? body.model.trim() : '';
    if (!raw || !AiController.HAPPYHORSE_MODEL_WHITELIST.has(raw)) {
      throw new BadRequestException(
        `Unsupported HappyHorse model: ${raw || '(empty)'}`,
      );
    }
    return raw;
  }

  /**
   * 閫氱敤 happyhorse body 褰掍竴鍖栵紝瑕嗙洊 t2v / i2v / r2v / video-edit 4 涓ā鍨嬨€?   * - input.media[] 涓殑 url 璧?normalizeImageUrlForUpstream锛堝浘鐗?/ 瑙嗛 URL 閫氱敤锛屼粎鍋氱櫧鍚嶅崟/鏁版嵁 URL 杞繙绋嬶級
   * - 涓嶅瓨鍦?type 瀛楁鐨勫厓绱犻粯璁よˉ reference_image锛堜繚鐣?first_frame / video / reference_image 绛夊凡鏈夊€硷級
   * - parameters.watermark 寮哄埗 false
   */
  private normalizeHappyhorseBodyForUpstream(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const next: any = { ...body };
    if (!next.input || typeof next.input !== 'object') return next;

    next.input = { ...next.input };
    const rawMedia = next.input.media;
    if (Array.isArray(rawMedia)) {
      next.input.media = rawMedia
        .map((item: any) => {
          if (!item || typeof item !== 'object') return null;
          const mediaItem: any = { ...item };
          if (typeof mediaItem.type !== 'string' || !mediaItem.type.trim()) {
            mediaItem.type = 'reference_image';
          }
          if (typeof mediaItem.url === 'string' && mediaItem.url.trim()) {
            mediaItem.url = this.normalizeImageUrlForUpstream(mediaItem.url);
          }
          return mediaItem;
        })
        .filter(
          (value: any) => value && typeof value.url === 'string' && value.url.trim(),
        );
    }

    // 寮哄埗涓嶆墦姘村嵃
    next.parameters = { ...(next.parameters || {}), watermark: false };

    return next;
  }

  private buildHappyhorseCreditRequestParams(
    body: any,
    model: string,
  ): Record<string, any> {
    const parameters =
      body?.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
        ? body.parameters
        : {};
    const resolution =
      typeof parameters.resolution === 'string' && parameters.resolution.trim().length > 0
        ? parameters.resolution.trim().toUpperCase()
        : '720P'; // 鑺傜偣榛樿锛涗笌鑺傜偣 UI 榛樿涓€鑷?
        const durationRaw = Number(parameters.duration);
    const duration =
      Number.isFinite(durationRaw) && durationRaw > 0
        ? Math.min(15, Math.max(3, Math.round(durationRaw)))
        : 5;

    // 鐢?model 鍚庣紑娲剧敓 generationMode
    const generationMode =
      model === 'happyhorse-1.0-t2v'
        ? 't2v'
        : model === 'happyhorse-1.0-i2v'
          ? 'i2v'
          : model === 'happyhorse-1.0-video-edit'
            ? 'video-edit'
            : 'r2v';

    const mediaItems: Array<Record<string, unknown>> = Array.isArray(body?.input?.media)
      ? body.input.media.filter(
          (m: any) => m && typeof m === 'object' && typeof m.url === 'string',
        )
      : [];
    const referenceImageUrls = mediaItems
      .filter((m) => m.type !== 'video')
      .map((m) => m.url as string);
    const referenceVideoUrls = mediaItems
      .filter((m) => m.type === 'video')
      .map((m) => m.url as string);

    return {
      managedModelKey: model,
      modelKey: model,
      vendorKey: 'dashscope',
      platformKey: 'dashscope',
      aiProvider: 'dashscope',
      generationMode,
      resolution,
      duration,
      durationSec: duration,
      referenceImageCount: referenceImageUrls.length,
      referenceVideoCount: referenceVideoUrls.length,
      ...this.buildRequestPromptAndImageParams(
        body?.input?.prompt,
        referenceImageUrls,
      ),
    };
  }

  private async fetchImageAsDataUrl(imageUrl: string): Promise<string> {
    const parsed = this.parseAndValidateAllowedImageUrl(imageUrl);
    const candidates = this.buildImageFetchCandidates(parsed);
    const maxBytes = 30 * 1024 * 1024;
    const errors: string[] = [];

    for (const candidateUrl of candidates) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch(candidateUrl, {
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          errors.push(
            `${candidateUrl} -> HTTP ${response.status}${
              text ? ` ${text}` : ''
            }`.trim(),
          );
          continue;
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        if (!contentType.startsWith('image/')) {
          errors.push(`${candidateUrl} -> invalid content-type: ${contentType}`);
          continue;
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength && contentLength > maxBytes) {
          throw new BadRequestException('鍥剧墖鏂囦欢杩囧ぇ锛岃浣跨敤鏇村皬鐨勫浘鐗囷紙鏈€澶?30MB锛?');
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes) {
          throw new BadRequestException('鍥剧墖鏂囦欢杩囧ぇ锛岃浣跨敤鏇村皬鐨勫浘鐗囷紙鏈€澶?30MB锛?');
        }

        const base64 = buffer.toString('base64');
        return `data:${contentType};base64,${base64}`;
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          errors.push(`${candidateUrl} -> timeout`);
          continue;
        }
        const summary = this.summarizeError(error);
        errors.push(`${candidateUrl} -> ${summary}`);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    this.logger.error(
      `[fetchImageAsDataUrl] all candidates failed for ${imageUrl}: ${errors.join(' | ')}`,
    );
    throw new BadGatewayException('鍥剧墖璧勬簮涓嶅彲璁块棶锛岃纭鍥剧墖閾炬帴鏈夋晥涓旀湇鍔＄鍙闂?');
  }

  private resolveTextModel(providerName: string | null, requestedModel?: string): string {
    const model = requestedModel?.trim();
    if (model?.length) {
      this.logger.debug(`[${providerName || 'default'}] Using requested text model: ${model}`);
      return model;
    }
    if (providerName) {
      return this.providerDefaultTextModels[providerName] || 'gemini-3.1-pro';
    }
    return this.providerDefaultTextModels.gemini;
  }

  private hasVectorIntent(prompt: string): boolean {
    if (!prompt) return false;
    const lower = prompt.toLowerCase();
    const keywords = [
      '鐭㈤噺',
      '鐭㈤噺鍥?',
      '鐭㈤噺鍖?',
      'vector',
      'vectorize',
      'vectorization',
      'svg',
      'paperjs',
      'paper.js',
      'svg path',
      '璺緞浠ｇ爜',
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

    // 馃敟 娣诲姞璇︾粏鏃ュ織
    this.logger.log('馃幆 Tool selection request:', {
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
          // 宸ュ叿閫夋嫨灞炰簬鏂囨湰鎺ㄧ悊锛屼紭鍏堜娇鐢ㄦ枃鏈ā鍨嬮摼璺?
          const normalizedModel = this.resolveTextModel(providerName, dto.model);

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
          providerOptions: (dto as any).providerOptions,
        });

          if (result.success && result.data) {
            const selectedTool = this.enforceSelectedTool(result.data.selectedTool, availableTools);
            this.logger.log(`鉁?[${providerName.toUpperCase()}] Tool selected: ${selectedTool}`);
            return {
              selectedTool,
              parameters: { prompt: dto.prompt },
              reasoning: result.data.reasoning,
              confidence: result.data.confidence,
            };
          }

          const message = result.error?.message ?? 'provider returned an error response';
          this.logger.warn(`鈿狅笍 [${providerName.toUpperCase()}] provider responded with error: ${message}`);
          throw new ServiceUnavailableException(
            `[${providerName}] tool selection failed: ${message}`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`鈿狅笍 [${providerName.toUpperCase()}] provider threw exception: ${message}`);
          throw new ServiceUnavailableException(
            `[${providerName}] tool selection failed: ${message}`
          );
        }
      }

      // 馃敟 闄嶇骇鍒癎oogle Gemini杩涜宸ュ叿閫夋嫨
      this.logger.log('馃搳 Falling back to Gemini tool selection');
      const result = await this.ai.runToolSelectionPrompt(dto.prompt, availableTools);
      const selectedTool = this.enforceSelectedTool(result.selectedTool, availableTools);

      this.logger.log('鉁?[GEMINI] Tool selected:', selectedTool);
      return {
        selectedTool,
        parameters: { prompt: dto.prompt },
        reasoning: result.reasoning,
        confidence: result.confidence,
      };
    }, undefined, undefined, true, this.buildCreditRequestParams(providerName));
  }

  @Post('generate-image')
  async generateImage(@Body() dto: GenerateImageDto, @Req() req: any): Promise<GenerateImageUrlResult> {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const generationTaskId = `sync-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);

    const requestedProviderName =
      dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    // 鑱旂綉寮€鍏冲紑鍚椂锛孶ltra(147) 鑷姩鍒囨崲鍒?Nano2(Apimart) 鐢熷浘閾捐矾銆?
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
    const normalizedImageUrlsForProvider = this.normalizeImageUrlsForUpstream(
      (dto.imageUrls || []).filter(
        (url): url is string =>
          typeof url === 'string' && url.trim().length > 0,
      ),
    );

    // 妫€鏌ユ槸鍚︿娇鐢ㄨ嚜瀹氫箟 API Key锛坓emini 鍜?gemini-pro 閮芥敮鎸侊級
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;
    const requestedOutputImageCount =
      dto.batchMode && Number.isFinite(Number(dto.batchCount))
        ? Math.max(1, Math.min(10, Math.floor(Number(dto.batchCount))))
        : 1;

    void this.telemetryService.ingestGenerationTask({
      traceId,
      parentRequestId,
      taskId: generationTaskId,
      taskType: 'image-generate',
      stage: 'queued',
      userId,
      provider: providerName || 'gemini',
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: {
        model,
        serviceType,
        skipCredits,
        imageOnly: Boolean(dto.imageOnly),
        aspectRatio: dto.aspectRatio || null,
        imageSize: dto.imageSize || null,
        enableWebSearch: Boolean(dto.enableWebSearch),
        inputImageCount: normalizedImageUrlsForProvider.length,
      },
      receivedAt: new Date().toISOString(),
    });

    try {
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-generate',
        stage: 'processing',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'processing',
        metadata: {
          model,
          serviceType,
        },
        receivedAt: new Date().toISOString(),
      });

      const result = await this.withCredits(req, serviceType, model, async () => {
        const maxAttempts = 3;
        const retryDelaysMs = [500, 1200];

        const shouldRetryOutputError = (error: unknown): boolean => {
          if (error instanceof HttpException) {
            return error.getStatus() === 502;
          }

          const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
          if (!message) return false;

          const retryablePatterns = [
            '鐢熸垚鍥惧儚鏁版嵁涓虹┖',
            '鏃犲浘鍍忔暟鎹?',
            'no image data',
            'stream api returned no image data',
            'not supported',
            '涓嶆槸鍙楁敮鎸佺殑鍥剧墖鏍煎紡',
            'base64',
          ];
          return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            if (attempt > 1) {
              this.logger.warn(`[generate-image] 閲嶈瘯鐢熸垚绗?${attempt}/${maxAttempts} 娆);
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
                imageUrls: normalizedImageUrlsForProvider.length
                  ? normalizedImageUrlsForProvider
                  : undefined,
                googleSearch: dto.googleSearch ?? dto.enableWebSearch,
                googleImageSearch: dto.googleImageSearch ?? dto.enableWebSearch,
                batchMode: dto.batchMode,
                batchCount: dto.batchCount,
              });

              if (result.success && result.data) {
                const responseMetadata: Record<string, any> = {
                  ...(result.data.metadata || {}),
                  ...(dto.enableWebSearch ? { webSearchEnabled: true } : {}),
                };

                // 濡傛灉鏈?imageData锛屼笂浼犲埌 OSS
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

                const providerImageUrls = this.collectProviderImageUrls(result.data);
                if (providerImageUrls.length > 0) {
                  try {
                    const managedResults = await Promise.all(
                      providerImageUrls.map((url) =>
                        this.persistProviderImageUrlToManaged(url, req, userId),
                      ),
                    );
                    const managedImageUrls = managedResults
                      .map((item) => item.url)
                      .filter((item): item is string => Boolean(item));

                    if (managedImageUrls.length === 0) {
                      throw new Error('managed image url list is empty');
                    }

                    const primaryImageUrl = managedImageUrls[0];
                    const firstUploaded = managedResults.find((item) => item.uploaded);
                    return {
                      imageUrl: primaryImageUrl,
                      textResponse: result.data.textResponse || '',
                      metadata: {
                        ...responseMetadata,
                        imageUrl: primaryImageUrl,
                        imageUrls: managedImageUrls,
                        sourceImageUrl: providerImageUrls[0],
                        sourceImageUrls: providerImageUrls,
                        ...(firstUploaded
                          ? {
                              imageKey: firstUploaded.key,
                              mimeType: firstUploaded.mimeType,
                              bytes: firstUploaded.bytes,
                            }
                          : {}),
                      },
                    };
                  } catch (error) {
                    this.logger.error(
                      `[generate-image] 澶栭摼鍥剧墖澶勭悊澶辫触: ${this.summarizeError(error)}`
                    );
                    throw new BadGatewayException(
                      '澶栭摼鍥剧墖澶勭悊澶辫触锛岃绋嶅悗閲嶈瘯锛堝繀瑕佹椂璇烽厤缃?ALLOWED_PROXY_HOSTS锛屾垨妫€鏌ヤ笂娓?URL 鏄惁鍙闂級'
                    );
                  }
                }
              }
              throw new Error(result.error?.message || 'Failed to generate image');
            }

            // gemini 鍜?gemini-pro 閮戒娇鐢ㄩ粯璁ょ殑 Gemini 鏈嶅姟
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
                `[generate-image] 绗?${attempt}/${maxAttempts} 娆″け璐ワ紙${this.summarizeError(error)}锛夛紝${delay}ms 鍚庨噸璇昤
              );
              if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
              continue;
            }
            throw error;
          }
        }

        throw new InternalServerErrorException('鍥剧墖鐢熸垚閲嶈瘯娆℃暟鑰楀敖锛岃绋嶅悗閲嶈瘯銆?');
      }, 0, requestedOutputImageCount, skipCredits, this.buildCreditRequestParams(providerName, {
        imageSize: dto.imageSize,
        quality: dto.quality,
        aspectRatio: dto.aspectRatio,
        outputImageCount: requestedOutputImageCount,
        parallelGroupId: dto.parallelGroupId,
        parallelGroupIndex: dto.parallelGroupIndex,
        parallelGroupTotal: dto.parallelGroupTotal,
        nodeConfigKey: dto.nodeConfigKey,
        nodeConfigNameZh: dto.nodeConfigNameZh,
        nodeConfigNameEn: dto.nodeConfigNameEn,
        ...this.buildRequestPromptAndImageParams(dto.prompt, normalizedImageUrlsForProvider),
      }, dto.providerOptions), {
        validateSuccessResult: (payload) => ({
          ok: this.hasImagePayload(payload),
          message: 'Image generation succeeded but no image payload returned',
        }),
      });

      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-generate',
        stage: 'succeeded',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        metadata: {
          model,
          serviceType,
          imageUrl: result.imageUrl,
          hasTextResponse: Boolean(result.textResponse),
        },
        receivedAt: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[generate-image] 澶辫触: ${errorMessage}`);
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-generate',
        stage: 'failed',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        metadata: {
          model,
          serviceType,
        },
        receivedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  @Post('edit-image')
  async editImage(@Body() dto: EditImageDto, @Req() req: any): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const generationTaskId = `sync-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 妫€鏌ユ槸鍚︿娇鐢ㄨ嚜瀹氫箟 API Key锛坓emini 鍜?gemini-pro 閮芥敮鎸侊級
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    // 鏍规嵁妯″瀷閫夋嫨鏈嶅姟绫诲瀷锛欶ast (2.5) / Nano banana 2 (3.1) / Pro
    const serviceType = model?.includes('2.5')
      ? 'gemini-2.5-image-edit'
      : model?.includes('3.1')
      ? 'gemini-3.1-image-edit'
      : 'gemini-image-edit';
    const requestUserId = this.resolveRequestUserId(req) || 'anonymous';
    const bananaImageMode = this.isBananaProviderName(providerName)
      ? await this.getBananaImageProviderMode(dto.providerOptions)
      : 'auto';
    const tencentForcedBanana =
      this.isBananaProviderName(providerName) && bananaImageMode === 'tencent';
    if (tencentForcedBanana) {
      this.logger.log(
        '[edit-image] banana_provider=tencent detected, preparing Tencent-compatible source image',
      );
    }
    console.log(`\n========== [editImage] ==========`);
    console.log(`dto.model: ${dto.model}`);
    console.log(`resolved model: ${model}`);
    console.log(`serviceType: ${serviceType}`);
    console.log(`=================================\n`);

    void this.telemetryService.ingestGenerationTask({
      traceId,
      parentRequestId,
      taskId: generationTaskId,
      taskType: 'image-edit',
      stage: 'queued',
      userId,
      provider: providerName || 'gemini',
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: { model, serviceType, skipCredits, imageSize: dto.imageSize || null },
      receivedAt: new Date().toISOString(),
    });

    try {
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-edit',
        stage: 'processing',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'processing',
        metadata: { model, serviceType },
        receivedAt: new Date().toISOString(),
      });

      const result = await this.withCredits(req, serviceType as any, model, async () => {
      const maxAttempts = 3;
      const retryDelaysMs = [500, 1200];

      const shouldRetryOutputError = (error: unknown): boolean => {
        if (error instanceof HttpException) {
          return error.getStatus() === 502;
        }

        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (!message) return false;

        const retryablePatterns = [
          '缂栬緫鎴愬姛浣嗘湭杩斿洖鍥剧墖鏁版嵁',
          '鐢熸垚鍥惧儚鏁版嵁涓虹┖',
          '鏃犲浘鍍忔暟鎹?',
          'no image data',
          'stream api returned no image data',
          'not supported',
          '涓嶆槸鍙楁敮鎸佺殑鍥剧墖鏍煎紡',
          'base64',
        ];
        return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) {
            this.logger.warn(`[edit-image] 閲嶈瘯缂栬緫绗?${attempt}/${maxAttempts} 娆);
          }

          const fallbackUrl =
            !dto.sourceImageUrl && dto.sourceImage && /^https?:\/\//i.test(dto.sourceImage)
              ? dto.sourceImage
              : dto.sourceImageUrl;

          // MJ 鏀寔鐩存帴浣跨敤 URL锛屼笉闇€瑕佽浆鎹负 base64
          const isMidjourney = providerName === 'midjourney';

          let sourceImage: string | undefined;
          if (tencentForcedBanana) {
            if (dto.sourceImage && !fallbackUrl) {
              sourceImage = dto.sourceImage;
            } else if (fallbackUrl) {
              sourceImage = fallbackUrl;
            }
          } else if (isMidjourney && fallbackUrl) {
            // MJ: 鐩存帴浣跨敤 URL
            sourceImage = fallbackUrl;
          } else if (dto.sourceImage && !fallbackUrl) {
            sourceImage = dto.sourceImage;
          } else if (fallbackUrl) {
            sourceImage = await this.fetchImageAsDataUrl(fallbackUrl);
          }

          if (!sourceImage) {
            throw new BadRequestException('缂栬緫鍥剧墖鎺ュ彛闇€瑕佹彁渚?sourceImage 鎴?sourceImageUrl');
          }

          if (tencentForcedBanana) {
            sourceImage = await this.normalizeSourceImageForTencentForced(
              sourceImage,
              requestUserId,
              'edit-image',
            );
          } else if (!isMidjourney || !sourceImage.startsWith('http')) {
            // 闈?MJ 鏃堕獙璇?sourceImage 鏄湁鏁堢殑鍥剧墖鏍煎紡
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

              const providerImageUrls = this.collectProviderImageUrls(result.data);
              const providerImageUrl = providerImageUrls[0];
              if (!providerImageUrl) {
                throw new BadGatewayException('缂栬緫鎴愬姛浣嗘湭杩斿洖鍥剧墖鏁版嵁');
              }

              const sourceImageDataUrl = await this.fetchImageAsDataUrl(providerImageUrl);
              const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
              return {
                imageData: watermarked,
                textResponse: result.data.textResponse || '',
                metadata: {
                  ...(result.data.metadata || {}),
                  sourceImageUrl: providerImageUrl,
                  sourceImageUrls: providerImageUrls,
                },
              };
            }
            throw new Error(result.error?.message || 'Failed to edit image');
          }

          // gemini 鍜?gemini-pro 閮戒娇鐢ㄩ粯璁ょ殑 Gemini 鏈嶅姟
          const data = await this.imageGeneration.editImage({ ...dto, sourceImage, customApiKey });
          const watermarked = await this.watermarkIfNeeded(data.imageData, req);
          return { ...data, imageData: watermarked };
        } catch (error) {
          if (attempt < maxAttempts && shouldRetryOutputError(error)) {
            const delay =
              retryDelaysMs[attempt - 1] ??
              retryDelaysMs[retryDelaysMs.length - 1] ??
              0;
            this.logger.warn(
              `[edit-image] 绗?${attempt}/${maxAttempts} 娆″け璐ワ紙${this.summarizeError(error)}锛夛紝${delay}ms 鍚庨噸璇昤
            );
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            continue;
          }
          throw error;
        }
      }

      throw new InternalServerErrorException('鍥剧墖缂栬緫閲嶈瘯娆℃暟鑰楀敖锛岃绋嶅悗閲嶈瘯銆?');
      }, 1, 1, skipCredits, this.buildCreditRequestParams(providerName, {
        imageSize: dto.imageSize,
        aspectRatio: dto.aspectRatio,
        parallelGroupId: dto.parallelGroupId,
        parallelGroupIndex: dto.parallelGroupIndex,
        parallelGroupTotal: dto.parallelGroupTotal,
        nodeConfigKey: dto.nodeConfigKey,
        nodeConfigNameZh: dto.nodeConfigNameZh,
        nodeConfigNameEn: dto.nodeConfigNameEn,
        ...this.buildRequestPromptAndImageParams(dto.prompt, [
          dto.sourceImageUrl,
          dto.sourceImage && /^https?:\/\//i.test(dto.sourceImage) ? dto.sourceImage : undefined,
        ]),
      }, dto.providerOptions), {
        validateSuccessResult: (payload) => ({
          ok: this.hasImagePayload(payload),
          message: 'Image edit succeeded but no image payload returned',
        }),
      });

      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-edit',
        stage: 'succeeded',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        metadata: { model, serviceType, hasImageData: Boolean(result?.imageData) },
        receivedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-edit',
        stage: 'failed',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        metadata: { model, serviceType },
        receivedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  @Post('blend-images')
  async blendImages(@Body() dto: BlendImagesDto, @Req() req: any): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const generationTaskId = `sync-blend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 妫€鏌ユ槸鍚︿娇鐢ㄨ嚜瀹氫箟 API Key锛坓emini 鍜?gemini-pro 閮芥敮鎸侊級
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    // 鏍规嵁妯″瀷閫夋嫨鏈嶅姟绫诲瀷锛欶ast (2.5) / Nano banana 2 (3.1) / Pro
    const serviceType = model?.includes('2.5')
      ? 'gemini-2.5-image-blend'
      : model?.includes('3.1')
      ? 'gemini-3.1-image-blend'
      : 'gemini-image-blend';
    const requestUserId = this.resolveRequestUserId(req) || 'anonymous';
    const bananaImageMode = this.isBananaProviderName(providerName)
      ? await this.getBananaImageProviderMode(dto.providerOptions)
      : 'auto';
    const tencentForcedBanana =
      this.isBananaProviderName(providerName) && bananaImageMode === 'tencent';
    if (tencentForcedBanana) {
      this.logger.log(
        '[blend-images] banana_provider=tencent detected, preparing Tencent-compatible source images',
      );
    }

    void this.telemetryService.ingestGenerationTask({
      traceId,
      parentRequestId,
      taskId: generationTaskId,
      taskType: 'image-blend',
      stage: 'queued',
      userId,
      provider: providerName || 'gemini',
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: { model, serviceType, skipCredits, imageSize: dto.imageSize || null },
      receivedAt: new Date().toISOString(),
    });

    try {
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-blend',
        stage: 'processing',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'processing',
        metadata: { model, serviceType },
        receivedAt: new Date().toISOString(),
      });

      const result = await this.withCredits(req, serviceType as any, model, async () => {
      const maxAttempts = 3;
      const retryDelaysMs = [500, 1200];

      const shouldRetryOutputError = (error: unknown): boolean => {
        if (error instanceof HttpException) {
          return error.getStatus() === 502;
        }

        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (!message) return false;

        const retryablePatterns = [
          '铻嶅悎鎴愬姛浣嗘湭杩斿洖鍥剧墖鏁版嵁',
          '鐢熸垚鍥惧儚鏁版嵁涓虹┖',
          '鏃犲浘鍍忔暟鎹?',
          'no image data',
          'stream api returned no image data',
          'not supported',
          '涓嶆槸鍙楁敮鎸佺殑鍥剧墖鏍煎紡',
          'base64',
        ];
        return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) {
            this.logger.warn(`[blend-images] 閲嶈瘯铻嶅悎绗?${attempt}/${maxAttempts} 娆);
          }

          const sourceImages = tencentForcedBanana
            ? dto.sourceImages?.length
              ? dto.sourceImages
              : dto.sourceImageUrls?.length
              ? dto.sourceImageUrls
              : []
            : dto.sourceImages?.length
            ? await Promise.all(
                dto.sourceImages.map(async (value) =>
                  /^https?:\/\//i.test(value) ? this.fetchImageAsDataUrl(value) : value,
                ),
              )
            : dto.sourceImageUrls?.length
            ? await Promise.all(dto.sourceImageUrls.map((url) => this.fetchImageAsDataUrl(url)))
            : [];

          if (!sourceImages.length) {
            throw new BadRequestException('铻嶅悎鍥剧墖鎺ュ彛闇€瑕佹彁渚?sourceImages 鎴?sourceImageUrls锛堣嚦灏戜袱寮狅級');
          }

          const normalizedSourceImages = tencentForcedBanana
            ? await Promise.all(
                sourceImages.map((value, index) =>
                  this.normalizeSourceImageForTencentForced(
                    value,
                    requestUserId,
                    `blend-images#${index + 1}`,
                  ),
                ),
              )
            : sourceImages;

          if (providerName && providerName !== 'gemini-pro') {
            const provider = this.factory.getProvider(dto.model, providerName);
            const result = await provider.blendImages({
              prompt: dto.prompt,
              sourceImages: normalizedSourceImages,
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

              const providerImageUrls = this.collectProviderImageUrls(result.data);
              const providerImageUrl = providerImageUrls[0];
              if (!providerImageUrl) {
                throw new BadGatewayException('铻嶅悎鎴愬姛浣嗘湭杩斿洖鍥剧墖鏁版嵁');
              }

              const sourceImageDataUrl = await this.fetchImageAsDataUrl(providerImageUrl);
              const watermarked = await this.watermarkIfNeeded(sourceImageDataUrl, req);
              return {
                imageData: watermarked,
                textResponse: result.data.textResponse || '',
                metadata: {
                  ...(result.data.metadata || {}),
                  sourceImageUrl: providerImageUrl,
                  sourceImageUrls: providerImageUrls,
                },
              };
            }
            throw new Error(result.error?.message || 'Failed to blend images');
          }

          // gemini 鍜?gemini-pro 閮戒娇鐢ㄩ粯璁ょ殑 Gemini 鏈嶅姟
          const data = await this.imageGeneration.blendImages({
            ...dto,
            sourceImages: normalizedSourceImages,
            customApiKey,
          });
          const watermarked = await this.watermarkIfNeeded(data.imageData, req);
          return { ...data, imageData: watermarked };
        } catch (error) {
          if (attempt < maxAttempts && shouldRetryOutputError(error)) {
            const delay =
              retryDelaysMs[attempt - 1] ??
              retryDelaysMs[retryDelaysMs.length - 1] ??
              0;
            this.logger.warn(
              `[blend-images] 绗?${attempt}/${maxAttempts} 娆″け璐ワ紙${this.summarizeError(error)}锛夛紝${delay}ms 鍚庨噸璇昤
            );
            if (delay > 0) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
            continue;
          }
          throw error;
        }
      }

      throw new InternalServerErrorException('鍥剧墖铻嶅悎閲嶈瘯娆℃暟鑰楀敖锛岃绋嶅悗閲嶈瘯銆?');
      }, dto.sourceImages?.length || 0, 1, skipCredits, this.buildCreditRequestParams(providerName, {
        imageSize: dto.imageSize,
        aspectRatio: dto.aspectRatio,
        parallelGroupId: dto.parallelGroupId,
        parallelGroupIndex: dto.parallelGroupIndex,
        parallelGroupTotal: dto.parallelGroupTotal,
        nodeConfigKey: dto.nodeConfigKey,
        nodeConfigNameZh: dto.nodeConfigNameZh,
        nodeConfigNameEn: dto.nodeConfigNameEn,
        ...this.buildRequestPromptAndImageParams(dto.prompt, [
          ...(Array.isArray(dto.sourceImageUrls) ? dto.sourceImageUrls : []),
          ...(Array.isArray(dto.sourceImages) ? dto.sourceImages : []),
        ]),
      }, dto.providerOptions), {
        validateSuccessResult: (payload) => ({
          ok: this.hasImagePayload(payload),
          message: 'Image blend succeeded but no image payload returned',
        }),
      });

      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-blend',
        stage: 'succeeded',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        metadata: { model, serviceType, hasImageData: Boolean(result?.imageData) },
        receivedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-blend',
        stage: 'failed',
        userId,
        provider: providerName || 'gemini',
        prompt: dto.prompt?.slice(0, 500) || null,
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        metadata: { model, serviceType },
        receivedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  @Post('midjourney/action')
  async midjourneyAction(@Body() dto: MidjourneyActionDto, @Req() req: any): Promise<ImageGenerationResult> {
    return this.withCredits(req, 'midjourney-variation', 'midjourney-fast', async () => {
      const provider = this.factory.getProvider('midjourney-fast', 'midjourney');
      if (!(provider instanceof MidjourneyProvider)) {
        throw new ServiceUnavailableException('MJ 鏈嶅姟鏆備笉鍙敤锛岃妫€鏌ヨ处鍙烽厤缃?');
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
        throw new ServiceUnavailableException('MJ 鏈嶅姟鏆備笉鍙敤锛岃妫€鏌ヨ处鍙烽厤缃?');
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
    const model = this.resolveAnalyzeModel(providerName, dto.model);
    const normalizedImages = Array.from(
      new Set(
        [
          ...(Array.isArray(dto.sourceImages) ? dto.sourceImages : []),
          ...(typeof dto.sourceImage === 'string' ? [dto.sourceImage] : []),
        ]
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0),
      ),
    );
    if (normalizedImages.length === 0) {
      throw new BadRequestException('鍒嗘瀽鍥剧墖鎺ュ彛闇€瑕佹彁渚?sourceImage 鎴?sourceImages');
    }
    const primarySourceImage = normalizedImages[0];

    // 妫€鏌ユ槸鍚︿娇鐢ㄨ嚜瀹氫箟 API Key锛坓emini 鍜?gemini-pro 閮芥敮鎸侊級
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    // Map analyze billing by provider tier: Fast(2.5), Pro(3.0), Ultra(3.1).
    const serviceType: ServiceType =
      providerName === 'banana-2.5'
        ? 'gemini-2.5-image-analyze'
        : providerName === 'banana-3.1' || providerName === 'nano2'
        ? 'gemini-3.1-image-analyze'
        : 'gemini-image-analyze';

    return this.withCredits(req, serviceType as any, model, async () => {
      if (providerName && providerName !== 'gemini-pro') {
        const provider = this.factory.getProvider(dto.model, providerName);
        const result = await provider.analyzeImage({
          prompt: dto.prompt,
          sourceImage: primarySourceImage,
          sourceImages: normalizedImages,
          model,
          providerOptions: dto.providerOptions,
        });
        if (result.success && result.data) {
          const text =
            typeof result.data.text === 'string' ? result.data.text.trim() : '';
          if (!text) {
            throw new ServiceUnavailableException(
              'Analysis returned empty response, please try again later',
            );
          }
          return {
            text,
          };
        }
        throw new Error(result.error?.message || 'Failed to analyze image');
      }

      // gemini 鍜?gemini-pro 閮戒娇鐢ㄩ粯璁ょ殑 Gemini 鏈嶅姟
      const result = await this.imageGeneration.analyzeImage({
        ...dto,
        sourceImage: primarySourceImage,
        sourceImages: normalizedImages,
        customApiKey,
      });
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (!text) {
        throw new ServiceUnavailableException(
          'Analysis returned empty response, please try again later',
        );
      }
      return { text };
    }, normalizedImages.length, 0, skipCredits, this.buildCreditRequestParams(providerName, {
      ...this.buildRequestPromptAndImageParams(dto.prompt, normalizedImages),
    }, dto.providerOptions));
  }

  @Post('text-chat')
  async textChat(@Body() dto: TextChatDto, @Req() req: any) {
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);
    const billingTag = dto.billingTag === 'prompt_optimize' ? 'prompt_optimize' : 'text_chat';
    const serviceType: ServiceType =
      billingTag === 'prompt_optimize' ? 'gemini-prompt-optimize' : 'gemini-text';

    // 妫€鏌ユ槸鍚︿娇鐢ㄨ嚜瀹氫箟 API Key锛坓emini 鍜?gemini-pro 閮芥敮鎸侊級
    const customApiKey = this.isGeminiProvider(providerName) ? await this.getUserCustomApiKey(req) : null;
    const skipCredits = !!customApiKey;

    return this.withCredits(req, serviceType, model, async () => {
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
            webSearchResult: result.data.webSearchResult,
            metadata: result.data.metadata,
          };
        }
        throw new Error(result.error?.message || 'Failed to generate text');
      }

      // gemini 鍜?gemini-pro 閮戒娇鐢ㄩ粯璁ょ殑 Gemini 鏈嶅姟
      return this.imageGeneration.generateTextResponse({ ...dto, customApiKey });
    }, undefined, undefined, skipCredits, this.buildCreditRequestParams(providerName, {
      billingTag,
      model,
      requestedProvider: dto.aiProvider,
      ...this.buildRequestPromptAndImageParams(dto.prompt),
    }, dto.providerOptions));
  }

  @Post('remove-background')
  async removeBackground(@Body() dto: RemoveBackgroundDto, @Req() req: any) {
    this.logger.log('馃幆 Background removal request received');

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

      this.logger.log('鉁?Background removal succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    }, 1, 1);
  }

  // 寮€鍙戞ā寮忥細鏃犻渶璁よ瘉鐨勬姞鍥炬帴鍙?  @Post('remove-background-public')
  async removeBackgroundPublic(@Body() dto: RemoveBackgroundDto) {
    this.logger.log('馃幆 Background removal (public) request received');

    try {
      const source = dto.source || 'base64';
      let imageData: string;

      if (source === 'url') {
        imageData = await this.backgroundRemoval.removeBackgroundFromUrl(dto.imageData);
      } else if (source === 'file') {
        imageData = await this.backgroundRemoval.removeBackgroundFromFile(dto.imageData);
      } else {
        // 榛樿涓篵ase64
        imageData = await this.backgroundRemoval.removeBackgroundFromBase64(
          dto.imageData,
          dto.mimeType
        );
      }

      this.logger.log('鉁?Background removal (public) succeeded');

      return {
        success: true,
        imageData,
        format: 'png',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('鉂?Background removal (public) failed:', message);
      throw new ServiceUnavailableException({
        success: false,
        error: message,
      });
    }
  }

  @Get('background-removal-info')
  async getBackgroundRemovalInfo() {
    this.logger.log('馃搳 Background removal info requested');
    const info = await this.backgroundRemoval.getInfo();
    return info;
  }

  @Post('convert-2d-to-3d')
  async convert2Dto3D(@Body() dto: Convert2Dto3DDto, @Req() req: any) {
    this.logger.log('馃帹 2D to 3D conversion request received');

    return this.withCredits(req, 'convert-2d-to-3d', undefined, async () => {
      const userId = req?.user?.id || req?.user?.userId || req?.user?.sub;
      const normalizedImageUrl = this.normalizeImageUrlForUpstream(dto.imageUrl || '');
      const normalizedPrompt = typeof dto.prompt === 'string' ? dto.prompt.trim() : '';
      if (!normalizedImageUrl && !normalizedPrompt) {
        throw new BadRequestException('Either imageUrl or prompt is required');
      }
      const result = await this.convert2Dto3DService.convert2Dto3D({
        imageUrl: normalizedImageUrl || undefined,
        prompt: normalizedPrompt || undefined,
        model: dto.model,
        lowPoly: dto.lowPoly,
        sketch: dto.sketch,
        projectId: dto.projectId,
        userId: typeof userId === 'string' ? userId : undefined,
      });

      return {
        success: true,
        modelUrl: result.modelUrl,
        promptId: result.promptId,
        modelKey: result.modelKey,
      };
    }, 1, 1);
  }

  @Post('expand-image')
  async expandImage(@Body() dto: ExpandImageDto, @Req() req: any) {
    this.logger.log('馃柤锔?Expand image request received');
    const startTime = Date.now();
    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const generationTaskId = `sync-expand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);

    void this.telemetryService.ingestGenerationTask({
      traceId,
      parentRequestId,
      taskId: generationTaskId,
      taskType: 'image-expand',
      stage: 'queued',
      userId,
      provider: 'expand-image',
      prompt: dto.prompt?.slice(0, 500) || '鎵╁浘',
      status: 'queued',
      metadata: {
        expandRatios: Array.isArray(dto.expandRatios) ? dto.expandRatios : null,
      },
      receivedAt: new Date().toISOString(),
    });

    try {
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-expand',
        stage: 'processing',
        userId,
        provider: 'expand-image',
        prompt: dto.prompt?.slice(0, 500) || '鎵╁浘',
        status: 'processing',
        receivedAt: new Date().toISOString(),
      });

      const result = await this.withCredits(req, 'expand-image', undefined, async () => {
      const normalizedImageUrl = this.normalizeImageUrlForUpstream(dto.imageUrl);
      const expanded = await this.expandImageService.expandImage(
        normalizedImageUrl,
        dto.expandRatios,
        dto.prompt || '鎵╁浘'
      );

      const managed = await this.persistProviderImageUrlToManaged(
        expanded.imageUrl,
        req,
        userId,
      );

      return {
        success: true,
        imageUrl: managed.url,
        promptId: expanded.promptId,
        metadata: {
          sourceImageUrl: managed.sourceImageUrl,
          uploadedToManaged: managed.uploaded,
          imageKey: managed.key,
          mimeType: managed.mimeType,
          bytes: managed.bytes,
        },
      };
      }, 1, 1);

      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-expand',
        stage: 'succeeded',
        userId,
        provider: 'expand-image',
        prompt: dto.prompt?.slice(0, 500) || '鎵╁浘',
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        metadata: {
          imageUrl: result.imageUrl,
          promptId: result.promptId,
        },
        receivedAt: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void this.telemetryService.ingestGenerationTask({
        traceId,
        parentRequestId,
        taskId: generationTaskId,
        taskType: 'image-expand',
        stage: 'failed',
        userId,
        provider: 'expand-image',
        prompt: dto.prompt?.slice(0, 500) || '鎵╁浘',
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        receivedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  @Post('generate-video')
  async generateVideo(@Body() dto: GenerateVideoDto, @Req() req: any) {
    const quality = dto.quality === 'sd' ? 'sd' : 'hd';
    const serviceType: ServiceType = quality === 'sd' ? 'sora-sd' : 'sora-hd';
    const selectedSoraModel =
      dto.model === 'sora-2' || dto.model === 'sora-2-pro'
        ? dto.model
        : quality === 'hd'
        ? 'sora-2-pro'
        : 'sora-2';
    const normalizedArray =
      dto.referenceImageUrls?.filter((url) => typeof url === 'string' && url.trim().length > 0) ||
      [];
    const legacySingle = dto.referenceImageUrl?.trim();
    const referenceImageUrlsRaw = legacySingle
      ? [...normalizedArray, legacySingle]
      : normalizedArray;
    const referenceImageUrls = this.normalizeImageUrlsForUpstream(referenceImageUrlsRaw);
    const hasCharacterMode =
      (typeof dto.characterTaskId === 'string' && dto.characterTaskId.trim().length > 0) ||
      (typeof dto.characterUrl === 'string' && dto.characterUrl.trim().length > 0);
    const effectiveReferenceImageUrls = hasCharacterMode ? [] : referenceImageUrls;
    const inputImageCount = effectiveReferenceImageUrls.length || undefined;

    this.logger.log(
      `Video generation request received (quality=${quality}, referenceCount=${effectiveReferenceImageUrls.length}, characterMode=${hasCharacterMode})`,
    );
    this.logger.log(`Video generation full dto: ${JSON.stringify(dto)}`);
    if (hasCharacterMode && referenceImageUrls.length > 0) {
      this.logger.warn(
        `Sora2 character mode detected: ignore ${referenceImageUrls.length} reference image(s)`,
      );
    }

    const soraRequestParams = await this.buildSora2CreditParams({
      selectedSoraModel,
      quality,
      aspectRatio: dto.aspectRatio,
      duration: dto.duration,
    });

    return this.withCredits(
      req,
      serviceType,
      selectedSoraModel,
      async () => {
        const result = await this.sora2VideoService.generateVideo({
          prompt: dto.prompt,
          referenceImageUrls: effectiveReferenceImageUrls,
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
            result?.fallbackMessage || result?.content || '瑙嗛鐢熸垚澶辫触锛氭湭杩斿洖鍙敤瑙嗛閾炬帴',
          );
        }

        const skipWatermark = await this.canSkipWatermark(req);
        this.logger.log(`馃幀 Video generated, skipWatermark=${skipWatermark}, videoUrl=${result.videoUrl?.substring(0, 80)}...`);

        if (skipWatermark) {
          this.logger.log('馃幀 User can skip watermark (admin or whitelist)');
          let proxiedUrl = result.videoUrl;
          try {
            const uploaded = await this.videoWatermarkService.uploadOriginalToOSS(result.videoUrl);
            proxiedUrl = uploaded.url;
            this.logger.log(
              `鉁?Video copied to OSS without watermark: ${proxiedUrl?.substring(0, 80)}...`,
            );
          } catch (error) {
            this.logger.warn('鈿狅笍 Video OSS copy failed, fallback to raw URL', error as any);
          }
          return {
            ...result,
            videoUrl: proxiedUrl,
            videoUrlRaw: result.videoUrl,
            videoUrlWatermarked: proxiedUrl,
            watermarkSkipped: true,
          };
        }

        this.logger.log('馃幀 User needs watermark, adding...');
        try {
          const wm = await this.videoWatermarkService.addWatermarkAndUpload(result.videoUrl, {
            text: 'Tanvas AI',
          });
          this.logger.log(`鉁?Video watermark success: ${wm.url?.substring(0, 80)}...`);
          return {
            ...result,
            videoUrl: wm.url,
            videoUrlRaw: result.videoUrl,
            videoUrlWatermarked: wm.url,
            watermarkSkipped: false,
          };
        } catch (error) {
          this.logger.error('鉂?Video watermark failed:', error);
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
      soraRequestParams,
    );
  }

  /**
   * 寮傛瑙嗛鐢熸垚鎺ュ彛
   * 绔嬪嵆杩斿洖 taskId锛屽墠绔€氳繃杞 /ai/sora2/video/:taskId 鏌ヨ杩涘害
   * 瑙ｅ喅绾夸笂鍙嶅悜浠ｇ悊瓒呮椂闂锛?04 Gateway Timeout锛?   */
  @Post('generate-video-async')
  async generateVideoAsync(@Body() dto: GenerateVideoDto, @Req() req: any) {
    const quality = dto.quality === 'sd' ? 'sd' : 'hd';
    const serviceType: ServiceType = quality === 'sd' ? 'sora-sd' : 'sora-hd';
    const selectedSoraModel =
      dto.model === 'sora-2' || dto.model === 'sora-2-pro'
        ? dto.model
        : quality === 'hd'
        ? 'sora-2-pro'
        : 'sora-2';
    const normalizedArray =
      dto.referenceImageUrls?.filter((url) => typeof url === 'string' && url.trim().length > 0) ||
      [];
    const legacySingle = dto.referenceImageUrl?.trim();
    const referenceImageUrlsRaw = legacySingle
      ? [...normalizedArray, legacySingle]
      : normalizedArray;
    const referenceImageUrls = this.normalizeImageUrlsForUpstream(referenceImageUrlsRaw);
    const hasCharacterMode =
      (typeof dto.characterTaskId === 'string' && dto.characterTaskId.trim().length > 0) ||
      (typeof dto.characterUrl === 'string' && dto.characterUrl.trim().length > 0);
    const effectiveReferenceImageUrls = hasCharacterMode ? [] : referenceImageUrls;
    const inputImageCount = effectiveReferenceImageUrls.length || undefined;

    this.logger.log(
      `[Async] Video generation request received (quality=${quality}, referenceCount=${effectiveReferenceImageUrls.length}, characterMode=${hasCharacterMode})`,
    );

    const soraRequestParams = await this.buildSora2CreditParams({
      selectedSoraModel,
      quality,
      aspectRatio: dto.aspectRatio,
      duration: dto.duration,
    });

    // 鍒涘缓寮傛浠诲姟骞跺啓鍏ュ唴瀛樺瓨鍌?
    const taskId = `async-sora2-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    createAsyncTask(taskId);
    const traceContext = this.getTraceContext(req);
    void this.telemetryService.ingestGenerationTask({
      traceId: traceContext.traceId || null,
      parentRequestId: traceContext.parentRequestId || null,
      taskId,
      taskType: 'video-generate',
      stage: 'queued',
      userId: this.getUserId(req),
      provider: selectedSoraModel,
      prompt: dto.prompt?.slice(0, 500) || null,
      status: 'queued',
      metadata: {
        quality,
        referenceCount: effectiveReferenceImageUrls.length,
        aspectRatio: dto.aspectRatio || null,
        duration: dto.duration || null,
      },
      receivedAt: new Date().toISOString(),
    });

    // 鍦ㄥ悗鍙版墽琛屽疄闄呬换鍔★紙涓嶉樆濉炶姹傦級
    this.executeVideoGenerationAsync(
      taskId,
      traceContext,
      req,
      serviceType,
      selectedSoraModel,
      {
        prompt: dto.prompt,
        referenceImageUrls: effectiveReferenceImageUrls,
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
      },
      inputImageCount,
      0,
      soraRequestParams,
    );

    // 绔嬪嵆杩斿洖 taskId锛屼笉绛夊緟瑙嗛鐢熸垚瀹屾垚
    return {
      success: true,
      taskId,
      status: 'pending',
      message: '瑙嗛鐢熸垚浠诲姟宸叉彁浜わ紝璇烽€氳繃 taskId 杞鏌ヨ杩涘害',
    };
  }

  /**
   * 鍚庡彴鎵ц瑙嗛鐢熸垚锛堜笉闃诲 HTTP 璇锋眰锛?   */
  private async executeVideoGenerationAsync(
    taskId: string,
    traceContext: PersistedTraceContext,
    req: any,
    serviceType: ServiceType,
    selectedSoraModel: string,
    options: Parameters<typeof this.sora2VideoService.generateVideo>[0],
    inputImageCount: number | undefined,
    outputImageCount: number,
    requestParams?: Record<string, any>,
  ): Promise<void> {
    // 寮傛鎵ц锛屼笉绛夊緟缁撴灉
    this.processVideoGenerationTask(taskId, traceContext, req, serviceType, selectedSoraModel, options, inputImageCount, outputImageCount, requestParams)
      .catch((error) => {
        this.logger.error(`[Async] Video generation task ${taskId} failed:`, error);
      });
  }

  /**
   * 澶勭悊瑙嗛鐢熸垚浠诲姟锛堢Н鍒嗘墸璐?+ 瀹為檯鐢熸垚锛?   */
  private async processVideoGenerationTask(
    taskId: string,
    traceContext: PersistedTraceContext,
    req: any,
    serviceType: ServiceType,
    selectedSoraModel: string,
    options: Parameters<typeof this.sora2VideoService.generateVideo>[0],
    inputImageCount: number | undefined,
    outputImageCount: number,
    requestParams?: Record<string, any>,
  ): Promise<void> {
    let apiUsageId: string | null = null;

    await runWithSpan(
      'video-task.generate',
      traceContext,
      {
        'app.task.id': taskId,
        'app.task.type': 'video-generate',
        'app.user.id': this.getUserId(req) || 'anonymous',
        'app.ai.provider': selectedSoraModel,
      },
      async () => {
        // 鏇存柊浠诲姟鐘舵€佷负澶勭悊涓?
        updateAsyncTask(taskId, { status: 'processing' });
        const startedAt = Date.now();
        void this.telemetryService.ingestGenerationTask({
          traceId: traceContext.traceId || null,
          parentRequestId: traceContext.parentRequestId || null,
          taskId,
          taskType: 'video-generate',
          stage: 'processing',
          userId: this.getUserId(req),
          provider: selectedSoraModel,
          prompt: typeof options?.prompt === 'string' ? options.prompt.slice(0, 500) : null,
          status: 'processing',
          metadata: {
            apiUsageId,
            serviceType,
            inputImageCount: inputImageCount ?? null,
            outputImageCount,
          },
          receivedAt: new Date().toISOString(),
        });

        try {
          const result = await this.withCredits(
            req,
            serviceType,
            selectedSoraModel,
            async () => {
              const videoResult = await this.sora2VideoService.generateVideo(options);

              if (!videoResult?.videoUrl) {
                throw new ServiceUnavailableException(
                  videoResult?.fallbackMessage || videoResult?.content || '瑙嗛鐢熸垚澶辫触锛氭湭杩斿洖鍙敤瑙嗛閾炬帴',
                );
              }

              const skipWatermark = await this.canSkipWatermark(req);
              this.logger.log(`[Async] Video generated for task ${taskId}, skipWatermark=${skipWatermark}`);

              let finalResult = { ...videoResult };

              if (skipWatermark) {
                let proxiedUrl = videoResult.videoUrl;
                try {
                  const uploaded = await this.videoWatermarkService.uploadOriginalToOSS(videoResult.videoUrl);
                  proxiedUrl = uploaded.url;
                } catch (error) {
                  this.logger.warn(`[Async] Video OSS copy failed for task ${taskId}`, error);
                }
                finalResult = {
                  ...videoResult,
                  videoUrl: proxiedUrl,
                  videoUrlRaw: videoResult.videoUrl,
                  videoUrlWatermarked: proxiedUrl,
                  watermarkSkipped: true,
                };
              } else {
                try {
                  const wm = await this.videoWatermarkService.addWatermarkAndUpload(videoResult.videoUrl, {
                    text: 'Tanvas AI',
                  });
                  finalResult = {
                    ...videoResult,
                    videoUrl: wm.url,
                    videoUrlRaw: videoResult.videoUrl,
                    videoUrlWatermarked: wm.url,
                    watermarkSkipped: false,
                  };
                } catch (error) {
                  this.logger.error(`[Async] Video watermark failed for task ${taskId}:`, error);
                  finalResult = {
                    ...videoResult,
                    videoUrl: videoResult.videoUrl,
                    videoUrlRaw: videoResult.videoUrl,
                    videoUrlWatermarked: videoResult.videoUrl,
                    watermarkFailed: true,
                  };
                }
              }

              return finalResult;
            },
            inputImageCount,
            outputImageCount,
            undefined,
            requestParams,
            {
              onApiUsageId: (value) => {
                apiUsageId = value;
              },
            },
          );

          updateAsyncTask(taskId, {
            status: 'completed',
            result: result as any,
          });
          this.logger.log(`[Async] Video generation task ${taskId} completed successfully`);
          void this.telemetryService.ingestGenerationTask({
            traceId: traceContext.traceId || null,
            parentRequestId: traceContext.parentRequestId || null,
            taskId,
            taskType: 'video-generate',
            stage: 'succeeded',
            userId: this.getUserId(req),
            provider: selectedSoraModel,
            prompt: typeof options?.prompt === 'string' ? options.prompt.slice(0, 500) : null,
            status: 'completed',
            durationMs: Date.now() - startedAt,
            metadata: {
              apiUsageId,
              serviceType,
              hasVideoUrl: Boolean((result as any)?.videoUrl),
            },
            receivedAt: new Date().toISOString(),
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          updateAsyncTask(taskId, {
            status: 'failed',
            error: errorMessage,
          });
          this.logger.error(`[Async] Video generation task ${taskId} failed:`, error);
          void this.telemetryService.ingestGenerationTask({
            traceId: traceContext.traceId || null,
            parentRequestId: traceContext.parentRequestId || null,
            taskId,
            taskType: 'video-generate',
            stage: 'failed',
            userId: this.getUserId(req),
            provider: selectedSoraModel,
            prompt: typeof options?.prompt === 'string' ? options.prompt.slice(0, 500) : null,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            error: errorMessage,
            metadata: {
              apiUsageId,
              serviceType,
            },
            receivedAt: new Date().toISOString(),
          });
          throw error;
        }
      },
    );
  }

  @Post('sora2/character/create')
  async createSora2Character(@Body() dto: CreateSora2CharacterDto) {
    if (!dto.url && !dto.fromTask) {
      throw new BadRequestException('鍙傛暟 url 鍜?fromTask 闇€浜岄€変竴');
    }
    // 瑙掕壊鍒涘缓閾捐矾涓嶆敮鎸?prompt/image锛岃繖閲屽彧淇濈暀鐧藉悕鍗曞瓧娈?
    const safeModel = dto.model;
    const safeTimestamps = typeof dto.timestamps === 'string' ? dto.timestamps.trim() : dto.timestamps;
    const safeUrl = typeof dto.url === 'string' ? dto.url.trim() : dto.url;
    const safeFromTask = typeof dto.fromTask === 'string' ? dto.fromTask.trim() : dto.fromTask;
    return this.sora2VideoService.createCharacterTask({
      model: safeModel,
      timestamps: safeTimestamps,
      url: safeUrl,
      fromTask: safeFromTask,
    });
  }

  @Get('sora2/character/:taskId')
  async querySora2Character(@Param('taskId') taskId: string) {
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException('taskId 涓嶈兘涓虹┖');
    }
    return this.sora2VideoService.queryCharacterTask(taskId.trim());
  }

  @Get('sora2/video/:taskId')
  async querySora2VideoTask(@Param('taskId') taskId: string) {
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException('taskId 涓嶈兘涓虹┖');
    }
    const trimmedTaskId = taskId.trim();

    // 棣栧厛妫€鏌ユ槸鍚︽槸寮傛浠诲姟
    const asyncTask = getAsyncTaskResult(trimmedTaskId);
    if (asyncTask) {
      // 寮傛浠诲姟锛岀洿鎺ヨ繑鍥炲瓨鍌ㄧ殑缁撴灉
      if (asyncTask.status === 'completed' && asyncTask.result) {
        return this.normalizeVideoTaskResponse({
          id: trimmedTaskId,
          status: asyncTask.result.status || 'completed',
          videoUrl: asyncTask.result.videoUrl,
          thumbnailUrl: asyncTask.result.thumbnailUrl,
          raw: asyncTask.result,
        });
      }
      if (asyncTask.status === 'failed') {
        throw new ServiceUnavailableException(asyncTask.error || '瑙嗛鐢熸垚澶辫触');
      }
      // pending 鎴?processing锛岃繑鍥炶繘琛屼腑鐘舵€?
      return this.normalizeVideoTaskResponse({
        id: trimmedTaskId,
        status: asyncTask.status === 'processing' ? 'processing' : 'pending',
        progress: asyncTask.status === 'processing' ? 50 : 10,
      });
    }

    // 闈炲紓姝ヤ换鍔★紝璋冪敤鍘熷鐨?Sora2 鏌ヨ鎺ュ彛
    return this.normalizeVideoTaskResponse(
      await this.sora2VideoService.queryVideoTask(trimmedTaskId),
    );
  }

  /**
   * 瑙嗛鐢熸垚锛堥€氱敤渚涘簲鍟嗭細鍙伒銆乂idu銆丼eedance 1.5 Pro锛?   * 杩斿洖 taskId 鍜?apiUsageId锛屽墠绔湪浠诲姟澶辫触鏃跺彲璇锋眰閫€娆?   */
  @Get('seedance2/access')
  async getSeedance2Access(@Req() req: any) {
    const userId = this.getUserId(req) || this.resolveRequestUserId(req);
    if (!userId) {
      return {
        allowed: false,
        byVip: false,
        byWhitelist: false,
        byAdmin: false,
      };
    }

    return this.resolveSeedance2CombinedAccess(userId, req);
  }

  @Post('generate-video-provider')
  async generateVideoProvider(@Body() dto: VideoProviderRequestDto, @Req() req: any) {
    const userId = this.getUserId(req);
    const effectiveDto: VideoProviderRequestDto = { ...dto };

    // Whitelist/admin users can skip watermark for doubao provider.
    if (effectiveDto.provider === 'doubao') {
      const skipWatermark = await this.canSkipWatermark(req);
      if (skipWatermark) {
        effectiveDto.watermark = false;
      }
    }
    const serviceType = this.resolveVideoProviderServiceType(effectiveDto);

    // 濡傛灉娌℃湁鐢ㄦ埛ID锛圓PI Key璁よ瘉锛夛紝鐩存帴鎵ц鎿嶄綔
    if (!userId) {
      this.logger.debug('API Key authentication - skipping credits deduction');
      const result = await this.videoProviderService.generateVideo(effectiveDto);
      const { execution: _execution, ...publicResult } = result as any;
      return { ...publicResult, apiUsageId: null };
    }

    // 纭繚鐢ㄦ埛鏈夌Н鍒嗚处鎴?
    await this.creditsService.getOrCreateAccount(userId);
    const startTime = Date.now();
    const requestParams = await this.buildVideoProviderCreditParams(effectiveDto);
    const idempotencyKey = this.extractIdempotencyKey(req, {
      ...(requestParams || {}),
      ...(typeof (effectiveDto as any)?.idempotencyKey === 'string'
        ? { idempotencyKey: (effectiveDto as any).idempotencyKey }
        : {}),
    });
    const billingModel =
      effectiveDto.klingModel ||
      effectiveDto.viduModelVariant ||
      effectiveDto.viduModel ||
      effectiveDto.seedanceModel ||
      effectiveDto.provider;

    // 棰勬墸绉垎
    const deductResult = await this.creditsService.preDeductCredits({
      userId,
      serviceType,
      model: billingModel,
      inputImageCount: effectiveDto.referenceImages?.length || undefined,
      outputImageCount: 0,
      requestParams,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
      idempotencyKey,
    });

    const apiUsageId = deductResult.apiUsageId;
    this.logger.debug(`Credits pre-deducted for video: ${serviceType}, apiUsageId: ${apiUsageId}`);
    this.emitVideoProviderGenerationTaskLog({
      stage: 'queued',
      userId,
      provider: effectiveDto.provider,
      prompt: effectiveDto.prompt,
      status: 'pending',
      taskId: apiUsageId,
      apiUsageId,
      requestParams,
    });

    try {
      const result = await this.videoProviderService.generateVideo(effectiveDto);
      const execution = (result as any)?.execution as
        | {
            modelKey?: string;
            vendorKey?: string;
            platformKey?: string;
            route?: string;
            providerChannel?: string;
            routedProvider?: string;
            fallbackUsed?: boolean;
          }
        | undefined;
      const normalizedStatus = String(result?.status || '').toLowerCase();

      if (normalizedStatus === 'failed' || normalizedStatus === 'failure') {
        throw new ServiceUnavailableException((result as any)?.error || '瑙嗛浠诲姟鍒涘缓澶辫触');
      }

      if (!result?.taskId && !result?.videoUrl) {
        throw new ServiceUnavailableException('瑙嗛浠诲姟鍒涘缓澶辫触锛氭湭杩斿洖 taskId 鎴?videoUrl');
      }

      if (result?.taskId) {
        await this.creditsService.updateApiUsageRequestParams(apiUsageId, {
          taskId: result.taskId,
          ...(execution?.modelKey ? { modelKey: execution.modelKey } : {}),
          ...(execution?.vendorKey ? { vendorKey: execution.vendorKey } : {}),
          ...(execution?.platformKey ? { platformKey: execution.platformKey } : {}),
          ...(execution?.route ? { route: execution.route } : {}),
          ...(execution?.providerChannel ? { providerChannel: execution.providerChannel } : {}),
          ...(execution?.routedProvider ? { routedProvider: execution.routedProvider } : {}),
          ...(typeof execution?.fallbackUsed === 'boolean'
            ? { fallbackUsed: execution.fallbackUsed }
            : {}),
        });
        this.emitVideoProviderGenerationTaskLog({
          stage: result.videoUrl ? 'succeeded' : 'processing',
          userId,
          provider: effectiveDto.provider,
          prompt: effectiveDto.prompt,
          status: result.videoUrl ? 'succeeded' : (result.status || 'queued'),
          taskId: result.taskId,
          apiUsageId,
          requestParams: {
            ...requestParams,
            taskId: result.taskId,
            ...(execution?.modelKey ? { modelKey: execution.modelKey } : {}),
            ...(execution?.vendorKey ? { vendorKey: execution.vendorKey } : {}),
            ...(execution?.platformKey ? { platformKey: execution.platformKey } : {}),
            ...(execution?.route ? { route: execution.route } : {}),
            ...(execution?.providerChannel ? { providerChannel: execution.providerChannel } : {}),
            ...(execution?.routedProvider ? { routedProvider: execution.routedProvider } : {}),
            ...(typeof execution?.fallbackUsed === 'boolean'
              ? { fallbackUsed: execution.fallbackUsed }
              : {}),
          },
        });
      }

      // 鍏煎鈥滅珛鍗冲嚭鐗団€濅緵搴斿晢锛氱洿鎺ユ爣璁版垚鍔燂紱寮傛浠诲姟缁存寔 pending锛屼氦鐢辫疆璇㈢粨鏋滃喅瀹氭槸鍚﹂€€娆?
      if (result.videoUrl) {
        await this.creditsService.updateApiUsageStatus(
          apiUsageId,
          ApiResponseStatus.SUCCESS,
          undefined,
          0,
        );
      }

      // 杩斿洖 apiUsageId锛屽墠绔湪浠诲姟澶辫触鏃跺彲璇锋眰閫€娆?
      const { execution: _execution, ...publicResult } = result as any;
      return { ...publicResult, apiUsageId };
    } catch (error) {
      // 鍒涘缓浠诲姟澶辫触锛岀珛鍗抽€€娆?
      const errorMessage = error instanceof Error ? error.message : String(error);
      const processingTime = Math.max(0, Date.now() - startTime);
      this.emitVideoProviderGenerationTaskLog({
        stage: 'failed',
        userId,
        provider: effectiveDto.provider,
        prompt: effectiveDto.prompt,
        status: 'failed',
        taskId: apiUsageId,
        apiUsageId,
        requestParams,
        error: errorMessage,
      });

      const refunded = await this.markFailedAndRefundWithRetry({
        userId,
        apiUsageId,
        serviceType,
        errorMessage,
        processingTime,
      });
      if (refunded) {
        this.logger.debug(`Credits refunded for failed video task creation: ${apiUsageId}`);
      } else {
        this.logger.error(
          `Failed to mark/refund video task after retries. apiUsageId=${apiUsageId}`,
        );
      }
      throw error;
    }
  }

  /**
   * 瑙嗛浠诲姟澶辫触鏃堕€€杩樼Н鍒?   */
  @Post('video-task-refund')
  async refundVideoTask(
    @Body() body: { apiUsageId: string },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req);
    if (!userId) {
      throw new BadRequestException('闇€瑕佺敤鎴疯璇?');
    }

    const { apiUsageId } = body;
    if (!apiUsageId) {
      throw new BadRequestException('缂哄皯 apiUsageId 鍙傛暟');
    }

    try {
      // 鍏堟牎楠屽綊灞炲苟鏍囪澶辫触锛堜粎鍏佽褰撳墠鐢ㄦ埛鎿嶄綔鑷繁鐨勮褰曪級
      await this.creditsService.markApiUsageFailedForUser(
        userId,
        apiUsageId,
        '瑙嗛鐢熸垚浠诲姟澶辫触',
        0,
      );

      // 閫€杩樼Н鍒?
      const result = await this.creditsService.refundCredits(userId, apiUsageId);
      this.logger.log(`鉁?瑙嗛浠诲姟绉垎宸插鐞嗛€€娆? apiUsageId=${apiUsageId}, balance=${result.newBalance}`);
      return { success: true, newBalance: result.newBalance };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`鉂?瑙嗛浠诲姟绉垎閫€杩樺け璐? ${message}`);
      throw error;
    }
  }

  /**
   * 瑙嗛浠诲姟鎴愬姛鏃剁‘璁ょН鍒嗙姸鎬侊紙灏?pending 鏍囪涓?success锛?   */
  @Post('video-task-success')
  async markVideoTaskSuccess(
    @Body() body: { apiUsageId: string; processingTime?: number },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req);
    if (!userId) {
      throw new BadRequestException('闇€瑕佺敤鎴疯璇?');
    }

    const apiUsageId = typeof body?.apiUsageId === 'string' ? body.apiUsageId.trim() : '';
    if (!apiUsageId) {
      throw new BadRequestException('缂哄皯 apiUsageId 鍙傛暟');
    }

    const rawProcessingTime = Number(body?.processingTime);
    const processingTime = Number.isFinite(rawProcessingTime)
      ? Math.max(0, Math.round(rawProcessingTime))
      : 0;

    await this.creditsService.markApiUsageSuccessForUser(
      userId,
      apiUsageId,
      processingTime,
    );
    return { success: true };
  }

  /**
   * 鏌ヨ瑙嗛鐢熸垚浠诲姟鐘舵€?   */
  @Get('video-task/:provider/:taskId')
  async queryVideoTask(
    @Param('provider') provider: 'kling' | 'kling-2.6' | 'kling-o3' | 'vidu' | 'viduq3-pro' | 'doubao',
    @Param('taskId') taskId: string,
  ) {
    return this.normalizeVideoTaskResponse(
      await this.videoProviderService.queryTask(provider, taskId),
    );
  }

  @Post('volc-enhance-video')
  async createVolcEnhanceVideoTask(@Body() dto: VolcEnhanceVideoDto) {
    const apiKey = (
      process.env.VOLC_MEDIAKIT_API_KEY ||
      process.env.VOLC_ENHANCE_VIDEO_API_KEY ||
      process.env.VOLC_ENHANCE_API_KEY ||
      ''
    ).trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        '瑙嗛鐢昏川澧炲己鏈嶅姟鏈厤缃紙缂哄皯 VOLC_MEDIAKIT_API_KEY锛?',
      );
    }

    const videoUrl = String(dto.videoUrl || '').trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(videoUrl);
    } catch {
      throw new BadRequestException('瑙嗛 URL 鏍煎紡鏃犳晥');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new BadRequestException('瑙嗛 URL 鍙敮鎸?http/https 鍗忚');
    }

    if (dto.resolution && typeof dto.resolutionLimit === 'number') {
      throw new BadRequestException('resolution 涓?resolutionLimit 浜掓枼锛屼笉鑳藉悓鏃朵紶鍏?');
    }

    const apiBaseUrl = (
      process.env.VOLC_MEDIAKIT_API_BASE_URL || 'https://mediakit.cn-beijing.volces.com'
    ).replace(/\/+$/, '');
    const submitUrl = `${apiBaseUrl}/api/v1/tools/enhance-video`;

    const payload: Record<string, any> = {
      video_url: videoUrl,
      tool_version: dto.toolVersion || 'standard',
    };
    if (dto.scene) payload.scene = dto.scene;
    if (dto.resolution) payload.resolution = dto.resolution;
    if (typeof dto.resolutionLimit === 'number') payload.resolution_limit = dto.resolutionLimit;
    if (typeof dto.fps === 'number') payload.fps = dto.fps;

    try {
      const response = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const rawText = await response.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = { message: rawText };
      }

      if (!response.ok) {
        const detail = data?.message || data?.error || rawText || `HTTP ${response.status}`;
        throw new BadGatewayException(`鎻愪氦瑙嗛鐢昏川澧炲己浠诲姟澶辫触: ${detail}`);
      }

      const taskId =
        data?.task_id ||
        data?.taskId ||
        data?.id ||
        data?.data?.task_id ||
        data?.data?.taskId;
      if (!taskId) {
        throw new BadGatewayException('鎻愪氦瑙嗛鐢昏川澧炲己浠诲姟澶辫触锛氫笂娓告湭杩斿洖 task_id');
      }

      return {
        success: true,
        taskId: String(taskId),
        status: 'queued' as const,
        upstream: {
          taskId: data?.task_id || data?.taskId || data?.id || null,
          requestId: data?.request_id || data?.requestId || null,
        },
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      const summary = this.summarizeError(error);
      if (this.isLikelyNetworkError(error)) {
        throw new ServiceUnavailableException(`鎻愪氦瑙嗛鐢昏川澧炲己浠诲姟澶辫触锛?{summary}`);
      }
      throw new InternalServerErrorException(`鎻愪氦瑙嗛鐢昏川澧炲己浠诲姟澶辫触锛?{summary}`);
    }
  }

  @Get('volc-enhance-video/:taskId')
  async queryVolcEnhanceVideoTask(@Param('taskId') taskId: string) {
    const apiKey = (
      process.env.VOLC_MEDIAKIT_API_KEY ||
      process.env.VOLC_ENHANCE_VIDEO_API_KEY ||
      process.env.VOLC_ENHANCE_API_KEY ||
      ''
    ).trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        '瑙嗛鐢昏川澧炲己鏈嶅姟鏈厤缃紙缂哄皯 VOLC_MEDIAKIT_API_KEY锛?',
      );
    }

    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId 涓嶈兘涓虹┖');
    }

    const apiBaseUrl = (
      process.env.VOLC_MEDIAKIT_API_BASE_URL || 'https://mediakit.cn-beijing.volces.com'
    ).replace(/\/+$/, '');
    const queryUrl = `${apiBaseUrl}/api/v1/tasks/${encodeURIComponent(normalizedTaskId)}`;

    try {
      const response = await fetch(queryUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const rawText = await response.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = { message: rawText };
      }

      if (!response.ok) {
        const detail = data?.message || data?.error || rawText || `HTTP ${response.status}`;
        throw new BadGatewayException(`鏌ヨ瑙嗛鐢昏川澧炲己浠诲姟澶辫触: ${detail}`);
      }

            const statusCandidates = [
        data?.status,
        data?.task_status,
        data?.state,
        data?.phase,
        data?.data?.status,
        data?.data?.task_status,
        data?.data?.state,
        data?.data?.phase,
        data?.result?.status,
        data?.result?.task_status,
      ];
      const upstreamStatus =
        statusCandidates
          .map((value) => String(value || '').trim())
          .find((value) => value.length > 0) || '';
      const videoUrl =
        data?.result?.video_url ||
        data?.result?.url ||
        data?.video_url ||
        data?.output?.video_url ||
        data?.data?.video_url ||
        data?.data?.result?.video_url ||
        data?.data?.result?.url ||
        data?.data?.output?.video_url ||
        undefined;
      let status = this.normalizeUnifiedVideoStatus(upstreamStatus);
      if (status !== 'failed' && typeof videoUrl === 'string' && videoUrl.trim().length > 0) {
        status = 'succeeded';
      }
      const errorMessage =
        data?.error?.message ||
        data?.data?.error?.message ||
        data?.error_message ||
        data?.data?.error_message ||
        data?.message ||
        data?.data?.message ||
        (status === 'failed' ? '视频画质增强任务失败' : undefined);

      return {
        success: true,
        taskId: String(
          data?.task_id ||
            data?.taskId ||
            data?.id ||
            data?.data?.task_id ||
            data?.data?.taskId ||
            data?.data?.id ||
            normalizedTaskId,
        ),
        status,
        upstreamStatus,
        videoUrl,
        result: data?.result,
        error: status === 'failed' ? errorMessage : undefined,
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      const summary = this.summarizeError(error);
      if (this.isLikelyNetworkError(error)) {
        throw new ServiceUnavailableException(`鏌ヨ瑙嗛鐢昏川澧炲己浠诲姟澶辫触锛?{summary}`);
      }
      throw new InternalServerErrorException(`鏌ヨ瑙嗛鐢昏川澧炲己浠诲姟澶辫触锛?{summary}`);
    }
  }

  private normalizeUnifiedVideoStatus(status?: string | null): 'queued' | 'processing' | 'succeeded' | 'failed' {
    const value = String(status || '').trim().toLowerCase();
    if (!value) return 'processing';

    if (
      [
        'queued',
        'queue',
        'pending',
        'submitted',
        'waiting',
      ].includes(value)
    ) {
      return 'queued';
    }

    if (
      [
        'processing',
        'running',
        'progressing',
        'in_progress',
      ].includes(value)
    ) {
      return 'processing';
    }

    if (
      [
        'success',
        'succeed',
        'succeeded',
        'completed',
        'complete',
        'done',
        'finish',
        'finished',
      ].includes(value)
    ) {
      return 'succeeded';
    }

    if (
      [
        'failed',
        'fail',
        'failure',
        'error',
        'cancelled',
        'canceled',
        'timeout',
        'terminated',
        'exception',
        'expired',
      ].includes(value)
    ) {
      return 'failed';
    }

    return 'processing';
  }

  private normalizeVideoTaskResponse<T extends Record<string, any>>(payload: T): T & {
    status: 'queued' | 'processing' | 'succeeded' | 'failed';
  } {
    return {
      ...payload,
      status: this.normalizeUnifiedVideoStatus(payload?.status),
    };
  }

  /**
   * 鐢熸垚 Paper.js 浠ｇ爜
   */
  @Post('generate-paperjs')
  async generatePaperJS(@Body() dto: PaperJSGenerateRequestDto, @Req() req: any): Promise<PaperJSGenerateResponseDto> {
    this.logger.log(`馃搻 Paper.js code generation request: ${dto.prompt.substring(0, 50)}...`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);

    // 妫€鏌ユ槸鍚︿娇鐢ㄨ嚜瀹氫箟 API Key锛坓emini 鍜?gemini-pro 閮芥敮鎸侊級
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
          this.logger.log(`鉁?Paper.js code generated successfully in ${processingTime}ms`);

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

      // gemini 鍜?gemini-pro 閮戒娇鐢ㄩ粯璁ょ殑 Gemini 鏈嶅姟
      const result = await this.imageGeneration.generatePaperJSCode({
        prompt: dto.prompt,
        model: dto.model,
        thinkingLevel: dto.thinkingLevel,
        canvasWidth: dto.canvasWidth,
        canvasHeight: dto.canvasHeight,
        customApiKey,
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(`鉁?Paper.js code generated successfully in ${processingTime}ms`);

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
    this.logger.log(`馃柤锔?Image to vector conversion request`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveTextModel(providerName, dto.model);
    const normalizedModel = model?.replace(/^banana-/, '') || model;

    // 妫€鏌ユ槸鍚︿娇鐢ㄨ嚜瀹氫箟 API Key
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
              this.logger.log(`鉁?Image to vector conversion completed in ${processingTime}ms`);

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

            const message = result.error?.message || '鍥剧墖杞煝閲忓浘澶辫触';
            this.logger.error(`[${providerName}] img2vector failed: ${message}`);
            throw new InternalServerErrorException(message);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[${providerName}] img2vector threw error: ${message}`, error as any);
            throw new InternalServerErrorException(message);
          }
        }

        // 鎻愪緵鍟嗘湭瀹炵幇 img2Vector锛屽洖閫€鍒伴粯璁?Gemini 娴佺▼
        this.logger.warn(`[${providerName}] img2Vector not implemented, falling back to Gemini service`);
        fallbackProvider = providerName;
      }

      // gemini 鍜?gemini-pro 閮戒娇鐢ㄩ粯璁ょ殑 Gemini 鏈嶅姟
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
      this.logger.log(`鉁?Image to vector conversion completed in ${processingTime}ms`);

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
   * VEO 瑙嗛鐢熸垚 - 鑾峰彇鍙敤妯″瀷鍒楄〃
   */
  @Get('veo/models')
  async getVeoModels(): Promise<VeoModelsResponseDto[]> {
    this.logger.log('馃搵 VEO models list requested');
    return this.veoVideoService.getAvailableModels();
  }

  /**
   * VEO 瑙嗛鐢熸垚
   * - veo3-fast: 鏂囧瓧蹇€熺敓鎴愯棰?   * - veo3-pro: 鏂囧瓧鐢熸垚楂樿川閲忚棰戯紙涓嶆敮鎸佸灚鍥撅級
   * - veo3-pro-frames: 鍥剧墖+鏂囧瓧鐢熸垚瑙嗛锛堟敮鎸佸灚鍥撅級
   */
  @Post('veo/generate')
  async generateVeoVideo(@Body() dto: VeoGenerateVideoDto, @Req() req: any): Promise<VeoVideoResponseDto> {
    this.logger.log(`馃幀 VEO video generation request: model=${dto.model}, prompt=${dto.prompt.substring(0, 50)}...`);

    // 楠岃瘉锛歷eo3-pro-frames 闇€瑕佸浘鐗囷紝鍏朵粬妯″紡涓嶉渶瑕?
    if (dto.model === 'veo3-pro-frames' && !dto.referenceImageUrl) {
      throw new BadRequestException('veo3-pro-frames 妯″紡闇€瑕佹彁渚?referenceImageUrl 鍙傛暟');
    }

    if (dto.model !== 'veo3-pro-frames' && dto.referenceImageUrl) {
      this.logger.warn(`Model ${dto.model} does not support image input, ignoring referenceImageUrl`);
    }

    const normalizedReferenceImageUrl =
      dto.model === 'veo3-pro-frames' &&
      typeof dto.referenceImageUrl === 'string' &&
      dto.referenceImageUrl.trim()
        ? this.normalizeImageUrlForUpstream(dto.referenceImageUrl)
        : undefined;

    const result = await this.veoVideoService.generateVideo({
      prompt: dto.prompt,
      model: dto.model,
      referenceImageUrl: normalizedReferenceImageUrl,
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
        if (!taskId) {
          this.logger.warn('DashScope wan2.6-t2v create response contains no task id and no video url', {
            dataPreview: JSON.stringify(data).slice(0, 400),
          });
          return {
            success: false,
            error: {
              message: 'DashScope 鏈繑鍥炰换鍔?ID 鎴栬棰戝湴鍧€',
              details: data,
            },
          };
        }

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
              if (!finalVideoUrl) {
                this.logger.warn('DashScope wan2.6-t2v task succeeded but no video URL in response', {
                  taskId,
                  dataPreview: JSON.stringify(statusData).slice(0, 400),
                });
                return {
                  success: false,
                  error: {
                    message: 'DashScope 浠诲姟宸插畬鎴愪絾鏈繑鍥炶棰戝湴鍧€',
                    details: statusData,
                  },
                };
              }
              return { success: true, data: { taskId, status: statusValue, videoUrl: finalVideoUrl, video_url: finalVideoUrl, output: { video_url: finalVideoUrl }, raw: statusData } };
            }
            if (statusValue === 'failed' || statusValue === 'error') {
              return { success: false, error: { message: 'DashScope task failed', details: statusData } };
            }
          } catch { continue; }
        }
        return { success: false, error: { message: 'DashScope task polling timed out' } };
      } catch (error: any) {
        this.logger.error('鉂?DashScope request exception', error);
        return { success: false, error: { code: 'NETWORK_ERROR', message: error?.message || String(error) } };
      }
    }, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {
      managedModelKey: 'wan-2.6',
      generationMode: 't2v',
      requestPrompt: body?.input?.prompt,
      requestThumbnailUrls: typeof body?.input?.audio_url === 'string' ? [body.input.audio_url] : [],
    }), {
      treatReturnedFailureAsError: true,
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
      const normalizedBody = this.normalizeWanI2VBodyForUpstream(body);

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(normalizedBody),
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

        this.logger.log('鉁?DashScope i2v task created', {
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
          return {
            success: false,
            error: {
              message: 'DashScope 鏈繑鍥炰换鍔?ID 鎴栬棰戝湴鍧€',
              details: data,
            },
          };
        }

        // 寮傛妯″紡锛氱珛鍗宠繑鍥?taskId锛屽墠绔疆璇㈡煡璇㈢姸鎬?
        this.logger.log(`鉁?DashScope i2v task created: ${taskId}`);
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
        this.logger.error('鉂?DashScope i2v request exception', error);
        return {
          success: false,
          error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
        };
      }
    }, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {
      managedModelKey: 'wan-2.6',
      generationMode: 'i2v',
      requestPrompt: body?.input?.prompt,
      requestThumbnailUrls: [
        body?.input?.img_url,
        body?.input?.audio_url,
      ],
      hasAudio: true,
    }), {
      treatReturnedFailureAsError: true,
      skipFinalizeSuccessIf: (r: any) => this.isDashscopeVideoAsyncPending(r),
    });
  }

  /**
   * DashScope Wan2.7-i2v proxy endpoint
   */
  @Post('dashscope/generate-wan2-7-i2v')
  async generateWan27I2VViaDashscope(@Body() body: any, @Req() req: any) {
    return this.withCredits(req, 'wan27-video', 'wan2.7-i2v', async () => {
      const dashKey = process.env.DASHSCOPE_API_KEY;
      if (!dashKey) {
        this.logger.error('DASHSCOPE_API_KEY not configured');
        return {
          success: false,
          error: { message: 'DASHSCOPE_API_KEY not configured on server' },
        };
      }

      const dashUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
      const normalizedBody = this.normalizeWan27I2VBodyForUpstream(body);

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(normalizedBody),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          this.logger.error('DashScope wan2.7-i2v create task failed', {
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
          this.logger.warn('DashScope wan2.7-i2v create response contains no task id', {
            dataPreview: JSON.stringify(data).slice(0, 300),
          });
          return {
            success: false,
            error: {
              message: 'DashScope 鏈繑鍥炰换鍔?ID',
              details: data,
            },
          };
        }

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
        this.logger.error('鉂?DashScope wan2.7-i2v request exception', error);
        return {
          success: false,
          error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
        };
      }
    }, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {
      managedModelKey: 'wan-2.7',
      generationMode: 'i2v',
      requestPrompt: body?.input?.prompt,
      requestThumbnailUrls: Array.isArray(body?.input?.media)
        ? body.input.media.map((item: any) => item?.url).filter(Boolean)
        : [],
      hasAudio: true,
    }), {
      treatReturnedFailureAsError: true,
      skipFinalizeSuccessIf: (r: any) => this.isDashscopeVideoAsyncPending(r),
    });
  }

  /**
   * DashScope 浠诲姟鐘舵€佹煡璇㈡帴鍙ｏ紙鍓嶇杞鐢級
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
      const normalizedBody = this.normalizeWanR2VBodyForUpstream(body);

      try {
        const response = await fetch(dashUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${dashKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(normalizedBody),
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

        this.logger.log('鉁?DashScope r2v task created', {
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
          return {
            success: false,
            error: {
              message: 'DashScope 鏈繑鍥炰换鍔?ID 鎴栬棰戝湴鍧€',
              details: data,
            },
          };
        }

        const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`;
        const intervalMs = 15000;
        const maxAttempts = 40;
        this.logger.log(
          `馃攣 Start polling DashScope r2v task ${taskId} (${maxAttempts} attempts, ${intervalMs}ms interval)`
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
              `馃攷 DashScope r2v status response (attempt ${attempt + 1}): ${JSON.stringify(statusData).slice(0, 200)}`
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
              if (!finalVideoUrl) {
                this.logger.warn(`DashScope r2v task ${taskId} succeeded but no video URL in response`, {
                  dataPreview: JSON.stringify(statusData).slice(0, 400),
                });
                return {
                  success: false,
                  error: {
                    message: 'DashScope 浠诲姟宸插畬鎴愪絾鏈繑鍥炶棰戝湴鍧€',
                    details: statusData,
                  },
                };
              }
              this.logger.log(
                `鉁?DashScope r2v task ${taskId} succeeded, videoUrl: ${String(finalVideoUrl).slice(0, 120)}`
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

              this.logger.error(`鉂?DashScope r2v task ${taskId} failed`, {
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
          `鈴?DashScope r2v task ${taskId} polling timed out after ${maxAttempts} attempts`
        );
        return {
          success: false,
          error: { message: 'DashScope r2v task polling timed out' },
        };
      } catch (error: any) {
        this.logger.error('鉂?DashScope r2v request exception', error);
        return {
          success: false,
          error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
        };
      }
    }, undefined, undefined, undefined, this.buildWanCreditRequestParams(body, {
      managedModelKey: 'wan-2.6-r2v',
      generationMode: 'r2v',
      requestPrompt: body?.input?.prompt,
      requestThumbnailUrls: Array.isArray(body?.input?.reference_video_urls)
        ? body.input.reference_video_urls
        : [],
      hasAudio: true,
    }), {
      treatReturnedFailureAsError: true,
    });
  }

  @Post('dashscope/generate-happyhorse-video')
  async generateHappyhorseVideoViaDashscope(@Body() body: any, @Req() req: any) {
    const model = this.resolveHappyhorseModelOrThrow(body);
    const taskLabel = model.replace(/^happyhorse-1\.0-/, 'happyhorse-');
    await this.assertHappyhorseEntitlement(this.getUserId(req));
    return this.withCredits(
      req,
      'happyhorse-r2v-video',
      model,
      async () => {
        const dashKey = process.env.DASHSCOPE_API_KEY;
        if (!dashKey) {
          this.logger.error('DASHSCOPE_API_KEY not configured');
          return {
            success: false,
            error: { message: 'DASHSCOPE_API_KEY not configured on server' },
          };
        }

        const dashUrl =
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
        const normalizedBody = this.normalizeHappyhorseBodyForUpstream(body);

        try {
          const response = await fetch(dashUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${dashKey}`,
              'X-DashScope-Async': 'enable',
            },
            body: JSON.stringify(normalizedBody),
          });

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            this.logger.error(`DashScope ${taskLabel} create task failed`, {
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

          this.logger.log(`鉁?DashScope ${taskLabel} task created`, {
            resultPreview: JSON.stringify(data).slice(0, 200),
          });

          // 鏋佸皯鏁版儏鍐典笅涓婃父鍙兘鐩存帴杩斿洖瑙嗛鍦板潃锛堝厹搴曪級
          const directVideoUrl =
            data?.output?.video_url ||
            data?.video_url ||
            data?.videoUrl ||
            (Array.isArray(data?.output) && data.output[0]?.video_url) ||
            undefined;
          if (directVideoUrl) return { success: true, data };

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
            this.logger.warn(
              `DashScope ${taskLabel} create response contains no task id and no video url`,
              { dataPreview: JSON.stringify(data).slice(0, 200) },
            );
            return {
              success: false,
              error: {
                message: 'DashScope 鏈繑鍥炰换鍔?ID 鎴栬棰戝湴鍧€',
                details: data,
              },
            };
          }

          this.logger.log(`鉁?DashScope ${taskLabel} task created: ${taskId}`);
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
          this.logger.error(`鉂?DashScope ${taskLabel} request exception`, error);
          return {
            success: false,
            error: { code: 'NETWORK_ERROR', message: error?.message || String(error) },
          };
        }
      },
      undefined,
      undefined,
      undefined,
      this.buildHappyhorseCreditRequestParams(body, model),
      {
        treatReturnedFailureAsError: true,
        skipFinalizeSuccessIf: (r: any) => this.isDashscopeVideoAsyncPending(r),
      },
    );
  }

  /**
   * 瑙嗛鍒嗘瀽 - 浣跨敤 Gemini File API 鍒嗘瀽瑙嗛鍐呭
   */
  @Post('analyze-video')
  async analyzeVideo(@Body() dto: AnalyzeVideoDto, @Req() req: any) {
    this.logger.log(`馃帴 Video analysis request: ${dto.videoUrl?.substring(0, 50)}...`);

    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveGeminiVideoModel(dto.model);
    const videoProviderOptions = {
      ...(dto.providerOptions || {}),
      ...(dto.bananaImageRoute ? { bananaImageRoute: dto.bananaImageRoute } : {}),
      banana: {
        ...((dto.providerOptions?.banana as Record<string, any> | undefined) || {}),
        ...(dto.bananaImageRoute ? { imageRoute: dto.bananaImageRoute } : {}),
      },
    };

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
        // 147(Banana) direct video understanding is only used on legacy 147 text route.
        // For normal/stable routes, always use the unified frame-based pipeline so routing
        // follows providerOptions + backend supplier settings consistently.
        const bananaVideoMode =
          providerName === 'banana' || providerName === 'banana-2.5' || providerName === 'banana-3.1'
            ? await this.getBananaImageProviderMode(videoProviderOptions)
            : null;
        const allow147DirectVideoUnderstanding =
          bananaVideoMode === 'legacy' || bananaVideoMode === 'legacy_auto';

        if (providerName && providerName !== 'gemini-pro') {
          if (
            (providerName === 'banana' ||
              providerName === 'banana-2.5' ||
              providerName === 'banana-3.1') &&
            allow147DirectVideoUnderstanding
          ) {
            stage = 'direct_video_understanding';
            try {
              const analysisText = await this.analyzeVideoVia147ChatCompletions({
                model,
                prompt: dto.prompt || '鍒嗘瀽杩欎釜瑙嗛鐨勫唴瀹癸紝鎻忚堪瑙嗛涓殑鍦烘櫙銆佸姩浣滃拰鍏抽敭淇℃伅',
                videoUrl: parsedUrl.toString(),
              });
              const processingTime = Date.now() - startTime;
              this.logger.log(
                `鉁?Video analysis (147 direct) completed in ${processingTime}ms`
              );
              return {
                analysis: analysisText,
                text: analysisText,
                model,
                provider: providerName,
                processingTime,
              };
            } catch (err: any) {
              // 147 鐩存帴瑙嗛鐞嗚В澶辫触锛屼笉鍐嶉檷绾у埌 ffmpeg 鎶藉抚鏂规
              // 鍥犱负 ffmpeg 闇€瑕佹湇鍔″櫒瀹夎锛屼笉閫傚悎浜戦儴缃茬幆澧?
              this.logger.error(
                `鉂?147 direct video understanding failed: ${this.summarizeError(err)}`
              );
              throw err;
            }
          }
        }

        // 浠?OSS URL 涓嬭浇瑙嗛锛堟祦寮忓啓鍏ヤ复鏃舵枃浠讹紝閬垮厤澶ф枃浠跺崰鐢ㄥ唴瀛橈級
        stage = 'download_video';
        this.logger.log('馃摜 Downloading video from OSS...');
        const videoResponse = await fetch(parsedUrl.toString(), { redirect: 'follow' });
        if (!videoResponse.ok) {
          throw new Error(`Failed to download video: HTTP ${videoResponse.status}`);
        }
        // 闃叉璺宠浆鍒伴潪鐧藉悕鍗曞煙鍚?
        this.parseAndValidateAllowedUrl(videoResponse.url);
        if (!videoResponse.body) {
          throw new Error('Empty video response body');
        }

        const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
        const contentLengthHeader = videoResponse.headers.get('content-length');
        if (contentLengthHeader) {
          const size = Number(contentLengthHeader);
          if (Number.isFinite(size) && size > MAX_VIDEO_BYTES) {
            throw new BadRequestException('瑙嗛鏂囦欢杩囧ぇ锛岃浣跨敤鏇村皬鐨勮棰?');
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

        this.logger.log(`馃摝 Video downloaded: ${received} bytes, type: ${contentType}`);

        // 闈?Google provider锛氭娊甯?-> 璧扮幇鏈夊浘鐗囧垎鏋?鏂囨湰鎬荤粨閾捐矾锛堝浗鍐呭彲鐢紝濡?banana/147锛?
        if (providerName && providerName !== 'gemini-pro') {
          stage = 'extract_frames';
          const provider = this.factory.getProvider(dto.model, providerName);
          const maxFrames = 8;
          const intervalSeconds = 3;
          this.logger.log(`馃柤锔?Extracting frames via ffmpeg (maxFrames=${maxFrames}, every ${intervalSeconds}s)...`);
          const frames = await this.extractFramesAsDataUrls({
            videoPath: tempFile,
            maxFrames,
            intervalSeconds,
          });
          if (!frames.length) {
            throw new ServiceUnavailableException('鏃犳硶浠庤棰戜腑鎻愬彇甯э紝璇锋鏌ヨ棰戞枃浠舵槸鍚︽崯鍧?');
          }

          stage = 'analyze_frames';
          const visionModel = this.resolveImageModel(providerName, dto.model);
          const framePrompt =
            '璇锋弿杩拌繖涓€甯х敾闈紙鍦烘櫙銆佷汉鐗┿€佸姩浣溿€佸瓧骞?鐣岄潰鍏冪礌锛夛紝灏介噺瀹㈣锛屼笉瑕佺紪閫犮€?;'
          const frameAnalyses: string[] = [];
          for (let i = 0; i < frames.length; i++) {
            const result = await provider.analyzeImage({
              prompt: framePrompt,
              sourceImage: frames[i],
              model: visionModel,
              providerOptions: videoProviderOptions,
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
            dto.prompt || '鍒嗘瀽杩欎釜瑙嗛鐨勫唴瀹癸紝鎻忚堪瑙嗛涓殑鍦烘櫙銆佸姩浣滃拰鍏抽敭淇℃伅';
          const summaryPrompt = [
            '浣犲皢鑾峰緱浠庡悓涓€娈佃棰戞娊甯у緱鍒扮殑澶氬抚鎻忚堪锛岃鏍规嵁杩欎簺淇℃伅鎬荤粨鏁存瑙嗛銆?',
            `鐢ㄦ埛鍒嗘瀽瑕佹眰锛?{userPrompt}`,
            '鎶藉抚鎻忚堪锛?',
            ...frameAnalyses.map((t, idx) => `${idx + 1}. ${t}`),
            '璇疯緭鍑猴細1) 瑙嗛鏁翠綋鍐呭姒傝堪 2) 鍏抽敭鍦烘櫙/鍔ㄤ綔 3) 鍙兘鐨勬椂闂寸嚎(濡傚彲鎺ㄦ柇) 4) 鍏抽敭淇℃伅/瀛楀箷(濡傛湁)銆?',
          ].join('\n');

          const textResult = await provider.generateText({
            prompt: summaryPrompt,
            model,
            providerOptions: videoProviderOptions,
          });
          if (!textResult.success || !textResult.data) {
            throw new ServiceUnavailableException(
              textResult.error?.message || 'Failed to summarize video frames'
            );
          }

          const analysisText = textResult.data.text || '';
          const processingTime = Date.now() - startTime;
          this.logger.log(`鉁?Video analysis (frame-based) completed in ${processingTime}ms`);
          return {
            analysis: analysisText,
            text: analysisText,
            model,
            provider: providerName,
            processingTime,
            frameCount: frames.length,
          };
        }

        // Google Gemini 璺緞锛氫笂浼犲埌 File API 鍐嶅垎鏋愶紙闇€瑕佽兘鐩磋繛 Google锛?
        const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('GOOGLE_GEMINI_API_KEY not configured');
        }
        geminiClient = new GoogleGenAI({ apiKey });

        // 浣跨敤 Gemini File API 涓婁紶瑙嗛
        stage = 'upload_to_gemini';
        this.logger.log('馃摛 Uploading video to Gemini File API...');
        const uploadResult = await geminiClient.files.upload({
          file: tempFile,
          config: { mimeType: contentType, displayName: `video-analysis-${Date.now()}` },
        });

        uploadedFileName = uploadResult.name || null;
        if (!uploadedFileName) {
          throw new Error('Gemini file upload returned empty file name');
        }
        this.logger.log(`鉁?Video uploaded to Gemini: ${uploadedFileName}`);

        // 绛夊緟鏂囦欢澶勭悊瀹屾垚锛堝甫瓒呮椂锛?
        stage = 'wait_processing';
        const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
        let file = uploadResult;
        while (file.state === 'PROCESSING') {
          if (Date.now() > deadline) {
            throw new ServiceUnavailableException('瑙嗛澶勭悊瓒呮椂锛岃浣跨敤鏇寸煭鐨勮棰?');
          }
          this.logger.log('鈴?Waiting for video processing...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          file = await geminiClient.files.get({ name: uploadedFileName });
        }

        if (file.state === 'FAILED') {
          throw new Error('Video processing failed');
        }

        // 浣跨敤 Gemini 鍒嗘瀽瑙嗛
        stage = 'generate_content';
        const prompt = dto.prompt || '鍒嗘瀽杩欎釜瑙嗛鐨勫唴瀹癸紝鎻忚堪瑙嗛涓殑鍦烘櫙銆佸姩浣滃拰鍏抽敭淇℃伅';

        this.logger.log('馃攳 Analyzing video with Gemini...');
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

        this.logger.log(`鉁?Video analysis completed in ${processingTime}ms`);

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
          `鉂?Video analysis failed at ${stage} after ${processingTime}ms: ${summary}`,
          error?.stack || summary
        );
        if (error instanceof HttpException) {
          throw error;
        }
        if (this.isLikelyNetworkError(error)) {
        throw new ServiceUnavailableException(`瑙嗛鍒嗘瀽澶辫触锛?{stage}锛夛細${summary}`);
      }
        throw new InternalServerErrorException(`瑙嗛鍒嗘瀽澶辫触锛?{stage}锛夛細${summary}`);
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
    }, 1, 0, undefined, this.buildCreditRequestParams(providerName, {
      model,
      ...(dto.bananaImageRoute ? { bananaImageRoute: dto.bananaImageRoute } : {}),
      ...(dto.channelHint ? { channelHint: dto.channelHint } : {}),
      nodeConfigKey: 'videoAnalyze',
      nodeConfigNameZh: '瑙嗛鍒嗘瀽鑺傜偣',
      nodeConfigNameEn: 'Video Analysis',
      billingTitleSource: 'node',
    }, videoProviderOptions));
  }

  /**
   * 寮傛鍥惧儚鐢熸垚 - 鍒涘缓浠诲姟
   */
  @Post('generate-image-async')
  async generateImageAsync(@Body() dto: GenerateImageDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('鍥惧儚浠诲姟鏈嶅姟鏈惎鐢?');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 鍒涘缓浠诲姟
    const task = await this.imageTaskService.createTask(
      userId,
      'generate',
      dto.prompt,
      { ...dto, model },
      providerName || 'gemini',
      { traceId, parentRequestId },
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 寮傛鍥惧儚缂栬緫 - 鍒涘缓浠诲姟
   */
  @Post('edit-image-async')
  async editImageAsync(@Body() dto: EditImageDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('鍥惧儚浠诲姟鏈嶅姟鏈惎鐢?');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 濡傛灉鎻愪緵浜?URL锛屽厛涓嬭浇鍥剧墖
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
      { traceId, parentRequestId },
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 寮傛鍥惧儚娣峰悎 - 鍒涘缓浠诲姟
   */
  @Post('blend-images-async')
  async blendImagesAsync(@Body() dto: BlendImagesDto, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('鍥惧儚浠诲姟鏈嶅姟鏈惎鐢?');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub || 'anonymous';
    const traceId = this.getTraceId(req);
    const parentRequestId = this.getRequestId(req);
    const providerName = dto.aiProvider && dto.aiProvider !== 'gemini' ? dto.aiProvider : null;
    const model = this.resolveImageModel(providerName, dto.model);

    // 濡傛灉鎻愪緵浜?URL锛屽厛涓嬭浇鍥剧墖
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
      { traceId, parentRequestId },
    );

    return {
      taskId: task.id,
      status: task.status,
    };
  }

  /**
   * 鏌ヨ鍥惧儚浠诲姟鐘舵€?   */
  @Get('image-task/:taskId')
  async getImageTaskStatus(@Param('taskId') taskId: string, @Req() req: any) {
    if (!this.imageTaskService) {
      throw new ServiceUnavailableException('鍥惧儚浠诲姟鏈嶅姟鏈惎鐢?');
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

  @Post('tencent-speech')
  async generateTencentSpeech(@Body() dto: TencentSpeechDto, @Req() req: any) {
    return this.withCredits(
      req,
      'tencent-speech',
      undefined,
      async () => this.tencentSpeechService.synthesizeSpeech(dto),
      undefined,
      undefined,
      false,
      {
        inputVideoUrl: dto.inputVideoUrl,
        textLength: (dto.text || '').trim().length || undefined,
        speakerUrl: dto.speakerUrl,
        srcSubtitleUrl: dto.srcSubtitleUrl,
        dstLangs: dto.dstLangs,
      },
    );
  }

  @Post('tencent-speech/async')
  async generateTencentSpeechAsync(@Body() dto: TencentSpeechDto) {
    return this.tencentSpeechService.createAsyncSpeechTask(dto);
  }

  @Get('tencent-speech/async/:taskId')
  async queryTencentSpeechAsyncTask(@Param('taskId') taskId: string) {
    const normalizedTaskId = taskId?.trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId 鍙傛暟涓嶈兘涓虹┖');
    }
    return this.tencentSpeechService.queryAsyncSpeechTask(normalizedTaskId);
  }

  @Post('minimax-speech')
  async generateSpeech(@Body() dto: MinimaxSpeechDto, @Req() req: any) {
    return this.withCredits(
      req,
      'minimax-speech',
      dto.model,
      async () => this.minimaxSpeechService.synthesizeSpeech(dto),
      undefined,
      undefined,
      false,
      { text: dto.text, voiceId: dto.voiceId, emotion: dto.emotion }
    );
  }

  @Post('minimax-speech/async')
  async generateSpeechAsync(@Body() dto: MinimaxSpeechDto) {
    return this.minimaxSpeechService.createAsyncSpeechTask(dto);
  }

  @Get('minimax-speech/async/:taskId')
  async querySpeechAsyncTask(@Param('taskId') taskId: string) {
    const normalizedTaskId = taskId?.trim();
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId 鍙傛暟涓嶈兘涓虹┖');
    }
    return this.minimaxSpeechService.queryAsyncSpeechTask(normalizedTaskId);
  }

  @Post('minimax-music')
  async generateMusic(@Body() dto: MinimaxMusicDto, @Req() req: any) {
    return this.withCredits(
      req,
      'minimax-music',
      dto.model,
      async () => this.minimaxMusicService.generateMusic(dto),
    );
  }
}

