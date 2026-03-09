import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// 邀请奖励配置
const REFERRAL_REWARD = 1000; // 邀请成功奖励积分
const REFERRAL_REWARD_LIMIT = 10; // 邀请奖励次数上限
const DAILY_CHECK_IN_REWARDS = [50, 50, 50, 50, 50, 50, 50]; // D1-D7 每日签到奖励
const WEEKLY_BONUS = 150; // 满7天额外奖励

@Injectable()
export class ReferralService {
  constructor(private prisma: PrismaService) {}

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
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invitee:${inviteeUserId}`}), 0)`;

    // 查找邀请码
    const inviteCode = await tx.invitationCode.findUnique({
      where: { code: normalizedCode },
    });

    if (!inviteCode) {
      throw new NotFoundException('邀请码不存在');
    }

    if (inviteCode.status !== 'active') {
      throw new BadRequestException('邀请码已失效');
    }

    // 不能使用自己的邀请码
    if (inviteCode.inviterUserId === inviteeUserId) {
      throw new BadRequestException('不能使用自己的邀请码');
    }

    // 检查是否已经使用过邀请码（任意状态都视为已使用）
    const existingRedemption = await tx.invitationRedemption.findFirst({
      where: { inviteeUserId },
    });

    if (existingRedemption) {
      throw new BadRequestException('您已使用过邀请码');
    }

    const effectiveMaxUses = Math.min(inviteCode.maxUses, REFERRAL_REWARD_LIMIT);

