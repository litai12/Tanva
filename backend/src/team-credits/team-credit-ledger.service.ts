import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';

const RESERVE_TTL_MS = 10 * 60 * 1000; // 10 分钟预留超时

@Injectable()
export class TeamCreditLedgerService {
  private readonly logger = new Logger(TeamCreditLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 预留积分（幂等）
   * 漏洞 3 修复：配额检查通过 DB 行锁原子执行
   */
  async reserve(params: {
    teamId: string;
    amount: number;
    taskId: string;
    taskKind?: string;
    actorUserId: string;
  }): Promise<{ reserved: boolean; reason?: string }> {
    const { teamId, amount, taskId, taskKind, actorUserId } = params;
    const reserveExpiresAt = new Date(Date.now() + RESERVE_TTL_MS);

    try {
      await this.prisma.$transaction(async (tx) => {
        // 行锁：SELECT FOR UPDATE
        const acc = await tx.$queryRaw<{ id: string; balance: number; frozenBalance: number }[]>`
          SELECT id, balance, "frozenBalance"
          FROM "TeamCreditAccount"
          WHERE "teamId" = ${teamId}
          FOR UPDATE
        `;
        if (!acc.length) throw new BadRequestException('团队积分账户不存在');
        const { id: accId, balance, frozenBalance: frozen } = acc[0];
        const available = balance - frozen;
        if (available < amount) throw new BadRequestException('团队积分不足');

        // 幂等插入
        await tx.teamCreditLedger.upsert({
          where: { teamAccId_entryType_taskId: { teamAccId: accId, entryType: 'reserve', taskId } },
          create: {
            teamAccId: accId, entryType: 'reserve', amount,
            taskId, taskKind, actorUserId, reserveExpiresAt,
          },
          update: {},
        });

        await tx.teamCreditAccount.update({
          where: { id: accId },
          data: { frozenBalance: { increment: amount } },
        });

        // 漏洞 3：配额原子更新（行锁保证）
        if (actorUserId) {
          const updatedCount: number = await tx.$executeRaw`
            UPDATE "TeamMembership"
            SET "creditUsedThisCycle" = "creditUsedThisCycle" + ${amount},
                "updatedAt" = NOW()
            WHERE "teamId" = ${teamId}
              AND "userId" = ${actorUserId}
              AND (
                "creditQuotaMonthly" IS NULL
                OR "creditUsedThisCycle" + ${amount} <= "creditQuotaMonthly"
              )
          `;
          if (updatedCount === 0) {
            throw new BadRequestException('已超出个人月度配额');
          }
        }
      });

      return { reserved: true };
    } catch (e: any) {
      if (e instanceof BadRequestException) return { reserved: false, reason: e.message };
      throw e;
    }
  }

  /** 扣除积分（reserve 成功后调用） */
  async deduct(params: {
    teamId: string;
    amount: number;
    taskId: string;
    taskKind?: string;
    actorUserId: string;
  }): Promise<{ deducted: boolean }> {
    const { teamId, amount, taskId, taskKind, actorUserId } = params;
    try {
      await this.prisma.$transaction(async (tx) => {
        const acc = await tx.teamCreditAccount.findUniqueOrThrow({ where: { teamId } });
        await tx.teamCreditLedger.upsert({
          where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'deduct', taskId } },
          create: { teamAccId: acc.id, entryType: 'deduct', amount, taskId, taskKind, actorUserId },
          update: {},
        });
        await tx.teamCreditAccount.update({
          where: { id: acc.id },
          data: {
            balance: { decrement: amount },
            frozenBalance: { decrement: amount },
            totalSpent: { increment: amount },
          },
        });
      });
      return { deducted: true };
    } catch {
      return { deducted: false };
    }
  }

  /** 释放预留（任务失败/取消时调用） */
  async release(params: { teamId: string; amount: number; taskId: string }): Promise<void> {
    const { teamId, amount, taskId } = params;
    await this.prisma.$transaction(async (tx) => {
      const acc = await tx.teamCreditAccount.findUniqueOrThrow({ where: { teamId } });
      await tx.teamCreditLedger.upsert({
        where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'release', taskId } },
        create: { teamAccId: acc.id, entryType: 'release', amount, taskId },
        update: {},
      });
      await tx.teamCreditAccount.update({
        where: { id: acc.id },
        data: { frozenBalance: { decrement: amount } },
      });
      // 回退成员配额
      await tx.$executeRaw`
        UPDATE "TeamMembership" tm
        SET "creditUsedThisCycle" = GREATEST(0, tm."creditUsedThisCycle" - ${amount}),
            "updatedAt" = NOW()
        FROM "TeamCreditLedger" l
        WHERE l."taskId" = ${taskId}
          AND l."entryType" = 'reserve'
          AND l."actorUserId" = tm."userId"
          AND tm."teamId" = ${teamId}
      `;
    });
  }

  /** 漏洞 2 修复：定时释放过期 reserve */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredReserves() {
    const expired = await this.prisma.teamCreditLedger.findMany({
      where: {
        entryType: 'reserve',
        reserveExpiresAt: { lt: new Date() },
      },
      include: { account: { select: { teamId: true } } },
      take: 200,
    });

    for (const entry of expired) {
      // 检查是否已有对应 deduct/release
      const settled = await this.prisma.teamCreditLedger.findFirst({
        where: {
          teamAccId: entry.teamAccId,
          taskId: entry.taskId,
          entryType: { in: ['deduct', 'release'] },
        },
      });
      if (!settled) {
        await this.release({
          teamId: entry.account.teamId,
          amount: entry.amount,
          taskId: entry.taskId!,
        }).catch((e) => this.logger.warn(`过期 reserve 释放失败 taskId=${entry.taskId}: ${e}`));
      }
    }
  }
}
