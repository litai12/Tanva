import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TeamCreditsPublisher } from '../team-collab/team-credits-publisher.service';

// 预留超时：须 ≥ 异步任务最大时长（视频/图像异步任务最长 ~15min，见 IMAGE_TASK_MAX_DURATION_MS），
// 否则慢任务的 reserve 会被 releaseExpiredReserves 提前释放，成功结算 deduct 时 frozenBalance 变负、可用余额虚高。
const RESERVE_TTL_MS = 20 * 60 * 1000; // 20 分钟预留超时

@Injectable()
export class TeamCreditLedgerService {
  private readonly logger = new Logger(TeamCreditLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly publisher?: TeamCreditsPublisher,
  ) {}

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

        // 配额原子更新（行锁保证）
        if (actorUserId) {
          // 月度周期重置：超过 30 天自动开启新周期
          await tx.$executeRaw`
            UPDATE "TeamMembership"
            SET "creditUsedThisCycle" = 0,
                "quotaCycleStartAt" = NOW(),
                "updatedAt" = NOW()
            WHERE "teamId" = ${teamId}
              AND "userId" = ${actorUserId}
              AND "quotaCycleStartAt" < NOW() - INTERVAL '30 days'
          `;
          const updatedCount: number = await tx.$executeRaw`
            UPDATE "TeamMembership"
            SET "creditUsedThisCycle" = "creditUsedThisCycle" + ${amount},
                "creditUsedTotal" = "creditUsedTotal" + ${amount},
                "updatedAt" = NOW()
            WHERE "teamId" = ${teamId}
              AND "userId" = ${actorUserId}
              AND (
                "creditQuotaMonthly" IS NULL
                OR "creditUsedThisCycle" + ${amount} <= "creditQuotaMonthly"
              )
              AND (
                "creditQuotaTotal" IS NULL
                OR "creditUsedTotal" + ${amount} <= "creditQuotaTotal"
              )
          `;
          if (updatedCount === 0) {
            // 查出具体超限原因
            const m = await tx.teamMembership.findUnique({
              where: { teamId_userId: { teamId, userId: actorUserId } },
              select: {
                creditQuotaMonthly: true,
                creditQuotaTotal: true,
                creditUsedThisCycle: true,
                creditUsedTotal: true,
              },
            });
            if (m?.creditQuotaMonthly != null && (m.creditUsedThisCycle + amount) > m.creditQuotaMonthly) {
              throw new BadRequestException('已超出个人月度配额');
            }
            if (m?.creditQuotaTotal != null && (m.creditUsedTotal + amount) > m.creditQuotaTotal) {
              throw new BadRequestException('已超出个人总量配额');
            }
            throw new BadRequestException('已超出个人配额');
          }
        }
      });

      void this.publisher?.publish({
        teamId,
        reason: 'reserve',
        delta: -amount,
        actorUserId,
        taskId,
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
        // 幂等：deduct 流水已存在说明本任务已结算，跳过账户变更，避免重复扣减
        // （团队结算由前端轮询触发的 video-task-success 调用，可能重复打到）。
        const existing = await tx.teamCreditLedger.findUnique({
          where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'deduct', taskId } },
          select: { id: true },
        });
        if (existing) return;
        await tx.teamCreditLedger.create({
          data: { teamAccId: acc.id, entryType: 'deduct', amount, taskId, taskKind, actorUserId },
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
      void this.publisher?.publish({
        teamId,
        reason: 'deduct',
        // balance went down by `amount`; frozen also went down by `amount`,
        // so `availableCredits = balance - frozen` did not change here.
        // We still emit so clients refetch / re-display consistent state.
        delta: 0,
        actorUserId,
        taskId,
      });
      return { deducted: true };
    } catch {
      return { deducted: false };
    }
  }

  /** 释放预留（任务失败/取消时调用） */
  async release(params: { teamId: string; amount: number; taskId: string }): Promise<void> {
    const { teamId, amount, taskId } = params;
    const released = await this.prisma.$transaction(async (tx) => {
      const acc = await tx.teamCreditAccount.findUniqueOrThrow({ where: { teamId } });
      // 幂等：release 流水已存在说明本任务预留已释放，跳过账户/配额回退，避免重复释放
      // （video-task-refund + 过期 reserve cron 可能对同一 taskId 并发触发）。
      const existing = await tx.teamCreditLedger.findUnique({
        where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'release', taskId } },
        select: { id: true },
      });
      if (existing) return false;
      await tx.teamCreditLedger.create({
        data: { teamAccId: acc.id, entryType: 'release', amount, taskId },
      });
      await tx.teamCreditAccount.update({
        where: { id: acc.id },
        data: { frozenBalance: { decrement: amount } },
      });
      // 回退成员配额（月度 + 总量）
      await tx.$executeRaw`
        UPDATE "TeamMembership" tm
        SET "creditUsedThisCycle" = GREATEST(0, tm."creditUsedThisCycle" - ${amount}),
            "creditUsedTotal" = GREATEST(0, tm."creditUsedTotal" - ${amount}),
            "updatedAt" = NOW()
        FROM "TeamCreditLedger" l
        WHERE l."taskId" = ${taskId}
          AND l."entryType" = 'reserve'
          AND l."actorUserId" = tm."userId"
          AND tm."teamId" = ${teamId}
      `;
      return true;
    });
    // 幂等跳过时不广播，避免误报可用余额回升
    if (!released) return;
    void this.publisher?.publish({
      teamId,
      reason: 'release',
      delta: amount, // frozen -= amount, so availableCredits goes up
      taskId,
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
