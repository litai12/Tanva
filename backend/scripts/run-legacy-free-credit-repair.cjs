// Audit wrapper. Run on the existing server build; do not deploy new services.
// Usage (from backend): node scripts/run-legacy-free-credit-repair.cjs preview|apply PRIVATE_DIR
// Preview runs the real expiry/decay services inside a transaction that is rolled back.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TARGET_ACCOUNT = 'a0965789-fbee-41d2-ac13-c140b1984ab7';
const VERSION = 'legacy-free-credit-operation-v1';
const SOURCE_FILE = path.join(__dirname, 'repair-legacy-free-credit-sources.cjs');
const BACKEND_DIR = path.resolve(__dirname, '..');
const json = value => JSON.parse(JSON.stringify(value));
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(json(value)))).digest('hex');
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const wrap = (target, overrides) => new Proxy(target, { get(obj, key) {
  if (Object.hasOwn(overrides, key)) return overrides[key];
  const value = obj[key];
  return typeof value === 'function' ? value.bind(obj) : value;
} });

function privateDirectory(rawDir) {
  const dir = path.resolve(rawDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(dir) === dir, 'PRIVATE_DIR must be a real directory without symlink components');
  assert.equal(stat.mode & 0o077, 0, 'PRIVATE_DIR must have mode 0700');
  if (process.getuid) assert.equal(stat.uid, process.getuid(), 'PRIVATE_DIR must belong to the current user');
  return dir;
}

function writePrivate(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function readPrivate(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'Preview must be a private regular file');
  if (process.getuid) assert.equal(stat.uid, process.getuid(), 'Preview must belong to the current user');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clockContext(now, getAnchor) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    day,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffsetMinutes: now.getTimezoneOffset(),
    checkInBusinessDayStartAt: getAnchor(now).toISOString(),
  };
}

function loadRuntime() {
  const { CreditsService } = require('../dist/credits/credits.service');
  const { MembershipService } = require('../dist/membership/membership.service');
  const { BusinessPolicyService } = require('../dist/business-policy/business-policy.service');
  const { getDailyRewardBusinessDayAnchor } = require('../dist/credits/daily-reward-policy');
  const { isFreeCreditDecayLot } = require('../dist/credits/free-credit-decay-policy');
  const source = require(SOURCE_FILE);
  // Include all actually loaded local compiled dependencies, not only the two
  // service entry points (daily reward, referral materialization and DTOs matter).
  const files = new Set([__filename, SOURCE_FILE, ...Object.keys(require.cache).filter(file => file.startsWith(`${BACKEND_DIR}${path.sep}dist${path.sep}`))]);
  const fingerprints = Object.fromEntries([...files].sort().map(file => [path.relative(BACKEND_DIR, file), hashFile(file)]));
  assert.equal(typeof CreditsService.prototype.expireDailyRewardLotsForLockedAccount, 'function', 'Production expiry service is unavailable');
  return { CreditsService, MembershipService, BusinessPolicyService, getDailyRewardBusinessDayAnchor, isFreeCreditDecayLot, source, fingerprints };
}

function assertRuntimeUnchanged(runtime, context) {
  assert.deepEqual(clockContext(new Date(), runtime.getDailyRewardBusinessDayAnchor), context, 'Day or timezone changed; create a fresh preview');
  for (const [relative, expectedHash] of Object.entries(runtime.fingerprints)) {
    assert.equal(hashFile(path.join(BACKEND_DIR, relative)), expectedHash, 'Service, policy or script changed; create a fresh preview');
  }
}

async function snapshot(tx, accountId, source) {
  const accountRef = await tx.creditAccount.findUniqueOrThrow({ where: { id: accountId }, select: { userId: true } });
  const evidence = await source.loadSnapshot(tx, accountRef.userId);
  const account = evidence.account;
  assert.equal(account.id, accountId);
  const [user, subscriptions, policy] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: account.userId }, select: { id: true, vipEntitlementWhitelist: true } }),
    tx.userMembershipSubscription.findMany({ where: { userId: account.userId }, orderBy: { id: 'asc' } }),
    tx.systemSetting.findUnique({ where: { key: 'membership_credit_policy' } }),
  ]);
  return { evidence, user, subscriptions, policy };
}

