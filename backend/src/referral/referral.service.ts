import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';

// 邀请奖励配置
const REFERRAL_INVITER_REWARD = 500; // 邀请人奖励积分
const REFERRAL_INVITER_FIRST_RECHARGE_REWARD = 500; // 邀请好友首充额外奖励积分
const FREE_USER_REFERRAL_REWARD_LIMIT = 5; // 免费用户邀请奖励次数上限
const DAILY_REWARD_RESET_HOUR = 3;

@Injectable()
export class ReferralService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService: CreditsService,
  ) {}

  private getDailyRewardBusinessDayAnchor(date: Date): Date {
    const anchor = new Date(date);
    if (anchor.getHours() < DAILY_REWARD_RESET_HOUR) {
      anchor.setDate(anchor.getDate() - 1);
    }
    anchor.setHours(0, 0, 0, 0);
    return anchor;
  }

  private diffDailyRewardBusinessDays(current: Date, previous: Date): number {
    const currentAnchor = this.getDailyRewardBusinessDayAnchor(current);
    const previousAnchor = this.getDailyRewardBusinessDayAnchor(previous);
    const diffMs = currentAnchor.getTime() - previousAnchor.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private parseInviteLimitFromPlanMetadata(metadata: Prisma.JsonValue | null | undefined): number | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const rawValue = (metadata as Record<string, unknown>).inviteLimit;
    const parsed =
      typeof rawValue === 'number'
        ? Math.trunc(rawValue)
        : typeof rawValue === 'string' && rawValue.trim()
          ? Math.trunc(Number(rawValue))
          : NaN;

    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  private async resolveInviterRewardLimit(
    inviterUserId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const subscription = await tx.userMembershipSubscription.findFirst({
      where: {
        userId: inviterUserId,
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
      return FREE_USER_REFERRAL_REWARD_LIMIT;
    }

    const plan = await tx.membershipPlan.findUnique({
      where: { id: subscription.membershipPlanId },
      select: { metadata: true },
    });

    return (
      this.parseInviteLimitFromPlanMetadata(plan?.metadata) ?? FREE_USER_REFERRAL_REWARD_LIMIT
    );
  }

  private async syncInviteCodeMaxUses(
    tx: Prisma.TransactionClient | PrismaService,
    inviteCode: { id: string; maxUses: number },
    inviterUserId: string,
  ) {
    const expectedMaxUses = await this.resolveInviterRewardLimit(inviterUserId, tx);
    if (inviteCode.maxUses === expectedMaxUses) {
      return {
        ...inviteCode,
        maxUses: expectedMaxUses,
      };
    }

    const updated = await tx.invitationCode.update({
      where: { id: inviteCode.id },
      data: { maxUses: expectedMaxUses },
    });

    return updated;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async acquireInviteeTxLock(
    tx: Prisma.TransactionClient,
    inviteeUserId: string,
  ): Promise<void> {
    const lockKey = `invitee:${inviteeUserId}`;
    const maxAttempts = 40;
    const retryDelayMs = 50;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // ALLOW_RAW_NO_TENANT: 咨询锁，不查表数据
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockKey}), 0) AS locked
      `;

      if (row?.locked) return;
      if (attempt < maxAttempts) {
        await this.wait(retryDelayMs);
      }
    }

    throw new ConflictException('请求处理中，请稍后重试');
  }

  /**
   * 生成用户专属邀请码（格式：TANVAS-XXXX）
   */
  private generateInviteCode(userId: string): string {
    // 使用用户ID的后4位作为邀请码后缀
    const suffix = userId.slice(-4).toUpperCase();
    return `TANVAS-${suffix}`;
  }

  private normalizeInviteCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private async applyInviteCodeWithTx(
    tx: Prisma.TransactionClient,
    inviteeUserId: string,
    normalizedCode: string,
  ) {
    // 基于数据库事务锁，串行化同一被邀请人的并发兑换请求
    await this.acquireInviteeTxLock(tx, inviteeUserId);

    // 查找邀请码
    const inviteCode = await tx.invitationCode.findUnique({
      where: { code: normalizedCode },
    });

    if (!inviteCode) {
      throw new NotFoundException('邀请码不存在');
    }


    // 不能使用自己的邀请码
    if (inviteCode.inviterUserId === inviteeUserId) {
      throw new BadRequestException('不能使用自己的邀请码');
    }
    if (!inviteCode.inviterUserId) {
      throw new BadRequestException('邀请码缺少邀请人信息');
    }

    // 检查是否已经使用过邀请码（任意状态都视为已使用）
    const existingRedemption = await tx.invitationRedemption.findFirst({
      where: { inviteeUserId },
    });

    if (existingRedemption) {
      throw new BadRequestException('您已使用过邀请码');
    }

    const syncedInviteCode = await this.syncInviteCodeMaxUses(
      tx,
      inviteCode,
      inviteCode.inviterUserId,
    );
    const effectiveMaxUses = syncedInviteCode.maxUses;

    // 原子化占用可发奖次数；超过上限后仍允许使用邀请码，但不再发放邀请积分
    const rewardReservation = await tx.invitationCode.updateMany({
      where: {
        id: inviteCode.id,
        usedCount: { lt: effectiveMaxUses },
      },
      data: {
        usedCount: { increment: 1 },
      },
    });
    const rewardEligible = rewardReservation.count > 0;

    // 创建邀请兑换记录
    const redemption = await tx.invitationRedemption.create({
      data: {
        codeId: inviteCode.id,
        inviteeUserId,
        inviterUserId: inviteCode.inviterUserId,
        ...(rewardEligible
          ? {
              rewardStatus: 'pending',
              rewardAmount: REFERRAL_INVITER_REWARD,
            }
          : {
              rewardStatus: 'rewarded',
              rewardAmount: 0,
              rewardedAt: new Date(),
              metadata: {
                reason: 'reward_limit_reached',
                rewardLimit: effectiveMaxUses,
              },
            }),
      },
    });

    // 更新被邀请用户的 invitedById
    await tx.user.update({
      where: { id: inviteeUserId },
      data: { invitedById: inviteCode.inviterUserId },
    });

    return redemption;
  }

  /**
   * 获取或创建用户的邀请码
   */
  async getOrCreateInviteCode(userId: string) {
    const expectedMaxUses = await this.resolveInviterRewardLimit(userId);

    // 先查找用户是否已有邀请码
    let inviteCode = await this.prisma.invitationCode.findFirst({
      where: { inviterUserId: userId },
    });

    if (inviteCode && inviteCode.maxUses !== expectedMaxUses) {
      inviteCode = await this.prisma.invitationCode.update({
        where: { id: inviteCode.id },
        data: { maxUses: expectedMaxUses },
      });
    }

    if (!inviteCode) {
      // 创建新的邀请码
      const code = this.generateInviteCode(userId);

      // 检查是否已存在相同的code，如果存在则添加随机后缀
      const existingCode = await this.prisma.invitationCode.findUnique({
        where: { code },
      });

      const finalCode = existingCode
        ? `${code}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
        : code;

      inviteCode = await this.prisma.invitationCode.create({
        data: {
          code: finalCode,
          inviterUserId: userId,
          maxUses: expectedMaxUses,
          status: 'active',
        },
      });
    }

    return inviteCode;
  }

  /**
   * 获取用户的推广激励统计
   */
  async getReferralStats(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    const parsedPage = Math.trunc(options.page ?? 1);
    const parsedPageSize = Math.trunc(options.pageSize ?? 20);
    const requestedPage =
      Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize =
      Number.isFinite(parsedPageSize) && parsedPageSize > 0
        ? Math.min(100, parsedPageSize)
        : 20;

    // 获取邀请码
    const inviteCode = await this.getOrCreateInviteCode(userId);

    // 获取成功邀请数量
    const successfulInvites = await this.prisma.invitationRedemption.count({
      where: { inviterUserId: userId },
    });

    // 获取已发奖总额（允许存在 rewardAmount=0 的“超上限记录”）
    const rewardedSummary = await this.prisma.invitationRedemption.aggregate({
      where: {
        inviterUserId: userId,
        rewardStatus: 'rewarded',
      },
      _sum: {
        rewardAmount: true,
      },
    });

    // 邀请好友首充奖励次数
    const firstRechargeRewards = await this.prisma.creditTransaction.count({
      where: {
        type: 'REFERRAL_REWARD',
        description: '邀请好友首充奖励',
        account: { userId },
      },
    });

    // 计算累计收益
    const totalEarnings =
      (rewardedSummary._sum.rewardAmount ?? 0) +
      firstRechargeRewards * REFERRAL_INVITER_FIRST_RECHARGE_REWARD;

    const totalPages = Math.max(1, Math.ceil(successfulInvites / pageSize));
    const page = Math.min(requestedPage, totalPages);

    // 获取邀请记录列表
    const inviteRecords = await this.prisma.invitationRedemption.findMany({
      where: { inviterUserId: userId },
      include: {
        invitee: {
          select: {
            id: true,
            name: true,
            phone: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // 格式化邀请记录
    const formattedRecords = inviteRecords.map((record) => ({
      id: record.id,
      inviteeName: record.invitee.name || `User_${record.invitee.phone.slice(-4)}`,
      inviteePhone: record.invitee.phone,
      createdAt: record.createdAt,
      rewardStatus: record.rewardStatus,
      rewardAmount: record.rewardAmount,
      rewardedAt: record.rewardedAt,
    }));

    return {
      inviteCode: inviteCode.code,
      inviteLink: `tanvas.ai/invite?code=${inviteCode.code}`,
      successfulInvites,
      totalEarnings,
      inviteRecords: formattedRecords,
      pagination: {
        page,
        pageSize,
        total: successfulInvites,
        totalPages,
      },
    };
  }

  /**
   * 获取连续签到状态
   */
  async getCheckInStatus(userId: string) {
    const rewardStatus = await this.creditsService.canClaimDailyReward(userId);
    const account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      const todayReward = rewardStatus.todayRewardCredits;
      const weeklyBonus = Math.max(0, todayReward * (rewardStatus.rewardMultiplier - 1));
      return {
        consecutiveDays: 0,
        lastCheckInDate: null,
        canCheckIn: rewardStatus.canClaim,
        todayReward,
        weeklyBonus,
        rewards: [todayReward, todayReward, todayReward, todayReward, todayReward, todayReward, todayReward + weeklyBonus],
      };
    }

    const now = new Date();
    const lastCheckIn = account.lastCheckInDate;
    let consecutiveDays = account.consecutiveDays || 0;
    let canCheckIn = rewardStatus.canClaim;

    if (lastCheckIn) {
      const diffDays = this.diffDailyRewardBusinessDays(now, new Date(lastCheckIn));
      if (diffDays > 1) {
        consecutiveDays = 0;
      } else if (diffDays === 0) {
        canCheckIn = false;
      }
    }

    const todayReward = rewardStatus.todayRewardCredits;
    const weeklyBonus = Math.max(0, todayReward * (rewardStatus.rewardMultiplier - 1));
    const rewards = [todayReward, todayReward, todayReward, todayReward, todayReward, todayReward, todayReward + weeklyBonus];

    return {
      consecutiveDays,
      lastCheckInDate: lastCheckIn,
      canCheckIn,
      todayReward,
      weeklyBonus,
      rewards,
    };
  }

  /**
   * 执行签到
   */
  async checkIn(userId: string) {
    const result = await this.creditsService.claimDailyReward(userId);
    if (result.alreadyClaimed) {
      throw new BadRequestException('今日已签到');
    }
    if (!result.success) {
      throw new BadRequestException('签到失败，请稍后重试');
    }
    const reward = (result.baseCredits ?? 0) + (result.bonusCredits ?? 0);

    return {
      success: true,
      consecutiveDays: result.consecutiveDays ?? 0,
      reward,
      newBalance: result.newBalance,
      isWeeklyBonus: (result.bonusCredits ?? 0) > 0,
    };
  }

  /**
   * 使用邀请码注册
   */
  async useInviteCode(inviteeUserId: string, code: string) {
    const normalizedCode = this.normalizeInviteCode(code);
    if (!normalizedCode) {
      throw new BadRequestException('邀请码不能为空');
    }

    const redemption = await this.prisma.$transaction(async (tx) =>
      this.applyInviteCodeWithTx(tx, inviteeUserId, normalizedCode),
    );

    // 绑定成功后立即触发初始积分发放（仅填写邀请码的用户可获得），失败不影响绑定结果
    try {
      await this.creditsService.getOrCreateAccount(inviteeUserId);
    } catch (e) {
      console.warn(
        `[Referral] 邀请码绑定后发放初始积分失败: ${e instanceof Error ? e.message : e}`,
      );
    }

    return redemption;
  }

  /**
   * 在外部事务中使用邀请码（用于注册事务内绑定）
   */
  async useInviteCodeInTransaction(
    tx: Prisma.TransactionClient,
    inviteeUserId: string,
    code: string,
  ) {
    const normalizedCode = this.normalizeInviteCode(code);
    if (!normalizedCode) {
      throw new BadRequestException('邀请码不能为空');
    }
    return this.applyInviteCodeWithTx(tx, inviteeUserId, normalizedCode);
  }

  /**
   * 核验并发放邀请奖励（当被邀请用户完成首图生成时调用）
   */
  async verifyAndRewardInviter(
    inviteeUserId: string,
    options?: { skipApiUsageCheck?: boolean },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 串行化同一被邀请人的奖励核验，避免重复发奖
      await this.acquireInviteeTxLock(tx, inviteeUserId);

      // 若该被邀请人已经发过奖，不再重复发放
      const alreadyRewarded = await tx.invitationRedemption.findFirst({
        where: {
          inviteeUserId,
          rewardStatus: 'rewarded',
        },
        select: { id: true },
      });

      if (alreadyRewarded) {
        return null;
      }

      // 查找待核验的邀请记录
      const redemption = await tx.invitationRedemption.findFirst({
        where: {
          inviteeUserId,
          rewardStatus: 'pending',
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!redemption || !redemption.inviterUserId) {
        return null;
      }

      if (!options?.skipApiUsageCheck) {
        // 检查被邀请用户是否已完成首次成功创作
        const hasGeneratedImage = await tx.apiUsageRecord.findFirst({
          where: {
            userId: inviteeUserId,
            responseStatus: 'success',
          },
        });

        if (!hasGeneratedImage) {
          return null;
        }
      }

      // 发放奖励给邀请人
      const inviterAccount = await tx.creditAccount.upsert({
        where: { userId: redemption.inviterUserId },
        create: {
          userId: redemption.inviterUserId,
          balance: REFERRAL_INVITER_REWARD,
          totalEarned: REFERRAL_INVITER_REWARD,
        },
        update: {
          balance: { increment: REFERRAL_INVITER_REWARD },
          totalEarned: { increment: REFERRAL_INVITER_REWARD },
        },
      });

      // 为邀请人创建交易记录
      await tx.creditTransaction.create({
        data: {
          accountId: inviterAccount.id,
          type: 'REFERRAL_REWARD',
          amount: REFERRAL_INVITER_REWARD,
          balanceBefore: inviterAccount.balance - REFERRAL_INVITER_REWARD,
          balanceAfter: inviterAccount.balance,
          description: '邀请好友奖励',
          metadata: { inviteeUserId },
        },
      });

      // 更新邀请记录状态
      await tx.invitationRedemption.update({
        where: { id: redemption.id },
        data: {
          rewardStatus: 'rewarded',
          rewardedAt: new Date(),
        },
      });

      return {
        inviterId: redemption.inviterUserId,
        inviterReward: REFERRAL_INVITER_REWARD,
      };
    });
  }

  /**
   * 被邀请用户首次充值后，额外奖励邀请人
   */
  async rewardInviterForInviteeFirstRechargeInTransaction(
    tx: Prisma.TransactionClient,
    inviteeUserId: string,
  ) {
    await this.acquireInviteeTxLock(tx, inviteeUserId);

    const invitee = await tx.user.findUnique({
      where: { id: inviteeUserId },
      select: { invitedById: true },
    });
    if (!invitee?.invitedById) {
      return null;
    }

    const redemption = await tx.invitationRedemption.findFirst({
      where: {
        inviteeUserId,
        inviterUserId: invitee.invitedById,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        rewardAmount: true,
      },
    });

    // 超过邀请奖励上限的记录（rewardAmount=0）不再发放首充奖励
    if (!redemption || redemption.rewardAmount <= 0) {
      return null;
    }

    const alreadyRewarded = await tx.creditTransaction.findFirst({
      where: {
        type: 'REFERRAL_REWARD',
        description: '邀请好友首充奖励',
        account: { userId: invitee.invitedById },
        metadata: {
          path: ['inviteeUserId'],
          equals: inviteeUserId,
        },
      },
      select: { id: true },
    });
    if (alreadyRewarded) {
      return null;
    }

    const inviterAccount = await tx.creditAccount.upsert({
      where: { userId: invitee.invitedById },
      create: {
        userId: invitee.invitedById,
        balance: REFERRAL_INVITER_FIRST_RECHARGE_REWARD,
        totalEarned: REFERRAL_INVITER_FIRST_RECHARGE_REWARD,
      },
      update: {
        balance: { increment: REFERRAL_INVITER_FIRST_RECHARGE_REWARD },
        totalEarned: { increment: REFERRAL_INVITER_FIRST_RECHARGE_REWARD },
      },
    });

    await tx.creditTransaction.create({
      data: {
        accountId: inviterAccount.id,
        type: 'REFERRAL_REWARD',
        amount: REFERRAL_INVITER_FIRST_RECHARGE_REWARD,
        balanceBefore: inviterAccount.balance - REFERRAL_INVITER_FIRST_RECHARGE_REWARD,
        balanceAfter: inviterAccount.balance,
        description: '邀请好友首充奖励',
        metadata: { inviteeUserId, rewardType: 'invitee_first_recharge' },
      },
    });

    return {
      inviterId: invitee.invitedById,
      reward: REFERRAL_INVITER_FIRST_RECHARGE_REWARD,
    };
  }

  /**
   * 验证邀请码是否有效
   */
  async validateInviteCode(code: string) {
    const normalizedCode = this.normalizeInviteCode(code);
    if (!normalizedCode) {
      return { valid: false, message: '邀请码不能为空' };
    }

    const inviteCode = await this.prisma.invitationCode.findUnique({
      where: { code: normalizedCode },
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!inviteCode) {
      return { valid: false, message: '邀请码不存在' };
    }
    if (!inviteCode.inviter?.id) {
      return { valid: false, message: '邀请码缺少邀请人信息' };
    }

    const syncedInviteCode = await this.syncInviteCodeMaxUses(
      this.prisma,
      inviteCode,
      inviteCode.inviter.id,
    );
    const effectiveMaxUses = syncedInviteCode.maxUses;

    return {
      valid: true,
      inviterName: inviteCode.inviter?.name || '用户',
      remainingUses: Math.max(0, effectiveMaxUses - inviteCode.usedCount),
    };
  }
}
