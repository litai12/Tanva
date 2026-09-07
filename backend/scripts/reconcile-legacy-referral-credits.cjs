// Narrow, evidence-based repair: only rewards fully covered by settled consumption
// after the last reward and before the first decay can be reconciled.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPAIR = 'legacy-referral-consumption-v1';
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const lotIdFor = id => `${REPAIR}:${id}`;

function planRepair({ account, rewards, transactions, lots, successfulUsageIds }) {
  assert(rewards.length > 0, 'No unbatched referral rewards');
  assert(rewards.every(r => r.amount > 0 && !r.creditLotId && !r.isExpired));
  const rewardIds = new Set(rewards.map(r => r.id));
  const decays = transactions.filter(t => t.type === 'expire' &&
    (t.metadata?.deductions || []).some(d => rewardIds.has(d.transactionId)));
  assert(decays.length > 0, 'No evidenced referral decay');
  const decayKeys = new Set();
  for (const t of decays) {
    const ds = t.metadata.deductions;
    assert(ds.every(d => d.kind === 'legacy_referral' && rewardIds.has(d.transactionId)), 'Mixed decay needs manual audit');
    assert.equal(ds.reduce((s, d) => s + d.amount, 0), -t.amount);
    assert.equal(t.balanceBefore + t.amount, t.balanceAfter);
    const key = `${new Date(t.createdAt).toISOString().slice(0, 10)}:${t.balanceBefore}:${t.balanceAfter}`;
    assert(!decayKeys.has(key), 'Duplicate decay needs manual audit');
    decayKeys.add(key);
  }
  for (const r of rewards) {
    assert.equal(decays.flatMap(t => t.metadata.deductions)
      .filter(d => d.transactionId === r.id).reduce((s, d) => s + d.amount, 0), r.expiredAmount);
  }
  const start = Math.max(...rewards.map(r => +new Date(r.createdAt)));
  const end = Math.min(...decays.map(t => +new Date(t.createdAt)));
  const refunded = new Set(transactions.filter(t => t.apiUsageId && t.amount > 0).map(t => t.apiUsageId));
  const byLot = new Map(lots.map(l => [l.id, l]));
  const queue = rewards.map(r => ({ id: r.id, remaining: r.amount }));
  const changes = [];
  const restoredLots = {};
  for (const t of transactions) {
    if (!queue.some(r => r.remaining)) break;
    if (t.type !== 'spend' || +new Date(t.createdAt) < start || +new Date(t.createdAt) >= end ||
        !successfulUsageIds.includes(t.apiUsageId) || refunded.has(t.apiUsageId)) continue;
    const original = t.metadata?.deductions;
    if (!Array.isArray(original)) continue;
    assert.equal(original.reduce((s, d) => s + d.amount, 0), -t.amount);
    const deductions = [];
    let changed = false;
    for (const d of original) {
      let remaining = d.amount;
      const source = byLot.get(d.lotId);
      const eligible = d.kind === 'legacy_balance' || (d.kind === 'lot' && source?.sourceType === 'recharge' &&
        (!source.expiresAt || +new Date(source.expiresAt) > Date.now()));
      if (eligible) for (const r of queue) {
        const amount = Math.min(remaining, r.remaining);
        if (amount <= 0) continue;
        deductions.push({ kind: 'lot', lotId: lotIdFor(r.id), amount });
        if (source) restoredLots[source.id] = (restoredLots[source.id] || 0) + amount;
        remaining -= amount;
        r.remaining -= amount;
        changed = true;
      }
      if (remaining) deductions.push({ ...d, amount: remaining });
    }
    if (changed) changes.push({ transaction: t, deductions });
  }
  assert(queue.every(r => r.remaining === 0), 'Insufficient settled consumption before decay; refusing partial repair');
  for (const [id, amount] of Object.entries(restoredLots)) {
    const l = byLot.get(id);
    assert(l.remainingAmount + amount <= l.totalAmount, 'Recharge restoration exceeds original grant');
  }
  const refund = -decays.reduce((s, t) => s + t.amount, 0);
  const restored = Object.values(restoredLots).reduce((s, n) => s + n, 0);
  const active = lots.filter(l => l.status === 'active').reduce((s, l) => s + l.remainingAmount, 0);
  assert(account.balance + refund >= active + restored, 'Restored lots exceed account balance');
  return { account, rewards, decays, changes, restoredLots, refund,
    originalLots: lots.filter(l => restoredLots[l.id]), balanceAfter: account.balance + refund };
}