function scopedClient(tx, accountId) {
  return wrap(tx, {
    creditAccount: wrap(tx.creditAccount, {
      findMany: args => tx.creditAccount.findMany({ ...args, where: { AND: [args?.where || {}, { id: accountId }] } }),
    }),
    creditLot: wrap(tx.creditLot, {
      updateMany: args => tx.creditLot.updateMany({ ...args, where: { AND: [args?.where || {}, { accountId }] } }),
    }),
    $transaction: fn => fn(tx),
  });
}

// Old CHECK_IN remains CHECK_IN. The existing service updates DAILY_REWARD only;
// bridge the expiry fields from the actual lot/EXPIRE receipt it just produced.
async function markExpiredLegacyCheckIns(tx, before, after) {
  const beforeLots = new Map(before.lots.map(lot => [lot.id, lot]));
  const newTransactions = after.transactions.filter(row => !before.transactions.some(old => old.id === row.id));
  for (const row of after.transactions.filter(row => row.type === 'CHECK_IN' && row.creditLotId)) {
    const old = beforeLots.get(row.creditLotId);
    const lot = after.lots.find(lot => lot.id === row.creditLotId);
    if (!old || old.remainingAmount <= 0 || lot?.status !== 'expired' || lot.metadata?.reason !== 'daily_reward') continue;
    const expiry = newTransactions.filter(entry => entry.type === 'expire' && entry.creditLotId === lot.id);
    const cleared = expiry.reduce((sum, entry) => sum - entry.amount, 0);
    const expiredAmount = row.expiredAmount + cleared;
    assert(cleared >= 0 && cleared <= old.remainingAmount && expiredAmount <= row.amount, 'Invalid check-in expiry receipt');
    await tx.creditTransaction.update({ where: { id: row.id }, data: { expiresAt: lot.expiresAt, isExpired: true, expiredAmount } });
  }
}

function normalizedOutcome(beforeEvidence, afterEvidence) {
  const beforeLotIds = new Set(beforeEvidence.lots.map(lot => lot.id));
  const beforeTransactionIds = new Set(beforeEvidence.transactions.map(row => row.id));
  const lotIds = new Map(afterEvidence.lots.map(lot => [lot.id, beforeLotIds.has(lot.id) ? lot.id : `new:${lot.metadata?.originalTransactionId || lot.id}`]));
  const normalizeValue = (value, key) => {
    if (key === 'createdAt' || key === 'updatedAt' || key === 'decayedAt') return undefined;
    if (typeof value === 'string') return lotIds.get(value) || value;
    if (Array.isArray(value)) return value.map(entry => normalizeValue(entry));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([name, entry]) => {
      const result = normalizeValue(entry, name);
      return result === undefined ? [] : [[name, result]];
    }));
    return value;
  };
  const stableSort = rows => rows.map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    account: normalizeValue(json(afterEvidence.account)),
    lots: stableSort(afterEvidence.lots.map(lot => normalizeValue(json(lot)))),
    transactions: stableSort(afterEvidence.transactions.map(row => normalizeValue({ ...json(row), id: beforeTransactionIds.has(row.id) ? row.id : undefined }))),
  };
}

function assertProtected(before, after, runtime, expiry, decay) {
  assert.equal(after.account.balance, before.account.balance - expiry.expiredCredits - decay.decayedCredits, 'Balance differs from real service deductions');
  assert.equal(after.account.totalEarned, before.account.totalEarned, 'Earned counter changed');
  assert.equal(after.account.totalSpent, before.account.totalSpent, 'Spent counter changed');
  const afterLots = new Map(after.lots.map(lot => [lot.id, lot]));
  for (const lot of before.lots) {
    if (lot.sourceType === 'recharge') {
      assert.deepEqual(json(afterLots.get(lot.id)), json(lot), 'Original recharge lot changed');
    } else if (!runtime.isFreeCreditDecayLot(lot) && lot.metadata?.reason !== 'daily_reward') {
      assert.equal(afterLots.get(lot.id)?.remainingAmount, lot.remainingAmount, 'Protected lot balance changed');
    }
  }
  const afterTransactions = new Map(after.transactions.map(row => [row.id, row]));
  for (const row of before.transactions) {
    const current = afterTransactions.get(row.id);
    for (const field of ['accountId', 'type', 'amount', 'balanceBefore', 'balanceAfter', 'createdAt']) {
      assert.deepEqual(json(current?.[field] ?? null), json(row[field] ?? null), 'Historical transaction financial fields changed');
    }
  }
}

