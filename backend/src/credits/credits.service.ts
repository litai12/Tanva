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
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
  ) {}

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
   */
  async getOrCreateAccount(userId: string) {
    // 先查一次，绝大多数场景直接命中，不走事务
    let account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (account) {
      return account;
    }

    try {
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

      return account;
    } catch (error) {
      // 并发场景下可能会触发 userId 唯一索引冲突，这里捕获后再查一次即可
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.creditAccount.findUnique({
          where: { userId },
        });
      }
      throw error;
    }
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
   * 普通用户的签到积分7天后过期，付费用户永不过期
   * 规则：连续签到7天额外赠送500积分，断签或满7天后重置到第1天
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

      // 第7天额外奖励500积分
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
