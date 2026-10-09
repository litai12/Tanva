import assert from 'node:assert/strict';
import { CreditsService } from './credits.service';
import { CreditChargeService } from '../team-credits/credit-charge.service';
import { getDefaultCreditConsumePolicy } from './credit-lot-policy';

const logger = { log() {}, debug() {}, warn() {}, error() {} };
type Row = Record<string, any>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === 'AND') return condition.every((item: Row) => matches(row, item));
    if (key === 'OR') return condition.some((item: Row) => matches(row, item));
    if (condition && typeof condition === 'object') {
      if ('path' in condition) return condition.path.reduce((value: any, part: string) => value?.[part], row[key]) === condition.equals;
      if ('in' in condition) return condition.in.includes(row[key]);
      if ('gte' in condition) return row[key] >= condition.gte;
      if ('gt' in condition) return row[key] > condition.gt;
    }
    return row[key] === condition;
  });
}

function fixture() {
  const account: Row = { id: 'account', userId: 'owner', balance: 1000, totalSpent: 0 };
  const usages: Row[] = [];
  const tasks: Row[] = [];
  const transactions: Row[] = [];
  let sequence = 0;
  let locked = false;
  let lockCount = 0;
  let tail = Promise.resolve();
  const requireLock = () => assert(locked, 'dedup and writes must run after the account lock');
  const findUsages = (query: Row) => {
    requireLock();
    let found = usages.filter((row) => matches(row, query.where));
    found.sort((a, b) => +b.createdAt - +a.createdAt || b.id.localeCompare(a.id));
    if (query.cursor) found = found.slice(found.findIndex((row) => row.id === query.cursor.id) + query.skip);
    return query.take ? found.slice(0, query.take) : found;
  };
  const tx: any = {
    $queryRaw: async () => { locked = true; lockCount++; return []; },
    creditAccount: {
      findUnique: async () => { requireLock(); return { ...account }; },
      update: async ({ data }: Row) => { requireLock(); Object.assign(account, data); return { ...account }; },
    },
    apiUsageRecord: {
      findMany: async (query: Row) => findUsages(query),
      findFirst: async (query: Row) => findUsages(query)[0] ?? null,
      create: async ({ data }: Row) => {
        requireLock();
        const row = { id: `new-usage-${++sequence}`, createdAt: new Date(), ...data };
        usages.push(row); return row;
      },
    },
    imageTask: {
      findMany: async ({ where }: Row) => { requireLock(); return tasks.filter((row) => matches(row, where)); },
    },
    creditTransaction: {
      findFirst: async ({ where }: Row) => { requireLock(); return transactions.find((row) => matches(row, where)) ?? null; },
      findMany: async () => [],
      create: async ({ data }: Row) => { requireLock(); const row = { id: `spend-${++sequence}`, ...data }; transactions.push(row); return row; },
    },
    creditLot: { findMany: async () => [] },
  };
  const prisma: any = {
    // Model the PostgreSQL account lock by serializing transactions. The real
    // service must still acquire its lock before querying or writing anything.
    $transaction: (operation: (transaction: any) => Promise<any>) => {
      const result = tail.then(async () => {
        locked = false;
        try { return await operation(tx); } finally { locked = false; }
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const credits: any = Object.assign(Object.create(CreditsService.prototype), {
    prisma, logger,
    resolveEffectiveCreditsQuote: async ({ requestParams }: Row) => ({
      pricing: { serviceName: 'GPT Image 2', provider: 'new-api' }, creditsToDeduct: 20,
      effectiveRequestParams: requestParams, requestedProvider: 'new-api',
    }),
    expireDailyRewardLotsForLockedAccount: async () => ({ balanceAfter: account.balance }),
    expireFreeUserMonthlyQuotaLotsForAccount: async () => {},
    resolveCreditConsumePolicy: async () => getDefaultCreditConsumePolicy(),
    shouldSkipFreeUsageQuota: async () => true,
    enforceFreeUserImageQuota: async () => {}, enforceFreeUserVideoQuota: async () => {},
  });
  const charge = new CreditChargeService(prisma, credits);
  const run = (taskId = 'new-task', overrides: Row = {}) => charge.begin({
    userId: 'owner', serviceType: 'gpt-image-2', model: 'gpt-image-2',
    idempotencyKey: `image-task:${taskId}`, outputImageCount: 1,
    requestParams: { taskId, clientProjectId: 'project', clientNodeId: 'node', ...overrides },
  });
  const old = (status: string | null, suffix = 'old', overrides: Row = {}) => {
    const taskId = `task-${suffix}`;
    const usage = {
      id: `usage-${suffix}`, userId: 'owner', model: 'gpt-image-2', serviceType: 'gpt-image-2',
      responseStatus: 'pending', createdAt: new Date(0), creditsUsed: 20,
      requestParams: { taskId, clientProjectId: 'project', clientNodeId: 'node', idempotencyKey: `image-task:${taskId}`, ...overrides },
    };
    usages.push(usage);
    if (status) tasks.push({ id: taskId, userId: 'owner', status });
    return usage;
  };
  return { usages, tasks, transactions, account, run, old, get lockCount() { return lockCount; } };
}

async function main() {
  for (const status of ['failed', 'cancelled', 'succeeded']) {
    const f = fixture();
    const old = f.old(status);
    const original = structuredClone(old);
    const result = await f.run();
    assert.equal(result.duplicate, false, `manual Run after ${status}`);
    assert.equal(f.account.balance, 980);
    assert.equal(f.transactions.length, 1);
    assert.deepEqual(old, original, 'old pending receipt stays intact for reconciliation');
  }
  for (const status of ['queued', 'processing', 'unrecognized', null]) {
    const f = fixture(); const old = f.old(status);
    const result = await f.run();
    assert.equal(result.duplicateReason, 'active-node', String(status));
    assert.equal(result.apiUsageId, old.id);
    assert.equal(f.account.balance, 1000); assert.equal(f.transactions.length, 0);
  }
  for (const requestParams of [{ taskId: null }, { taskId: '' }, { taskId: ['task-old'] }]) {
    const f = fixture(); f.old('failed', 'old', requestParams);
    assert.equal((await f.run()).duplicateReason, 'active-node', 'missing task identity cannot be bypassed');
  }
  const foreign = fixture(); foreign.old('failed'); foreign.tasks[0].userId = 'another-user';
  assert.equal((await foreign.run()).duplicateReason, 'active-node', 'task ownership is verified');

  const multiple = fixture();
  const active = multiple.old('processing', 'active');
  const newer = multiple.old('failed', 'newer'); newer.createdAt = new Date(1000);
  assert.equal((await multiple.run()).apiUsageId, active.id, 'newer terminal receipt cannot hide older active work');
  const paged = fixture();
  const oldest = paged.old('queued', 'active');
  for (let i = 0; i < 51; i++) paged.old('failed', `terminal-${i}`).createdAt = new Date(i + 1);
  assert.equal((await paged.run()).apiUsageId, oldest.id, 'scan beyond first page for active work');
  paged.tasks.find((task) => task.id === 'task-active')!.status = 'failed';
  assert.equal((await paged.run()).duplicate, false, 'all-terminal pages allow the new request');

  const replay = fixture(); const receipt = replay.old('failed');
  assert.equal((await replay.run('task-old')).duplicateReason, 'idempotency', 'the same task receipt must never be charged again');
  assert.equal(replay.transactions.length, 0); assert.equal(receipt.responseStatus, 'pending');
  const successful = fixture(); const success = successful.old('succeeded'); success.responseStatus = 'success';
  assert.equal((await successful.run('task-old')).duplicateReason, 'idempotency', 'successful receipt replay stays idempotent');

  for (const ids of [['attempt', 'attempt'], ['attempt-1', 'attempt-2']]) {
    const f = fixture(); const old = f.old('failed'); const original = structuredClone(old);
    const results = await Promise.all(ids.map((id) => f.run(id)));
    assert.equal(results.filter((result) => !result.duplicate).length, 1, 'parallel clicks reserve exactly once');
    assert.equal(results[0].apiUsageId, results[1].apiUsageId);
    assert.equal(f.account.balance, 980); assert.equal(f.transactions.length, 1);
    assert(f.lockCount >= 2, 'every attempt acquires the account lock');
    assert.deepEqual(old, original);
  }

  const slots = fixture(); slots.old('processing', 'slot0', { clientNodeId: 'node:slot:0' });
  assert.equal((await slots.run('slot1', { parallelGroupIndex: 1 })).duplicate, false, 'parallel image slots retain their independent scope');
  assert.equal((await slots.run('another-slot0', { parallelGroupIndex: 0 })).duplicateReason, 'active-node');
  for (const status of ['processing', 'queued', null, 'failed']) {
    const legacy = fixture(); legacy.old(status, 'legacy', { clientProjectId: 'legacy-image' });
    assert.equal((await legacy.run()).duplicate, status !== 'failed', `legacy scope ${status} remains subject to task reconciliation`);
  }
  const projects = fixture(); projects.old('processing', 'elsewhere', { clientProjectId: 'another-project' });
  assert.equal((await projects.run()).duplicate, false, 'explicit project scopes are independent');
  console.log('image node manual rerun billing: PASS');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
