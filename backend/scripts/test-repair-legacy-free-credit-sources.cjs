const assert = require('node:assert/strict');
const { planRepair, applyPlan, applyOne, digest, lotIdFor, markerFor, REPAIR, dailyRewardExpiresAt } =
  require('./repair-legacy-free-credit-sources.cjs');

process.env.TZ = 'Asia/Shanghai';
const NOW = new Date('2026-09-30T06:00:00+08:00');
const clone = value => structuredClone(value);
function fixture() {
  const snapshot = { user: { id: 'user', phone: '13400577887', vipEntitlementWhitelist: false },
    account: { id: 'account', userId: 'user', balance: 0, totalEarned: 0, totalSpent: 0 },
    transactions: [], lots: [], orders: [], subscriptions: [], usages: [], policy: null };
  function add(id, type, amount, extra = {}) {
    const balanceBefore = snapshot.account.balance;
    snapshot.account.balance += amount;
    if (amount > 0) snapshot.account.totalEarned += amount;
    const transaction = { id, accountId: 'account', type, amount, balanceBefore,
      balanceAfter: snapshot.account.balance, description: '', expiredAmount: 0, isExpired: false,
      creditLotId: null, metadata: null, createdAt: amount > 0 ? '2026-07-01T10:00:00+08:00' : '2026-08-01T10:00:00+08:00', ...extra };
    snapshot.transactions.push(transaction); return transaction;
  }
  add('signup', 'earn', 500, { description: '新用户注册赠送积分' });
  add('check1', 'CHECK_IN', 50); add('check2', 'CHECK_IN', 50);
  add('paid', 'earn', 48000, { description: '充值', metadata: { orderNo: 'order-id' } });
  snapshot.orders.push({ id: 'order-id', orderNo: 'PAY001', userId: 'user', credits: 48000,
    amount: '480.00', status: 'paid', orderType: 'recharge', teamId: null,
    membershipPlanId: null, subscriptionId: null, paidAt: '2026-07-01T09:00:00+08:00' });
  add('quota', 'earn', 2100, { creditLotId: 'quota-lot' });
  add('referral', 'REFERRAL_REWARD', 500, { creditLotId: 'ref-lot', expiredAmount: 150 });
  snapshot.lots.push({ id: 'quota-lot', accountId: 'account', sourceType: 'subscription',
    totalAmount: 2100, remainingAmount: 0, status: 'expired' },
  { id: 'ref-lot', accountId: 'account', sourceType: 'gift', totalAmount: 500,
    remainingAmount: 0, status: 'exhausted' });
  add('quota-expire', 'expire', -2100, { creditLotId: 'quota-lot' });
  const backupHash = 'a'.repeat(64);
  for (let i = 0; i < 3; i++) {
    const original = [{ kind: 'legacy_referral', transactionId: 'referral', amount: 50 }];
    add(`audit-expire-${i}`, 'expire', -50, { metadata: { deductions: original,
      referralPriorityAudit: { version: 'referral-priority-audit-v3', backupHash,
        originalDeductions: original, correctedDeductions: [{ kind: 'lot', lotId: 'ref-lot', amount: 50 }] } } });
  }
  add('gift-expire', 'expire', -350, { metadata: { deductions: [{ lotId: 'ref-lot', amount: 350 }] } });
  add('referral-priority-audit-v3:account', 'admin_adjust', 0, {
    metadata: { reconciliation: 'referral-priority-audit-v3', backupHash } });
  return snapshot;
}
const base = fixture();
const plan = planRepair(base, NOW);
assert.equal(base.account.balance, 48600); assert.equal(base.account.totalEarned, 51200);
assert.equal(plan.status, 'planned'); assert.equal(plan.balanceAfter, 48600);
assert.deepEqual(plan.grants.map(grant => [grant.lot.sourceType, grant.lot.remainingAmount]),
  [['promo', 500], ['gift', 50], ['gift', 50], ['recharge', 48000]]);
assert(plan.grants.filter(grant => grant.lot.metadata.reason === 'daily_reward')
  .every(grant => grant.lot.priority === -200 && grant.lot.validityType === 'fixed_window'));
assert.equal(dailyRewardExpiresAt('2026-09-30T02:59:59+08:00'), '2026-09-29T19:00:00.000Z');
assert.equal(dailyRewardExpiresAt('2026-09-30T03:00:00+08:00'), '2026-09-30T19:00:00.000Z');
assert.equal(digest(base), digest(clone(base)), 'Pure planner must not mutate evidence');

