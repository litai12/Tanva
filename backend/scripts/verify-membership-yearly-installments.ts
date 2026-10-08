import assert from 'node:assert/strict';
import { MembershipService } from '../src/membership/membership.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const startAt = new Date('2026-09-02T08:00:00.000Z');
const now = new Date('2026-10-08T08:00:00.000Z');
const initialTypes = [
  'membership_grant',
  'membership_cycle_switch',
  'membership_upgrade_prorated',
  'membership_admin_change',
  'membership_yearly_installment',
];

type Grant = {
  businessType: string;
  subscriptionId: string;
  amount: number;
  metadata?: Record<string, unknown>;
};

function grant(businessType: string, index: number, cycleStart = startAt): Grant {
  return {
    businessType, subscriptionId: 'subscription', amount: 200,
    metadata: {
      annualCycleStartAt: cycleStart.toISOString(),
      annualInstallmentIndex: index,
      annualInstallmentCount: 12,
    },
  };
}

function fixture(options: {
  transactions?: Grant[];
  installmentMode?: boolean;
  totalCredits?: number;
  onLock?: (transactions: Grant[]) => void;
  requireReadLock?: boolean;
} = {}) {
  const subscription = {
    id: 'subscription', userId: 'user', membershipPlanId: 'plan',
    status: 'active', periodType: 'yearly', currentPeriodStartAt: startAt,
    currentPeriodEndAt: new Date(startAt.getTime() + 360 * DAY_MS),
    snapshot: {
      id: 'plan', code: 'vip_yearly', name: '年卡', billingCycle: 'yearly',
      price: '120', monthlyQuotaCredits: options.totalCredits ?? 2400,
      signupBonusCredits: 0, dailyGiftCredits: 0,
      metadata: options.installmentMode === false ? {} : {
        creditIssuanceMode: 'yearly_monthly_installments',
      },
    },
  };
  const transactions = options.transactions ?? [grant('membership_grant', 1)];
  const lots: Array<Record<string, any>> = [];
  const account = { id: 'account', userId: 'user', balance: 140, totalEarned: 200 };
  let locked = false;
  let lockCount = 0;
  let lockTail = Promise.resolve();
  const queryTypes: string[][] = [];

  function matchingTransactions(args: any) {
    return transactions.filter((item) => (
      item.subscriptionId === args.where.subscriptionId &&
      args.where.businessType.in.includes(item.businessType)
    ));
  }

  const client = {
    userMembershipSubscription: {
      findFirst: async () => subscription,
      findMany: async (args: any) => (
        subscription.status === args.where.status &&
        subscription.periodType === args.where.periodType &&
        subscription.currentPeriodEndAt > args.where.currentPeriodEndAt.gt
      ) ? [subscription] : [],
    },
    creditTransaction: {
      findMany: async (args: any) => {
        if (options.requireReadLock) assert.equal(locked, true, 'manual next-period lookup must follow the lock');
        queryTypes.push([...args.where.businessType.in]);
        return matchingTransactions(args);
      },
      count: async (args: any) => matchingTransactions(args).length,
      create: async ({ data }: any) => {
        assert.equal(locked, true, 'grant must be written under the account lock');
        transactions.push(data);
        return data;
      },
    },
    creditAccount: {
      findUnique: async () => {
        assert.equal(locked, true, 'account must be read after locking');
        return { ...account };
      },
      update: async ({ data }: any) => {
        assert.equal(locked, true);
        Object.assign(account, data);
        return account;
      },
    },
    creditLot: {
      create: async ({ data }: any) => {
        assert.equal(locked, true);
        const lot = { id: `lot-${lots.length + 1}`, ...data };
        lots.push(lot);
        return lot;
      },
    },
    $queryRaw: async () => {
      locked = true;
      lockCount += 1;
      if (lockCount === 1) options.onLock?.(transactions);
      return [{ id: account.id }];
    },
  };
  const prisma = {
    ...client,
    $transaction: async (operation: (tx: typeof client) => Promise<unknown>) => {
      let releaseLock: (() => void) | undefined;
      const tx = {
        ...client,
        $queryRaw: async () => {
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => { releaseLock = resolve; });
          await previous;
          return client.$queryRaw();
        },
      };
      try {
        return await operation(tx);
      } finally {
        if (releaseLock) {
          locked = false;
          releaseLock();
        }
      }
    },
  };
  const service = new MembershipService(prisma as never, {
    getMembershipCreditPolicy: async () => ({ membershipRefreshCycleDays: 30 }),
  } as never);
  return { service, subscription, transactions, lots, account, queryTypes };
}

