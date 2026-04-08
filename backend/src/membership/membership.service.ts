import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildMembershipCreditLotData } from '../credits/credit-lot-grants';
import { TransactionType } from '../credits/dto/credits.dto';
import { BusinessPolicyService } from '../business-policy/business-policy.service';
import type {
  ActivatePaidMembershipOrderParams,
  ActivatePaidMembershipOrderResult,
  MembershipBillingCycle,
  MembershipPlanSnapshot,
} from './membership.types';

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessPolicyService: BusinessPolicyService,
  ) {}

  async listActivePlans() {
    return this.prisma.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
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
        dailyGiftCredits: plan.dailyGiftCredits,
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
    const subscription = await this.prisma.userMembershipSubscription.findFirst({
      where: {
        userId,
        status: 'active',
      },
      orderBy: [{ currentPeriodEndAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!subscription) {
      return {
        subscription: null,
        plan: null,
        entitlement: await this.getMembershipEntitlement(userId),
      };
    }

    const plan = await this.prisma.membershipPlan.findUnique({
      where: { id: subscription.membershipPlanId },
    });

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
            dailyGiftCredits: plan.dailyGiftCredits,
          }
        : null,
      entitlement: await this.getMembershipEntitlement(userId),
    };
  }

  async getMembershipEntitlement(userId: string) {
    const snapshot = await this.prisma.membershipEntitlementSnapshot.findUnique({
      where: { userId },
    });

    const activeSubscriptionCount = await this.prisma.userMembershipSubscription.count({
      where: {
        userId,
        status: 'active',
      },
    });

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
    const [current, entitlement, account, activeLots] = await Promise.all([
      this.getCurrentMembership(userId),
      this.getMembershipEntitlement(userId),
      this.prisma.creditAccount.findUnique({ where: { userId } }),
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
        },
      }),
    ]);

    const balances = activeLots.reduce(
      (acc, lot) => {
        if (lot.validityType === 'membership_bound' || lot.sourceType === 'subscription') {
          acc.subscriptionCredits += lot.remainingAmount;
        } else if (lot.sourceType === 'gift') {
          acc.giftCredits += lot.remainingAmount;
        } else {
          acc.fixedCredits += lot.remainingAmount;
        }
        return acc;
      },
      { subscriptionCredits: 0, giftCredits: 0, fixedCredits: 0 },
    );

    return {
      planCode: entitlement.currentPlanCode,
      membershipStatus: entitlement.membershipStatus,
      currentPeriodStartAt: entitlement.currentPeriodStartAt,
      currentPeriodEndAt: entitlement.currentPeriodEndAt,
      benefits: {
        pauseGiftDecay: entitlement.pauseGiftDecay,
      },
      balances: {
        subscriptionCredits: balances.subscriptionCredits,
        giftCredits: balances.giftCredits,
        fixedCredits: balances.fixedCredits,
        totalCredits: account?.balance ?? 0,
      },
      quotas: {
        inviteLimit: null,
        imageDailyLimit: null,
        videoDailyLimit: null,
      },
      current,
    };
  }

  async decayDailyGiftCredits(now = new Date()) {
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();
    const dailyDecayAmount = policy.dailyGiftDecayCredits;
    return this.prisma.$transaction(async (tx) => {
      const accounts = await tx.creditAccount.findMany({
        where: {
          lots: {
            some: {
              sourceType: 'gift',
              validityType: 'permanent',
              status: 'active',
              remainingAmount: { gt: 0 },
            },
          },
        },
        select: {
          id: true,
          userId: true,
          balance: true,
        },
      });

      let affectedUsers = 0;
      let decayedCredits = 0;
      let updatedLots = 0;

      for (const account of accounts) {
        const snapshot = await tx.membershipEntitlementSnapshot.findUnique({
          where: { userId: account.userId },
        });
        if (snapshot?.pauseGiftDecay) {
          continue;
        }

        const lots = await tx.creditLot.findMany({
          where: {
            accountId: account.id,
            sourceType: 'gift',
            validityType: 'permanent',
            status: 'active',
            remainingAmount: { gt: 0 },
          },
          orderBy: [{ grantedAt: 'asc' }, { createdAt: 'asc' }],
        });

        let remainingDecay = dailyDecayAmount;
        let accountBalance = account.balance;
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
            description: '赠送积分每日衰减',
            businessType: 'gift_decay',
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

        const lots = await tx.creditLot.findMany({
          where: {
            subscriptionId: subscription.id,
            validityType: 'membership_bound',
            status: 'active',
          },
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
        });

        const account = await tx.creditAccount.findUnique({
          where: { userId: subscription.userId },
        });

        let accountBalance = account?.balance ?? 0;

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
                reason: 'membership_period_elapsed',
              },
            },
          });
        }

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
    const policy = await this.businessPolicyService.getMembershipCreditPolicy();
    const cycleDays = policy.membershipRefreshCycleDays;
    return this.prisma.$transaction(async (tx) => {
      const subscriptions = await tx.userMembershipSubscription.findMany({
        where: {
          status: 'active',
          periodType: 'yearly',
          currentPeriodEndAt: { gt: now },
        },
        orderBy: [{ currentPeriodStartAt: 'asc' }, { createdAt: 'asc' }],
      });

      let refreshedSubscriptions = 0;
      let grantedCredits = 0;
      let createdLots = 0;

      for (const subscription of subscriptions) {
        const plan = await tx.membershipPlan.findUnique({
          where: { id: subscription.membershipPlanId },
        });
        if (!plan) continue;

        const snapshot = this.buildPlanSnapshot(plan, subscription.snapshot);
        const elapsedWindows = Math.floor(
          (now.getTime() - subscription.currentPeriodStartAt.getTime()) /
            (cycleDays * 24 * 60 * 60 * 1000),
        );
        if (elapsedWindows <= 0) {
          continue;
        }

        const existingRefreshCount = await tx.creditTransaction.count({
          where: {
            subscriptionId: subscription.id,
            businessType: 'membership_refresh',
          },
        });

        const missingRefreshes = elapsedWindows - existingRefreshCount;
        if (missingRefreshes <= 0) {
          continue;
        }

        let account = await tx.creditAccount.findUnique({
          where: { userId: subscription.userId },
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

        let accountBalance = account.balance;
        for (let index = 0; index < missingRefreshes; index += 1) {
          const cycleIndex = existingRefreshCount + index + 1;
          const cycleGrantAt = this.addDays(
            subscription.currentPeriodStartAt,
            cycleIndex * cycleDays,
          );
          if (cycleGrantAt > now || cycleGrantAt >= subscription.currentPeriodEndAt) {
            break;
          }

          const lot = await tx.creditLot.create({
            data: buildMembershipCreditLotData({
              accountId: account.id,
              amount: snapshot.monthlyQuotaCredits,
              grantedAt: cycleGrantAt,
              activeAt: cycleGrantAt,
              expiresAt: subscription.currentPeriodEndAt,
              subscriptionId: subscription.id,
              metadata: {
                membershipPlanId: plan.id,
                membershipPlanCode: snapshot.code,
                billingCycle: snapshot.billingCycle,
                refreshCycleIndex: cycleIndex,
                grantedBy: 'membership_yearly_refresh',
              },
            }),
          });

          const balanceBefore = accountBalance;
          accountBalance += snapshot.monthlyQuotaCredits;
          grantedCredits += snapshot.monthlyQuotaCredits;
          createdLots += 1;

          await tx.creditAccount.update({
            where: { id: account.id },
            data: {
              balance: accountBalance,
              totalEarned: { increment: snapshot.monthlyQuotaCredits },
            },
          });

          await tx.creditTransaction.create({
            data: {
              accountId: account.id,
              type: TransactionType.EARN,
              amount: snapshot.monthlyQuotaCredits,
              balanceBefore,
              balanceAfter: accountBalance,
              description: `${snapshot.name} 年费月度额度刷新`,
              creditLotId: lot.id,
              businessType: 'membership_refresh',
              subscriptionId: subscription.id,
              membershipPlanId: plan.id,
              metadata: {
                billingCycle: snapshot.billingCycle,
                refreshCycleIndex: cycleIndex,
              },
            },
          });
          refreshedSubscriptions += 1;
        }
      }

      return {
        refreshedSubscriptions,
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

    let account = await params.tx.creditAccount.findUnique({
      where: { userId: params.userId },
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

    return {
      id: typeof snapshot?.id === 'string' ? snapshot.id : plan.id,
      code: typeof snapshot?.code === 'string' ? snapshot.code : plan.code,
      name: typeof snapshot?.name === 'string' ? snapshot.name : plan.name,
      billingCycle,
      price:
        typeof snapshot?.price === 'string' || typeof snapshot?.price === 'number'
          ? String(snapshot.price)
          : plan.price.toString(),
      monthlyQuotaCredits: this.toInt(snapshot?.monthlyQuotaCredits, plan.monthlyQuotaCredits),
      signupBonusCredits: this.toInt(snapshot?.signupBonusCredits, plan.signupBonusCredits),
      dailyGiftCredits: this.toInt(snapshot?.dailyGiftCredits, plan.dailyGiftCredits),
      metadata:
        snapshot?.metadata && typeof snapshot.metadata === 'object' && !Array.isArray(snapshot.metadata)
          ? (snapshot.metadata as Prisma.JsonObject)
          : plan.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
            ? (plan.metadata as Prisma.JsonObject)
            : null,
    };
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

  private resolveCycleDays(cycle: MembershipBillingCycle, refreshCycleDays: number): number {
    return cycle === 'yearly' ? refreshCycleDays * 12 : refreshCycleDays;
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
