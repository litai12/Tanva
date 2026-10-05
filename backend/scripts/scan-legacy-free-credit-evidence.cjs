// Offline, read-only audit of restricted snapshots. This file never creates a DB client.
// node scripts/scan-legacy-free-credit-evidence.cjs SNAPSHOT_DIR NEW_PRIVATE_REPORT_DIR
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { hash, writePrivate, privateDirectory, readPrivate } = require('./run-legacy-free-credit-repair.cjs');
const increment = (object, key, amount = 1) => { object[key] = (object[key] || 0) + amount; };
const sum = rows => rows.reduce((n, row) => n + row.amount, 0);

function sourceType(row) {
  if (row.type === 'CHECK_IN' || row.type === 'daily_reward') return 'check_in';
  if (row.type === 'earn' && row.description === '新用户注册赠送积分') return 'registration';
  if (row.type === 'earn' && row.description === '被邀请注册额外赠送积分') return 'invitee_registration';
  if (row.type === 'earn' && row.description === '充值') return 'paid_recharge';
  if (row.type === 'REFERRAL_REWARD') return 'referral';
  if (row.type === 'refund') return 'refund';
  if (row.type === 'admin_adjust' || row.type === 'adjustment') return 'adjustment';
  if (row.type === 'earn' && row.subscriptionId) return 'subscription';
  return 'other';
}

