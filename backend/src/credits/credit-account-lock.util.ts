import { Prisma } from '@prisma/client';
import type { CreditAccount } from '@prisma/client';

/**
 * 锁定并读取积分账户（SELECT ... FOR UPDATE + findUnique）。
 *
 * 所有「事务内先读账户、再基于读到的余额写回」的路径必须用本原语替代裸
 * findUnique：把同一账户的并发变更串行化。否则并发事务各自读到同一余额，
 * 互相覆盖对方的扣减/退款（流水 balanceAfter 重复、余额丢失更新），且各类
 * 先查后插的幂等查重在并发下互相不可见会全部放行
 * （2026-07-17 线上同一节点同秒 5 次 -600 预扣事故的后端根因）。
 *
 * - 同一事务内对同一行重复加锁是无害的空操作；
 * - 行不存在时锁不到任何行，返回 null（create-if-missing 分支由唯一约束兜底）；
 * - 全部调用方都先锁同一行再做后续操作，锁序一致，无死锁风险。
 */
export async function findCreditAccountForUpdate(
  tx: Prisma.TransactionClient,
  where: { userId: string } | { id: string },
): Promise<CreditAccount | null> {
  if ('userId' in where) {
    await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE "userId" = ${where.userId} FOR UPDATE`;
    return tx.creditAccount.findUnique({ where: { userId: where.userId } });
  }
  await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE "id" = ${where.id} FOR UPDATE`;
  return tx.creditAccount.findUnique({ where: { id: where.id } });
}
