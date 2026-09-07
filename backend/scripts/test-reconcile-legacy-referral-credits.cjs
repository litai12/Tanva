const assert = require('node:assert/strict');
const { planRepair } = require('./reconcile-legacy-referral-credits.cjs');
function fixture(kind = 'lot') {
  return {
    account: { balance: 1150 },
    rewards: [{ id: 'reward', amount: 500, expiredAmount: 350, isExpired: false, creditLotId: null, createdAt: '2026-07-01' }],
    transactions: [
      { id: 'spend', type: 'spend', amount: -600, apiUsageId: 'usage', createdAt: '2026-07-02', metadata: { deductions: [{ kind, ...(kind === 'lot' ? { lotId: 'paid' } : {}), amount: 600 }] } },
      { id: 'decay', type: 'expire', amount: -350, balanceBefore: 1500, balanceAfter: 1150, createdAt: '2026-08-01', metadata: { deductions: [{ kind: 'legacy_referral', transactionId: 'reward', amount: 350 }] } },
    ],
    lots: [{ id: 'paid', sourceType: 'recharge', remainingAmount: 1000, totalAmount: 2000, status: 'active', expiresAt: '2028-01-01' }],
    successfulUsageIds: ['usage'],
  };
}
const paid = planRepair(fixture());
assert.equal(paid.refund, 350);
assert.equal(paid.balanceAfter, 1500);
assert.deepEqual(paid.restoredLots, { paid: 500 });
assert.equal(paid.changes[0].deductions[1].amount, 100);
const legacy = planRepair(fixture('legacy_balance'));
assert.deepEqual(legacy.restoredLots, {});
assert.equal(legacy.changes[0].deductions[0].amount, 500);
const refunded = fixture();
refunded.transactions.push({ type: 'refund', amount: 600, apiUsageId: 'usage' });
assert.throws(() => planRepair(refunded), /Insufficient/);
const adjusted = fixture();
adjusted.transactions.push({ type: 'adjustment', amount: 100, apiUsageId: 'usage' });
assert.throws(() => planRepair(adjusted), /Insufficient/);
const late = fixture();
late.transactions[0].createdAt = '2026-08-02';
assert.throws(() => planRepair(late), /Insufficient/);
const early = fixture();
early.transactions[0].createdAt = '2026-06-01';
assert.throws(() => planRepair(early), /Insufficient/);
const pending = fixture();
pending.successfulUsageIds = [];
assert.throws(() => planRepair(pending), /Insufficient/);
const duplicate = fixture();
duplicate.transactions.push({ ...duplicate.transactions[1] });
assert.throws(() => planRepair(duplicate), /Duplicate/);
const overRestore = fixture();
overRestore.lots[0].totalAmount = 1100;
assert.throws(() => planRepair(overRestore), /exceeds/);
const mismatch = fixture();
mismatch.rewards[0].expiredAmount = 300;
assert.throws(() => planRepair(mismatch));
console.log('Legacy referral repair: allocation, refunds, time bounds, duplication and balance guards passed.');
