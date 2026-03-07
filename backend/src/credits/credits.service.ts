import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CREDIT_PRICING_CONFIG,
  DEFAULT_NEW_USER_CREDITS,
  DAILY_LOGIN_REWARD_CREDITS,
  CONSECUTIVE_7_DAY_BONUS_CREDITS,
  ServiceType,
} from './credits.config';
import { TransactionType, ApiResponseStatus } from './dto/credits.dto';
import { ReferralService } from '../referral/referral.service';

// 签到积分过期天数（普通用户）
const DAILY_REWARD_EXPIRE_DAYS = 7;
const STALE_PENDING_DEFAULT_TIMEOUT_MINUTES = 15;
const STALE_PENDING_DEFAULT_BATCH_SIZE = 200;
const DEFAULT_FREE_USER_MONTHLY_IMAGE_LIMIT = 100;
const DEFAULT_FREE_USER_DAILY_IMAGE_LIMIT = 20;
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
const FREE_USER_IMAGE_LIMITED_SERVICES: ServiceType[] = [
  ...STALE_PENDING_IMAGE_SERVICE_TYPES,
  'midjourney-upscale',
  'expand-image',
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

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);
  private readonly freeUserImageQuotaServiceTypes = new Set<ServiceType>(
    FREE_USER_IMAGE_LIMITED_SERVICES,
  );

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
  ) {}

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

  private getStalePendingBatchSize(): number {
    return this.parsePositiveIntEnv(
      'CREDITS_PENDING_TIMEOUT_BATCH_SIZE',
      STALE_PENDING_DEFAULT_BATCH_SIZE,
    );
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

  private getFreeUserDailyImageLimit(): number {
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

  private isFreeUserImageQuotaService(serviceType: ServiceType): boolean {
    return this.freeUserImageQuotaServiceTypes.has(serviceType);
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
    const dailyLimit = this.getFreeUserDailyImageLimit();

    if (monthlyLimit <= 0 && dailyLimit <= 0) return;
    if (!this.isFreeUserImageQuotaService(serviceType)) return;

    const paidOrder = await client.paymentOrder.findFirst({
      where: {
        userId,
        status: 'paid',
      },
      select: { id: true },
    });
    if (paidOrder) return;

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

  async assertFreeUserImageQuota(
    userId: string,
    serviceType: ServiceType,
    requestedOutputImageCount?: number,
  ): Promise<void> {
    await this.enforceFreeUserImageQuota(this.prisma, {
      userId,
      serviceType,
      requestedOutputImageCount,
    });
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
    // 第一次检查：快速路径，绝大多数场景直接命中
    let account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (account) {
      return account;
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

        // 创建新账户并赠送初始积分
        const newAccount = await tx.creditAccount.create({
          data: {
            userId,
            balance: DEFAULT_NEW_USER_CREDITS,
            totalEarned: DEFAULT_NEW_USER_CREDITS,
          },
        });

        // 记录初始赠送交易
        await tx.creditTransaction.create({
          data: {
            accountId: newAccount.id,
            type: TransactionType.EARN,
            amount: DEFAULT_NEW_USER_CREDITS,
            balanceBefore: 0,
            balanceAfter: DEFAULT_NEW_USER_CREDITS,
            description: '新用户注册赠送积分',
          },
        });

        return newAccount;
      }, {
        // 设置事务超时和隔离级别
        timeout: 10000, // 10秒超时
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });

      return account;
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
        return existingAccount;
      }
      throw error;
    }
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
    const pricing = CREDIT_PRICING_CONFIG[serviceType];
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }

    const balance = await this.getBalance(userId);
    return balance >= pricing.creditsPerCall;
  }

  /**
   * 获取服务定价
   */
  getServicePricing(serviceType: ServiceType) {
    const pricing = CREDIT_PRICING_CONFIG[serviceType];
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
  getAllPricing() {
    return Object.entries(CREDIT_PRICING_CONFIG).map(([key, value]) => ({
      serviceType: key,
      ...value,
    }));
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

    const pricing = CREDIT_PRICING_CONFIG[serviceType];
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }

    let creditsToDeduct: number = pricing.creditsPerCall;
    creditsToDeduct = this.resolveSoraModelCredits(
      serviceType,
      creditsToDeduct,
      requestParams,
      model,
    );

    const requestedImageSize = params?.requestParams?.imageSize;
    const isImageGeneration =
      serviceType !== 'midjourney-imagine' && serviceType.endsWith('-image');
    const is4KBilling = requestedImageSize === '4K' && isImageGeneration;
    if (is4KBilling) {
      creditsToDeduct = 60;
    }

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

      if (account.balance < creditsToDeduct) {
        throw new BadRequestException(`积分不足，当前余额: ${account.balance}，需要: ${creditsToDeduct}`);
      }

      const newBalance = account.balance - creditsToDeduct;

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
          serviceName: pricing.serviceName,
          provider: requestedProvider || pricing.provider,
          model,
          creditsUsed: creditsToDeduct,
          inputTokens,
          outputTokens,
          inputImageCount,
          outputImageCount,
          requestParams,
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
          amount: -creditsToDeduct,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: `使用 ${pricing.serviceName}${is4KBilling ? '（4K）' : ''}`,
          apiUsageId: apiUsage.id,
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
  async updateApiUsageStatus(
    apiUsageId: string,
    status: ApiResponseStatus,
    errorMessage?: string,
    processingTime?: number,
  ) {
    const apiUsage = await this.prisma.apiUsageRecord.update({
      where: { id: apiUsageId },
      data: {
        responseStatus: status,
        errorMessage,
        processingTime,
      },
    });

    // 如果 API 调用成功，检查是否需要核验邀请奖励
    if (status === ApiResponseStatus.SUCCESS && apiUsage.userId) {
      try {
        await this.referralService.verifyAndRewardInviter(apiUsage.userId);
      } catch (e) {
        // 核验失败不影响主流程，只记录日志
        console.warn(`[Credits] 邀请奖励核验失败: ${e instanceof Error ? e.message : e}`);
      }
    }
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

    return this.prisma.apiUsageRecord.update({
      where: { id: apiUsageId },
      data: {
        responseStatus: ApiResponseStatus.FAILED,
        errorMessage,
        processingTime,
      },
    });
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
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const staleRecords = await this.prisma.apiUsageRecord.findMany({
      where: {
        responseStatus: ApiResponseStatus.PENDING,
        serviceType: { in: STALE_PENDING_IMAGE_SERVICE_TYPES },
        createdAt: { lt: cutoff },
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

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.ADMIN_ADJUST,
          amount,
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
    } else {
      // 默认不显示每日签到积分记录
      where.type = { not: TransactionType.DAILY_REWARD };
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
        provider: string;
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
  async canClaimDailyReward(userId: string): Promise<{ canClaim: boolean; lastClaimAt: Date | null }> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }

    if (!account.lastDailyRewardAt) {
      return { canClaim: true, lastClaimAt: null };
    }

    const now = new Date();
    const lastClaim = new Date(account.lastDailyRewardAt);

    // 检查是否是同一天（使用本地时间）
    const isSameDay =
      now.getFullYear() === lastClaim.getFullYear() &&
      now.getMonth() === lastClaim.getMonth() &&
      now.getDate() === lastClaim.getDate();

    return { canClaim: !isSameDay, lastClaimAt: account.lastDailyRewardAt };
  }

  /**
   * 领取每日登录奖励
   * 普通用户的签到积分7天后过期，付费用户永不过期
   * 规则：连续签到7天额外赠送150积分，断签或满7天后重置到第1天
   */
  async claimDailyReward(userId: string): Promise<AddCreditsResult & { alreadyClaimed?: boolean; expiresAt?: Date | null; consecutiveDays?: number; bonusCredits?: number }> {
    const { canClaim, lastClaimAt } = await this.canClaimDailyReward(userId);

    if (!canClaim) {
      return {
        success: false,
        newBalance: (await this.getBalance(userId)),
        transactionId: '',
        alreadyClaimed: true,
      };
    }

    // 检查是否为付费用户
    const isPaid = await this.isPaidUser(userId);

    // 计算过期时间：付费用户永不过期(null)，普通用户7天后过期
    const expiresAt = isPaid ? null : new Date(Date.now() + DAILY_REWARD_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

    return await this.prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      // 计算连续签到天数
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let newConsecutiveDays = 1;
      let bonusCredits = 0;

      if (account.lastCheckInDate) {
        const lastCheckIn = new Date(account.lastCheckInDate);
        lastCheckIn.setHours(0, 0, 0, 0);

        const diffDays = Math.floor((today.getTime() - lastCheckIn.getTime()) / (24 * 60 * 60 * 1000));

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

      // 第7天额外奖励150积分
      if (newConsecutiveDays === 7) {
        bonusCredits = CONSECUTIVE_7_DAY_BONUS_CREDITS;
      }

      const totalCredits = DAILY_LOGIN_REWARD_CREDITS + bonusCredits;
      const newBalance = account.balance + totalCredits;

      // 更新账户余额、最后领取时间和连续签到天数
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalEarned: account.totalEarned + totalCredits,
          lastDailyRewardAt: new Date(),
          lastCheckInDate: new Date(),
          consecutiveDays: newConsecutiveDays,
        },
      });

      // 创建签到交易记录
      const description = bonusCredits > 0
        ? (isPaid ? `连续签到第7天+额外奖励${bonusCredits}积分（永久）` : `连续签到第7天+额外奖励${bonusCredits}积分（${DAILY_REWARD_EXPIRE_DAYS}天后过期）`)
        : (isPaid ? `每日签到第${newConsecutiveDays}天（永久）` : `每日签到第${newConsecutiveDays}天（${DAILY_REWARD_EXPIRE_DAYS}天后过期）`);

      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.DAILY_REWARD,
          amount: totalCredits,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description,
          expiresAt,
          metadata: bonusCredits > 0 ? { bonusCredits, baseCredits: DAILY_LOGIN_REWARD_CREDITS } : undefined,
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
        expiresAt,
        consecutiveDays: newConsecutiveDays,
        bonusCredits,
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
    calendarDays: Array<{ day: number; checked: boolean; missed: boolean; isToday: boolean }>;
  }> {
    const account = await this.getOrCreateAccount(userId);
    if (!account) {
      throw new NotFoundException('用户积分账户不存在');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let todayCheckedIn = false;
    let consecutiveDays = account.consecutiveDays || 0;

    if (account.lastCheckInDate) {
      const lastCheckIn = new Date(account.lastCheckInDate);
      lastCheckIn.setHours(0, 0, 0, 0);
      todayCheckedIn = lastCheckIn.getTime() === today.getTime();

      // 检查是否断签（超过1天没签到）
      const diffDays = Math.floor((today.getTime() - lastCheckIn.getTime()) / (24 * 60 * 60 * 1000));
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
      calendarDays,
    };
  }

  /**
   * 清理过期的签到积分（定时任务调用）
   * 只清理普通用户的过期签到积分
   */
  async cleanupExpiredDailyRewards(): Promise<{ processedUsers: number; totalExpiredCredits: number }> {
    const now = new Date();

    // 查找所有已过期但未处理的签到积分记录
    const expiredTransactions = await this.prisma.creditTransaction.findMany({
      where: {
        type: TransactionType.DAILY_REWARD,
        expiresAt: { lte: now },
        isExpired: false,
        amount: { gt: 0 }, // 只处理正数（获得积分的记录）
      },
      include: {
        account: true,
      },
    });

    if (expiredTransactions.length === 0) {
      return { processedUsers: 0, totalExpiredCredits: 0 };
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
    let totalExpiredCredits = 0;

    for (const [userId, transactions] of userTransactions) {
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

    this.logger.log(`签到积分过期清理完成: 处理 ${processedUsers} 个用户, 清除 ${totalExpiredCredits} 积分`);
    return { processedUsers, totalExpiredCredits };
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

    // 查找未过期的签到积分
    const expiringTransactions = await this.prisma.creditTransaction.findMany({
      where: {
        accountId: account.id,
        type: TransactionType.DAILY_REWARD,
        expiresAt: { not: null },
        isExpired: false,
        amount: { gt: 0 },
      },
      orderBy: { expiresAt: 'asc' },
    });

    const expiringDetails = expiringTransactions.map(t => ({
      amount: t.amount,
      expiresAt: t.expiresAt!,
    }));

    const totalExpiring = expiringDetails.reduce((sum, d) => sum + d.amount, 0);

    return { totalExpiring, expiringDetails, isPaidUser: false };
  }
}
