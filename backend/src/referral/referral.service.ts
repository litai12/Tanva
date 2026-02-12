import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// 邀请奖励配置
const REFERRAL_REWARD = 1000; // 邀请成功奖励积分
const DAILY_CHECK_IN_REWARDS = [100, 100, 100, 100, 100, 100, 100]; // D1-D7 每日签到奖励
const WEEKLY_BONUS = 500; // 满7天额外奖励

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

  /**
   * 获取或创建用户的邀请码
   */
  async getOrCreateInviteCode(userId: string) {
    // 先查找用户是否已有邀请码
    let inviteCode = await this.prisma.invitationCode.findFirst({
      where: { inviterUserId: userId },
    });

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
          maxUses: 9999, // 无限使用
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
    // 查找邀请码
    const inviteCode = await this.prisma.invitationCode.findUnique({
      where: { code },
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

    // 检查是否已经使用过邀请码
    const existingRedemption = await this.prisma.invitationRedemption.findFirst({
      where: { inviteeUserId },
    });

    if (existingRedemption) {
      throw new BadRequestException('您已使用过邀请码');
    }

    // 创建邀请兑换记录
    const redemption = await this.prisma.invitationRedemption.create({
      data: {
        codeId: inviteCode.id,
        inviteeUserId,
        inviterUserId: inviteCode.inviterUserId,
        rewardStatus: 'pending',
        rewardAmount: REFERRAL_REWARD,
      },
    });

    // 更新邀请码使用次数
    await this.prisma.invitationCode.update({
      where: { id: inviteCode.id },
      data: { usedCount: { increment: 1 } },
    });

    // 更新被邀请用户的 invitedById
    await this.prisma.user.update({
      where: { id: inviteeUserId },
      data: { invitedById: inviteCode.inviterUserId },
    });

    return redemption;
  }

  /**
   * 核验并发放邀请奖励（当被邀请用户完成首图生成时调用）
   */
  async verifyAndRewardInviter(inviteeUserId: string) {
    // 查找待核验的邀请记录
    const redemption = await this.prisma.invitationRedemption.findFirst({
      where: {
        inviteeUserId,
        rewardStatus: 'pending',
      },
    });

    if (!redemption || !redemption.inviterUserId) {
      return null;
    }

    // 检查被邀请用户是否已完成首图生成
    const hasGeneratedImage = await this.prisma.apiUsageRecord.findFirst({
      where: {
        userId: inviteeUserId,
        responseStatus: 'success',
      },
    });

    if (!hasGeneratedImage) {
      return null;
    }

    // 发放奖励给邀请人
    const inviterAccount = await this.prisma.creditAccount.upsert({
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
    await this.prisma.creditTransaction.create({
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
    await this.prisma.invitationRedemption.update({
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
  }

  /**
   * 验证邀请码是否有效
   */
  async validateInviteCode(code: string) {
    const inviteCode = await this.prisma.invitationCode.findUnique({
      where: { code },
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

    return {
      valid: true,
      inviterName: inviteCode.inviter?.name || '用户',
    };
  }
}
