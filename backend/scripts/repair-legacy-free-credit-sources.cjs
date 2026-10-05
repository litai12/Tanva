// Source attribution only. This script never grants credits, changes counters,
// clears check-ins or catches up missed decay. Lifecycle operations belong to
// the production services and can run after applyOne inside the same account lock.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPAIR = 'legacy-free-credit-sources-v1';
const markerFor = accountId => `${REPAIR}:${accountId}`;
const lotIdFor = transactionId => `${REPAIR}:lot:${transactionId}`;
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toJSON === 'function') return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const integer = (value, name) => assert(Number.isSafeInteger(value) && value >= 0, `Invalid ${name}`);
const time = value => { const result = +new Date(value); assert(Number.isFinite(result), 'Invalid date'); return result; };
const sum = values => values.reduce((total, value) => total + value, 0);
function dailyRewardExpiresAt(value) {
  const date = new Date(value);
  if (date.getHours() < 3) date.setDate(date.getDate() - 1);
  date.setHours(3, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}
function activeVip(snapshot, now) {
  return snapshot.user?.vipEntitlementWhitelist === true || (snapshot.subscriptions || []).some(subscription =>
    subscription.status === 'active' && time(subscription.currentPeriodStartAt) <= time(now) &&
    time(subscription.currentPeriodEndAt) > time(now));
}

/** Throws on incomplete evidence; caller reports a skip without writing. */
function planRepair(snapshot, now = new Date()) {
  const { account, transactions, lots, orders, usages = [] } = snapshot;
  assert(account && snapshot.user?.id === account.userId, 'Missing or mismatched user/account');
  for (const field of ['balance', 'totalEarned', 'totalSpent']) integer(account[field], field);
  const byLot = new Map(lots.map(lot => [lot.id, lot]));
  const byTransaction = new Map(transactions.map(transaction => [transaction.id, transaction]));
  assert.equal(byLot.size, lots.length, 'Duplicate lot');
  assert.equal(byTransaction.size, transactions.length, 'Duplicate transaction');
  const marker = transactions.find(transaction => transaction.id === markerFor(account.id));
  if (marker) {
    assert(marker.amount === 0 && marker.type === 'admin_adjust' && marker.metadata?.reconciliation === REPAIR,
      'Invalid repair marker');
    const repairedIds = marker.metadata.originalTransactionIds;
    assert(Array.isArray(repairedIds) && repairedIds.length > 0, 'Invalid repair marker sources');
    for (const id of repairedIds) {
      assert(byTransaction.get(id)?.creditLotId === lotIdFor(id) && byLot.has(lotIdFor(id)), 'Incomplete previous repair');
    }
    return { status: 'already_repaired', marker: marker.id, grants: [], accountId: account.id };
  }
  assert.equal(account.totalSpent, 0, 'Consumption history requires individual audit');
  assert(usages.every(usage => usage.creditsUsed === 0), 'Charged API usage requires individual audit');
  const positives = transactions.filter(transaction => transaction.amount > 0);
  const lossByLot = new Map();
  const lossByTransaction = new Map();
  function addLoss(map, id, amount, expiry) {
    integer(amount, 'expiry deduction'); assert(amount > 0, 'Empty expiry deduction');
    const sources = map === lossByLot ? positives.filter(source => source.creditLotId === id) : [byTransaction.get(id)];
    assert(sources.length === 1 && sources[0]?.amount > 0, 'Expiry lacks one original positive grant');
    if (map === lossByTransaction) assert(!sources[0].creditLotId, 'Legacy expiry points to an already linked source');
    assert(time(sources[0].createdAt) <= time(expiry.createdAt), 'Expiry predates original grant');
    map.set(id, (map.get(id) || 0) + amount);
  }
  for (const transaction of transactions) {
    assert.equal(transaction.accountId, account.id, 'Foreign transaction');
    assert(Number.isSafeInteger(transaction.amount), 'Invalid transaction amount');
    integer(transaction.balanceBefore, 'balanceBefore'); integer(transaction.balanceAfter, 'balanceAfter');
    assert.equal(transaction.balanceBefore + transaction.amount, transaction.balanceAfter, 'Broken transaction balance');
    assert(!['spend', 'refund', 'adjustment', 'consume', 'consumption', '消费'].includes(transaction.type.toLowerCase()) && !transaction.apiUsageId,
      'Consumption/refund history requires individual audit');
    assert(!(transaction.type === 'admin_adjust' && transaction.amount !== 0), 'Nonzero admin adjustment requires individual audit');
    if (transaction.amount >= 0) continue;
    assert.equal(transaction.type, 'expire', 'Unknown debit requires individual audit');
    const audit = transaction.metadata?.referralPriorityAudit;
    let deductions = transaction.metadata?.deductions;
    if (audit && typeof audit === 'object') {
      const auditMarker = byTransaction.get(`referral-priority-audit-v3:${account.id}`);
      assert(audit.version === 'referral-priority-audit-v3' && /^[a-f0-9]{64}$/.test(audit.backupHash || '') &&
        auditMarker?.amount === 0 && auditMarker?.metadata?.reconciliation === audit.version &&
        auditMarker.metadata.backupHash === audit.backupHash, 'Unverified prior referral audit');
      assert.equal(digest(audit.originalDeductions), digest(deductions), 'Prior audit original evidence mismatch');
      assert(Array.isArray(audit.correctedDeductions), 'Missing audited deductions');
      deductions = audit.correctedDeductions;
    }
    if (Array.isArray(deductions) && deductions.length) {
      assert.equal(sum(deductions.map(deduction => deduction.amount)), -transaction.amount, 'Expiry deductions mismatch');
      for (const deduction of deductions) {
        if ((!deduction.kind || deduction.kind === 'lot') && byLot.has(deduction.lotId)) addLoss(lossByLot, deduction.lotId, deduction.amount, transaction);
        else if (['legacy_referral', 'legacy_daily_reward'].includes(deduction.kind) && byTransaction.has(deduction.transactionId))
          addLoss(lossByTransaction, deduction.transactionId, deduction.amount, transaction);
        else assert.fail('Unattributed expiry requires individual audit');
      }
    } else {
      const id = transaction.creditLotId || transaction.metadata?.expiredLotId;
      assert(id && byLot.has(id), 'Unattributed expiry requires individual audit');
      addLoss(lossByLot, id, -transaction.amount, transaction);
    }
  }
  assert.equal(sum(transactions.map(transaction => transaction.amount)), account.balance, 'Ledger does not close to balance');
  assert.equal(sum(positives.map(transaction => transaction.amount)), account.totalEarned, 'Ledger does not close to totalEarned');
  const lotGrants = new Map();
  const rechargeOrderIds = new Set();
  const matchedOrders = new Map();
  for (const transaction of positives) {
    integer(transaction.expiredAmount, 'expiredAmount');
    assert(transaction.expiredAmount <= transaction.amount, 'Expiry exceeds original grant');
    assert(!(transaction.isExpired && transaction.expiredAmount !== transaction.amount), 'isExpired/expiredAmount mismatch');
    if (transaction.creditLotId) {
      assert(byLot.has(transaction.creditLotId), 'Missing referenced lot');
      assert(!lotGrants.has(transaction.creditLotId), 'Multiple positive grants reference one lot');
      lotGrants.set(transaction.creditLotId, transaction);
    }
    if (transaction.type === 'earn' && transaction.description === '充值') {
      const refs = [transaction.orderId, transaction.metadata?.orderId, transaction.metadata?.orderNo].filter(Boolean);
      const matches = orders.filter(order => refs.includes(order.id) || refs.includes(order.orderNo));
      assert.equal(matches.length, 1, 'Recharge has no unique paid order evidence');
      const order = matches[0];
      assert(order.userId === account.userId && order.status === 'paid' && order.orderType === 'recharge' && !order.teamId &&
        !order.membershipPlanId && !order.subscriptionId && order.paidAt && Number(order.amount) > 0,
      'Recharge order is not a paid personal recharge');
      assert.equal(order.credits, transaction.amount, 'Recharge/order credits mismatch');
      assert(!rechargeOrderIds.has(order.id), 'Duplicate recharge grants for order');
      rechargeOrderIds.add(order.id); matchedOrders.set(transaction.id, order);
    }
  }
  for (const lot of lots) {
    assert.equal(lot.accountId, account.id, 'Foreign lot');
    integer(lot.totalAmount, 'lot total'); integer(lot.remainingAmount, 'lot remaining');
    assert(lot.remainingAmount <= lot.totalAmount, 'Lot remaining exceeds total');
    assert(['active', 'expired', 'exhausted'].includes(lot.status), 'Unsupported lot status');
    assert(lot.status === 'active' || lot.remainingAmount === 0, 'Inactive lot retains credits');
    const grant = lotGrants.get(lot.id);
    assert(grant && grant.amount === lot.totalAmount, 'Lot lacks one exact original grant');
    assert.equal(lot.totalAmount - lot.remainingAmount, lossByLot.get(lot.id) || 0, 'Lot loss not explained by expiry evidence');
    assert(grant.expiredAmount <= (lossByLot.get(lot.id) || 0), 'Grant expiry exceeds lot expiry evidence');
  }
  const vip = activeVip(snapshot, now);
  let signupCount = 0;
  let inviteeSignupCount = 0;
  const grants = positives.filter(transaction => !transaction.creditLotId).map(transaction => {
    const loss = lossByTransaction.get(transaction.id) || 0;
    assert.equal(transaction.expiredAmount, loss, 'Orphan expiry not explained by evidence');
    const remainingAmount = transaction.amount - loss;
    let sourceType, reason, order;
    if (transaction.type === 'earn' && transaction.description === '新用户注册赠送积分' && transaction.amount === 500) {
      signupCount += 1; sourceType = 'promo'; reason = 'signup_bonus';
    } else if (transaction.type === 'earn' && transaction.description === '被邀请注册额外赠送积分' &&
      transaction.amount === 500 && typeof transaction.metadata?.inviterUserId === 'string' &&
      transaction.metadata.inviterUserId.length > 0 && transaction.metadata.inviterUserId !== account.userId) {
      inviteeSignupCount += 1; sourceType = 'gift'; reason = 'legacy_invitee_registration';
    } else if (transaction.type === 'CHECK_IN') {
      sourceType = 'gift'; reason = 'daily_reward';
    } else if (matchedOrders.has(transaction.id)) {
      sourceType = 'recharge'; reason = 'recharge'; order = matchedOrders.get(transaction.id);
      assert(!lots.some(lot => lot.orderId === order.id), 'Recharge order already has a lot');
    } else assert.fail(`Unsupported orphan positive source: ${transaction.type}`);
    const grantedAt = new Date(transaction.createdAt).toISOString();
    const daily = reason === 'daily_reward';
    return { transactionId: transaction.id, lot: {
      id: lotIdFor(transaction.id), accountId: account.id, sourceType,
      validityType: daily && !vip ? 'fixed_window' : 'permanent', scopeType: 'global', scopeValue: null,
      totalAmount: transaction.amount, remainingAmount, status: remainingAmount > 0 ? 'active' : 'exhausted',
      grantedAt, activeAt: grantedAt, expiresAt: daily && !vip ? dailyRewardExpiresAt(grantedAt) : null,
      durationDays: daily && !vip ? 1 : null, priority: daily ? -200 : 0, orderId: order?.id || null,
      metadata: { reconciliation: REPAIR, originalTransactionId: transaction.id, reason,
        grantedBy: daily ? 'daily_reward' : reason, verifiedNoConsumptionHistory: true,
        historicalExpiredAmount: loss, ...(order ? { orderNo: order.orderNo } : {}) },
    } };
  });
  assert(signupCount <= 1, 'Duplicate signup grants');
  assert(inviteeSignupCount <= 1, 'Duplicate invitee signup grants');
  const coveredBalance = sum(lots.filter(lot => lot.status === 'active').map(lot => lot.remainingAmount));
  assert.equal(coveredBalance + sum(grants.map(grant => grant.lot.remainingAmount)), account.balance,
    'Active lots plus verified orphan remainder do not close to balance');
  return { status: grants.length ? 'planned' : 'no_orphans', accountId: account.id, marker: markerFor(account.id),
    grants, balanceBefore: account.balance, balanceAfter: account.balance, totalEarned: account.totalEarned,
    totalSpent: account.totalSpent, activeVip: vip, coveredBalance };
}

async function loadSnapshot(client, userId, { lock = false } = {}) {
  if (lock) await client.$queryRaw`SELECT id FROM "CreditAccount" WHERE "userId" = ${userId} FOR UPDATE`;
  const user = await client.user.findUniqueOrThrow({ where: { id: userId },
    select: { id: true, phone: true, vipEntitlementWhitelist: true } });
  const account = await client.creditAccount.findUnique({ where: { userId } });
  assert(account, 'Missing account');
  const [transactions, lots, orders, usages, subscriptions, policy] = await Promise.all([
    client.creditTransaction.findMany({ where: { accountId: account.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    client.creditLot.findMany({ where: { accountId: account.id }, orderBy: { id: 'asc' } }),
    client.paymentOrder.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    client.apiUsageRecord.findMany({ where: { userId }, select: { id: true, creditsUsed: true, responseStatus: true }, orderBy: { id: 'asc' } }),
    client.userMembershipSubscription.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    client.systemSetting.findUnique({ where: { key: 'membership_credit_policy' } }),
  ]);
  return { user, account, transactions, lots, orders, usages, subscriptions, policy };
}

async function applyPlan(tx, snapshot, plan, previewHash) {
  assert.equal(plan.status, 'planned', 'Only planned sources can be applied');
  for (const grant of plan.grants) {
    const original = snapshot.transactions.find(transaction => transaction.id === grant.transactionId);
    assert(original && !original.creditLotId, 'Original source already linked');
    await tx.creditLot.create({ data: { ...grant.lot, grantedAt: new Date(grant.lot.grantedAt),
      activeAt: new Date(grant.lot.activeAt), expiresAt: grant.lot.expiresAt ? new Date(grant.lot.expiresAt) : null } });
    const linked = await tx.creditTransaction.updateMany({ where: { id: original.id, accountId: snapshot.account.id, creditLotId: null },
      data: { creditLotId: grant.lot.id, metadata: { ...(original.metadata || {}), reconciliation: REPAIR, originalType: original.type } } });
    assert.equal(linked.count, 1, 'Original source changed during repair');
  }
  await tx.creditTransaction.create({ data: { id: plan.marker, accountId: snapshot.account.id,
    type: 'admin_adjust', businessType: 'credit_source_reconciliation', amount: 0,
    balanceBefore: snapshot.account.balance, balanceAfter: snapshot.account.balance,
    description: '历史免费积分与充值来源补齐（不改变余额）', metadata: { reconciliation: REPAIR,
      previewHash, snapshotHash: digest(snapshot), originalTransactionIds: plan.grants.map(grant => grant.transactionId),
      repairedLotIds: plan.grants.map(grant => grant.lot.id), preserveEarnedAndSpentCounters: true } } });
  const accountAfter = await tx.creditAccount.findUniqueOrThrow({ where: { id: snapshot.account.id } });
  for (const field of ['balance', 'totalEarned', 'totalSpent']) assert.equal(accountAfter[field], snapshot.account[field], `${field} changed`);
  return plan;
}

/** Must be called within a transaction; holds the account lock until outer commit. */
async function applyOne(tx, expectedSnapshot, { previewHash, now = new Date() } = {}) {
  const snapshot = await loadSnapshot(tx, expectedSnapshot.account.userId, { lock: true });
  // Completed repairs remain idempotent even if lifecycle operations ran later.
  if (snapshot.transactions.some(transaction => transaction.id === markerFor(snapshot.account.id))) {
    const marker = snapshot.transactions.find(transaction => transaction.id === markerFor(snapshot.account.id));
    assert.equal(marker.metadata?.previewHash, previewHash, 'Account was repaired under a different preview');
    return planRepair(snapshot, now);
  }
  assert.equal(digest(snapshot), digest(expectedSnapshot), 'Snapshot changed; preview again');
  const plan = planRepair(snapshot, now);
  if (plan.status !== 'planned') return plan;
  return applyPlan(tx, snapshot, plan, previewHash);
}

function codeFingerprint() {
  const files = [__filename, '../src/credits/credits.service.ts', '../src/credits/daily-reward-policy.ts',
    '../src/credits/free-credit-decay-policy.ts', '../src/credits/credit-lot-grants.ts',
    '../src/credits/legacy-referral-lots.ts', '../src/membership/membership.service.ts',
    '../src/business-policy/business-policy.service.ts', '../src/business-policy/business-policy.types.ts'];
  return digest({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, TZ: process.env.TZ || null,
    files: files.map(file => ({ file: path.basename(file), hash: digest(fs.readFileSync(path.resolve(__dirname, file), 'utf8')) })) });
}
function privateDirectory() {
  assert(process.env.PRIVATE_DIR && path.isAbsolute(process.env.PRIVATE_DIR), 'PRIVATE_DIR must be an absolute private backup directory');
  const directory = process.env.PRIVATE_DIR;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    'PRIVATE_DIR must be a real directory with mode 0700');
  if (typeof process.getuid === 'function') assert.equal(stat.uid, process.getuid(), 'PRIVATE_DIR must be owned by the current user');
  return directory;
}
function writePrivate(file, value) {
  const handle = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(handle, JSON.stringify(canonical(value), null, 2)); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('PRIVATE_DIR=/absolute/private TZ=Asia/Shanghai node scripts/repair-legacy-free-credit-sources.cjs [PHONE ... | --all]\nApply reviewed sources only: --apply --preview=/absolute/private/preview.json --expected=HASH\nDoes not run expiry or decay. Exports applyOne for same-transaction production lifecycle processing.'); return;
  }
  const directory = privateDirectory();
  require('dotenv').config({ quiet: true });
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (args.includes('--apply')) {
      const previewPath = args.find(arg => arg.startsWith('--preview='))?.slice(10);
      const expected = args.find(arg => arg.startsWith('--expected='))?.slice(11);
      assert(previewPath && path.isAbsolute(previewPath) && path.dirname(previewPath) === directory, 'Preview must be inside PRIVATE_DIR');
      const report = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
      const { hash, ...payload } = report;
      assert.equal(hash, digest(payload), 'Preview file integrity mismatch'); assert.equal(expected, hash, 'Expected reviewed preview hash required');
      assert.equal(report.repair, REPAIR, 'Wrong repair preview'); assert.equal(report.codeFingerprint, codeFingerprint(), 'Code or timezone changed; preview again');
      for (const entry of report.entries.filter(item => item.plan?.status === 'planned')) {
        const backupPath = path.join(directory, `${REPAIR}-${hash}-${entry.snapshot.account.id}-apply-${crypto.randomUUID()}.json`);
        writePrivate(backupPath, { previewHash: hash, snapshot: entry.snapshot, plan: entry.plan });
        const result = await prisma.$transaction(async tx => {
          assert.equal(codeFingerprint(), report.codeFingerprint, 'Code changed during apply');
          const currentPlan = planRepair(entry.snapshot, new Date());
          assert.equal(digest(currentPlan), digest(entry.plan), 'VIP eligibility changed; preview again');
          return applyOne(tx, entry.snapshot, { previewHash: hash });
        }, { isolationLevel: 'Serializable', timeout: 60000 });
        console.log(JSON.stringify({ accountId: entry.snapshot.account.id, status: result.status, backup: backupPath }));
      }
      return;
    }
    const phones = args.filter(arg => /^1\d{10}$/.test(arg));
    assert(args.includes('--all') || phones.length, 'Provide phone numbers or --all');
    assert.equal(new Set(phones).size, phones.length, 'Duplicate phone');
    const report = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const users = await tx.user.findMany({ where: args.includes('--all') ? { creditAccount: { transactions: { some: {
        creditLotId: null, amount: { gt: 0 }, OR: [{ type: 'CHECK_IN' }, { type: 'earn',
          description: { in: ['新用户注册赠送积分', '被邀请注册额外赠送积分'] } }],
      } } } } : { phone: { in: phones } }, select: { id: true }, orderBy: { id: 'asc' } });
      if (!args.includes('--all')) assert.equal(users.length, phones.length, 'One or more requested users do not exist');
      const entries = [];
      const now = new Date();
      for (const user of users) {
        let snapshot;
        try { snapshot = await loadSnapshot(tx, user.id); entries.push({ snapshot, plan: planRepair(snapshot, now) }); }
        catch (error) { entries.push({ userId: user.id, ...(snapshot ? { snapshot } : {}), skipReason: error.message }); }
      }
      return { repair: REPAIR, createdAt: now.toISOString(), codeFingerprint: codeFingerprint(), entries };
    }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
    const hash = digest(report);
    const previewPath = path.join(directory, `${REPAIR}-${hash}-preview.json`);
    writePrivate(previewPath, { ...report, hash });
    console.log(JSON.stringify({ mode: 'preview', hash, preview: previewPath,
      planned: report.entries.filter(entry => entry.plan?.status === 'planned').length,
      skipped: report.entries.filter(entry => entry.skipReason).length,
      unchanged: report.entries.filter(entry => entry.plan && entry.plan.status !== 'planned').length }, null, 2));
  } finally { await prisma.$disconnect(); }
}

module.exports = { REPAIR, planRepair, loadSnapshot, applyPlan, applyOne, digest, codeFingerprint, dailyRewardExpiresAt, markerFor, lotIdFor };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
