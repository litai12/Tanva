import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCoreService } from '../team-core/team-core.service';
import { TeamCreditsService } from '../team-credits/team-credits.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Injectable()
export class TeamSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamCore: TeamCoreService,
    private readonly teamCredits: TeamCreditsService,
  ) {}

  async listPlans() {
    return this.prisma.teamSubscriptionPlan.findMany({
      where: { enabled: true },
      orderBy: { sortWeight: 'asc' },
    });
  }

  async getSubscription(teamId: string, requestingUserId: string) {
    await this.teamCore.assertMember(teamId, requestingUserId);
    return this.prisma.teamSubscription.findFirst({
      where: { teamId, status: 'active' },
      include: { plan: true },
    });
  }

  async createSubscription(teamId: string, dto: CreateSubscriptionDto, requestingUserId: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    if (team.isPersonal) throw new ForbiddenException('个人团队不可购买团队套餐');
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner']);

    const plan = await this.prisma.teamSubscriptionPlan.findUniqueOrThrow({ where: { id: dto.planId } });
    if (!plan.enabled) throw new BadRequestException('套餐不可用');
    if (dto.seatCount < plan.minSeats || dto.seatCount > plan.maxSeats) {
      throw new BadRequestException(`座位数须在 ${plan.minSeats}~${plan.maxSeats} 之间`);
    }

    const creditsPerRenewal = plan.creditsPerSeatPerMonth * dto.seatCount;
    const now = new Date();
    const periodEnd = dto.billingCycle === 'annual'
      ? new Date(now.getTime() + 365 * 86400_000)
      : new Date(now.getTime() + 30 * 86400_000);

    // 取消旧订阅
    await this.prisma.teamSubscription.updateMany({
      where: { teamId, status: 'active' },
      data: { status: 'cancelled', cancelledAt: now },
    });

    const sub = await this.prisma.teamSubscription.create({
      data: {
        teamId,
        planId: dto.planId,
        billingCycle: dto.billingCycle,
        seatCount: dto.seatCount,
        creditsPerRenewal,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextCreditRenewalAt: now, // 立即触发首次积分发放
      },
    });

    // 首次积分立即发放
    await this.teamCredits.topupCredits(teamId, creditsPerRenewal, `sub_init_${sub.id}`);

    return sub;
  }

  async cancelSubscription(teamId: string, requestingUserId: string) {
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner']);
    return this.prisma.teamSubscription.updateMany({
      where: { teamId, status: 'active' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
  }

  /** 由 Scheduler 调用的续期核心逻辑 */
  async renewSubscription(sub: { id: string; teamId: string; creditsPerRenewal: number; billingCycle: string }) {
    const idempotentKey = `renewal_${sub.id}_${new Date().toISOString().slice(0, 10)}`;
    const acc = await this.prisma.teamCreditAccount.findUniqueOrThrow({ where: { teamId: sub.teamId } });

    // 幂等检查
    const existing = await this.prisma.teamCreditLedger.findFirst({
      where: { teamAccId: acc.id, taskId: idempotentKey },
    });
    if (existing) return; // 已续期

    await this.prisma.$transaction(async (tx) => {
      const expiresAt = new Date(Date.now() + 30 * 86400_000);

      await tx.teamCreditLot.create({
        data: {
          teamCreditAccId: acc.id,
          amount: sub.creditsPerRenewal,
          remaining: sub.creditsPerRenewal,
          expiresAt,
          source: 'subscription_renewal',
          sourceRefId: sub.id,
        },
      });

      await tx.teamCreditAccount.update({
        where: { id: acc.id },
        data: {
          balance: { increment: sub.creditsPerRenewal },
          totalEarned: { increment: sub.creditsPerRenewal },
        },
      });

      await tx.teamCreditLedger.create({
        data: {
          teamAccId: acc.id,
          entryType: 'subscription_renewal',
          amount: sub.creditsPerRenewal,
          taskId: idempotentKey,
          note: `订阅续期 ${sub.creditsPerRenewal} 积分`,
        },
      });

      // 续期时重置成员配额周期
      await tx.teamMembership.updateMany({
        where: { teamId: sub.teamId },
        data: { creditUsedThisCycle: 0, quotaCycleStartAt: new Date() },
      });

      const interval = sub.billingCycle === 'annual' ? 365 * 86400_000 : 30 * 86400_000;
      await tx.teamSubscription.update({
        where: { id: sub.id },
        data: {
          nextCreditRenewalAt: new Date(Date.now() + interval),
          lastRenewedAt: new Date(),
        },
      });
    });
  }
}
