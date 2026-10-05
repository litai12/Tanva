const assert = require('node:assert/strict');
const { planAudit, proveIsolatedSuffix, validatedDeductions } = require('./audit-legacy-free-credit-sources.cjs');
function fixture(spec) {
  let balance = 0; const txs = spec.map((s, i) => { const row = { id: s.id || `t${i}`, accountId: 'a', type: 'earn', description: '新用户注册赠送积分', expiredAmount: 0, isExpired: false,
    createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), balanceBefore: balance, ...s }; balance += s.amount; return { ...row, balanceAfter: balance }; });
  return { user: { id: 'u' }, account: { id: 'a', userId: 'u', balance, totalEarned: 0, totalSpent: 0 }, transactions: txs, lots: [], orders: [], usages: [], subscriptions: [] };
}
const d = (kind, amount, fields = {}) => ({ kind, amount, ...fields });
const movement = (amount, ds, extra = {}) => ({ type: amount < 0 ? 'spend' : 'refund', amount, apiUsageId: 'api', description: '', ...(ds ? { metadata: { deductions: ds } } : {}), ...extra });
const check = (s, expect) => { const p = planAudit(s, '2026-09-30'); expect(p); return p; };
check(fixture([{ amount: 1000 }, movement(-1000, [d('legacy_balance', 1000)])]), p => {
  assert.equal(p.sources[0].knownUntrackedRemaining, 0); assert.equal(p.repairableGrants[0].lot.status, 'exhausted');
});
check(fixture([{ amount: 500 }, { amount: 500 }, movement(-1000, [d('legacy_balance', 1000)])]), p => {
  assert.deepEqual(p.sources.map(s => s.untrackedRemaining), [{ lower: 0, upper: 0 }, { lower: 0, upper: 0 }]);
});
check(fixture([{ amount: 500 }, { amount: 500 }, movement(-500, [d('legacy_balance', 500)])]), p => {
  assert.deepEqual(p.sources.map(s => s.untrackedRemaining), [{ lower: 0, upper: 500 }, { lower: 0, upper: 500 }]);
  assert.deepEqual(p.sourceBounds.free, { lower: 500, upper: 500, certified: true }); assert.equal(p.repairableGrants.length, 0);
});
check(fixture([{ amount: 500 }, movement(-500, [d('legacy_balance', 500)]), movement(500)]), p => {
  assert.equal(p.sources[0].knownUntrackedRemaining, 500);
});
check(fixture([{ amount: 500 }, movement(-100, [d('legacy_transaction', 100, { transactionId: 't0' })]), movement(100, [d('legacy_transaction', 100, { transactionId: 't0' })])]), p => {
  assert.equal(p.sources[0].knownUntrackedRemaining, 500);
});
check(fixture([{ amount: 50 }, { amount: 50 }, movement(-100, [d('legacy_balance', 100)]), movement(50, [d('legacy_transaction', 50, { transactionId: 't0' })]), movement(50, [d('legacy_transaction', 50, { transactionId: 't0' })])]), p => {
  assert.equal(p.status, 'conflicting_ledger'); assert(p.issues.some(i => i.code === 'refund_deductions_do_not_match_original_debit')); assert.equal(p.repairableGrants.length, 0);
});
let s = fixture([{ amount: 500, creditLotId: 'lot' }, movement(-100, [d('lot', 100, { lotId: 'lot' })])]);
s.lots = [{ id: 'lot', accountId: 'a', sourceType: 'promo', totalAmount: 500, remainingAmount: 400, status: 'active', grantedAt: s.transactions[0].createdAt }];
s.usages = [{ id: 'api', responseStatus: 'failed', creditsUsed: 100 }];
check(s, p => { assert.equal(p.sources[0].remaining.lower, 400); assert.equal(p.issues.filter(i => i.severity === 'conflict').length, 0); });
s = fixture([{ amount: 500 }, { amount: 500, type: 'REFERRAL_REWARD', creditLotId: 'migrated' }, movement(-500, [d('legacy_balance', 500)])]);
s.lots = [{ id: 'migrated', accountId: 'a', sourceType: 'gift', totalAmount: 500, remainingAmount: 500, status: 'active', grantedAt: s.transactions[1].createdAt, createdAt: '2026-01-04', metadata: { originalTransactionId: 't1', allocatedFromLegacyBalance: 500, legacyReferralUnverified: true } }];
check(s, p => { assert(p.issues.some(i => i.code === 'migration_initial_allocation_not_verified_original_source')); assert.equal(p.sources[0].remaining.lower, 0); assert.equal(p.repairableGrants.length, 0); });
// A gap older than a later untouched check-in cannot invalidate its own source.
s = fixture([{ amount: 500 }, movement(-500), { amount: 50, type: 'CHECK_IN' }]);
s.transactions[0].balanceBefore = 10; s.transactions[0].balanceAfter = 510;
check(s, p => { assert.equal(p.independentProofs.length, 1); assert.equal(p.repairableGrants.length, 1); assert.equal(p.repairableGrants[0].lot.remainingAmount, 50); });
// A later anonymous debit blocks the isolated suffix proof.
s = fixture([{ amount: 500 }, { amount: 50, type: 'CHECK_IN' }, movement(-500, [d('legacy_balance', 500)])]);
assert.equal(proveIsolatedSuffix(s).length, 0);
// A later restoration cannot erase a wallet-zero bridge that consumed a
// supposedly untouched source through an overdrawn old lot attribution.
s = fixture([
  { amount: 50, description: '充值', creditLotId: 'old-lot' },
  movement(-50, [d('lot', 50, { lotId: 'old-lot' })], { apiUsageId: 'first' }),
  { amount: 50, type: 'CHECK_IN' },
  movement(-50, [d('lot', 50, { lotId: 'old-lot' })], { apiUsageId: 'second' }),
  { amount: 50, description: 'unidentified restoration' },
]);
s.lots = [{ id: 'old-lot', accountId: 'a', sourceType: 'recharge', totalAmount: 50, remainingAmount: 0, status: 'exhausted', grantedAt: s.transactions[0].createdAt }];
assert.equal(proveIsolatedSuffix(s).filter(p => p.kind === 'daily_reward').length, 0);
// Positive partial refund without source metadata may not be proportionally
// attributed to the original explicit deductions.
s = fixture([{ amount: 500 }, { amount: 500 }, movement(-100, [d('legacy_transaction', 100, { transactionId: 't0' })]), movement(50)]);
check(s, p => assert(p.issues.some(i => i.code === 'wallet_refund_has_no_source_deductions')));
const backupHash = 'a'.repeat(64), original = [d('lot', 500, { lotId: 'paid' })], corrected = [d('legacy_referral', 500, { transactionId: 'r' })];
let txn = { id: 's', accountId: 'a', type: 'spend', amount: -500, metadata: { deductions: corrected, referralPriorityAudit: { version: 'referral-priority-audit-v3', backupHash, originalDeductions: original, correctedDeductions: corrected } } };
const marker = { amount: 0, metadata: { reconciliation: 'referral-priority-audit-v3', backupHash } }, issues = [];
assert.deepEqual(validatedDeductions(txn, new Map([['referral-priority-audit-v3:a', marker]]), (...args) => issues.push(args)), corrected);
assert.equal(issues.length, 0);
txn = { ...txn, type: 'expire', metadata: { ...txn.metadata, deductions: original } };
assert.deepEqual(validatedDeductions(txn, new Map([['referral-priority-audit-v3:a', marker]]), (...args) => issues.push(args)), corrected);
assert.equal(issues.length, 0);
// Certified historical corrections can refer to a lot created after the spend.
// Excess expiry stays in financial history and is netted against its marker.
s = fixture([
  { id: 'r', amount: 500, type: 'REFERRAL_REWARD', creditLotId: 'r-lot' },
  { id: 'paid', amount: 500, description: '充值', creditLotId: 'paid-lot', orderId: 'order' },
  movement(-500, [d('lot', 500, { lotId: 'r-lot' })], { id: 'spent' }),
  movement(-100, [d('lot', 100, { lotId: 'r-lot' })], { id: 'expired', type: 'expire', apiUsageId: null }),
  { id: 'referral-priority-audit-v3:a', amount: 100, type: 'admin_adjust', metadata: { reconciliation: 'referral-priority-audit-v3', backupHash, decayRefunds: [{ transactionId: 'expired', rewardId: 'r', amount: 100 }] } },
]);
s.transactions[2].metadata.referralPriorityAudit = { version: 'referral-priority-audit-v3', backupHash,
  originalDeductions: [d('lot', 500, { lotId: 'paid-lot' })], correctedDeductions: [d('lot', 500, { lotId: 'r-lot' })] };