function reject(mutate, pattern) { const input = fixture(); mutate(input); assert.throws(() => planRepair(input, NOW), pattern); }
reject(input => { input.account.totalSpent = 10; }, /Consumption/);
reject(input => { input.usages.push({ creditsUsed: 1 }); }, /Charged API/);
for (const type of ['spend', 'refund', 'adjustment', 'CONSUME'])
  reject(input => { input.transactions[0].type = type; }, /Consumption\/refund/);
reject(input => { input.transactions[0].apiUsageId = 'usage'; }, /Consumption\/refund/);
reject(input => { input.transactions[0].type = 'admin_adjust'; }, /admin adjustment/);
reject(input => { input.account.balance++; }, /Ledger does not close/);
reject(input => { input.account.totalEarned++; }, /totalEarned/);
reject(input => { input.transactions[0].balanceAfter++; }, /Broken transaction balance/);
reject(input => { input.transactions[0].description = '运营赠送'; }, /Unsupported orphan/);
reject(input => { input.transactions[0].expiredAmount = 500; }, /Orphan expiry not explained/);
reject(input => { input.transactions[0].isExpired = true; }, /isExpired\/expiredAmount mismatch/);
reject(input => { input.transactions[0].expiredAmount = 501; }, /Expiry exceeds/);
reject(input => { input.lots[0].remainingAmount = 1; }, /Inactive lot/);
reject(input => { input.lots[0].accountId = 'other'; }, /Foreign lot/);
reject(input => { input.lots[0].totalAmount++; }, /exact original grant/);
reject(input => { input.transactions[1].creditLotId = 'ref-lot'; }, /one original positive grant|Multiple positive grants/);
reject(input => { input.transactions.find(transaction => transaction.id === 'quota-expire').creditLotId = null; }, /Unattributed expiry/);
reject(input => { input.transactions.find(transaction => transaction.id === 'quota-expire').createdAt = '2020-01-01'; }, /predates/);
reject(input => { input.transactions.find(transaction => transaction.id === 'gift-expire').metadata.deductions[0].amount--; }, /deductions mismatch/);
reject(input => { input.transactions.find(transaction => transaction.id === 'gift-expire').metadata.deductions[0].lotId = 'missing'; }, /Unattributed expiry/);
reject(input => { input.transactions.find(transaction => transaction.id === 'audit-expire-0').metadata.referralPriorityAudit.version = 'unknown'; }, /Unverified prior/);
reject(input => { input.transactions.find(transaction => transaction.id === 'audit-expire-0').metadata.referralPriorityAudit.backupHash = 'wrong'; }, /Unverified prior/);
reject(input => { input.transactions.find(transaction => transaction.id === 'audit-expire-0').metadata.referralPriorityAudit.originalDeductions = []; }, /original evidence mismatch/);
reject(input => { input.transactions.find(transaction => transaction.id === 'audit-expire-0').metadata.referralPriorityAudit.correctedDeductions[0].amount--; }, /deductions mismatch/);
reject(input => { input.orders[0].status = 'pending'; }, /paid personal/);
reject(input => { input.orders[0].teamId = 'team'; }, /paid personal/);
reject(input => { input.orders[0].credits--; }, /credits mismatch/);
reject(input => { input.orders.push({ ...input.orders[0], id: 'other' }); input.transactions[3].metadata.orderId = 'other'; }, /unique paid/);
reject(input => { input.transactions[0].description = '充值'; input.transactions[0].metadata = { orderNo: 'order-id' };
  input.orders[0].credits = 500; input.transactions[3].amount = 500; }, /Broken transaction balance|credits mismatch|Duplicate recharge/);
reject(input => { input.lots[0].orderId = 'order-id'; }, /already has a lot/);

const vip = fixture(); vip.user.vipEntitlementWhitelist = true;
assert(planRepair(vip, NOW).grants.filter(grant => grant.lot.metadata.reason === 'daily_reward')
  .every(grant => grant.lot.validityType === 'permanent' && grant.lot.expiresAt === null));
const member = fixture(); member.subscriptions.push({ status: 'active', currentPeriodStartAt: '2026-09-01', currentPeriodEndAt: '2026-10-01' });
assert.equal(planRepair(member, NOW).activeVip, true);

