// Read-only historical attribution. Bounds describe every possible allocation
// consistent with recorded movements; they never apply today's spend priority.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { digest, markerFor, lotIdFor, dailyRewardExpiresAt } = require('./repair-legacy-free-credit-sources.cjs');
const VERSION = 'legacy-free-source-evidence-v2';
const time = v => +new Date(v);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const valid = n => Number.isSafeInteger(n) && n >= 0;
const freeKinds = new Set(['signup_bonus', 'legacy_invitee_registration', 'daily_reward', 'referral_reward']);
function classify(t, lot, orders, userId) {
  if (t.type === 'CHECK_IN' || t.type === 'daily_reward' || lot?.metadata?.reason === 'daily_reward') return 'daily_reward';
  if (t.type === 'earn' && t.description === '新用户注册赠送积分' && t.amount > 0) return 'signup_bonus';
  if (t.type === 'earn' && t.description === '被邀请注册额外赠送积分' && t.amount > 0 &&
    typeof t.metadata?.inviterUserId === 'string' && t.metadata.inviterUserId.length > 0 && t.metadata.inviterUserId !== userId) return 'legacy_invitee_registration';
  if (t.type === 'REFERRAL_REWARD' && t.amount > 0) return 'referral_reward';
  if (lot?.sourceType === 'recharge' || (t.type === 'earn' && t.description === '充值')) {
    const refs = [t.orderId, t.metadata?.orderId, t.metadata?.orderNo, lot?.orderId].filter(Boolean);
    const matches = orders.filter(o => refs.includes(o.id) || refs.includes(o.orderNo));
    if (matches.length === 1 && matches[0].status === 'paid' && matches[0].orderType === 'recharge' &&
      matches[0].userId === userId && !matches[0].teamId && !matches[0].membershipPlanId && !matches[0].subscriptionId && matches[0].paidAt && Number(matches[0].amount) > 0 &&
      matches[0].credits === t.amount) return 'paid_recharge';
    return 'unverified_recharge';
  }
  if (['membership', 'subscription'].includes(lot?.sourceType)) return 'membership';
  if (lot?.sourceType === 'manual' || lot?.metadata?.grantedBy === 'admin_add' || (t.type === 'admin_adjust' && !t.metadata?.reconciliation)) return 'admin_manual';
  return 'unknown';
}
function isRefund(t) {
  return t.amount > 0 && (t.type === 'refund' || (t.type === 'adjustment' && (t.apiUsageId || t.metadata?.direction === 'refund')));
}
function validatedDeductions(t, byTx, issue) {
  let parts = t.metadata?.deductions;
  const audit = t.metadata?.referralPriorityAudit;
  if (audit && typeof audit === 'object') {
    const marker = byTx.get(`referral-priority-audit-v3:${t.accountId}`);
    if (audit.version !== 'referral-priority-audit-v3' || !/^[a-f0-9]{64}$/.test(audit.backupHash || '') ||
      (!valid(marker?.amount)) || marker?.metadata?.reconciliation !== audit.version || marker.metadata.backupHash !== audit.backupHash ||
      digest(t.type === 'spend' ? audit.correctedDeductions : audit.originalDeductions) !== digest(parts) || !Array.isArray(audit.correctedDeductions)) {
      issue('conflict', 'prior_referral_audit_not_authenticated', [t.id]); return null;
    }
    parts = audit.correctedDeductions;
  }
  if (!Array.isArray(parts) || (!parts.length && !(t.type === 'expire' && audit))) return null;
  if (parts.some(p => !valid(p.amount) || p.amount === 0) || sum(parts.map(p => p.amount)) !== Math.abs(t.amount) && !(t.type === 'expire' && audit && sum(parts.map(p => p.amount)) < -t.amount)) {
    issue('conflict', 'deduction_total_does_not_equal_wallet_movement', [t.id], { amount: t.amount, deductionTotal: sum(parts.map(p => p.amount || 0)) });
    return null;
  }
  return parts;
}
function planAudit(snapshot, now = new Date()) {
  const { account, transactions = [], lots = [], orders = [], usages = [] } = snapshot;
  assert(account && snapshot.user?.id === account.userId, 'Missing or mismatched account/user');
  const issues = [], buckets = [], sources = [], histories = new Map();
  const issueKeys = new Set();
  const issue = (severity, code, transactionIds = [], detail = {}) => {
    const key = JSON.stringify([severity, code, transactionIds, detail]); if (issueKeys.has(key)) return;
    issueKeys.add(key); issues.push({ severity, code, transactionIds, ...detail });
  };
  const byTx = new Map(transactions.map(t => [t.id, t])), byLot = new Map(lots.map(l => [l.id, l]));
  if (byTx.size !== transactions.length || byLot.size !== lots.length) issue('conflict', 'duplicate_record_ids');
  if (transactions.some(t => t.id === markerFor(account.id))) return { version: VERSION, accountId: account.id, status: 'already_repaired', sources: [], issues: [], repairableGrants: [] };
  for (const f of ['balance', 'totalEarned', 'totalSpent']) if (!valid(account[f])) issue('conflict', 'invalid_account_counter', [], { field: f });
  for (const t of transactions) {
    if (t.accountId !== account.id || !Number.isSafeInteger(t.amount) || !valid(t.balanceBefore) || !valid(t.balanceAfter)) issue('conflict', 'invalid_or_foreign_transaction', [t.id]);
    else if (t.balanceBefore + t.amount !== t.balanceAfter) issue('conflict', 'transaction_transition_does_not_close', [t.id]);
  }
  if (sum(transactions.map(t => t.amount)) !== account.balance) issue('conflict', 'ledger_does_not_close_to_current_balance', [], { ledgerBalance: sum(transactions.map(t => t.amount)), currentBalance: account.balance });
  let chainWallet = 0, chainOrdinal = 0; const transactionOrder = new Map();
  const chronology = new Map();
  for (const t of transactions.filter(t => t.amount !== 0)) { const at = time(t.createdAt), group = chronology.get(at) || []; group.push(t); chronology.set(at, group); }
  for (const [, group] of [...chronology].sort((a, b) => a[0] - b[0])) {
    const pending = [...group];
    while (pending.length) {
      const matches = pending.filter(t => t.balanceBefore === chainWallet && t.balanceBefore + t.amount === t.balanceAfter);
      if (matches.length !== 1) { issue('conflict', 'ledger_transition_chain_missing_or_ambiguous', pending.map(t => t.id), { expectedBefore: chainWallet }); chainWallet = pending[pending.length - 1].balanceAfter; break; }
      const next = matches[0]; transactionOrder.set(next.id, chainOrdinal++); chainWallet = next.balanceAfter; pending.splice(pending.indexOf(next), 1);
    }
  }
  // totalEarned/Spent intentionally are not inferred from all positive/negative
  // rows: corrections and refunds have different historical counter semantics.
  const projections = [
    { name: 'free', match: s => freeKinds.has(s.kind), lower: 0, upper: 0 },
    { name: 'daily_reward', match: s => s.kind === 'daily_reward', lower: 0, upper: 0 },
    { name: 'registration', match: s => ['signup_bonus', 'legacy_invitee_registration'].includes(s.kind), lower: 0, upper: 0 },
    { name: 'paid_recharge', match: s => s.kind === 'paid_recharge', lower: 0, upper: 0 },
  ];
  const sourceById = new Map(), events = [];
  const rechargeOrders = new Map();
  for (const t of transactions.filter(t => t.amount > 0 && !isRefund(t))) {
    const lot = byLot.get(t.creditLotId);
    if (classify(t, lot, orders, account.userId) !== 'paid_recharge') continue;
    const refs = [t.orderId, t.metadata?.orderId, t.metadata?.orderNo, lot?.orderId].filter(Boolean);
    const order = orders.find(o => refs.includes(o.id) || refs.includes(o.orderNo));
    const grouped = rechargeOrders.get(order.id) || []; grouped.push(t); rechargeOrders.set(order.id, grouped);
  }
  for (const [id, grouped] of rechargeOrders) if (grouped.length !== 1) issue('conflict', 'duplicate_recharge_grants_for_one_paid_order', grouped.map(t => t.id), { orderId: id });
  const normalizedRefundMarkers = new Set();
  for (const marker of transactions.filter(t => t.metadata?.reconciliation === 'referral-priority-audit-v3')) {
    const refunds = marker.metadata.decayRefunds;
    const auditedExpiries = transactions.filter(t => t.type === 'expire' && t.metadata?.referralPriorityAudit?.backupHash === marker.metadata.backupHash);
    const differences = auditedExpiries.map(t => ({ id: t.id, amount: -t.amount - sum((validatedDeductions(t, byTx, issue) || []).map(d => d.amount)) }));
    if (marker.id === `referral-priority-audit-v3:${account.id}` && valid(marker.amount) && Array.isArray(refunds) &&
      sum(refunds.map(r => r.amount)) === marker.amount && sum(differences.map(d => d.amount)) === marker.amount &&
      refunds.every(r => valid(r.amount) && differences.some(d => d.id === r.transactionId)) &&
      differences.every(d => sum(refunds.filter(r => r.transactionId === d.id).map(r => r.amount)) === d.amount)) normalizedRefundMarkers.add(marker.id);
    else if (marker.amount > 0) issue('gap', 'prior_referral_refund_marker_not_closed', [marker.id]);
  }
  for (const t of transactions.filter(t => t.amount > 0 && !isRefund(t) && !normalizedRefundMarkers.has(t.id))) {
    const lot = byLot.get(t.creditLotId);
    if (t.creditLotId && !lot) issue('gap', 'positive_grant_references_missing_lot', [t.id], { lotId: t.creditLotId });
    if (t.metadata?.reconciliation === 'legacy-referral-consumption-v1') issue('gap', 'prior_reconciliation_requires_external_backup', [t.id], { reconciliation: t.metadata.reconciliation });
    const source = { id: t.id, transaction: t, lot, kind: classify(t, lot, orders, account.userId), buckets: [], replayed: { explicitDebits: 0, verifiedExpiryDebits: 0, explicitRefunds: 0, ambiguousDebitIds: [], ambiguousRefundIds: [] } };
    if (source.kind === 'unverified_recharge') issue('gap', 'paid_order_evidence_missing_or_nonunique', [t.id]);
    sources.push(source); sourceById.set(t.id, source);
    const allocation = lot?.metadata?.allocatedFromLegacyBalance;
    const priorMarker = byTx.get(`referral-priority-audit-v3:${account.id}`);
    const canonicalAudit = lot?.metadata?.referralPriorityAudit === 'referral-priority-audit-v3' &&
      lot.metadata.legacyReferralUnverified === false && lot.metadata.backupHash === priorMarker?.metadata?.backupHash &&
      priorMarker?.metadata?.reconciliation === 'referral-priority-audit-v3' && /^[a-f0-9]{64}$/.test(lot.metadata.backupHash || '');
    const migration = allocation !== undefined && !canonicalAudit;
    if (migration && (!valid(allocation) || allocation > t.amount || lot.metadata.originalTransactionId !== t.id || !Number.isFinite(time(lot.createdAt)) || time(lot.createdAt) < time(t.createdAt))) issue('conflict', 'invalid_initial_migration_allocation', [t.id], { lotId: lot.id });
    source.migrated = migration;
    events.push({ at: time(t.createdAt), rank: 0, id: t.id, kind: 'grant', t, source, storage: lot && !migration ? lot.id : 'legacy' });
    if (migration && valid(allocation) && Number.isFinite(time(lot.createdAt))) events.push({ at: time(lot.createdAt), rank: 1, id: `migration:${lot.id}`, kind: 'migration', source, lot, amount: allocation });
  }
  for (const t of transactions.filter(t => t.amount < 0 || isRefund(t))) events.push({ at: time(t.createdAt), rank: 2, id: t.id, kind: 'movement', t });
  if (events.some(e => !Number.isFinite(e.at))) issue('conflict', 'invalid_event_timestamp');
  const addBucket = (source, storage, amount) => {
    const existing = source.buckets.find(b => b.storage === storage);
    if (existing) { existing.lower += amount; existing.upper += amount; return existing; }
    const b = { source, storage, lower: amount, upper: amount }; source.buckets.push(b); buckets.push(b); return b;
  };
  let wallet = 0;
  function tighten() {
    for (const source of sources) {
      const sl = sum(source.buckets.map(b => b.lower));
      if (sl > source.transaction.amount) issue('conflict', 'refund_restores_more_than_original_grant', [source.id], { sourceLower: sl, originalAmount: source.transaction.amount });
      else for (const b of source.buckets) b.upper = Math.min(b.upper, source.transaction.amount - sl + b.lower);
    }
    const lo = sum(buckets.map(b => b.lower)), hi = sum(buckets.map(b => b.upper));
    if (lo > wallet || hi < wallet) { issue('conflict', 'replay_inventory_cannot_close_to_wallet', [], { wallet, lower: lo, upper: hi }); return; }
    for (const b of buckets) {
      const l = Math.max(b.lower, wallet - hi + b.upper), u = Math.min(b.upper, wallet - lo + b.lower);
      b.lower = l; b.upper = u;
    }
    for (const p of projections) {
      const own = buckets.filter(b => p.match(b.source)), other = buckets.filter(b => !p.match(b.source));
      p.lower = Math.max(p.lower, sum(own.map(b => b.lower)), wallet - sum(other.map(b => b.upper)));
      p.upper = Math.min(p.upper, sum(own.map(b => b.upper)), wallet - sum(other.map(b => b.lower)));
      if (p.lower > p.upper) issue('conflict', 'source_group_constraints_conflict', [], { group: p.name, lower: p.lower, upper: p.upper });
    }
  }
  function candidates(p, t) {
    if (p.lotId && (!p.kind || p.kind === 'lot')) return buckets.filter(b => b.storage === p.lotId);
    if (p.transactionId && ['legacy_referral', 'legacy_daily_reward', 'transaction', 'legacy_transaction'].includes(p.kind)) return sourceById.get(p.transactionId)?.buckets || [];
    if (p.kind === 'legacy_balance') return buckets.filter(b => b.storage === 'legacy');
    if (p.kind === 'legacy_non_paid_balance') return buckets.filter(b => b.storage === 'legacy');
    if (p.kind === 'unattributed') return buckets;
    issue('gap', 'unknown_deduction_source', [t.id], { kind: p.kind || null, lotId: p.lotId || null, originalTransactionId: p.transactionId || null }); return buckets;
  }
  function debit(amount, eligible, t, part) {
    const bs = eligible.filter(b => b.upper > 0), upper = sum(bs.map(b => b.upper));
    if (upper < amount) { issue('conflict', 'deduction_exceeds_available_source_evidence', [t.id], { amount, sourceUpper: upper, deduction: part }); return { amount, allocations: [] }; }
    const allocations = bs.map(b => ({ sourceId: b.source.id, storage: b.storage,
      lower: Math.max(0, amount - upper + b.upper), upper: Math.min(amount, b.upper) }));
    for (const p of projections) {
      const own = sum(bs.filter(b => p.match(b.source)).map(b => b.upper)), other = upper - own;
      const min = Math.max(0, amount - other), max = Math.min(amount, own);
      p.lower = Math.max(0, p.lower - max); p.upper -= min;
    }
    const unique = new Set(bs.map(b => b.source.id)).size === 1;
    for (const b of bs) { b.lower = Math.max(0, b.lower - amount); b.upper = Math.min(b.upper, upper - amount); }
    for (const source of new Set(bs.map(b => b.source))) {
      if (unique) { source.replayed.explicitDebits += amount; if (t.type === 'expire') source.replayed.verifiedExpiryDebits += amount; }
      else source.replayed.ambiguousDebitIds.push(t.id);
    }
    return { amount, part, allocations, refunded: 0 };
  }
  function refund(amount, eligible, t, history) {
    if (!eligible.length) { issue('gap', 'refund_source_has_no_original_grant', [t.id]); return; }
    let allocs;
    if (history) {
      const remaining = history.amount - history.refunded;
      if (remaining < amount) { issue('conflict', 'refund_exceeds_original_unreturned_deduction', [t.id, history.transactionId], { refund: amount, available: remaining }); return; }
      allocs = history.allocations.filter(a => eligible.some(b => b.source.id === a.sourceId && b.storage === a.storage)).map(a => ({ ...a, lower: Math.max(0, amount - remaining + a.lower - (a.returnedUpper || 0)), upper: Math.min(amount, a.upper - (a.returnedLower || 0)) }));
      if (sum(allocs.map(a => a.upper)) < amount) { issue('conflict', 'refund_deductions_do_not_match_original_debit', [t.id, history.transactionId]); return; }
      for (const a of history.allocations) {
        const possible = allocs.find(x => x.sourceId === a.sourceId && x.storage === a.storage);
        if (!possible) continue;
        a.returnedLower = (a.returnedLower || 0) + Math.max(0, amount - sum(allocs.filter(x => x !== possible).map(x => x.upper)));
        a.returnedUpper = (a.returnedUpper || 0) + Math.min(amount, possible.upper);
      }
      history.refunded += amount;
    } else {
      issue('gap', 'refund_has_no_unique_original_deduction_evidence', [t.id]);
      // Unlinked refund credits may be a restitution or a legacy over-refund.
      // Do not force them into an old free grant merely because wallet totals
      // happen to close after imposing that grant's original amount as a cap.
      let unknown = sourceById.get(`unattributed_refund:${t.id}`);
      if (!unknown) {
        unknown = { id: `unattributed_refund:${t.id}`, transaction: { ...t, amount: t.amount }, kind: 'unattributed_refund', buckets: [], replayed: {
          explicitDebits: 0, verifiedExpiryDebits: 0, explicitRefunds: 0, ambiguousDebitIds: [], ambiguousRefundIds: [] } };
        sources.push(unknown); sourceById.set(unknown.id, unknown);
      }
      const storage = eligible.every(b => b.storage === eligible[0].storage) ? eligible[0].storage : 'legacy';
      eligible = [...eligible, addBucket(unknown, storage, 0)];
      allocs = eligible.map(b => ({ sourceId: b.source.id, storage: b.storage, lower: 0, upper: amount }));
      if (eligible.length === 1) allocs[0].lower = amount;
    }
    for (const p of projections) {
      const own = sum(allocs.filter(a => p.match(sourceById.get(a.sourceId))).map(a => a.upper)), other = sum(allocs.filter(a => !p.match(sourceById.get(a.sourceId))).map(a => a.upper));
      p.lower += Math.max(0, amount - other); p.upper += Math.min(amount, own);
    }
    for (const b of eligible) {
      const aa = allocs.filter(a => a.sourceId === b.source.id && a.storage === b.storage), upper = sum(aa.map(a => a.upper)), lower = Math.max(0, amount - sum(allocs.filter(a => a.sourceId !== b.source.id || a.storage !== b.storage).map(a => a.upper)));
      b.lower += lower; b.upper += upper;
      if (lower === amount && upper === amount) b.source.replayed.explicitRefunds += amount;
      else b.source.replayed.ambiguousRefundIds.push(t.id);
    }
  }
  const spendingByUsage = new Map();
  function effectiveParts(t) {
    const ds = validatedDeductions(t, byTx, issue); if (ds) return ds;
    if (t.amount < 0 && (t.creditLotId || t.metadata?.expiredLotId)) return [{ kind: 'lot', lotId: t.creditLotId || t.metadata.expiredLotId, amount: -t.amount }];
    const ids = t.metadata?.expiredTransactionIds;
    if (t.type === 'expire' && Array.isArray(ids) && ids.length) {
      const matching = ids.map(id => byTx.get(id));
      if (matching.every(s => s && s.amount > 0 && valid(s.expiredAmount)) && sum(matching.map(s => s.expiredAmount)) === -t.amount)
        return matching.filter(s => s.expiredAmount > 0).map(s => ({ kind: 'legacy_transaction', transactionId: s.id, amount: s.expiredAmount }));
      issue('gap', 'legacy_expiry_ids_do_not_prove_individual_expired_amounts', [t.id, ...ids]);
    }
    issue('gap', t.amount < 0 ? 'wallet_debit_has_no_source_deductions' : 'wallet_refund_has_no_source_deductions', [t.id]);
    return [{ kind: 'unattributed', amount: Math.abs(t.amount) }];
  }
  for (const event of events.sort((a, b) => a.at - b.at || (transactionOrder.has(a.id) && transactionOrder.has(b.id) ? transactionOrder.get(a.id) - transactionOrder.get(b.id) : a.rank - b.rank) || a.id.localeCompare(b.id))) {
    if (event.kind === 'grant') {
      addBucket(event.source, event.storage, event.t.amount); wallet += event.t.amount;
      for (const p of projections) if (p.match(event.source)) { p.lower += event.t.amount; p.upper += event.t.amount; }
      tighten(); continue;
    }
    if (event.kind === 'migration') {
      const legacy = event.source.buckets.find(b => b.storage === 'legacy');
      if (!legacy) issue('gap', 'migration_original_source_not_present', [event.source.id], { lotId: event.lot.id });
      else if (legacy.lower >= event.amount) {
        legacy.lower -= event.amount; legacy.upper -= event.amount; addBucket(event.source, event.lot.id, event.amount);
      } else {
        issue('gap', 'migration_initial_allocation_not_verified_original_source', [event.source.id], { lotId: event.lot.id, allocated: event.amount, sourceLower: legacy.lower });
        const bs = buckets.filter(b => b.storage === 'legacy' && b.upper > 0), totalUpper = sum(bs.map(b => b.upper));
        if (totalUpper < event.amount) issue('conflict', 'migration_exceeds_available_legacy_pool', [event.source.id]);
        else for (const b of bs) {
          const l = Math.max(0, event.amount - totalUpper + b.upper), u = Math.min(event.amount, b.upper);
          b.lower = Math.max(0, b.lower - event.amount); b.upper = Math.min(b.upper, totalUpper - event.amount);
          const moved = addBucket(b.source, event.lot.id, 0); moved.lower += l; moved.upper += u;
        }
      }
      tighten(); continue;
    }
    const t = event.t, parts = effectiveParts(t);
    if (t.amount < 0) {
      const hs = parts.map(p => ({ ...debit(p.amount, candidates(p, t), t, p), transactionId: t.id }));
      histories.set(t.id, hs);
      if (t.apiUsageId && ['spend', 'adjustment'].includes(t.type)) {
        const old = spendingByUsage.get(t.apiUsageId) || []; old.push(t); spendingByUsage.set(t.apiUsageId, old);
      }
      wallet -= sum(parts.map(p => p.amount));
    } else {
      const explicitId = t.metadata?.originalSpendTransactionId || t.metadata?.spendTransactionId || t.metadata?.originalExpireTransactionId;
      const original = explicitId ? [byTx.get(explicitId)].filter(Boolean) : (spendingByUsage.get(t.apiUsageId) || []).filter(s => s.type === 'spend');
      const originalParts = original.length === 1 ? histories.get(original[0].id) || [] : [];
      if (original.length !== 1) issue('gap', 'refund_original_transaction_missing_or_ambiguous', [t.id, ...original.map(s => s.id)]);
      const totalRemaining = sum(originalParts.map(h => h.amount - h.refunded));
      const exactWhole = parts.length === 1 && parts[0].kind === 'unattributed' && t.amount === totalRemaining && totalRemaining > 0 &&
        !(spendingByUsage.get(t.apiUsageId) || []).some(s => s.type === 'adjustment');
      if (exactWhole) {
        for (const h of originalParts) {
          const eligible = buckets.filter(b => h.allocations.some(a => a.sourceId === b.source.id && a.storage === b.storage));
          refund(h.amount - h.refunded, eligible, t, h);
        }
      } else for (const p of parts) {
        const eligible = candidates(p, t);
        const matching = originalParts.filter(h => h.allocations.some(a => eligible.some(b => a.sourceId === b.source.id && a.storage === b.storage)) && h.amount - h.refunded > 0);
        refund(p.amount, eligible, t, matching.length === 1 ? matching[0] : null);
      }
      wallet += t.amount;
    }
    tighten();
  }
  // Existing lot snapshots constrain replay, they are not new grants. A small
  // migration starts with its documented allocation rather than totalAmount.
  for (const lot of lots) {
    if (lot.accountId !== account.id || !valid(lot.totalAmount) || !valid(lot.remainingAmount) || lot.remainingAmount > lot.totalAmount ||
      !['active', 'exhausted', 'expired'].includes(lot.status) || (lot.status !== 'active' && lot.remainingAmount !== 0)) issue('conflict', 'invalid_or_foreign_lot', [], { lotId: lot.id });
    const originals = transactions.filter(t => t.amount > 0 && !isRefund(t) && t.creditLotId === lot.id);
    if (originals.length !== 1 || originals[0]?.amount !== lot.totalAmount) issue('conflict', 'lot_original_grant_total_not_unique_or_exact', originals.map(t => t.id), { lotId: lot.id, totalAmount: lot.totalAmount, originalGrantCount: originals.length, originalGrantAmount: originals.length === 1 ? originals[0].amount : null });
    const bs = buckets.filter(b => b.storage === lot.id);
    if (!bs.length) { issue('gap', 'lot_has_no_replayed_original_grant', [], { lotId: lot.id, remaining: lot.remainingAmount }); continue; }
    const lo = sum(bs.map(b => b.lower)), hi = sum(bs.map(b => b.upper));
    if (lot.remainingAmount < lo || lot.remainingAmount > hi) issue('conflict', 'lot_snapshot_disagrees_with_replayed_evidence', bs.map(b => b.source.id), { lotId: lot.id, replayLower: lo, replayUpper: hi, remaining: lot.remainingAmount });
    else for (const b of bs) { const oldLower = b.lower; b.lower = Math.max(b.lower, lot.remainingAmount - hi + b.upper); b.upper = Math.min(b.upper, lot.remainingAmount - lo + oldLower); }
  }
  tighten();
  const activeLots = sum(lots.filter(l => l.status === 'active').map(l => l.remainingAmount));
  const legacyPool = account.balance - activeLots;
  if (legacyPool < 0) issue('conflict', 'active_lots_exceed_wallet', [], { activeLots, balance: account.balance });
  const orphan = buckets.filter(b => b.storage === 'legacy');
  const legacyLo = sum(orphan.map(b => b.lower)), legacyHi = sum(orphan.map(b => b.upper));
  if (legacyPool < legacyLo || legacyPool > legacyHi) issue('conflict', 'current_legacy_pool_disagrees_with_replay', [], { legacyPool, replayLower: legacyLo, replayUpper: legacyHi });
  else for (const b of orphan) { const oldLower = b.lower; b.lower = Math.max(b.lower, legacyPool - legacyHi + b.upper); b.upper = Math.min(b.upper, legacyPool - legacyLo + oldLower); }
  tighten();
  const snapshotHash = digest(snapshot);
  const sourceResults = sources.map(s => {
    const legacy = s.buckets.filter(b => b.storage === 'legacy'), lower = sum(legacy.map(b => b.lower)), upper = sum(legacy.map(b => b.upper));
    return { transactionId: s.id, kind: s.kind, originalAmount: s.transaction.amount, linkedLotId: s.transaction.creditLotId || null,
      recordedExpiredAmount: s.transaction.expiredAmount || 0, isExpired: s.transaction.isExpired === true,
      migratedInitialAllocatedAmount: s.migrated ? s.lot.metadata.allocatedFromLegacyBalance : null,
      remaining: { lower: sum(s.buckets.map(b => b.lower)), upper: Math.min(s.transaction.amount, sum(s.buckets.map(b => b.upper))) },
      untrackedRemaining: { lower, upper }, rawReplayKnownUntrackedRemaining: lower === upper ? lower : null, knownUntrackedRemaining: lower === upper && !issues.some(i => i.severity === 'conflict') ? lower : null,
      ...s.replayed, ambiguousDebitIds: [...new Set(s.replayed.ambiguousDebitIds)], ambiguousRefundIds: [...new Set(s.replayed.ambiguousRefundIds)] };
  });
  const independentProofs = proveIsolatedSuffix(snapshot, now);
  for (const proof of independentProofs) {
    const result = sourceResults.find(s => s.transactionId === proof.transactionId);
    if (result) { result.independentProof = proof; result.rawReplayRange = result.remaining; result.remaining = { lower: proof.remaining, upper: proof.remaining }; result.knownUntrackedRemaining = proof.remaining; result.untrackedRemaining = { lower: proof.remaining, upper: proof.remaining }; }
  }
  const relevant = sourceResults.filter(s => !s.linkedLotId && ['signup_bonus', 'legacy_invitee_registration', 'daily_reward'].includes(s.kind));
  const conflicts = issues.filter(i => i.severity === 'conflict'), gaps = issues.filter(i => i.severity === 'gap');
  const exact = relevant.filter(s => s.knownUntrackedRemaining !== null), proven = relevant.some(s => s.untrackedRemaining.lower > 0);
  const status = conflicts.length ? 'conflicting_ledger' : relevant.every(s => s.knownUntrackedRemaining !== null) && gaps.length === 0 ? 'verified' : proven || exact.length ? 'partially_proven' : 'insufficient_evidence';
  // Fully funded, named lot grants are repairable without guessing how a mixed
  // anonymous remainder was spent. Any conflict blocks all proposed writes.
  const vip = snapshot.user.vipEntitlementWhitelist === true || (snapshot.subscriptions || []).some(s => s.status === 'active' && time(s.currentPeriodStartAt) <= time(now) && time(s.currentPeriodEndAt) > time(now));
  const repairableGrants = relevant.filter(s => s.knownUntrackedRemaining !== null && (!conflicts.length || s.independentProof) && (s.independentProof || s.remaining.upper === s.untrackedRemaining.upper) && (s.independentProof || s.knownUntrackedRemaining === 0 || s.recordedExpiredAmount === s.verifiedExpiryDebits)).map(s => {
    const t = byTx.get(s.transactionId), daily = s.kind === 'daily_reward', grantedAt = new Date(t.createdAt).toISOString();
    return { transactionId: s.transactionId, lot: { id: lotIdFor(s.transactionId), accountId: account.id, sourceType: s.kind === 'signup_bonus' ? 'promo' : 'gift',
      validityType: daily && !vip ? 'fixed_window' : 'permanent', scopeType: 'global', scopeValue: null, totalAmount: t.amount,
      remainingAmount: s.knownUntrackedRemaining, status: s.knownUntrackedRemaining > 0 ? 'active' : 'exhausted', grantedAt, activeAt: grantedAt,
      expiresAt: daily && !vip ? dailyRewardExpiresAt(grantedAt) : null, durationDays: daily && !vip ? 1 : null, priority: daily ? -200 : 0, orderId: null,
      metadata: { reconciliation: VERSION, originalTransactionId: t.id, reason: s.kind, grantedBy: daily ? 'daily_reward' : s.kind,
        historicalSourceReplayVerified: true, proofMethod: s.independentProof ? 'isolated_suffix' : 'conservative_source_bounds', evidenceSnapshotHash: snapshotHash, originalAmount: t.amount, exactRemaining: s.knownUntrackedRemaining } } };
  });
  const usageIds = new Set(usages.map(u => u.id));
  const missingUsages = transactions.filter(t => t.apiUsageId && !usageIds.has(t.apiUsageId));
  // Missing supplier status is surfaced separately; recorded holds/refunds still
  // move the wallet and are not silently discarded because generation failed.
  return { version: VERSION, accountId: account.id, status, at: new Date(now).toISOString(), snapshotHash,
    snapshotAt: snapshot.snapshotAt || account.updatedAt || null, transactionCount: transactions.length, lotCount: lots.length, balance: account.balance, coveredByActiveLots: activeLots, legacyPool,
    sourceBounds: Object.fromEntries(projections.map(p => [p.name, { lower: conflicts.length ? null : p.lower, upper: conflicts.length ? null : p.upper, certified: conflicts.length === 0, ...(conflicts.length ? { rawReplayRange: { lower: p.lower, upper: p.upper } } : {}) }])),
    sources: sourceResults, orphanFreeSourceCount: relevant.length, exactOrphanFreeSourceCount: exact.length,
    arithmeticEvidence: { ledgerBalanceMatches: sum(transactions.map(t => t.amount)) === account.balance, activeLotsFitWallet: activeLots <= account.balance, transactionTransitionsClose: transactions.every(t => t.balanceBefore + t.amount === t.balanceAfter) },
    classificationScope: 'source_replay_consistency; prior unsupported reconciliations are evidence gaps rather than proof of a current wallet error',
    issues, independentProofs, unresolvedPriorReconciliations: [...new Set(issues.filter(i => i.code === 'prior_reconciliation_requires_external_backup').map(i => i.reconciliation))], missingSupplierUsageTransactionIds: missingUsages.map(t => t.id), repairableGrants,
    conservation: { balanceBefore: account.balance, balanceAfter: account.balance, additionalLots: sum(repairableGrants.map(g => g.lot.remainingAmount)),
      unclassifiedLegacyAfter: legacyPool - sum(repairableGrants.map(g => g.lot.remainingAmount)) } };
}
// Independent late-source proof: old ledger defects cannot erase a later named
// grant if every wallet transition from that grant to today is recorded and all
// later deductions either name that source or belong to another named lot.
function proveIsolatedSuffix(snapshot) {
  const { account, transactions, lots, orders = [] } = snapshot;
  const byTx = new Map(transactions.map(t => [t.id, t]));
  const covered = sum(lots.filter(l => l.status === 'active').map(l => l.remainingAmount));
  if (covered > account.balance || lots.some(l => !valid(l.remainingAmount) || (l.status !== 'active' && l.remainingAmount !== 0))) return [];
  const proofs = [];
  for (const source of transactions.filter(t => t.amount > 0 && !t.creditLotId && ['signup_bonus', 'legacy_invitee_registration', 'daily_reward', 'paid_recharge'].includes(classify(t, null, orders, account.userId)))) {
    if (lots.some(l => l.metadata?.originalTransactionId === source.id)) continue;
    const start = time(source.createdAt), suffix = transactions.filter(t => time(t.createdAt) >= start && t.id !== source.id && t.amount !== 0);
    if (suffix.some(t => time(t.createdAt) === start)) continue;
    if (lots.some(l => l.metadata?.allocatedFromLegacyBalance !== undefined && time(l.createdAt) >= start)) continue;
    if (source.balanceBefore + source.amount !== source.balanceAfter) continue;
    let wallet = source.balanceAfter, remaining = source.amount, explicitlyExpired = 0, ok = true;
    const ids = [source.id];
    // At identical timestamps, require a unique transition chain. No arbitrary
    // transaction-id ordering is used as evidence of financial execution order.
    const grouped = new Map();
    for (const t of suffix) { const at = time(t.createdAt), group = grouped.get(at) || []; group.push(t); grouped.set(at, group); }
    const ordered = [];
    for (const [, group] of [...grouped].sort((a, b) => a[0] - b[0])) {
      const pending = [...group];
      while (pending.length) {
        const matches = pending.filter(t => t.balanceBefore === wallet && t.balanceBefore + t.amount === t.balanceAfter);
        if (matches.length !== 1) { ok = false; break; }
        const t = matches[0]; wallet = t.balanceAfter; ordered.push(t); pending.splice(pending.indexOf(t), 1);
      }
      if (!ok) break;
    }
    if (!ok || wallet !== account.balance) continue;
    const originalDebits = new Map();
    for (const t of ordered) {
      if (t.amount >= 0 && !isRefund(t)) { if (t.balanceAfter < remaining) ok = false; if (!ok) break; continue; }
      const localIssues = [];
      let ds = validatedDeductions(t, byTx, (...args) => localIssues.push(args));
      if (localIssues.length) { ok = false; break; }
      if (!ds && t.amount < 0 && (t.creditLotId || t.metadata?.expiredLotId)) ds = [{ kind: 'lot', lotId: t.creditLotId || t.metadata.expiredLotId, amount: -t.amount }];
      if (!ds || sum(ds.map(d => d.amount)) !== Math.abs(t.amount)) { ok = false; break; }
      for (const d of ds) {
        if (d.lotId && (!d.kind || d.kind === 'lot') && lots.some(l => l.id === d.lotId && time(l.grantedAt) < time(t.createdAt))) continue;
        if (d.transactionId !== source.id || !['legacy_referral', 'legacy_daily_reward', 'transaction', 'legacy_transaction'].includes(d.kind)) { ok = false; break; }
        if (t.amount < 0) {
          remaining -= d.amount;
          if (t.type === 'expire') explicitlyExpired += d.amount;
          if (t.apiUsageId) originalDebits.set(t.apiUsageId, (originalDebits.get(t.apiUsageId) || 0) + d.amount);
        } else {
          const available = originalDebits.get(t.apiUsageId) || 0;
          if (available < d.amount) { ok = false; break; }
          originalDebits.set(t.apiUsageId, available - d.amount); remaining += d.amount;
        }
        ids.push(t.id);
        if (remaining < 0 || remaining > source.amount) { ok = false; break; }
      }
      if (t.balanceAfter < remaining) ok = false;
      if (!ok) break;
    }
    if (valid(source.expiredAmount) && source.expiredAmount !== explicitlyExpired) ok = false;
    if (source.isExpired && source.expiredAmount !== source.amount) ok = false;
    if (ok) proofs.push({ transactionId: source.id, kind: classify(source, null, orders, account.userId), remaining, method: 'isolated_suffix',
      walletSuffixStart: source.balanceBefore, walletSuffixEnd: account.balance, transactionIds: ids, suffixTransactionIds: ordered.map(t => t.id) });
  }
  // Isolated source amounts must coexist in the actual untracked pool.
  return sum(proofs.map(p => p.remaining)) <= account.balance - covered ? proofs : [];
}
function auditEvidenceDirectory(inputDir, outputDir, { now = new Date(), expectedCount = 344 } = {}) {
  assert(path.isAbsolute(inputDir) && path.isAbsolute(outputDir), 'Use absolute private directories');
  const inputStat = fs.lstatSync(inputDir); assert(inputStat.isDirectory() && !inputStat.isSymbolicLink(), 'Input must be a real directory');
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(outputDir); assert(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'Output must have mode 0700');
  const preview = JSON.parse(fs.readFileSync(path.join(inputDir, 'preview.json'), 'utf8'));
  const entries = preview.auditEntries.filter(e => e.reason === 'consumption_history_requires_individual_audit');
  assert.equal(entries.length, expectedCount, 'Target evidence count changed'); assert.equal(new Set(entries.map(e => e.accountId)).size, entries.length, 'Duplicate account evidence');
  const counts = {}, results = [];
  for (const entry of entries) {
    assert(/^[0-9a-f-]{36}$/i.test(entry.accountId), 'Invalid evidence account ID');
    const filename = path.basename(entry.auditFile); assert(filename.startsWith(`evidence-${entry.accountId}-`) && filename.endsWith('.json'), 'Evidence path mismatch');
    const evidenceFile = path.join(inputDir, filename), st = fs.lstatSync(evidenceFile); assert(st.isFile() && !st.isSymbolicLink(), 'Evidence must be a regular file');
    const data = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    assert.equal(data.accountId, entry.accountId, 'Evidence account mismatch'); assert.equal(digest(data.before), entry.beforeHash, 'Evidence integrity mismatch');
    const report = planAudit({ ...data.before.evidence, snapshotAt: preview.at }, now), target = path.join(outputDir, `audit-${entry.accountId}.json`);
    fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    counts[report.status] = (counts[report.status] || 0) + 1;
    results.push({ accountId: report.accountId, status: report.status, reportFile: target, reportHash: digest(report),
      repairableGrantCount: report.repairableGrants.length, provenFreeLower: report.sourceBounds?.free?.lower || 0,
      reasonCounts: Object.fromEntries([...new Set(report.issues.map(i => i.code))].map(code => [code, report.issues.filter(i => i.code === code).length])) });
  }
  const summary = { version: VERSION, at: new Date(now).toISOString(), audited: results.length, counts, results };
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
  return { version: VERSION, audited: results.length, counts, repairableAccounts: results.filter(r => r.repairableGrantCount > 0).length,
    repairableGrants: sum(results.map(r => r.repairableGrantCount)), outputDir };
}
module.exports = { VERSION, planAudit, auditEvidenceDirectory, classify, validatedDeductions, proveIsolatedSuffix };
if (require.main === module) {
  try { const [inputDir, outputDir] = process.argv.slice(2); assert(inputDir && outputDir && process.argv.length === 4, 'Usage: node audit-legacy-free-credit-sources.cjs PRIVATE_EVIDENCE_DIR NEW_PRIVATE_OUTPUT_DIR'); console.log(JSON.stringify(auditEvidenceDirectory(inputDir, outputDir), null, 2)); }
  catch (error) { console.error('Read-only source audit failed:', error.message); process.exitCode = 1; }
}
