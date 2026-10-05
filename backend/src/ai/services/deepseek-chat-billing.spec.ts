import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DeepSeekChatBillingService, isDeepSeekChatModel } from './deepseek-chat-billing.service';
import { calculateDeepSeekUsage } from '../../desktop-chat/deepseek-pricing';
import * as pricing from '../../desktop-chat/deepseek-pricing';

function harness(orders?: any) {
  const rows = new Map<string, any>();
  const settled: Array<{ id: string; amount: string; team: boolean }> = [];
  let refunds = 0;
  let settlementBlocked = false;
  let refundBlocked = false;
  const tx = {
    $queryRaw: async () => [],
    team: { findUnique: async () => ({ isPersonal: false, status: 'active' }) },
    teamMembership: { findUnique: async () => ({ userId: 'user-test' }) },
    apiUsageRecord: {
      findUnique: async ({ where }: any) => rows.get(where.id) || null,
      findUniqueOrThrow: async ({ where }: any) => {
        if (!rows.has(where.id)) throw new Error('missing receipt');
        return rows.get(where.id);
      },
      update: async ({ where, data }: any) => {
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row); return row;
      },
    },
  };
  const settle = (id: string, amount: string, team: boolean) => {
    if (settlementBlocked) throw new Error('transient accounting failure');
    settled.push({ id, amount, team });
    return { creditsCharged: Number((BigInt(amount) + 999_999_999n) / 1_000_000_000n) };
  };
  const credits = {
    deductExact: async (userId: string, _teamId: string | null, amount: number, meta: any) => {
      rows.set(meta.apiUsageId, { id: meta.apiUsageId, userId, creditsUsed: amount, ...meta });
    },
    settleDesktopChatUsage: async (_userId: string, id: string, amount: string) => settle(id, amount, false),
    refundCredits: async (_userId: string, id: string) => {
      assert.equal(rows.get(id).responseStatus, 'failed', 'mark rejected before refund');
      if (refundBlocked) throw new Error('transient refund failure');
      refunds++;
    },
  };
  const ledger = {
    reserve: async () => ({ reserved: true }),
    settleDesktopChatUsage: async ({ taskId, exactCreditNanos }: any) => settle(taskId, exactCreditNanos, true),
    release: async () => { refunds++; },
  };
  const service = new DeepSeekChatBillingService(
    { $transaction: async (work: any) => {
      const before = new Map([...rows].map(([id, row]) => [id, structuredClone(row)]));
      try { return await work(tx); }
      catch (error) { rows.clear(); for (const [id, row] of before) rows.set(id, row); throw error; }
    } } as any, credits as any, ledger as any, orders,
  );
  return { service, rows, settled, tx, refunds: () => refunds,
    blockSettlement: (blocked: boolean) => { settlementBlocked = blocked; },
    blockRefund: (blocked: boolean) => { refundBlocked = blocked; } };
}
const input = (identity: string, teamId?: string) => ({
  userId: 'user-test', model: 'deepseek-v4.1-flash', serviceType: 'gemini-text' as const,
  serviceName: '网页文本对话', requestBody: { messages: [{ role: 'user', content: identity }] }, identity, teamId,
});
const usage = { prompt_tokens: 18171, completion_tokens: 285, prompt_cache_hit_tokens: 10000,
  prompt_cache_miss_tokens: 8171, total_tokens: 18456 };