function balances(evidence) {
  const totals = { recharge: 0, checkIn: 0, free: 0, other: 0 };
  for (const lot of evidence.lots) {
    if (lot.status !== 'active') continue;
    const key = lot.sourceType === 'recharge' ? 'recharge' : lot.metadata?.reason === 'daily_reward' ? 'checkIn' : ['gift', 'promo'].includes(lot.sourceType) ? 'free' : 'other';
    totals[key] += lot.remainingAmount;
  }
  return totals;
}

async function executeServices(tx, before, plan, now, runtime, beforeHash) {
  const sourceResult = await runtime.source.applyPlan(tx, before.evidence, plan, beforeHash);
  const load = () => runtime.source.loadSnapshot(tx, before.evidence.account.userId);
  const sourceAfter = await load();
  assert.equal(sourceAfter.account.balance, before.evidence.account.balance, 'Source repair changed balance');
  assert.equal(sourceAfter.account.totalEarned, before.evidence.account.totalEarned);
  assert.equal(sourceAfter.account.totalSpent, before.evidence.account.totalSpent);
  for (const lot of before.evidence.lots.filter(lot => lot.sourceType === 'recharge')) {
    assert.deepEqual(json(sourceAfter.lots.find(row => row.id === lot.id)), json(lot), 'Source repair changed original recharge lot');
  }
  const scoped = scopedClient(tx, before.evidence.account.id);
  const businessPolicy = new runtime.BusinessPolicyService(scoped);
  const credits = new runtime.CreditsService(scoped, { get: () => undefined }, businessPolicy, undefined);
  const membership = new runtime.MembershipService(scoped, businessPolicy);
  const expiry = await credits.expireDailyRewardLotsForLockedAccount(tx, sourceAfter.account, now);
  const expired = await load();
  await markExpiredLegacyCheckIns(tx, sourceAfter, expired);
  const decay = await membership.decayDailyGiftCredits(now);
  const after = await load();
  assertProtected(sourceAfter, after, runtime, expiry, decay);
  // Both actual services must be a no-op on today's second invocation.
  const repeatExpiry = await credits.expireDailyRewardLotsForLockedAccount(tx, after.account, now);
  const repeatDecay = await membership.decayDailyGiftCredits(now);
  assert.equal(repeatExpiry.expiredCredits, 0, 'Second expiry deducted credits');
  assert.equal(repeatExpiry.expiredLots, 0, 'Second expiry changed lots');
  assert.equal(repeatDecay.decayedCredits, 0, 'Second decay deducted credits');
  assert.equal(repeatDecay.updatedLots, 0, 'Second decay changed lots');
  const repeatAfter = await load();
  assert.deepEqual(json(repeatAfter), json(after), 'Repeated service invocation changed state');
  return {
    sourceResult,
    expiry,
    decay,
    repeatExpiry,
    repeatDecay,
    balanceBefore: before.evidence.account.balance,
    balanceAfter: after.account.balance,
    balances: balances(after),
    outcomeHash: hash(normalizedOutcome(before.evidence, after)),
    after,
  };
}

function summary(results, skipped, file) {
  const target = results.find(row => row.accountId === TARGET_ACCOUNT);
  return {
    file,
    candidates: results.length,
    successful: results.filter(row => ['preview', 'applied', 'already_applied'].includes(row.status)).length,
    errors: results.filter(row => row.status === 'error').map(row => ({ accountId: row.accountId, code: row.code })),
    skipCounts: skipped,
    target: target ? { accountId: target.accountId, status: target.status, ...(target.result ? { balanceBefore: target.result.balanceBefore, balanceAfter: target.result.balanceAfter, balances: target.result.balances, expiry: target.result.expiry, decay: target.result.decay, repeatExpiry: target.result.repeatExpiry, repeatDecay: target.result.repeatDecay } : { code: target.code }) } : { accountId: TARGET_ACCOUNT, status: 'not_a_candidate' },
  };
}

