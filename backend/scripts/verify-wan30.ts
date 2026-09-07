import assert from 'node:assert/strict';
import { AiController } from '../src/ai/ai.controller';
import { CreditsService } from '../src/credits/credits.service';

async function main() {
  const controller = Object.create(AiController.prototype) as any;
  let submitted: any;
  let quote: any;
  controller.withCredits = async (_req: any, service: string, model: string, operation: () => unknown, _a: any, _b: any, _c: any, params: any) => {
    assert.equal(service, 'wan30-video'); assert.equal(model, 'wan3.0-video');
    quote = params;
    return operation();
  };
  controller.submitDashscopeVideoViaNewApi = async (body: any) => {
    submitted = body; return { success: true, data: { taskId: 'newapi:wan30-test' } };
  };
  const credits = Object.create(CreditsService.prototype) as any;
  for (const [resolution, rate] of [['480P', 45], ['720P', 90], ['1080P', 180]] as const) {
    await controller.generateWan30Video({ input: { prompt: 'cat on a roof' }, parameters: { resolution, duration: 5, ratio: 'adaptive' }, clientNodeId: 'node-1' }, {});
    assert.equal(submitted.model, 'wan3.0-video');
    assert.deepEqual(submitted.parameters, { resolution, duration: 5, ratio: 'adaptive' });
    assert.equal(quote.clientNodeId, 'node-1');
    assert.equal(quote.managedModelKey, 'wan-3.0');
    assert.equal(credits.resolveHappyhorseR2VCredits('wan30-video', 225, quote), rate * 5);
  }
  for (const parameters of [{ resolution: '4K' }, { duration: 0 }, { duration: 31 }, { duration: 5.5 }, { ratio: '16:9' }]) {
    await assert.rejects(() => controller.generateWan30Video({ input: { prompt: 'cat' }, parameters }, {}));
  }
  await assert.rejects(() => controller.generateWan30Video({ input: { prompt: '' } }, {}));
  await assert.rejects(() => controller.generateWan30Video({ model: 'wan2.7-i2v', input: { prompt: 'cat' } }, {}));
  await assert.rejects(() => controller.generateWan30Video({ input: { prompt: 'cat', media: [] } }, {}));
  const dedupController = Object.create(AiController.prototype) as any;
  dedupController.logger = { debug() {} };
  dedupController.getUserId = () => 'user-1';
  dedupController.getTeamId = () => undefined;
  dedupController.extractIdempotencyKey = () => 'run-1';
  dedupController.creditsService = { getOrCreateAccount: async () => ({}) };
  dedupController.creditCharge = { begin: async () => ({ apiUsageId: 'usage-1', duplicate: true }) };
  let calls = 0;
  const reused = await dedupController.withCredits({}, 'wan30-video', 'wan3.0-video', async () => { calls++; });
  assert.equal(calls, 0, 'duplicate must not submit another upstream task');
  assert.equal(reused.data.taskId, 'usage:usage-1');
  console.log('Wan3.0 validation, request identity, deduplication and resolution pricing passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
