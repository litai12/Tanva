// Audited partial source attribution. No consumption priority is inferred.
// node scripts/run-audited-legacy-free-credit-repair.cjs preview|apply PRIVATE_DIR
// Proven suffixes, exact single-origin intervals and closed zero pools qualify.
// Unknown balances, existing lots, and missed historical decay remain untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const audit = require('./scan-legacy-free-credit-evidence.cjs');
const replay = require('./audit-legacy-free-credit-sources.cjs');
const source = require('./repair-legacy-free-credit-sources.cjs');
const helpers = require('./run-legacy-free-credit-repair.cjs');
const { hash, normalizedOutcome, privateDirectory, writePrivate, readPrivate, clockContext, markExpiredLegacyCheckIns } = helpers;
const REPAIR = 'audited-free-credit-sources-v1';
const BACKEND = path.resolve(__dirname, '..');
const json = value => JSON.parse(JSON.stringify(value));
const markerFor = id => `${REPAIR}:${id}`;
const lotIdFor = id => `${REPAIR}:lot:${id}`;
function outcomeHash(before, after) {
  const normalized = normalizedOutcome(before, after);
  // Avoid a self-referential digest while binding the marker to every other
  // resulting financial and provenance field.
  for (const row of normalized.transactions) if (row.metadata?.reconciliation === REPAIR) delete row.metadata.outcomeHash;
  return hash(normalized);
}
const wrap = (target, overrides) => new Proxy(target, { get(obj, key) {
  if (Object.hasOwn(overrides, key)) return overrides[key];
  return typeof obj[key] === 'function' ? obj[key].bind(obj) : obj[key];
} });

function validateKnownLots(snapshot) {
  for (const lot of snapshot.lots) {
    assert.equal(lot.accountId, snapshot.account.id, 'Foreign existing lot');
    assert(Number.isSafeInteger(lot.totalAmount) && Number.isSafeInteger(lot.remainingAmount) && lot.remainingAmount >= 0 && lot.remainingAmount <= lot.totalAmount, 'Invalid existing lot amounts');
    assert(['active', 'exhausted', 'expired'].includes(lot.status) && (lot.status === 'active' || lot.remainingAmount === 0), 'Inactive existing lot retains balance');
    const grants = snapshot.transactions.filter(row => row.amount > 0 && row.type !== 'refund' && row.creditLotId === lot.id);
    assert(grants.length === 1 && grants[0].amount === lot.totalAmount, 'Existing lot does not have one exact original grant');
  }
}

function validateSource(snapshot, row, evidence) {
  assert(!row.creditLotId && row.accountId === snapshot.account.id && Number.isSafeInteger(row.amount) && row.amount > 0, 'Invalid orphan source');
  assert(Number.isSafeInteger(row.expiredAmount) && row.expiredAmount >= 0 && row.expiredAmount <= row.amount, 'Invalid source expired amount');
  assert(!snapshot.lots.some(lot => lot.metadata?.originalTransactionId === row.id), 'Orphan source is already represented by an existing lot');
  if (row.type === 'CHECK_IN') return { type: 'gift', reason: 'daily_reward' };
  if (row.type === 'earn' && row.description === '新用户注册赠送积分') return { type: 'promo', reason: 'signup_bonus' };
  if (row.type === 'earn' && row.description === '被邀请注册额外赠送积分' &&
    typeof row.metadata?.inviterUserId === 'string' && row.metadata.inviterUserId && row.metadata.inviterUserId !== snapshot.account.userId) return { type: 'gift', reason: 'legacy_invitee_registration' };
  if (row.type === 'earn' && row.description === '充值') {
    assert(evidence.paidSources.find(entry => entry.transactionId === row.id)?.exactPaidOrder, 'Paid source lacks an exact paid order');
    const refs = [row.orderId, row.metadata?.orderId, row.metadata?.orderNo].filter(Boolean);
    const orders = snapshot.orders.filter(order => refs.includes(order.id) || refs.includes(order.orderNo));
    assert(orders.length === 1 && orders[0].userId === snapshot.account.userId && orders[0].status === 'paid' &&
      orders[0].orderType === 'recharge' && !orders[0].teamId && !orders[0].membershipPlanId && !orders[0].subscriptionId &&
      orders[0].paidAt && Number(orders[0].amount) > 0 && orders[0].credits === row.amount, 'Invalid personal recharge order');
    assert(!snapshot.lots.some(lot => lot.orderId === orders[0].id), 'Paid order is already represented by a lot');
    assert(snapshot.transactions.filter(t => t.amount > 0 && t.type === 'earn' && t.description === '充值' &&
      [t.orderId, t.metadata?.orderId, t.metadata?.orderNo].some(ref => ref && [orders[0].id, orders[0].orderNo].includes(ref))).length === 1, 'Duplicate paid order grant');
    return { type: 'recharge', reason: 'recharge', orderId: orders[0].id };
  }
  assert.fail('Unsupported partial repair source');
}

