import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CREDIT_PRICING_CONFIG,
  ServiceType,
} from './credits.config';
import { TransactionType, ApiResponseStatus } from './dto/credits.dto';
import { PricingResponseDto } from './dto/credits.dto';
import { ReferralService } from '../referral/referral.service';
import {
  buildAdminGiftCreditLotData,
  buildDailyRewardCreditLotData,
  buildFreeMonthlyQuotaCreditLotData,
  buildManualCreditLotData,
} from './credit-lot-grants';
import {
  applyLotDeductionsToSnapshots,
  applyLotRestorationsToSnapshots,
  buildHybridCreditDeductionPlan,
  type HybridCreditDeduction,
} from './credit-lot-ledger';
import {
  hydrateCreditConsumePolicyRecord,
  selectCreditConsumePolicyRecord,
  getDefaultCreditConsumePolicy,
  type CreditLotCandidate,
  type CreditLotStatus,
} from './credit-lot-policy';
import { BusinessPolicyService } from '../business-policy/business-policy.service';
import { MODEL_PROVIDER_MAPPING_SETTING_KEY } from '../ai/services/model-routing.service';
import {
  resolveManagedModelPricing,
  type ManagedPricingMappingLike,
  type ResolvedManagedPricing,
} from '../ai/services/model-pricing-resolver';

const STALE_PENDING_DEFAULT_TIMEOUT_MINUTES = 15;
const STALE_PENDING_DEFAULT_VIDEO_TIMEOUT_MINUTES = 30;
const STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT = '2026-03-28T00:00:00.000Z';
const STALE_PENDING_DEFAULT_BATCH_SIZE = 100;
const DAILY_REWARD_RESET_HOUR = 3;
const FREE_TIER_BENEFITS_SETTING_KEY = 'membership_free_tier_benefits';
const DEFAULT_FREE_USER_MONTHLY_IMAGE_LIMIT = 100;
const DEFAULT_FREE_USER_DAILY_IMAGE_LIMIT = 20;
const DEFAULT_FREE_USER_DAILY_VIDEO_LIMIT = 3;
const STALE_PENDING_IMAGE_SERVICE_TYPES: ServiceType[] = [
  'gemini-3-pro-image',
  'gemini-3.1-image',
  'gemini-2.5-image',
  'gemini-image-edit',
  'gemini-3.1-image-edit',
  'gemini-2.5-image-edit',
  'gemini-image-blend',
  'gemini-3.1-image-blend',
  'gemini-2.5-image-blend',
  'midjourney-imagine',
  'midjourney-variation',
];
const STALE_PENDING_VIDEO_SERVICE_TYPES: ServiceType[] = [
  'wan26-video',
  'wan27-video',
  'kling-video',
  'kling-2.6-video',
  'kling-3.0-video',
  'kling-o3-video',
  'vidu-video',
  'viduq3-pro-video',
  'doubao-video',
];
const FREE_USER_IMAGE_LIMITED_SERVICES: ServiceType[] = [
  ...STALE_PENDING_IMAGE_SERVICE_TYPES,
  'midjourney-upscale',
  'expand-image',
];
const FREE_USER_VIDEO_LIMITED_SERVICES: ServiceType[] = [
  'sora-sd',
  'sora-hd',
  'wan26-video',
  'wan27-video',
  'wan26-r2v',
  'kling-video',
  'kling-2.6-video',
  'kling-3.0-video',
  'kling-o3-video',
  'vidu-video',
  'viduq3-pro-video',
  'doubao-video',
];

export interface DeductCreditsResult {
  success: boolean;
  newBalance: number;
  transactionId: string;
  apiUsageId: string;
}

export interface AddCreditsResult {
  success: boolean;
  newBalance: number;
  transactionId: string;
}

export interface ApiUsageParams {
  userId: string;
  serviceType: ServiceType;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  inputImageCount?: number;
  outputImageCount?: number;
  requestParams?: any;
  ipAddress?: string;
  userAgent?: string;
}

