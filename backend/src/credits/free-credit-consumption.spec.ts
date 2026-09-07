import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { buildDeductionPlan, getDefaultCreditConsumePolicy, type CreditLotCandidate } from './credit-lot-policy';
import { buildHybridCreditDeductionPlan, applyLotDeductionsToSnapshots, applyLotRestorationsToSnapshots } from './credit-lot-ledger';
import { materializeLegacyReferralLots } from './legacy-referral-lots';
import { isFreeCreditDecayLot } from './free-credit-decay-policy';
import { MembershipService } from '../membership/membership.service';

const now = new Date('2026-09-07T08:00:00Z');
function lot(id: string, overrides: Partial<CreditLotCandidate> = {}): CreditLotCandidate {
  return { id, sourceType: 'recharge', validityType: 'fixed_window', totalAmount: 1000,
    remainingAmount: 1000, status: 'active', grantedAt: new Date('2026-04-01'),
    activeAt: new Date('2026-04-01'), expiresAt: new Date('2028-04-01'), ...overrides };
}

async function run() {
  // Reproduce the production policy: validity/expiry before source, permanent gift last.
  const policy = getDefaultCreditConsumePolicy();
  policy.sorts = ['scope_specificity_desc', 'validity_priority_asc', 'expires_at_asc_nulls_last', 'source_priority_asc'];
  policy.sourcePriority.gift = 999;
  const paid = lot('paid', { priority: -999 });
  const gift = lot('gift', { sourceType: 'gift', validityType: 'permanent', expiresAt: null, remainingAmount: 150 });
  const bonus = lot('bonus', { validityType: 'permanent', expiresAt: null, metadata: { grantType: 'recharge_bonus' } });
  const promo = lot('promo', { sourceType: 'promo', validityType: 'permanent', expiresAt: null });
  const quota = lot('quota', { sourceType: 'subscription', metadata: { grantedBy: 'free_user_monthly_quota' }, priority: -100 });
  for (const free of [gift, promo, quota]) {
    assert.equal(buildDeductionPlan({ lots: [paid, free, bonus], amount: 100, now, policy }).deductions[0].lotId, free.id);
  }
  const daily = lot('daily', { sourceType: 'gift', metadata: { reason: 'daily_reward' }, priority: 999 });
  const admin = lot('admin', { sourceType: 'gift', metadata: { grantedBy: 'admin_add' } });
  const manual = lot('manual', { sourceType: 'manual' });
  const referral = lot('referral', { sourceType: 'gift', metadata: { grantedBy: 'referral_reward' }, priority: -999 });
  const membership = lot('membership', { sourceType: 'subscription', validityType: 'membership_bound', priority: -9999 });
  // Adversarial policy/weights and input ordering cannot override the five source levels.
  for (const adminLot of [admin, manual]) {
    const ordered = [daily, adminLot, referral, membership, paid];
    const deduction = buildHybridCreditDeductionPlan({
      lots: [...ordered].reverse(), accountBalance: 5000, amount: 4500, now, policy,
    });
    assert.deepEqual(deduction.deductions, ordered.map((l, index) => ({ kind: 'lot', lotId: l.id, amount: index === 4 ? 500 : 1000 })));
    const spent = applyLotDeductionsToSnapshots({ lots: ordered, deductions: deduction.deductions });
    const restored = applyLotRestorationsToSnapshots({ lots: spent, deductions: deduction.deductions });
    assert.deepEqual(restored.map(l => l.remainingAmount), ordered.map(l => l.remainingAmount));
    for (let index = 0; index < ordered.length; index++) {
      assert.equal(buildDeductionPlan({ lots: ordered.slice(index).reverse(), amount: 1, now, policy }).deductions[0].lotId, ordered[index].id);
    }
  }
  assert.equal(buildDeductionPlan({ lots: [admin, daily], amount: 1, now, policy }).deductions[0].lotId, 'daily');
  const oldBonus = { ...bonus, sourceType: 'gift' as const };
  assert.equal(buildDeductionPlan({ lots: [oldBonus, membership], amount: 1, now, policy }).deductions[0].lotId, 'membership');
  const plan = buildHybridCreditDeductionPlan({ lots: [paid, gift], accountBalance: 1150, amount: 200, now, policy });
  assert.deepEqual(plan.deductions, [{ kind: 'lot', lotId: 'gift', amount: 150 }, { kind: 'lot', lotId: 'paid', amount: 50 }]);
  const consumed = applyLotDeductionsToSnapshots({ lots: [paid, gift], deductions: plan.deductions });
  assert.equal(consumed.find(l => l.id === 'gift')!.remainingAmount, 0);
  const refunded = applyLotRestorationsToSnapshots({ lots: consumed, deductions: plan.deductions });
  assert.equal(refunded.find(l => l.id === 'gift')!.remainingAmount, 150);
  assert.equal(refunded.find(l => l.id === 'paid')!.remainingAmount, 1000);
  // Eligibility filtering precedes free priority: no expired, pending or wrong-scope gifts.
  for (const bad of [
    { expiresAt: new Date('2026-09-01') }, { status: 'pending' as const },
    { activeAt: new Date('2027-01-01') }, { scopeType: 'model' as const, scopeValue: 'other' },
  ]) {
    assert.equal(buildDeductionPlan({ lots: [paid, { ...gift, ...bad }], amount: 50, now, policy, scope: { model: 'current' } }).deductions[0].lotId, 'paid');
  }

  // Stateful transaction fake: exercise real migration and ledger together; no database balance writes allowed.
  const account = { id: 'account', balance: 1210 };
  const rewards = [
    { id: 'r1', accountId: 'account', type: 'REFERRAL_REWARD', amount: 500, expiredAmount: 350, creditLotId: null as string | null, createdAt: new Date('2026-07-01') },
    { id: 'r2', accountId: 'account', type: 'REFERRAL_REWARD', amount: 500, expiredAmount: 0, creditLotId: null as string | null, createdAt: new Date('2026-07-02') },
  ];
  const lots: CreditLotCandidate[] = [lot('existing')];
  let locked = false;
  const tx = {
    $queryRaw: async () => { locked = true; return []; },
    creditAccount: { findUnique: async () => { assert(locked); return account; } },
    creditTransaction: {
      findMany: async () => { assert(locked); return rewards.filter(r => !r.creditLotId); },
      update: async ({ where, data }: any) => { Object.assign(rewards.find(r => r.id === where.id)!, data); },
    },
    creditLot: {
      aggregate: async () => ({ _sum: { remainingAmount: lots.filter(l => l.status === 'active').reduce((s, l) => s + l.remainingAmount, 0) } }),
      create: async ({ data }: any) => { const l = { id: `lot-${lots.length}`, ...data }; lots.push(l); return l; },
    },
  } as unknown as Prisma.TransactionClient;
  await materializeLegacyReferralLots(tx, 'account');
  assert.equal(account.balance, 1210);
  assert.deepEqual(lots.slice(1).map(l => l.remainingAmount), [150, 60]);
  assert(lots.slice(1).every(l => !isFreeCreditDecayLot(l)), 'unverified historical remainder must not decay');
  assert(isFreeCreditDecayLot(gift), 'ordinary gift still decays');
  const migratedSpend = buildHybridCreditDeductionPlan({ lots, accountBalance: account.balance, amount: 210, now, policy });
  assert(migratedSpend.deductions.every(d => d.lotId !== 'existing'));
  await materializeLegacyReferralLots(tx, 'account');
  assert.equal(lots.length, 3, 'migration is idempotent');
  // No uncovered balance: link an exhausted batch, never manufacture a free balance.
  rewards.push({ ...rewards[0], id: 'r3', creditLotId: null });
  await materializeLegacyReferralLots(tx, 'account');
  assert.equal(lots[3].remainingAmount, 0);
  assert.equal(lots[3].status, 'exhausted');
  // Run the actual scheduler service: unverified migrated rewards stay untouched,
  // while a newly granted ordinary gift still decays once per day.
  const recorded: any[] = [];
  const db = tx as any;
  db.creditLot.updateMany = async () => ({ count: 0 });
  db.creditLot.findMany = async () => lots.filter(l => l.status === 'active' && l.remainingAmount > 0);
  db.creditLot.update = async ({ where, data }: any) => Object.assign(lots.find(l => l.id === where.id)!, data);
  db.creditAccount.findMany = async () => [{ id: 'account', userId: 'user' }];
  db.creditAccount.update = async ({ data }: any) => Object.assign(account, data);
  db.creditTransaction.count = async () => recorded.length;
  db.creditTransaction.create = async ({ data }: any) => { recorded.push(data); return data; };
  db.userMembershipSubscription = { findMany: async () => [], findFirst: async () => null };
  db.user = { findMany: async () => [], findFirst: async () => null };
  db.paymentOrder = { findMany: async () => [{ userId: 'user' }] };
  db.$transaction = async (fn: any) => fn(db);
  const service = Object.create(MembershipService.prototype) as MembershipService;
  Object.assign(service, { prisma: db, businessPolicyService: { getMembershipCreditPolicy: async () => ({ dailyGiftDecayCredits: 50 }) } });
  assert.equal((await service.decayDailyGiftCredits(now)).decayedCredits, 0);
  assert.equal(account.balance, 1210);
  lots.push(lot('new-gift', { sourceType: 'gift', remainingAmount: 70 }));
  account.balance += 70;
  assert.equal((await service.decayDailyGiftCredits(now)).decayedCredits, 50);
  assert.equal(lots.find(l => l.id === 'new-gift')!.remainingAmount, 20);
  assert.equal(account.balance, 1230);
  assert.equal((await service.decayDailyGiftCredits(now)).decayedCredits, 0);
  assert.equal(recorded.length, 1);
  console.log('Free consumption: five-level source ordering, partial spend/refund, eligibility, legacy balance conservation and decay guards passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
