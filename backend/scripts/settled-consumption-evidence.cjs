// Exclude ambiguous old concurrent ledger writes instead of counting their same
// balance transition twice as evidence for a financial correction.
function unambiguousSpendIds(transactions) {
  const transitions = new Map(), usages = new Map();
  const spends = transactions.filter(t => t.type === 'spend' && t.amount < 0);
  for (const t of spends) {
    const key = [new Date(t.createdAt).toISOString().slice(0, 16), t.amount, t.balanceBefore, t.balanceAfter].join(':');
    transitions.set(key, (transitions.get(key) || 0) + 1);
    usages.set(t.apiUsageId, (usages.get(t.apiUsageId) || 0) + 1);
  }
  return new Set(spends.filter(t => {
    const key = [new Date(t.createdAt).toISOString().slice(0, 16), t.amount, t.balanceBefore, t.balanceAfter].join(':');
    return t.apiUsageId && usages.get(t.apiUsageId) === 1 && transitions.get(key) === 1 && t.balanceBefore + t.amount === t.balanceAfter;
  }).map(t => t.id));
}
module.exports = { unambiguousSpendIds };
