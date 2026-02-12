import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CREDIT_PRICING_CONFIG,
  DEFAULT_NEW_USER_CREDITS,
  DAILY_LOGIN_REWARD_CREDITS,
  ServiceType,
} from './credits.config';
import { TransactionType, ApiResponseStatus } from './dto/credits.dto';
import { ReferralService } from '../referral/referral.service';

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

@Injectable()
export class CreditsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
  ) {}

  /**
   * 获取或创建用户积分账户
   */
  async getOrCreateAccount(userId: string) {
    let account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      // 创建新账户并赠送初始积分
      account = await this.prisma.$transaction(async (tx) => {
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
      });
    }

    return account;
  }

  /**
   * 获取用户积分余额
   */
  async getBalance(userId: string): Promise<number> {
    const account = await this.getOrCreateAccount(userId);
    return account.balance;
  }

  /**
   * 获取用户积分账户详情
   */
  async getAccountDetails(userId: string) {
    const account = await this.getOrCreateAccount(userId);
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

    const pricing = CREDIT_PRICING_CONFIG[serviceType];
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }

    const creditsToDeduct = pricing.creditsPerCall;

    return await this.prisma.$transaction(async (tx) => {
      // 获取账户并锁定
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

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
          provider: pricing.provider,
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
          description: `使用 ${pricing.serviceName}`,
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

      if (apiUsage.responseStatus !== ApiResponseStatus.FAILED) {
        throw new BadRequestException('只能退还失败的API调用积分');
      }

      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const creditsToRefund = apiUsage.creditsUsed;
      const newBalance = account.balance + creditsToRefund;

      // 更新账户余额
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalSpent: account.totalSpent - creditsToRefund,
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

    return {
      transactions,
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
   */
  async claimDailyReward(userId: string): Promise<AddCreditsResult & { alreadyClaimed?: boolean }> {
    const { canClaim, lastClaimAt } = await this.canClaimDailyReward(userId);

    if (!canClaim) {
      return {
        success: false,
        newBalance: (await this.getBalance(userId)),
        transactionId: '',
        alreadyClaimed: true,
      };
    }

    return await this.prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { userId },
      });

      if (!account) {
        throw new NotFoundException('用户积分账户不存在');
      }

      const newBalance = account.balance + DAILY_LOGIN_REWARD_CREDITS;

      // 更新账户余额和最后领取时间
      await tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: newBalance,
          totalEarned: account.totalEarned + DAILY_LOGIN_REWARD_CREDITS,
          lastDailyRewardAt: new Date(),
        },
      });

      // 创建交易记录
      const transaction = await tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.DAILY_REWARD,
          amount: DAILY_LOGIN_REWARD_CREDITS,
          balanceBefore: account.balance,
          balanceAfter: newBalance,
          description: '每日登录奖励',
        },
      });

      return {
        success: true,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }
}
