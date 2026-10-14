import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from '../providers/new-api.provider';
import { imageExecutionContext, ImageExecutionState, needsImageReconciliation } from './image-execution-state';

async function main() {
  const originalFetch = globalThis.fetch;
  const receipt = {
    provider: 'toapis', task_id: 'tsk_img_one_attempt', status: 'failed',
    accepted: true, terminal: true, billing_status: 'refunded', error_code: 'generation_failed',
    reason: 'invalid_input', upstream_code: 'invalid_request_error',
  };
  const scenarios = [
    { name: 'confirmed refunded failure', status: 422, receipt, reconcile: false },
    { name: 'confirmed failure in legacy 502', status: 502, receipt, reconcile: false },
    { name: 'cancelled refunded', status: 422, receipt: { ...receipt, status: 'cancelled' }, reconcile: false },
    { name: 'pending overrides HTTP 422', status: 422, receipt: { ...receipt, status: 'processing', terminal: false }, reconcile: true },
    { name: 'unknown billing', status: 422, receipt: { ...receipt, billing_status: 'pending' }, reconcile: true },
    { name: 'charged failure', status: 422, receipt: { ...receipt, billing_status: 'charged' }, reconcile: true },
    { name: 'completed is not failed', status: 422, receipt: { ...receipt, status: 'completed' }, reconcile: true },
    { name: 'missing task identity', status: 422, receipt: { ...receipt, task_id: '' }, reconcile: true },
    { name: 'malformed receipt', status: 400, receipt: null, reconcile: true },
    { name: 'string boolean', status: 422, receipt: { ...receipt, terminal: 'true' }, reconcile: true },
    { name: 'unrecognized provider', status: 422, receipt: { ...receipt, provider: 'unknown' }, reconcile: true },
  ];
  try {
    for (const test of scenarios) {
      let submissions = 0;
      globalThis.fetch = (async () => {
        submissions++;
        return new Response(JSON.stringify({ error: { message: test.name, upstream_image_task: test.receipt } }), { status: test.status });
      }) as typeof fetch;
      const provider = new NewApiProvider(new ConfigService({ NEW_API_KEY: 'test', NEW_API_BASE_URL: 'https://gateway.invalid' }));
      (provider as any).resolveApiKey = () => 'test';
      const state: ImageExecutionState = { started: false, rejected: false };
      const result = await imageExecutionContext.run(state, () => provider.generateImage({ prompt: 'test', model: 'gpt-image-2' }));
      assert.equal(result.success, false, test.name);
      assert.equal(submissions, 1, `${test.name}: never resubmit`);
      assert.equal(needsImageReconciliation(state), test.reconcile, test.name);
      if (!test.reconcile) {
        assert.equal(state.upstreamImageTask?.task_id, receipt.task_id);
        assert.equal(state.upstreamImageTask?.reason, receipt.reason);
        assert.equal(state.upstreamImageTask?.upstream_code, receipt.upstream_code);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('Image failure receipts: PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