const invited = fixture();
invited.transactions[1].type = 'earn'; invited.transactions[1].amount = 500;
invited.transactions[1].description = '被邀请注册额外赠送积分'; invited.transactions[1].metadata = { inviterUserId: 'inviter' };
// Rebuild arithmetic to keep the altered ledger exact.
let running = 0;
for (const transaction of invited.transactions) { transaction.balanceBefore = running; running += transaction.amount; transaction.balanceAfter = running; }
invited.account.balance = running; invited.account.totalEarned += 450;
const invitedPlan = planRepair(invited, NOW);
assert.equal(invitedPlan.grants[1].lot.sourceType, 'gift');
assert.equal(invitedPlan.grants[1].lot.metadata.grantedBy, 'legacy_invitee_registration');
delete invited.transactions[1].metadata.inviterUserId;
assert.throws(() => planRepair(invited, NOW), /Unsupported orphan/);

async function testApply() {
  const state = fixture();
  const accountBefore = clone(state.account);
  const tx = {
    $queryRaw: async () => [],
    user: { findUniqueOrThrow: async () => state.user },
    creditAccount: { findUnique: async () => state.account, findUniqueOrThrow: async () => state.account },
    creditLot: { findMany: async () => state.lots,
      create: async ({ data }) => { assert(!state.lots.some(lot => lot.id === data.id)); state.lots.push(data); } },
    creditTransaction: { findMany: async () => state.transactions,
      updateMany: async ({ where, data }) => { const transaction = state.transactions.find(item => item.id === where.id && item.creditLotId === null);
        if (!transaction) return { count: 0 }; Object.assign(transaction, data); return { count: 1 }; },
      create: async ({ data }) => { assert.equal(data.amount, 0); state.transactions.push(data); } },
    paymentOrder: { findMany: async () => state.orders }, apiUsageRecord: { findMany: async () => state.usages },
    userMembershipSubscription: { findMany: async () => state.subscriptions }, systemSetting: { findUnique: async () => state.policy },
  };
  const expected = clone(state);
  const applied = await applyOne(tx, expected, { previewHash: 'preview', now: NOW });
  assert.equal(applied.status, 'planned'); assert.deepEqual(state.account, accountBefore);
  assert.equal(state.lots.length, 6); assert.equal(state.transactions.filter(transaction => transaction.id === markerFor('account')).length, 1);
  assert.equal(state.transactions[1].type, 'CHECK_IN', 'Historical type preserved');
  assert.equal(state.transactions[1].creditLotId, lotIdFor('check1'));
  assert.equal(state.transactions[1].expiredAmount, 0, 'Source repair does not run cleanup');
  state.account.totalSpent = 1; state.account.balance--; state.usages.push({ id: 'new', creditsUsed: 1 });
  assert.equal((await applyOne(tx, expected, { previewHash: 'preview', now: NOW })).status, 'already_repaired');
  await assert.rejects(() => applyOne(tx, expected, { previewHash: 'different', now: NOW }), /different preview/);
  state.transactions[1].creditLotId = null;
  assert.throws(() => planRepair(state, NOW), /Incomplete previous repair/);

  const changed = fixture(); changed.policy = { value: 'changed' };
  tx.user.findUniqueOrThrow = async () => changed.user; tx.creditAccount.findUnique = async () => changed.account;
  tx.creditTransaction.findMany = async () => changed.transactions; tx.creditLot.findMany = async () => changed.lots;
  tx.paymentOrder.findMany = async () => changed.orders; tx.apiUsageRecord.findMany = async () => changed.usages;
  tx.userMembershipSubscription.findMany = async () => changed.subscriptions; tx.systemSetting.findUnique = async () => changed.policy;
  await assert.rejects(() => applyOne(tx, expected, { previewHash: 'preview', now: NOW }), /Snapshot changed/);
  const failedLink = fixture();
  await assert.rejects(() => applyPlan({ ...tx, creditLot: { create: async () => {} },
    creditTransaction: { updateMany: async () => ({ count: 0 }) } }, failedLink, planRepair(failedLink, NOW), 'preview'), /changed during repair/);
}
testApply().then(() => console.log('Legacy free source repair: ledger evidence, expiry attribution, paid orders, VIP, account lock fingerprint and idempotency passed.'))
  .catch(error => { console.error(error); process.exitCode = 1; });
