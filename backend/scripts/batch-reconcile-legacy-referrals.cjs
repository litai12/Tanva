const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { planPartialRepair } = require('./plan-partial-referral-repair.cjs');
const { planRepair, applyPlan } = require('./reconcile-legacy-referral-credits.cjs');
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const dir = path.resolve(process.env.CREDIT_REPAIR_BACKUP_DIR || './credit-repair-backups');
const digest = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
const save = (name, data) => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
  return file;
};
async function load(tx, accountId) {
  const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: accountId } });
  const user = await tx.user.findUniqueOrThrow({ where: { id: account.userId }, select: { phone: true } });
  const transactions = await tx.creditTransaction.findMany({ where: { accountId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const marker = `legacy-referral-consumption-v1:${accountId}`;
  if (transactions.some(t => t.id === marker)) return { already: true, phone: user.phone };
  const rewards = transactions.filter(t => t.type === 'REFERRAL_REWARD' && !t.creditLotId && t.amount > 0);
  const lots = await tx.creditLot.findMany({ where: { accountId }, orderBy: { id: 'asc' } });
  const usage = await tx.apiUsageRecord.findMany({ where: { id: { in: transactions.map(t => t.apiUsageId).filter(Boolean) }, responseStatus: 'success' }, select: { id: true } });
  return { phone: user.phone, marker, account, rewards, transactions, lots, successfulUsageIds: usage.map(u => u.id) };
}
function makePlan(input) {
  return { phone: input.phone, marker: input.marker, ...planPartialRepair(input) };
}
async function scan() {
  const ids = await p.$queryRawUnsafe(`SELECT DISTINCT "accountId" FROM "CreditTransaction" WHERE type = 'expire' AND metadata::text LIKE '%legacy_referral%' ORDER BY "accountId"`);
  const report = { scannedAt: new Date().toISOString(), candidates: ids.length, eligible: [], skipped: [], already: [] };
  for (const { accountId } of ids) {
    const input = await load(p, accountId);
    if (input.already) { report.already.push({ accountId, phone: input.phone }); continue; }
    try {
      const plan = makePlan(input);
      report.eligible.push({ accountId, phone: input.phone, hash: digest(plan), refund: plan.refund, before: input.account.balance, after: plan.balanceAfter });
    } catch (error) {
      report.skipped.push({ accountId, phone: input.phone, reason: error.message, evidence: input });
    }
  }
  const file = save(`referral-batch-scan-${Date.now()}.json`, report);
  const reasons = {};
  for (const row of report.skipped) reasons[row.reason] = (reasons[row.reason] || 0) + 1;
  console.log(JSON.stringify({ file, candidates: report.candidates, eligible: report.eligible.length, refund: report.eligible.reduce((s, r) => s + r.refund, 0), already: report.already.length, skipped: report.skipped.length, reasons }, null, 2));
}
async function apply(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const results = [];
  for (const row of report.eligible) {
    try {
      const result = await p.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE id = ${row.accountId} FOR UPDATE`;
        const input = await load(tx, row.accountId);
        if (input.already) return { accountId: row.accountId, status: 'already' };
        const plan = makePlan(input);
        const hash = digest(plan);
        assert.equal(hash, row.hash, 'Account changed since preview; rescan required');
        const backup = save(`referral-batch-backup-${row.accountId}-${Date.now()}.json`, { hash, plan });
        await applyPlan(tx, plan, hash);
        const account = await tx.creditAccount.findUniqueOrThrow({ where: { id: row.accountId } });
        assert.equal(account.balance, plan.balanceAfter);
        for (const r of plan.rewards) {
          const linked = await tx.creditTransaction.findUniqueOrThrow({ where: { id: r.id } });
          const lot = await tx.creditLot.findUniqueOrThrow({ where: { id: linked.creditLotId } });
          assert.equal(lot.remainingAmount, 0);
        }
        return { accountId: row.accountId, phone: row.phone, status: 'repaired', refund: plan.refund, before: plan.account.balance, after: plan.balanceAfter, backup };
      }, { isolationLevel: 'Serializable', timeout: 30000 });
      results.push(result);
    } catch (error) { results.push({ accountId: row.accountId, phone: row.phone, status: 'failed', reason: error.message }); }
  }
  const receipt = save(`referral-batch-receipt-${Date.now()}.json`, results);
  console.log(JSON.stringify({ receipt, repaired: results.filter(r => r.status === 'repaired').length, refund: results.reduce((s, r) => s + (r.refund || 0), 0), already: results.filter(r => r.status === 'already').length, failed: results.filter(r => r.status === 'failed') }, null, 2));
}
(async () => {
  const [mode, file] = process.argv.slice(2);
  if (mode === 'scan') await scan();
  else if (mode === 'apply' && file) await apply(file);
  else throw new Error('Usage: scan | apply <reviewed-scan-file>');
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