function skipCode(error) {
  const reason = error.message;
  if (/Consumption|Charged API|Consumption\/refund/.test(reason)) return 'consumption_history_requires_individual_audit';
  if (/Ledger does not close|do not close/.test(reason)) return 'ledger_does_not_close';
  if (/Unattributed expiry|Expiry lacks|expiry.*evidence|loss not explained/.test(reason)) return 'expiry_requires_individual_audit';
  if (/Recharge|recharge/.test(reason)) return 'recharge_requires_individual_audit';
  if (/Unsupported orphan/.test(reason)) return 'unsupported_orphan_source';
  return 'source_evidence_requires_individual_audit';
}

async function main() {
  const [mode, rawDir, ...extra] = process.argv.slice(2);
  assert(['preview', 'apply'].includes(mode) && rawDir && extra.length === 0, 'Usage: preview|apply PRIVATE_DIR');
  const dir = privateDirectory(rawDir);
  const runtime = loadRuntime();
  const now = new Date();
  const context = clockContext(now, runtime.getDailyRewardBusinessDayAnchor);
  const runId = `${Date.now()}-${crypto.randomUUID()}`;
  const previewFile = path.join(dir, 'preview.json');
  if (mode === 'preview') assert(!fs.existsSync(previewFile), 'PRIVATE_DIR already contains a preview; use a new private directory');
  const expected = mode === 'apply' ? readPrivate(previewFile) : null;
  if (expected) {
    assert.equal(expected.version, VERSION, 'Unsupported preview version');
    assert.deepEqual(expected.clock, context, 'Preview must be from the same day, business day and timezone');
    assert.deepEqual(expected.fingerprints, runtime.fingerprints, 'Service, policy or script changed since preview');
    assert(!expected.results.some(row => row.status === 'error'), 'Preview contains errors; create a clean preview');
    assert.equal(expected.previewHash, hash({ ...expected, previewHash: undefined }), 'Preview integrity check failed');
  }
  require('dotenv').config({ path: path.join(BACKEND_DIR, '.env'), quiet: true });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  const results = [];
  const skipCounts = {};
  const auditEntries = [];
  try {
    const scanned = expected ? expected.results.filter(row => row.status === 'preview').map(row => ({ accountId: row.accountId, expected: row })) : [];
    if (!expected) {
      const accounts = await db.creditAccount.findMany({ where: { balance: { gt: 0 }, transactions: { some: {
        creditLotId: null, amount: { gt: 0 }, isExpired: false, OR: [{ type: 'CHECK_IN' }, { type: 'earn',
          description: { in: ['新用户注册赠送积分', '被邀请注册额外赠送积分'] } }],
      } } }, select: { id: true }, orderBy: { id: 'asc' } });
      for (const { id: accountId } of accounts) {
        // This phase is deliberately read-only: source material is reviewed
        // before any service simulation is allowed to write even temporarily.
        const before = await db.$transaction(async tx => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          return snapshot(tx, accountId, runtime.source);
        }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
        let plan, reason, skipReason;
        try { plan = runtime.source.planRepair(before.evidence, now); }
        catch (error) { reason = skipCode(error); skipReason = error.message; }
        const beforeHash = hash(before);
        const planHash = plan ? hash(plan) : null;
        const auditFile = path.join(dir, `evidence-${accountId}-${runId}.json`);
        writePrivate(auditFile, { accountId, beforeHash, planHash, before, plan, skipReason });
        auditEntries.push({ accountId, beforeHash, planHash, auditFile, status: plan?.status || 'skipped', reason, skipReason });
        if (plan?.status !== 'planned') {
          const code = reason || plan?.status || 'not_eligible';
          skipCounts[code] = (skipCounts[code] || 0) + 1;
          continue;
        }
        scanned.push({ accountId, beforeHash, planHash, auditFile });
      }
    }
    assert.equal(new Set(scanned.map(row => row.accountId)).size, scanned.length, 'Duplicate account candidates');
    for (const candidate of scanned) {
      const { accountId } = candidate;
      assert(/^[0-9a-f-]{36}$/i.test(accountId), 'Invalid account ID');
      const rollback = new Error('PREVIEW_ROLLBACK');
      let receipt;
      try {
        receipt = await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE id = ${accountId} FOR UPDATE`;
          assertRuntimeUnchanged(runtime, context);
          const before = await snapshot(tx, accountId, runtime.source);
          const plan = runtime.source.planRepair(before.evidence, now);
          const reviewed = candidate.expected || candidate;
          if (mode === 'apply' && plan.status === 'already_repaired') {
            const marker = before.evidence.transactions.find(row => row.id === runtime.source.markerFor(accountId));
            const oldBackup = readPrivate(reviewed.backupFile);
            assert.equal(hash(oldBackup.before), reviewed.beforeHash, 'Reviewed backup integrity failed');
            assert.equal(marker?.metadata?.previewHash, reviewed.beforeHash, 'Account repaired under a different preview');
            for (const key of ['user', 'subscriptions', 'policy']) assert.deepEqual(json(before[key]), json(oldBackup.before[key]), 'Entitlement or policy changed after repair');
            assert.equal(hash(normalizedOutcome(oldBackup.before.evidence, before.evidence)), reviewed.result.outcomeHash, 'Previously applied account changed; reconcile private receipts');
            return { ...reviewed, status: 'already_applied' };
          }
          assert.equal(plan.status, 'planned', 'Account no longer requires the reviewed source repair');
          const beforeHash = hash(before);
          const planHash = hash(plan);
          assert.equal(beforeHash, reviewed.beforeHash, 'Account, entitlement or policy changed; create a fresh preview');
          assert.equal(planHash, reviewed.planHash, 'Repair plan changed; create a fresh preview');
          const backupFile = path.join(dir, `${mode}-before-${accountId}-${runId}.json`);
          writePrivate(backupFile, { version: VERSION, at: now.toISOString(), clock: context, fingerprints: runtime.fingerprints, beforeHash, planHash, before, plan });
          const result = await executeServices(tx, before, plan, now, runtime, beforeHash);
          const { after, ...reviewable } = result;
          if (candidate.expected) assert.deepEqual(json(reviewable), candidate.expected.result, 'Real service result differs from preview; rolled back');
          assertRuntimeUnchanged(runtime, context);
          receipt = { accountId, status: mode === 'apply' ? 'applied' : 'preview', beforeHash, planHash, result: json(reviewable), backupFile };
          const stagedReceipt = path.join(dir, `${mode}-prepared-${accountId}-${runId}.json`);
          // Keep the full resulting snapshot even if the process exits before
          // the post-commit receipt can be written. A prepared record is not a
          // commit receipt; reconcile the source marker before rerunning.
          writePrivate(stagedReceipt, { receipt, after });
          if (mode === 'preview') throw rollback;
          return receipt;
        }, { isolationLevel: 'Serializable', timeout: 60000 });
        results.push(receipt);
        writePrivate(path.join(dir, `receipt-${accountId}-${runId}.json`), receipt);
      } catch (error) {
        if (error === rollback) results.push(receipt);
        else {
          writePrivate(path.join(dir, `error-${accountId}-${runId}.json`), { accountId, message: error.message, stack: error.stack });
          results.push({ accountId, status: 'error', code: 'locked_validation_or_service_failed' });
        }
      }
    }
    const output = { version: VERSION, at: now.toISOString(), clock: context, mode, fingerprints: runtime.fingerprints, results, auditEntries: expected?.auditEntries || auditEntries, skipCounts: expected?.skipCounts || skipCounts };
    if (mode === 'preview') output.previewHash = hash(output);
    const file = mode === 'preview' ? previewFile : path.join(dir, `apply-${runId}.json`);
    writePrivate(file, output);
    console.log(JSON.stringify(summary(results, output.skipCounts, file), null, 2));
    if (results.some(row => row.status === 'error')) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}

module.exports = { hash, normalizedOutcome, scopedClient, clockContext, markExpiredLegacyCheckIns, assertProtected, balances, executeServices, summary, privateDirectory, writePrivate, readPrivate };
if (require.main === module) main().catch(() => { console.error('Audit operation failed. No successful commit is implied; inspect private audit files and rerun preview.'); process.exitCode = 1; });