    // 原子化占用邀请码次数，避免并发绕过上限
    const updated = await tx.invitationCode.updateMany({
      where: {
        id: inviteCode.id,
        status: 'active',
        usedCount: { lt: effectiveMaxUses },
      },
      data: {
        usedCount: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw new BadRequestException('邀请码奖励次数已达上限');
    }

    // 创建邀请兑换记录
    const redemption = await tx.invitationRedemption.create({
      data: {
        codeId: inviteCode.id,
        inviteeUserId,
        inviterUserId: inviteCode.inviterUserId,
        rewardStatus: 'pending',
        rewardAmount: REFERRAL_REWARD,
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
    // 先查找用户是否已有邀请码
    let inviteCode = await this.prisma.invitationCode.findFirst({
      where: { inviterUserId: userId },
    });

    if (inviteCode && inviteCode.maxUses !== REFERRAL_REWARD_LIMIT) {
      inviteCode = await this.prisma.invitationCode.update({
        where: { id: inviteCode.id },
        data: { maxUses: REFERRAL_REWARD_LIMIT },
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
          maxUses: REFERRAL_REWARD_LIMIT,
          status: 'active',
        },
      });
    }

    return inviteCode;
  }

  /**
   * 获取用户的推广激励统计
   */
  async getReferralStats(userId: string) {
    // 获取邀请码
    const inviteCode = await this.getOrCreateInviteCode(userId);

    // 获取成功邀请数量
    const successfulInvites = await this.prisma.invitationRedemption.count({
      where: { inviterUserId: userId },
    });

    // 获取已发奖的邀请数量
    const rewardedInvites = await this.prisma.invitationRedemption.count({
      where: {
        inviterUserId: userId,
        rewardStatus: 'rewarded',
      },
    });

    // 计算累计收益
    const totalEarnings = rewardedInvites * REFERRAL_REWARD;

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
      take: 20,
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
    };
  }

  /**
   * 获取连续签到状态
   */
  async getCheckInStatus(userId: string) {
    const account = await this.prisma.creditAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      return {
        consecutiveDays: 0,
        lastCheckInDate: null,
        canCheckIn: true,
        todayReward: DAILY_CHECK_IN_REWARDS[0],
        weeklyBonus: WEEKLY_BONUS,
        rewards: DAILY_CHECK_IN_REWARDS,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastCheckIn = account.lastCheckInDate;
    let consecutiveDays = account.consecutiveDays || 0;
    let canCheckIn = true;

    if (lastCheckIn) {
      const lastCheckInDay = new Date(lastCheckIn);
      lastCheckInDay.setHours(0, 0, 0, 0);

      const diffDays = Math.floor((today.getTime() - lastCheckInDay.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        // 今天已签到
        canCheckIn = false;
      } else if (diffDays > 1) {
        // 断签，重置连续天数
        consecutiveDays = 0;
      }
    }

    // 计算今天可获得的奖励
    const dayIndex = consecutiveDays % 7;
    const todayReward = DAILY_CHECK_IN_REWARDS[dayIndex];

    return {
      consecutiveDays,
      lastCheckInDate: lastCheckIn,
      canCheckIn,
      todayReward,
      weeklyBonus: WEEKLY_BONUS,
      rewards: DAILY_CHECK_IN_REWARDS,
    };
  }

  /**
   * 执行签到
   */
  async checkIn(userId: string) {
    const status = await this.getCheckInStatus(userId);

    if (!status.canCheckIn) {
      throw new BadRequestException('今日已签到');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 计算新的连续天数
    let newConsecutiveDays = status.consecutiveDays + 1;

    // 计算奖励
    const dayIndex = status.consecutiveDays % 7;
    let reward = DAILY_CHECK_IN_REWARDS[dayIndex];
    let description = `连续签到第${newConsecutiveDays}天奖励`;

    // 如果是第7天，额外奖励
    if (newConsecutiveDays % 7 === 0) {
      reward += WEEKLY_BONUS;
      description = `连续签到满7天奖励（含${WEEKLY_BONUS}额外奖励）`;
    }

    // 更新账户和发放奖励
    const account = await this.prisma.creditAccount.upsert({
      where: { userId },
      create: {
        userId,
        balance: reward,
        totalEarned: reward,
        consecutiveDays: newConsecutiveDays,
        lastCheckInDate: today,
        lastDailyRewardAt: today,
      },
      update: {
        balance: { increment: reward },
        totalEarned: { increment: reward },
        consecutiveDays: newConsecutiveDays,
        lastCheckInDate: today,
        lastDailyRewardAt: today,
      },
    });

    // 创建交易记录
    await this.prisma.creditTransaction.create({
      data: {
        accountId: account.id,
        type: 'CHECK_IN',
        amount: reward,
        balanceBefore: account.balance - reward,
        balanceAfter: account.balance,
        description,
      },
    });

    return {
      success: true,
      consecutiveDays: newConsecutiveDays,
      reward,
      newBalance: account.balance,
      isWeeklyBonus: newConsecutiveDays % 7 === 0,
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

    return this.prisma.$transaction(async (tx) =>
      this.applyInviteCodeWithTx(tx, inviteeUserId, normalizedCode),
    );
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invitee:${inviteeUserId}`}), 0)`;

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
          balance: REFERRAL_REWARD,
          totalEarned: REFERRAL_REWARD,
        },
        update: {
          balance: { increment: REFERRAL_REWARD },
          totalEarned: { increment: REFERRAL_REWARD },
        },
      });

      // 创建交易记录
      await tx.creditTransaction.create({
        data: {
          accountId: inviterAccount.id,
          type: 'REFERRAL_REWARD',
          amount: REFERRAL_REWARD,
          balanceBefore: inviterAccount.balance - REFERRAL_REWARD,
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
        reward: REFERRAL_REWARD,
      };
    });
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

    if (inviteCode.status !== 'active') {
      return { valid: false, message: '邀请码已失效' };
    }

    const effectiveMaxUses = Math.min(inviteCode.maxUses, REFERRAL_REWARD_LIMIT);
    if (inviteCode.usedCount >= effectiveMaxUses) {
      return { valid: false, message: '邀请码奖励次数已达上限' };
    }

    return {
      valid: true,
      inviterName: inviteCode.inviter?.name || '用户',
      remainingUses: effectiveMaxUses - inviteCode.usedCount,
    };
  }
}
