import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
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
import {
  MODEL_PROVIDER_MAPPING_SETTING_KEY,
  type ManagedModelConfig,
  type ManagedModelVendorConfig,
} from '../ai/services/model-routing.service';
import {
  resolveManagedModelPricing,
  resolveManagedModelPricingV2,
  resolveManagedVendorDefaultPricing,
  type ManagedPricingMappingLike,
  type ManagedPricingCondition,
  type ManagedPricingDimensionDefinition,
  type ManagedPricingEvaluator,
  type ManagedPricingMatchingRule,
  type ResolvedManagedPricing,
} from '../ai/services/model-pricing-resolver';
import { normalizeSeedance20DiscountPricing } from '../ai/services/seedance20-pricing';

let IORedis: any;
try {
  // optional dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  IORedis = require('ioredis');
} catch (e) {
  IORedis = null;
}

const STALE_PENDING_DEFAULT_TIMEOUT_MINUTES = 15;
const STALE_PENDING_DEFAULT_VIDEO_TIMEOUT_MINUTES = 30;
const STALE_PENDING_VIDEO_REFUND_DEFAULT_CUTOVER_AT = '2026-03-28T00:00:00.000Z';
const FREE_USAGE_QUOTA_DEFAULT_CUTOVER_AT = '2026-04-15T00:00:00.000Z';
const STALE_PENDING_DEFAULT_BATCH_SIZE = 100;
const PRE_DEDUCT_IDEMPOTENCY_DEFAULT_WINDOW_MS = 15_000;
const PRE_DEDUCT_IDEMPOTENCY_MAX_WINDOW_MS = 120_000;
const PRE_DEDUCT_TRANSACTION_TIMEOUT_MS = 30_000;
const DAILY_REWARD_RESET_HOUR = 3;
const FREE_TIER_BENEFITS_SETTING_KEY = 'membership_free_tier_benefits';
const FREE_USER_LEGACY_QUOTA_BUSINESS_TYPE = 'free_monthly_quota';
const FREE_USER_STARTER_QUOTA_BUSINESS_TYPE = 'free_starter_quota';
const FREE_USER_QUOTA_BUSINESS_TYPES = [
  FREE_USER_LEGACY_QUOTA_BUSINESS_TYPE,
  FREE_USER_STARTER_QUOTA_BUSINESS_TYPE,
];
const FREE_USER_LEGACY_QUOTA_GRANTED_BY = 'free_user_monthly_quota';
const FREE_USER_STARTER_QUOTA_GRANTED_BY = 'free_user_starter_quota';
const DEFAULT_FREE_USER_DAILY_IMAGE_LIMIT = 20;
const DEFAULT_FREE_USER_DAILY_VIDEO_LIMIT = 3;
const DEFAULT_FREE_USER_MONTHLY_IMAGE_LIMIT = 100;
const DEFAULT_FREE_USER_MONTHLY_VIDEO_LIMIT = 10;
const PREVIEW_CREDITS_CACHE_TTL_SEC = 30;
const CREDITS_PER_YUAN = 100;
const GPT_IMAGE2_SERVICE_TYPE = 'gpt-image-2';
const GPT_IMAGE2_CREDITS = 40;
const GPT_IMAGE2_NORMAL_RESOLUTION_PRICING: Record<'1K' | '2K' | '4K', number> = {
  '1K': 20,
  '2K': 30,
  '4K': 40,
};
const GPT_IMAGE2_TENCENT_RESOLUTION_PRICING: Record<
  'low' | 'medium' | 'high',
  Record<'1K' | '2K' | '4K', number>
> = {
  low: {
    '1K': 30,
    '2K': 35,
    '4K': 40,
  },
  medium: {
    '1K': 65,
    '2K': 110,
    '4K': 160,
  },
  high: {
    '1K': 190,
    '2K': 350,
    '4K': 560,
  },
};
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
  'midjourney-upscale',
  'expand-image',
];
const STALE_PENDING_VIDEO_SERVICE_TYPES: ServiceType[] = [
  'sora-sd',
  'sora-hd',
  'wan26-video',
  'wan27-video',
  'kling-video',
  'kling-2.6-video',
  'kling-3.0-video',
  'kling-o3-video',
  'vidu-video',
  'viduq3-pro-video',
  'doubao-video',
  'happyhorse-r2v-video',
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
  'happyhorse-r2v-video',
];

export interface DeductCreditsResult {
  success: boolean;
  newBalance: number;
  transactionId: string;
  apiUsageId: string;
  creditsToDeduct: number;
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
  idempotencyKey?: string;
  idempotencyWindowMs?: number;
  /** 团队项目模式：只建用量记录，不扣个人积分。团队积分由调用方另行扣除。 */
  skipPersonalDeduction?: boolean;
}

interface PricingCatalogRuleConditionView {
  field: string;
  op: string;
  value?: unknown;
}

interface PricingCatalogRuleView {
  ruleKey?: string;
  label?: string;
  priority?: number;
  evaluatorKey?: string;
  evaluatorType?: string;
  formula?: string;
  conditions: {
    all: PricingCatalogRuleConditionView[];
    any: PricingCatalogRuleConditionView[];
  };
}

interface PricingCatalogVendorView {
  vendorKey: string;
  label?: string;
  provider?: string;
  platformKey?: string;
  enabled: boolean;
  creditsPerCall?: number;
  priceYuan?: number;
  pricingVersion?: string;
  defaultPrice: {
    credits?: number;
    priceYuan?: number;
    costYuan?: number;
  };
  dimensions: Array<{
    key: string;
    label?: string;
    type?: string;
    required?: boolean;
    options?: Array<{
      value: string | number | boolean;
      label?: string;
    }>;
    description?: string;
  }>;
  rules: PricingCatalogRuleView[];
}

export interface ManagedPricingCatalogItem {
  modelKey: string;
  modelName?: string;
  taskType?: string;
  enabled: boolean;
  defaultVendor?: string;
  vendors: PricingCatalogVendorView[];
}

type PricingCatalogDimensionView = PricingCatalogVendorView['dimensions'][number];

interface PreviewCreditsParams {
  userId: string;
  serviceType: ServiceType;
  model?: string;
  requestParams?: any;
  outputImageCount?: number;
}

interface CachedPreviewQuotePayload {
  serviceName: string;
  requestedProvider: string | null;
  creditsToDeduct: number;
  managedPricing:
    | {
        source?: string;
        vendorKey?: string;
        ruleKey?: string;
        label?: string;
        evaluatorKey?: string;
        evaluatorType?: string;
        pricingVersion?: string;
        price?: {
          credits?: number;
          priceYuan?: number;
          costYuan?: number;
        };
      }
    | null;
  effectiveRequestParams: any;
}

type SoraBillingModel = 'sora-2' | 'sora-2-vip' | 'sora-2-pro';
type KlingBillingModel = 'kling-v2-6' | 'kling-v3-0' | 'kling-o3';
type BananaTencentPricingTier = 'fast' | 'pro' | 'ultra';
type BananaTextPricingTier = 'fast' | 'pro' | 'ultra';

const BANANA_TENCENT_IMAGE_SERVICE_TIERS: Partial<
  Record<ServiceType, BananaTencentPricingTier>
> = {
  'gemini-2.5-image': 'fast',
  'gemini-2.5-image-edit': 'fast',
  'gemini-2.5-image-blend': 'fast',
  'gemini-3-pro-image': 'pro',
  'gemini-image-edit': 'pro',
  'gemini-image-blend': 'pro',
  'gemini-3.1-image': 'ultra',
  'gemini-3.1-image-edit': 'ultra',
  'gemini-3.1-image-blend': 'ultra',
};

const BANANA_TENCENT_RESOLUTION_PRICING: Record<
  BananaTencentPricingTier,
  Record<'0.5K' | '1K' | '2K' | '4K', number>
> = {
  // ???? (normal/apimart) ??
  // Fast: 1K=20
  // Pro: 1K=40, 2K=60, 4K=80
  // Ultra: 0.5K=30, 1K=30, 2K=40, 4K=50
  fast: {
    '0.5K': 20,
    '1K': 20,
    '2K': 20,
    '4K': 20,
  },
  // Pro ????
  pro: {
    '0.5K': 40,
    '1K': 40,
    '2K': 60,
    '4K': 80,
  },
  // Ultra ????
  ultra: {
    '0.5K': 30,
    '1K': 30,
    '2K': 40,
    '4K': 50,
  },
};

// ???? (stable/tencent) ??
// Fast: 1K=40
// Pro: 1K=90, 2K=100, 4K=170
// Ultra: 0.5K=30, 1K=40, 2K=50, 4K=110
const BANANA_TENCENT_STABLE_RESOLUTION_PRICING: Record<
  BananaTencentPricingTier,
  Record<'0.5K' | '1K' | '2K' | '4K', number>
> = {
  fast: {
    '0.5K': 40,
    '1K': 40,
    '2K': 40,
    '4K': 40,
  },
  pro: {
    '0.5K': 90,
    '1K': 90,
    '2K': 100,
    '4K': 170,
  },
  ultra: {
    '0.5K': 30,
    '1K': 40,
    '2K': 50,
    '4K': 110,
  },
};

// 极速通道（beqlee官方代理）= 官方价 ×1.1
// pro(banana): 0.91×1.1≈100, 0.91×1.1≈100, 1.63×1.1≈179
// ultra(banana-3.1/nano2): 0.455×1.1≈50, 0.683×1.1≈75, 1.026×1.1≈113
const BANANA_ULTRA_RESOLUTION_PRICING: Record<
  BananaTencentPricingTier,
  Record<'0.5K' | '1K' | '2K' | '4K', number>
> = {
  fast: {
    '0.5K': 20,
    '1K': 20,
    '2K': 20,
    '4K': 20,
  },
  pro: {
    '0.5K': 100,
    '1K': 100,
    '2K': 100,
    '4K': 179,
  },
  ultra: {
    '0.5K': 50,
    '1K': 50,
    '2K': 75,
    '4K': 113,
  },
};

const BANANA_TEXT_CHAT_ROUTE_PRICING: Record<
  'normal' | 'stable' | 'ultra',
  Record<BananaTextPricingTier, number>
> = {
  normal: {
    fast: 5,
    pro: 5,
    ultra: 5,
  },
  stable: {
    fast: 10,
    pro: 10,
    ultra: 10,
  },
  ultra: {
    fast: 5,
    pro: 10,
    ultra: 10,
  },
};

const VIDEO_ANALYZE_ROUTE_PRICING: Record<
  'normal' | 'stable' | 'ultra',
  Record<BananaTextPricingTier, number>
> = {
  normal: {
    fast: 60,
    pro: 90,
    ultra: 120,
  },
  stable: {
    fast: 80,
    pro: 120,
    ultra: 160,
  },
  ultra: {
    fast: 60,
    pro: 100,
    ultra: 130,
  },
};
const VOLC_ENHANCE_VIDEO_PRICING: Record<
  'standard' | 'professional',
  Record<'720P' | '1080P' | '2K' | '4K', { lte30: number; gt30: number }>
