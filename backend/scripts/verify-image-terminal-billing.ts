import { TeamCreditLedgerService } from '../src/team-credits/team-credit-ledger.service';
import assert from 'node:assert/strict';
import { AiController } from '../src/ai/ai.controller';
import { ImageTaskService } from '../src/ai/services/image-task.service';
import { NewApiProvider } from '../src/ai/providers/new-api.provider';
import { CreditsService } from '../src/credits/credits.service';
import { ConfigService } from '@nestjs/config';
import { imageExecutionContext, recordImageRejection, recordRemoteImages } from '../src/ai/services/image-execution-state';

const logger = { log() {}, debug() {}, warn() {}, error() {} };
async function main() {
  // Same billing usage must never fund a second sync generation, including error paths.
  for (const scenario of ['duplicate', 'disconnect', 'upload-failed', 'rejected', 'success']) {
    let calls = 0, refunded = 0, committed = 0;
    const marks: any[] = [];
    const controller: any = Object.assign(Object.create(AiController.prototype), {
      logger, getUserId: () => 'owner', getTeamId: () => undefined,
      extractIdempotencyKey: () => 'run', extractExecutionChannel: () => 'new-api',
      creditsService: { getOrCreateAccount: async () => {}, updateApiUsageRequestParams: async (_: any, data: any) => { marks.push(data); } },
      creditCharge: {
        begin: async () => ({ apiUsageId: 'usage', duplicate: scenario === 'duplicate' }),
        rollback: async () => { refunded++; }, commit: async () => { committed++; },
      },
    });
    const operation = async () => {
      calls++;
      if (scenario === 'rejected') { recordImageRejection(400); throw new Error('rejected'); }
      if (scenario === 'disconnect') throw new Error('socket disconnected');
      await recordRemoteImages(['data:image/png;base64,xx', 'https://upstream.test/result.png']);
      if (scenario === 'upload-failed') throw new Error('OSS unavailable after successful generation');
      return { imageUrl: 'https://assets.test/image.png' };
    };
    const run = () => controller.withCredits({ headers: {} }, 'gpt-image-2', 'gpt-image-2', operation);
    if (scenario === 'success') await run(); else await assert.rejects(run());
    assert.equal(calls, scenario === 'duplicate' ? 0 : 1, scenario);
    assert.equal(refunded, scenario === 'rejected' ? 1 : 0, scenario);
    assert.equal(committed, scenario === 'success' ? 1 : 0, scenario);
    if (scenario === 'upload-failed') assert.deepEqual(marks[0].upstreamImageUrls, ['https://upstream.test/result.png']);
  }

  // Real provider transport: disconnect/504/empty success issue exactly one POST.
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [0, 400, 504, 200]) {
      let calls = 0;
      globalThis.fetch = (async () => { calls++; if (!status) throw new Error('fetch failed'); return new Response('{}', { status }); }) as any;
      const provider: any = new NewApiProvider(new ConfigService({ NEW_API_KEY: 'test', NEW_API_BASE_URL: 'https://gateway.invalid' }));
      provider.apiKey = 'test';
      provider.resolveApiKey = () => 'test';
      const execution = { started: true, rejected: false };
      await imageExecutionContext.run(execution, () => provider.generateImage({ prompt: 'test', model: 'gpt-image-2' }));
      assert.equal(calls, 1, `HTTP ${status} must not retry`);
      assert.equal(execution.rejected, status === 400);
    }
  } finally { globalThis.fetch = originalFetch; }

  // Simultaneous workers both read queued, but only one can claim/charge/submit.
  for (const scenario of ['success', 'unknown', 'rejected', 'duplicate', 'upload-failed']) {
    let row: any = { id: 'task', userId: 'owner', type: 'generate', prompt: 'test', status: 'queued', nodeId: 'node', requestData: { projectId: 'p' } };
    const snapshot = { ...row };
    let charged = 0, submitted = 0, refunded = 0, committed = 0;
    const worker: any = Object.assign(Object.create(ImageTaskService.prototype), {
      logger,
      prisma: { imageTask: {
        updateMany: async ({ where, data }: any) => { if (row.status !== where.status) return { count: 0 }; row = { ...row, ...data }; return { count: 1 }; },
        update: async ({ data }: any) => { row = { ...row, ...data }; return row; },
        findFirst: async () => row,
      } },
      creditCharge: {
        begin: async () => { charged++; return { apiUsageId: 'usage', duplicate: scenario === 'duplicate' }; },
        rollback: async () => { refunded++; }, commit: async () => { committed++; },
      },
      creditsService: { updateApiUsageRequestParams: async () => {} },
      telemetryService: { ingestGenerationTask: async () => {} }, publishTaskStatus: async () => {},
      runGenerateTask: async () => {
        submitted++;
        if (scenario === 'unknown') throw new Error('network timeout');
        if (scenario === 'rejected') { recordImageRejection(400); throw new Error('bad request'); }
        return { imageUrl: 'https://upstream.test/result.png' };
      },
      uploadRemoteImageToOss: async () => { if (scenario === 'upload-failed') throw new Error('OSS failed'); return { url: 'https://assets.test/result.png' }; },
    });
    await Promise.all([worker.executeTaskCore(snapshot), worker.executeTaskCore(snapshot)]);
    assert.equal(charged, 1, scenario);
    assert.equal(submitted, scenario === 'duplicate' ? 0 : 1, scenario);
    assert.equal(refunded, scenario === 'rejected' ? 1 : 0, scenario);
    assert.equal(committed, scenario === 'success' ? 1 : 0, scenario);
    assert.equal(row.status, scenario === 'success' ? 'succeeded' : ['rejected', 'duplicate'].includes(scenario) ? 'failed' : 'processing', scenario);
    if (['unknown', 'upload-failed'].includes(scenario)) assert.equal(row.requestData.apiUsageId, 'usage');
    row = { ...row, status: 'processing', createdAt: new Date(0) };
    assert.equal((await worker.getTaskStatus('task', 'owner')).status, 'processing', 'polling cannot fail an old task');
  }
  const credits: any = Object.assign(Object.create(CreditsService.prototype), { getStalePendingTimeoutMinutes: () => 15, getStalePendingBatchSize: () => 100 });
  assert.equal((await credits.autoRefundStalePendingImageUsages()).refunded, 0);
  let filter: any;
  const tx = { apiUsageRecord: { findFirst: async ({ where }: any) => { filter = where; return null; } } };
  await credits.findActiveNodeVideoUsage(tx, { userId: 'owner', clientProjectId: 'p', clientNodeId: 'n', image: true });
  assert(filter.serviceType.in.includes('gpt-image-2')); assert.equal(filter.createdAt, undefined);
  await credits.findDuplicateApiUsageInWindow(tx, { userId: 'owner', serviceType: 'gpt-image-2', idempotencyKey: 'key', requestFingerprint: null, windowStartAt: new Date() });
  assert.equal(filter.createdAt, undefined);
  await credits.findDuplicateApiUsageInWindow(tx, { userId: 'owner', serviceType: 'gpt-image-2', idempotencyKey: null, requestFingerprint: 'fp', windowStartAt: new Date() });
  assert(filter.OR.some((x: any) => x.responseStatus === 'pending'));
  for (const status of ['pending', 'success', 'failed', null]) {
    let releases = 0;
    const ledger: any = Object.assign(Object.create(TeamCreditLedgerService.prototype), {
      logger, release: async () => { releases++; },
      prisma: {
        teamCreditLedger: {
          findMany: async () => [{ id: 'reserve', taskId: 'usage', teamAccId: 'account', amount: 10, account: { teamId: 'team' } }],
          findFirst: async () => null,
        },
        apiUsageRecord: { findUnique: async () => status ? { responseStatus: status } : null },
      },
    });
    await ledger.releaseExpiredReserves();
    assert.equal(releases, status === 'failed' ? 1 : 0, `team reserve ${status}`);
  }
  console.log('image terminal billing: PASS');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
