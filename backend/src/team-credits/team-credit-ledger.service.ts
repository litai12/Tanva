import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TeamCreditsPublisher } from '../team-collab/team-credits-publisher.service';
import { ApiResponseStatus } from '../credits/dto/credits.dto';
import { roundUpDeepSeekCredits } from '../desktop-chat/deepseek-pricing';

// Expiry schedules reconciliation only; elapsed time never proves a paid task failed.
const RESERVE_TTL_MS = 20 * 60 * 1000;

@Injectable()
export class TeamCreditLedgerService {
  private readonly logger = new Logger(TeamCreditLedgerService.name);
  private expiredReserveCursor: string | undefined;

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
  }, transaction?: Prisma.TransactionClient): Promise<{ reserved: boolean; reason?: string }> {
    const { teamId, amount, taskId, taskKind, actorUserId } = params;
    const reserveExpiresAt = new Date(Date.now() + RESERVE_TTL_MS);

    try {
      const work = async (tx: Prisma.TransactionClient) => {
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
      };
      if (transaction) await work(transaction); else await this.prisma.$transaction(work);

      if (!transaction) void this.publisher?.publish({
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
  }, transaction?: Prisma.TransactionClient): Promise<{ deducted: boolean }> {
    const { teamId, amount, taskId, taskKind, actorUserId } = params;
    try {
      const work = async (tx: Prisma.TransactionClient) => {
        const accounts = await tx.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM "TeamCreditAccount"
          WHERE "teamId" = ${teamId}
          FOR UPDATE
        `;
        if (!accounts.length) throw new BadRequestException('团队积分账户不存在');
        const acc = accounts[0];
        // 幂等：deduct 流水已存在说明本任务已结算，跳过账户变更，避免重复扣减
        // （团队结算由前端轮询触发的 video-task-success 调用，可能重复打到）。
        const existing = await tx.teamCreditLedger.findUnique({
          where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'deduct', taskId } },
          select: { id: true },
        });
        if (existing) return true;

        // 不能在 reserve 已释放后继续扣款，否则 frozenBalance 会被减成负数，
        // 任务也会绕过团队额度。release/deduct 两边都做状态校验，配合唯一流水
        // 约束让重复/竞态回写保持账本幂等。
        const reserve = await tx.teamCreditLedger.findUnique({
          where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'reserve', taskId } },
          select: { id: true },
        });
        const released = await tx.teamCreditLedger.findUnique({
          where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'release', taskId } },
          select: { id: true },
        });
        if (!reserve || released) return false;

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
        return true;
      };
      const deducted = transaction ? await work(transaction) : await this.prisma.$transaction(work);
      if (!deducted) return { deducted: false };
      if (!transaction) void this.publisher?.publish({
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

  /** Settle usage against the complete original reservation and member quota.
   * The integer charge is the rounded fee for this physical request. */
  async settleDesktopChatUsage(params: { teamId: string; taskId: string; actorUserId: string; exactCreditNanos: string }, tx: Prisma.TransactionClient) {
    const { teamId, taskId, actorUserId, exactCreditNanos } = params;
    await tx.$queryRaw`SELECT id FROM "TeamCreditAccount" WHERE "teamId" = ${teamId} FOR UPDATE`;
    const account = await tx.teamCreditAccount.findUniqueOrThrow({ where: { teamId } });
    const key = (entryType: string) => ({ teamAccId_entryType_taskId: { teamAccId: account.id, entryType, taskId } });
    const prior = await tx.teamCreditLedger.findUnique({ where: key('deduct') });
    if (prior) {
      const note = prior.note ? JSON.parse(prior.note) : undefined;
      if (!note?.settlement) throw new Error('DESKTOP_CHAT_PRIOR_SETTLEMENT_MISSING');
      return note.settlement as { creditsCharged: number };
    }
    const reserve = await tx.teamCreditLedger.findUnique({ where: key('reserve') });
    if (!reserve || reserve.actorUserId !== actorUserId || await tx.teamCreditLedger.findUnique({ where: key('release') })) throw new Error('DESKTOP_CHAT_RESERVATION_MISSING');
    await tx.$queryRaw`SELECT "userId" FROM "TeamMembership" WHERE "teamId" = ${teamId} AND "userId" = ${actorUserId} FOR UPDATE`;
    const member = await tx.teamMembership.findUniqueOrThrow({ where: { teamId_userId: { teamId, userId: actorUserId } } });
    const settlement = { creditsCharged: roundUpDeepSeekCredits(exactCreditNanos) };
    const amount = settlement.creditsCharged;
    const delta = amount - reserve.amount;
    const monthlyDelta = reserve.createdAt >= member.quotaCycleStartAt ? delta : amount;
    if (account.frozenBalance < reserve.amount || account.balance - (account.frozenBalance - reserve.amount) < amount) throw new BadRequestException('团队实际费用超出可用积分，原结果保留待结算');
    const monthlyUsed = Math.max(0, member.creditUsedThisCycle + monthlyDelta);
    const totalUsed = Math.max(0, member.creditUsedTotal + delta);
    if ((member.creditQuotaMonthly != null && monthlyUsed > member.creditQuotaMonthly) ||
        (member.creditQuotaTotal != null && totalUsed > member.creditQuotaTotal)) throw new BadRequestException('团队实际费用超出成员额度，原结果保留待结算');
    await tx.teamCreditAccount.update({ where: { id: account.id }, data: { balance: { decrement: amount },
      frozenBalance: { decrement: reserve.amount }, totalSpent: { increment: amount } } });
    await tx.teamMembership.update({ where: { teamId_userId: { teamId, userId: actorUserId } }, data: {
      creditUsedThisCycle: monthlyUsed, creditUsedTotal: totalUsed } });
    await tx.teamCreditLedger.create({ data: { teamAccId: account.id, entryType: 'deduct', amount, taskId,
      taskKind: reserve.taskKind, actorUserId, note: JSON.stringify({ reason: 'desktop_chat_usage_settlement',
        reservedCredits: reserve.amount, exactCreditNanos, settlement }) } });
    return settlement;
  }

  /** 释放预留（任务失败/取消时调用） */
  async release(params: { teamId: string; amount: number; taskId: string }, transaction?: Prisma.TransactionClient): Promise<void> {
    const { teamId, amount, taskId } = params;
    const work = async (tx: Prisma.TransactionClient) => {
      const accounts = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "TeamCreditAccount"
        WHERE "teamId" = ${teamId}
        FOR UPDATE
      `;
      if (!accounts.length) throw new BadRequestException('团队积分账户不存在');
      const acc = accounts[0];
      const consumption = await tx.apiUsageRecord.findUnique({ where: { id: taskId }, select: { consumptionStatus: true } });
      if (consumption?.consumptionStatus && consumption.consumptionStatus !== 'rejected') throw new BadRequestException('网关消费未确认拒绝，不得按模型输出状态释放预算');
      // 幂等：release 流水已存在说明本任务预留已释放，跳过账户/配额回退，避免重复释放
      // （video-task-refund + 过期 reserve cron 可能对同一 taskId 并发触发）。
      const existing = await tx.teamCreditLedger.findUnique({
        where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'release', taskId } },
        select: { id: true },
      });
      if (existing) return false;
      const deducted = await tx.teamCreditLedger.findUnique({
        where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'deduct', taskId } },
        select: { id: true },
      });
      if (deducted) return false;
      const reserve = await tx.teamCreditLedger.findUnique({
        where: { teamAccId_entryType_taskId: { teamAccId: acc.id, entryType: 'reserve', taskId } },
        select: { id: true },
      });
      if (!reserve) return false;
      await tx.teamCreditLedger.create({
        data: { teamAccId: acc.id, entryType: 'release', amount, taskId },
      });
      await tx.teamCreditAccount.update({
        where: { id: acc.id },
        data: { frozenBalance: { decrement: amount } },
      });
      // 回退成员配额（月度 + 总量）
      const meteredConversation = !!consumption?.consumptionStatus || taskId.startsWith('desktop-chat:') || taskId.startsWith('deepseek-chat:');
      await tx.$executeRaw`
        UPDATE "TeamMembership" tm
        SET "creditUsedThisCycle" = CASE
              WHEN ${meteredConversation} AND l."createdAt" < tm."quotaCycleStartAt"
              THEN tm."creditUsedThisCycle"
              ELSE GREATEST(0, tm."creditUsedThisCycle" - ${amount}) END,
            "creditUsedTotal" = GREATEST(0, tm."creditUsedTotal" - ${amount}),
            "updatedAt" = NOW()
        FROM "TeamCreditLedger" l
        WHERE l."taskId" = ${taskId}
          AND l."entryType" = 'reserve'
          AND l."actorUserId" = tm."userId"
          AND tm."teamId" = ${teamId}
      `;
      return true;
    };
    const released = transaction ? await work(transaction) : await this.prisma.$transaction(work);
    // 幂等跳过时不广播，避免误报可用余额回升
    if (!released) return;
    if (taskId && !transaction) {
      await this.prisma.apiUsageRecord
        .updateMany({
          where: {
            id: taskId,
            responseStatus: ApiResponseStatus.PENDING,
          },
          data: {
            responseStatus: ApiResponseStatus.FAILED,
            errorMessage: '任务失败，团队积分预留已释放',
          },
        })
        .catch((e) => this.logger.warn(`团队任务状态关闭失败 taskId=${taskId}: ${e}`));
    }
    if (!transaction) void this.publisher?.publish({
      teamId,
      reason: 'release',
      delta: amount, // frozen -= amount, so availableCredits goes up
      taskId,
    });
  }

  /** Reconcile expired reservations only against confirmed usage failure. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredReserves() {
    const expired = await this.prisma.teamCreditLedger.findMany({
      where: {
        entryType: 'reserve',
        reserveExpiresAt: { lt: new Date() },
      },
      include: { account: { select: { teamId: true } } },
      orderBy: { id: 'asc' },
      ...(this.expiredReserveCursor ? { cursor: { id: this.expiredReserveCursor }, skip: 1 } : {}),
      take: 200,
    });

    this.expiredReserveCursor = expired.length === 200 ? expired[expired.length - 1].id : undefined;
    for (const entry of expired) {
      if (!entry.taskId) continue;
      const usage = await this.prisma.apiUsageRecord.findUnique({
        where: { id: entry.taskId }, select: { responseStatus: true, consumptionStatus: true },
      });
      // Pending/unknown/successful upstream work still owns its reservation.
      if (usage?.consumptionStatus ? usage.consumptionStatus !== 'rejected' : usage?.responseStatus !== ApiResponseStatus.FAILED) continue;
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
