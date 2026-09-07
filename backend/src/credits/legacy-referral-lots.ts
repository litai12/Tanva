import type { Prisma } from '@prisma/client';
import { findCreditAccountForUpdate } from './credit-account-lock.util';

/**
 * 将无批次旧奖励从已有 legacy 余额中划分出来，不增加账户余额。
 * 旧流水缺少消费归属，不能证明未用金额；迁移批次只优先消费，不自动衰减。
 * 历史消费归属和衰减返还由证据校验脚本单独处理。
 */
export async function materializeLegacyReferralLots(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<void> {
  const account = await findCreditAccountForUpdate(tx, { id: accountId });
  if (!account) return;
  const rewards = await tx.creditTransaction.findMany({
    where: { accountId, type: 'REFERRAL_REWARD', creditLotId: null, amount: { gt: 0 }, isExpired: false },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!rewards.length) return;
  // 包含尚未清理的到期 active 批次，避免把已有批次余额重复划给邀请奖励。
  const active = await tx.creditLot.aggregate({
    where: { accountId, status: 'active', remainingAmount: { gt: 0 } },
    _sum: { remainingAmount: true },
  });
  let available = Math.max(0, account.balance - (active._sum.remainingAmount ?? 0));
  for (const reward of rewards) {
    const amount = Math.min(available, Math.max(0, reward.amount - reward.expiredAmount));
    const lot = await tx.creditLot.create({
      data: {
        accountId, sourceType: 'gift', validityType: 'permanent', scopeType: 'global',
        totalAmount: reward.amount, remainingAmount: amount,
        status: amount > 0 ? 'active' : 'exhausted',
        grantedAt: reward.createdAt, activeAt: reward.createdAt,
        metadata: {
          grantedBy: 'legacy_referral_migration', legacyReferralUnverified: true,
          originalTransactionId: reward.id, originalExpiredAmount: reward.expiredAmount,
          allocatedFromLegacyBalance: amount,
        },
      },
    });
    await tx.creditTransaction.update({ where: { id: reward.id }, data: { creditLotId: lot.id } });
    available -= amount;
  }
}