async function main() {
  assert.equal(isDeepSeekChatModel('deepseek-v4.1-flash'), true);
  assert.equal(isDeepSeekChatModel('deepseek-v4-pro'), true, 'this historical ID is migrated to Flash by the provider');
  assert.equal(isDeepSeekChatModel('deepseek-future-pro'), false, 'unknown DeepSeek models must not use Flash prices');
  assert.equal(isDeepSeekChatModel('xiaot-agent-deepseek-v4-flash'), false, 'facade credit usage is not real DeepSeek token usage');
  const h = harness();
  let submissions = 0;
  const result = { text: 'known result', usage };
  const operation = async () => { submissions++; return result; };
  assert.deepEqual(await h.service.execute(input('success'), operation, r => r.usage), result);
  assert.deepEqual(await h.service.execute(input('success'), operation, r => r.usage), result);
  assert.equal(submissions, 1, 'completed receipt replay must not submit a paid request');
  assert.equal(h.settled.length, 1, 'replay must not create another charge');
  const originalQuote = pricing.createDeepSeekPricingSnapshot;
  try {
    (pricing as any).createDeepSeekPricingSnapshot = () => { throw new Error('calendar unavailable'); };
    assert.deepEqual(await h.service.execute(input('success'), operation, r => r.usage), result);
    assert.equal(submissions, 1, 'stored receipts remain replayable when new pricing is unavailable');
    await assert.rejects(h.service.execute(input('unquotable'), operation, r => r.usage), /calendar unavailable/);
  } finally { (pricing as any).createDeepSeekPricingSnapshot = originalQuote; }
  const receipt = [...h.rows.values()][0];
  assert.equal(h.settled[0].amount, calculateDeepSeekUsage(receipt.requestParams.deepseekBilling.snapshot, usage).exactCreditNanos);
  assert.equal(receipt.inputTokens, 18171);
  assert.equal(receipt.requestParams.deepseekBilling.calculation.usage.cacheHitTokens, 10000);
  assert.notEqual(receipt.creditsUsed, 30, 'usage replaces fixed 30 credits');
  await assert.rejects(h.service.execute(input('success', 'team-test'), operation, r => r.usage), /Conflict/);
  assert.equal(submissions, 1, 'the same identity cannot silently switch payer');
  await h.service.execute(input('team', 'team-test'), operation, r => r.usage);
  assert.equal(h.settled.at(-1)?.team, true);
  h.tx.teamMembership.findUnique = async () => null as any;
  await assert.rejects(h.service.execute(input('unauthorized', 'team-test'), operation, r => r.usage), /当前账号无权/);
  assert.equal(submissions, 2, 'invalid team must fail before calling the supplier');

  let acceptedSubmissions = 0;
  const noUsage = async () => { acceptedSubmissions++; return { text: 'completed answer', usage: undefined }; };
  await assert.rejects(h.service.execute(input('no-usage'), noUsage, r => r.usage));
  await assert.rejects(h.service.execute(input('no-usage'), noUsage, r => r.usage));
  assert.equal(acceptedSubmissions, 1, 'missing usage must not automatically submit again');
  const unknown = [...h.rows.values()].find(r => r.requestParams.deepseekBilling.response?.text === 'completed answer');
  assert.equal(unknown.requestParams.deepseekBilling.state, 'reconciliation_required');
  for (const status of [202, 500, 503]) await assert.rejects(h.service.execute(input(`uncertain-${status}`), async () => {
    throw new Error(`new-api HTTP ${status}: uncertain`);
  }, () => undefined));
  assert.equal(h.refunds(), 0, 'unknown paid outcomes retain their reservation');
  await assert.rejects(h.service.execute(input('rejected'), async () => { throw new Error('new-api HTTP 402: rejected'); }, () => undefined));
  assert.equal(h.refunds(), 1);

  const rejectionRecovery = harness();
  let rejectedSubmissions = 0;
  const rejectedOperation = async () => { rejectedSubmissions++; throw new Error('new-api HTTP 402: rejected'); };
  rejectionRecovery.blockRefund(true);
  await assert.rejects(rejectionRecovery.service.execute(input('refund-recovery'), rejectedOperation, () => undefined));
  assert.equal([...rejectionRecovery.rows.values()][0].responseStatus, 'pending');
  rejectionRecovery.blockRefund(false);
  await assert.rejects(rejectionRecovery.service.execute(input('refund-recovery'), rejectedOperation, () => undefined), /HTTP 402/);
  assert.equal(rejectedSubmissions, 1, 'confirmed rejection retries only its refund, never its model request');
  assert.equal(rejectionRecovery.refunds(), 1);
  assert.equal([...rejectionRecovery.rows.values()][0].responseStatus, 'failed');

  const recovery = harness();
  let recoverySubmissions = 0;
  const knownOperation = async () => { recoverySubmissions++; return result; };
  recovery.blockSettlement(true);
  await assert.rejects(recovery.service.execute(input('known-result'), knownOperation, r => r.usage));
  recovery.blockSettlement(false);
  assert.deepEqual(await recovery.service.execute(input('known-result'), knownOperation, r => r.usage), result);
  assert.equal(recoverySubmissions, 1, 'accounting recovery must use the stored result without re-submitting the model');
  assert.equal(recovery.settled.length, 1);

  let orderQueries = 0;
  const orders = { isEnabled: () => true, register: async () => true,
    reconcile: async () => { orderQueries++; return { enabled: true, status: 'pending' }; } };
  const gateway = harness(orders);
  let gatewaySubmissions = 0;
  const noTokenResult = { success: true, data: { text: '真实正文', metadata: {} } };
  const submittedOrders: string[] = [];
  const gatewayOperation = async (charge: any) => {
    gatewaySubmissions++; submittedOrders.push(charge.apiUsageId); return noTokenResult;
  };
  const first = await gateway.service.execute(input('gateway-body'), gatewayOperation, () => undefined);
  assert.equal(first.data.text, '真实正文', 'pending payment must preserve completed model output');
  assert.equal((first.data.metadata as any).billing.status, 'pending');
  const replay = await gateway.service.execute(input('gateway-body'), gatewayOperation, () => undefined);
  assert.equal(replay.data.text, '真实正文');
  assert.equal(gatewaySubmissions, 1, 'pending orders only query their original order');
  assert.equal(orderQueries, 2);
  assert.equal(gateway.settled.length, 0, 'caller cannot settle or reprice gateway consumption using model tokens');
  assert.equal(gateway.refunds(), 0);
  await gateway.service.execute(input('gateway-body:reply'), gatewayOperation, () => undefined);
  assert.notEqual(submittedOrders[0], submittedOrders[1], 'physical requests have distinct orders');
  const failedOutput = { success: false, error: { message: 'model failed after gateway consumption' } };
  await gateway.service.execute(input('gateway-model-failure'), async () => failedOutput, () => { throw new Error('output failed'); });
  const failedRow = [...gateway.rows.values()].find(r => r.requestParams.deepseekBilling.response?.success === false);
  assert.equal(failedRow.requestParams.deepseekBilling.outputStatus, 'failed');
  assert.equal(gateway.refunds(), 0, 'model failure must not decide consumption refund');
  assert.equal(orderQueries, 4);

  console.log('DeepSeek web usage, cache, replay, payer scope and uncertain outcome: passed');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