function planRepair(snapshot, now = new Date()) {
  const marker = snapshot.transactions.find(row => row.id === markerFor(snapshot.account.id));
  if (marker) {
    assert(marker.type === 'admin_adjust' && marker.amount === 0 && marker.metadata?.reconciliation === REPAIR, 'Invalid audited repair marker');
    const ids = marker.metadata.originalTransactionIds;
    assert(Array.isArray(ids) && ids.length > 0 && ids.every(id => snapshot.transactions.find(t => t.id === id)?.creditLotId === lotIdFor(id) && snapshot.lots.some(l => l.id === lotIdFor(id))), 'Incomplete audited repair marker');
    return { status: 'already_repaired', accountId: snapshot.account.id, marker: marker.id, grants: [] };
  }
  // The original two fully repaired accounts are outside this partial operation.
  if (snapshot.transactions.some(row => row.id === source.markerFor(snapshot.account.id))) return { status: 'excluded_original_repair', accountId: snapshot.account.id, grants: [] };
  assert(snapshot.user.id === snapshot.account.userId, 'Snapshot owner mismatch');
  for (const key of ['balance', 'totalEarned', 'totalSpent']) assert(Number.isSafeInteger(snapshot.account[key]) && snapshot.account[key] >= 0, 'Invalid account counter');
  const evidence = audit.analyze(snapshot);
  validateKnownLots(snapshot);
  const strictLedger = evidence.issues.length === 0 && evidence.categories.allLotRemaindersReplay;
  const allOldLotsEmpty = snapshot.lots.every(lot => lot.remainingAmount === 0);
  const allSuffixProofs = replay.proveIsolatedSuffix(snapshot);
  // An authenticated suffix can establish a new CHECK_IN independently of a
  // missing earlier wallet entry. Empty old lots cannot claim any of its funds.
  const gapSuffixProofs = !strictLedger && allOldLotsEmpty ? allSuffixProofs.filter(proof =>
    snapshot.transactions.find(row => row.id === proof.transactionId)?.type === 'CHECK_IN') : [];
  assert(strictLedger || gapSuffixProofs.length > 0, 'Ledger or audited deduction evidence does not close and no independent suffix exists');
  const zeroPool = evidence.counters.unbatchedBalance === 0;
  const suffixProofs = zeroPool ? [] : allSuffixProofs;
  if (zeroPool) {
    assert(!snapshot.lots.some(lot => lot.metadata?.legacyReferralUnverified === true || lot.metadata?.grantedBy === 'legacy_referral_migration'), 'Zero pool includes migrated mixed source balance');
    assert(!evidence.unknownEvents.some(event => event.refund), 'Zero pool has an unattributed refund');
    assert(!snapshot.transactions.some(row => row.amount > 0 && ['admin_adjust', 'adjustment'].includes(row.type) &&
      (!row.creditLotId || Object.keys(row.metadata || {}).some(key => key !== 'adminId'))), 'Zero pool has an unverified positive adjustment');
  }
  const candidates = strictLedger ? evidence.sourceRemainders.filter(entry => zeroPool || (entry.exactlyTraceable && suffixProofs.some(proof => proof.transactionId === entry.transactionId && proof.remaining === entry.possibleRemainingBeforeAnonymous)))
    : gapSuffixProofs.map(proof => ({ transactionId: proof.transactionId, possibleRemainingBeforeAnonymous: proof.remaining, unknownLaterEvents: 0, independentGapSuffix: true }));
  let promoProof;
  // A single unbatched origin eliminates allocation ambiguity without using
  // spend priority. The interval replay must certify every source and lot.
  const unlinkedPositiveOrigins = snapshot.transactions.filter(row => row.amount > 0 && row.type !== 'refund' && !row.creditLotId);
  if (strictLedger && allOldLotsEmpty && unlinkedPositiveOrigins.length === 1 &&
    unlinkedPositiveOrigins[0].type === 'earn' && unlinkedPositiveOrigins[0].description === '新用户注册赠送积分' &&
    !snapshot.lots.some(lot => lot.metadata?.legacyReferralUnverified === true || lot.metadata?.allocatedFromLegacyBalance !== undefined || lot.metadata?.grantedBy === 'legacy_referral_migration') &&
    snapshot.orders.some(order => order.status === 'paid')) {
    const report = replay.planAudit(snapshot, now);
    const candidate = report.sources.find(entry => entry.transactionId === unlinkedPositiveOrigins[0].id);
    if (!report.issues.some(issue => issue.severity === 'conflict') && candidate?.kind === 'signup_bonus' &&
      candidate.knownUntrackedRemaining > 0 && candidate.remaining.lower === candidate.remaining.upper &&
      candidate.untrackedRemaining.lower === candidate.untrackedRemaining.upper && candidate.remaining.upper === candidate.untrackedRemaining.upper &&
      candidate.knownUntrackedRemaining === evidence.counters.unbatchedBalance) {
      promoProof = { method: 'single_orphan_origin_exact_interval', evidenceVersion: report.version, source: candidate };
      const existing = candidates.find(entry => entry.transactionId === candidate.transactionId);
      if (existing) existing.exactPromoInterval = true;
      else candidates.push({ transactionId: candidate.transactionId, possibleRemainingBeforeAnonymous: candidate.knownUntrackedRemaining, unknownLaterEvents: 0, exactPromoInterval: true });
    }
  }
  const activeVip = snapshot.user.vipEntitlementWhitelist === true || snapshot.subscriptions.some(subscription =>
    subscription.status === 'active' && +new Date(subscription.currentPeriodStartAt) <= +now && +new Date(subscription.currentPeriodEndAt) > +now);
  const grants = [], skippedSources = [];
  for (const entry of candidates) {
    const row = snapshot.transactions.find(row => row.id === entry.transactionId);
    // Unknown source types remain in their existing pool. No source priority is used.
    const target = row.type === 'CHECK_IN' || (row.type === 'earn' && ['新用户注册赠送积分', '被邀请注册额外赠送积分', '充值'].includes(row.description));
    if (!target) continue;
    if (!zeroPool && !entry.exactPromoInterval) {
      const sourceAt = +new Date(row.createdAt);
      const later = snapshot.transactions.filter(t => +new Date(t.createdAt) >= sourceAt && t.id !== row.id);
      if (later.some(t => t.amount > 0 && ['admin_adjust', 'adjustment'].includes(t.type))) { skippedSources.push({ transactionId: row.id, reason: 'later_positive_adjustment' }); continue; }
      if (snapshot.lots.some(lot => lot.metadata?.grantedBy === 'legacy_referral_migration' &&
        +new Date(lot.createdAt) >= sourceAt)) { skippedSources.push({ transactionId: row.id, reason: 'later_mixed_balance_migration' }); continue; }
    }
    let classification;
    try { classification = validateSource(snapshot, row, evidence); }
    catch (error) { skippedSources.push({ transactionId: row.id, reason: error.message }); continue; }
    const remainingAmount = zeroPool ? 0 : entry.possibleRemainingBeforeAnonymous;
    assert(Number.isSafeInteger(remainingAmount) && remainingAmount >= 0 && remainingAmount <= row.amount, 'Invalid audited remaining source amount');
    // A positive promotion additionally requires the exact single-origin proof
    // and the guarded targeted decay path below.
    if (remainingAmount > 0 && !['daily_reward', 'recharge'].includes(classification.reason) && !entry.exactPromoInterval) continue;
    assert(remainingAmount === 0 || entry.unknownLaterEvents === 0, 'Later source has an anonymous debit or refund');
    const daily = classification.reason === 'daily_reward';
    const grantedAt = new Date(row.createdAt).toISOString();
    const proofMethod = zeroPool ? 'closed_zero_residual_pool' : entry.exactPromoInterval ? 'single_orphan_origin_exact_interval' : entry.independentGapSuffix ? 'independent_suffix_after_earlier_gap' : 'no_anonymous_events_after_source';
    grants.push({ transactionId: row.id, proof: proofMethod,
      sourceProof: zeroPool ? { method: 'closed_zero_residual_pool', activeLotBalance: evidence.counters.activeLotBalance } : entry.exactPromoInterval ? promoProof : suffixProofs.find(proof => proof.transactionId === row.id), lot: {
      id: lotIdFor(row.id), accountId: snapshot.account.id, sourceType: classification.type,
      validityType: daily && !activeVip ? 'fixed_window' : 'permanent', scopeType: 'global', scopeValue: null,
      totalAmount: row.amount, remainingAmount, status: remainingAmount > 0 ? 'active' : 'exhausted', grantedAt, activeAt: grantedAt,
      expiresAt: daily && !activeVip ? source.dailyRewardExpiresAt(grantedAt) : null,
      durationDays: daily && !activeVip ? 1 : null, priority: daily ? -200 : 0, orderId: classification.orderId || null,
      metadata: { reconciliation: REPAIR, originalTransactionId: row.id, reason: classification.reason,
        grantedBy: classification.reason, evidenceMethod: proofMethod },
    } });
  }
  const total = grants.reduce((n, grant) => n + grant.lot.remainingAmount, 0);
  assert(total <= evidence.counters.unbatchedBalance, 'Audited sources exceed unbatched balance');
  const sourceIds = new Set(grants.map(g => g.transactionId));
  const runDecay = grants.some(g => g.lot.sourceType === 'promo' && g.lot.remainingAmount > 0);
  if (runDecay) {
    assert.strictEqual(evidence.counters.unbatchedBalance - total, 0, 'Targeted decay cannot touch an unknown pool');
    assert(unlinkedPositiveOrigins.length === grants.length && unlinkedPositiveOrigins.every(row => sourceIds.has(row.id)), 'Targeted decay has another unlinked positive origin');
    assert(!snapshot.transactions.some(row => row.type === 'REFERRAL_REWARD' && row.amount > 0 && !row.creditLotId), 'Targeted decay must not materialize another referral source');
    assert(snapshot.orders.some(order => order.status === 'paid'), 'Targeted decay requires the paid-order protection against legacy fallback');
  }
  const latentPaidUpperBound = evidence.sourceRemainders.filter(row => row.sourceType === 'paid_recharge' && !sourceIds.has(row.transactionId))
    .reduce((n, row) => n + Math.max(0, row.possibleRemainingBeforeAnonymous), 0);
  return { status: grants.length ? 'planned' : 'no_proven_target_sources', accountId: snapshot.account.id, marker: markerFor(snapshot.account.id),
    grants, skippedSources, activeVip, balanceBefore: snapshot.account.balance, totalEarned: snapshot.account.totalEarned, totalSpent: snapshot.account.totalSpent,
    proof: zeroPool ? 'closed_zero_residual_pool' : runDecay ? 'single_orphan_origin_exact_interval' : !strictLedger ? 'independent_suffix_after_earlier_gap' : 'independently_proven_late_sources',
    unbatchedBalance: evidence.counters.unbatchedBalance, remainingUnknownPool: evidence.counters.unbatchedBalance - total,
    latentPaidUpperBound, runDecay, decay: runDecay ? 'targeted_proven_promo_today_only' : 'not_run_unknown_sources_protected' };
}

