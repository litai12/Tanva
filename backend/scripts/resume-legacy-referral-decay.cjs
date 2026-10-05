// Resume today's decay through the production service; never replay past days.
// Usage: node scripts/resume-legacy-referral-decay.cjs preview|apply PRIVATE_DIR
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dayKey = now => `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
const wrap = (target, overrides) => new Proxy(target, { get(obj, key) {
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
  const value = obj[key];
  return typeof value === 'function' ? value.bind(obj) : value;
} });

async function snapshot(tx, accountId) {
  const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: accountId } });
  return {
    account,
    user: await tx.user.findUniqueOrThrow({ where: { id: account.userId }, select: { id: true, vipEntitlementWhitelist: true } }),
    subscriptions: await tx.userMembershipSubscription.findMany({ where: { userId: account.userId }, orderBy: { id: 'asc' } }),
    paidOrderCount: await tx.paymentOrder.count({ where: { userId: account.userId, status: 'paid' } }),
    lots: await tx.creditLot.findMany({ where: { accountId }, orderBy: { id: 'asc' } }),
    transactions: await tx.creditTransaction.findMany({ where: { accountId }, orderBy: { id: 'asc' } }),
    policy: await tx.systemSetting.findUnique({ where: { key: 'membership_credit_policy' }, select: { value: true } }),
  };
}

async function main() {
  const [mode, rawDir] = process.argv.slice(2);
  assert(['preview', 'apply'].includes(mode) && rawDir, 'Usage: preview|apply PRIVATE_DIR');
  const dir = path.resolve(rawDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  require('dotenv').config({ quiet: true });
  const { PrismaClient } = require('@prisma/client');
  const { MembershipService } = require('../dist/membership/membership.service');
  const { BusinessPolicyService } = require('../dist/business-policy/business-policy.service');
  const { isFreeCreditDecayLot } = require('../dist/credits/free-credit-decay-policy');
  assert(isFreeCreditDecayLot({ sourceType: 'gift', validityType: 'permanent', metadata: { legacyReferralUnverified: true } }), 'Deploy updated decay policy first');
  const serviceHash = hash(fs.readFileSync(path.join(__dirname, '../dist/membership/membership.service.js'), 'utf8'));
  const policyHash = hash(fs.readFileSync(path.join(__dirname, '../dist/credits/free-credit-decay-policy.js'), 'utf8'));
  const db = new PrismaClient();
  const now = new Date();
  const results = [];
  try {
    const preview = mode === 'apply' ? JSON.parse(fs.readFileSync(path.join(dir, 'preview.json'), 'utf8')) : null;
    if (preview) {
      assert.equal(preview.day, dayKey(now), 'Preview must be from today');
      assert.equal(preview.serviceHash, serviceHash, 'Service changed since preview');
      assert.equal(preview.policyHash, policyHash, 'Policy changed since preview');
    }
    const candidates = preview ? preview.results.filter(r => r.status === 'preview' && r.result.decayedCredits > 0).map(r => r.accountId)
      : (await db.creditLot.findMany({ where: { sourceType: 'gift', status: 'active', remainingAmount: { gt: 0 }, metadata: { path: ['legacyReferralUnverified'], equals: true } }, distinct: ['accountId'], select: { accountId: true }, orderBy: { accountId: 'asc' } })).map(r => r.accountId);
    assert.equal(new Set(candidates).size, candidates.length, 'Duplicate account IDs in preview');
    for (const accountId of candidates) {
      let rolledBack;
      const rollback = new Error('PREVIEW_ROLLBACK');
      try {
        const row = await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE id = ${accountId} FOR UPDATE`;
          assert.equal(dayKey(new Date()), dayKey(now), 'Business date changed; rerun preview');
          const before = await snapshot(tx, accountId);
          assert(before.lots.some(lot => lot.sourceType === 'gift' && lot.status === 'active'
            && lot.remainingAmount > 0 && lot.metadata?.legacyReferralUnverified === true),
          'Account is outside the active unverified gift scope');
          const beforeHash = hash(before);
          const expected = preview?.results.find(r => r.accountId === accountId);
          if (expected) assert.equal(beforeHash, expected.beforeHash, 'Account changed since preview; rescan required');
          let backup;
          if (mode === 'apply') {
            backup = path.join(dir, `before-${accountId}-${Date.now()}.json`);
            write(backup, { at: now.toISOString(), beforeHash, before });
          }
          // Keep every service operation in this one locked transaction, scoped to one account.
          const scoped = wrap(tx, {
            creditAccount: wrap(tx.creditAccount, { findMany: args => tx.creditAccount.findMany({ ...args, where: { AND: [args.where || {}, { id: accountId }] } }) }),
            creditLot: wrap(tx.creditLot, { updateMany: args => tx.creditLot.updateMany({ ...args, where: { AND: [args.where || {}, { accountId }] } }) }),
            $transaction: fn => fn(tx),
          });
          const service = new MembershipService(scoped, new BusinessPolicyService(scoped));
          const result = await service.decayDailyGiftCredits(now);
          const after = await snapshot(tx, accountId);
          const limit = (await new BusinessPolicyService(scoped).getMembershipCreditPolicy()).dailyGiftDecayCredits;
          assert(result.decayedCredits >= 0 && result.decayedCredits <= limit);
          assert.equal(after.account.balance, before.account.balance - result.decayedCredits);
          assert.equal(after.account.totalEarned, before.account.totalEarned);
          assert.equal(after.account.totalSpent, before.account.totalSpent);
          const oldIds = new Set(before.transactions.map(t => t.id));
          const created = after.transactions.filter(t => !oldIds.has(t.id));
          assert.equal(created.length, result.decayedCredits > 0 ? 1 : 0);
          assert(created.every(t => t.businessType === 'free_credit_decay' && t.amount === -result.decayedCredits));
          const existingLots = new Map(before.lots.map(l => [l.id, l]));
          for (const lot of after.lots) {
            const old = existingLots.get(lot.id);
            if (old?.metadata?.legacyReferralUnverified === true) assert.equal(lot.metadata?.legacyReferralUnverified, true);
            if (old && !isFreeCreditDecayLot(old)) assert.equal(lot.remainingAmount, old.remainingAmount, 'Protected lot changed');
          }
          // A repeat through the exact same service must be a no-op on the same day.
          assert.equal((await service.decayDailyGiftCredits(now)).decayedCredits, 0);
          const receipt = { accountId, status: mode === 'apply' ? 'applied' : 'preview', beforeHash, before: before.account.balance, after: after.account.balance, result, transactionIds: created.map(t => t.id), backup };
          if (expected) {
            assert.deepEqual(result, expected.result, 'Result changed since preview');
            assert.equal(receipt.after, expected.after);
          }
          if (mode === 'preview') { rolledBack = receipt; throw rollback; }
          return receipt;
        }, { timeout: 30000 });
        results.push(row);
        write(path.join(dir, `receipt-${accountId}-${Date.now()}.json`), row);
      } catch (error) {
        if (error === rollback) results.push(rolledBack);
        else results.push({ accountId, status: 'error', reason: error.message });
      }
    }
    const output = { at: now.toISOString(), day: dayKey(now), mode, serviceHash, policyHash, results };
    const file = path.join(dir, mode === 'preview' ? 'preview.json' : `apply-${Date.now()}.json`);
    write(file, output);
    console.log(JSON.stringify({ file, candidates: candidates.length, affected: results.filter(r => r.result?.decayedCredits > 0).length, credits: results.reduce((sum, r) => sum + (r.result?.decayedCredits || 0), 0), errors: results.filter(r => r.status === 'error'), target: results.find(r => r.accountId === '40dacecc-540d-4423-9f6a-19f02acda6e5') }, null, 2));
    if (results.some(r => r.status === 'error')) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