async function applyPlan(tx, plan, hash) {
        for (const r of plan.rewards) {
          await tx.creditLot.create({ data: { id: lotIdFor(r.id), accountId: plan.account.id, sourceType: 'gift', validityType: 'permanent', scopeType: 'global', totalAmount: r.amount, remainingAmount: 0, status: 'exhausted', grantedAt: r.createdAt, activeAt: r.createdAt, metadata: { grantedBy: 'referral_reward', reconciliation: REPAIR, originalTransactionId: r.id, consumedBeforeDecay: true, consumedAmount: r.consumedAmount ?? r.amount, lawfulExpiredAmount: r.correctedExpiredAmount ?? 0 } } });
          await tx.creditTransaction.update({ where: { id: r.id }, data: { creditLotId: lotIdFor(r.id), expiredAmount: r.correctedExpiredAmount ?? 0, isExpired: false, metadata: { ...(r.metadata || {}), reconciliation: REPAIR, reversedExpiredAmount: r.expiredAmount - (r.correctedExpiredAmount ?? 0) } } });
        }
        for (const c of plan.changes) {
          await tx.creditTransaction.update({ where: { id: c.transaction.id }, data: { metadata: { ...c.transaction.metadata, deductions: c.deductions, reconciliation: REPAIR, originalDeductions: c.transaction.metadata.deductions } } });
        }
        for (const [id, amount] of Object.entries(plan.restoredLots)) {
          if (amount <= 0) continue;
          await tx.creditLot.update({ where: { id }, data: { remainingAmount: { increment: amount }, status: 'active' } });
        }
        await tx.creditAccount.update({ where: { id: plan.account.id }, data: { balance: { increment: plan.refund } } });
        await tx.creditTransaction.create({ data: { id: plan.marker, accountId: plan.account.id, type: 'admin_adjust', businessType: 'credit_reconciliation', amount: plan.refund, balanceBefore: plan.account.balance, balanceAfter: plan.balanceAfter, description: '历史邀请奖励优先消费矫正，返还误衰减积分', metadata: { reconciliation: REPAIR, backupHash: hash, refundedDecayIds: plan.decays.map(d => d.id), reassignedSpendIds: plan.changes.map(c => c.transaction.id), rewardIds: plan.rewards.map(r => r.id), restoredLots: plan.restoredLots, preserveEarnedAndSpentCounters: true, algorithm: plan.algorithm || 'full-consumption-before-decay', decayRefunds: plan.decayRefunds || [], legacyPaidReallocations: plan.legacyPaidReallocations || [], grossRestoredLots: plan.grossRestoredLots || plan.restoredLots } } });
}

async function main() {
  require('dotenv').config({ quiet: true });
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  const args = process.argv.slice(2);
  const phones = args.filter(a => /^1\d{10}$/.test(a));
  assert(phones.length > 0 && new Set(phones).size === phones.length, 'Provide unique phone numbers');
  const apply = args.includes('--apply');
  const expected = args.find(a => a.startsWith('--expected='))?.slice(11);
  try {
    await p.$transaction(async tx => {
      const plans = [];
      for (const phone of [...phones].sort()) {
        const user = await tx.user.findUniqueOrThrow({ where: { phone }, select: { id: true } });
        const [account] = await tx.$queryRaw`SELECT * FROM "CreditAccount" WHERE "userId" = ${user.id} FOR UPDATE`;
        assert(account, 'Missing account');
        const marker = `${REPAIR}:${account.id}`;
        if (await tx.creditTransaction.findUnique({ where: { id: marker } })) {
          console.log(JSON.stringify({ phone, status: 'already_reconciled' }));
          continue;
        }
        const transactions = await tx.creditTransaction.findMany({ where: { accountId: account.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        const rewards = transactions.filter(t => t.type === 'REFERRAL_REWARD' && !t.creditLotId && !t.isExpired && t.amount > 0);
        const lots = await tx.creditLot.findMany({ where: { accountId: account.id }, orderBy: { id: 'asc' } });
        const usage = await tx.apiUsageRecord.findMany({ where: { id: { in: transactions.map(t => t.apiUsageId).filter(Boolean) }, responseStatus: 'success' }, select: { id: true } });
        plans.push({ phone, marker, ...planRepair({ account, rewards, transactions, lots, successfulUsageIds: usage.map(u => u.id) }) });
      }
      if (!plans.length) return;
      const hash = digest(plans);
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry_run', hash, plans: plans.map(p => ({ phone: p.phone, balanceBefore: p.account.balance, balanceAfter: p.balanceAfter, refund: p.refund, settledReferralCredits: p.rewards.reduce((s, r) => s + r.amount, 0), reassignedSpends: p.changes.length, restoredLots: p.restoredLots })) }, null, 2));
      if (!apply) return;
      assert.equal(expected, hash, 'Dry-run fingerprint changed; review a new dry run');
      const backupDir = path.resolve(process.env.CREDIT_REPAIR_BACKUP_DIR || './credit-repair-backups');
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      const backup = path.join(backupDir, `${REPAIR}-${hash}.json`);
      fs.writeFileSync(backup, JSON.stringify({ hash, plans }, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ backup }));
      for (const plan of plans) {
        await applyPlan(tx, plan, hash);
      }
      console.log('Reconciliation writes completed; committing transaction.');
    }, { isolationLevel: 'Serializable', timeout: 60000 });
  } finally { await p.$disconnect(); }
}

module.exports = { planRepair, applyPlan };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
