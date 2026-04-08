import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildMembershipCreditLotData } from '../credits/credit-lot-grants';
import { TransactionType } from '../credits/dto/credits.dto';
import type {
  ActivatePaidMembershipOrderParams,
  ActivatePaidMembershipOrderResult,
  MembershipBillingCycle,
  MembershipPlanSnapshot,
} from './membership.types';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async listActivePlans() {
    return this.prisma.membershipPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
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
    const cycleDays = this.resolveCycleDays(snapshot.billingCycle);
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

  private resolveCycleDays(cycle: MembershipBillingCycle): number {
    return cycle === 'yearly' ? 365 : 30;
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