async function main() {
  // All real tagged first-period business types must unlock the second period.
  for (const type of initialTypes) {
    const f = fixture({ transactions: [grant(type, 1)] });
    const result = await f.service.refreshYearlySubscriptionQuotaLots(now);
    assert.equal(result.grantedCredits, 200, type);
    assert.equal(result.createdLots, 1, type);
    assert.equal(f.account.balance, 340, type);
    assert.equal(f.account.totalEarned, 400, type);
    assert.equal(f.transactions[1].metadata?.annualInstallmentIndex, 2, type);
    assert.equal(f.lots[0].remainingAmount, 200);
    assert.equal(f.lots[0].validityType, 'membership_bound');
    assert.equal(f.lots[0].expiresAt, f.subscription.currentPeriodEndAt);
    assert.equal((await f.service.refreshYearlySubscriptionQuotaLots(now)).createdLots, 0);
    assert.equal(f.transactions.length, 2, 'repeated runs cannot grant again');
    assert.deepEqual(f.queryTypes[0], f.queryTypes[1], 'lock-time dedup uses the same business types');
  }

  // Legacy upfront grants without period labels must never be replayed.
  for (const type of initialTypes.filter((type) => type !== 'membership_yearly_installment')) {
    const f = fixture({ transactions: [{ businessType: type, subscriptionId: 'subscription', amount: 2400 }] });
    assert.equal((await f.service.refreshYearlySubscriptionQuotaLots(now)).grantedCredits, 0, type);
    assert.equal(f.lots.length, 0);
    assert.equal(f.account.balance, 140);
  }
  const upfront = fixture({ installmentMode: false });
  assert.equal((await upfront.service.refreshYearlySubscriptionQuotaLots(now)).createdLots, 0);

  // A previous cycle's second period must not hide the current cycle's second period.
  const cycleIsolation = fixture({ transactions: [
    grant('membership_grant', 1),
    grant('membership_yearly_installment', 2, new Date('2025-09-02T08:00:00.000Z')),
    { ...grant('membership_yearly_installment', 2), subscriptionId: 'another-subscription' },
  ] });
  assert.equal((await cycleIsolation.service.refreshYearlySubscriptionQuotaLots(now)).createdLots, 1);
  assert.equal(cycleIsolation.transactions.at(-1)?.metadata?.annualCycleStartAt, startAt.toISOString());

  // Recheck after locking, including grants from payment/upgrade/admin paths.
  for (const type of initialTypes) {
    const f = fixture({ onLock: (transactions) => transactions.push(grant(type, 2)) });
    assert.equal((await f.service.refreshYearlySubscriptionQuotaLots(now)).createdLots, 0, type);
    assert.equal(f.account.balance, 140, 'already issued period cannot mutate the balance');
  }

  const timing = fixture();
  assert.equal((await timing.service.refreshYearlySubscriptionQuotaLots(
    new Date(startAt.getTime() + 30 * DAY_MS - 1),
  )).createdLots, 0, 'period must not be issued early');
  assert.equal((await timing.service.refreshYearlySubscriptionQuotaLots(
    new Date(startAt.getTime() + 60 * DAY_MS),
  )).createdLots, 2, 'delayed job catches up only due periods');
  assert.deepEqual(timing.transactions.slice(1).map((item) => item.metadata?.annualInstallmentIndex), [2, 3]);

  const rounding = fixture({ totalCredits: 2405 });
  const annualResult = await rounding.service.refreshYearlySubscriptionQuotaLots(
    new Date(startAt.getTime() + 330 * DAY_MS),
  );
  assert.equal(annualResult.createdLots, 11);
  assert.equal(annualResult.grantedCredits, 2205);
  assert.equal(rounding.transactions.reduce((sum, item) => sum + item.amount, 0), 2405);
  assert.equal(rounding.transactions.at(-1)?.amount, 205);
  assert.equal((await rounding.service.refreshYearlySubscriptionQuotaLots(
    new Date(startAt.getTime() + 359 * DAY_MS),
  )).createdLots, 0, 'all 12 periods are issued exactly once');

  const manual = fixture({ requireReadLock: true });
  await manual.service.adminIssueNextYearlyInstallment('user', 'admin');
  assert.equal(manual.transactions.at(-1)?.metadata?.annualInstallmentIndex, 2);
  assert.equal(manual.transactions.at(-1)?.metadata?.issuedEarlyByAdmin, true);

  // Serialized manual clicks retain the explicit next-period behavior with unique period indexes.
  const manualRace = fixture({ requireReadLock: true });
  await Promise.all([
    manualRace.service.adminIssueNextYearlyInstallment('user', 'admin'),
    manualRace.service.adminIssueNextYearlyInstallment('user', 'admin'),
  ]);
  assert.deepEqual(manualRace.transactions.slice(1).map((item) => item.metadata?.annualInstallmentIndex), [2, 3]);
  assert.equal(manualRace.account.balance, 540);

  const mixedRace = fixture();
  await Promise.all([
    mixedRace.service.adminIssueNextYearlyInstallment('user', 'admin'),
    mixedRace.service.refreshYearlySubscriptionQuotaLots(now),
  ]);
  assert.deepEqual(mixedRace.transactions.slice(1).map((item) => item.metadata?.annualInstallmentIndex), [2]);
  assert.equal(mixedRace.account.balance, 340);

  const expired = fixture();
  expired.subscription.currentPeriodEndAt = now;
  assert.equal((await expired.service.refreshYearlySubscriptionQuotaLots(now)).createdLots, 0);
  console.log('membership yearly installment regression checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