type SoraBillingModel = 'sora-2' | 'sora-2-vip' | 'sora-2-pro';
type KlingBillingModel = 'kling-v2-6' | 'kling-v3-0' | 'kling-o3';
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);
  private readonly freeUserImageQuotaServiceTypes = new Set<ServiceType>(
    FREE_USER_IMAGE_LIMITED_SERVICES,
  );
  private readonly freeUserVideoQuotaServiceTypes = new Set<ServiceType>(
    FREE_USER_VIDEO_LIMITED_SERVICES,
  );

  constructor(
    private prisma: PrismaService,
    private readonly businessPolicyService: BusinessPolicyService,
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
  ) {}

  private async resolveServicePricing(serviceType: ServiceType) {
    const staticPricing = CREDIT_PRICING_CONFIG[serviceType as keyof typeof CREDIT_PRICING_CONFIG];
    const nodeConfig = await this.prisma.nodeConfig.findFirst({
      where: { serviceType },
      select: {
        nameZh: true,
        creditsPerCall: true,
      },
    });

    if (nodeConfig) {
      return {
        ...(staticPricing || {
          provider: 'custom',
          description: `Node-managed pricing for ${serviceType}`,
        }),
        serviceName: nodeConfig.nameZh || staticPricing?.serviceName || serviceType,
        creditsPerCall:
          typeof nodeConfig.creditsPerCall === 'number'
            ? nodeConfig.creditsPerCall
            : staticPricing?.creditsPerCall ?? 0,
      };
    }

    return staticPricing;
  }

  private asJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, any> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    return null;
  }

  private normalizeChannel(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const value = raw.trim().toLowerCase();
    if (!value) return null;
    if (value.includes('apimart')) return 'apimart';
    if (value === 'legacy' || value.includes('147')) return '147';
    return value;
  }

  private normalizeSoraBillingModel(raw: unknown): SoraBillingModel | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim().toLowerCase();
    if (value === 'sora-2' || value === 'sora-2-vip' || value === 'sora-2-pro') {
      return value;
    }
    return null;
  }

  private resolveSoraModelCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
    model?: string,
  ): number {
    if (serviceType !== 'sora-sd' && serviceType !== 'sora-hd') {
      return defaultCredits;
    }

    const servicePricing = CREDIT_PRICING_CONFIG[serviceType] as any;
    const modelPricing = servicePricing?.modelPricing;
    if (!modelPricing || typeof modelPricing !== 'object') {
      return defaultCredits;
    }

    const selectedModel =
      this.normalizeSoraBillingModel(requestParams?.soraModel) ||
      this.normalizeSoraBillingModel(model);
    if (!selectedModel) {
      return defaultCredits;
    }

    const configuredCredits = Number(modelPricing?.[selectedModel]?.creditsPerCall);
    if (Number.isFinite(configuredCredits) && configuredCredits > 0) {
      return configuredCredits;
    }

    return defaultCredits;
  }

  /**
   * Sora 视频服务：Pro 模型（750 积分）显示「Sora 2 Pro 视频生成」，标准/VIP 模型显示「Sora2 视频生成」
   */
  private resolveSoraServiceName(
    serviceType: ServiceType,
    defaultServiceName: string,
    requestParams: any,
    model?: string,
  ): string {
    if (serviceType !== 'sora-sd' && serviceType !== 'sora-hd') {
      return defaultServiceName;
    }

    const selectedModel =
      this.normalizeSoraBillingModel(requestParams?.soraModel) ||
      this.normalizeSoraBillingModel(model);
    if (selectedModel === 'sora-2-pro') {
      return serviceType === 'sora-hd' ? 'Sora 2 Pro 高清视频' : 'Sora 2 Pro 视频生成';
    }

    return defaultServiceName;
  }

  private normalizeKlingBillingModel(
    raw: unknown,
    serviceType: ServiceType,
  ): KlingBillingModel | null {
    if (typeof raw === 'string') {
      const value = raw.trim().toLowerCase();
      if (value === 'kling-v2-6') return 'kling-v2-6';
      if (value === 'kling-v3-0') return 'kling-v3-0';
      if (value === 'kling-o3' || value === 'kling-v3-omni') return 'kling-o3';
    }

    if (serviceType === 'kling-3.0-video') return 'kling-v3-0';
    if (serviceType === 'kling-2.6-video' || serviceType === 'kling-video') {
      return 'kling-v2-6';
    }
    if (serviceType === 'kling-o3-video') return 'kling-o3';

    return null;
  }

  private normalizeKlingMode(raw: unknown): 'std' | 'pro' {
    if (typeof raw === 'string' && raw.trim().toLowerCase() === 'pro') {
      return 'pro';
    }
    return 'std';
  }

  private async resolveManagedRoutePricing(
    requestParams: any,
  ): Promise<ResolvedManagedPricing | null> {
    const modelKey =
      typeof requestParams?.modelKey === 'string' ? requestParams.modelKey.trim() : '';
    const vendorKey =
      typeof requestParams?.vendorKey === 'string' ? requestParams.vendorKey.trim() : '';
    if (!modelKey || !vendorKey) return null;

    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: MODEL_PROVIDER_MAPPING_SETTING_KEY },
        select: { value: true },
      });
      const raw = typeof setting?.value === 'string' ? setting.value.trim() : '';
      if (!raw) return null;

      const parsed = JSON.parse(raw) as ManagedPricingMappingLike;
      const resolved = resolveManagedModelPricing(parsed, modelKey, vendorKey, requestParams);
      return resolved.source === 'none' ? null : resolved;
    } catch (error) {
      this.logger.warn(
        `读取模型管理线路积分失败，回退服务定价: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private normalizeKlingDuration(raw: unknown): 5 | 10 | null {
    const value = Number(raw);
    if (value === 5 || value === 10) return value;
    return null;
  }

  private normalizeKlingSound(raw: unknown): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return false;
    const value = raw.trim().toLowerCase();
    if (['on', 'yes', 'true', '1'].includes(value)) return true;
    if (['off', 'no', 'false', '0'].includes(value)) return false;
    return false;
  }

  private resolveKlingModelCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    const model = this.normalizeKlingBillingModel(requestParams?.klingModel, serviceType);
    if (model !== 'kling-v2-6' && model !== 'kling-v3-0') {
      return defaultCredits;
    }

    const duration = this.normalizeKlingDuration(requestParams?.duration);
    if (!duration) {
      return defaultCredits;
    }

    const mode = this.normalizeKlingMode(requestParams?.mode);
    const hasSound = this.normalizeKlingSound(requestParams?.sound);
    const pricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const matrix = hasSound ? pricing?.dynamicPricing?.withSound : pricing?.dynamicPricing?.noSound;
    const configuredCredits = Number(matrix?.[mode]?.[String(duration)]);
    if (Number.isFinite(configuredCredits) && configuredCredits > 0) {
      return configuredCredits;
    }

    return defaultCredits;
  }

  private resolveKlingServiceName(
    serviceType: ServiceType,
    defaultServiceName: string,
    requestParams: any,
  ): string {
    const model = this.normalizeKlingBillingModel(requestParams?.klingModel, serviceType);
    if (model !== 'kling-v2-6' && model !== 'kling-v3-0') {
      return defaultServiceName;
    }

    const mode = this.normalizeKlingMode(requestParams?.mode);
    const hasSound = this.normalizeKlingSound(requestParams?.sound);
    const duration = this.normalizeKlingDuration(requestParams?.duration);

    const modelLabel = model === 'kling-v3-0' ? 'Kling 3.0' : 'Kling 2.6';
    const modeLabel = mode === 'pro' ? 'Pro' : 'Std';
    const soundLabel = hasSound ? '有音效' : '无音效';

    if (duration) {
      return `可灵 ${modelLabel} 视频（${soundLabel} / ${modeLabel} / ${duration}秒）`;
    }
    return `可灵 ${modelLabel} 视频（${soundLabel} / ${modeLabel}）`;
  }

  private resolveManagedVideoServiceName(
    serviceType: ServiceType,
    defaultServiceName: string,
    requestParams: any,
  ): string {
    if (serviceType !== 'doubao-video') {
      return defaultServiceName;
    }

    const modelKey =
      typeof requestParams?.modelKey === 'string' ? requestParams.modelKey.trim().toLowerCase() : '';
    const seedanceModel =
      typeof requestParams?.seedanceModel === 'string'
        ? requestParams.seedanceModel.trim().toLowerCase()
        : '';

    if (
      seedanceModel === 'seedance-2.0-fast' ||
      seedanceModel === '2.0-fast'
    ) {
      return 'Seedance 2.0 Fast视频生成';
    }

    if (
      modelKey === 'seedance-2.0' ||
      seedanceModel === 'seedance-2.0' ||
      seedanceModel === '2.0'
    ) {
      return 'Seedance 2.0视频生成';
    }

    if (
      modelKey === 'seedance-1.5' ||
      seedanceModel === 'seedance-1.5-pro' ||
      seedanceModel === '1.5-pro'
    ) {
      return 'Seedance 1.5 Pro视频生成';
    }

    return defaultServiceName;
  }

  /**
   * 根据分辨率解析积分定价
   * 支持按分辨率差异化计费的服务（由 pricing.resolutionPricing 控制）
   */
  private resolveImageResolutionCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    const servicePricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const resolutionPricing = servicePricing?.resolutionPricing;
    if (!resolutionPricing || typeof resolutionPricing !== 'object') {
      return defaultCredits;
    }

    // 获取请求的分辨率
    const requestedImageSize = requestParams?.imageSize;
    if (!requestedImageSize || typeof requestedImageSize !== 'string') {
      return defaultCredits;
    }

    // 标准化分辨率格式（支持 '4K', '2K', '1K', '0.5K' 等）
    const normalizedSize = requestedImageSize.trim().toUpperCase();
    
    // 查找匹配的分辨率定价
    const configuredCredits = Number(resolutionPricing[normalizedSize]);
    if (Number.isFinite(configuredCredits) && configuredCredits > 0) {
      return configuredCredits;
    }

    // 如果没有找到匹配的分辨率，返回默认值
    return defaultCredits;
  }

  private toCreditLotCandidate(lot: {
    id: string;
    sourceType: string;
    validityType: string;
    scopeType: string | null;
    scopeValue: string | null;
    totalAmount: number;
    remainingAmount: number;
    grantedAt: Date;
    activeAt: Date;
    expiresAt: Date | null;
    priority: number;
    status: string;
  }): CreditLotCandidate {
    return {
      id: lot.id,
      sourceType: lot.sourceType as CreditLotCandidate['sourceType'],
      validityType: lot.validityType as CreditLotCandidate['validityType'],
      scopeType: (lot.scopeType ?? 'global') as CreditLotCandidate['scopeType'],
      scopeValue: lot.scopeValue,
      totalAmount: lot.totalAmount,
      remainingAmount: lot.remainingAmount,
      grantedAt: lot.grantedAt,
      activeAt: lot.activeAt,
      expiresAt: lot.expiresAt,
      priority: lot.priority,
      status: lot.status as CreditLotStatus,
    };
  }

  private extractLotDeductionsFromMetadata(
    metadata: Prisma.JsonValue | null | undefined,
  ): HybridCreditDeduction[] {
    const payload = this.asJsonObject(metadata);
    const rawDeductions = Array.isArray(payload?.deductions) ? payload?.deductions : [];

    const deductions: HybridCreditDeduction[] = [];
    for (const item of rawDeductions) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      const kind = entry.kind === 'lot' ? 'lot' : entry.kind === 'legacy_balance' ? 'legacy_balance' : null;
      const amount = typeof entry.amount === 'number' ? Math.floor(entry.amount) : NaN;
      const lotId = typeof entry.lotId === 'string' && entry.lotId.trim().length > 0 ? entry.lotId : undefined;
      if (!kind || !Number.isFinite(amount) || amount <= 0) continue;
      if (kind === 'lot' && !lotId) continue;

      deductions.push(
        kind === 'lot'
          ? { kind, lotId, amount }
          : { kind, amount },
      );
    }

    return deductions;
  }

  private buildLotDeductionsMetadata(
    deductions: HybridCreditDeduction[],
  ): Prisma.InputJsonValue {
    return {
      deductions: deductions.map((item) =>
        item.kind === 'lot'
          ? {
              kind: item.kind,
              lotId: item.lotId,
              amount: item.amount,
            }
          : {
              kind: item.kind,
              amount: item.amount,
            },
      ),
    } as Prisma.InputJsonValue;
  }

  private getDailyRewardMetadata(
    consecutiveDays: number,
    bonusCredits: number,
    baseCredits: number,
    rewardMultiplier = 1,
    tierCode?: string,
  ): Prisma.InputJsonValue {
    return {
      reason: 'daily_reward',
      consecutiveDays,
      baseCredits,
      rewardMultiplier,
      ...(tierCode ? { tierCode } : {}),
      ...(bonusCredits > 0
        ? {
          bonusCredits,
        }
        : {}),
    } as Prisma.InputJsonValue;
  }

  private normalizeDailyRewardTierCode(raw: string | null | undefined): 'free' | 'vip_69' | 'vip_199' | 'vip_599' {
    if (!raw) return 'free';
    const value = raw.trim().toLowerCase();
    if (!value || value === 'free') return 'free';
    if (value.includes('599')) return 'vip_599';
    if (value.includes('199')) return 'vip_199';
    if (value.includes('69')) return 'vip_69';
    return 'free';
  }

  private async resolveDailyRewardRuleForUser(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<{
    tierCode: 'free' | 'vip_69' | 'vip_199' | 'vip_599';
    baseCredits: number;
    rewardMultiplier: number;
  }> {
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();

    try {
      const entitlement = await client.membershipEntitlementSnapshot.findUnique({
        where: { userId },
        select: {
          currentPlanCode: true,
          membershipStatus: true,
          currentPeriodEndAt: true,
        },
      });

      const isActiveVip =
        entitlement?.membershipStatus === 'active' &&
        entitlement.currentPeriodEndAt instanceof Date &&
        entitlement.currentPeriodEndAt.getTime() > Date.now();

      const tierCode = isActiveVip
        ? this.normalizeDailyRewardTierCode(entitlement?.currentPlanCode)
        : 'free';

      let baseCredits = policy.dailyRewardCredits;

      if (tierCode !== 'free') {
        let membershipGiftCredits = 0;
        const activeSubscription = await client.userMembershipSubscription.findFirst({
          where: {
            userId,
            status: 'active',
            currentPeriodStartAt: { lte: new Date() },
            currentPeriodEndAt: { gt: new Date() },
          },
          select: {
            snapshot: true,
            membershipPlanId: true,
          },
          orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
        });

        const snapshot =
          activeSubscription?.snapshot &&
          typeof activeSubscription.snapshot === 'object' &&
          !Array.isArray(activeSubscription.snapshot)
            ? (activeSubscription.snapshot as Prisma.JsonObject)
            : null;

        if (typeof snapshot?.dailyGiftCredits === 'number' && Number.isFinite(snapshot.dailyGiftCredits)) {
          membershipGiftCredits = Math.trunc(snapshot.dailyGiftCredits);
        } else if (typeof snapshot?.dailyGiftCredits === 'string' && Number.isFinite(Number(snapshot.dailyGiftCredits))) {
          membershipGiftCredits = Math.trunc(Number(snapshot.dailyGiftCredits));
        } else if (activeSubscription?.membershipPlanId) {
          const plan = await client.membershipPlan.findUnique({
            where: { id: activeSubscription.membershipPlanId },
            select: { dailyGiftCredits: true },
          });
          if (typeof plan?.dailyGiftCredits === 'number' && Number.isFinite(plan.dailyGiftCredits)) {
            membershipGiftCredits = Math.trunc(plan.dailyGiftCredits);
          }
        }

        baseCredits = Math.max(0, membershipGiftCredits);
      }

      return {
        tierCode,
        baseCredits,
        rewardMultiplier: Math.max(1, policy.consecutive7DayRewardMultiplier),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        return {
          tierCode: 'free',
          baseCredits: policy.dailyRewardCredits,
          rewardMultiplier: Math.max(1, policy.consecutive7DayRewardMultiplier),
        };
      }
      throw error;
    }
  }

  private async resolveCreditConsumePolicy(
    client: PrismaService | Prisma.TransactionClient,
    scope?: {
      serviceType?: string | null;
      provider?: string | null;
      model?: string | null;
    },
  ) {
    const records = await client.creditConsumePolicy.findMany({
      where: {
        isActive: true,
        OR: [
          { scopeType: 'global' },
          ...(scope?.serviceType ? [{ scopeType: 'service_type', scopeValue: scope.serviceType }] : []),
          ...(scope?.provider ? [{ scopeType: 'provider', scopeValue: scope.provider }] : []),
          ...(scope?.model ? [{ scopeType: 'model', scopeValue: scope.model }] : []),
        ],
      },
      select: {
        code: true,
        version: true,
        scopeType: true,
        scopeValue: true,
        sorts: true,
        validityPriority: true,
        sourcePriority: true,
      },
    });

    const record = selectCreditConsumePolicyRecord(records, scope);
    if (!record) {
      return getDefaultCreditConsumePolicy();
    }

    return hydrateCreditConsumePolicyRecord(record);
  }

  private addDays(base: Date, days: number): Date {
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next;
  }

  private getDailyRewardBusinessDayAnchor(date: Date): Date {
    const anchor = new Date(date);
    anchor.setMinutes(0, 0, 0);

    if (anchor.getHours() < DAILY_REWARD_RESET_HOUR) {
      anchor.setDate(anchor.getDate() - 1);
    }

    anchor.setHours(DAILY_REWARD_RESET_HOUR, 0, 0, 0);
    return anchor;
  }

  private diffDailyRewardBusinessDays(now: Date, last: Date): number {
    const nowAnchor = this.getDailyRewardBusinessDayAnchor(now);
    const lastAnchor = this.getDailyRewardBusinessDayAnchor(last);
    return Math.floor((nowAnchor.getTime() - lastAnchor.getTime()) / (24 * 60 * 60 * 1000));
  }

  private resolveFreeMonthlyQuotaCycleWindow(
    anchorAt: Date,
    now: Date,
    cycleDays: number,
  ): { cycleStartAt: Date; cycleEndAt: Date } {
    const safeCycleDays = Math.max(1, Math.floor(cycleDays));
    const elapsedMs = Math.max(0, now.getTime() - anchorAt.getTime());
    const cycleIndex = Math.floor(elapsedMs / (safeCycleDays * 24 * 60 * 60 * 1000));
    const cycleStartAt = this.addDays(anchorAt, cycleIndex * safeCycleDays);
    const cycleEndAt = this.addDays(cycleStartAt, safeCycleDays);

    return {
      cycleStartAt,
      cycleEndAt,
    };
  }

  private async grantFreeUserMonthlyQuotaIfNeeded(params: {
    userId: string;
    account: {
      id: string;
      balance: number;
      totalEarned: number;
    };
    userCreatedAt?: Date;
    now?: Date;
  }): Promise<boolean> {
    const now = params.now ?? new Date();
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();
    if (policy.freeUserMonthlyQuotaCredits <= 0) {
      return false;
    }

    const userCreatedAt =
      params.userCreatedAt ??
      (
        await this.prisma.user.findUnique({
          where: { id: params.userId },
          select: { createdAt: true },
        })
      )?.createdAt;
    if (!userCreatedAt) {
      return false;
    }

    const { cycleStartAt, cycleEndAt } = this.resolveFreeMonthlyQuotaCycleWindow(
      userCreatedAt,
      now,
      policy.membershipRefreshCycleDays,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "CreditAccount" WHERE id = ${params.account.id} FOR UPDATE`,
      );

      const account = await tx.creditAccount.findUniqueOrThrow({
        where: { id: params.account.id },
        select: {
          id: true,
          balance: true,
          totalEarned: true,
        },
      });

      const activeSubscription = await tx.userMembershipSubscription.findFirst({
        where: {
          userId: params.userId,
          status: 'active',
          currentPeriodStartAt: { lte: now },
          currentPeriodEndAt: { gt: now },
        },
        select: { id: true },
      });
      if (activeSubscription) {
        return false;
      }

      const existingGrant = await tx.creditTransaction.findFirst({
        where: {
          accountId: account.id,
          businessType: 'free_monthly_quota',
          createdAt: {
            gte: cycleStartAt,
            lt: cycleEndAt,
          },
        },
        select: { id: true },
      });
      if (existingGrant) {
        return false;
      }

      const lot = await tx.creditLot.create({
        data: buildFreeMonthlyQuotaCreditLotData({
          accountId: account.id,
          amount: policy.freeUserMonthlyQuotaCredits,
          grantedAt: now,
          activeAt: now,
          expiresAt: cycleEndAt,
          durationDays: Math.max(
            1,
            Math.ceil((cycleEndAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
          ),
          metadata: {
            grantedBy: 'free_user_monthly_quota',
            cycleStartAt: cycleStartAt.toISOString(),
            cycleEndAt: cycleEndAt.toISOString(),
          },
        }),
      });

      const balanceBefore = account.balance;
      const balanceAfter = balanceBefore + policy.freeUserMonthlyQuotaCredits;

      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: balanceAfter,
          totalEarned: account.totalEarned + policy.freeUserMonthlyQuotaCredits,
        },
      });

      await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.EARN,
          amount: policy.freeUserMonthlyQuotaCredits,
          balanceBefore,
          balanceAfter,
          description: '免费用户月度额度发放',
          creditLotId: lot.id,
          businessType: 'free_monthly_quota',
          metadata: {
            cycleStartAt: cycleStartAt.toISOString(),
            cycleEndAt: cycleEndAt.toISOString(),
          },
        },
      });

      return true;
    });
  }

  private extractChannelFromApiUsage(apiUsage?: {
    provider?: string | null;
    model?: string | null;
    requestParams?: Prisma.JsonValue | null;
  } | null): string | null {
    if (!apiUsage) return null;
    const params = this.asJsonObject(apiUsage.requestParams);
    const candidates = [
      params?.channel,
      params?.providerChannel,
      params?.executionChannel,
      params?.channelHint,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const normalized = this.normalizeChannel(candidate);
        if (normalized) return normalized;
      }
    }

    if (typeof apiUsage.model === 'string') {
      const normalizedModel = apiUsage.model.toLowerCase();
      if (normalizedModel.includes('147') || normalizedModel.includes('banana')) return '147';
      if (normalizedModel.includes('apimart') || normalizedModel.includes('nano2')) return 'apimart';
    }

    if (apiUsage.provider === 'nano2') return 'apimart';
    if (apiUsage.provider?.startsWith('banana')) return '147';
    return null;
  }

  private parsePositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private getStalePendingTimeoutMinutes(): number {
    return this.parsePositiveIntEnv(
      'CREDITS_PENDING_TIMEOUT_MINUTES',
      STALE_PENDING_DEFAULT_TIMEOUT_MINUTES,
    );
  }

  private getStalePendingVideoTimeoutMinutes(): number {
    return this.parsePositiveIntEnv(
      'CREDITS_PENDING_VIDEO_TIMEOUT_MINUTES',
      STALE_PENDING_DEFAULT_VIDEO_TIMEOUT_MINUTES,
    );
  }

  private getStalePendingVideoRefundCutoverAt(): Date | null {
    const raw = process.env.CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT;
    const trimmed = raw?.trim();

    if (trimmed) {
      const normalized = trimmed.toLowerCase();
      if (normalized === 'off' || normalized === 'none' || normalized === '0') {
        return null;
      }

      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
      this.logger.warn(
        `Invalid CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT=${trimmed}, fallback to default ${STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT}`,
      );
    }

    const fallback = new Date(STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT);
    if (Number.isNaN(fallback.getTime())) {
      this.logger.warn(
        `Invalid default video refund cutover date ${STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT}, disable cutover filter`,
      );
      return null;
    }
    return fallback;
  }

  private getStalePendingBatchSize(): number {
    return this.parsePositiveIntEnv(
      'CREDITS_PENDING_TIMEOUT_BATCH_SIZE',
      STALE_PENDING_DEFAULT_BATCH_SIZE,
    );
  }

  private async getFreeTierBenefitsSetting(): Promise<Record<string, unknown> | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: FREE_TIER_BENEFITS_SETTING_KEY },
      select: { value: true },
    });
    if (!setting?.value) return null;

    try {
      const parsed = JSON.parse(setting.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      this.logger.warn(`免费用户权益配置解析失败 key=${FREE_TIER_BENEFITS_SETTING_KEY}`);
    }

    return null;
  }

  private getFreeUserMonthlyImageLimit(): number {
    const raw = process.env.FREE_USER_MONTHLY_IMAGE_LIMIT;
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_FREE_USER_MONTHLY_IMAGE_LIMIT;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_FREE_USER_MONTHLY_IMAGE_LIMIT;
    }
    return parsed;
  }

  private async getFreeUserDailyImageLimit(): Promise<number> {
    const configuredValue = (await this.getFreeTierBenefitsSetting())?.imageDailyLimit;
    const configuredLimit =
      typeof configuredValue === 'number'
        ? Math.trunc(configuredValue)
        : typeof configuredValue === 'string' && configuredValue.trim()
          ? Math.trunc(Number(configuredValue))
          : NaN;
    if (Number.isFinite(configuredLimit) && configuredLimit >= 0) {
      return configuredLimit;
    }

    const raw = process.env.FREE_USER_DAILY_IMAGE_LIMIT;
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_FREE_USER_DAILY_IMAGE_LIMIT;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_FREE_USER_DAILY_IMAGE_LIMIT;
    }
    return parsed;
  }

  private async getFreeUserDailyVideoLimit(): Promise<number> {
    const configuredValue = (await this.getFreeTierBenefitsSetting())?.videoDailyLimit;
    const configuredLimit =
      typeof configuredValue === 'number'
        ? Math.trunc(configuredValue)
        : typeof configuredValue === 'string' && configuredValue.trim()
          ? Math.trunc(Number(configuredValue))
          : NaN;
    if (Number.isFinite(configuredLimit) && configuredLimit >= 0) {
      return configuredLimit;
    }

    const raw = process.env.FREE_USER_DAILY_VIDEO_LIMIT;
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_FREE_USER_DAILY_VIDEO_LIMIT;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_FREE_USER_DAILY_VIDEO_LIMIT;
    }
    return parsed;
  }

  private isFreeUserImageQuotaService(serviceType: ServiceType): boolean {
    return this.freeUserImageQuotaServiceTypes.has(serviceType);
  }

  private isFreeUserVideoQuotaService(serviceType: ServiceType): boolean {
    return this.freeUserVideoQuotaServiceTypes.has(serviceType);
  }

  private resolveImageQuotaRequestCount(requestedOutputImageCount?: number): number {
    if (!Number.isFinite(requestedOutputImageCount)) {
      return 1;
    }
    const normalized = Math.floor(Number(requestedOutputImageCount));
    return normalized > 0 ? normalized : 1;
  }

  private getUtcMonthRange(now: Date): { start: Date; end: Date; label: string } {
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
    const label = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    return { start, end, label };
  }

  private getUtcDayRange(now: Date): { start: Date; end: Date; label: string } {
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    const day = now.getUTCDate();
    const start = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIndex, day + 1, 0, 0, 0, 0));
    const label = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { start, end, label };
  }

  private async countImageQuotaUsage(
    client: PrismaService | Prisma.TransactionClient,
    where: Prisma.ApiUsageRecordWhereInput,
  ): Promise<number> {
    const [knownCountAggregate, unknownCount] = await Promise.all([
      client.apiUsageRecord.aggregate({
        where: {
          ...where,
          outputImageCount: { not: null },
        },
        _sum: {
          outputImageCount: true,
        },
      }),
      client.apiUsageRecord.count({
        where: {
          ...where,
          outputImageCount: null,
        },
      }),
    ]);

    return (knownCountAggregate._sum.outputImageCount ?? 0) + unknownCount;
  }

  private async countVideoQuotaUsage(
    client: PrismaService | Prisma.TransactionClient,
    where: Prisma.ApiUsageRecordWhereInput,
  ): Promise<number> {
    return client.apiUsageRecord.count({ where });
  }

  private async isUsageQuotaExemptUser(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const [paidOrder, userProfile] = await Promise.all([
      client.paymentOrder.findFirst({
        where: {
          userId,
          status: 'paid',
        },
        select: { id: true },
      }),
      client.user.findUnique({
        where: { id: userId },
        select: { role: true, noWatermark: true },
      }),
    ]);

    if (paidOrder) return true;
    if (userProfile?.noWatermark === true) return true;
    const role = typeof userProfile?.role === 'string' ? userProfile.role.toLowerCase() : '';
    return role === 'admin' || role === 'normal_admin';
  }

  private async enforceFreeUserImageQuota(
    client: PrismaService | Prisma.TransactionClient,
    params: {
      userId: string;
      serviceType: ServiceType;
      requestedOutputImageCount?: number;
    },
  ): Promise<void> {
    const { userId, serviceType, requestedOutputImageCount } = params;
    const monthlyLimit = this.getFreeUserMonthlyImageLimit();
    const dailyLimit = await this.getFreeUserDailyImageLimit();

    if (monthlyLimit <= 0 && dailyLimit <= 0) return;
    if (!this.isFreeUserImageQuotaService(serviceType)) return;

    const isQuotaExemptUser = await this.isUsageQuotaExemptUser(client, userId);
    if (isQuotaExemptUser) return;

    const requestedCount = this.resolveImageQuotaRequestCount(requestedOutputImageCount);
    const now = new Date();
    const baseWhere: Prisma.ApiUsageRecordWhereInput = {
      userId,
      serviceType: { in: FREE_USER_IMAGE_LIMITED_SERVICES },
      responseStatus: { in: [ApiResponseStatus.PENDING, ApiResponseStatus.SUCCESS] },
    };

    if (dailyLimit > 0) {
      const { start, end, label } = this.getUtcDayRange(now);
      const usedCount = await this.countImageQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: start,
          lt: end,
        },
      });

      if (usedCount + requestedCount > dailyLimit) {
        this.logger.warn(
          `免费用户日生图配额超限 userId=${userId} day=${label} used=${usedCount} requested=${requestedCount} limit=${dailyLimit}`,
        );
        throw new BadRequestException(
          `免费用户每天最多可生图 ${dailyLimit} 张（UTC ${label}）。今日已使用 ${usedCount} 张，本次请求 ${requestedCount} 张。请明天再试或升级付费套餐。`,
        );
      }
    }

    if (monthlyLimit > 0) {
      const { start, end, label } = this.getUtcMonthRange(now);
      const usedCount = await this.countImageQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: start,
          lt: end,
        },
      });

      if (usedCount + requestedCount > monthlyLimit) {
        this.logger.warn(
          `免费用户月生图配额超限 userId=${userId} month=${label} used=${usedCount} requested=${requestedCount} limit=${monthlyLimit}`,
        );
        throw new BadRequestException(
          `免费用户每月最多可生图 ${monthlyLimit} 张（UTC ${label}）。本月已使用 ${usedCount} 张，本次请求 ${requestedCount} 张。请下月再试或升级付费套餐。`,
        );
      }
    }
  }

  private async enforceFreeUserVideoQuota(
    client: PrismaService | Prisma.TransactionClient,
    params: {
      userId: string;
      serviceType: ServiceType;
    },
  ): Promise<void> {
    const { userId, serviceType } = params;
    const dailyLimit = await this.getFreeUserDailyVideoLimit();

    if (dailyLimit <= 0) return;
    if (!this.isFreeUserVideoQuotaService(serviceType)) return;

    const isQuotaExemptUser = await this.isUsageQuotaExemptUser(client, userId);
    if (isQuotaExemptUser) return;

    const { start, end, label } = this.getUtcDayRange(new Date());
    const usedCount = await this.countVideoQuotaUsage(client, {
      userId,
      serviceType: { in: FREE_USER_VIDEO_LIMITED_SERVICES },
      responseStatus: { in: [ApiResponseStatus.PENDING, ApiResponseStatus.SUCCESS] },
      createdAt: {
        gte: start,
        lt: end,
      },
    });
    const requestedCount = 1;

    if (usedCount + requestedCount > dailyLimit) {
      this.logger.warn(
        `免费用户日生视频配额超限 userId=${userId} day=${label} used=${usedCount} requested=${requestedCount} limit=${dailyLimit}`,
      );
      throw new BadRequestException(
        `免费用户每天最多可生成视频 ${dailyLimit} 个（UTC ${label}）。今日已使用 ${usedCount} 个，本次请求 ${requestedCount} 个。请明天再试或充值解锁。`,
      );
    }
  }

  async assertFreeUserUsageQuota(
    userId: string,
    serviceType: ServiceType,
    requestedOutputImageCount?: number,
  ): Promise<void> {
    await this.enforceFreeUserImageQuota(this.prisma, {
      userId,
      serviceType,
      requestedOutputImageCount,
    });
    await this.enforceFreeUserVideoQuota(this.prisma, {
      userId,
      serviceType,
    });
  }

  async assertFreeUserImageQuota(
    userId: string,
    serviceType: ServiceType,
    requestedOutputImageCount?: number,
  ): Promise<void> {
    await this.assertFreeUserUsageQuota(userId, serviceType, requestedOutputImageCount);
  }

  /**
   * 判断用户是否为付费用户（有成功支付的订单）
   */
  async isPaidUser(userId: string): Promise<boolean> {
    const paidOrder = await this.prisma.paymentOrder.findFirst({
      where: {
        userId,
        status: 'paid',
      },
    });
    return !!paidOrder;
  }

  /**
   * 获取或创建用户积分账户
   * 使用双重检查锁定模式（Double-Checked Locking）避免并发创建冲突
   */
  async getOrCreateAccount(userId: string) {
    let userCreatedAt: Date | undefined;

    // 第一次检查：快速路径，绝大多数场景直接命中
    let account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (account) {
      userCreatedAt = (
        await this.prisma.user.findUnique({
          where: { id: userId },
          select: { createdAt: true },
        })
      )?.createdAt;
      const granted = await this.grantFreeUserMonthlyQuotaIfNeeded({
        userId,
        account,
        userCreatedAt,
      });
      if (!granted) {
        return account;
      }

      return this.prisma.creditAccount.findUniqueOrThrow({
        where: { userId },
      });
    }

    // 第二次检查：在事务内部再次检查，避免并发创建冲突
    try {
      account = await this.prisma.$transaction(async (tx) => {
        // 在事务中再次查询，确保在创建前账户不存在
        // 这样可以避免两个并发请求同时创建的情况
        const existingAccount = await tx.creditAccount.findUnique({
          where: { userId },
        });

        if (existingAccount) {
          return existingAccount;
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { createdAt: true },
        });
        userCreatedAt = user?.createdAt;

        // 新用户不再发放注册积分；仅初始化账户，后续按免费用户月度额度规则补发。
        const newAccount = await tx.creditAccount.create({
          data: {
            userId,
            balance: 0,
            totalEarned: 0,
          },
        });

        return newAccount;
      }, {
        // 设置事务超时和隔离级别
        timeout: 10000, // 10秒超时
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });

      const granted = await this.grantFreeUserMonthlyQuotaIfNeeded({
        userId,
        account,
        userCreatedAt,
      });
      if (!granted) {
        return account;
      }

      return this.prisma.creditAccount.findUniqueOrThrow({
        where: { userId },
      });
    } catch (error) {
      // 如果仍然发生唯一约束冲突（理论上不应该，但作为最后的安全网）
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(`检测到并发创建账户冲突 userId=${userId}，重新查询`);
        const existingAccount = await this.prisma.creditAccount.findUnique({
          where: { userId },
        });
        if (!existingAccount) {
          // 如果仍然找不到，记录错误并抛出
          this.logger.error(`P2002错误后未找到账户 userId=${userId}`);
          throw error;
        }
        const granted = await this.grantFreeUserMonthlyQuotaIfNeeded({
          userId,
          account: existingAccount,
        });
        if (!granted) {
          return existingAccount;
        }

        return this.prisma.creditAccount.findUniqueOrThrow({
          where: { userId },
        });
      }
      throw error;
    }
  }

  async issueFreeUserMonthlyQuotaCredits(now = new Date()) {
    const activeSubscriptionUserIds = new Set(
      (
        await this.prisma.userMembershipSubscription.findMany({
          where: {
            status: 'active',
            currentPeriodStartAt: { lte: now },
            currentPeriodEndAt: { gt: now },
          },
          select: { userId: true },
        })
      ).map((item) => item.userId),
    );

    const users = await this.prisma.user.findMany({
      where: {
        status: 'active',
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    let affectedUsers = 0;
    let grantedCredits = 0;
    let createdLots = 0;

    for (const user of users) {
      if (activeSubscriptionUserIds.has(user.id)) {
        continue;
      }

      const account = await this.getOrCreateAccount(user.id);
      const granted = await this.grantFreeUserMonthlyQuotaIfNeeded({
        userId: user.id,
        account,
        userCreatedAt: user.createdAt,
        now,
      });
      if (!granted) {
        continue;
      }

      const policy = await this.businessPolicyService.getMembershipCreditPolicy();
      affectedUsers += 1;
      grantedCredits += policy.freeUserMonthlyQuotaCredits;
      createdLots += 1;
    }

    return {
      affectedUsers,
      grantedCredits,
      createdLots,
    };
  }

  /**
   * 获取用户积分余额
   */
  async getBalance(userId: string): Promise<number> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }
    return account.balance;
  }

  /**
   * 获取用户积分账户详情
   */
  async getAccountDetails(userId: string) {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }
    return {
      balance: account.balance,
      totalEarned: account.totalEarned,
      totalSpent: account.totalSpent,
    };
  }

  /**
   * 检查用户是否有足够积分
   */
  async hasEnoughCredits(userId: string, serviceType: ServiceType): Promise<boolean> {
    const pricing = await this.resolveServicePricing(serviceType);
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }

    const balance = await this.getBalance(userId);
    return balance >= pricing.creditsPerCall;
  }

  /**
   * 获取服务定价
   */
  async getServicePricing(serviceType: ServiceType) {
    const pricing = await this.resolveServicePricing(serviceType);
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }
    return {
      serviceType,
      ...pricing,
    };
  }

  /**
   * 获取所有服务定价
   */
  async getAllPricing(): Promise<PricingResponseDto[]> {
    const staticEntries = new Map(
      Object.entries(CREDIT_PRICING_CONFIG).map(([key, value]) => [
        key,
        {
          serviceType: key,
          ...value,
        } as PricingResponseDto,
      ]),
    );
    const nodeConfigs = await this.prisma.nodeConfig.findMany({
      where: {
        serviceType: {
          not: null,
        },
      },
      select: {
        serviceType: true,
        nameZh: true,
        creditsPerCall: true,
      },
    });

    for (const item of nodeConfigs) {
      const serviceType =
        typeof item.serviceType === 'string' ? item.serviceType.trim() : '';
      if (!serviceType) continue;

      const fallback = staticEntries.get(serviceType);
      staticEntries.set(serviceType, {
        serviceType,
        serviceName: item.nameZh || fallback?.serviceName || serviceType,
        provider: fallback?.provider || 'custom',
        creditsPerCall:
          typeof item.creditsPerCall === 'number'
            ? item.creditsPerCall
            : (fallback?.creditsPerCall ?? 0),
        description:
          fallback?.description ||
          `Node-managed pricing for ${item.nameZh || item.serviceType}`,
        maxInputTokens: fallback?.maxInputTokens,
        maxContextLength: fallback?.maxContextLength,
      });
    }

    return Array.from(staticEntries.values());
  }

  /**
   * 预扣积分（在API调用前）
   * 返回 API 使用记录 ID，用于后续更新状态
   */
  async preDeductCredits(params: ApiUsageParams): Promise<DeductCreditsResult> {
    const { userId, serviceType, model, inputTokens, outputTokens, inputImageCount, outputImageCount, requestParams, ipAddress, userAgent } = params;
    const requestedProvider = typeof requestParams?.aiProvider === 'string'
      ? requestParams.aiProvider.trim().toLowerCase()
      : '';

    const pricing = await this.resolveServicePricing(serviceType);
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }

    let creditsToDeduct: number = pricing.creditsPerCall;
    const managedRoutePricing = await this.resolveManagedRoutePricing(requestParams);
    if (typeof managedRoutePricing?.price?.credits === 'number') {
      creditsToDeduct = managedRoutePricing.price.credits;
    }

    const effectiveRequestParams =
      managedRoutePricing && requestParams && typeof requestParams === 'object'
        ? {
            ...requestParams,
            pricingSnapshot: {
              source: managedRoutePricing.source,
              ...(managedRoutePricing.ruleKey ? { ruleKey: managedRoutePricing.ruleKey } : {}),
              ...(managedRoutePricing.label ? { label: managedRoutePricing.label } : {}),
              price: managedRoutePricing.price,
            },
          }
        : requestParams;
    
    // 处理Sora视频模型的特殊定价
    creditsToDeduct = this.resolveSoraModelCredits(
      serviceType,
        creditsToDeduct,
        effectiveRequestParams,
        model,
      );

    // 处理 Kling 2.6 / 3.0 按模型、音效、模式、时长阶梯计费
    creditsToDeduct = this.resolveKlingModelCredits(
      serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    // 处理图像生成服务的分辨率定价
    creditsToDeduct = this.resolveImageResolutionCredits(
      serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    return await this.prisma.$transaction(async (tx) => {
      // 获取账户并锁定
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      await this.enforceFreeUserImageQuota(tx, {
        userId,
        serviceType,
        requestedOutputImageCount: outputImageCount,
      });
      await this.enforceFreeUserVideoQuota(tx, {
        userId,
        serviceType,
      });

      const activeLots = await tx.creditLot.findMany({
        where: {
          accountId: account.id,
          status: 'active',
        },
        select: {
          id: true,
          sourceType: true,
          validityType: true,
          scopeType: true,
          scopeValue: true,
          totalAmount: true,
          remainingAmount: true,
          grantedAt: true,
          activeAt: true,
          expiresAt: true,
          priority: true,
          status: true,
        },
      });

      const consumePolicy = await this.resolveCreditConsumePolicy(tx, {
        serviceType,
        provider: requestedProvider || pricing.provider,
        model: model ?? null,
      });
      const deductionPlan = buildHybridCreditDeductionPlan({
        accountBalance: account.balance,
        amount: creditsToDeduct,
        lots: activeLots.map((lot) => this.toCreditLotCandidate(lot)),
        now: new Date(),
        scope: {
          serviceType,
          provider: requestedProvider || pricing.provider,
          model: model ?? null,
        },
        policy: consumePolicy,
      });

      if (!deductionPlan.sufficient) {
        throw new BadRequestException(`积分不足，当前余额: ${account.balance}，需要: ${creditsToDeduct}`);
      }

      const updatedLots = applyLotDeductionsToSnapshots({
        lots: activeLots.map((lot) => this.toCreditLotCandidate(lot)),
        deductions: deductionPlan.deductions,
      });

      for (const updatedLot of updatedLots) {
        const originalLot = activeLots.find((lot) => lot.id === updatedLot.id);
        if (!originalLot) continue;
        if (
          originalLot.remainingAmount === updatedLot.remainingAmount &&
          originalLot.status === updatedLot.status
        ) {
          continue;
        }

        await tx.creditLot.update({
          where: { id: updatedLot.id },
          data: {
            remainingAmount: updatedLot.remainingAmount,
            status: updatedLot.status,
          },
        });
      }

      const newBalance = account.balance - deductionPlan.totalDeducted;

      // Sora 按模型区分显示名称：Pro 750 积分显示「Sora 2 Pro 视频生成」
      let effectiveServiceName = this.resolveSoraServiceName(
        serviceType,
        pricing.serviceName,
        effectiveRequestParams,
        model,
      );
      effectiveServiceName = this.resolveKlingServiceName(
        serviceType,
        effectiveServiceName,
        effectiveRequestParams,
      );
      effectiveServiceName = this.resolveManagedVideoServiceName(
        serviceType,
        effectiveServiceName,
        effectiveRequestParams,
      );

      // 更新账户余额
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalSpent: account.totalSpent + creditsToDeduct,
        },
      });

      // 创建 API 使用记录
      const apiUsage = await tx.apiUsageRecord.create({
        data: {
          userId,
          serviceType,
          serviceName: effectiveServiceName,
          provider: requestedProvider || pricing.provider,
          model,
          creditsUsed: creditsToDeduct,
          inputTokens,
          outputTokens,
          inputImageCount,
          outputImageCount,
          requestParams: effectiveRequestParams,
          responseStatus: ApiResponseStatus.PENDING,
          ipAddress,
          userAgent,
        },
      });

      // 创建交易记录
      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.SPEND,
          amount: -deductionPlan.totalDeducted,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `使用 ${effectiveServiceName}${requestParams?.imageSize ? `（${requestParams.imageSize}）` : ''}`,
          apiUsageId: apiUsage.id,
          consumePolicyCode: consumePolicy.code,
          consumePolicyVersion: consumePolicy.version,
          metadata: this.buildLotDeductionsMetadata(deductionPlan.deductions),
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
        apiUsageId: apiUsage.id,
      };
    });
  }

  /**
   * 更新 API 使用记录状态
   */
  async verifyAndRewardInviterSafely(
    inviteeUserId: string,
    options?: { skipApiUsageCheck?: boolean },
  ): Promise<void> {
    if (!inviteeUserId) return;

    try {
      await this.referralService.verifyAndRewardInviter(inviteeUserId, options);
    } catch (e) {
      this.logger.warn(
        `[Credits] 邀请奖励核验失败 userId=${inviteeUserId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async updateApiUsageStatus(
    apiUsageId: string,
    status: ApiResponseStatus,
    errorMessage?: string,
    processingTime?: number,
  ) {
    const existingUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!existingUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    if (
      existingUsage.responseStatus === ApiResponseStatus.FAILED &&
      status === ApiResponseStatus.SUCCESS
    ) {
      this.logger.warn(
        `[Credits] Skip status transition failed -> success for apiUsageId=${apiUsageId} to avoid refund mismatch`,
      );
      return existingUsage;
    }

    if (
      existingUsage.responseStatus === ApiResponseStatus.SUCCESS &&
      status === ApiResponseStatus.FAILED
    ) {
      this.logger.warn(
        `[Credits] Skip status transition success -> failed for apiUsageId=${apiUsageId} to avoid reward/settlement mismatch`,
      );
      return existingUsage;
    }

    const updateData: Prisma.ApiUsageRecordUpdateInput = {
      responseStatus: status,
    };

    if (status === ApiResponseStatus.SUCCESS) {
      updateData.errorMessage = null;
    } else if (typeof errorMessage === 'string') {
      updateData.errorMessage = errorMessage;
    }

    if (typeof processingTime === 'number' && Number.isFinite(processingTime)) {
      updateData.processingTime = Math.max(0, Math.round(processingTime));
    }

    const updateResult = await this.prisma.apiUsageRecord.updateMany({
      where: {
        id: apiUsageId,
        ...(status === ApiResponseStatus.SUCCESS
          ? { responseStatus: ApiResponseStatus.PENDING }
          : status === ApiResponseStatus.FAILED
            ? {
                responseStatus: {
                  in: [ApiResponseStatus.PENDING, ApiResponseStatus.FAILED],
                },
              }
            : {}),
      },
      data: updateData,
    });

    const latestUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!latestUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    if (updateResult.count === 0) {
      if (status === ApiResponseStatus.SUCCESS) {
        this.logger.warn(
          `[Credits] Skip success update because apiUsage is no longer pending: apiUsageId=${apiUsageId}, currentStatus=${latestUsage.responseStatus}`,
        );
      }
      return latestUsage;
    }

    // 如果 API 调用首次从 pending 变为 success，检查是否需要核验邀请奖励
    if (
      status === ApiResponseStatus.SUCCESS &&
      existingUsage.responseStatus !== ApiResponseStatus.SUCCESS &&
      latestUsage.userId
    ) {
      await this.verifyAndRewardInviterSafely(latestUsage.userId);
    }

    return latestUsage;
  }

  async updateApiUsageRequestParams(
    apiUsageId: string,
    requestParamsPatch: Record<string, any>,
  ): Promise<void> {
    const sanitizedPatch = Object.fromEntries(
      Object.entries(requestParamsPatch).filter(([_, value]) => {
        if (value === undefined || value === null) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        return true;
      }),
    );

    if (Object.keys(sanitizedPatch).length === 0) return;

    const apiUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
      select: { requestParams: true },
    });

    if (!apiUsage) return;

    const existingParams = this.asJsonObject(apiUsage.requestParams) || {};
    await this.prisma.apiUsageRecord.update({
      where: { id: apiUsageId },
      data: {
        requestParams: {
          ...existingParams,
          ...sanitizedPatch,
        },
      },
    });
  }

  /**
   * 标记用户的 API 使用记录为失败（用于可轮询任务的手动退款前置校验）
   */
  async markApiUsageFailedForUser(
    userId: string,
    apiUsageId: string,
    errorMessage: string = 'API调用失败',
    processingTime: number = 0,
  ) {
    const apiUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!apiUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    if (apiUsage.userId !== userId) {
      throw new BadRequestException('无权操作该 API 使用记录');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.SUCCESS) {
      throw new BadRequestException('成功的 API 调用不支持退款');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.FAILED) {
      return apiUsage;
    }

    const updateResult = await this.prisma.apiUsageRecord.updateMany({
      where: {
        id: apiUsageId,
        responseStatus: ApiResponseStatus.PENDING,
      },
      data: {
        responseStatus: ApiResponseStatus.FAILED,
        errorMessage,
        processingTime,
      },
    });

    if (updateResult.count === 0) {
      const latestUsage = await this.prisma.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!latestUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (latestUsage.responseStatus === ApiResponseStatus.SUCCESS) {
        throw new BadRequestException('成功的 API 调用不支持退款');
      }

      return latestUsage;
    }

    const updatedUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!updatedUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    return updatedUsage;
  }

  /**
   * 标记用户的 API 使用记录为成功（用于可轮询任务在前端确认成功后回写）
   */
  async markApiUsageSuccessForUser(
    userId: string,
    apiUsageId: string,
    processingTime: number = 0,
  ) {
    const apiUsage = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!apiUsage) {
      throw new NotFoundException('API使用记录不存在');
    }

    if (apiUsage.userId !== userId) {
      throw new BadRequestException('无权操作该 API 使用记录');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.FAILED) {
      throw new BadRequestException('失败的 API 调用不支持标记成功');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.SUCCESS) {
      return apiUsage;
    }

    const updateResult = await this.prisma.apiUsageRecord.updateMany({
      where: {
        id: apiUsageId,
        responseStatus: ApiResponseStatus.PENDING,
      },
      data: {
        responseStatus: ApiResponseStatus.SUCCESS,
        errorMessage: null,
        processingTime: Math.max(0, processingTime),
      },
    });

    if (updateResult.count === 0) {
      const latestUsage = await this.prisma.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!latestUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (latestUsage.responseStatus === ApiResponseStatus.FAILED) {
        throw new BadRequestException('失败的 API 调用不支持标记成功');
      }

      return latestUsage;
    }

    const updated = await this.prisma.apiUsageRecord.findUnique({
      where: { id: apiUsageId },
    });

    if (!updated) {
      throw new NotFoundException('API使用记录不存在');
    }

    await this.verifyAndRewardInviterSafely(userId);
    return updated;
  }

  /**
   * API 调用失败时退还积分
   */
  async refundCredits(userId: string, apiUsageId: string): Promise<AddCreditsResult> {
    return await this.prisma.$transaction(async (tx) => {
      // 获取 API 使用记录
      const apiUsage = await tx.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!apiUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (apiUsage.userId !== userId) {
        throw new BadRequestException('无权退还该 API 调用积分');
      }

      if (apiUsage.responseStatus !== ApiResponseStatus.FAILED) {
        throw new BadRequestException('只能退还失败的API调用积分');
      }

      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      // 幂等保护：同一个 apiUsage 只允许创建一次退款交易
      const existingRefund = await tx.creditTransaction.findFirst({
        where: {
          apiUsageId,
          type: TransactionType.REFUND,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (existingRefund) {
        return {
          success: true,
          newBalance: account.balance,
          transactionId: existingRefund.id,
        };
      }

      const creditsToRefund = apiUsage.creditsUsed;
      const newBalance = account.balance + creditsToRefund;
      const adjustedTotalSpent = Math.max(0, account.totalSpent - creditsToRefund);

      const spendTransaction = await tx.creditTransaction.findFirst({
        where: {
          apiUsageId,
          type: TransactionType.SPEND,
        },
        orderBy: { createdAt: 'asc' },
      });

      const lotDeductions = this.extractLotDeductionsFromMetadata(
        spendTransaction?.metadata,
      );

      if (lotDeductions.length > 0) {
        const lotIds = lotDeductions
          .filter((item) => item.kind === 'lot' && !!item.lotId)
          .map((item) => item.lotId as string);

        if (lotIds.length > 0) {
          const lots = await tx.creditLot.findMany({
            where: {
              id: { in: lotIds },
            },
            select: {
              id: true,
              sourceType: true,
              validityType: true,
              scopeType: true,
              scopeValue: true,
              totalAmount: true,
              remainingAmount: true,
              grantedAt: true,
              activeAt: true,
              expiresAt: true,
              priority: true,
              status: true,
            },
          });

          const restoredLots = applyLotRestorationsToSnapshots({
            lots: lots.map((lot) => this.toCreditLotCandidate(lot)),
            deductions: lotDeductions,
          });

          for (const restoredLot of restoredLots) {
            const originalLot = lots.find((lot) => lot.id === restoredLot.id);
            if (!originalLot) continue;
            if (
              originalLot.remainingAmount === restoredLot.remainingAmount &&
              originalLot.status === restoredLot.status
            ) {
              continue;
            }

            await tx.creditLot.update({
              where: { id: restoredLot.id },
              data: {
                remainingAmount: restoredLot.remainingAmount,
                status: restoredLot.status,
              },
            });
          }
        }
      }

      // 更新账户余额
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalSpent: adjustedTotalSpent,
        },
      });

      // 创建退款交易记录
      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.REFUND,
          amount: creditsToRefund,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `退还 ${apiUsage.serviceName} 积分（API调用失败）`,
          apiUsageId,
          consumePolicyCode: spendTransaction?.consumePolicyCode ?? null,
          consumePolicyVersion: spendTransaction?.consumePolicyVersion ?? null,
          metadata: lotDeductions.length > 0
            ? this.buildLotDeductionsMetadata(lotDeductions)
            : undefined,
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * 自动处理长时间 pending 的生图调用：
   * - 标记为 failed
   * - 执行积分退款（幂等）
   */
  async autoRefundStalePendingImageUsages(options?: {
    timeoutMinutes?: number;
    batchSize?: number;
  }): Promise<{
    scanned: number;
    refunded: number;
    skippedSuccess: number;
    errors: number;
    timeoutMinutes: number;
    batchSize: number;
  }> {
    const timeoutMinutes = options?.timeoutMinutes ?? this.getStalePendingTimeoutMinutes();
    const batchSize = options?.batchSize ?? this.getStalePendingBatchSize();
    return this.autoRefundStalePendingUsagesForServiceTypes(
      STALE_PENDING_IMAGE_SERVICE_TYPES,
      timeoutMinutes,
      batchSize,
    );
  }

  /**
   * 自动处理长时间 pending 的异步视频调用：
   * - 标记为 failed
   * - 执行积分退款（幂等）
   */
  async autoRefundStalePendingVideoUsages(options?: {
    timeoutMinutes?: number;
    batchSize?: number;
  }): Promise<{
    scanned: number;
    refunded: number;
    skippedSuccess: number;
    errors: number;
    timeoutMinutes: number;
    batchSize: number;
  }> {
    const timeoutMinutes = options?.timeoutMinutes ?? this.getStalePendingVideoTimeoutMinutes();
    const batchSize = options?.batchSize ?? this.getStalePendingBatchSize();
    const cutoverAt = this.getStalePendingVideoRefundCutoverAt();
    return this.autoRefundStalePendingUsagesForServiceTypes(
      STALE_PENDING_VIDEO_SERVICE_TYPES,
      timeoutMinutes,
      batchSize,
      cutoverAt,
    );
  }

  private async autoRefundStalePendingUsagesForServiceTypes(
    serviceTypes: ServiceType[],
    timeoutMinutes: number,
    batchSize: number,
    minCreatedAt?: Date | null,
  ): Promise<{
    scanned: number;
    refunded: number;
    skippedSuccess: number;
    errors: number;
    timeoutMinutes: number;
    batchSize: number;
  }> {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const createdAtFilter: Prisma.DateTimeFilter = { lt: cutoff };
    if (minCreatedAt) {
      createdAtFilter.gte = minCreatedAt;
    }

    const staleRecords = await this.prisma.apiUsageRecord.findMany({
      where: {
        responseStatus: ApiResponseStatus.PENDING,
        serviceType: { in: serviceTypes },
        createdAt: createdAtFilter,
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: {
        id: true,
        userId: true,
        serviceType: true,
        serviceName: true,
        createdAt: true,
      },
    });

    if (staleRecords.length === 0) {
      return {
        scanned: 0,
        refunded: 0,
        skippedSuccess: 0,
        errors: 0,
        timeoutMinutes,
        batchSize,
      };
    }

    let refunded = 0;
    let skippedSuccess = 0;
    let errors = 0;

    for (const record of staleRecords) {
      const processingTime = Math.max(0, Date.now() - record.createdAt.getTime());
      const timeoutMessage = `超时自动关闭：${timeoutMinutes}分钟未完成`;

      try {
        await this.markApiUsageFailedForUser(
          record.userId,
          record.id,
          timeoutMessage,
          processingTime,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('成功的 API 调用不支持退款')) {
          skippedSuccess += 1;
          continue;
        }
        errors += 1;
        this.logger.error(
          `自动退款标记失败 apiUsageId=${record.id}, serviceType=${record.serviceType}, error=${message}`,
        );
        continue;
      }

      try {
        await this.refundCredits(record.userId, record.id);
        refunded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors += 1;
        this.logger.error(
          `自动退款失败 apiUsageId=${record.id}, serviceType=${record.serviceType}, error=${message}`,
        );
      }
    }

    return {
      scanned: staleRecords.length,
      refunded,
      skippedSuccess,
      errors,
      timeoutMinutes,
      batchSize,
    };
  }

  /**
   * 管理员添加积分
   */
  async adminAddCredits(
    userId: string,
    amount: number,
    description: string,
    adminId: string,
  ): Promise<AddCreditsResult> {
    if (amount <= 0) {
      throw new BadRequestException('添加积分数量必须大于0');
    }

    return await this.prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const newBalance = account.balance + amount;

      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalEarned: account.totalEarned + amount,
        },
      });

      const creditLot = await tx.creditLot.create({
        data: buildAdminGiftCreditLotData({
          accountId: account.id,
          amount,
          metadata: {
            adminId,
            description,
            grantedBy: 'admin_add',
          },
        }),
      });

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.ADMIN_ADJUST,
          amount,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description,
          creditLotId: creditLot.id,
          metadata: { adminId },
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * 管理员扣除积分
   */
  async adminDeductCredits(
    userId: string,
    amount: number,
    description: string,
    adminId: string,
  ): Promise<AddCreditsResult> {
    if (amount <= 0) {
      throw new BadRequestException('扣除积分数量必须大于0');
    }

    return await this.prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      if (account.balance < amount) {
        throw new BadRequestException(`用户积分不足，当前余额: ${account.balance}`);
      }

      const newBalance = account.balance - amount;

      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
        },
      });

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.ADMIN_ADJUST,
          amount: -amount,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description,
          metadata: { adminId },
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * 获取用户交易记录
   */
  async getTransactionHistory(
    userId: string,
    options: {
      page?: number;
      pageSize?: number;
      type?: TransactionType;
    } = {},
  ) {
    const { page = 1, pageSize = 20, type } = options;

    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }

    const where: any = { accountId: account.id };
    if (type) {
      where.type = type;
    }

    const [transactions, total] = await Promise.all([
      this.prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.creditTransaction.count({ where }),
    ]);

    const apiUsageIds = Array.from(
      new Set(
        transactions
          .map((tx) => tx.apiUsageId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const apiUsageMap = new Map<
      string,
      {
        provider: string | null;
        model: string | null;
        requestParams: Prisma.JsonValue | null;
        responseStatus: string;
        processingTime: number | null;
      }
    >();

    if (apiUsageIds.length > 0) {
      const apiUsages = await this.prisma.apiUsageRecord.findMany({
        where: { id: { in: apiUsageIds } },
        select: {
          id: true,
          provider: true,
          model: true,
          requestParams: true,
          responseStatus: true,
          processingTime: true,
        },
      });

      for (const usage of apiUsages) {
        apiUsageMap.set(usage.id, usage);
      }
    }

    const enrichedTransactions = transactions.map((tx) => {
      const usage = tx.apiUsageId ? apiUsageMap.get(tx.apiUsageId) : null;
      return {
        ...tx,
        channel: this.extractChannelFromApiUsage(usage),
        provider: usage?.provider ?? null,
        model: usage?.model ?? null,
        apiResponseStatus: usage?.responseStatus ?? null,
        processingTime: usage?.processingTime ?? null,
      };
    });

    return {
      transactions: enrichedTransactions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 获取用户 API 使用记录
   */
  async getApiUsageHistory(
    userId: string,
    options: {
      page?: number;
      pageSize?: number;
      serviceType?: string;
      provider?: string;
      status?: ApiResponseStatus;
      startDate?: Date;
      endDate?: Date;
    } = {},
  ) {
    const { page = 1, pageSize = 20, serviceType, provider, status, startDate, endDate } = options;

    const where: any = { userId };
    if (serviceType) where.serviceType = serviceType;
    if (provider) where.provider = provider;
    if (status) where.responseStatus = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [records, total] = await Promise.all([
      this.prisma.apiUsageRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.apiUsageRecord.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * 检查用户今天是否已领取每日奖励
   */
  async canClaimDailyReward(userId: string): Promise<{
    canClaim: boolean;
    lastClaimAt: Date | null;
    tierCode: string;
    todayRewardCredits: number;
    rewardMultiplier: number;
  }> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }

    const rewardRule = await this.resolveDailyRewardRuleForUser(this.prisma, userId);

    if (!account.lastDailyRewardAt) {
      return {
        canClaim: true,
        lastClaimAt: null,
        tierCode: rewardRule.tierCode,
        todayRewardCredits: rewardRule.baseCredits,
        rewardMultiplier: rewardRule.rewardMultiplier,
      };
    }

    const now = new Date();
    const lastClaim = new Date(account.lastDailyRewardAt);
    const isSameBusinessDay = this.diffDailyRewardBusinessDays(now, lastClaim) === 0;

    return {
      canClaim: !isSameBusinessDay,
      lastClaimAt: account.lastDailyRewardAt,
      tierCode: rewardRule.tierCode,
      todayRewardCredits: rewardRule.baseCredits,
      rewardMultiplier: rewardRule.rewardMultiplier,
    };
  }

  /**
   * 领取每日登录奖励
   * 签到积分统一进入 gift 池：普通用户会日衰减，活跃 VIP 因 pauseGiftDecay 不衰减
   * 规则：按会员档位发放基础签到积分，连续签到第 7 天按倍率发放，断签或满 7 天后重置到第 1 天
   */
  async claimDailyReward(userId: string): Promise<AddCreditsResult & {
    alreadyClaimed?: boolean;
    expiresAt?: Date | null;
    consecutiveDays?: number;
    bonusCredits?: number;
    baseCredits?: number;
    rewardMultiplier?: number;
    tierCode?: string;
  }> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "CreditAccount" WHERE "userId" = ${userId} FOR UPDATE`,
      );

      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const now = new Date();
      if (account.lastDailyRewardAt) {
        const lastClaim = new Date(account.lastDailyRewardAt);
        if (this.diffDailyRewardBusinessDays(now, lastClaim) === 0) {
          return {
            success: false,
            newBalance: account.balance,
            transactionId: '',
            alreadyClaimed: true,
          };
        }
      }

      const rewardRule = await this.resolveDailyRewardRuleForUser(tx, userId);
      const expiresAt = null;

      // 计算连续签到天数
      let newConsecutiveDays = 1;
      let bonusCredits = 0;
      let rewardMultiplier = 1;

      if (account.lastCheckInDate) {
        const lastCheckIn = new Date(account.lastCheckInDate);
        const diffDays = this.diffDailyRewardBusinessDays(now, lastCheckIn);

        if (diffDays === 1) {
          // 连续签到
          if (account.consecutiveDays >= 7) {
            // 已满7天，重置到第1天
            newConsecutiveDays = 1;
          } else {
            newConsecutiveDays = account.consecutiveDays + 1;
          }
        } else if (diffDays === 0) {
          // 同一天，保持不变（理论上不会走到这里，因为 canClaim 会返回 false）
          newConsecutiveDays = account.consecutiveDays;
        }
        // diffDays > 1 表示断签，重新从1开始（默认值已经是1）
      }

      // 第7天按策略倍数发放
      if (newConsecutiveDays === 7) {
        rewardMultiplier = Math.max(1, rewardRule.rewardMultiplier);
        bonusCredits = rewardMultiplier > 1
          ? rewardRule.baseCredits * (rewardMultiplier - 1)
          : 0;
      }

      const totalCredits = rewardRule.baseCredits + bonusCredits;
      const newBalance = account.balance + totalCredits;

      // 更新账户余额、最后领取时间和连续签到天数
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalEarned: account.totalEarned + totalCredits,
          lastDailyRewardAt: now,
          lastCheckInDate: now,
          consecutiveDays: newConsecutiveDays,
        },
      });

      // 创建签到交易记录
      const description = bonusCredits > 0
        ? `连续签到第7天，按${rewardMultiplier}倍发放共${totalCredits}积分`
        : `每日签到第${newConsecutiveDays}天`;

      const creditLot = await tx.creditLot.create({
        data: buildDailyRewardCreditLotData({
          accountId: account.id,
          amount: totalCredits,
          expiresAt,
          metadata: this.getDailyRewardMetadata(
            newConsecutiveDays,
            bonusCredits,
            rewardRule.baseCredits,
            rewardMultiplier,
            rewardRule.tierCode,
          ),
        }),
      });

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.DAILY_REWARD,
          amount: totalCredits,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description,
          creditLotId: creditLot.id,
          expiresAt,
          metadata: this.getDailyRewardMetadata(
            newConsecutiveDays,
            bonusCredits,
            rewardRule.baseCredits,
            rewardMultiplier,
            rewardRule.tierCode,
          ),
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
        expiresAt,
        consecutiveDays: newConsecutiveDays,
        bonusCredits,
        baseCredits: rewardRule.baseCredits,
        rewardMultiplier,
        tierCode: rewardRule.tierCode,
      };
    });
  }

  /**
   * 获取用户签到日历状态（7天周期）
   * 规则：连续签到7天后重置，断签也重置
   * 日历显示：已签到(checked)、今日待签(isToday)、未来待签(其他)
   */
  async getCheckInCalendar(userId: string): Promise<{
    consecutiveDays: number;
    lastCheckInDate: Date | null;
    todayCheckedIn: boolean;
    currentBusinessDayStartAt: Date;
    calendarDays: Array<{ day: number; checked: boolean; missed: boolean; isToday: boolean }>;
  }> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }

    const now = new Date();
    const todayAnchor = this.getDailyRewardBusinessDayAnchor(now);

    let todayCheckedIn = false;
    let consecutiveDays = account.consecutiveDays || 0;

    if (account.lastCheckInDate) {
      const lastCheckIn = new Date(account.lastCheckInDate);
      todayCheckedIn = this.diffDailyRewardBusinessDays(now, lastCheckIn) === 0;

      // 检查是否断签（超过1天没签到）
      const diffDays = this.diffDailyRewardBusinessDays(now, lastCheckIn);
      if (diffDays > 1) {
        // 断签了，显示为0天（但数据库中的值会在下次签到时重置）
        consecutiveDays = 0;
      }
    }

    // 构建7天日历
    const calendarDays: Array<{ day: number; checked: boolean; missed: boolean; isToday: boolean }> = [];

    for (let i = 1; i <= 7; i++) {
      // 已签到：第1天到第consecutiveDays天
      const checked = i <= consecutiveDays;
      // 今日待签：下一个要签到的天数（如果今天还没签到）
      const isToday = !todayCheckedIn && i === consecutiveDays + 1;

      calendarDays.push({
        day: i,
        checked,
        missed: false, // 断签会重置周期，所以当前周期内不存在漏签
        isToday,
      });
    }

    return {
      consecutiveDays,
      lastCheckInDate: account.lastCheckInDate,
      todayCheckedIn,
      currentBusinessDayStartAt: todayAnchor,
      calendarDays,
    };
  }

  /**
   * 清理过期的签到积分（定时任务调用）
   * 只清理普通用户的过期签到积分
   */
  async cleanupExpiredDailyRewards(): Promise<{ processedUsers: number; totalExpiredCredits: number }> {
    const now = new Date();
    const processedUserIds = new Set<string>();
    let totalExpiredCredits = 0;

    const expiredDailyRewardLots = await this.prisma.creditLot.findMany({
      where: {
        status: 'active',
        validityType: 'fixed_window',
        expiresAt: { lte: now },
        metadata: {
          path: ['reason'],
          equals: 'daily_reward',
        },
      },
      include: {
        account: true,
      },
      orderBy: { expiresAt: 'asc' },
    });

    for (const lot of expiredDailyRewardLots) {
      const userId = lot.account.userId;
      processedUserIds.add(userId);

      const isPaid = await this.isPaidUser(userId);
      if (isPaid) {
        await this.prisma.$transaction(async (tx) => {
          await tx.creditLot.update({
            where: { id: lot.id },
            data: {
              validityType: 'permanent',
              expiresAt: null,
            },
          });

          await tx.creditTransaction.updateMany({
            where: {
              creditLotId: lot.id,
              type: TransactionType.DAILY_REWARD,
            },
            data: {
              expiresAt: null,
              isExpired: false,
            },
          });
        });
        continue;
      }

      if (lot.remainingAmount <= 0) {
        await this.prisma.$transaction(async (tx) => {
          await tx.creditLot.update({
            where: { id: lot.id },
            data: {
              remainingAmount: 0,
              status: 'expired',
            },
          });

          await tx.creditTransaction.updateMany({
            where: {
              creditLotId: lot.id,
              type: TransactionType.DAILY_REWARD,
            },
            data: {
              isExpired: true,
              expiredAmount: 0,
            },
          });
        });
        continue;
      }

      const account = await this.prisma.creditAccount.findUnique({
        where: { id: lot.accountId },
      });

      if (!account) continue;

      const actualDeduct = Math.min(lot.remainingAmount, account.balance);

      await this.prisma.$transaction(async (tx) => {
        const newBalance = account.balance - actualDeduct;
        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: newBalance,
          },
        });

        await tx.creditLot.update({
          where: { id: lot.id },
          data: {
            remainingAmount: 0,
            status: 'expired',
          },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.EXPIRE,
            amount: -actualDeduct,
            balanceBefore: account.balance,
            balanceAfter: newBalance,
            description: '签到积分过期清除',
            creditLotId: lot.id,
            metadata: {
              expiredLotId: lot.id,
              originalRemainingAmount: lot.remainingAmount,
            },
          },
        });

        await tx.creditTransaction.updateMany({
          where: {
            creditLotId: lot.id,
            type: TransactionType.DAILY_REWARD,
          },
          data: {
            isExpired: true,
            expiredAmount: actualDeduct,
          },
        });
      });

      totalExpiredCredits += actualDeduct;
    }

    // 查找所有已过期但未处理的签到积分记录
    const expiredTransactions = await this.prisma.creditTransaction.findMany({
      where: {
        type: TransactionType.DAILY_REWARD,
        expiresAt: { lte: now },
        isExpired: false,
        creditLotId: null,
        amount: { gt: 0 }, // 只处理正数（获得积分的记录）
      },
      include: {
        account: true,
      },
    });

    if (expiredTransactions.length === 0) {
      return { processedUsers: processedUserIds.size, totalExpiredCredits };
    }

    // 按用户分组处理
    const userTransactions = new Map<string, typeof expiredTransactions>();
    for (const tx of expiredTransactions) {
      const userId = tx.account.userId;
      if (!userTransactions.has(userId)) {
        userTransactions.set(userId, []);
      }
      userTransactions.get(userId)!.push(tx);
    }

    let processedUsers = 0;

    for (const [userId, transactions] of userTransactions) {
      processedUserIds.add(userId);
      // 再次确认不是付费用户（双重检查）
      const isPaid = await this.isPaidUser(userId);
      if (isPaid) {
        // 付费用户：将这些记录标记为永不过期
        await this.prisma.creditTransaction.updateMany({
          where: {
            id: { in: transactions.map(t => t.id) },
          },
          data: {
            expiresAt: null,
            isExpired: false,
          },
        });
        continue;
      }

      // 计算该用户需要清除的过期积分总额
      const expiredAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

      if (expiredAmount <= 0) continue;

      // 获取用户当前余额
      const account = await this.prisma.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) continue;

      // 实际扣除的积分不能超过当前余额
      const actualDeduct = Math.min(expiredAmount, account.balance);

      if (actualDeduct > 0) {
        await this.prisma.$transaction(async (tx) => {
          // 扣除过期积分
          const newBalance = account.balance - actualDeduct;
          await tx.creditAccount.update({
            where: { id: account.id },
            data: { balance: newBalance },
          });

          // 创建过期扣除记录
          await tx.creditTransaction.create({
            data: {
              accountId: account.id,
              type: TransactionType.EXPIRE,
              amount: -actualDeduct,
              balanceBefore: account.balance,
              balanceAfter: newBalance,
              description: `签到积分过期清除（${transactions.length}笔）`,
              metadata: {
                expiredTransactionIds: transactions.map(t => t.id),
                originalExpiredAmount: expiredAmount,
              },
            },
          });

          // 标记原始交易记录为已过期
          await tx.creditTransaction.updateMany({
            where: {
              id: { in: transactions.map(t => t.id) },
            },
            data: {
              isExpired: true,
              expiredAmount: actualDeduct,
            },
          });
        });

        totalExpiredCredits += actualDeduct;
      } else {
        // 余额为0，只标记为已过期
        await this.prisma.creditTransaction.updateMany({
          where: {
            id: { in: transactions.map(t => t.id) },
          },
          data: {
            isExpired: true,
            expiredAmount: 0,
          },
        });
      }

      processedUsers++;
    }

    const totalProcessedUsers = processedUserIds.size;
    this.logger.log(`签到积分过期清理完成: 处理 ${totalProcessedUsers} 个用户, 清除 ${totalExpiredCredits} 积分`);
    return { processedUsers: totalProcessedUsers, totalExpiredCredits };
  }

  /**
   * 获取用户即将过期的签到积分信息
   */
  async getExpiringCredits(userId: string): Promise<{
    totalExpiring: number;
    expiringDetails: Array<{ amount: number; expiresAt: Date }>;
    isPaidUser: boolean;
  }> {
    const isPaid = await this.isPaidUser(userId);

    if (isPaid) {
      return { totalExpiring: 0, expiringDetails: [], isPaidUser: true };
    }

    const account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      return { totalExpiring: 0, expiringDetails: [], isPaidUser: false };
    }

    const [expiringLots, expiringTransactions] = await Promise.all([
      this.prisma.creditLot.findMany({
        where: {
          accountId: account.id,
          status: 'active',
          validityType: 'fixed_window',
          expiresAt: { not: null },
          remainingAmount: { gt: 0 },
          metadata: {
            path: ['reason'],
            equals: 'daily_reward',
          },
        },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.creditTransaction.findMany({
        where: {
          accountId: account.id,
          type: TransactionType.DAILY_REWARD,
          expiresAt: { not: null },
          isExpired: false,
          creditLotId: null,
          amount: { gt: 0 },
        },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    const expiringDetails = [
      ...expiringLots.map((lot) => ({
        amount: lot.remainingAmount,
        expiresAt: lot.expiresAt!,
      })),
      ...expiringTransactions.map((t) => ({
        amount: t.amount,
        expiresAt: t.expiresAt!,
      })),
    ].sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime());

    const totalExpiring = expiringDetails.reduce((sum, d) => sum + d.amount, 0);

    return { totalExpiring, expiringDetails, isPaidUser: false };
  }
}