s.transactions[3].metadata.referralPriorityAudit = { version: 'referral-priority-audit-v3', backupHash,
  originalDeductions: [d('lot', 100, { lotId: 'r-lot' })], correctedDeductions: [] };
s.lots = [
  { id: 'r-lot', accountId: 'a', sourceType: 'gift', totalAmount: 500, remainingAmount: 0, status: 'exhausted', grantedAt: s.transactions[0].createdAt, createdAt: '2026-09-01', metadata: {
    originalTransactionId: 'r', allocatedFromLegacyBalance: 0, legacyReferralUnverified: false, referralPriorityAudit: 'referral-priority-audit-v3', backupHash } },
  { id: 'paid-lot', accountId: 'a', sourceType: 'recharge', totalAmount: 500, remainingAmount: 500, status: 'active', grantedAt: s.transactions[1].createdAt, orderId: 'order' },
];
s.orders = [{ id: 'order', credits: 500, amount: 1, orderType: 'recharge', userId: 'u', status: 'paid', paidAt: '2026-01-02' }];
check(s, p => {
  assert.equal(p.issues.filter(i => i.severity === 'conflict').length, 0);
  assert.deepEqual(p.sources.find(source => source.transactionId === 'r').remaining, { lower: 0, upper: 0 });
  assert.equal(p.sources.find(source => source.transactionId === 'paid').remaining.lower, 500);
});
// Exercise the conservative outer bounds against recorded anonymous allocations.
// The chosen hidden allocation is used only by this oracle, never by the planner.
let seed = 91731;
const random = max => { seed = (seed * 16807) % 2147483647; return seed % max; };
for (let run = 0; run < 50; run++) {
  const actual = [500, 500, 500], spec = [{ amount: 500 }, { amount: 500 }, { amount: 500 }], history = [];
  for (let step = 0; step < 12; step++) {
    const choices = history.filter(h => h.remaining.some(n => n > 0));
    if (choices.length && random(3) === 0) {
      const h = choices[random(choices.length)], limit = h.remaining.reduce((a, b) => a + b, 0), amount = 1 + random(limit);
      let left = amount;
      for (let index = 0; index < 3 && left; index++) { const n = Math.min(left, h.remaining[index]); h.remaining[index] -= n; actual[index] += n; left -= n; }
      spec.push(movement(amount, [d('legacy_balance', amount)], { apiUsageId: h.id }));
    } else {
      const balance = actual.reduce((a, b) => a + b, 0); if (!balance) continue;
      const amount = 1 + random(Math.min(balance, 200)), id = `api-${run}-${step}`, taken = [0, 0, 0]; let left = amount;
      const order = random(2) ? [0, 1, 2] : [2, 1, 0];
      for (const index of order) { const n = Math.min(left, actual[index]); actual[index] -= n; taken[index] += n; left -= n; }
      history.push({ id, remaining: taken }); spec.push(movement(-amount, [d('legacy_balance', amount)], { apiUsageId: id }));
    }
  }
  const report = planAudit(fixture(spec), '2030-01-01');
  assert.equal(report.issues.filter(i => i.severity === 'conflict').length, 0, `False conflict in randomized run ${run}`);
  report.sources.slice(0, 3).forEach((source, index) => assert(actual[index] >= source.remaining.lower && actual[index] <= source.remaining.upper,
    `True source allocation escaped conservative range: run ${run}, source ${index}`));
}
console.log('Historical source audit tests passed');