> = {
  standard: {
    '720P': { lte30: 90, gt30: 180 },
    '1080P': { lte30: 180, gt30: 360 },
    '2K': { lte30: 360, gt30: 720 },
    '4K': { lte30: 720, gt30: 1440 },
  },
  professional: {
    '720P': { lte30: 750, gt30: 1500 },
    '1080P': { lte30: 1500, gt30: 3000 },
    '2K': { lte30: 3000, gt30: 6000 },
    '4K': { lte30: 6000, gt30: 12000 },
  },
};
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);
  private redisClient: any | undefined;
  private readonly freeUserImageQuotaServiceTypes = new Set<ServiceType>(
    FREE_USER_IMAGE_LIMITED_SERVICES,
  );
  private readonly freeUserVideoQuotaServiceTypes = new Set<ServiceType>(
    FREE_USER_VIDEO_LIMITED_SERVICES,
  );

  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly businessPolicyService: BusinessPolicyService,
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
  ) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (redisUrl && IORedis) {
      this.redisClient = new IORedis(redisUrl, {
        commandTimeout: 1000,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
      });
      this.redisClient.on('error', () => {/* suppress connection errors */});
    }
  }

  private stableSerialize(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableSerialize(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableSerialize(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private buildPreviewCreditsCacheKey(params: PreviewCreditsParams): string {
    const signature = this.stableSerialize({
      userId: params.userId,
      serviceType: params.serviceType,
      model: params.model ?? null,
      requestParams: params.requestParams ?? null,
      outputImageCount: params.outputImageCount ?? null,
    });
    const digest = createHash('sha256').update(signature).digest('hex');
    return `credits:preview:v3:${digest}`;
  }

  private async getCachedPreviewQuote(
    params: PreviewCreditsParams,
  ): Promise<CachedPreviewQuotePayload | null> {
    if (!this.redisClient) return null;
    try {
      const raw = await this.redisClient.get(this.buildPreviewCreditsCacheKey(params));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedPreviewQuotePayload;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      this.logger.warn(
        `读取 preview credits Redis 缓存失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async setCachedPreviewQuote(
    params: PreviewCreditsParams,
    payload: CachedPreviewQuotePayload,
  ): Promise<void> {
    if (!this.redisClient) return;
    try {
      await this.redisClient.setex(
        this.buildPreviewCreditsCacheKey(params),
        PREVIEW_CREDITS_CACHE_TTL_SEC,
        JSON.stringify(payload),
      );
    } catch (error) {
      this.logger.warn(
        `写入 preview credits Redis 缓存失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private extractNodeConfigHintsFromRequestParams(requestParams: any): {
    nodeConfigKey?: string;
    nodeConfigNameZh?: string;
    nodeConfigNameEn?: string;
    billingModeName?: string;
    billingTitleSource?: 'dialog' | 'node';
  } {
    if (!requestParams || typeof requestParams !== 'object' || Array.isArray(requestParams)) {
      return {};
    }

    const nodeConfigKey =
      typeof requestParams.nodeConfigKey === 'string' ? requestParams.nodeConfigKey.trim() : '';
    const nodeConfigNameZh =
      typeof requestParams.nodeConfigNameZh === 'string'
        ? requestParams.nodeConfigNameZh.trim()
        : '';
    const nodeConfigNameEn =
      typeof requestParams.nodeConfigNameEn === 'string'
        ? requestParams.nodeConfigNameEn.trim()
        : '';
    const billingModeName =
      typeof requestParams.billingModeName === 'string'
        ? requestParams.billingModeName.trim()
        : '';
    const billingTitleSourceRaw =
      typeof requestParams.billingTitleSource === 'string'
        ? requestParams.billingTitleSource.trim().toLowerCase()
        : '';
    const billingTitleSource =
      billingTitleSourceRaw === 'dialog' || billingTitleSourceRaw === 'node'
        ? (billingTitleSourceRaw as 'dialog' | 'node')
        : undefined;

    return {
      ...(nodeConfigKey ? { nodeConfigKey } : {}),
      ...(nodeConfigNameZh ? { nodeConfigNameZh } : {}),
      ...(nodeConfigNameEn ? { nodeConfigNameEn } : {}),
      ...(billingModeName ? { billingModeName } : {}),
      ...(billingTitleSource ? { billingTitleSource } : {}),
    };
  }

  private async resolveServicePricing(params: {
    serviceType: ServiceType;
    requestParams?: any;
  }) {
    const staticPricing =
      CREDIT_PRICING_CONFIG[params.serviceType as keyof typeof CREDIT_PRICING_CONFIG];
    const {
      nodeConfigKey,
      nodeConfigNameZh,
      nodeConfigNameEn,
      billingModeName,
      billingTitleSource,
    } = this.extractNodeConfigHintsFromRequestParams(params.requestParams);

    let nodeConfig: {
      nameZh: string;
      nameEn: string;
      creditsPerCall: number;
      serviceType: string | null;
    } | null = null;

    if (nodeConfigKey) {
      const resolvedByKey = await this.prisma.nodeConfig.findUnique({
        where: { nodeKey: nodeConfigKey },
        select: {
          nameZh: true,
          nameEn: true,
          creditsPerCall: true,
          serviceType: true,
        },
      });

      if (
        resolvedByKey &&
        resolvedByKey.serviceType &&
        resolvedByKey.serviceType !== params.serviceType
      ) {
        this.logger.warn(
          `[Credits] Ignore nodeConfigKey=${nodeConfigKey} for service=${params.serviceType}, resolved serviceType=${resolvedByKey.serviceType}`,
        );
      } else {
        nodeConfig = resolvedByKey;
      }
    } else if (!staticPricing) {
      // ??????????? serviceType ??????????? serviceType ?????????
      nodeConfig = await this.prisma.nodeConfig.findFirst({
        where: { serviceType: params.serviceType },
        select: {
          nameZh: true,
          nameEn: true,
          creditsPerCall: true,
          serviceType: true,
        },
      });
    }

    if (!staticPricing && !nodeConfig) {
      return staticPricing;
    }

    const nodeConfigCredits =
      typeof nodeConfig?.creditsPerCall === 'number'
        ? nodeConfig.creditsPerCall
        : staticPricing?.creditsPerCall ?? 0;
    const effectiveCredits =
      params.serviceType === GPT_IMAGE2_SERVICE_TYPE ? GPT_IMAGE2_CREDITS : nodeConfigCredits;
    const resolvedNodeConfigNameZh =
      nodeConfigKey && !nodeConfig ? '' : nodeConfigNameZh;
    const resolvedNodeConfigNameEn =
      nodeConfigKey && !nodeConfig ? '' : nodeConfigNameEn;
    const inferredTitleSource =
      billingTitleSource || (nodeConfigKey ? 'node' : 'dialog');
    const serviceName =
      inferredTitleSource === 'node'
        ? resolvedNodeConfigNameEn ||
          nodeConfig?.nameEn ||
          resolvedNodeConfigNameZh ||
          nodeConfig?.nameZh ||
          staticPricing?.serviceName ||
          params.serviceType
        : billingModeName ||
          resolvedNodeConfigNameZh ||
          resolvedNodeConfigNameEn ||
          nodeConfig?.nameZh ||
          nodeConfig?.nameEn ||
          staticPricing?.serviceName ||
          params.serviceType;

    return {
      ...(staticPricing || {
        provider: 'custom',
        description: `Node-managed pricing for ${params.serviceType}`,
      }),
      serviceName,
      creditsPerCall: effectiveCredits,
    };
  }

  private async resolveEffectiveCreditsQuote(params: {
    serviceType: ServiceType;
    model?: string;
    requestParams?: any;
    outputImageCount?: number;
  }) {
    const normalizedRequestParams = this.normalizeManagedPricingRequestParams(params.requestParams);
    const pricing = await this.resolveServicePricing({
      serviceType: params.serviceType,
      requestParams: normalizedRequestParams,
    });
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${params.serviceType}`);
    }

    let creditsToDeduct: number = pricing.creditsPerCall;
    const managedRoutePricing = await this.resolveManagedRoutePricing(normalizedRequestParams);
    if (typeof managedRoutePricing?.price?.credits === 'number') {
      creditsToDeduct = managedRoutePricing.price.credits;
    }

    const effectiveRequestParams =
      managedRoutePricing &&
      normalizedRequestParams &&
      typeof normalizedRequestParams === 'object'
        ? {
            ...normalizedRequestParams,
            pricingSnapshot: {
              source: managedRoutePricing.source,
              ...(managedRoutePricing.ruleKey ? { ruleKey: managedRoutePricing.ruleKey } : {}),
              ...(managedRoutePricing.label ? { label: managedRoutePricing.label } : {}),
              price: managedRoutePricing.price,
            },
          }
        : normalizedRequestParams;

    const requestedProvider =
      typeof effectiveRequestParams?.aiProvider === 'string'
        ? effectiveRequestParams.aiProvider.trim().toLowerCase()
        : '';

    creditsToDeduct = this.resolveSoraModelCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
      params.model,
    );

    creditsToDeduct = this.resolveKlingModelCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveBananaTextRouteCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
      params.model,
    );

    creditsToDeduct = this.resolveVideoAnalyzeRouteCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
      params.model,
    );

    creditsToDeduct = this.resolveImageResolutionCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveHappyhorseR2VCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveSeed2ModelCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveVolcEnhanceVideoCredits(
      params.serviceType,
      creditsToDeduct,
      effectiveRequestParams,
    );

    creditsToDeduct = this.resolveFixedAnalyzeCredits(params.serviceType, creditsToDeduct);

    if (params.serviceType === GPT_IMAGE2_SERVICE_TYPE) {
      const gptImage2RouteCredits = this.resolveTencentBananaResolutionCredits(
        params.serviceType,
        effectiveRequestParams,
      );
      creditsToDeduct =
        typeof gptImage2RouteCredits === 'number'
          ? gptImage2RouteCredits
          : GPT_IMAGE2_CREDITS;
    }
    const outputImageCountMultiplier = this.resolveOutputImageCountMultiplier(
      params.serviceType,
      params.outputImageCount,
      effectiveRequestParams,
    );
    if (outputImageCountMultiplier > 1) {
      creditsToDeduct *= outputImageCountMultiplier;
    }

    // ??????????? Kling, Sora, Seedance?
    let serviceName = this.resolveManagedVideoServiceName(
      params.serviceType,
      pricing.serviceName,
      effectiveRequestParams,
    );

    // ????????????????? + ??? + ???? + ???
    serviceName = this.resolveBananaImageServiceName(
      params.serviceType,
      serviceName,
      effectiveRequestParams,
      params.outputImageCount,
    );

    return {
      pricing,
      creditsToDeduct,
      managedRoutePricing,
      effectiveRequestParams,
      requestedProvider: requestedProvider || pricing.provider,
      serviceName,
    };
  }

  private resolveFixedAnalyzeCredits(serviceType: ServiceType, currentCredits: number): number {
    if (serviceType === 'gemini-2.5-image-analyze') return 10;
    if (serviceType === 'gemini-image-analyze') return 10;
    if (serviceType === 'gemini-3.1-image-analyze') return 10;
    return currentCredits;
  }

  private resolveOutputImageCountMultiplier(
    serviceType: ServiceType,
    outputImageCount: number | undefined,
    requestParams: any,
  ): number {
    const isImageLikeService =
      serviceType.includes('image') ||
      serviceType.startsWith('midjourney') ||
      serviceType === GPT_IMAGE2_SERVICE_TYPE ||
      serviceType === 'expand-image' ||
      serviceType === 'background-removal';
    if (!isImageLikeService) return 1;

    const directCount = Number(outputImageCount);
    if (Number.isFinite(directCount) && directCount > 1) {
      return Math.max(1, Math.floor(directCount));
    }

    const requestOutputCount = Number(requestParams?.outputImageCount);
    if (Number.isFinite(requestOutputCount) && requestOutputCount > 1) {
      return Math.max(1, Math.floor(requestOutputCount));
    }

    const requestBatchCount = Number(requestParams?.batchCount);
    if (Number.isFinite(requestBatchCount) && requestBatchCount > 1) {
      return Math.max(1, Math.floor(requestBatchCount));
    }

    return 1;
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
    if (value === 'normal') return 'apimart';
    if (value === 'stable') return 'tencent';
    if (value === 'nano2') return 'apimart';
    if (value.includes('apimart')) return 'apimart';
    if (value === 'legacy' || value.includes('147')) return '147';
    if (value.includes('tencent')) return 'tencent';
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
    // Omni 服务永远按 kling-o3 计费/命名。Omni 节点为路由到 kling-v3-omni 固定带
    // klingModel='kling-v3-0'，若按下面的 klingModel 字面值判定会被当成 Kling 3.0
    // （触发 3.0 动态计价并把账单标成 Kling 3.0），故 serviceType 优先。
    if (serviceType === 'kling-o3-video') return 'kling-o3';

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
    const normalizedRequestParams = this.normalizeManagedPricingRequestParams(requestParams);
    const modelKey =
      typeof normalizedRequestParams?.modelKey === 'string' &&
      normalizedRequestParams.modelKey.trim().length > 0
        ? normalizedRequestParams.modelKey.trim()
        : typeof normalizedRequestParams?.managedModelKey === 'string' &&
            normalizedRequestParams.managedModelKey.trim().length > 0
          ? normalizedRequestParams.managedModelKey.trim()
          : this.inferManagedModelKeyFromRequestParams(normalizedRequestParams);
    const requestedVendorKey =
      typeof normalizedRequestParams?.vendorKey === 'string' &&
      normalizedRequestParams.vendorKey.trim()
        ? normalizedRequestParams.vendorKey.trim()
        : typeof normalizedRequestParams?.platformKey === 'string' &&
            normalizedRequestParams.platformKey.trim()
          ? normalizedRequestParams.platformKey.trim()
          : '';
    if (!modelKey) return null;

    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: MODEL_PROVIDER_MAPPING_SETTING_KEY },
        select: { value: true },
      });
      const raw = typeof setting?.value === 'string' ? setting.value.trim() : '';
      const parsed = raw
        ? normalizeSeedance20DiscountPricing(
            JSON.parse(raw) as ManagedPricingMappingLike,
          )
        : normalizeSeedance20DiscountPricing({
            models: [{ modelKey: 'seedance-2.0' }],
          } as ManagedPricingMappingLike);

      // 腾讯路由已下线：vidu/kling 视频前端不再下发 vendor。计价与路由解耦——请求带
      // 空 vendor 或陈旧 tencent_vod 时，按该模型 defaultVendor 对应的“已启用”费率表
      // 计价（当前即 tencent_vod），金额与改动前完全一致、仍按时长动态定价；预览与
      // 实际扣费同源。若后台改启用普通线(vidu_api/legacy)，会自动改用该线费率。
      // 仅对“配置了 tencent_vod 选项”的模型生效，图片等模型不受影响。
      const normalizedModelKey = modelKey.trim().toLowerCase();
      let vendorKey = requestedVendorKey;
      if (
        normalizedModelKey === 'seedance-2.0' &&
        (!vendorKey || vendorKey.toLowerCase() === 'tencent_vod')
      ) {
        vendorKey = 'seedance_api';
      }
      if (!vendorKey || vendorKey.toLowerCase() === 'tencent_vod') {
        const fallback = this.pickPricingFallbackVendorKey(parsed, modelKey);
        if (fallback) vendorKey = fallback;
      }
      if (!vendorKey) return null;

      const resolved = await resolveManagedModelPricingV2(
        parsed,
        modelKey,
        vendorKey,
        normalizedRequestParams,
      );
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

  /**
   * 为“配置了 tencent_vod 选项”的托管模型（vidu/kling 等）选择计价用 vendorKey。
   * 腾讯路由下线后前端不再下发 vendor，这里按优先级回退到一个“已启用”的费率表：
   *   1) 已启用的非腾讯 vendor（普通/apimart 线，如 vidu_api / legacy）——若后台启用了它；
   *   2) defaultVendor 对应 vendor（当前即 tencent_vod，沿用改动前费率）；
   *   3) 首个已启用 vendor；4) 首个 vendor。
   * 模型不含 tencent_vod vendor 时返回 null，保持图片等模型计价不变。
   */
  private pickPricingFallbackVendorKey(
    mapping: ManagedPricingMappingLike,
    modelKey: string,
  ): string | null {
    const mk = String(modelKey || '').trim().toLowerCase();
    if (!mk) return null;
    const model = Array.isArray(mapping?.models)
      ? mapping.models.find(
          (item) =>
            typeof item?.modelKey === 'string' &&
            item.modelKey.trim().toLowerCase() === mk,
        )
      : undefined;
    const vendors = Array.isArray(model?.vendors) ? model.vendors : [];
    const vk = (v: any): string =>
      typeof v?.vendorKey === 'string' ? v.vendorKey.trim() : '';
    const isEnabled = (v: any): boolean =>
      (v as { enabled?: boolean })?.enabled !== false;
    const hasTencent = vendors.some((v) => vk(v).toLowerCase() === 'tencent_vod');
    if (!hasTencent) return null;

    const enabledNonTencent = vendors.find(
      (v) => vk(v) && vk(v).toLowerCase() !== 'tencent_vod' && isEnabled(v),
    );
    if (enabledNonTencent) return vk(enabledNonTencent);

    const defaultVendor = String(
      (model as { defaultVendor?: string })?.defaultVendor || '',
    ).trim();
    const byDefault = vendors.find((v) => vk(v) && vk(v) === defaultVendor);
    if (byDefault) return vk(byDefault);

    const firstEnabled = vendors.find((v) => vk(v) && isEnabled(v));
    if (firstEnabled) return vk(firstEnabled);

    const first = vendors.find((v) => vk(v));
    return first ? vk(first) : null;
  }

  private normalizeManagedPricingRequestParams(requestParams: any): any {
    if (!requestParams || typeof requestParams !== 'object' || Array.isArray(requestParams)) {
      return requestParams;
    }

    // ? sound("on"/"off"/boolean) ? generateAudio(boolean) ?????? hasAudio(boolean)?
    // ???????? hasAudio ????????Kling O3?Seedance 1.5???????
    let normalized: any = requestParams;
    if (normalized.hasAudio === undefined || normalized.hasAudio === null) {
      if (normalized.sound !== undefined) {
        const s = normalized.sound;
        normalized = {
          ...normalized,
          hasAudio: s === true || s === 'on' || s === 'true' || s === '1',
        };
      } else if (normalized.generateAudio !== undefined) {
        normalized = {
          ...normalized,
          hasAudio: Boolean(normalized.generateAudio),
        };
      }
    }

    // ? mode("std"/"pro") ???? resolution("720P"/"1080P")?
    // ?????? tencent_vod ????? resolution ??????? mode ??????
    if (
      (normalized.resolution === undefined || normalized.resolution === null || normalized.resolution === '') &&
      typeof normalized.mode === 'string'
    ) {
      const m = normalized.mode.trim().toLowerCase();
      if (m === 'pro') {
        normalized = { ...normalized, resolution: '1080P' };
      } else if (m === 'std') {
        normalized = { ...normalized, resolution: '720P' };
      }
    }

    const normalizedVendorKey =
      typeof normalized.vendorKey === 'string' && normalized.vendorKey.trim().length > 0
        ? normalized.vendorKey.trim().toLowerCase()
        : typeof normalized.platformKey === 'string' &&
            normalized.platformKey.trim().length > 0
          ? normalized.platformKey.trim().toLowerCase()
          : '';
    const modelKey =
      typeof normalized.modelKey === 'string' && normalized.modelKey.trim().length > 0
        ? normalized.modelKey.trim().toLowerCase()
        : typeof normalized.managedModelKey === 'string' &&
            normalized.managedModelKey.trim().length > 0
          ? normalized.managedModelKey.trim().toLowerCase()
          : this.inferManagedModelKeyFromRequestParams(normalized).trim().toLowerCase();

    if (normalizedVendorKey !== 'tencent_vod' || modelKey !== 'vidu-q3') {
      return normalized;
    }

    const normalizedVariant =
      typeof normalized.viduModelVariant === 'string'
        ? normalized.viduModelVariant.trim().toLowerCase()
        : '';
    const normalizedModel =
      typeof normalized.viduModel === 'string'
        ? normalized.viduModel.trim().toLowerCase()
        : '';

    if (normalizedVariant === 'q3-turbo' || normalizedVariant === 'q3turbo') {
      normalized = { ...normalized, viduModelVariant: 'q3' };
    }

    if (normalizedModel === 'q3-turbo' || normalizedModel === 'q3turbo') {
      normalized = { ...normalized, viduModel: 'q3' };
    }

    return normalized;
  }

  private inferManagedModelKeyFromRequestParams(requestParams: any): string {
    const seedanceModel =
      typeof requestParams?.seedanceModel === 'string'
        ? requestParams.seedanceModel.trim().toLowerCase()
        : '';
    if (
      seedanceModel === 'seedance-2.0' ||
      seedanceModel === 'seed-2.0-pro' ||
      seedanceModel === 'seedance-2.0-pro' ||
      seedanceModel === 'seed-2-0-pro' ||
      seedanceModel === 'seed-2.0-lite' ||
      seedanceModel === 'seedance-2.0-lite' ||
      seedanceModel === 'seed-2-0-lite' ||
      seedanceModel === 'seed-2.0-mini' ||
      seedanceModel === 'seedance-2.0-mini' ||
      seedanceModel === 'seed-2-0-mini' ||
      seedanceModel === '2.0' ||
      seedanceModel === '2.0-pro' ||
      seedanceModel === '2.0-lite' ||
      seedanceModel === '2.0-mini' ||
      seedanceModel === 'seedance-2.0-fast' ||
      seedanceModel === '2.0-fast'
    ) {
      return 'seedance-2.0';
    }
    if (
      seedanceModel === 'seedance-1.5' ||
      seedanceModel === 'seedance-1.5-pro' ||
      seedanceModel === '1.5-pro'
    ) {
      return 'seedance-1.5';
    }

    const klingModel =
      typeof requestParams?.klingModel === 'string'
        ? requestParams.klingModel.trim().toLowerCase()
        : '';
    if (klingModel === 'kling-v2-6') return 'kling-2.6';
    if (klingModel === 'kling-v3-0') return 'kling-3.0';
    if (klingModel === 'kling-o3' || klingModel === 'kling-v3-omni') return 'kling-o3';

    const viduModelRaw =
      typeof requestParams?.viduModelVariant === 'string' &&
      requestParams.viduModelVariant.trim().length > 0
        ? requestParams.viduModelVariant.trim().toLowerCase()
        : typeof requestParams?.viduModel === 'string'
          ? requestParams.viduModel.trim().toLowerCase()
          : '';
    if (viduModelRaw) {
      if (
        viduModelRaw === 'q3' ||
        viduModelRaw === 'q3-pro' ||
        viduModelRaw === 'q3pro' ||
        viduModelRaw === 'q3-turbo' ||
        viduModelRaw === 'q3turbo' ||
        viduModelRaw === 'q3-mix' ||
        viduModelRaw === 'q3mix'
      ) {
        return 'vidu-q3';
      }
      return 'vidu-q2';
    }

    const soraModel =
      typeof requestParams?.soraModel === 'string'
        ? requestParams.soraModel.trim().toLowerCase()
        : '';
    if (soraModel === 'sora-2' || soraModel === 'sora-2-vip' || soraModel === 'sora-2-pro') {
      return 'sora-2';
    }

    return '';
  }

  private normalizeKlingDuration(raw: unknown): 5 | 10 | null {
    const value = Number(raw);
    if (value === 5 || value === 10) return value;
    return null;
  }

  private normalizeSeed2Model(raw: unknown): 'pro' | 'lite' | 'mini' | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim().toLowerCase();
    if (!value) return null;

    if (
      value === 'seed-2.0-pro' ||
      value === 'seedance-2.0-pro' ||
      value === 'seed-2-0-pro' ||
      value === '2.0-pro'
    ) {
      return 'pro';
    }

    if (
      value === 'seed-2.0-mini' ||
      value === 'seedance-2.0-mini' ||
      value === 'seed-2-0-mini' ||
      value === '2.0-mini'
    ) {
      return 'mini';
    }

    if (
      value === 'seed-2.0-lite' ||
      value === 'seedance-2.0-lite' ||
      value === 'seed-2-0-lite' ||
      value === '2.0-lite'
    ) {
      return 'lite';
    }

    return null;
  }

  private resolveSeed2ModelCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    if (serviceType !== 'doubao-video') {
      return defaultCredits;
    }

    const seedanceModel =
      typeof requestParams?.seedanceModel === 'string'
        ? requestParams.seedanceModel.trim().toLowerCase()
        : '';
    const seed2Model = this.normalizeSeed2Model(requestParams?.seedanceModel ?? requestParams?.model);

    if (!seed2Model) {
      return defaultCredits;
    }

    if (seedanceModel === 'seedance-2.0' || seedanceModel === 'seedance-2.0-fast') {
      return defaultCredits;
    }

    if (seed2Model === 'pro') return 1100;
    if (seed2Model === 'mini') return 500;
    if (seed2Model === 'lite') return 700;

    return defaultCredits;
  }

  private normalizeVolcEnhanceToolVersion(raw: unknown): 'standard' | 'professional' {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return value === 'professional' ? 'professional' : 'standard';
  }

  private normalizeVolcEnhanceResolutionTier(
    requestParams: any,
  ): '720P' | '1080P' | '2K' | '4K' {
    const rawResolution =
      typeof requestParams?.resolution === 'string' ? requestParams.resolution.trim().toUpperCase() : '';
    if (rawResolution === '720P') return '720P';
    if (rawResolution === '1080P') return '1080P';
    if (rawResolution === '2K') return '2K';
    if (rawResolution === '4K') return '4K';

    const limitRaw = Number(requestParams?.resolutionLimit);
    if (Number.isFinite(limitRaw) && limitRaw > 0) {
      const limit = Math.max(64, Math.min(2160, Math.round(limitRaw)));
      if (limit <= 720) return '720P';
      if (limit <= 1080) return '1080P';
      if (limit <= 1440) return '2K';
      return '4K';
    }

    return '1080P';
  }

  private resolveVolcEnhanceResolutionFactor(
    requestParams: any,
  ): 1 | 2 | 4 | 8 {
    const tier = this.normalizeVolcEnhanceResolutionTier(requestParams);
    if (tier === '720P') return 1;
    if (tier === '1080P') return 2;
    if (tier === '2K') return 4;
    return 8;
  }

  private normalizeVolcEnhanceFpsBand(requestParams: any): 'lte30' | 'gt30' {
    const fpsRaw = Number(requestParams?.fps);
    if (!Number.isFinite(fpsRaw) || fpsRaw <= 0) {
      return 'lte30';
    }
    return fpsRaw > 30 ? 'gt30' : 'lte30';
  }

  private resolveVolcEnhanceVersionFactor(
    requestParams: any,
  ): 1 | 10 {
    return this.normalizeVolcEnhanceToolVersion(requestParams?.toolVersion) === 'professional'
      ? 10
      : 1;
  }

  private resolveVolcEnhanceVideoCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    if (serviceType !== 'volc-enhance-video') return defaultCredits;
    const version = this.normalizeVolcEnhanceToolVersion(requestParams?.toolVersion);
    const resolutionTier = this.normalizeVolcEnhanceResolutionTier(requestParams);
    const fpsBand = this.normalizeVolcEnhanceFpsBand(requestParams);
    const resolved = VOLC_ENHANCE_VIDEO_PRICING[version]?.[resolutionTier]?.[fpsBand];
    if (typeof resolved === 'number' && Number.isFinite(resolved) && resolved > 0) {
      return resolved;
    }
    return defaultCredits;
  }

  private normalizeSeed2Tier(raw: unknown): 'le32k' | 'gt32k_le128k' | 'gt128k_le256k' {
    if (typeof raw !== 'string') return 'gt32k_le128k';
    const value = raw.trim().toLowerCase();
    if (!value) return 'gt32k_le128k';

    if (
      value === 'le32k' ||
      value === 'lt32k' ||
      value === '0-32k' ||
      value === '<32k'
    ) {
      return 'le32k';
    }

    if (
      value === 'gt128k_le256k' ||
      value === '128k-256k' ||
      value === '128k_256k' ||
      value === '>128k'
    ) {
      return 'gt128k_le256k';
    }

    return 'gt32k_le128k';
  }

  private resolveSeed2UnitPriceYuan(
    model: 'pro' | 'lite' | 'mini',
    tier: 'le32k' | 'gt32k_le128k' | 'gt128k_le256k',
  ): { inputRate: number; outputRate: number } {
    const pricing = {
      lite: {
        le32k: { inputRate: 0.6, outputRate: 3.6 },
        gt32k_le128k: { inputRate: 0.9, outputRate: 5.4 },
        gt128k_le256k: { inputRate: 1.8, outputRate: 10.8 },
      },
      pro: {
        le32k: { inputRate: 3.2, outputRate: 16 },
        gt32k_le128k: { inputRate: 4.8, outputRate: 24 },
        gt128k_le256k: { inputRate: 9.6, outputRate: 48 },
      },
      mini: {
        le32k: { inputRate: 0.2, outputRate: 2 },
        gt32k_le128k: { inputRate: 0.4, outputRate: 4 },
        gt128k_le256k: { inputRate: 0.8, outputRate: 8 },
      },
    } as const;

    return pricing[model][tier];
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
      seedanceModel === 'seed-2.0-pro' ||
      seedanceModel === 'seedance-2.0-pro' ||
      seedanceModel === 'seed-2-0-pro' ||
      seedanceModel === '2.0-pro'
    ) {
      return 'Seed 2.0 Pro视频生成';
    }

    if (
      seedanceModel === 'seed-2.0-lite' ||
      seedanceModel === 'seedance-2.0-lite' ||
      seedanceModel === 'seed-2-0-lite' ||
      seedanceModel === '2.0-lite'
    ) {
      return 'Seed 2.0 Lite视频生成';
    }

    if (
      seedanceModel === 'seed-2.0-mini' ||
      seedanceModel === 'seedance-2.0-mini' ||
      seedanceModel === 'seed-2-0-mini' ||
      seedanceModel === '2.0-mini'
    ) {
      return 'Seed 2.0 Mini视频生成';
    }

    if (
      modelKey === 'seedance-2.0' ||
      seedanceModel === 'seedance-2.0' ||
      seedanceModel === '2.0' ||
      seedanceModel === 'seedance-2.0-fast' ||
      seedanceModel === '2.0-fast'
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
   * ??????????????
   * ??????? + ??? + ???? + ??
   * ???"Nano banana Pro ?? 1K x2 ??"
   */
  private resolveBananaImageServiceName(
    serviceType: ServiceType,
    defaultServiceName: string,
    requestParams: any,
    outputImageCount?: number,
  ): string {
    // ????? Banana ????
    const isBananaImageService =
      serviceType === 'gemini-2.5-image' ||
      serviceType === 'gemini-3-pro-image' ||
      serviceType === 'gemini-3.1-image' ||
      serviceType === 'gemini-image-edit' ||
      serviceType === 'gemini-3.1-image-edit' ||
      serviceType === 'gemini-2.5-image-edit' ||
      serviceType === 'gemini-image-blend' ||
      serviceType === 'gemini-3.1-image-blend' ||
      serviceType === 'gemini-2.5-image-blend' ||
      serviceType === GPT_IMAGE2_SERVICE_TYPE;

    if (!isBananaImageService) {
      return defaultServiceName;
    }

    // 路由判断
    const explicitRoute =
      this.normalizeBananaImageRoute(requestParams?.bananaImageRoute) ||
      this.normalizeBananaImageRoute(requestParams?.providerOptions?.banana?.imageRoute);
    let route: 'normal' | 'stable' | 'ultra' | null = explicitRoute;
    if (!route) {
      const channelCandidates = [
        requestParams?.channel,
        requestParams?.providerChannel,
        requestParams?.executionChannel,
        requestParams?.channelHint,
      ];
      for (const candidate of channelCandidates) {
        if (typeof candidate !== 'string') continue;
        const normalized = this.normalizeChannel(candidate);
        if (normalized) {
          if (normalized === 'tencent') route = 'stable';
          if (normalized === 'apimart') route = 'normal';
          break;
        }
      }
    }
    const routeLabel = route === 'stable' ? '尊享' : route === 'ultra' ? '极速' : '普通';

    // ?????
    const imageSize = requestParams?.imageSize;
    let resolutionLabel = '';
    if (imageSize && typeof imageSize === 'string') {
      const normalizedSize = imageSize.trim().toUpperCase();
      if (normalizedSize) {
        resolutionLabel = ` ${normalizedSize}`;
      }
    }

    // ??????
    let countLabel = '';
    const count = typeof outputImageCount === 'number' && outputImageCount > 1
      ? outputImageCount
      : typeof requestParams?.outputImageCount === 'number' && requestParams.outputImageCount > 1
      ? requestParams.outputImageCount
      : null;
    if (count) {
      countLabel = ` x${count}`;
    }

    return `${defaultServiceName}${resolutionLabel}${countLabel} ${routeLabel}`;
  }

  /**
   * happyhorse-r2v-video ???? � ??????
   * pricing.dynamicPricing.perSecondByResolution = { '720P': N, '1080P': M }
   * credits = duration * rate[resolution]?????? defaultCredits
   */
  private resolveHappyhorseR2VCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    if (serviceType !== 'happyhorse-r2v-video') return defaultCredits;
    const pricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const matrix = pricing?.dynamicPricing?.perSecondByResolution as
      | Record<string, number>
      | undefined;
    if (!matrix) return defaultCredits;
    const resolution = (requestParams?.resolution || '').toString().toUpperCase();
    const rate = matrix[resolution];
    const duration = Number(requestParams?.duration);
    if (rate && Number.isFinite(duration) && duration > 0) {
      return Math.round(rate * duration);
    }
    return defaultCredits;
  }

  /**
   * ???????????
   * ???????????????? pricing.resolutionPricing ???
   */
  private resolveImageResolutionCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
  ): number {
    const routeAwareBananaCredits = this.resolveTencentBananaResolutionCredits(
      serviceType,
      requestParams,
    );
    if (typeof routeAwareBananaCredits === 'number') {
      return routeAwareBananaCredits;
    }

    const servicePricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
    const resolutionPricing = servicePricing?.resolutionPricing;
    if (!resolutionPricing || typeof resolutionPricing !== 'object') {
      return defaultCredits;
    }

    // ????????
    const requestedImageSize = requestParams?.imageSize;
    if (!requestedImageSize || typeof requestedImageSize !== 'string') {
      return defaultCredits;
    }

    // ??????????? '4K', '2K', '1K', '0.5K' ??
    const normalizedSize = requestedImageSize.trim().toUpperCase();
    
    // ??????????
    const configuredCredits = Number(resolutionPricing[normalizedSize]);
    if (Number.isFinite(configuredCredits) && configuredCredits > 0) {
      return configuredCredits;
    }

    // ??????????????????
    return defaultCredits;
  }

  private normalizeResolutionForBananaTencentPricing(
    rawSize: unknown,
    tier: BananaTencentPricingTier,
  ): '0.5K' | '1K' | '2K' | '4K' {
    const normalized = typeof rawSize === 'string' ? rawSize.trim().toUpperCase() : '';
    if (tier === 'fast') return '1K';
    if (tier === 'pro') {
      if (normalized === '2K' || normalized === '4K') return normalized;
      return '1K';
    }
    if (
      normalized === '0.5K' ||
      normalized === '1K' ||
      normalized === '2K' ||
      normalized === '4K'
    ) {
      return normalized;
    }
    return '1K';
  }

  private normalizeResolutionForGptImage2TencentPricing(
    rawSize: unknown,
  ): '1K' | '2K' | '4K' {
    const normalized = typeof rawSize === 'string' ? rawSize.trim().toUpperCase() : '';
    if (normalized === '2K') return '2K';
    if (normalized === '4K') return '4K';
    return '1K';
  }

  private normalizeGptImage2QualityForTencentPricing(
    rawQuality: unknown,
  ): 'low' | 'medium' | 'high' {
    const normalized = typeof rawQuality === 'string' ? rawQuality.trim().toLowerCase() : '';
    if (normalized === 'high') return 'high';
    if (normalized === 'medium') return 'medium';
    if (normalized === 'low') return 'low';
    // auto / empty / invalid ??? low ??
    return 'low';
  }

  private normalizeBananaImageRoute(
    rawRoute: unknown,
  ): 'normal' | 'stable' | 'ultra' | null {
    if (typeof rawRoute !== 'string') return null;
    const value = rawRoute.trim().toLowerCase();
    if (!value) return null;
    if (value === 'normal' || value === 'apimart') return 'normal';
    if (value === 'stable' || value === 'tencent') return 'stable';
    if (value === 'ultra' || value === 'beqlee') return 'ultra';
    return null;
  }

  private resolveBananaRouteFromRequestParams(
    requestParams: any,
  ): 'normal' | 'stable' | 'ultra' | null {
    const explicitRoute =
      this.normalizeBananaImageRoute(requestParams?.bananaImageRoute) ||
      this.normalizeBananaImageRoute(requestParams?.providerOptions?.banana?.imageRoute) ||
      this.normalizeBananaImageRoute(requestParams?.providerOptions?.bananaImageRoute);
    if (explicitRoute) return explicitRoute;

    const channelCandidates = [
      requestParams?.channel,
      requestParams?.providerChannel,
      requestParams?.executionChannel,
      requestParams?.channelHint,
    ];
    for (const candidate of channelCandidates) {
      if (typeof candidate !== 'string') continue;
      const normalized = this.normalizeChannel(candidate);
      if (normalized === 'tencent') return 'stable';
      if (normalized === 'apimart' || normalized === '147') return 'normal';
    }

    return null;
  }

  private resolveBananaTextPricingTierFromProvider(
    rawProvider: unknown,
  ): BananaTextPricingTier | null {
    if (typeof rawProvider !== 'string') return null;
    const provider = rawProvider.trim().toLowerCase();
    if (!provider) return null;
    if (provider === 'banana-2.5') return 'fast';
    if (provider === 'banana-3.1' || provider === 'nano2') return 'ultra';
    if (provider === 'banana' || provider === 'banana-3.0' || provider === 'gemini-pro') {
      return 'pro';
    }
    return null;
  }

  private resolveBananaTextPricingTierFromModel(
    rawModel: unknown,
  ): BananaTextPricingTier | null {
    if (typeof rawModel !== 'string') return null;
    const model = rawModel.trim().toLowerCase();
    if (!model) return null;
    if (model.includes('2.5')) return 'fast';
    if (model.includes('3.1')) return 'ultra';
    if (model.includes('gemini-3') || model.includes('3-pro') || model.includes('3-flash')) {
      return 'pro';
    }
    return null;
  }

  private resolveBananaTextPricingTier(
    requestParams: any,
    model?: string,
    allowModelFallback = false,
  ): BananaTextPricingTier | null {
    const providerTier =
      this.resolveBananaTextPricingTierFromProvider(requestParams?.aiProvider) ||
      this.resolveBananaTextPricingTierFromProvider(requestParams?.requestedProvider) ||
      this.resolveBananaTextPricingTierFromProvider(requestParams?.routedProvider);
    if (providerTier) return providerTier;
    return allowModelFallback
      ? this.resolveBananaTextPricingTierFromModel(model || requestParams?.model)
      : null;
  }

  private resolveVideoAnalyzeRouteCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
    model?: string,
  ): number {
    if (serviceType !== 'gemini-video-analyze') {
      return defaultCredits;
    }

    const routeKey = this.resolveBananaRouteFromRequestParams(requestParams) || 'normal';
    const tier =
      this.resolveBananaTextPricingTier(requestParams, model, true) || 'fast';
    const configuredCredits = Number(VIDEO_ANALYZE_ROUTE_PRICING[routeKey][tier]);
    return Number.isFinite(configuredCredits) && configuredCredits > 0
      ? configuredCredits
      : defaultCredits;
  }

  private resolveBananaTextRouteCredits(
    serviceType: ServiceType,
    defaultCredits: number,
    requestParams: any,
    model?: string,
  ): number {
    if (serviceType !== 'gemini-text' && serviceType !== 'gemini-prompt-optimize') {
      return defaultCredits;
    }

    // DEBUG: Log input parameters for credit calculation
    this.logger.debug(
      `[Credits] resolveBananaTextRouteCredits: serviceType=${serviceType}, defaultCredits=${defaultCredits}, model=${model}, requestParams=${JSON.stringify(requestParams)}`
    );

    const route = this.resolveBananaRouteFromRequestParams(requestParams);
    const tier =
      this.resolveBananaTextPricingTier(requestParams, model, Boolean(route));
    if (!tier) {
      this.logger.debug(`[Credits] resolveBananaTextRouteCredits: no tier found, returning defaultCredits=${defaultCredits}`);
      return defaultCredits;
    }

    const routeKey: 'normal' | 'stable' | 'ultra' = route || 'normal';
    const configuredCredits = Number(BANANA_TEXT_CHAT_ROUTE_PRICING[routeKey][tier]);
    if (!Number.isFinite(configuredCredits) || configuredCredits <= 0) {
      this.logger.debug(`[Credits] resolveBananaTextRouteCredits: invalid credits, returning defaultCredits=${defaultCredits}`);
      return defaultCredits;
    }

    this.logger.debug(
      `[Credits] resolveBananaTextRouteCredits: route=${routeKey}, tier=${tier}, credits=${configuredCredits}`
    );
    return configuredCredits;
  }

  private resolveTencentBananaResolutionCredits(
    serviceType: ServiceType,
    requestParams: any,
  ): number | null {
    // normal=普通渠道, stable=尊享渠道, ultra=极速渠道(beqlee)
    const explicitRoute =
      this.normalizeBananaImageRoute(requestParams?.bananaImageRoute) ||
      this.normalizeBananaImageRoute(requestParams?.providerOptions?.banana?.imageRoute) ||
      this.normalizeBananaImageRoute(requestParams?.providerOptions?.bananaImageRoute);
    let route: 'normal' | 'stable' | 'ultra' | null = explicitRoute;
    if (!route) {
      const channelCandidates = [
        requestParams?.channel,
        requestParams?.providerChannel,
        requestParams?.executionChannel,
        requestParams?.channelHint,
      ];
      for (const candidate of channelCandidates) {
        if (typeof candidate !== 'string') continue;
        const normalized = this.normalizeChannel(candidate);
        if (normalized) {
          if (normalized === 'tencent') route = 'stable';
          if (normalized === 'apimart') route = 'normal';
          break;
        }
      }
    }

    if (serviceType === GPT_IMAGE2_SERVICE_TYPE) {
      if (!route) return null;

      const normalizedSize = this.normalizeResolutionForGptImage2TencentPricing(
        requestParams?.imageSize,
      );
      const configuredCredits =
        route === 'stable'
          ? Number(
              GPT_IMAGE2_TENCENT_RESOLUTION_PRICING[
                this.normalizeGptImage2QualityForTencentPricing(requestParams?.quality)
              ][normalizedSize],
            )
          : Number(GPT_IMAGE2_NORMAL_RESOLUTION_PRICING[normalizedSize]);
      if (!Number.isFinite(configuredCredits) || configuredCredits <= 0) {
        return null;
      }
      return configuredCredits;
    }

    const tier = BANANA_TENCENT_IMAGE_SERVICE_TIERS[serviceType];
    if (!tier) return null;

    const pricingTable =
      route === 'stable'
        ? BANANA_TENCENT_STABLE_RESOLUTION_PRICING[tier]
        : route === 'ultra'
          ? BANANA_ULTRA_RESOLUTION_PRICING[tier]
          : BANANA_TENCENT_RESOLUTION_PRICING[tier];

    const normalizedSize = this.normalizeResolutionForBananaTencentPricing(
      requestParams?.imageSize,
      tier,
    );
    const configuredCredits = Number(pricingTable[normalizedSize]);
    if (!Number.isFinite(configuredCredits) || configuredCredits <= 0) {
      return null;
    }
    return configuredCredits;
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
    options?: {
      billingRemark?: string | null;
    },
  ): Prisma.InputJsonValue {
    const deductionPayload = deductions.map((item) =>
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
    ) as Prisma.JsonArray;

    const payload: Prisma.JsonObject = {
      deductions: deductionPayload,
    };

    if (typeof options?.billingRemark === 'string' && options.billingRemark.trim().length > 0) {
      payload.billingRemark = options.billingRemark.trim();
    }

    return payload as Prisma.InputJsonValue;
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

  private async expireFreeUserMonthlyQuotaLotsForAccount(
    tx: Prisma.TransactionClient,
    params: {
      accountId: string;
      now: Date;
      excludeCurrentCycleStartAt?: Date;
      excludeCurrentCycleEndAt?: Date;
    },
  ): Promise<{ expiredLots: number; expiredCredits: number }> {
    const expiredLots = await tx.creditLot.findMany({
      where: {
        accountId: params.accountId,
        status: 'active',
        sourceType: 'subscription',
        validityType: 'fixed_window',
        remainingAmount: { gt: 0 },
        expiresAt: { lte: params.now },
        OR: [
          {
            metadata: {
              path: ['grantedBy'],
              equals: FREE_USER_LEGACY_QUOTA_GRANTED_BY,
            },
          },
          {
            metadata: {
              path: ['grantedBy'],
              equals: FREE_USER_STARTER_QUOTA_GRANTED_BY,
            },
          },
        ],
      },
      orderBy: [{ expiresAt: 'asc' }, { grantedAt: 'asc' }],
    });

    let expiredLotCount = 0;
    let expiredCredits = 0;

    for (const lot of expiredLots) {
      const metadata = this.asJsonObject(lot.metadata);
      const lotCycleStartAt = typeof metadata?.cycleStartAt === 'string'
        ? new Date(metadata.cycleStartAt)
        : null;
      const lotCycleEndAt = typeof metadata?.cycleEndAt === 'string'
        ? new Date(metadata.cycleEndAt)
        : null;

      if (
        params.excludeCurrentCycleStartAt &&
        params.excludeCurrentCycleEndAt &&
        lotCycleStartAt &&
        lotCycleEndAt &&
        lotCycleStartAt.getTime() === params.excludeCurrentCycleStartAt.getTime() &&
        lotCycleEndAt.getTime() === params.excludeCurrentCycleEndAt.getTime()
      ) {
        continue;
      }

      const account = await tx.creditAccount.findUnique({
        where: { id: params.accountId },
        select: { id: true, balance: true },
      });
      if (!account) {
        continue;
      }

      const amountToExpire = Math.min(lot.remainingAmount, account.balance);
      const balanceBefore = account.balance;
      const balanceAfter = Math.max(0, balanceBefore - amountToExpire);

      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
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
          amount: -amountToExpire,
          balanceBefore,
          balanceAfter,
          description: '免费用户一次性额度过期清除',
          creditLotId: lot.id,
          businessType: 'free_monthly_quota_expire',
          metadata: {
            expiredAt: params.now.toISOString(),
            originalRemainingAmount: lot.remainingAmount,
            cycleStartAt: lotCycleStartAt?.toISOString() ?? metadata?.cycleStartAt ?? null,
            cycleEndAt: lotCycleEndAt?.toISOString() ?? metadata?.cycleEndAt ?? null,
          },
        },
      });

      expiredLotCount += 1;
      expiredCredits += amountToExpire;
    }

    return { expiredLots: expiredLotCount, expiredCredits };
  }

  private async grantFreeUserStarterQuotaIfNeeded(params: {
    userId: string;
    account: {
      id: string;
      balance: number;
      totalEarned: number;
    };
    now?: Date;
  }): Promise<boolean> {
    const now = params.now ?? new Date();
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();
    if (policy.freeUserMonthlyQuotaCredits <= 0) {
      return false;
    }

    const validityDays = Math.max(1, Math.floor(policy.membershipRefreshCycleDays));
    const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

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

      await this.expireFreeUserMonthlyQuotaLotsForAccount(tx, {
        accountId: account.id,
        now,
      });

      const accountAfterExpiry = await tx.creditAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: {
          id: true,
          balance: true,
          totalEarned: true,
        },
      });

      const existingGrant = await tx.creditTransaction.findFirst({
        where: {
          accountId: accountAfterExpiry.id,
          businessType: { in: FREE_USER_QUOTA_BUSINESS_TYPES },
        },
        select: { id: true },
      });
      if (existingGrant) {
        return false;
      }

      const lot = await tx.creditLot.create({
        data: buildFreeMonthlyQuotaCreditLotData({
          accountId: accountAfterExpiry.id,
          amount: policy.freeUserMonthlyQuotaCredits,
          grantedAt: now,
          activeAt: now,
          expiresAt,
          durationDays: validityDays,
          metadata: {
            grantedBy: FREE_USER_STARTER_QUOTA_GRANTED_BY,
            grantType: 'free_user_starter_quota',
            validFrom: now.toISOString(),
            validUntil: expiresAt.toISOString(),
          },
        }),
      });

      const balanceBefore = accountAfterExpiry.balance;
      const balanceAfter = balanceBefore + policy.freeUserMonthlyQuotaCredits;

      await tx.creditAccount.update({
        where: { id: accountAfterExpiry.id },
        data: {
          balance: balanceAfter,
          totalEarned: accountAfterExpiry.totalEarned + policy.freeUserMonthlyQuotaCredits,
        },
      });

      await tx.creditTransaction.create({
        data: {
          accountId: accountAfterExpiry.id,
          type: TransactionType.EARN,
          amount: policy.freeUserMonthlyQuotaCredits,
          balanceBefore,
          balanceAfter,
          description: '免费用户一次性额度发放',
          creditLotId: lot.id,
          businessType: FREE_USER_STARTER_QUOTA_BUSINESS_TYPE,
          metadata: {
            validFrom: now.toISOString(),
            validUntil: expiresAt.toISOString(),
          },
        },
      });

      return true;
    });
  }

  async cleanupExpiredFreeUserMonthlyQuotaCredits(now = new Date()): Promise<{
    processedAccounts: number;
    expiredLots: number;
    expiredCredits: number;
  }> {
    const accountsWithExpiredQuota = await this.prisma.creditLot.findMany({
      where: {
        status: 'active',
        sourceType: 'subscription',
        validityType: 'fixed_window',
        remainingAmount: { gt: 0 },
        expiresAt: { lte: now },
        OR: [
          {
            metadata: {
              path: ['grantedBy'],
              equals: FREE_USER_LEGACY_QUOTA_GRANTED_BY,
            },
          },
          {
            metadata: {
              path: ['grantedBy'],
              equals: FREE_USER_STARTER_QUOTA_GRANTED_BY,
            },
          },
        ],
      },
      select: { accountId: true },
      distinct: ['accountId'],
    });

    if (accountsWithExpiredQuota.length === 0) {
      return { processedAccounts: 0, expiredLots: 0, expiredCredits: 0 };
    }

    // 过滤掉付费用户（曾支付成功过任何订单，不论积分还是套餐）。
    // 付费用户的免费额度 lot 不应由"免费用户"清理任务扣除积分。
    const accountIds = accountsWithExpiredQuota.map((a) => a.accountId);
    const creditAccounts = await this.prisma.creditAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, userId: true },
    });
    const accountIdToUserId = new Map(creditAccounts.map((a) => [a.id, a.userId]));
    const allUserIds = creditAccounts.map((a) => a.userId);

    const paidUserIds = new Set(
      (
        await this.prisma.paymentOrder.findMany({
          where: {
            userId: { in: allUserIds },
            status: 'paid',
          },
          select: { userId: true },
          distinct: ['userId'],
        })
      ).map((o) => o.userId),
    );

    let processedAccounts = 0;
    let expiredLots = 0;
    let expiredCredits = 0;

    for (const item of accountsWithExpiredQuota) {
      const userId = accountIdToUserId.get(item.accountId);
      if (userId && paidUserIds.has(userId)) {
        continue;
      }

      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM "CreditAccount" WHERE id = ${item.accountId} FOR UPDATE`,
        );

        return this.expireFreeUserMonthlyQuotaLotsForAccount(tx, {
          accountId: item.accountId,
          now,
        });
      });

      if (result.expiredLots > 0) {
        processedAccounts += 1;
        expiredLots += result.expiredLots;
        expiredCredits += result.expiredCredits;
      }
    }

    return { processedAccounts, expiredLots, expiredCredits };
  }

  private extractChannelFromApiUsage(apiUsage?: {
    provider?: string | null;
    model?: string | null;
    requestParams?: Prisma.JsonValue | null;
  } | null): string | null {
    if (!apiUsage) return null;
    const params = this.asJsonObject(apiUsage.requestParams);
    const explicitRoute =
      this.normalizeBananaImageRoute(params?.bananaImageRoute) ||
      this.normalizeBananaImageRoute(params?.providerOptions?.banana?.imageRoute) ||
      this.normalizeBananaImageRoute(params?.providerOptions?.bananaImageRoute);
    if (explicitRoute === 'stable') return 'tencent';
    if (explicitRoute === 'normal') return 'apimart';
    if (explicitRoute === 'ultra') return 'beqlee';

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

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private asNullableBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['on', 'yes', 'true', '1'].includes(normalized)) return true;
    if (['off', 'no', 'false', '0'].includes(normalized)) return false;
    return null;
  }

  private formatBillingChannel(channel: string | null): string | null {
    if (!channel) return null;
    if (channel === 'apimart') return '普通路线';
    if (channel === 'tencent') return '尊享路线';
    if (channel === '147') return '官方路线';
    if (channel === 'beqlee') return '极速路线';
    return channel;
  }

  private resolveBillingModelLabel(
    serviceType: ServiceType,
    model: string | undefined,
    requestParams?: Record<string, any> | null,
  ): string | null {
    // kling-o3(Omni) 节点为路由到 kling-v3-omni 固定带 klingModel='kling-v3-0'/modelKey 可能
    // 是 kling-3.0，会让账单备注的 model 标签错标成 kling-3.0(与标题"可灵 Kling O3 视频"不符)。
    // 该服务的产品计费模型恒为 kling-o3，直接锁定，保持标题/备注一致。
    if (serviceType === 'kling-o3-video') {
      return 'kling-o3';
    }

    const isVideoService =
      serviceType.includes('video') ||
      serviceType === 'sora-sd' ||
      serviceType === 'sora-hd' ||
      serviceType === 'wan26-r2v';

    const videoModelCandidates: unknown[] = [
      requestParams?.modelKey,
      requestParams?.managedModelKey,
      requestParams?.klingModel,
      requestParams?.viduModelVariant,
      requestParams?.viduModel,
      requestParams?.seedanceModel,
    ];
    const commonCandidates: unknown[] = [requestParams?.soraModel, model, requestParams?.aiProvider];

    const candidates = isVideoService
      ? [...videoModelCandidates, ...commonCandidates]
      : [...commonCandidates, ...videoModelCandidates];

    for (const candidate of candidates) {
      const normalized = this.asNonEmptyString(candidate);
      if (!normalized) continue;

      const lowered = normalized.toLowerCase();
      if (lowered === 'seedance-2.0' || lowered === 'seedance-2.0-fast') {
        return 'Seedance 2.0';
      }

      return normalized;
    }

    return null;
  }

  private buildBillingRemark(params: {
    serviceType: ServiceType;
    model?: string;
    provider?: string | null;
    requestParams?: Prisma.JsonValue | null;
  }): string | null {
    const requestParams = this.asJsonObject(params.requestParams);
    const remarkParts: string[] = [];
    const modelLabel = this.resolveBillingModelLabel(
      params.serviceType,
      params.model,
      requestParams,
    );
    if (modelLabel) remarkParts.push(`model: ${modelLabel}`);

    const imageSize = this.asNonEmptyString(requestParams?.imageSize)?.toUpperCase() ?? null;
    const resolution = this.asNonEmptyString(requestParams?.resolution)?.toUpperCase() ?? null;
    const aspectRatio = this.asNonEmptyString(requestParams?.aspectRatio);
    const mode = this.asNonEmptyString(requestParams?.mode)?.toLowerCase() ?? null;
    const videoMode = this.asNonEmptyString(requestParams?.videoMode)?.toLowerCase() ?? null;
    const durationRaw = Number(requestParams?.duration);
    const duration = Number.isFinite(durationRaw) ? Math.max(0, Math.round(durationRaw)) : null;
    const hasSound = this.asNullableBoolean(requestParams?.sound);
    const generateAudio = this.asNullableBoolean(requestParams?.generateAudio);
    const seedanceModel = this.asNonEmptyString(requestParams?.seedanceModel)?.toLowerCase() ?? null;
    const channel = this.extractChannelFromApiUsage({
      provider: params.provider ?? null,
      model: params.model ?? null,
      requestParams,
    });
    const channelLabel = this.formatBillingChannel(channel);

    const isVideoService =
      params.serviceType.includes('video') ||
      params.serviceType === 'sora-sd' ||
      params.serviceType === 'sora-hd' ||
      params.serviceType === 'wan26-r2v';

    if (imageSize) remarkParts.push(`imageSize: ${imageSize}`);
    if (isVideoService && duration !== null) remarkParts.push(`duration: ${duration}s`);
    if (seedanceModel) remarkParts.push(`seedanceModel: ${seedanceModel}`);
    if (resolution) remarkParts.push(`resolution: ${resolution}`);
    if (aspectRatio) remarkParts.push(`aspectRatio: ${aspectRatio}`);
    if (mode) remarkParts.push(`mode: ${mode}`);
    if (videoMode) remarkParts.push(`videoMode: ${videoMode}`);
    if (hasSound !== null) remarkParts.push(`sound: ${hasSound ? 'on' : 'off'}`);
    if (generateAudio !== null) remarkParts.push(`generateAudio: ${generateAudio ? 'yes' : 'no'}`);
    if (params.serviceType === 'volc-enhance-video') {
      const volcVersion = this.normalizeVolcEnhanceToolVersion(requestParams?.toolVersion);
      const volcResolutionTier = this.normalizeVolcEnhanceResolutionTier(requestParams);
      const volcFpsBand = this.normalizeVolcEnhanceFpsBand(requestParams);
      const volcVersionFactor = this.resolveVolcEnhanceVersionFactor(requestParams);
      const volcResolutionFactor = this.resolveVolcEnhanceResolutionFactor(requestParams);
      const volcFpsFactor = volcFpsBand === 'gt30' ? 2 : 1;
      const volcFactor = volcVersionFactor * volcResolutionFactor * volcFpsFactor;
      const pricing = VOLC_ENHANCE_VIDEO_PRICING[volcVersion]?.[volcResolutionTier]?.[volcFpsBand];
      const pricingLabel = typeof pricing === 'number' ? String(pricing) : 'n/a';
      const basePriceYuan = volcFactor * 0.75;
      remarkParts.push(`volcVersion: ${volcVersion}`);
      remarkParts.push(`volcResolutionTier: ${volcResolutionTier}`);
      remarkParts.push(`volcFpsBand: ${volcFpsBand === 'gt30' ? '>30' : '<=30'}`);
      remarkParts.push(`volcFactor: ${volcFactor}x`);
      remarkParts.push(`volcUnitPriceYuan: ${basePriceYuan}`);
      remarkParts.push(`volcPlatformPrice: ${pricingLabel}`);
    }
    if (channelLabel) remarkParts.push(`channel: ${channelLabel}`);

    const isBananaImageService =
      Boolean(BANANA_TENCENT_IMAGE_SERVICE_TIERS[params.serviceType]) ||
      params.serviceType === GPT_IMAGE2_SERVICE_TYPE;
    if (isBananaImageService) {
      if (channel === 'tencent') {
        remarkParts.push('pricing: stable-route image matrix');
      } else if (channel === 'apimart') {
        remarkParts.push('pricing: normal-route image matrix');
      } else if (channel === '147') {
        remarkParts.push('pricing: official-route image matrix');
      }
    }

    const isBananaTextService =
      params.serviceType === 'gemini-text' ||
      params.serviceType === 'gemini-prompt-optimize';
    if (isBananaTextService) {
      if (channel === 'tencent') {
        remarkParts.push('pricing: text stable route 10 credits/call');
      } else if (channel === 'apimart') {
        remarkParts.push('pricing: text normal route 5 credits/call');
      }
    }

    return remarkParts.length > 0 ? remarkParts.join(' | ') : null;
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

  private getFreeUsageQuotaCutoverAt(): Date | null {
    const raw = process.env.FREE_USAGE_QUOTA_CUTOVER_AT;
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
        `Invalid FREE_USAGE_QUOTA_CUTOVER_AT=${trimmed}, fallback to default ${FREE_USAGE_QUOTA_DEFAULT_CUTOVER_AT}`,
      );
    }

    const fallback = new Date(FREE_USAGE_QUOTA_DEFAULT_CUTOVER_AT);
    if (Number.isNaN(fallback.getTime())) {
      this.logger.warn(
        `Invalid default free usage quota cutover date ${FREE_USAGE_QUOTA_DEFAULT_CUTOVER_AT}, disable cutover filter`,
      );
      return null;
    }

    return fallback;
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
    return this.parsePositiveIntEnv(
      'FREE_USER_DAILY_IMAGE_LIMIT',
      DEFAULT_FREE_USER_DAILY_IMAGE_LIMIT,
    );
  }

  private async getFreeUserDailyVideoLimit(): Promise<number> {
    return this.parsePositiveIntEnv(
      'FREE_USER_DAILY_VIDEO_LIMIT',
      DEFAULT_FREE_USER_DAILY_VIDEO_LIMIT,
    );
  }

  private getFreeUserMonthlyVideoLimit(): number {
    return this.parsePositiveIntEnv(
      'FREE_USER_MONTHLY_VIDEO_LIMIT',
      DEFAULT_FREE_USER_MONTHLY_VIDEO_LIMIT,
    );
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

  private async hasPrivilegedUsageQuotaAccess(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    const [paidOrder, activeMembership, userProfile] = await Promise.all([
      client.paymentOrder.findFirst({
        where: {
          userId,
          status: 'paid',
        },
        select: { id: true },
      }),
      client.userMembershipSubscription.findFirst({
        where: {
          userId,
          status: 'active',
          currentPeriodStartAt: { lte: new Date() },
          currentPeriodEndAt: { gt: new Date() },
        },
        select: { id: true },
      }),
      client.user.findUnique({
        where: { id: userId },
        select: { role: true, noWatermark: true },
      }),
    ]);

    if (paidOrder || activeMembership || userProfile?.noWatermark === true) return true;
    const role = typeof userProfile?.role === 'string' ? userProfile.role.toLowerCase() : '';
    return role === 'admin' || role === 'normal_admin';
  }

  private async shouldSkipFreeUsageQuota(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ): Promise<boolean> {
    return this.hasPrivilegedUsageQuotaAccess(client, userId);
  }

  private async enforceFreeUserImageQuota(
    client: PrismaService | Prisma.TransactionClient,
    params: {
      userId: string;
      serviceType: ServiceType;
      requestedOutputImageCount?: number;
      skipQuota?: boolean;
    },
  ): Promise<void> {
    const { userId, serviceType, requestedOutputImageCount } = params;
    const monthlyLimit = this.getFreeUserMonthlyImageLimit();
    const dailyLimit = await this.getFreeUserDailyImageLimit();

    if (monthlyLimit <= 0 && dailyLimit <= 0) return;
    if (!this.isFreeUserImageQuotaService(serviceType)) return;
    if (params.skipQuota) return;

    const requestedCount = this.resolveImageQuotaRequestCount(requestedOutputImageCount);
    const now = new Date();
    const quotaCutoverAt = this.getFreeUsageQuotaCutoverAt();
    const baseWhere: Prisma.ApiUsageRecordWhereInput = {
      userId,
      serviceType: { in: FREE_USER_IMAGE_LIMITED_SERVICES },
      responseStatus: { in: [ApiResponseStatus.PENDING, ApiResponseStatus.SUCCESS] },
    };

    if (dailyLimit > 0) {
      const { start, end, label } = this.getUtcDayRange(now);
      const effectiveStart =
        quotaCutoverAt && quotaCutoverAt.getTime() > start.getTime() ? quotaCutoverAt : start;
      const usedCount = await this.countImageQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: effectiveStart,
          lt: end,
        },
      });

      if (usedCount + requestedCount > dailyLimit) {
        this.logger.warn(
          `免费用户图片日额度超限 userId=${userId} day=${label} used=${usedCount} requested=${requestedCount} limit=${dailyLimit}`,
        );
        throw new BadRequestException(
          `免费用户图片每日限额为 ${dailyLimit} 张（UTC ${label}），当前已使用 ${usedCount} 张，本次请求 ${requestedCount} 张`,
        );
      }
    }

    if (monthlyLimit > 0) {
      const { start, end, label } = this.getUtcMonthRange(now);
      const effectiveStart =
        quotaCutoverAt && quotaCutoverAt.getTime() > start.getTime() ? quotaCutoverAt : start;
      const usedCount = await this.countImageQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: effectiveStart,
          lt: end,
        },
      });

      if (usedCount + requestedCount > monthlyLimit) {
        this.logger.warn(
          `免费用户图片月额度超限 userId=${userId} month=${label} used=${usedCount} requested=${requestedCount} limit=${monthlyLimit}`,
        );
        throw new BadRequestException(
          `免费用户图片每月限额为 ${monthlyLimit} 张（UTC ${label}），当前已使用 ${usedCount} 张，本次请求 ${requestedCount} 张`,
        );
      }
    }
  }

  private async enforceFreeUserVideoQuota(
    client: PrismaService | Prisma.TransactionClient,
    params: {
      userId: string;
      serviceType: ServiceType;
      skipQuota?: boolean;
    },
  ): Promise<void> {
    const { userId, serviceType } = params;
    const dailyLimit = await this.getFreeUserDailyVideoLimit();
    const monthlyLimit = this.getFreeUserMonthlyVideoLimit();

    if (dailyLimit <= 0 && monthlyLimit <= 0) return;
    if (!this.isFreeUserVideoQuotaService(serviceType)) return;
    if (params.skipQuota) return;

    const now = new Date();
    const baseWhere: Prisma.ApiUsageRecordWhereInput = {
      userId,
      serviceType: { in: FREE_USER_VIDEO_LIMITED_SERVICES },
      responseStatus: { in: [ApiResponseStatus.PENDING, ApiResponseStatus.SUCCESS] },
    };
    const requestedCount = 1;

    if (dailyLimit > 0) {
      const { start, end, label } = this.getUtcDayRange(now);
      const usedCount = await this.countVideoQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: start,
          lt: end,
        },
      });

      if (usedCount + requestedCount > dailyLimit) {
        this.logger.warn(
          `免费用户视频日额度超限 userId=${userId} day=${label} used=${usedCount} requested=${requestedCount} limit=${dailyLimit}`,
        );
        throw new BadRequestException(
          `免费用户视频每日限额为 ${dailyLimit} 次（UTC ${label}），当前已使用 ${usedCount} 次，本次请求 ${requestedCount} 次`,
        );
      }
    }

    if (monthlyLimit > 0) {
      const { start, end, label } = this.getUtcMonthRange(now);
      const usedCount = await this.countVideoQuotaUsage(client, {
        ...baseWhere,
        createdAt: {
          gte: start,
          lt: end,
        },
      });

      if (usedCount + requestedCount > monthlyLimit) {
        this.logger.warn(
          `免费用户视频月额度超限 userId=${userId} month=${label} used=${usedCount} requested=${requestedCount} limit=${monthlyLimit}`,
        );
        throw new BadRequestException(
          `免费用户视频每月限额为 ${monthlyLimit} 次（UTC ${label}），当前已使用 ${usedCount} 次，本次请求 ${requestedCount} 次`,
        );
      }
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
   * ?????????????????????
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
   * ???????????
   * ???????????Double-Checked Locking?????????
   */
  async getOrCreateAccount(userId: string, options?: { skipStarterQuota?: boolean }) {
    // ?????????????????????
    let account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (account) {
      if (options?.skipStarterQuota) {
        return account;
      }

      const granted = await this.grantFreeUserStarterQuotaIfNeeded({
        userId,
        account,
      });
      if (!granted) {
        return account;
      }

      return this.prisma.creditAccount.findUniqueOrThrow({
        where: { userId },
      });
    }

    // ????????????????????????
    try {
      account = await this.prisma.$transaction(async (tx) => {
        // ????????????????????
        // ???????????????????
        const existingAccount = await tx.creditAccount.findUnique({
          where: { userId },
        });

        if (existingAccount) {
          return existingAccount;
        }

        // ???????????????????????????????????
        const newAccount = await tx.creditAccount.create({
          data: {
            userId,
            balance: 0,
            totalEarned: 0,
          },
        });

        return newAccount;
      }, {
        // ???????????
        timeout: 10000, // 10???
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });

      if (options?.skipStarterQuota) {
        return account;
      }

      const granted = await this.grantFreeUserStarterQuotaIfNeeded({
        userId,
        account,
      });
      if (!granted) {
        return account;
      }

      return this.prisma.creditAccount.findUniqueOrThrow({
        where: { userId },
      });
    } catch (error) {
      // ??????????????????????????????
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(`??????????? userId=${userId}?????`);
        const existingAccount = await this.prisma.creditAccount.findUnique({
          where: { userId },
        });
        if (!existingAccount) {
          // ???????????????
          this.logger.error(`P2002???????? userId=${userId}`);
          throw error;
        }
        if (options?.skipStarterQuota) {
          return existingAccount;
        }

        const granted = await this.grantFreeUserStarterQuotaIfNeeded({
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

  async issueFreeUserStarterQuotaCredits(now = new Date()) {
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

      const account = await this.getOrCreateAccount(user.id, { skipStarterQuota: true });
      const granted = await this.grantFreeUserStarterQuotaIfNeeded({
        userId: user.id,
        account,
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
   * ????????
   */
  async getBalance(userId: string): Promise<number> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }
    return account.balance;
  }

  /**
   * ??????????
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
   * ???????????
   */
  async hasEnoughCredits(userId: string, serviceType: ServiceType): Promise<boolean> {
    const pricing = await this.resolveServicePricing({ serviceType });
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }

    const balance = await this.getBalance(userId);
    return balance >= pricing.creditsPerCall;
  }

  /**
   * ??????
   */
  async getServicePricing(serviceType: ServiceType) {
    const pricing = await this.resolveServicePricing({ serviceType });
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }
    return {
      serviceType,
      ...pricing,
    };
  }

  private normalizeCatalogCondition(
    condition: ManagedPricingCondition | null | undefined,
  ): PricingCatalogRuleConditionView | null {
    const field = typeof condition?.field === 'string' ? condition.field.trim() : '';
    if (!field) return null;
    return {
      field,
      op: typeof condition?.op === 'string' ? condition.op : 'eq',
      ...(condition?.value !== undefined ? { value: condition.value } : {}),
    };
  }

  private buildEvaluatorFormula(
    evaluator: ManagedPricingEvaluator | undefined,
  ): string | undefined {
    if (!evaluator || typeof evaluator !== 'object') return undefined;

    if (evaluator.type === 'fixed') {
      const credits =
        typeof evaluator.credits === 'number'
          ? evaluator.credits
          : typeof evaluator.priceYuan === 'number'
          ? Math.ceil(evaluator.priceYuan * CREDITS_PER_YUAN)
          : undefined;
      return credits !== undefined ? `${credits} 积分` : '未配置';
    }

    if (evaluator.type === 'linear') {
      const creditsPerUnit = Math.ceil(evaluator.unitPriceYuan * CREDITS_PER_YUAN);
      return `credits = ${evaluator.unitField} � ${creditsPerUnit}`;
    }

    if (evaluator.type === 'base_plus_linear') {
      const baseCredits = Math.ceil(evaluator.basePriceYuan * CREDITS_PER_YUAN);
      const extraCreditsPerUnit = Math.ceil(evaluator.extraUnitPriceYuan * CREDITS_PER_YUAN);
      return `credits = ${baseCredits} + max(0, ${evaluator.unitField} - ${evaluator.includedUnits}) � ${extraCreditsPerUnit}`;
    }

    if (evaluator.type === 'lookup_matrix') {
      return `credits = lookup_matrix(${evaluator.axes.join(', ')})`;
    }

    return undefined;
  }

  private buildCatalogRules(vendor: ManagedModelVendorConfig): PricingCatalogRuleView[] {
    const pricing =
      vendor.pricing && typeof vendor.pricing === 'object' && !Array.isArray(vendor.pricing)
        ? vendor.pricing
        : null;
    const matchingRules = Array.isArray(pricing?.matchingRules)
      ? (pricing.matchingRules as ManagedPricingMatchingRule[])
      : [];
    const evaluators =
      pricing?.evaluators && typeof pricing.evaluators === 'object' && !Array.isArray(pricing.evaluators)
        ? (pricing.evaluators as Record<string, ManagedPricingEvaluator>)
        : {};

    const structuredRules = matchingRules.map((rule) => {
      const evaluatorKey =
        typeof rule?.evaluatorKey === 'string' ? rule.evaluatorKey.trim() : '';
      const evaluator = evaluatorKey ? evaluators[evaluatorKey] : undefined;
      return {
        ...(typeof rule?.ruleKey === 'string' && rule.ruleKey.trim()
          ? { ruleKey: rule.ruleKey.trim() }
          : {}),
        ...(typeof rule?.label === 'string' && rule.label.trim()
          ? { label: rule.label.trim() }
          : {}),
        ...(typeof rule?.priority === 'number' ? { priority: rule.priority } : {}),
        ...(evaluatorKey ? { evaluatorKey } : {}),
        ...(typeof evaluator?.type === 'string' ? { evaluatorType: evaluator.type } : {}),
        ...(this.buildEvaluatorFormula(evaluator)
          ? { formula: this.buildEvaluatorFormula(evaluator) }
          : {}),
        conditions: {
          all: (Array.isArray(rule?.conditions?.all) ? rule.conditions.all : [])
            .map((condition) => this.normalizeCatalogCondition(condition))
            .filter((condition): condition is PricingCatalogRuleConditionView => !!condition),
          any: (Array.isArray(rule?.conditions?.any) ? rule.conditions.any : [])
            .map((condition) => this.normalizeCatalogCondition(condition))
            .filter((condition): condition is PricingCatalogRuleConditionView => !!condition),
        },
      } satisfies PricingCatalogRuleView;
    });

    if (structuredRules.length > 0) return structuredRules;

    const legacyRules = Array.isArray((vendor.metadata as Record<string, any> | undefined)?.specPricing?.rules)
      ? ((vendor.metadata as Record<string, any>).specPricing.rules as Array<Record<string, any>>)
      : [];

    return legacyRules.map((rule, index) => {
      const credits =
        typeof rule?.price?.credits === 'number'
          ? rule.price.credits
          : typeof rule?.creditsPerCall === 'number'
          ? rule.creditsPerCall
          : undefined;
      const priceYuan =
        typeof rule?.price?.priceYuan === 'number'
          ? rule.price.priceYuan
          : typeof rule?.priceYuan === 'number'
          ? rule.priceYuan
          : undefined;
      const resolvedCredits =
        credits !== undefined
          ? credits
          : priceYuan !== undefined
          ? Math.ceil(priceYuan * CREDITS_PER_YUAN)
          : undefined;
      return {
        ruleKey:
          typeof rule?.ruleKey === 'string' && rule.ruleKey.trim()
            ? rule.ruleKey.trim()
            : `legacy_rule_${index + 1}`,
        ...(typeof rule?.label === 'string' && rule.label.trim()
          ? { label: rule.label.trim() }
          : {}),
        ...(resolvedCredits !== undefined
          ? { formula: `${resolvedCredits} 积分` }
          : {}),
        conditions: {
          all: Object.entries(
            rule?.when && typeof rule.when === 'object' && !Array.isArray(rule.when)
              ? rule.when
              : rule?.match && typeof rule.match === 'object' && !Array.isArray(rule.match)
              ? rule.match
              : {},
          ).map(([field, value]) => ({
            field,
            op: 'eq',
            value,
          })),
          any: [],
        },
      };
    });
  }

  private buildCatalogDimensions(vendor: ManagedModelVendorConfig): PricingCatalogDimensionView[] {
    const pricing =
      vendor.pricing && typeof vendor.pricing === 'object' && !Array.isArray(vendor.pricing)
        ? vendor.pricing
        : null;
    const dimensions = Array.isArray(pricing?.dimensions) ? pricing.dimensions : [];
    return dimensions
      .map((dimension): PricingCatalogDimensionView | null => {
        if (typeof dimension === 'string') {
          return { key: dimension };
        }
        const item = dimension as ManagedPricingDimensionDefinition;
        const key = typeof item?.key === 'string' ? item.key.trim() : '';
        if (!key) return null;
        return {
          key,
          ...(typeof item.label === 'string' && item.label.trim()
            ? { label: item.label.trim() }
            : {}),
          ...(typeof item.type === 'string' ? { type: item.type } : {}),
          ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
          ...(typeof item.description === 'string' && item.description.trim()
            ? { description: item.description.trim() }
            : {}),
          ...(Array.isArray(item.options)
            ? {
                options: item.options
                  .filter((option) => option && option.value !== undefined)
                  .map((option) => ({
                    value: option.value,
                    ...(typeof option.label === 'string' && option.label.trim()
                      ? { label: option.label.trim() }
                      : {}),
                  })),
              }
            : {}),
        };
      })
      .filter((dimension): dimension is PricingCatalogDimensionView => dimension !== null);
  }

  async getManagedPricingCatalog(modelKey?: string): Promise<ManagedPricingCatalogItem[]> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MODEL_PROVIDER_MAPPING_SETTING_KEY },
      select: { value: true },
    });
    const raw = typeof setting?.value === 'string' ? setting.value.trim() : '';
    if (!raw) return [];

    const parsed = normalizeSeedance20DiscountPricing(
      JSON.parse(raw) as ManagedPricingMappingLike & {
        models?: ManagedModelConfig[];
      },
    );
    const normalizedModelKey = typeof modelKey === 'string' ? modelKey.trim() : '';
    const models = Array.isArray(parsed.models) ? (parsed.models as ManagedModelConfig[]) : [];

    return models
      .filter((model) => {
        const currentModelKey =
          typeof model?.modelKey === 'string' ? model.modelKey.trim() : '';
        if (!currentModelKey) return false;
        if (!normalizedModelKey) return true;
        return currentModelKey === normalizedModelKey;
      })
      .map((model) => {
        const vendors = (Array.isArray(model.vendors) ? model.vendors : [])
          .filter((vendor) => vendor && typeof vendor.vendorKey === 'string' && vendor.vendorKey.trim())
          .map((vendor) => {
            const normalizedVendor = vendor as ManagedModelVendorConfig;
            const defaultPricing = resolveManagedVendorDefaultPricing(normalizedVendor);
            return {
              vendorKey: normalizedVendor.vendorKey.trim(),
              ...(typeof normalizedVendor.label === 'string' && normalizedVendor.label.trim()
                ? { label: normalizedVendor.label.trim() }
                : {}),
              ...(typeof normalizedVendor.provider === 'string' && normalizedVendor.provider.trim()
                ? { provider: normalizedVendor.provider.trim() }
                : {}),
              ...(typeof normalizedVendor.platformKey === 'string' && normalizedVendor.platformKey.trim()
                ? { platformKey: normalizedVendor.platformKey.trim() }
                : {}),
              enabled: normalizedVendor.enabled !== false,
              ...(typeof normalizedVendor.creditsPerCall === 'number'
                ? { creditsPerCall: normalizedVendor.creditsPerCall }
                : {}),
              ...(typeof normalizedVendor.priceYuan === 'number'
                ? { priceYuan: normalizedVendor.priceYuan }
                : {}),
              ...(typeof defaultPricing.pricingVersion === 'string'
                ? { pricingVersion: defaultPricing.pricingVersion }
                : {}),
              defaultPrice: defaultPricing.price || {},
              dimensions: this.buildCatalogDimensions(normalizedVendor),
              rules: this.buildCatalogRules(normalizedVendor),
            } satisfies PricingCatalogVendorView;
          });

        return {
          modelKey: model.modelKey.trim(),
          ...(typeof model.modelName === 'string' && model.modelName.trim()
            ? { modelName: model.modelName.trim() }
            : {}),
          ...(typeof model.taskType === 'string' && model.taskType.trim()
            ? { taskType: model.taskType.trim() }
            : {}),
          enabled: model.enabled !== false,
          ...(typeof model.defaultVendor === 'string' && model.defaultVendor.trim()
            ? { defaultVendor: model.defaultVendor.trim() }
            : {}),
          vendors,
        } satisfies ManagedPricingCatalogItem;
      });
  }

  /**
   * ????????
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
          serviceType === GPT_IMAGE2_SERVICE_TYPE
            ? GPT_IMAGE2_CREDITS
            : typeof item.creditsPerCall === 'number'
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
   * ??????API????
   * ?? API ???? ID?????????
   */
  private normalizeIdempotencyKey(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 128);
  }

  private normalizeIdempotencyWindowMs(raw: unknown): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return PRE_DEDUCT_IDEMPOTENCY_DEFAULT_WINDOW_MS;
    }
    return Math.min(
      PRE_DEDUCT_IDEMPOTENCY_MAX_WINDOW_MS,
      Math.max(1_000, Math.round(value)),
    );
  }

  private stripDedupMetaFromRequestParams(requestParams: unknown): unknown {
    if (!requestParams || typeof requestParams !== 'object' || Array.isArray(requestParams)) {
      return requestParams;
    }
    const objectValue = requestParams as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(objectValue)) {
      if (
        key === 'idempotencyKey' ||
        key === 'requestFingerprint' ||
        key === 'idempotencyWindowMs'
      ) {
        continue;
      }
      cloned[key] = value;
    }
    return cloned;
  }

  private stableStringifyForFingerprint(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringifyForFingerprint(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      const keys = Object.keys(objectValue).sort();
      return `{${keys
        .map((key) => `${JSON.stringify(key)}:${this.stableStringifyForFingerprint(objectValue[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(String(value));
  }

  private buildApiUsageRequestFingerprint(params: {
    serviceType: ServiceType;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    inputImageCount?: number;
    outputImageCount?: number;
    requestParams?: unknown;
  }): string {
    const fingerprintPayload = {
      serviceType: params.serviceType,
      model: params.model || null,
      inputTokens: params.inputTokens ?? null,
      outputTokens: params.outputTokens ?? null,
      inputImageCount: params.inputImageCount ?? null,
      outputImageCount: params.outputImageCount ?? null,
      requestParams: this.stripDedupMetaFromRequestParams(params.requestParams),
    };
    const serialized = this.stableStringifyForFingerprint(fingerprintPayload);
    return createHash('sha256').update(serialized).digest('hex');
  }

  private withDedupMetaInRequestParams(
    requestParams: unknown,
    idempotencyKey: string | null,
    requestFingerprint: string | null,
  ): Record<string, any> | undefined {
    const base =
      requestParams && typeof requestParams === 'object' && !Array.isArray(requestParams)
        ? { ...(requestParams as Record<string, any>) }
        : {};
    if (!idempotencyKey && !requestFingerprint) {
      return Object.keys(base).length > 0 ? base : undefined;
    }
    if (idempotencyKey) {
      base.idempotencyKey = idempotencyKey;
    }
    if (requestFingerprint) {
      base.requestFingerprint = requestFingerprint;
    }
    return base;
  }

  private async findDuplicateApiUsageInWindow(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      serviceType: ServiceType;
      model?: string;
      idempotencyKey: string | null;
      requestFingerprint: string | null;
      windowStartAt: Date;
    },
  ): Promise<{ apiUsageId: string; transactionId: string | null } | null> {
    const statusFilter = {
      in: [ApiResponseStatus.PENDING, ApiResponseStatus.SUCCESS],
    };

    let duplicate = null as { id: string } | null;
    if (params.idempotencyKey) {
      duplicate = await tx.apiUsageRecord.findFirst({
        where: {
          userId: params.userId,
          serviceType: params.serviceType,
          ...(params.model ? { model: params.model } : {}),
          responseStatus: statusFilter,
          createdAt: { gte: params.windowStartAt },
          requestParams: {
            path: ['idempotencyKey'],
            equals: params.idempotencyKey,
          },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!duplicate && !params.idempotencyKey && params.requestFingerprint) {
      duplicate = await tx.apiUsageRecord.findFirst({
        where: {
          userId: params.userId,
          serviceType: params.serviceType,
          ...(params.model ? { model: params.model } : {}),
          responseStatus: statusFilter,
          createdAt: { gte: params.windowStartAt },
          requestParams: {
            path: ['requestFingerprint'],
            equals: params.requestFingerprint,
          },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!duplicate) return null;

    const spendTransaction = await tx.creditTransaction.findFirst({
      where: {
        apiUsageId: duplicate.id,
        type: TransactionType.SPEND,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      apiUsageId: duplicate.id,
      transactionId: spendTransaction?.id ?? null,
    };
  }

  async preDeductCredits(params: ApiUsageParams): Promise<DeductCreditsResult> {
    const {
      userId,
      serviceType,
      model,
      inputTokens,
      outputTokens,
      inputImageCount,
      outputImageCount,
      requestParams,
      ipAddress,
      userAgent,
      idempotencyKey,
      idempotencyWindowMs,
      skipPersonalDeduction,
    } = params;
    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(
      idempotencyKey ?? requestParams?.idempotencyKey,
    );
    const normalizedIdempotencyWindowMs = this.normalizeIdempotencyWindowMs(
      idempotencyWindowMs ?? requestParams?.idempotencyWindowMs,
    );
    const requestFingerprint = this.buildApiUsageRequestFingerprint({
      serviceType,
      model,
      inputTokens,
      outputTokens,
      inputImageCount,
      outputImageCount,
      requestParams,
    });

    const {
      pricing,
      creditsToDeduct,
      effectiveRequestParams,
      requestedProvider,
    } = await this.resolveEffectiveCreditsQuote({
      serviceType,
      model,
      requestParams,
      outputImageCount,
    });
    const apiUsageRequestParams = this.withDedupMetaInRequestParams(
      effectiveRequestParams,
      normalizedIdempotencyKey,
      requestFingerprint,
    );

    return await this.prisma.$transaction(async (tx) => {
      // ???????
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      if (normalizedIdempotencyKey || requestFingerprint) {
        const duplicateUsage = await this.findDuplicateApiUsageInWindow(tx, {
          userId,
          serviceType,
          model,
          idempotencyKey: normalizedIdempotencyKey,
          requestFingerprint,
          windowStartAt: new Date(Date.now() - normalizedIdempotencyWindowMs),
        });
        if (duplicateUsage) {
          this.logger.warn(
            `[Credits] Duplicate pre-deduct blocked user=${userId} service=${serviceType} key=${
              normalizedIdempotencyKey || '-'
            } apiUsageId=${duplicateUsage.apiUsageId}`,
          );
          return {
            success: true,
            newBalance: account.balance,
            transactionId:
              duplicateUsage.transactionId || `duplicate:${duplicateUsage.apiUsageId}`,
            apiUsageId: duplicateUsage.apiUsageId,
            creditsToDeduct,
          };
        }
      }

      // 解析服务名（团队/个人模式共用）
      let effectiveServiceName = this.resolveSoraServiceName(
        serviceType,
        pricing.serviceName,
        apiUsageRequestParams,
        model,
      );
      effectiveServiceName = this.resolveKlingServiceName(
        serviceType,
        effectiveServiceName,
        apiUsageRequestParams,
      );
      effectiveServiceName = this.resolveManagedVideoServiceName(
        serviceType,
        effectiveServiceName,
        apiUsageRequestParams,
      );
      effectiveServiceName = this.resolveBananaImageServiceName(
        serviceType,
        effectiveServiceName,
        apiUsageRequestParams,
        outputImageCount,
      );

      if (skipPersonalDeduction) {
        // 团队模式：只建用量记录，不动个人积分
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
            requestParams: apiUsageRequestParams,
            responseStatus: ApiResponseStatus.PENDING,
            ipAddress,
            userAgent,
          },
        });
        return {
          success: true,
          newBalance: account.balance,
          transactionId: `team:${apiUsage.id}`,
          apiUsageId: apiUsage.id,
          creditsToDeduct,
        };
      }

      // 个人模式：完整的积分扣除流程
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

      const skipFreeUsageQuota = await this.shouldSkipFreeUsageQuota(tx, userId);

      await this.enforceFreeUserImageQuota(tx, {
        userId,
        serviceType,
        requestedOutputImageCount: outputImageCount,
        skipQuota: skipFreeUsageQuota,
      });
      await this.enforceFreeUserVideoQuota(tx, {
        userId,
        serviceType,
        skipQuota: skipFreeUsageQuota,
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
      const billingRemark = this.buildBillingRemark({
        serviceType,
        model,
        provider: requestedProvider || pricing.provider,
        requestParams: apiUsageRequestParams,
      });

      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalSpent: account.totalSpent + creditsToDeduct,
        },
      });

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
          requestParams: apiUsageRequestParams,
          responseStatus: ApiResponseStatus.PENDING,
          ipAddress,
          userAgent,
        },
      });

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.SPEND,
          amount: -deductionPlan.totalDeducted,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `Use ${effectiveServiceName}${
            apiUsageRequestParams?.imageSize
              ? ` (${apiUsageRequestParams.imageSize})`
              : ''
          }`,
          apiUsageId: apiUsage.id,
          consumePolicyCode: consumePolicy.code,
          consumePolicyVersion: consumePolicy.version,
          metadata: this.buildLotDeductionsMetadata(deductionPlan.deductions, {
            billingRemark,
          }),
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
        apiUsageId: apiUsage.id,
        creditsToDeduct,
      };
    }, {
      timeout: PRE_DEDUCT_TRANSACTION_TIMEOUT_MS,
    });
  }

  async previewCredits(params: PreviewCreditsParams) {
    const account = await this.getOrCreateAccount(params.userId);
    let cachedQuote = await this.getCachedPreviewQuote(params);

    if (!cachedQuote) {
      const quote = await this.resolveEffectiveCreditsQuote({
        serviceType: params.serviceType,
        model: params.model,
        requestParams: params.requestParams,
        outputImageCount: params.outputImageCount,
      });
      cachedQuote = {
        serviceName: quote.serviceName,
        requestedProvider: quote.requestedProvider,
        creditsToDeduct: quote.creditsToDeduct,
        managedPricing:
          quote.managedRoutePricing?.source && quote.managedRoutePricing.source !== 'none'
            ? {
                source: quote.managedRoutePricing.source,
                vendorKey: quote.managedRoutePricing.vendorKey,
                ruleKey: quote.managedRoutePricing.ruleKey,
                label: quote.managedRoutePricing.label,
                evaluatorKey: quote.managedRoutePricing.evaluatorKey,
                evaluatorType: quote.managedRoutePricing.evaluatorType,
                pricingVersion: quote.managedRoutePricing.pricingVersion,
                price: quote.managedRoutePricing.price,
              }
            : null,
        effectiveRequestParams: quote.effectiveRequestParams ?? null,
      };
      await this.setCachedPreviewQuote(params, cachedQuote);
    }

    return {
      serviceType: params.serviceType,
      serviceName: cachedQuote.serviceName,
      provider: cachedQuote.requestedProvider,
      model: params.model ?? null,
      credits: cachedQuote.creditsToDeduct,
      balance: account.balance,
      sufficient: account.balance >= cachedQuote.creditsToDeduct,
      managedPricing: cachedQuote.managedPricing,
      requestParams: cachedQuote.effectiveRequestParams ?? null,
    };
  }

  /**
   * ?? API ??????
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
        `[Credits] 邀请奖励发放失败 userId=${inviteeUserId}: ${e instanceof Error ? e.message : String(e)}`,
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

    // ?? API ????? pending ?? success?????????????
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

  async settleSeed2TokenCreditsForUser(
    userId: string,
    apiUsageId: string,
    inputTokens?: number,
    outputTokens?: number,
  ): Promise<void> {
    const hasInputTokens = Number.isFinite(inputTokens);
    const hasOutputTokens = Number.isFinite(outputTokens);
    // Seed2 token settlement requires both sides of token usage.
    // If either side is missing, keep pre-deducted base credits as final fallback.
    if (!hasInputTokens || !hasOutputTokens) {
      return;
    }

    const normalizedInputTokens = hasInputTokens
      ? Math.max(0, Math.floor(inputTokens as number))
      : 0;
    const normalizedOutputTokens = hasOutputTokens
      ? Math.max(0, Math.floor(outputTokens as number))
      : 0;

    await this.prisma.$transaction(async (tx) => {
      const apiUsage = await tx.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!apiUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (apiUsage.userId !== userId) {
        throw new BadRequestException('无权访问该 API 记录');
      }

      if (apiUsage.responseStatus !== ApiResponseStatus.PENDING) {
        return;
      }

      const requestParams = this.asJsonObject(apiUsage.requestParams);
      const seed2Model = this.normalizeSeed2Model(requestParams?.seedanceModel);
      const targetModel = seed2Model ?? this.normalizeSeed2Model(apiUsage.model);

      if (!targetModel) {
        await tx.apiUsageRecord.update({
          where: { id: apiUsageId },
          data: {
            inputTokens: hasInputTokens ? normalizedInputTokens : apiUsage.inputTokens,
            outputTokens: hasOutputTokens ? normalizedOutputTokens : apiUsage.outputTokens,
          },
        });
        return;
      }

      const tier = this.normalizeSeed2Tier(requestParams?.seed2InputTier ?? requestParams?.seedanceInputTier);
      const { inputRate, outputRate } = this.resolveSeed2UnitPriceYuan(targetModel, tier);
      const rawCostYuan =
        (normalizedInputTokens / 1_000_000) * inputRate +
        (normalizedOutputTokens / 1_000_000) * outputRate;
      const settledCredits = Math.max(0, Math.ceil(rawCostYuan * 1.2 * CREDITS_PER_YUAN));

      const existingAdjustment = await tx.creditTransaction.findFirst({
        where: {
          apiUsageId,
          type: TransactionType.ADJUSTMENT,
          metadata: {
            path: ['reason'],
            equals: 'seed2_token_settlement',
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (existingAdjustment) {
        await tx.apiUsageRecord.update({
          where: { id: apiUsageId },
          data: {
            inputTokens: normalizedInputTokens,
            outputTokens: normalizedOutputTokens,
            creditsUsed: settledCredits,
          },
        });
        return;
      }

      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const preDeductedCredits = Math.max(0, Math.floor(apiUsage.creditsUsed));
      const deltaCredits = settledCredits - preDeductedCredits;
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

      if (deltaCredits < 0) {
        const refundCredits = Math.abs(deltaCredits);
        const newBalance = account.balance + refundCredits;
        const adjustedTotalSpent = Math.max(0, account.totalSpent - refundCredits);

        const restoreDeductions: HybridCreditDeduction[] = [];
        let remainingToRestore = refundCredits;
        for (const item of lotDeductions) {
          if (remainingToRestore <= 0) break;
          const restoreAmount = Math.min(item.amount, remainingToRestore);
          if (restoreAmount <= 0) continue;
          if (item.kind === 'lot') {
            if (!item.lotId) continue;
            restoreDeductions.push({
              kind: 'lot',
              lotId: item.lotId,
              amount: restoreAmount,
            });
          } else {
            restoreDeductions.push({
              kind: 'legacy_balance',
              amount: restoreAmount,
            });
          }
          remainingToRestore -= restoreAmount;
        }

        const lotIds = restoreDeductions
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
            deductions: restoreDeductions,
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

        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: newBalance,
            totalSpent: adjustedTotalSpent,
          },
        });

        const restorePayload = restoreDeductions.map((item) =>
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
        ) as unknown as Prisma.JsonArray;

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.ADJUSTMENT,
            amount: refundCredits,
            balanceBefore: account.balance,
            balanceAfter: newBalance,
            description: 'Seed2.0 Token 结算退款',
            apiUsageId,
            consumePolicyCode: spendTransaction?.consumePolicyCode ?? null,
            consumePolicyVersion: spendTransaction?.consumePolicyVersion ?? null,
            metadata: {
              reason: 'seed2_token_settlement',
              direction: 'refund',
              model: targetModel,
              tier,
              inputTokens: normalizedInputTokens,
              outputTokens: normalizedOutputTokens,
              preDeductedCredits,
              settledCredits,
              deltaCredits,
              rawCostYuan,
              markupRate: 0.2,
              deductions: restorePayload,
            },
          },
        });

        await tx.apiUsageRecord.update({
          where: { id: apiUsageId },
          data: {
            inputTokens: normalizedInputTokens,
            outputTokens: normalizedOutputTokens,
            creditsUsed: settledCredits,
          },
        });

        return;
      }

      if (deltaCredits > 0) {
        if (account.balance < deltaCredits) {
          this.logger.warn(
            '[Credits] Seed2 settlement charge skipped due to insufficient balance user=' + userId +
              ' apiUsageId=' + apiUsageId +
              ' delta=' + deltaCredits +
              ' balance=' + account.balance,
          );

          await tx.apiUsageRecord.update({
            where: { id: apiUsageId },
            data: {
              inputTokens: normalizedInputTokens,
              outputTokens: normalizedOutputTokens,
            },
          });
          return;
        }

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
          serviceType: apiUsage.serviceType,
          provider: apiUsage.provider,
          model: apiUsage.model ?? null,
        });

        const deductionPlan = buildHybridCreditDeductionPlan({
          accountBalance: account.balance,
          amount: deltaCredits,
          lots: activeLots.map((lot) => this.toCreditLotCandidate(lot)),
          now: new Date(),
          scope: {
            serviceType: apiUsage.serviceType,
            provider: apiUsage.provider,
            model: apiUsage.model ?? null,
          },
          policy: consumePolicy,
        });

        if (!deductionPlan.sufficient) {
          throw new BadRequestException('积分不足，当前余额: ' + account.balance + '，需补扣: ' + deltaCredits);
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

        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: newBalance,
            totalSpent: account.totalSpent + deductionPlan.totalDeducted,
          },
        });

        const deductionPayload = deductionPlan.deductions.map((item) =>
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
        ) as unknown as Prisma.JsonArray;

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.ADJUSTMENT,
            amount: -deductionPlan.totalDeducted,
            balanceBefore: account.balance,
            balanceAfter: newBalance,
            description: 'Seed2.0 Token 结算补扣',
            apiUsageId,
            consumePolicyCode: consumePolicy.code,
            consumePolicyVersion: consumePolicy.version,
            metadata: {
              reason: 'seed2_token_settlement',
              direction: 'charge',
              model: targetModel,
              tier,
              inputTokens: normalizedInputTokens,
              outputTokens: normalizedOutputTokens,
              preDeductedCredits,
              settledCredits,
              deltaCredits,
              rawCostYuan,
              markupRate: 0.2,
              deductions: deductionPayload,
            },
          },
        });

        await tx.apiUsageRecord.update({
          where: { id: apiUsageId },
          data: {
            inputTokens: normalizedInputTokens,
            outputTokens: normalizedOutputTokens,
            creditsUsed: settledCredits,
          },
        });

        return;
      }

      await tx.apiUsageRecord.update({
        where: { id: apiUsageId },
        data: {
          inputTokens: normalizedInputTokens,
          outputTokens: normalizedOutputTokens,
          creditsUsed: settledCredits,
        },
      });
    });
  }

  /**
   * ????? API ?????????????????????????
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
      throw new BadRequestException('无权访问该 API 记录');
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
   * ????? API ??????????????????????????
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
      throw new BadRequestException('无权访问该 API 记录');
    }

    if (apiUsage.responseStatus === ApiResponseStatus.FAILED) {
      throw new BadRequestException('失败的 API 调用不能标记为成功');
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
        throw new BadRequestException('失败的 API 调用不能标记为成功');
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
   * API ?????????
   */
  async refundCredits(userId: string, apiUsageId: string): Promise<AddCreditsResult> {
    return await this.prisma.$transaction(async (tx) => {
      // ?? API ????
      const apiUsage = await tx.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!apiUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (apiUsage.userId !== userId) {
        throw new BadRequestException('无权访问该 API 记录');
      }

      if (apiUsage.responseStatus !== ApiResponseStatus.FAILED) {
        throw new BadRequestException('只有失败的API调用才能退款');
      }

      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      // ???????? apiUsage ???????????
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

      // ??????
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalSpent: adjustedTotalSpent,
        },
      });

      // ????????
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
   * ???????????????????????
   * ??????????????????
   */
  async adjustCreditsByOutputCount(
    apiUsageId: string,
    actualOutputCount: number,
  ): Promise<{ success: boolean; adjustedAmount: number; newBalance: number }> {
    if (!Number.isFinite(actualOutputCount) || actualOutputCount < 0) {
      throw new BadRequestException('实际产出数量无效');
    }

    const normalizedCount = Math.floor(actualOutputCount);
    if (normalizedCount === 0) {
      throw new BadRequestException('实际产出数量不能为0');
    }

    return await this.prisma.$transaction(async (tx) => {
      const apiUsage = await tx.apiUsageRecord.findUnique({
        where: { id: apiUsageId },
      });

      if (!apiUsage) {
        throw new NotFoundException('API使用记录不存在');
      }

      if (apiUsage.responseStatus !== ApiResponseStatus.SUCCESS) {
        throw new BadRequestException('只能调整成功的API调用积分');
      }

      const account = await tx.creditAccount.findUnique({
        where: { userId: apiUsage.userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const originalRequestParams = this.asJsonObject(apiUsage.requestParams) || {};
      const originalOutputCount = apiUsage.outputImageCount ?? 1;

      if (normalizedCount === originalOutputCount) {
        return { success: true, adjustedAmount: 0, newBalance: account.balance };
      }

      const serviceType = apiUsage.serviceType as ServiceType;
      const isImageLikeService =
        serviceType.includes('image') ||
        serviceType.startsWith('midjourney') ||
        serviceType === GPT_IMAGE2_SERVICE_TYPE ||
        serviceType === 'expand-image' ||
        serviceType === 'background-removal';

      if (!isImageLikeService) {
        return { success: true, adjustedAmount: 0, newBalance: account.balance };
      }

      const unitCredits = Math.floor(apiUsage.creditsUsed / originalOutputCount);
      const newCredits = unitCredits * normalizedCount;
      const creditDifference = newCredits - apiUsage.creditsUsed;

      const existingAdjustment = await tx.creditTransaction.findFirst({
        where: { apiUsageId, type: TransactionType.ADJUSTMENT },
      });

      if (existingAdjustment) {
        return { success: true, adjustedAmount: 0, newBalance: account.balance };
      }

      const spendTransaction = await tx.creditTransaction.findFirst({
        where: { apiUsageId, type: TransactionType.SPEND },
        orderBy: { createdAt: 'asc' },
      });

      const lotDeductions = this.extractLotDeductionsFromMetadata(spendTransaction?.metadata);
      let newBalance = account.balance;

      if (creditDifference < 0) {
        const amountToRefund = Math.abs(creditDifference);

        if (lotDeductions.length > 0) {
          const lotIds = lotDeductions
            .filter((item) => item.kind === 'lot' && !!item.lotId)
            .map((item) => item.lotId as string);

          if (lotIds.length > 0) {
            const lots = await tx.creditLot.findMany({ where: { id: { in: lotIds } } });
            const restoredLots = applyLotRestorationsToSnapshots({
              lots: lots.map((lot) => this.toCreditLotCandidate(lot)),
              deductions: lotDeductions,
            });

            for (const restoredLot of restoredLots) {
              const originalLot = lots.find((lot) => lot.id === restoredLot.id);
              if (!originalLot) continue;

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

        newBalance = account.balance + amountToRefund;

        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: newBalance,
            totalSpent: Math.max(0, account.totalSpent - amountToRefund),
          },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.ADJUSTMENT,
            amount: amountToRefund,
            balanceBefore: account.balance,
            balanceAfter: newBalance,
            description: `积分调整（${apiUsage.serviceName}）：实际产出 ${normalizedCount} 张，退还 ${amountToRefund} 积分`,
            apiUsageId,
            consumePolicyCode: spendTransaction?.consumePolicyCode ?? null,
            consumePolicyVersion: spendTransaction?.consumePolicyVersion ?? null,
          },
        });

        this.logger.log(
          `[Credits] Credit adjustment (refund): apiUsageId=${apiUsageId}, originalCount=${originalOutputCount}, actualCount=${normalizedCount}, refundAmount=${amountToRefund}`
        );
      } else if (creditDifference > 0) {
        const amountToCharge = creditDifference;

        const activeLots = await tx.creditLot.findMany({
          where: { accountId: account.id, status: 'active' },
          select: {
            id: true, sourceType: true, validityType: true, scopeType: true,
            scopeValue: true, totalAmount: true, remainingAmount: true,
            grantedAt: true, activeAt: true, expiresAt: true, priority: true, status: true,
          },
        });

        const consumePolicy = await this.resolveCreditConsumePolicy(tx, {
          serviceType,
          provider: apiUsage.provider ?? null,
          model: apiUsage.model ?? null,
        });

        const deductionPlan = buildHybridCreditDeductionPlan({
          accountBalance: account.balance,
          amount: amountToCharge,
          lots: activeLots.map((lot) => this.toCreditLotCandidate(lot)),
          now: new Date(),
          scope: { serviceType, provider: apiUsage.provider ?? null, model: apiUsage.model ?? null },
          policy: consumePolicy,
        });

        if (!deductionPlan.sufficient) {
          throw new BadRequestException(`积分不足，无法完成调整。当前余额: ${account.balance}，需要补扣: ${amountToCharge}`);
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

        newBalance = account.balance - amountToCharge;

        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: newBalance,
            totalSpent: account.totalSpent + amountToCharge,
          },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.ADJUSTMENT,
            amount: -amountToCharge,
            balanceBefore: account.balance,
            balanceAfter: newBalance,
            description: `积分调整（${apiUsage.serviceName}）：实际产出 ${normalizedCount} 张，补扣 ${amountToCharge} 积分`,
            apiUsageId,
            consumePolicyCode: consumePolicy.code,
            consumePolicyVersion: consumePolicy.version,
            metadata: this.buildLotDeductionsMetadata(deductionPlan.deductions),
          },
        });

        this.logger.log(
          `[Credits] Credit adjustment (charge): apiUsageId=${apiUsageId}, originalCount=${originalOutputCount}, actualCount=${normalizedCount}, chargeAmount=${amountToCharge}`
        );
      }

      await tx.apiUsageRecord.update({
        where: { id: apiUsageId },
        data: {
          outputImageCount: normalizedCount,
          creditsUsed: newCredits,
        },
      });

      return { success: true, adjustedAmount: creditDifference, newBalance };
    });
  }

  /**
   * ??????? pending ??????
   * - ??? failed
   * - ??????????
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
   * ??????? pending ????????
   * - ??? failed
   * - ??????????
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
   * ???????
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
   * ???????
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
   * ????????
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
        serviceType: string;
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
          serviceType: true,
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
      const metadata = this.asJsonObject(tx.metadata);
      const metadataBillingRemark = this.asNonEmptyString(metadata?.billingRemark);
      const usageRequestParams = this.asJsonObject(usage?.requestParams);
      const rawParallelGroupIndex = usageRequestParams?.parallelGroupIndex;
      const rawParallelGroupTotal = usageRequestParams?.parallelGroupTotal;
      const parallelGroupIndex =
        typeof rawParallelGroupIndex === 'number'
          ? Math.trunc(rawParallelGroupIndex)
          : typeof rawParallelGroupIndex === 'string' && rawParallelGroupIndex.trim().length > 0
            ? Math.trunc(Number(rawParallelGroupIndex))
            : null;
      const parallelGroupTotal =
        typeof rawParallelGroupTotal === 'number'
          ? Math.trunc(rawParallelGroupTotal)
          : typeof rawParallelGroupTotal === 'string' && rawParallelGroupTotal.trim().length > 0
            ? Math.trunc(Number(rawParallelGroupTotal))
            : null;
      const fallbackBillingRemark =
        usage && typeof usage.serviceType === 'string'
          ? this.buildBillingRemark({
              serviceType: usage.serviceType as ServiceType,
              model: usage.model ?? undefined,
              provider: usage.provider ?? null,
              requestParams: usage.requestParams,
            })
          : null;
      return {
        ...tx,
        serviceType: usage?.serviceType ?? null,
        channel: this.extractChannelFromApiUsage(usage),
        provider: usage?.provider ?? null,
        model: usage?.model ?? null,
        billingRemark: metadataBillingRemark ?? fallbackBillingRemark,
        apiResponseStatus: usage?.responseStatus ?? null,
        processingTime: usage?.processingTime ?? null,
        parallelGroupId: this.asNonEmptyString(usageRequestParams?.parallelGroupId),
        parallelGroupIndex:
          typeof parallelGroupIndex === 'number' && Number.isFinite(parallelGroupIndex)
            ? parallelGroupIndex
            : null,
        parallelGroupTotal:
          typeof parallelGroupTotal === 'number' &&
          Number.isFinite(parallelGroupTotal) &&
          parallelGroupTotal > 0
            ? parallelGroupTotal
            : null,
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
   * ???? API ????
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
   * ???????????????
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
   * ????????
   * ???????? gift ????????????? VIP ? pauseGiftDecay ???
   * ??????????????????????????? dailyGiftCredits ?????????
   * ????? 7 ??????????? 7 ?????? 1 ???????????
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

      // ????????
      let newConsecutiveDays = 1;
      let bonusCredits = 0;
      let rewardMultiplier = 1;

      if (account.lastCheckInDate) {
        const lastCheckIn = new Date(account.lastCheckInDate);
        const diffDays = this.diffDailyRewardBusinessDays(now, lastCheckIn);

        if (diffDays === 1) {
          // ????
          if (account.consecutiveDays >= 7) {
            // ??7??????1?
            newConsecutiveDays = 1;
          } else {
            newConsecutiveDays = account.consecutiveDays + 1;
          }
        } else if (diffDays === 0) {
          // ????????????????????? canClaim ??? false?
          newConsecutiveDays = account.consecutiveDays;
        }
        // diffDays > 1 ????????1?????????1?
      }

      // ?7????????
      if (newConsecutiveDays === 7) {
        rewardMultiplier = Math.max(1, rewardRule.rewardMultiplier);
        bonusCredits = rewardMultiplier > 1
          ? rewardRule.baseCredits * (rewardMultiplier - 1)
          : 0;
      }

      const totalCredits = rewardRule.baseCredits + bonusCredits;
      const newBalance = account.balance + totalCredits;

      // ????????????????????
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

      // ????????
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
   * ???????????7????
   * ???????7??????????
   * ????????(checked)?????(isToday)?????(??)
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

      // ?????????1?????
      const diffDays = this.diffDailyRewardBusinessDays(now, lastCheckIn);
      if (diffDays > 1) {
        // ???????0???????????????????
        consecutiveDays = 0;
      }
    }

    // ??7???
    const calendarDays: Array<{ day: number; checked: boolean; missed: boolean; isToday: boolean }> = [];

    for (let i = 1; i <= 7; i++) {
      // ?????1???consecutiveDays?
      const checked = i <= consecutiveDays;
      // ????????????????????????
      const isToday = !todayCheckedIn && i === consecutiveDays + 1;

      calendarDays.push({
        day: i,
        checked,
        missed: false, // ????????????????????
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
   * ?????????????????
   * ??????????????
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

    // ??????????????????
    const expiredTransactions = await this.prisma.creditTransaction.findMany({
      where: {
        type: TransactionType.DAILY_REWARD,
        expiresAt: { lte: now },
        isExpired: false,
        creditLotId: null,
        amount: { gt: 0 }, // ??????????????
      },
      include: {
        account: true,
      },
    });

    if (expiredTransactions.length === 0) {
      return { processedUsers: processedUserIds.size, totalExpiredCredits };
    }

    // ???????
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
      // ????????????????
      const isPaid = await this.isPaidUser(userId);
      if (isPaid) {
        // ?????????????????
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

      // ????????????????
      const expiredAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

      if (expiredAmount <= 0) continue;

      // ????????
      const account = await this.prisma.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) continue;

      // ???????????????
      const actualDeduct = Math.min(expiredAmount, account.balance);

      if (actualDeduct > 0) {
        await this.prisma.$transaction(async (tx) => {
          // ??????
          const newBalance = account.balance - actualDeduct;
          await tx.creditAccount.update({
            where: { id: account.id },
            data: { balance: newBalance },
          });

          // ????????
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

          // ????????????
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
        // ???0????????
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
   * ???????????????
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
