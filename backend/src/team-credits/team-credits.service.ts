import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCoreService } from '../team-core/team-core.service';
import { TeamCreditsPublisher } from '../team-collab/team-credits-publisher.service';

@Injectable()
export class TeamCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamCore: TeamCoreService,
    @Optional() private readonly publisher?: TeamCreditsPublisher,
  ) {}

  async getAccount(teamId: string, requestingUserId: string) {
    await this.teamCore.assertMember(teamId, requestingUserId);
    const acc = await this.prisma.teamCreditAccount.findUniqueOrThrow({
      where: { teamId },
      include: {
        lots: {
          where: { remaining: { gt: 0 } },
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    return {
      ...acc,
      availableCredits: acc.balance - acc.frozenBalance,
    };
  }

  async getLedger(teamId: string, requestingUserId: string, take = 50, skip = 0) {
    await this.teamCore.assertMember(teamId, requestingUserId);
    const acc = await this.prisma.teamCreditAccount.findUniqueOrThrow({ where: { teamId } });
    const entries = await this.prisma.teamCreditLedger.findMany({
      where: { teamAccId: acc.id },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    // 附带使用人昵称 + 手机尾号（actorUserId 是裸字段，回查 User）。
    const actorIds = Array.from(
      new Set(entries.map((e) => e.actorUserId).filter((id): id is string => !!id)),
    );
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, phone: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return entries.map((e) => {
      const u = e.actorUserId ? userMap.get(e.actorUserId) : undefined;
      const phone = u?.phone?.trim() || '';
      return {
        ...e,
        actorName: u?.name?.trim() || null,
        actorPhoneTail: phone ? phone.slice(-4) : null,
      };
    });
  }

  async getMemberUsages(teamId: string, requestingUserId: string) {
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner', 'admin']);
    return this.prisma.teamMembership.findMany({
      where: { teamId },
      select: {
        userId: true,
        role: true,
        creditQuotaMonthly: true,
        creditUsedThisCycle: true,
        quotaCycleStartAt: true,
        user: { select: { name: true, avatarUrl: true } },
      },
    });
  }

  async setMemberQuota(teamId: string, targetUserId: string, quota: number | null, requestingUserId: string) {
    await this.teamCore.assertRole(teamId, requestingUserId, ['owner', 'admin']);
    return this.prisma.teamMembership.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: { creditQuotaMonthly: quota },
    });
  }

  /** 团队充值（生成积分批次，支付流程另行处理） */
  async topupCredits(teamId: string, amount: number, sourceRefId: string) {
    if (amount <= 0) throw new BadRequestException('充值金额必须大于0');
    const acc = await this.prisma.teamCreditAccount.findUniqueOrThrow({ where: { teamId } });
    const expiresAt = new Date(Date.now() + 365 * 86400_000); // 1年有效期

    await this.prisma.$transaction([
      this.prisma.teamCreditLot.create({
        data: {
          teamCreditAccId: acc.id,
          amount,
          remaining: amount,
          expiresAt,
          source: 'topup',
          sourceRefId,
        },
      }),
      this.prisma.teamCreditAccount.update({
        where: { id: acc.id },
        data: {
          balance: { increment: amount },
          totalEarned: { increment: amount },
        },
      }),
      this.prisma.teamCreditLedger.create({
        data: {
          teamAccId: acc.id,
          entryType: 'topup',
          amount,
          taskId: `topup_${sourceRefId}`,
          note: `充值 ${amount} 积分`,
        },
      }),
    ]);

    void this.publisher?.publish({
      teamId,
      reason: 'topup',
      delta: amount,
      taskId: `topup_${sourceRefId}`,
    });

    return { teamId, addedCredits: amount };
  }
}