async function applyPlan(tx, snapshot, plan, beforeHash) {
  assert.equal(plan.status, 'planned');
  for (const grant of plan.grants) {
    const row = snapshot.transactions.find(row => row.id === grant.transactionId);
    await tx.creditLot.create({ data: { ...grant.lot, grantedAt: new Date(grant.lot.grantedAt), activeAt: new Date(grant.lot.activeAt), expiresAt: grant.lot.expiresAt ? new Date(grant.lot.expiresAt) : null } });
    const linked = await tx.creditTransaction.updateMany({ where: { id: row.id, accountId: snapshot.account.id, creditLotId: null },
      data: { creditLotId: grant.lot.id, metadata: { ...(row.metadata || {}), reconciliation: REPAIR, originalType: row.type, evidenceMethod: grant.proof } } });
    assert.equal(linked.count, 1, 'Original source changed');
  }
  await tx.creditTransaction.create({ data: { id: plan.marker, accountId: snapshot.account.id, type: 'admin_adjust', businessType: 'credit_source_reconciliation',
    amount: 0, balanceBefore: snapshot.account.balance, balanceAfter: snapshot.account.balance, description: '历史积分独立来源核验补齐（不改变余额）',
    metadata: { reconciliation: REPAIR, beforeHash, snapshotHash: hash(snapshot), originalTransactionIds: plan.grants.map(g => g.transactionId),
      repairedLotIds: plan.grants.map(g => g.lot.id), proof: plan.proof, preserveEarnedAndSpentCounters: true, decayNotRun: !plan.runDecay } } });
}

