const assert = require('node:assert/strict');
const { unambiguousSpendIds } = require('./settled-consumption-evidence.cjs');
const PREFIX = 'legacy-referral-consumption-v1:';

// Replay in ledger order; only successful, unrefunded consumption is evidence.
// Apply legitimate decay to remaining rewards before considering later consumption.
function planPartialRepair({ account, rewards, transactions, lots, successfulUsageIds }) {
  const allRewards = rewards.filter(r => !r.creditLotId && r.amount > 0);
  const byReward = new Map(allRewards.map(r => [r.id, r]));
  const decays = transactions.filter(t => t.type === 'expire' &&
    t.metadata?.deductions?.some(d => d.kind === 'legacy_referral' && byReward.has(d.transactionId)));
  assert(decays.length, 'No evidenced referral decay');
  const keys = new Set();
  for (const t of decays) {
    assert.equal(t.metadata.deductions.reduce((s, d) => s + d.amount, 0), Math.abs(t.amount));
    assert.equal(t.balanceBefore + t.amount, t.balanceAfter);
    const key = `${new Date(t.createdAt).toISOString().slice(0, 10)}:${t.balanceBefore}:${t.balanceAfter}`;
    assert(!keys.has(key), 'Duplicate decay needs manual audit'); keys.add(key);
  }
  const used = new Map(allRewards.map(r => [r.id, 0]));
  const lawfulDecay = new Map(allRewards.map(r => [r.id, 0]));
  const replayRefunds = [];
  const decayIds = new Set(decays.map(t => t.id));
  const byLot = new Map(lots.map(l => [l.id, l]));
  const successful = new Set(successfulUsageIds);
  const refunded = new Set(transactions.filter(t => t.apiUsageId && t.amount > 0).map(t => t.apiUsageId));
  const allocations = [];
  const unambiguous = unambiguousSpendIds(transactions);
  for (const t of transactions) {
    if (decayIds.has(t.id)) {
      for (const d of t.metadata.deductions) {
        if (d.kind !== 'legacy_referral' || !byReward.has(d.transactionId)) continue;
        const r = byReward.get(d.transactionId);
        assert(+new Date(r.createdAt) <= +new Date(t.createdAt), 'Decay predates reward');
        const remaining = r.amount - used.get(r.id) - lawfulDecay.get(r.id);
        const lawful = Math.min(remaining, d.amount);
        lawfulDecay.set(r.id, lawfulDecay.get(r.id) + lawful);
        if (d.amount > lawful) replayRefunds.push({ transactionId: t.id, rewardId: r.id, amount: d.amount - lawful });
      }
      continue;
    }
    if (!unambiguous.has(t.id) || t.type !== 'spend' || t.amount >= 0 || !successful.has(t.apiUsageId) || refunded.has(t.apiUsageId)) continue;
    const deductions = t.metadata?.deductions;
    if (!Array.isArray(deductions)) continue;
    assert.equal(deductions.reduce((s, d) => s + d.amount, 0), -t.amount);
    for (let index = 0; index < deductions.length; index++) {
      const d = deductions[index], source = byLot.get(d.lotId);
      if (d.kind !== 'legacy_balance' && !(d.kind === 'lot' && source?.sourceType === 'recharge' &&
          ['active', 'exhausted'].includes(source.status) && (!source.expiresAt || +new Date(source.expiresAt) > Date.now()))) continue;
      let available = d.amount;
      for (const r of allRewards) {
        if (+new Date(r.createdAt) > +new Date(t.createdAt)) continue;
        const amount = Math.min(available, r.amount - used.get(r.id) - lawfulDecay.get(r.id));
        if (amount <= 0) continue;
        used.set(r.id, used.get(r.id) + amount);
        available -= amount;
        allocations.push({ transaction: t, index, rewardId: r.id, amount });
      }
    }
  }
  const selected = [];
  const decayRefunds = [];
  for (const r of allRewards) {
    const actual = decays.flatMap(t => t.metadata.deductions).filter(d => d.kind === 'legacy_referral' && d.transactionId === r.id).reduce((s, d) => s + d.amount, 0);
    assert.equal(actual, r.expiredAmount, 'Referral expired amount differs from decay evidence');
    const consumedAmount = used.get(r.id);
    const refund = actual - lawfulDecay.get(r.id);
    if (!refund) continue;
    const correctedExpiredAmount = lawfulDecay.get(r.id);
    assert.equal(consumedAmount + correctedExpiredAmount, r.amount, 'Refunded reward must be exhausted');
    selected.push({ ...r, consumedAmount, correctedExpiredAmount });
    decayRefunds.push(...replayRefunds.filter(d => d.rewardId === r.id));
  }
  assert(selected.length, 'No proven excess decay from settled consumption');
  const selectedIds = new Set(selected.map(r => r.id));
  const changesMap = new Map(), restoredLots = {};
  for (const a of allocations.filter(a => selectedIds.has(a.rewardId))) {
    if (!changesMap.has(a.transaction.id)) changesMap.set(a.transaction.id, { transaction: a.transaction, byIndex: new Map() });
    const change = changesMap.get(a.transaction.id);
    const parts = change.byIndex.get(a.index) || [];
    parts.push(a); change.byIndex.set(a.index, parts);
    const d = a.transaction.metadata.deductions[a.index];
    if (d.kind === 'lot') restoredLots[d.lotId] = (restoredLots[d.lotId] || 0) + a.amount;
  }
  const changes = [...changesMap.values()].map(c => ({ transaction: c.transaction,
    deductions: c.transaction.metadata.deductions.flatMap((d, index) => {
      const parts = c.byIndex.get(index) || [];
      const remaining = d.amount - parts.reduce((s, a) => s + a.amount, 0);
      return [...parts.map(a => ({ kind: 'lot', lotId: PREFIX + a.rewardId, amount: a.amount })), ...(remaining ? [{ ...d, amount: remaining }] : [])];
    }) }));
  for (const [id, amount] of Object.entries(restoredLots)) assert(byLot.get(id).remainingAmount + amount <= byLot.get(id).totalAmount, 'Recharge restoration exceeds original grant');
  const refund = decayRefunds.reduce((s, d) => s + d.amount, 0);
  const active = lots.filter(l => l.status === 'active').reduce((s, l) => s + l.remainingAmount, 0);
  // Some users subsequently spent the legacy balance left behind by the wrong
  // priority. Reassign that later settled consumption to the restored recharge,
  // otherwise restoring the full original paid deduction would create extra lots.
  const grossRestoredLots = { ...restoredLots };
  let shortfall = Math.max(0, active + Object.values(restoredLots).reduce((s, n) => s + n, 0) - account.balance - refund);
  const lastReferralConsumption = Math.max(...changes.map(c => +new Date(c.transaction.createdAt)));
  const legacyPaidReallocations = [];
  for (const t of transactions) {
    if (!shortfall) break;
    if (!unambiguous.has(t.id) || t.type !== 'spend' || +new Date(t.createdAt) <= lastReferralConsumption || !successful.has(t.apiUsageId) || refunded.has(t.apiUsageId)) continue;
    if (!Array.isArray(t.metadata?.deductions)) continue;
    assert.equal(t.metadata.deductions.reduce((s, d) => s + d.amount, 0), Math.abs(t.amount));
    const deductions = [];
    let changed = false;
    for (const d of t.metadata.deductions) {
      let remaining = d.amount;
      if (d.kind === 'legacy_balance') for (const [id, restored] of Object.entries(restoredLots)) {
        const source = byLot.get(id);
        if (source.scopeType && source.scopeType !== 'global') continue;
        const amount = Math.min(remaining, restored, shortfall);
        if (!amount) continue;
        deductions.push({ kind: 'lot', lotId: id, amount });
        restoredLots[id] -= amount;
        remaining -= amount;
        shortfall -= amount;
        legacyPaidReallocations.push({ transactionId: t.id, lotId: id, amount });
        changed = true;
      }
      if (remaining) deductions.push({ ...d, amount: remaining });
    }
    if (changed) changes.push({ transaction: t, deductions });
  }
  assert(account.balance + refund >= active + Object.values(restoredLots).reduce((s, n) => s + n, 0), 'Restored lots exceed account balance');
  return { account, rewards: selected, decays: decays.filter(t => decayRefunds.some(d => d.transactionId === t.id)), changes,
    restoredLots, refund, originalLots: lots.filter(l => grossRestoredLots[l.id]), balanceAfter: account.balance + refund,
    decayRefunds, grossRestoredLots, legacyPaidReallocations, algorithm: 'chronological-settled-consumption-v2' };
}
module.exports = { planPartialRepair };
