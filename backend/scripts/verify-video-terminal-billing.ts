import assert from 'node:assert/strict';
import { AiController } from '../src/ai/ai.controller';
import { NewApiVideoTaskReconciliationService } from '../src/ai/services/new-api-video-task-reconciliation.service';
import { CreditsService } from '../src/credits/credits.service';
import { VideoProviderService } from '../src/ai/services/video-provider.service';
import { VideoSubmissionUncertainError } from '../src/ai/services/video-submission-uncertain';

async function main() {
  let refunds = 0, marked = 0, status = 'processing';
  const controller: any = Object.assign(Object.create(AiController.prototype), {
    logger: { log() {}, warn() {}, error() {}, debug() {} },
    creditsService: {
      getVideoTaskUsageForUser: async (user: string) => user === 'owner'
        ? { taskId: 'newapi:task', responseStatus: 'pending', provider: 'doubao' } : null,
      markApiUsageFailedForUser: async () => { marked++; },
      refundCredits: async () => { refunds++; return { newBalance: 100 }; },
    },
    videoProviderService: { queryTask: async () => ({ status }) },
    creditCharge: { resolveHandle: async () => null },
  });
  for (const value of ['processing', 'queued', 'succeeded']) {
    status = value;
    await assert.rejects(controller.refundVideoTask({ apiUsageId: 'usage' }, { user: { id: 'owner' } }));
  }
  await assert.rejects(controller.refundVideoTask({ apiUsageId: 'usage' }, { user: { id: 'other' } }));
  assert.equal(refunds, 0); assert.equal(marked, 0);
  status = 'failed';
  await controller.refundVideoTask({ apiUsageId: 'usage' }, { user: { id: 'owner' } });
  assert.equal(refunds, 1); assert.equal(marked, 1);
  status = 'processing';
  await assert.rejects(controller.assertVideoUpstreamTerminal('owner', 'usage', 'succeeded'));

  // Upstream accepted, local persistence failed: retain charge and task identity.
  for (const scenario of ['accepted-write-failed', 'unknown', 'rejected', 'duplicate']) {
    let rollbacks = 0, writes = 0;
    const ai: any = Object.assign(Object.create(AiController.prototype), {
      logger: controller.logger,
      normalizeSeedanceModelAlias() {}, normalizeSeedance25OmniReferenceTaskType() {},
      assertSeedance2Entitlement: async () => {}, validateSeedance20ReferenceMedia: async () => {},
      buildVideoProviderCreditParams: async () => ({ clientProjectId: 'project', clientNodeId: 'node' }),
      emitVideoProviderGenerationTaskLog() {},
      creditsService: {
        getOrCreateAccount: async () => {},
        getVideoTaskUsageForUser: async () => ({ taskId: 'newapi:existing', responseStatus: 'pending', provider: 'vidu' }),
        updateApiUsageRequestParams: async () => { if (++writes === 1 && scenario === 'accepted-write-failed') throw new Error('db temporarily unavailable'); },
      },
      creditCharge: {
        begin: async () => ({ apiUsageId: 'usage', duplicate: scenario === 'duplicate' }),
        rollback: async () => { rollbacks++; },
      },
      videoProviderService: { generateVideo: async () => {
        if (scenario === 'duplicate') throw new Error('duplicate must not call gateway');
        if (scenario === 'unknown') throw new VideoSubmissionUncertainError();
        if (scenario === 'rejected') throw new Error('validation rejected before submission');
        return { taskId: 'newapi:accepted', status: 'queued' };
      } },
    });
    const request = () => ai.generateVideoProvider({ provider: 'vidu', prompt: 'test' }, { user: { id: 'owner' }, headers: {} });
    if (scenario === 'rejected') { await assert.rejects(request()); assert.equal(rollbacks, 1); }
    else { const result = await request(); assert.equal(result.apiUsageId, 'usage'); assert.equal(result.status, 'processing'); assert.equal(rollbacks, 0); if (scenario === 'duplicate') assert.equal(result.taskId, 'newapi:existing'); }
  }

  const credits: any = Object.create(CreditsService.prototype);
  credits.getStalePendingVideoTimeoutMinutes = () => 30;
  credits.getStalePendingBatchSize = () => 100;
  credits.prisma = { apiUsageRecord: { findMany: () => { throw new Error('must not refund from age alone'); } } };
  assert.equal((await credits.autoRefundStalePendingVideoUsages()).refunded, 0);
  let filter: any;
  await credits.findActiveNodeVideoUsage({ apiUsageRecord: { findFirst: async (query: any) => { filter = query.where; return null; } } },
    { userId: 'owner', clientProjectId: 'project', clientNodeId: 'node' });
  assert.equal(filter.createdAt, undefined, 'pending task must keep its node lock beyond 30 minutes');

  const service: any = Object.assign(Object.create(VideoProviderService.prototype), { newApiBaseUrl: 'https://gateway.invalid', newApiTaskPrefix: 'newapi:', newApiKey: 'test', logger: controller.logger });
  let queries = 0, settlements = 0;
  const reconciler: any = Object.assign(Object.create(NewApiVideoTaskReconciliationService.prototype), {
    logger: controller.logger,
    prisma: { apiUsageRecord: { findMany: async (query: any) => {
      assert(query.where.serviceType.in.includes('kling-video'));
      assert(query.where.OR.some((x: any) => x.requestParams.string_starts_with === 'newapivod:'));
      return [{ id: 'usage', userId: 'owner', createdAt: new Date(), requestParams: { taskId: 'newapivod:task' } }];
    } } },
    videoProviderService: { queryTask: async () => { queries++; throw new Error('gateway unreachable'); } },
    settlePendingUsage: async () => { settlements++; },
  });
  await reconciler.reconcilePendingTasks();
  assert.equal(queries, 1); assert.equal(settlements, 0);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('connection reset after write'); };
    await assert.rejects(service.requestNewApiJson('/v1/videos', { method: 'POST' }), VideoSubmissionUncertainError);
    globalThis.fetch = async () => new Response('gateway timeout', { status: 504 });
    await assert.rejects(service.requestNewApiJson('/v1/videos', { method: 'POST' }), VideoSubmissionUncertainError);
    globalThis.fetch = async () => new Response('invalid model', { status: 400 });
    await assert.rejects(service.requestNewApiJson('/v1/videos', { method: 'POST' }), (error: any) => !(error instanceof VideoSubmissionUncertainError));
    service.requestNewApiJson = async () => ({ status: 'succeeded' });
    await assert.rejects(service.queryTask('doubao', 'newapi:task'), /未返回视频地址/);
  } finally { globalThis.fetch = originalFetch; }
  console.log('video terminal billing, uncertainty and durable node lock: PASS');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