function loadRuntime() {
  const { CreditsService } = require('../dist/credits/credits.service');
  const { MembershipService } = require('../dist/membership/membership.service');
  const { BusinessPolicyService } = require('../dist/business-policy/business-policy.service');
  const { getDailyRewardBusinessDayAnchor } = require('../dist/credits/daily-reward-policy');
  const files = new Set([__filename, require.resolve('./scan-legacy-free-credit-evidence.cjs'), require.resolve('./repair-legacy-free-credit-sources.cjs'), require.resolve('./run-legacy-free-credit-repair.cjs'),
    require.resolve('./audit-legacy-free-credit-sources.cjs'), ...Object.keys(require.cache).filter(file => file.startsWith(`${BACKEND}${path.sep}dist${path.sep}`))]);
  const fingerprints = Object.fromEntries([...files].sort().map(file => [path.relative(BACKEND, file), crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  assert.equal(typeof CreditsService.prototype.expireDailyRewardLotsForLockedAccount, 'function');
  return { CreditsService, MembershipService, BusinessPolicyService, getDailyRewardBusinessDayAnchor, fingerprints };
}

function assertCurrent(runtime, clock) {
  assert.deepEqual(clockContext(new Date(), runtime.getDailyRewardBusinessDayAnchor), clock, 'Business day or timezone changed; preview again');
  for (const [file, fingerprint] of Object.entries(runtime.fingerprints)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(BACKEND, file))).digest('hex'), fingerprint, 'Service or repair code changed; preview again');
}

async function loadByAccount(tx, accountId) {
  const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: accountId }, select: { userId: true } });
  return source.loadSnapshot(tx, account.userId);
}