function analyze(snapshot) {
  const { account, transactions, lots, orders, usages } = snapshot;
  const byTransaction = new Map(transactions.map(row => [row.id, row]));
  const byLot = new Map(lots.map(row => [row.id, row]));
  const byUsage = new Map(usages.map(row => [row.id, row]));
  const issues = [];
  const stats = { types: {}, orphanSources: {}, deductionKinds: {}, debitCoverage: {}, refunds: {}, usageStatuses: {}, audit: {} };
  const explicitLoss = new Map(), explicitRefund = new Map();
  const usageRows = new Map();
  const unknown = [];
  const positives = transactions.filter(row => row.amount > 0);
  const orphanSources = positives.filter(row => !row.creditLotId && !['refund', 'adjustment'].includes(sourceType(row)));
  for (const row of orphanSources) increment(stats.orphanSources, sourceType(row));
  const originalGrantByLot = new Map();
  for (const row of positives.filter(row => row.creditLotId && row.type !== 'refund')) {
    if (originalGrantByLot.has(row.creditLotId)) issues.push({ code: 'multiple_positive_sources_for_lot', transactionId: row.id, lotId: row.creditLotId });
    originalGrantByLot.set(row.creditLotId, row);
  }
  const auditMarker = transactions.find(row => row.id === `referral-priority-audit-v3:${account.id}`);
  increment(stats.audit, auditMarker ? 'v3_marker_present' : 'v3_marker_absent');
  for (const row of transactions) {
    increment(stats.types, row.type);
    if (row.balanceBefore + row.amount !== row.balanceAfter) issues.push({ code: 'transaction_balance_equation_mismatch', transactionId: row.id });
    if (row.apiUsageId) {
      if (!usageRows.has(row.apiUsageId)) usageRows.set(row.apiUsageId, []);
      usageRows.get(row.apiUsageId).push(row);
    }
    let deductions = row.metadata?.deductions;
    const audit = row.metadata?.referralPriorityAudit;
    if (audit && typeof audit === 'object') {
      const valid = audit.version === 'referral-priority-audit-v3' && /^[a-f0-9]{64}$/.test(audit.backupHash || '') &&
        auditMarker?.metadata?.reconciliation === audit.version && auditMarker.metadata.backupHash === audit.backupHash &&
        hash(audit.originalDeductions ?? null) === hash(deductions ?? null) && Array.isArray(audit.correctedDeductions);
      increment(stats.audit, valid ? 'corrected_deductions_verified' : 'corrected_deductions_unverified');
      if (valid) deductions = audit.correctedDeductions;
      else issues.push({ code: 'invalid_referral_priority_audit', transactionId: row.id });
    }
    const debit = row.amount < 0;
    const refund = row.type === 'refund' && row.amount > 0;
    if (!debit && !refund) continue;
    if (Array.isArray(deductions) && deductions.length) {
      if (deductions.reduce((n, d) => n + d.amount, 0) !== Math.abs(row.amount)) {
        issues.push({ code: 'deduction_amount_mismatch', transactionId: row.id });
        increment(stats.debitCoverage, debit ? 'amount_mismatch' : 'refund_amount_mismatch');
      }
      let explicit = true;
      for (const d of deductions) {
        increment(stats.deductionKinds, d.kind || 'no_kind');
        const target = d.lotId && byLot.has(d.lotId) ? `lot:${d.lotId}` : d.transactionId && byTransaction.has(d.transactionId) ? `transaction:${d.transactionId}` : null;
        if (!target) { explicit = false; unknown.push({ transactionId: row.id, at: row.createdAt, amount: d.amount, kind: d.kind || 'no_kind', debit, refund }); }
        else {
          const grant = target.startsWith('lot:') ? originalGrantByLot.get(d.lotId) : byTransaction.get(d.transactionId);
          if (!grant || grant.amount <= 0 || +new Date(grant.createdAt) > +new Date(row.createdAt)) issues.push({ code: 'deduction_source_missing_or_future', transactionId: row.id, target });
          const map = refund ? explicitRefund : explicitLoss;
          map.set(target, (map.get(target) || 0) + d.amount);
        }
      }
      increment(stats.debitCoverage, `${refund ? 'refund' : 'debit'}_${explicit ? 'explicit' : 'anonymous_or_missing_source'}`);
    } else {
      const directLotId = row.creditLotId || row.metadata?.expiredLotId;
      if (debit && row.type === 'expire' && directLotId && byLot.has(directLotId)) {
        const target = `lot:${directLotId}`;
        explicitLoss.set(target, (explicitLoss.get(target) || 0) - row.amount);
        increment(stats.debitCoverage, 'debit_explicit_direct_lot');
      } else {
        unknown.push({ transactionId: row.id, at: row.createdAt, amount: Math.abs(row.amount), kind: 'missing_deductions', debit, refund });
        increment(stats.debitCoverage, `${refund ? 'refund' : 'debit'}_missing_deductions`);
      }
    }
  }
  const refundPairs = [];
  for (const [id, rows] of usageRows) {
    const spends = rows.filter(row => row.type === 'spend' && row.amount < 0);
    const refunds = rows.filter(row => row.type === 'refund' && row.amount > 0);
    const usage = byUsage.get(id);
    increment(stats.usageStatuses, usage?.responseStatus || 'missing_usage');
    if (!refunds.length) continue;
    const spendAmount = -sum(spends), refundAmount = sum(refunds);
    const code = !spends.length ? 'no_matching_spend' : refundAmount > spendAmount ? 'exceeds_matching_spend' : refundAmount === spendAmount ? 'full_refund_by_usage' : 'partial_refund_by_usage';
    increment(stats.refunds, code);
    if (!usage) increment(stats.refunds, 'missing_usage_record');
    refundPairs.push({ apiUsageId: id, spendIds: spends.map(row => row.id), refundIds: refunds.map(row => row.id), spendAmount, refundAmount, status: usage?.responseStatus || null, creditsUsed: usage?.creditsUsed ?? null, code });
  }
  const unpairedRefunds = transactions.filter(row => row.type === 'refund' && row.amount > 0 && !row.apiUsageId);
  stats.refunds.without_usage_id = unpairedRefunds.length;
  const ledgerBalance = sum(transactions);
  const activeLotBalance = lots.filter(row => row.status === 'active').reduce((n, row) => n + row.remainingAmount, 0);
  const counters = {
    ledgerBalance, recordedBalance: account.balance, balanceCloses: ledgerBalance === account.balance,
    grossSpends: -sum(transactions.filter(row => row.type === 'spend' && row.amount < 0)),
    refunds: sum(transactions.filter(row => row.type === 'refund' && row.amount > 0)),
    recordedTotalSpent: account.totalSpent,
    positiveGrantsExcludingRefunds: sum(positives.filter(row => row.type !== 'refund')),
    recordedTotalEarned: account.totalEarned,
    apiCreditsUsed: usages.reduce((n, row) => n + row.creditsUsed, 0),
    activeLotBalance, unbatchedBalance: account.balance - activeLotBalance,
  };
  counters.totalSpentMatchesNetSpends = counters.grossSpends - counters.refunds === account.totalSpent;
  counters.totalEarnedMatchesPositiveGrants = counters.positiveGrantsExcludingRefunds === account.totalEarned;
  if (!counters.balanceCloses) issues.push({ code: 'ledger_balance_mismatch' });
  if (activeLotBalance > account.balance) issues.push({ code: 'active_lots_exceed_balance' });
  const lotReplay = lots.map(lot => {
    const target = `lot:${lot.id}`;
    const expectedRemaining = lot.totalAmount - (explicitLoss.get(target) || 0) + (explicitRefund.get(target) || 0);
    return { lotId: lot.id, sourceType: lot.sourceType, originalTransactionId: originalGrantByLot.get(lot.id)?.id || null,
      explicitLoss: explicitLoss.get(target) || 0, explicitRefund: explicitRefund.get(target) || 0,
      totalAmount: lot.totalAmount, remainingAmount: lot.remainingAmount, expectedRemaining, closes: expectedRemaining === lot.remainingAmount };
  });
  const paidSources = orphanSources.filter(row => sourceType(row) === 'paid_recharge').map(row => {
    const refs = [row.orderId, row.metadata?.orderId, row.metadata?.orderNo].filter(Boolean);
    const matches = orders.filter(order => refs.includes(order.id) || refs.includes(order.orderNo));
    const valid = matches.length === 1 && matches[0].status === 'paid' && matches[0].orderType === 'recharge' &&
      matches[0].userId === account.userId && matches[0].credits === row.amount && !matches[0].teamId;
    return { transactionId: row.id, exactPaidOrder: valid, orderIds: matches.map(order => order.id) };
  });
  const sourceRemainders = orphanSources.map(row => {
    const target = `transaction:${row.id}`;
    const earliestUnknown = unknown.filter(u => +new Date(u.at) >= +new Date(row.createdAt));
    const explicitConsumed = explicitLoss.get(target) || 0, explicitRestored = explicitRefund.get(target) || 0;
    const possibleRemaining = row.amount - explicitConsumed + explicitRestored;
    const isPreciselyTraceable = earliestUnknown.length === 0 && issues.length === 0 &&
      lotReplay.every(lot => lot.closes) && possibleRemaining >= 0 && counters.unbatchedBalance >= possibleRemaining;
    return { transactionId: row.id, sourceType: sourceType(row), amount: row.amount, explicitConsumed, explicitRestored,
      possibleRemainingBeforeAnonymous: row.amount - explicitConsumed + explicitRestored, unknownLaterEvents: earliestUnknown.length,
      exactlyTraceable: isPreciselyTraceable };
  });
  const exactRemainder = sourceRemainders.filter(row => row.exactlyTraceable).reduce((n, row) => n + row.possibleRemainingBeforeAnonymous, 0);
  if (exactRemainder > counters.unbatchedBalance) for (const row of sourceRemainders) row.exactlyTraceable = false;
  return { accountId: account.id, stats, counters, issues, unknownEvents: unknown, refundPairs, unpairedRefundIds: unpairedRefunds.map(row => row.id),
    lotReplay, paidSources, sourceRemainders,
    categories: {
      allDebitsExplicit: !unknown.some(row => row.debit),
      allRefundsExplicit: !unknown.some(row => row.refund),
      allLotRemaindersReplay: lotReplay.every(row => row.closes),
      exactlyTraceableOrphanSources: sourceRemainders.filter(row => row.exactlyTraceable).length,
      noUnbatchedBalance: counters.unbatchedBalance === 0,
    } };
}

