import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildMembershipCreditLotData } from '../credits/credit-lot-grants';
import { TransactionType } from '../credits/dto/credits.dto';
import { findCreditAccountForUpdate } from '../credits/credit-account-lock.util';
import { BusinessPolicyService } from '../business-policy/business-policy.service';
import type {
  ActivatePaidMembershipOrderParams,
  ActivatePaidMembershipOrderResult,
  MembershipBillingCycle,
  MembershipNextChangeView,
  MembershipPlanSnapshot,
} from './membership.types';

const FREE_USER_LEGACY_QUOTA_GRANTED_BY = 'free_user_monthly_quota';
const FREE_USER_STARTER_QUOTA_GRANTED_BY = 'free_user_starter_quota';

type MembershipCreditBalances = {
  freeCredits: number;
  rechargeCredits: number;
  subscriptionCredits: number;
  giftCredits: number;
  fixedCredits: number;
  totalCredits: number;
};

@Injectable()
export class MembershipService {
  private static readonly FREE_TIER_BENEFITS_SETTING_KEY = 'membership_free_tier_benefits';

  constructor(
    private readonly prisma: PrismaService,
    private readonly businessPolicyService: BusinessPolicyService,
  ) {}

  private isMissingTableError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2021' || error.code === 'P2022')
    );
  }

  private isNullConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2011' || error.code === 'P2012')
    );
  }

  private async withMissingMembershipTablesFallback<T>(
    operation: () => Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return fallback();
      }
      throw error;
    }
  }

  async listActivePlans() {
    return this.withMissingMembershipTablesFallback(
      () =>
        this.prisma.membershipPlan.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
      () => [],
    );
  }

  async listAllPlansForAdmin() {
    return this.withMissingMembershipTablesFallback(
      () =>
        this.prisma.membershipPlan.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
      () => [],
    );
  }

  async createMembershipPlan(input: {
    code: string;
    name: string;
    billingCycle: string;
    price: number;
    monthlyQuotaCredits?: number;
    signupBonusCredits?: number;
    dailyGiftCredits?: number;
    isActive?: boolean;
    sortOrder?: number;
    metadata?: Prisma.InputJsonValue;
  }) {
    const code = input.code.trim();
    const name = input.name.trim();
    if (!code) {
      throw new BadRequestException('套餐编码不能为空');
    }
    if (!name) {
      throw new BadRequestException('套餐名称不能为空');
    }

    try {
      return await this.prisma.membershipPlan.create({
        data: {
          code,
          name,
          billingCycle: this.normalizeBillingCycle(input.billingCycle),
          price: new Prisma.Decimal(input.price),
          monthlyQuotaCredits: input.monthlyQuotaCredits ?? 0,
          signupBonusCredits: input.signupBonusCredits ?? 0,
          dailyGiftCredits: this.normalizeDailyGiftCreditsForPlanCode(code, input.dailyGiftCredits ?? 0),
          isActive: input.isActive ?? true,
          sortOrder: input.sortOrder ?? 0,
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        },
      });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        throw new BadRequestException('会员表尚未初始化，请先执行数据库迁移');
      }
      throw error;
    }
  }

  async updateMembershipPlan(
    id: string,
    input: {
      code?: string;
      name?: string;
      billingCycle?: string;
      price?: number;
      monthlyQuotaCredits?: number;
      signupBonusCredits?: number;
      dailyGiftCredits?: number;
      isActive?: boolean;
      sortOrder?: number;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    let existing;
    try {
      existing = await this.prisma.membershipPlan.findUnique({
        where: { id },
      });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        throw new BadRequestException('会员表尚未初始化，请先执行数据库迁移');
      }
      throw error;
    }
    if (!existing) {
      throw new NotFoundException('会员套餐不存在');
    }

    const nextCode = input.code !== undefined ? input.code.trim() : existing.code;
    const nextDailyGiftCredits =
      input.dailyGiftCredits !== undefined
        ? this.normalizeDailyGiftCreditsForPlanCode(nextCode, input.dailyGiftCredits)
        : undefined;

    try {
      return await this.prisma.membershipPlan.update({
        where: { id },
        data: {
          ...(input.code !== undefined ? { code: input.code.trim() } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.billingCycle !== undefined
            ? { billingCycle: this.normalizeBillingCycle(input.billingCycle) }
            : {}),
          ...(input.price !== undefined ? { price: new Prisma.Decimal(input.price) } : {}),
          ...(input.monthlyQuotaCredits !== undefined
            ? { monthlyQuotaCredits: input.monthlyQuotaCredits }
            : {}),
          ...(input.signupBonusCredits !== undefined
            ? { signupBonusCredits: input.signupBonusCredits }
            : {}),
          ...(nextDailyGiftCredits !== undefined
            ? { dailyGiftCredits: nextDailyGiftCredits }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        },
      });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        throw new BadRequestException('会员表尚未初始化，请先执行数据库迁移');
      }
      throw error;
    }
  }

  async getMembershipPlansPage() {
    const plans = await this.listActivePlans();
    return {
      hero: {
        title: '从免费体验到专业创作，找到最适合你的方案',
        subtitle: '免费用户可体验基础生图与视频能力，升级 VIP 后获得更多积分和高级权益',
      },
      plans: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        billingCycle: plan.billingCycle,
        price: Number(plan.price),
        monthlyQuotaCredits: plan.monthlyQuotaCredits,
        signupBonusCredits: plan.signupBonusCredits,
        totalMonthlyCredits: plan.monthlyQuotaCredits + plan.signupBonusCredits,
        dailyGiftCredits: this.normalizeDailyGiftCreditsForPlanCode(plan.code, plan.dailyGiftCredits),
        metadata: plan.metadata,
        ctaText: `升级 ${plan.name}`,
        isRecommended: plan.sortOrder === 10,
      })),
      comparisonTable: [],
      creditRules: [],
      footnotes: [],
    };
  }

  async getCurrentMembership(userId: string) {
    const [subscription, nextChange, balances] = await Promise.all([
      this.withMissingMembershipTablesFallback(
        () =>
          this.prisma.userMembershipSubscription.findFirst({
            where: {
              userId,
              status: 'active',
            },
            orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
          }),
        () => null,
      ),
      this.getNextChange(userId),
      this.getCreditBalances(userId),
    ]);

    if (!subscription) {
      return {
        subscription: null,
        plan: null,
        nextChange,
        entitlement: await this.getMembershipEntitlement(userId),
        balances,
      };
    }

    const plan = await this.withMissingMembershipTablesFallback(
      () =>
        this.prisma.membershipPlan.findUnique({
          where: { id: subscription.membershipPlanId },
        }),
      () => null,
    );

    return {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        periodType: subscription.periodType,
        currentPeriodStartAt: subscription.currentPeriodStartAt,
        currentPeriodEndAt: subscription.currentPeriodEndAt,
        activatedAt: subscription.activatedAt,
        renewalCount: subscription.renewalCount,
        lastOrderId: subscription.lastOrderId,
      },
      plan: plan
        ? {
            id: plan.id,
            code: plan.code,
            name: plan.name,
            billingCycle: plan.billingCycle,
            price: Number(plan.price),
            monthlyQuotaCredits: plan.monthlyQuotaCredits,
            signupBonusCredits: plan.signupBonusCredits,
            dailyGiftCredits: this.normalizeDailyGiftCreditsForPlanCode(plan.code, plan.dailyGiftCredits),
            metadata: plan.metadata,
          }
        : null,
      nextChange,
      entitlement: await this.getMembershipEntitlement(userId),
      balances,
    };
  }

  async getMembershipEntitlement(userId: string) {
    const [snapshot, activeSubscriptionCount] = await Promise.all([
      this.withMissingMembershipTablesFallback(
        () =>
          this.prisma.membershipEntitlementSnapshot.findUnique({
            where: { userId },
          }),
        () => null,
      ),
      this.withMissingMembershipTablesFallback(
        () =>
          this.prisma.userMembershipSubscription.count({
            where: {
              userId,
              status: 'active',
            },
          }),
        () => 0,
      ),
    ]);

    if (!snapshot) {
      return {
        currentPlanCode: 'free',
        membershipStatus: 'inactive',
        currentPeriodStartAt: null,
        currentPeriodEndAt: null,
        pauseGiftDecay: false,
        hasActiveSubscription: activeSubscriptionCount > 0,
      };
    }

    return {
      currentPlanCode: snapshot.currentPlanCode,
      membershipStatus: snapshot.membershipStatus,
      currentPeriodStartAt: snapshot.currentPeriodStartAt,
      currentPeriodEndAt: snapshot.currentPeriodEndAt,
      pauseGiftDecay: snapshot.pauseGiftDecay,
      hasActiveSubscription: activeSubscriptionCount > 0,
    };
  }

  async getMembershipMe(userId: string) {
    const [current, entitlement] = await Promise.all([
      this.getCurrentMembership(userId),
      this.getMembershipEntitlement(userId),
    ]);
    const balances = current.balances;
    const freeTierBenefits = await this.getFreeTierBenefitsSetting();
    const hasActivePlan = Boolean(current.plan);

    return {
      planCode: entitlement.currentPlanCode,
      membershipStatus: entitlement.membershipStatus,
      currentPeriodStartAt: entitlement.currentPeriodStartAt,
      currentPeriodEndAt: entitlement.currentPeriodEndAt,
      benefits: {
        pauseGiftDecay: entitlement.pauseGiftDecay,
      },
      balances: {
        freeCredits: balances.freeCredits,
        rechargeCredits: balances.rechargeCredits,
        subscriptionCredits: balances.subscriptionCredits,
        giftCredits: balances.giftCredits,
        fixedCredits: balances.fixedCredits,
        totalCredits: balances.totalCredits,
      },
      quotas: {
        inviteLimit: hasActivePlan
          ? this.readInviteLimitFromPlanMetadata(current.plan?.metadata)
          : this.readIntSettingValue(
              freeTierBenefits?.inviteLimit,
              null,
            ),
        imageDailyLimit: null,
        videoDailyLimit: null,
      },
      nextChange: current.nextChange,
      current,
    };
  }

  private async getCreditBalances(userId: string): Promise<MembershipCreditBalances> {
    const [account, activeLots] = await Promise.all([
      this.prisma.creditAccount.findUnique({
        where: { userId },
        select: { balance: true },
      }),
      this.prisma.creditLot.findMany({
        where: {
          account: { userId },
          status: 'active',
          remainingAmount: { gt: 0 },
        },
        select: {
          sourceType: true,
          validityType: true,
          remainingAmount: true,
          metadata: true,
        },
      }),
    ]);

    const balances = activeLots.reduce(
      (acc, lot) => {
        if (this.isFreeCreditLot(lot)) {
          acc.freeCredits += lot.remainingAmount;
          return acc;
        }

        if (lot.validityType === 'membership_bound' || lot.sourceType === 'subscription') {
          acc.subscriptionCredits += lot.remainingAmount;
          return acc;
        }

        if (lot.sourceType === 'recharge') {
          acc.rechargeCredits += lot.remainingAmount;
          acc.fixedCredits += lot.remainingAmount;
          return acc;
        }

        if (lot.sourceType === 'gift') {
          acc.giftCredits += lot.remainingAmount;
          return acc;
        }

        acc.fixedCredits += lot.remainingAmount;
        return acc;
      },
      {
        freeCredits: 0,
        rechargeCredits: 0,
        subscriptionCredits: 0,
        giftCredits: 0,
        fixedCredits: 0,
        totalCredits: account?.balance ?? 0,
      },
    );

    balances.totalCredits = account?.balance ?? 0;
    return balances;
  }

  private isFreeCreditLot(lot: {
    sourceType: string;
    validityType: string;
    metadata?: Prisma.JsonValue | null;
  }): boolean {
    if (lot.sourceType !== 'subscription' || lot.validityType !== 'fixed_window') {
      return false;
    }
    const metadata = this.asJsonObject(lot.metadata);
    const grantedBy = typeof metadata?.grantedBy === 'string' ? metadata.grantedBy : '';
    const grantType = typeof metadata?.grantType === 'string' ? metadata.grantType : '';
    return (
      grantedBy === FREE_USER_LEGACY_QUOTA_GRANTED_BY ||
      grantedBy === FREE_USER_STARTER_QUOTA_GRANTED_BY ||
      grantType === 'free_user_starter_quota'
    );
  }

  private asJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private readInviteLimitFromPlanMetadata(metadata: Prisma.JsonValue | null | undefined): number | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const rawValue = (metadata as Record<string, unknown>).inviteLimit;
    const inviteLimit =
      typeof rawValue === 'number'
        ? Math.trunc(rawValue)
        : typeof rawValue === 'string' && rawValue.trim()
          ? Math.trunc(Number(rawValue))
          : NaN;

    if (!Number.isFinite(inviteLimit) || inviteLimit < 0) {
      return null;
    }

    return inviteLimit;
  }

  private async getFreeTierBenefitsSetting(): Promise<Record<string, unknown> | null> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MembershipService.FREE_TIER_BENEFITS_SETTING_KEY },
      select: { value: true },
    });
    if (!setting?.value) {
      return null;
    }

    try {
      const parsed = JSON.parse(setting.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }

    return null;
  }

  private readIntSettingValue(value: unknown, fallback: number | null): number | null {
    const parsed =
      typeof value === 'number'
        ? Math.trunc(value)
        : typeof value === 'string' && value.trim()
          ? Math.trunc(Number(value))
          : NaN;
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return parsed;
  }

  async getNextChange(userId: string): Promise<MembershipNextChangeView | null> {
    const change = await this.withMissingMembershipTablesFallback(
      () =>
        this.prisma.membershipSubscriptionChange.findFirst({
          where: {
            userId,
            status: 'scheduled',
          },
          orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }],
        }),
      () => null,
    );
    if (!change) {
      return null;
    }

    const plan = await this.withMissingMembershipTablesFallback(
      () =>
        this.prisma.membershipPlan.findUnique({
          where: { id: change.targetPlanId },
        }),
      () => null,
    );

    return {
      id: change.id,
      targetPlanId: change.targetPlanId,
      targetPlanCode: change.targetPlanCode,
      targetPlanName: plan?.name ?? change.targetPlanCode,
      targetBillingCycle: this.normalizeBillingCycle(change.targetBillingCycle),
      changeType: change.changeType,
      effectiveMode: change.effectiveMode,
      status: change.status,
      reason: change.reason ?? null,
      effectiveAt: change.effectiveAt,
      currentPeriodEndAt: change.currentPeriodEndAt ?? null,
      createdAt: change.createdAt,
    };
  }

  async getAdminMembershipState(userId: string) {
    const [current, me, nextChange] = await Promise.all([
      this.getCurrentMembership(userId),
      this.getMembershipMe(userId),
      this.getNextChange(userId),
    ]);

    return {
      userId,
      current,
      nextChange,
      balances: me.balances,
      benefits: me.benefits,
    };
  }

  async getUserTransitionPreview(userId: string, planCode: string) {
    const targetPlan = await this.withMissingMembershipTablesFallback(
      () =>
        this.prisma.membershipPlan.findFirst({
          where: { code: planCode, isActive: true },
        }),
      () => null,
    );
    if (!targetPlan) {
      throw new NotFoundException('目标套餐不存在');
    }

    const current = await this.withMissingMembershipTablesFallback(
      () =>
        this.prisma.userMembershipSubscription.findFirst({
          where: { userId, status: 'active' },
          orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
        }),
      () => null,
    );

    if (!current) {
      return {
        actionType: 'subscribe',
        effectiveMode: 'immediate',
        payableAmount: Number(targetPlan.price),
        immediateCreditDelta: targetPlan.monthlyQuotaCredits + targetPlan.signupBonusCredits,
        cycleSwitch: false,
        remainingRatio: 1,
        targetPlan: {
          id: targetPlan.id,
          code: targetPlan.code,
          name: targetPlan.name,
          billingCycle: this.normalizeBillingCycle(targetPlan.billingCycle),
          price: Number(targetPlan.price),
        },
        currentPlan: null,
      };
    }

    const currentPlan = await this.withMissingMembershipTablesFallback(
      () =>
        this.prisma.membershipPlan.findUnique({
          where: { id: current.membershipPlanId },
        }),
      () => null,
    );
    if (!currentPlan) {
      throw new NotFoundException('当前套餐不存在');
    }

    if (currentPlan.id === targetPlan.id) {
      return {
        actionType: 'renew',
        effectiveMode: 'immediate',
        payableAmount: Number(targetPlan.price),
        immediateCreditDelta: targetPlan.monthlyQuotaCredits + targetPlan.signupBonusCredits,
        cycleSwitch: false,
        remainingRatio: 1,
        targetPlan: {
          id: targetPlan.id,
          code: targetPlan.code,
          name: targetPlan.name,
          billingCycle: this.normalizeBillingCycle(targetPlan.billingCycle),
          price: Number(targetPlan.price),
        },
        currentPlan: {
          id: currentPlan.id,
          code: currentPlan.code,
          name: currentPlan.name,
          billingCycle: this.normalizeBillingCycle(currentPlan.billingCycle),
          price: Number(currentPlan.price),
        },
      };
    }

    const comparison = this.comparePlanRank(currentPlan, targetPlan);
    const remainingRatio = this.computeRemainingRatio(
      current.currentPeriodStartAt,
      current.currentPeriodEndAt,
    );
    const currentCycle = this.normalizeBillingCycle(currentPlan.billingCycle);
    const targetCycle = this.normalizeBillingCycle(targetPlan.billingCycle);

    if (comparison < 0 && currentCycle === 'yearly' && targetCycle === 'monthly') {
      // 年卡换月卡（即便目标档位更高）一律下周期生效：
      // 立即生效会把一年周期塌缩成 30 天，用户已付的年费时间价值直接蒸发。
      return {
        actionType: 'downgrade' as const,
        effectiveMode: 'next_cycle',
        payableAmount: 0,
        immediateCreditDelta: 0,
        cycleSwitch: false,
        remainingRatio,
        targetPlan: {
          id: targetPlan.id,
          code: targetPlan.code,
          name: targetPlan.name,
          billingCycle: targetCycle,
          price: Number(targetPlan.price),
        },
        currentPlan: {
          id: currentPlan.id,
          code: currentPlan.code,
          name: currentPlan.name,
          billingCycle: currentCycle,
          price: Number(currentPlan.price),
        },
        nextEffectiveAt: current.currentPeriodEndAt,
      };
    }

    if (comparison < 0 && currentCycle !== targetCycle) {
      // 月卡中途换年卡：重开完整年周期（等价于"退掉剩余月卡时间价值，买一张全新年卡"）。
      // 价格 = 年卡全价 − 当前套餐未用时间价值；积分发全量（额度+赠送）；
      // 周期自支付时刻重算（激活侧按 cycleSwitch 标记处理）。
      // 旧月卡积分保留，仍在原到期日过期（由 expireOverdueMembershipBoundLots 每日清扫兜底）。
      const unusedValue = Number(currentPlan.price) * remainingRatio;
      const payableAmount = this.roundMoney(
        Math.max(0.01, Number(targetPlan.price) - unusedValue),
      );
      return {
        actionType: 'upgrade',
        effectiveMode: 'immediate',
        payableAmount,
        immediateCreditDelta: targetPlan.monthlyQuotaCredits + targetPlan.signupBonusCredits,
        cycleSwitch: true,
        remainingRatio,
        targetPlan: {
          id: targetPlan.id,
          code: targetPlan.code,
          name: targetPlan.name,
          billingCycle: targetCycle,
          price: Number(targetPlan.price),
        },
        currentPlan: {
          id: currentPlan.id,
          code: currentPlan.code,
          name: currentPlan.name,
          billingCycle: currentCycle,
          price: Number(currentPlan.price),
        },
      };
    }

    if (comparison < 0) {
      const amountDiff = Math.max(0, Number(targetPlan.price) - Number(currentPlan.price));
      const payableAmount = this.roundMoney(Math.max(0.01, amountDiff * remainingRatio));
      const immediateCreditDelta = Math.max(
        0,
        Math.round((targetPlan.monthlyQuotaCredits - currentPlan.monthlyQuotaCredits) * remainingRatio),
      );
      return {
        actionType: 'upgrade',
        effectiveMode: 'immediate',
        payableAmount,
        immediateCreditDelta,
        cycleSwitch: false,
        remainingRatio,
        targetPlan: {
          id: targetPlan.id,
          code: targetPlan.code,
          name: targetPlan.name,
          billingCycle: this.normalizeBillingCycle(targetPlan.billingCycle),
          price: Number(targetPlan.price),
        },
        currentPlan: {
          id: currentPlan.id,
          code: currentPlan.code,
          name: currentPlan.name,
          billingCycle: this.normalizeBillingCycle(currentPlan.billingCycle),
          price: Number(currentPlan.price),
        },
      };
    }

    return {
      actionType: 'downgrade',
      effectiveMode: 'next_cycle',
      payableAmount: 0,
      immediateCreditDelta: 0,
      cycleSwitch: false,
      remainingRatio,
      targetPlan: {
        id: targetPlan.id,
        code: targetPlan.code,
        name: targetPlan.name,
        billingCycle: this.normalizeBillingCycle(targetPlan.billingCycle),
        price: Number(targetPlan.price),
      },
      currentPlan: {
        id: currentPlan.id,
        code: currentPlan.code,
        name: currentPlan.name,
        billingCycle: this.normalizeBillingCycle(currentPlan.billingCycle),
        price: Number(currentPlan.price),
      },
      nextEffectiveAt: current.currentPeriodEndAt,
    };
  }

  async scheduleUserDowngrade(userId: string, planCode: string) {
    const preview = await this.getUserTransitionPreview(userId, planCode);
    if (preview.actionType !== 'downgrade') {
      throw new BadRequestException('仅降级套餐可走下周期生效');
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.userMembershipSubscription.findFirst({
        where: { userId, status: 'active' },
        orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (!current) {
        throw new NotFoundException('当前用户没有生效中的订阅');
      }

      const targetPlan = await tx.membershipPlan.findFirst({
        where: { code: planCode, isActive: true },
      });
      if (!targetPlan) {
        throw new NotFoundException('目标套餐不存在');
      }

      await tx.membershipSubscriptionChange.updateMany({
        where: { userId, status: 'scheduled' },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          reason: 'replaced:user_downgrade',
          requestedBy: userId,
        },
      });

      const change = await tx.membershipSubscriptionChange.create({
        data: {
          userId,
          currentSubscriptionId: current.id,
          targetPlanId: targetPlan.id,
          targetPlanCode: targetPlan.code,
          targetBillingCycle: targetPlan.billingCycle,
          changeType: 'downgrade',
          effectiveMode: 'next_cycle',
          status: 'scheduled',
          reason: 'user_downgrade',
          requestedBy: userId,
          currentPeriodEndAt: current.currentPeriodEndAt,
          effectiveAt: current.currentPeriodEndAt,
          metadata: {
            source: 'user',
          },
        },
      });

      return {
        success: true,
        nextChangeId: change.id,
        effectiveAt: change.effectiveAt,
      };
    });
  }

  async adminExpireMembershipNow(userId: string, reason: string, requestedBy: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const activeSubscriptions = await tx.userMembershipSubscription.findMany({
        where: { userId, status: 'active' },
        orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (activeSubscriptions.length === 0) {
        throw new NotFoundException('当前用户没有生效中的订阅');
      }

      await tx.userMembershipSubscription.updateMany({
        where: { userId, status: 'active' },
        data: {
          status: 'expired',
          expiredAt: now,
          currentPeriodEndAt: now,
        },
      });

      await tx.membershipSubscriptionChange.updateMany({
        where: { userId, status: 'scheduled' },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          reason,
          requestedBy,
        },
      });

      let expiredLots = 0;
      let expiredCredits = 0;

      for (const subscription of activeSubscriptions) {
        const result = await this.expireSubscriptionLots(tx, subscription, now, reason);
        expiredLots += result.expiredLots;
        expiredCredits += result.expiredCredits;
      }

      await this.upsertInactiveEntitlementSnapshot(tx, userId, now);

      return {
        success: true,
        expiredSubscriptions: activeSubscriptions.length,
        expiredLots,
        expiredCredits,
        expiredAt: now,
      };
    });
  }

  private async upsertInactiveEntitlementSnapshot(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ) {
    const payload = {
      currentPlanCode: 'free',
      membershipStatus: 'inactive',
      currentPeriodStartAt: null,
      currentPeriodEndAt: null,
      pauseGiftDecay: false,
    };

    try {
      await tx.membershipEntitlementSnapshot.upsert({
        where: { userId },
        create: {
          userId,
          ...payload,
        },
        update: payload,
      });
    } catch (error) {
      if (!this.isNullConstraintError(error)) {
        throw error;
      }

      // Some environments may still have old non-null snapshot columns.
      await tx.membershipEntitlementSnapshot.upsert({
        where: { userId },
        create: {
          userId,
          currentPlanCode: 'free',
          membershipStatus: 'inactive',
          currentPeriodStartAt: now,
          currentPeriodEndAt: now,
          pauseGiftDecay: false,
        },
        update: {
          currentPlanCode: 'free',
          membershipStatus: 'inactive',
          currentPeriodStartAt: now,
          currentPeriodEndAt: now,
          pauseGiftDecay: false,
        },
      });
    }
  }

  private async expireSubscriptionLots(
    tx: Prisma.TransactionClient,
    subscription: {
      id: string;
      userId: string;
      membershipPlanId: string;
    },
    now: Date,
    reason: string,
  ) {
    const lots = await tx.creditLot.findMany({
      where: {
        subscriptionId: subscription.id,
        validityType: 'membership_bound',
        status: 'active',
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });

    const account = await findCreditAccountForUpdate(tx, {
      userId: subscription.userId,
    });

    let accountBalance = account?.balance ?? 0;
    let expiredLots = 0;
    let expiredCredits = 0;

    for (const lot of lots) {
      if (lot.remainingAmount <= 0) {
        await tx.creditLot.update({
          where: { id: lot.id },
          data: { status: 'expired', remainingAmount: 0 },
        });
        expiredLots += 1;
        continue;
      }

      const balanceBefore = accountBalance;
      accountBalance = Math.max(0, accountBalance - lot.remainingAmount);
      expiredCredits += lot.remainingAmount;
      expiredLots += 1;

      await tx.creditLot.update({
        where: { id: lot.id },
        data: {
          remainingAmount: 0,
          status: 'expired',
        },
      });

      if (account) {
        await tx.creditAccount.update({
          where: { id: account.id },
          data: { balance: accountBalance },
        });
      }

      await tx.creditTransaction.create({
        data: {
          accountId: lot.accountId,
          type: TransactionType.EXPIRE,
          amount: -lot.remainingAmount,
          balanceBefore,
          balanceAfter: accountBalance,
          description: '会员积分到期清理',
          creditLotId: lot.id,
          businessType: 'membership_expire',
          subscriptionId: subscription.id,
          membershipPlanId: subscription.membershipPlanId,
          metadata: {
            expiredAt: now.toISOString(),
            reason,
          },
        },
      });
    }

    return {
      expiredLots,
      expiredCredits,
    };
  }

  /**
   * 按 lot 自身 expiresAt 清扫已过期但仍 active 的会员积分 lot（每日兜底）。
   * 常规路径由订阅周期结束时 expireSubscriptionLots 清扫；但跨周期换购（月卡→年卡）
   * 会把订阅周期重开，旧月卡 lot 的到期日早于新周期结束，仅靠周期结束清扫会漏，
   * 造成余额长期虚高（lot 消费侧已按 expiresAt 过滤，不可花但计入余额显示）。
   */
  async expireOverdueMembershipBoundLots(now = new Date()) {
    const overdueLots = await this.prisma.creditLot.findMany({
      where: {
        validityType: 'membership_bound',
        status: 'active',
        expiresAt: { lte: now },
      },
      select: {
        id: true,
        accountId: true,
        subscriptionId: true,
      },
      orderBy: { expiresAt: 'asc' },
      take: 500,
    });

    let expiredLots = 0;
    let expiredCredits = 0;

    for (const overdue of overdueLots) {
      await this.prisma.$transaction(async (tx) => {
        const account = await findCreditAccountForUpdate(tx, { id: overdue.accountId });
        const lot = await tx.creditLot.findUnique({
          where: { id: overdue.id },
          select: { remainingAmount: true, status: true },
        });
        if (!lot || lot.status !== 'active') return;

        await tx.creditLot.update({
          where: { id: overdue.id },
          data: { status: 'expired', remainingAmount: 0 },
        });
        expiredLots += 1;

        if (lot.remainingAmount <= 0) return;
        expiredCredits += lot.remainingAmount;

        if (!account) return;
        const balanceAfter = Math.max(0, account.balance - lot.remainingAmount);
        await tx.creditAccount.update({
          where: { id: account.id },
          data: { balance: balanceAfter },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: overdue.accountId,
            type: TransactionType.EXPIRE,
            amount: -lot.remainingAmount,
            balanceBefore: account.balance,
            balanceAfter,
            description: '会员积分到期清理',
            creditLotId: overdue.id,
            businessType: 'membership_expire',
            subscriptionId: overdue.subscriptionId,
            metadata: {
              expiredAt: now.toISOString(),
              reason: 'lot_expires_at_elapsed',
            },
          },
        });
      });
    }

    return { expiredLots, expiredCredits };
  }

  async adminAdjustMembershipPeriod(
    userId: string,
    days: number,
    reason: string,
    requestedBy: string,
  ) {
    if (!Number.isFinite(days) || Math.trunc(days) === 0) {
      throw new BadRequestException('days 不能为 0');
    }

    const deltaDays = Math.trunc(days);
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.userMembershipSubscription.findFirst({
        where: { userId, status: 'active' },
        orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (!subscription) {
        throw new NotFoundException('当前用户没有生效中的订阅');
      }

      const nextEndAt = this.addDays(subscription.currentPeriodEndAt, deltaDays);
      if (nextEndAt <= subscription.currentPeriodStartAt) {
        throw new BadRequestException('调整后订阅结束时间不能早于开始时间');
      }

      const updated = await tx.userMembershipSubscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodEndAt: nextEndAt,
          snapshot: this.mergeJsonObject(subscription.snapshot, {
            adminPeriodAdjust: {
              days: deltaDays,
              reason,
              requestedBy,
              adjustedAt: new Date().toISOString(),
            },
          }),
        },
      });

      await tx.membershipEntitlementSnapshot.upsert({
        where: { userId },
        create: {
          userId,
          currentPlanCode: (
            (subscription.snapshot as Prisma.JsonObject | null)?.code as string | undefined
          ) ?? 'free',
          membershipStatus: 'active',
          currentPeriodStartAt: subscription.currentPeriodStartAt,
          currentPeriodEndAt: nextEndAt,
          pauseGiftDecay: false,
        },
        update: {
          currentPeriodEndAt: nextEndAt,
        },
      });

      await tx.membershipSubscriptionChange.updateMany({
        where: { userId, status: 'scheduled' },
        data: {
          currentPeriodEndAt: nextEndAt,
          effectiveAt: nextEndAt,
          metadata: this.mergeJsonObject(null, {
            adjustedByAdmin: true,
            reason,
            requestedBy,
          }),
        },
      });

      return updated;
    });
  }

  async adminScheduleMembershipChange(input: {
    userId: string;
    planCode: string;
    effectiveMode: 'immediate' | 'next_cycle';
    reason: string;
    requestedBy: string;
  }) {
    const plan = await this.prisma.membershipPlan.findFirst({
      where: { code: input.planCode, isActive: true },
    });
    if (!plan) {
      throw new NotFoundException('目标套餐不存在');
    }

    if (input.effectiveMode === 'immediate') {
      return this.adminApplyMembershipChangeNow({
        userId: input.userId,
        plan,
        reason: input.reason,
        requestedBy: input.requestedBy,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.userMembershipSubscription.findFirst({
        where: { userId: input.userId, status: 'active' },
        orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (!subscription) {
        throw new NotFoundException('当前用户没有生效中的订阅');
      }

      await tx.membershipSubscriptionChange.updateMany({
        where: { userId: input.userId, status: 'scheduled' },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          reason: `replaced:${input.reason}`,
          requestedBy: input.requestedBy,
        },
      });

      return tx.membershipSubscriptionChange.create({
        data: {
          userId: input.userId,
          currentSubscriptionId: subscription.id,
          targetPlanId: plan.id,
          targetPlanCode: plan.code,
          targetBillingCycle: plan.billingCycle,
          changeType: 'scheduled_change',
          effectiveMode: 'next_cycle',
          status: 'scheduled',
          reason: input.reason,
          requestedBy: input.requestedBy,
          currentPeriodEndAt: subscription.currentPeriodEndAt,
          effectiveAt: subscription.currentPeriodEndAt,
          metadata: {
            source: 'admin',
          },
        },
      });
    });
  }

  async decayDailyGiftCredits(now = new Date()) {
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();
    const dailyDecayAmount = policy.dailyGiftDecayCredits;
    if (dailyDecayAmount <= 0) {
      return {
        affectedUsers: 0,
        decayedCredits: 0,
        updatedLots: 0,
      };
    }
    return this.prisma.$transaction(async (tx) => {
      const accounts = await tx.creditAccount.findMany({
        where: {
          lots: {
            some: {
              sourceType: 'subscription',
              validityType: 'fixed_window',
              status: 'active',
              remainingAmount: { gt: 0 },
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
                {
                  metadata: {
                    path: ['grantType'],
                    equals: 'free_user_starter_quota',
                  },
                },
              ],
            },
          },
        },
        select: {
          id: true,
          userId: true,
          balance: true,
        },
      });

      // 付费用户（曾支付成功过任何订单，不论积分还是套餐）不参与赠送积分衰减。
      // 口径与免费用户额度清理任务保持一致（credits.service.ts isPaidUser / 清理任务）。
      const paidUserIds = new Set(
        (
          await tx.paymentOrder.findMany({
            where: {
              userId: { in: accounts.map((account) => account.userId) },
              status: 'paid',
              orderType: { in: ['membership', 'recharge'] },
            },
            select: { userId: true },
            distinct: ['userId'],
          })
        ).map((order) => order.userId),
      );

      let affectedUsers = 0;
      let decayedCredits = 0;
      let updatedLots = 0;

      for (const account of accounts) {
        if (paidUserIds.has(account.userId)) {
          continue;
        }

        const snapshot = await tx.membershipEntitlementSnapshot.findUnique({
          where: { userId: account.userId },
        });
        if (snapshot?.pauseGiftDecay) {
          continue;
        }

        const lots = await tx.creditLot.findMany({
          where: {
            accountId: account.id,
            sourceType: 'subscription',
            validityType: 'fixed_window',
            status: 'active',
            remainingAmount: { gt: 0 },
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
              {
                metadata: {
                  path: ['grantType'],
                  equals: 'free_user_starter_quota',
                },
              },
            ],
          },
          orderBy: [{ grantedAt: 'asc' }, { createdAt: 'asc' }],
        });

        // 行锁 + 事务内重读：accounts 快照里的余额可能已过期，避免覆盖并发变更。
        const lockedAccount = await findCreditAccountForUpdate(tx, { id: account.id });
        if (!lockedAccount) continue;

        let remainingDecay = dailyDecayAmount;
        let accountBalance = lockedAccount.balance;
        const deductions: Array<{ lotId: string; amount: number }> = [];

        for (const lot of lots) {
          if (remainingDecay <= 0) break;
          const amount = Math.min(remainingDecay, lot.remainingAmount);
          if (amount <= 0) continue;

          const nextRemaining = lot.remainingAmount - amount;
          await tx.creditLot.update({
            where: { id: lot.id },
            data: {
              remainingAmount: nextRemaining,
              status: nextRemaining > 0 ? 'active' : 'exhausted',
            },
          });
          deductions.push({ lotId: lot.id, amount });
          remainingDecay -= amount;
          decayedCredits += amount;
          updatedLots += 1;
        }

        const totalDecayed = deductions.reduce((sum, item) => sum + item.amount, 0);
        if (totalDecayed <= 0) continue;

        affectedUsers += 1;
        const balanceBefore = accountBalance;
        accountBalance = Math.max(0, accountBalance - totalDecayed);

        await tx.creditAccount.update({
          where: { id: account.id },
          data: { balance: accountBalance },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.EXPIRE,
            amount: -totalDecayed,
            balanceBefore,
            balanceAfter: accountBalance,
            description: '\u514d\u8d39\u79ef\u5206\u6bcf\u65e5\u8870\u51cf',
            businessType: 'free_credit_decay',
            metadata: {
              decayedAt: now.toISOString(),
              dailyDecayAmount,
              deductions,
            },
          },
        });
      }

      return {
        affectedUsers,
        decayedCredits,
        updatedLots,
      };
    });
  }

  async expireElapsedMemberships(now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const expiredSubscriptions = await tx.userMembershipSubscription.findMany({
        where: {
          status: 'active',
          currentPeriodEndAt: { lte: now },
        },
        orderBy: [{ currentPeriodEndAt: 'asc' }, { createdAt: 'asc' }],
      });

      let expiredLots = 0;
      let expiredCredits = 0;
      let resetSnapshots = 0;

      for (const subscription of expiredSubscriptions) {
        await tx.userMembershipSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'expired',
            expiredAt: subscription.expiredAt ?? now,
          },
        });

        const result = await this.expireSubscriptionLots(
          tx,
          {
            id: subscription.id,
            userId: subscription.userId,
            membershipPlanId: subscription.membershipPlanId,
          },
          now,
          'membership_period_elapsed',
        );
        expiredLots += result.expiredLots;
        expiredCredits += result.expiredCredits;

        const hasAnyActiveSubscription = await tx.userMembershipSubscription.count({
          where: {
            userId: subscription.userId,
            status: 'active',
          },
        });

        if (hasAnyActiveSubscription === 0) {
          await tx.membershipEntitlementSnapshot.upsert({
            where: { userId: subscription.userId },
            create: {
              userId: subscription.userId,
              currentPlanCode: 'free',
              membershipStatus: 'inactive',
              currentPeriodStartAt: null,
              currentPeriodEndAt: null,
              pauseGiftDecay: false,
            },
            update: {
              currentPlanCode: 'free',
              membershipStatus: 'inactive',
              currentPeriodStartAt: null,
              currentPeriodEndAt: null,
              pauseGiftDecay: false,
            },
          });
          resetSnapshots += 1;
        }
      }

      return {
        expiredSubscriptions: expiredSubscriptions.length,
        expiredLots,
        expiredCredits,
        resetSnapshots,
      };
    });
  }

  async refreshYearlySubscriptionQuotaLots(now = new Date()) {
    // 产品策略（2026-07-17 确定）：年卡额度在购买时一次性全额到账（monthlyQuotaCredits
    // 即为全年总量），周期=年，不再按月滴灌刷新。此前配置按全年总量、代码按月度刷新，
    // 叠加导致每 30 天重复多发一整年额度（如旗舰尊享年卡每期 +720000）。
    // 保留函数与返回形状（cron 与管理端手动触发仍指向这里），直接空转。
    void now;
    return {
      refreshedSubscriptions: 0,
      grantedCredits: 0,
      createdLots: 0,
      disabled: true as const,
    };
  }

  async issueDailyMembershipGiftCredits(now = new Date()) {
    const dailyGiftEnabled = false;
    if (!dailyGiftEnabled) {
      void now;
      return {
        issuedSubscriptions: 0,
        grantedCredits: 0,
        createdLots: 0,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const windowStart = new Date(now);
      windowStart.setHours(0, 0, 0, 0);
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 1);

      const subscriptions = await tx.userMembershipSubscription.findMany({
        where: {
          status: 'active',
          currentPeriodStartAt: { lte: now },
          currentPeriodEndAt: { gt: now },
        },
        orderBy: [{ createdAt: 'asc' }],
      });

      let issuedSubscriptions = 0;
      let grantedCredits = 0;
      let createdLots = 0;

      for (const subscription of subscriptions) {
        const plan = await tx.membershipPlan.findUnique({
          where: { id: subscription.membershipPlanId },
        });
        if (!plan || plan.dailyGiftCredits <= 0 || this.isVip69PlanCode(plan.code)) {
          continue;
        }

        const alreadyIssued = await tx.creditTransaction.count({
          where: {
            subscriptionId: subscription.id,
            businessType: 'membership_daily_gift',
            createdAt: {
              gte: windowStart,
              lt: windowEnd,
            },
          },
        });
        if (alreadyIssued > 0) {
          continue;
        }

        let account = await findCreditAccountForUpdate(tx, {
          userId: subscription.userId,
        });
        if (!account) {
          account = await tx.creditAccount.create({
            data: {
              userId: subscription.userId,
              balance: 0,
              totalEarned: 0,
            },
          });
        }

        const lot = await tx.creditLot.create({
          data: {
            accountId: account.id,
            sourceType: 'gift',
            validityType: 'permanent',
            scopeType: 'global',
            scopeValue: null,
            totalAmount: plan.dailyGiftCredits,
            remainingAmount: plan.dailyGiftCredits,
            grantedAt: now,
            activeAt: now,
            expiresAt: null,
            durationDays: null,
            orderId: null,
            subscriptionId: subscription.id,
            status: 'active',
            priority: 0,
            metadata: {
              membershipPlanId: plan.id,
              membershipPlanCode: plan.code,
              grantedBy: 'membership_daily_gift',
              issuedOn: windowStart.toISOString(),
            },
          },
        });

        const balanceBefore = account.balance;
        const balanceAfter = balanceBefore + plan.dailyGiftCredits;

        await tx.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: balanceAfter,
            totalEarned: account.totalEarned + plan.dailyGiftCredits,
          },
        });

        await tx.creditTransaction.create({
          data: {
            accountId: account.id,
            type: TransactionType.EARN,
            amount: plan.dailyGiftCredits,
            balanceBefore,
            balanceAfter,
            description: `${plan.name} 每日赠送积分`,
            creditLotId: lot.id,
            businessType: 'membership_daily_gift',
            subscriptionId: subscription.id,
            membershipPlanId: plan.id,
            metadata: {
              issuedOn: windowStart.toISOString(),
            },
          },
        });

        issuedSubscriptions += 1;
        grantedCredits += plan.dailyGiftCredits;
        createdLots += 1;
      }

      return {
        issuedSubscriptions,
        grantedCredits,
        createdLots,
      };
    });
  }

  async activatePaidMembershipOrder(
    params: ActivatePaidMembershipOrderParams,
  ): Promise<ActivatePaidMembershipOrderResult> {
    const order = await params.tx.paymentOrder.findUnique({
      where: { id: params.orderId },
    });

    if (!order) {
      throw new NotFoundException('会员订单不存在');
    }
    if (order.orderType !== 'membership' || !order.membershipPlanId) {
      throw new BadRequestException('订单不是会员订单');
    }
    if (order.subscriptionId) {
      return {
        subscriptionId: order.subscriptionId,
        grantedCredits: 0,
      };
    }

    const persistedPlan = await params.tx.membershipPlan.findUnique({
      where: { id: order.membershipPlanId },
    });
    if (!persistedPlan) {
      throw new NotFoundException('会员套餐不存在');
    }

    const orderMetadata =
      order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
        ? (order.metadata as Record<string, unknown>)
        : null;
    const transitionType =
      typeof orderMetadata?.membershipTransitionType === 'string'
        ? orderMetadata.membershipTransitionType
        : null;
    if (transitionType === 'upgrade') {
      return this.applyPaidUpgradeOrder(params, order, persistedPlan, orderMetadata);
    }

    const snapshot = this.buildPlanSnapshot(persistedPlan, order.planSnapshot);
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();
    const cycleDays = this.resolveCycleDays(snapshot.billingCycle, policy.membershipRefreshCycleDays);
    const grantAmount = snapshot.monthlyQuotaCredits + snapshot.signupBonusCredits;
    const paidAt = params.paidAt;
    const activeSubscription = await params.tx.userMembershipSubscription.findFirst({
      where: {
        userId: params.userId,
        status: 'active',
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });

    let subscriptionId: string;
    let currentPeriodStartAt: Date;
    let currentPeriodEndAt: Date;

    if (activeSubscription && activeSubscription.membershipPlanId === persistedPlan.id) {
      subscriptionId = activeSubscription.id;
      currentPeriodStartAt = activeSubscription.currentPeriodStartAt;
      currentPeriodEndAt = this.addDays(activeSubscription.currentPeriodEndAt, cycleDays);
      await params.tx.userMembershipSubscription.update({
        where: { id: activeSubscription.id },
        data: {
          currentPeriodEndAt,
          renewalCount: activeSubscription.renewalCount + 1,
          lastOrderId: order.id,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      if (activeSubscription) {
        await params.tx.userMembershipSubscription.updateMany({
          where: {
            userId: params.userId,
            status: 'active',
          },
          data: {
            status: 'expired',
            expiredAt: paidAt,
          },
        });
      }

      currentPeriodStartAt = paidAt;
      currentPeriodEndAt = this.addDays(paidAt, cycleDays);
      const createdSubscription = await params.tx.userMembershipSubscription.create({
        data: {
          userId: params.userId,
          membershipPlanId: persistedPlan.id,
          status: 'active',
          periodType: snapshot.billingCycle,
          currentPeriodStartAt,
          currentPeriodEndAt,
          activatedAt: paidAt,
          lastOrderId: order.id,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
      subscriptionId = createdSubscription.id;
    }

    let account = await findCreditAccountForUpdate(params.tx, {
      userId: params.userId,
    });
    if (!account) {
      account = await params.tx.creditAccount.create({
        data: {
          userId: params.userId,
          balance: 0,
          totalEarned: 0,
        },
      });
    }

    const lot = await params.tx.creditLot.create({
      data: buildMembershipCreditLotData({
        accountId: account.id,
        amount: grantAmount,
        grantedAt: paidAt,
        activeAt: paidAt,
        expiresAt: currentPeriodEndAt,
        orderId: order.id,
        subscriptionId,
        metadata: {
          membershipPlanId: persistedPlan.id,
          membershipPlanCode: snapshot.code,
          membershipPlanName: snapshot.name,
          billingCycle: snapshot.billingCycle,
          grantedBy: 'membership_payment_success',
        },
      }),
    });

    const newBalance = account.balance + grantAmount;
    await params.tx.creditAccount.update({
      where: { id: account.id },
      data: {
        balance: newBalance,
        totalEarned: account.totalEarned + grantAmount,
      },
    });

    await params.tx.creditTransaction.create({
      data: {
        accountId: account.id,
        type: TransactionType.EARN,
        amount: grantAmount,
        balanceBefore: account.balance,
        balanceAfter: newBalance,
        description: `${snapshot.name} 开通发放积分`,
        creditLotId: lot.id,
        businessType: 'membership_grant',
        orderId: order.id,
        subscriptionId,
        membershipPlanId: persistedPlan.id,
        metadata: {
          membershipPlanCode: snapshot.code,
          billingCycle: snapshot.billingCycle,
          grantedCredits: grantAmount,
        },
      },
    });

    const snapshotMetadata =
      snapshot.metadata && typeof snapshot.metadata === 'object' && !Array.isArray(snapshot.metadata)
        ? snapshot.metadata
        : null;

    await params.tx.membershipEntitlementSnapshot.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        currentPlanCode: snapshot.code,
        membershipStatus: 'active',
        currentPeriodStartAt,
        currentPeriodEndAt,
        pauseGiftDecay: Boolean(snapshotMetadata?.pauseGiftDecay),
      },
      update: {
        currentPlanCode: snapshot.code,
        membershipStatus: 'active',
        currentPeriodStartAt,
        currentPeriodEndAt,
        pauseGiftDecay: Boolean(snapshotMetadata?.pauseGiftDecay),
      },
    });

    return {
      subscriptionId,
      grantedCredits: grantAmount,
    };
  }

  private async applyPaidUpgradeOrder(
    params: ActivatePaidMembershipOrderParams,
    order: {
      id: string;
      membershipPlanId: string | null;
      planSnapshot: Prisma.JsonValue | null;
      metadata: Prisma.JsonValue | null;
    },
    persistedPlan: {
      id: string;
      code: string;
      name: string;
      billingCycle: string;
      price: Prisma.Decimal;
      monthlyQuotaCredits: number;
      signupBonusCredits: number;
      dailyGiftCredits: number;
      metadata: Prisma.JsonValue | null;
    },
    orderMetadata: Record<string, unknown> | null,
  ): Promise<ActivatePaidMembershipOrderResult> {
    const activeSubscription = await params.tx.userMembershipSubscription.findFirst({
      where: {
        userId: params.userId,
        status: 'active',
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!activeSubscription) {
      throw new BadRequestException('当前没有可升级的生效订阅');
    }

    const snapshot = this.buildPlanSnapshot(persistedPlan, order.planSnapshot);
    const immediateCreditDelta = Math.max(
      0,
      this.toInt(orderMetadata?.immediateCreditDelta, 0),
    );
    // 跨周期升级（月卡→年卡）：周期自支付时刻重开为完整目标周期，periodType 同步切换。
    const cycleSwitch = orderMetadata?.membershipCycleSwitch === true;
    let periodStartAt = activeSubscription.currentPeriodStartAt;
    let periodEndAt = activeSubscription.currentPeriodEndAt;
    if (cycleSwitch) {
      const policy = await this.businessPolicyService.getMembershipCreditPolicy();
      periodStartAt = params.paidAt;
      periodEndAt = this.addDays(
        params.paidAt,
        this.resolveCycleDays(snapshot.billingCycle, policy.membershipRefreshCycleDays),
      );
    }

    await params.tx.membershipSubscriptionChange.updateMany({
      where: { userId: params.userId, status: 'scheduled' },
      data: {
        status: 'cancelled',
        cancelledAt: params.paidAt,
        reason: 'replaced:user_upgrade',
        requestedBy: params.userId,
      },
    });

    await params.tx.userMembershipSubscription.update({
      where: { id: activeSubscription.id },
      data: {
        membershipPlanId: persistedPlan.id,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        lastOrderId: order.id,
        ...(cycleSwitch
          ? {
              periodType: snapshot.billingCycle,
              currentPeriodStartAt: periodStartAt,
              currentPeriodEndAt: periodEndAt,
            }
          : {}),
      },
    });

    let account = await findCreditAccountForUpdate(params.tx, {
      userId: params.userId,
    });
    if (!account) {
      account = await params.tx.creditAccount.create({
        data: {
          userId: params.userId,
          balance: 0,
          totalEarned: 0,
        },
      });
    }

    if (immediateCreditDelta > 0) {
      const lot = await params.tx.creditLot.create({
        data: buildMembershipCreditLotData({
          accountId: account.id,
          amount: immediateCreditDelta,
          grantedAt: params.paidAt,
          activeAt: params.paidAt,
          expiresAt: periodEndAt,
          orderId: order.id,
          subscriptionId: activeSubscription.id,
          metadata: {
            membershipPlanId: persistedPlan.id,
            membershipPlanCode: snapshot.code,
            membershipPlanName: snapshot.name,
            billingCycle: snapshot.billingCycle,
            grantedBy: cycleSwitch ? 'membership_cycle_switch' : 'membership_upgrade_prorated',
          },
        }),
      });

      const balanceAfter = account.balance + immediateCreditDelta;
      await params.tx.creditAccount.update({
        where: { id: account.id },
        data: {
          balance: balanceAfter,
          totalEarned: account.totalEarned + immediateCreditDelta,
        },
      });

      await params.tx.creditTransaction.create({
        data: {
          accountId: account.id,
          type: TransactionType.EARN,
          amount: immediateCreditDelta,
          balanceBefore: account.balance,
          balanceAfter,
          description: cycleSwitch
            ? `${snapshot.name} 换购新周期发放`
            : `${snapshot.name} 升级补发积分`,
          creditLotId: lot.id,
          businessType: cycleSwitch ? 'membership_cycle_switch' : 'membership_upgrade_prorated',
          orderId: order.id,
          subscriptionId: activeSubscription.id,
          membershipPlanId: persistedPlan.id,
          metadata: {
            membershipPlanCode: snapshot.code,
            billingCycle: snapshot.billingCycle,
            grantedCredits: immediateCreditDelta,
          },
        },
      });
    }

    const snapshotMetadata =
      snapshot.metadata && typeof snapshot.metadata === 'object' && !Array.isArray(snapshot.metadata)
        ? snapshot.metadata
        : null;

    await params.tx.membershipEntitlementSnapshot.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        currentPlanCode: snapshot.code,
        membershipStatus: 'active',
        currentPeriodStartAt: periodStartAt,
        currentPeriodEndAt: periodEndAt,
        pauseGiftDecay: Boolean(snapshotMetadata?.pauseGiftDecay),
      },
      update: {
        currentPlanCode: snapshot.code,
        membershipStatus: 'active',
        currentPeriodStartAt: periodStartAt,
        currentPeriodEndAt: periodEndAt,
        pauseGiftDecay: Boolean(snapshotMetadata?.pauseGiftDecay),
      },
    });

    await params.tx.membershipSubscriptionChange.create({
      data: {
        userId: params.userId,
        currentSubscriptionId: activeSubscription.id,
        targetPlanId: persistedPlan.id,
        targetPlanCode: persistedPlan.code,
        targetBillingCycle: persistedPlan.billingCycle,
        changeType: 'upgrade',
        effectiveMode: 'immediate',
        status: 'applied',
        reason: cycleSwitch ? 'user_upgrade_cycle_switch' : 'user_upgrade',
        orderId: order.id,
        requestedBy: params.userId,
        currentPeriodEndAt: periodEndAt,
        effectiveAt: params.paidAt,
        appliedAt: params.paidAt,
        metadata: {
          immediateCreditDelta,
          cycleSwitch,
        },
      },
    });

    return {
      subscriptionId: activeSubscription.id,
      grantedCredits: immediateCreditDelta,
    };
  }

  async applyDueScheduledChanges(now = new Date()) {
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();
    return this.prisma.$transaction(async (tx) => {
      const changes = await tx.membershipSubscriptionChange.findMany({
        where: {
          status: 'scheduled',
          effectiveMode: 'next_cycle',
          effectiveAt: { lte: now },
        },
        orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }],
      });

      let appliedCount = 0;

      for (const change of changes) {
        const plan = await tx.membershipPlan.findUnique({
          where: { id: change.targetPlanId },
        });
        if (!plan) {
          await tx.membershipSubscriptionChange.update({
            where: { id: change.id },
            data: {
              status: 'cancelled',
              cancelledAt: now,
              reason: change.reason ?? 'target_plan_missing',
            },
          });
          continue;
        }

        await tx.userMembershipSubscription.updateMany({
          where: {
            userId: change.userId,
            status: 'active',
          },
          data: {
            status: 'expired',
            expiredAt: now,
            currentPeriodEndAt: now,
          },
        });

        const snapshot = this.buildPlanSnapshot(plan, null);
        const cycleDays = this.resolveCycleDays(snapshot.billingCycle, policy.membershipRefreshCycleDays);
        await this.createSubscriptionCycle(tx, {
          userId: change.userId,
          plan,
          snapshot,
          startAt: change.effectiveAt,
          endAt: this.addDays(change.effectiveAt, cycleDays),
          reason: change.reason ?? 'scheduled_change',
        });

        await tx.membershipSubscriptionChange.update({
          where: { id: change.id },
          data: {
            status: 'applied',
            appliedAt: now,
          },
        });

        appliedCount += 1;
      }

      return { appliedCount };
    });
  }

  private async adminApplyMembershipChangeNow(params: {
    userId: string;
    plan: {
      id: string;
      code: string;
      name: string;
      billingCycle: string;
      price: Prisma.Decimal;
      monthlyQuotaCredits: number;
      signupBonusCredits: number;
      dailyGiftCredits: number;
      metadata: Prisma.JsonValue | null;
    };
    reason: string;
    requestedBy: string;
  }) {
    const now = new Date();
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();

    return this.prisma.$transaction(async (tx) => {
      await tx.membershipSubscriptionChange.updateMany({
        where: { userId: params.userId, status: 'scheduled' },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          reason: `replaced:${params.reason}`,
          requestedBy: params.requestedBy,
        },
      });

      await tx.userMembershipSubscription.updateMany({
        where: { userId: params.userId, status: 'active' },
        data: {
          status: 'expired',
          expiredAt: now,
          currentPeriodEndAt: now,
        },
      });

      const snapshot = this.buildPlanSnapshot(params.plan, null);
      const cycleDays = this.resolveCycleDays(snapshot.billingCycle, policy.membershipRefreshCycleDays);
      const subscription = await this.createSubscriptionCycle(tx, {
        userId: params.userId,
        plan: params.plan,
        snapshot,
        startAt: now,
        endAt: this.addDays(now, cycleDays),
        reason: params.reason,
      });

      await tx.membershipSubscriptionChange.create({
        data: {
          userId: params.userId,
          currentSubscriptionId: subscription.id,
          targetPlanId: params.plan.id,
          targetPlanCode: params.plan.code,
          targetBillingCycle: params.plan.billingCycle,
          changeType: 'admin_override',
          effectiveMode: 'immediate',
          status: 'applied',
          reason: params.reason,
          requestedBy: params.requestedBy,
          effectiveAt: now,
          appliedAt: now,
          currentPeriodEndAt: subscription.currentPeriodEndAt,
          metadata: {
            source: 'admin',
          },
        },
      });

      return subscription;
    });
  }

  private async createSubscriptionCycle(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      plan: {
        id: string;
        code: string;
        name: string;
        billingCycle: string;
        price: Prisma.Decimal;
        monthlyQuotaCredits: number;
        signupBonusCredits: number;
        dailyGiftCredits: number;
        metadata: Prisma.JsonValue | null;
      };
      snapshot: MembershipPlanSnapshot;
      startAt: Date;
      endAt: Date;
      reason: string;
    },
  ) {
    const subscription = await tx.userMembershipSubscription.create({
      data: {
        userId: params.userId,
        membershipPlanId: params.plan.id,
        status: 'active',
        periodType: params.snapshot.billingCycle,
        currentPeriodStartAt: params.startAt,
        currentPeriodEndAt: params.endAt,
        activatedAt: params.startAt,
        snapshot: params.snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    let account = await findCreditAccountForUpdate(tx, {
      userId: params.userId,
    });
    if (!account) {
      account = await tx.creditAccount.create({
        data: {
          userId: params.userId,
          balance: 0,
          totalEarned: 0,
        },
      });
    }

    const grantAmount = params.snapshot.monthlyQuotaCredits + params.snapshot.signupBonusCredits;
    const lot = await tx.creditLot.create({
      data: buildMembershipCreditLotData({
        accountId: account.id,
        amount: grantAmount,
        grantedAt: params.startAt,
        activeAt: params.startAt,
        expiresAt: params.endAt,
        subscriptionId: subscription.id,
        metadata: {
          membershipPlanId: params.plan.id,
          membershipPlanCode: params.snapshot.code,
          membershipPlanName: params.snapshot.name,
          billingCycle: params.snapshot.billingCycle,
          grantedBy: 'membership_subscription_change',
          reason: params.reason,
        },
      }),
    });

    const balanceAfter = account.balance + grantAmount;
    await tx.creditAccount.update({
      where: { id: account.id },
      data: {
        balance: balanceAfter,
        totalEarned: account.totalEarned + grantAmount,
      },
    });

    await tx.creditTransaction.create({
      data: {
        accountId: account.id,
        type: TransactionType.EARN,
        amount: grantAmount,
        balanceBefore: account.balance,
        balanceAfter,
        description: `${params.snapshot.name} 生效发放积分`,
        creditLotId: lot.id,
        businessType: 'membership_admin_change',
        subscriptionId: subscription.id,
        membershipPlanId: params.plan.id,
        metadata: {
          membershipPlanCode: params.snapshot.code,
          billingCycle: params.snapshot.billingCycle,
          grantedCredits: grantAmount,
          reason: params.reason,
        },
      },
    });

    const snapshotMetadata =
      params.snapshot.metadata &&
      typeof params.snapshot.metadata === 'object' &&
      !Array.isArray(params.snapshot.metadata)
        ? params.snapshot.metadata
        : null;

    await tx.membershipEntitlementSnapshot.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        currentPlanCode: params.snapshot.code,
        membershipStatus: 'active',
        currentPeriodStartAt: params.startAt,
        currentPeriodEndAt: params.endAt,
        pauseGiftDecay: Boolean(snapshotMetadata?.pauseGiftDecay),
      },
      update: {
        currentPlanCode: params.snapshot.code,
        membershipStatus: 'active',
        currentPeriodStartAt: params.startAt,
        currentPeriodEndAt: params.endAt,
        pauseGiftDecay: Boolean(snapshotMetadata?.pauseGiftDecay),
      },
    });

    return subscription;
  }

  private mergeJsonObject(
    current: Prisma.JsonValue | null | undefined,
    patch: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
    return {
      ...base,
      ...patch,
    } as Prisma.InputJsonValue;
  }

  private buildPlanSnapshot(
    plan: {
      id: string;
      code: string;
      name: string;
      billingCycle: string;
      price: Prisma.Decimal;
      monthlyQuotaCredits: number;
      signupBonusCredits: number;
      dailyGiftCredits: number;
      metadata: Prisma.JsonValue | null;
    },
    orderSnapshot: Prisma.JsonValue | null,
  ): MembershipPlanSnapshot {
    const snapshot =
      orderSnapshot && typeof orderSnapshot === 'object' && !Array.isArray(orderSnapshot)
        ? (orderSnapshot as Prisma.JsonObject)
        : null;

    const billingCycle = this.normalizeBillingCycle(
      typeof snapshot?.billingCycle === 'string' ? snapshot.billingCycle : plan.billingCycle,
    );
    const snapshotCode = typeof snapshot?.code === 'string' ? snapshot.code : plan.code;
    const dailyGiftCredits = this.normalizeDailyGiftCreditsForPlanCode(
      snapshotCode,
      this.toInt(snapshot?.dailyGiftCredits, plan.dailyGiftCredits),
    );

    return {
      id: typeof snapshot?.id === 'string' ? snapshot.id : plan.id,
      code: snapshotCode,
      name: typeof snapshot?.name === 'string' ? snapshot.name : plan.name,
      billingCycle,
      price:
        typeof snapshot?.price === 'string' || typeof snapshot?.price === 'number'
          ? String(snapshot.price)
          : plan.price.toString(),
      monthlyQuotaCredits: this.toInt(snapshot?.monthlyQuotaCredits, plan.monthlyQuotaCredits),
      signupBonusCredits: this.toInt(snapshot?.signupBonusCredits, plan.signupBonusCredits),
      dailyGiftCredits,
      metadata:
        snapshot?.metadata && typeof snapshot.metadata === 'object' && !Array.isArray(snapshot.metadata)
          ? (snapshot.metadata as Prisma.JsonObject)
          : plan.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
            ? (plan.metadata as Prisma.JsonObject)
            : null,
    };
  }

  private normalizePlanCode(code: string | null | undefined): string {
    return (code ?? '').trim().toLowerCase();
  }

  private isVip69PlanCode(code: string | null | undefined): boolean {
    const normalized = this.normalizePlanCode(code);
    return (
      normalized === 'vip_69' ||
      normalized === 'vip-69' ||
      normalized === 'vip69' ||
      normalized === 'vip_01' ||
      normalized === 'vip-01' ||
      normalized === 'vip01'
    );
  }

  private normalizeDailyGiftCreditsForPlanCode(code: string | null | undefined, dailyGiftCredits: number): number {
    void code;
    return Number.isFinite(dailyGiftCredits) ? Math.trunc(dailyGiftCredits) : 0;
  }

  private toInt(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return fallback;
  }

  private normalizeBillingCycle(value: string): MembershipBillingCycle {
    return value === 'yearly' ? 'yearly' : 'monthly';
  }

  private comparePlanRank(
    currentPlan: {
      sortOrder: number;
      monthlyQuotaCredits: number;
      price: Prisma.Decimal;
      metadata: Prisma.JsonValue | null;
    },
    targetPlan: {
      sortOrder: number;
      monthlyQuotaCredits: number;
      price: Prisma.Decimal;
      metadata: Prisma.JsonValue | null;
    },
  ): number {
    const currentRank = this.resolvePlanRank(currentPlan);
    const targetRank = this.resolvePlanRank(targetPlan);
    if (currentRank === targetRank) {
      return Number(currentPlan.price) - Number(targetPlan.price);
    }
    return currentRank - targetRank;
  }

  private resolvePlanRank(plan: {
    sortOrder: number;
    monthlyQuotaCredits: number;
    price: Prisma.Decimal;
    metadata: Prisma.JsonValue | null;
  }): number {
    const metadata =
      plan.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
        ? (plan.metadata as Record<string, unknown>)
        : null;
    const metadataTier = Number(metadata?.tierRank);
    if (Number.isFinite(metadataTier)) {
      return metadataTier;
    }
    if (Number.isFinite(plan.sortOrder) && plan.sortOrder !== 0) {
      return plan.sortOrder;
    }
    if (plan.monthlyQuotaCredits > 0) {
      return plan.monthlyQuotaCredits;
    }
    return Number(plan.price);
  }

  private computeRemainingRatio(startAt: Date, endAt: Date, now = new Date()): number {
    const total = endAt.getTime() - startAt.getTime();
    if (total <= 0) return 0;
    const remaining = Math.max(0, endAt.getTime() - now.getTime());
    return Math.min(1, Math.max(0, remaining / total));
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private resolveCycleDays(cycle: MembershipBillingCycle, refreshCycleDays: number): number {
    return cycle === 'yearly' ? refreshCycleDays * 12 : refreshCycleDays;
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
