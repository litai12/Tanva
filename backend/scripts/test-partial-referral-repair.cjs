const assert = require('node:assert/strict');
const { planPartialRepair } = require('./plan-partial-referral-repair.cjs');
const reward = (id, date, expired) => ({ id, amount: 500, expiredAmount: expired, creditLotId: null, createdAt: date });
const spend = (id, date, amount) => ({ id, type: 'spend', apiUsageId: id, createdAt: date, amount: -amount, balanceBefore: 10000, balanceAfter: 10000 - amount, metadata: { deductions: [{ kind: 'legacy_balance', amount }] } });
const decay = (id, date, amount, rewardId) => ({ id, type: 'expire', createdAt: date, amount: -amount, balanceBefore: 2000, balanceAfter: 2000 - amount, metadata: { deductions: [{ kind: 'legacy_referral', transactionId: rewardId, amount }] } });
function plan(rewards, transactions) {
  return planPartialRepair({ account: { balance: 1000 }, rewards, transactions, lots: [], successfulUsageIds: transactions.filter(t => t.type === 'spend').map(t => t.id) });
}
let p = plan([reward('r', '2026-07-01', 350)], [spend('s', '2026-07-02', 300), decay('d', '2026-08-01', 350, 'r')]);
assert.equal(p.refund, 150);
assert.equal(p.rewards[0].correctedExpiredAmount, 200);
assert.equal(p.rewards[0].consumedAmount, 300);
// Consumption after earlier lawful decay must reduce subsequent decay eligibility.
p = plan([reward('r', '2026-07-01', 100)], [decay('d1', '2026-07-02', 50, 'r'), spend('s', '2026-07-03', 450), decay('d2', '2026-07-04', 50, 'r')]);
assert.equal(p.refund, 50);
assert.equal(p.rewards[0].correctedExpiredAmount, 50);
// A future grant cannot fund an earlier spend; exclude it from the repair.
p = plan([reward('r1', '2026-07-01', 50), reward('r2', '2026-08-01', 0)], [spend('s', '2026-07-02', 700), decay('d', '2026-07-03', 50, 'r1')]);
assert.deepEqual(p.rewards.map(r => r.id), ['r1']);
assert.equal(p.changes[0].deductions[1].amount, 200);
// No consumption, or refunded consumption, proves no over-decay.
assert.throws(() => plan([reward('r', '2026-07-01', 350)], [decay('d', '2026-08-01', 350, 'r')]), /No proven/);
assert.throws(() => plan([reward('r', '2026-07-01', 350)], [spend('s', '2026-07-02', 300), { type: 'refund', amount: 300, apiUsageId: 's' }, decay('d', '2026-08-01', 350, 'r')]), /No proven/);
// Do not consume a reward after it was legitimately exhausted by decay.
assert.throws(() => plan([reward('r', '2026-07-01', 500)], [decay('d', '2026-07-02', 500, 'r'), spend('s', '2026-08-01', 600)]), /No proven/);
console.log('Partial referral repair: chronology, partial refunds, future rewards and lawful decay preservation passed.');
const paidSpend = spend('paid-spend', '2026-07-02', 500);
paidSpend.metadata.deductions = [{ kind: 'lot', lotId: 'paid', amount: 500 }];
const input = {
  account: { balance: 0 }, rewards: [reward('r', '2026-07-01', 8)],
  transactions: [paidSpend, decay('d', '2026-07-03', 8, 'r'), spend('later', '2026-07-04', 492)],
  lots: [{ id: 'paid', sourceType: 'recharge', scopeType: 'global', status: 'exhausted', totalAmount: 500, remainingAmount: 0, expiresAt: '2028-01-01' }],
  successfulUsageIds: ['paid-spend', 'later'],
};
const later = planPartialRepair(input);
assert.equal(later.refund, 8);
assert.deepEqual(later.restoredLots, { paid: 8 });
assert.deepEqual(later.grossRestoredLots, { paid: 500 });
assert.equal(later.legacyPaidReallocations[0].amount, 492);
assert.equal(later.changes[1].deductions[0].lotId, 'paid');
assert.throws(() => planPartialRepair({ ...input, successfulUsageIds: ['paid-spend'] }), /Restored lots exceed/);
console.log('Later legacy consumption reallocation conserves paid lots and refuses unverified consumption.');