function main() {
  const [inputDir, rawOutputDir, ...extra] = process.argv.slice(2);
  assert(inputDir && rawOutputDir && !extra.length, 'Usage: SNAPSHOT_DIR NEW_PRIVATE_REPORT_DIR');
  const outputDir = privateDirectory(rawOutputDir);
  const preview = readPrivate(path.join(path.resolve(inputDir), 'preview.json'));
  const entries = preview.auditEntries.filter(row => row.status === 'skipped');
  const summary = { snapshotAt: preview.at, accounts: entries.length, transactionTypes: {}, accountCategories: {}, debitCoverage: {}, deductionKinds: {}, refundMatches: {}, usageStatuses: {}, issueCounts: {}, orphanSources: {}, counterChecks: {}, audit: {}, files: [] };
  const privateIndex = [];
  for (const entry of entries) {
    const original = readPrivate(entry.auditFile);
    assert.equal(hash(original.before), entry.beforeHash, 'Original evidence fingerprint mismatch');
    const result = analyze(original.before.evidence);
    const file = path.join(outputDir, `account-${entry.accountId}.json`);
    writePrivate(file, { snapshotAt: preview.at, originalEvidenceFile: entry.auditFile, originalBeforeHash: entry.beforeHash, result });
    privateIndex.push({ accountId: entry.accountId, file, categories: result.categories, counters: result.counters, issues: result.issues });
    for (const [key, value] of Object.entries(result.categories)) if (value) increment(summary.accountCategories, key);
    for (const [outputKey, statsKey] of [['transactionTypes','types'], ['debitCoverage','debitCoverage'], ['deductionKinds','deductionKinds'], ['refundMatches','refunds'], ['usageStatuses','usageStatuses'], ['orphanSources','orphanSources'], ['audit','audit']]) {
      for (const [key, count] of Object.entries(result.stats[statsKey])) increment(summary[outputKey], key, count);
    }
    for (const code of new Set(result.issues.map(row => row.code))) increment(summary.issueCounts, code);
    for (const key of ['balanceCloses', 'totalSpentMatchesNetSpends', 'totalEarnedMatchesPositiveGrants']) increment(summary.counterChecks, `${key}:${result.counters[key]}`);
  }
  const report = { at: new Date().toISOString(), scriptHash: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    inputPreviewHash: preview.previewHash, summary, privateIndex };
  const file = path.join(outputDir, 'summary.json');
  writePrivate(file, report);
  console.log(JSON.stringify({ file, ...summary, files: undefined }, null, 2));
}

module.exports = { analyze, sourceType };
if (require.main === module) main();