async function execute(tx, before, plan, now, runtime, beforeHash) {
  await applyPlan(tx, before, plan, beforeHash);
  const sourceAfter = await loadByAccount(tx, before.account.id);
  for (const key of ['balance', 'totalEarned', 'totalSpent']) assert.equal(sourceAfter.account[key], before.account[key], 'Source repair changed account financial fields');
  const ids = plan.grants.filter(g => g.lot.metadata.reason === 'daily_reward').map(g => g.lot.id);
  // Expiry sees only newly proven CHECK_IN lots.
  const scoped = wrap(tx, { creditLot: wrap(tx.creditLot, {
    findMany: args => tx.creditLot.findMany({ ...args, where: { AND: [args.where || {}, { accountId: before.account.id, id: { in: ids } }] } }),
  }) });
  const credits = new runtime.CreditsService(scoped, { get: () => undefined }, new runtime.BusinessPolicyService(scoped), undefined);
  const expiry = await credits.expireDailyRewardLotsForLockedAccount(scoped, sourceAfter.account, now);
  await markExpiredLegacyCheckIns(tx, sourceAfter, await loadByAccount(tx, before.account.id));
  let decay = { affectedUsers: 0, decayedCredits: 0, updatedLots: 0 }, membership;
  if (plan.runDecay) {
    assert.equal(plan.remainingUnknownPool, 0, 'Cannot decay an unknown pool');
    assert(before.orders.some(order => order.status === 'paid'), 'Legacy fallback protection is missing');
    assert(!before.transactions.some(row => row.type === 'REFERRAL_REWARD' && row.amount > 0 && !row.creditLotId), 'Another referral source could be materialized');
    const promoIds = plan.grants.filter(g => g.lot.sourceType === 'promo' && g.lot.remainingAmount > 0).map(g => g.lot.id);
    let decayScoped;
    decayScoped = wrap(tx, {
      creditAccount: wrap(tx.creditAccount, { findMany: args => tx.creditAccount.findMany({ ...args, where: { AND: [args.where || {}, { id: before.account.id }] } }) }),
      creditLot: wrap(tx.creditLot, {
        findMany: args => tx.creditLot.findMany({ ...args, where: { AND: [args.where || {}, { accountId: before.account.id, id: { in: promoIds } }] } }),
        updateMany: args => tx.creditLot.updateMany({ ...args, where: { AND: [args.where || {}, { accountId: before.account.id, id: { in: promoIds } }] } }),
        // aggregate remains global to this account: the real service needs all
        // existing active lot balances to protect paid and other sources.
      }),
      $transaction: fn => fn(decayScoped),
    });
    membership = new runtime.MembershipService(decayScoped, new runtime.BusinessPolicyService(decayScoped));
    decay = await membership.decayDailyGiftCredits(now);
    const maximum = plan.grants.filter(g => g.lot.sourceType === 'promo').reduce((n, g) => n + g.lot.remainingAmount, 0);
    assert(decay.decayedCredits >= 0 && decay.decayedCredits <= maximum, 'Decay exceeded the proven promo balance');
    const state = await loadByAccount(tx, before.account.id);
    const oldIds = new Set(sourceAfter.transactions.map(row => row.id));
    const created = state.transactions.filter(row => !oldIds.has(row.id) && row.businessType === 'free_credit_decay');
    assert.equal(created.length, decay.decayedCredits > 0 ? 1 : 0);
    assert(created.every(row => row.amount === -decay.decayedCredits && row.metadata.deductions.every(d => d.kind === 'lot' && promoIds.includes(d.lotId))), 'Decay targeted another source');
  }
  let after = await loadByAccount(tx, before.account.id);
  assert.equal(after.account.balance, before.account.balance - expiry.expiredCredits - decay.decayedCredits);
  assert(expiry.expiredCredits <= plan.grants.filter(g => g.lot.metadata.reason === 'daily_reward').reduce((n, g) => n + g.lot.remainingAmount, 0), 'Expiry consumed unknown or paid balance');
  for (const key of ['totalEarned', 'totalSpent']) assert.equal(after.account[key], before.account[key]);
  for (const oldLot of before.lots) assert.deepEqual(json(after.lots.find(l => l.id === oldLot.id)), json(oldLot), 'Existing lot changed');
  for (const grant of plan.grants.filter(g => g.lot.metadata.reason !== 'daily_reward' && !(plan.runDecay && g.lot.sourceType === 'promo'))) {
    const current = after.lots.find(l => l.id === grant.lot.id);
    assert.equal(current.remainingAmount, grant.lot.remainingAmount, 'Paid or zero source balance changed');
  }
  for (const old of before.transactions) {
    const current = after.transactions.find(row => row.id === old.id);
    for (const key of ['type', 'amount', 'balanceBefore', 'balanceAfter', 'createdAt']) assert.deepEqual(json(current[key]), json(old[key]), 'Historical financial transaction changed');
  }
  const digest = outcomeHash(before, after);
  const marker = after.transactions.find(row => row.id === plan.marker);
  await tx.creditTransaction.update({ where: { id: plan.marker }, data: { metadata: { ...marker.metadata, outcomeHash: digest } } });
  after = await loadByAccount(tx, before.account.id);
  const secondExpiry = await credits.expireDailyRewardLotsForLockedAccount(scoped, after.account, now);
  assert.equal(secondExpiry.expiredCredits, 0);
  assert.equal(secondExpiry.expiredLots, 0);
  const secondDecay = membership ? await membership.decayDailyGiftCredits(now) : { affectedUsers: 0, decayedCredits: 0, updatedLots: 0 };
  assert.equal(secondDecay.decayedCredits, 0);
  assert.equal(secondDecay.updatedLots, 0);
  assert.deepEqual(json(await loadByAccount(tx, before.account.id)), json(after), 'Second targeted expiry changed state');
  return { result: { sourceGrants: plan.grants.length, proof: plan.proof, balanceBefore: before.account.balance, balanceAfter: after.account.balance,
    expiry, secondExpiry, decayResult: decay, secondDecay, decayedCredits: decay.decayedCredits, decay: plan.decay,
    unknownPoolProtected: plan.remainingUnknownPool, latentPaidUpperBound: plan.latentPaidUpperBound,
    outcomeHash: outcomeHash(before, after) }, after };
}

async function main() {
  const [mode, rawDir, ...extra] = process.argv.slice(2);
  assert(['preview', 'apply'].includes(mode) && rawDir && !extra.length, 'Usage: preview|apply PRIVATE_DIR');
  const dir = privateDirectory(rawDir), previewFile = path.join(dir, 'preview.json');
  if (mode === 'preview') assert(!fs.existsSync(previewFile), 'Use a new private directory for a new preview');
  require('dotenv').config({ path: path.join(BACKEND, '.env'), quiet: true });
  const runtime = loadRuntime(), now = new Date(), clock = clockContext(now, runtime.getDailyRewardBusinessDayAnchor);
  const expected = mode === 'apply' ? readPrivate(previewFile) : null;
  if (expected) {
    assert.equal(expected.repair, REPAIR);
    assert.equal(expected.previewHash, hash({ ...expected, previewHash: undefined }), 'Preview integrity failed');
    assert.deepEqual(expected.fingerprints, runtime.fingerprints, 'Repair code changed');
    assert.deepEqual(expected.clock, clock, 'Preview is from a different business day or timezone');
    assert(!expected.results.some(row => row.status === 'error'), 'Preview has errors; create a clean preview');
  }
  const runId = `${Date.now()}-${crypto.randomUUID()}`, auditEntries = [], results = [], skipCounts = {};
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const candidates = expected ? expected.results.filter(row => row.status === 'preview').map(row => ({ accountId: row.accountId, expected: row })) : [];
    if (!expected) {
      const accounts = await db.creditAccount.findMany({ where: { balance: { gt: 0 }, transactions: { some: {
        creditLotId: null, amount: { gt: 0 }, isExpired: false, OR: [{ type: 'CHECK_IN' }, { type: 'earn', description: { in: ['新用户注册赠送积分', '被邀请注册额外赠送积分'] } }],
      } } }, select: { id: true }, orderBy: { id: 'asc' } });
      for (const { id: accountId } of accounts) {
        const before = await db.$transaction(async tx => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return loadByAccount(tx, accountId); }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
        let plan, skipReason;
        try { plan = planRepair(before, now); } catch (error) { skipReason = error.message; }
        const beforeHash = hash(before), planHash = plan ? hash(plan) : null, file = path.join(dir, `evidence-${accountId}-${runId}.json`);
        writePrivate(file, { at: now.toISOString(), before, plan, beforeHash, planHash, skipReason });
        auditEntries.push({ accountId, status: plan?.status || 'skipped', beforeHash, planHash, file, skipReason });
        if (plan?.status === 'planned') candidates.push({ accountId, beforeHash, planHash });
        else { const code = skipReason ? 'evidence_requires_further_audit' : plan?.status || 'not_eligible'; skipCounts[code] = (skipCounts[code] || 0) + 1; }
      }
    }
    assert.equal(new Set(candidates.map(row => row.accountId)).size, candidates.length, 'Duplicate candidates');
    for (const candidate of candidates) {
      const { accountId } = candidate, reviewed = candidate.expected || candidate;
      assert(/^[0-9a-f-]{36}$/i.test(accountId), 'Invalid account ID');
      const rollback = new Error('PREVIEW_ROLLBACK');
      let receipt;
      try {
        receipt = await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE id = ${accountId} FOR UPDATE`;
          assertCurrent(runtime, clock);
          const before = await loadByAccount(tx, accountId), plan = planRepair(before, now);
          if (mode === 'apply' && plan.status === 'already_repaired') {
            const old = readPrivate(reviewed.backupFile), marker = before.transactions.find(row => row.id === markerFor(accountId));
            assert.equal(hash(old.before), reviewed.beforeHash);
            assert.equal(marker.metadata.beforeHash, reviewed.beforeHash, 'Different repair preview');
            assert.equal(marker.metadata.outcomeHash, reviewed.result.outcomeHash, 'Marker outcome differs from reviewed result');
            for (const key of ['user', 'orders', 'usages', 'subscriptions', 'policy']) assert.deepEqual(json(before[key]), json(old.before[key]), 'Source or entitlement changed after repair');
            assert.equal(outcomeHash(old.before, before), reviewed.result.outcomeHash, 'Applied account changed; reconcile receipts');
            return { ...reviewed, status: 'already_applied' };
          }
          assert.equal(plan.status, 'planned');
          assert.equal(hash(before), reviewed.beforeHash, 'Account or policy changed; preview again');
          assert.equal(hash(plan), reviewed.planHash, 'Plan changed; preview again');
          const backupFile = path.join(dir, `${mode}-before-${accountId}-${runId}.json`);
          writePrivate(backupFile, { at: now.toISOString(), clock, fingerprints: runtime.fingerprints, before, plan, beforeHash: reviewed.beforeHash });
          const outcome = await execute(tx, before, plan, now, runtime, reviewed.beforeHash);
          if (candidate.expected) assert.deepEqual(json(outcome.result), candidate.expected.result, 'Actual outcome differs from preview; rolled back');
          assertCurrent(runtime, clock);
          receipt = { accountId, status: mode === 'preview' ? 'preview' : 'applied', beforeHash: reviewed.beforeHash, planHash: reviewed.planHash, result: outcome.result, backupFile };
          writePrivate(path.join(dir, `${mode}-prepared-${accountId}-${runId}.json`), { receipt, after: outcome.after });
          if (mode === 'preview') throw rollback;
          return receipt;
        }, { isolationLevel: 'Serializable', timeout: 60000 });
        writePrivate(path.join(dir, `receipt-${accountId}-${runId}.json`), receipt);
        results.push(receipt);
      } catch (error) {
        if (error === rollback) results.push(receipt);
        else { writePrivate(path.join(dir, `error-${accountId}-${runId}.json`), { message: error.message, stack: error.stack, accountId }); results.push({ accountId, status: 'error', code: 'validation_or_service_failed' }); }
      }
    }
    const report = { repair: REPAIR, at: now.toISOString(), mode, clock, fingerprints: runtime.fingerprints, auditEntries: expected?.auditEntries || auditEntries, skipCounts: expected?.skipCounts || skipCounts, results };
    if (mode === 'preview') report.previewHash = hash(report);
    const file = mode === 'preview' ? previewFile : path.join(dir, `apply-${runId}.json`);
    writePrivate(file, report);
    console.log(JSON.stringify({ file, snapshotAt: now.toISOString(), scanned: report.auditEntries.length, candidates: results.length,
      proofCounts: Object.fromEntries(['closed_zero_residual_pool', 'independently_proven_late_sources', 'single_orphan_origin_exact_interval', 'independent_suffix_after_earlier_gap'].map(proof => [proof, results.filter(row => row.result?.proof === proof).length])),
      lots: results.reduce((n, row) => n + (row.result?.sourceGrants || 0), 0), expiredCredits: results.reduce((n, row) => n + (row.result?.expiry.expiredCredits || 0), 0),
      decayedCredits: results.reduce((n, row) => n + (row.result?.decayedCredits || 0), 0), skipCounts: report.skipCounts, errors: results.filter(row => row.status === 'error').map(row => ({ accountId: row.accountId, code: row.code })) }, null, 2));
    if (results.some(row => row.status === 'error')) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}

module.exports = { REPAIR, planRepair, applyPlan, execute, loadRuntime, markerFor, lotIdFor, outcomeHash };
if (require.main === module) main().catch(() => { console.error('Audited operation failed; inspect private evidence and receipts.'); process.exitCode = 1; });
