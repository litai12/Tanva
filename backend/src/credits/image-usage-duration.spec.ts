import assert from 'node:assert/strict';
import { CreditsService } from './credits.service';

async function main() {
  const receipt: any = { id: 'usage', userId: 'owner', responseStatus: 'pending', processingTime: null, errorMessage: null };
  const credits: any = Object.assign(Object.create(CreditsService.prototype), {
    prisma: { apiUsageRecord: { updateMany: async ({ where, data }: any) => {
      assert.equal(data.responseStatus, undefined, 'attempt timing cannot settle billing');
      assert.equal(data.creditsUsed, undefined, 'attempt timing cannot change the charge');
      if (Object.entries(where).every(([key, value]) => receipt[key] === value)) {
        Object.assign(receipt, data); return { count: 1 };
      }
      return { count: 0 };
    } } },
  });
  await credits.recordApiUsageProcessingTimeForUser('another-user', 'usage', 100, 'foreign error');
  assert.equal(receipt.processingTime, null);
  await credits.recordApiUsageProcessingTimeForUser('owner', 'usage', 125.2, 'network timeout');
  assert.equal(receipt.processingTime, 125); assert.equal(receipt.errorMessage, 'network timeout');
  assert.equal(receipt.responseStatus, 'pending');
  await credits.recordApiUsageProcessingTimeForUser('owner', 'usage', 3_600_000, 'refund wait');
  assert.equal(receipt.processingTime, 125, 'later reconciliation cannot replace completed attempt duration');
  for (const responseStatus of ['success', 'failed']) {
    Object.assign(receipt, { responseStatus, processingTime: null });
    await credits.recordApiUsageProcessingTimeForUser('owner', 'usage', 100);
    assert.equal(receipt.processingTime, null, 'settled billing records remain untouched');
  }

  const transactions = [{ id: 'spend', apiUsageId: 'usage', metadata: null }];
  const usage: any = { id: 'usage', serviceType: 'gpt-image-2', model: 'gpt-image-2', provider: 'new-api',
    responseStatus: 'pending', processingTime: null, errorMessage: null, requestParams: { taskId: 'task' } };
  const task: any = { id: 'task', userId: 'owner', status: 'failed', error: 'real generation error',
    createdAt: new Date(1000), completedAt: new Date(9000), requestData: null };
  let writes = 0;
  const history: any = Object.assign(Object.create(CreditsService.prototype), {
    getOrCreateAccount: async () => ({ id: 'account' }),
    prisma: {
      creditTransaction: { findMany: async () => transactions, count: async () => 1, update: () => { writes++; } },
      apiUsageRecord: { findMany: async ({ where }: any) => { assert.equal(where.userId, 'owner'); return [usage]; }, update: () => { writes++; } },
      imageTask: { findMany: async ({ where }: any) => { assert.equal(where.userId, 'owner'); return [task]; }, update: () => { writes++; } },
    },
  });
  const original = structuredClone({ transactions, usage, task });
  const read = async () => (await history.getTransactionHistory('owner')).transactions[0];
  const row = await read();
  assert.equal(row.generationStatus, 'failed'); assert.equal(row.generationError, 'real generation error');
  assert.equal(row.apiResponseStatus, 'pending', 'generation failure is separate from billing reconciliation');
  assert.equal(row.processingTime, 8000, 'historical terminal task supplies a read-only elapsed time');
  assert.deepEqual({ transactions, usage, task }, original); assert.equal(writes, 0);
  task.requestData = { imageExecutionStartedAt: new Date(6000).toISOString() };
  assert.equal((await read()).processingTime, 3000, 'new executions exclude queued time');
  usage.processingTime = 123;
  assert.equal((await read()).processingTime, 123, 'stored timing has priority');
  usage.processingTime = null;
  for (const status of ['queued', 'processing']) {
    task.status = status;
    assert.equal((await read()).processingTime, null, 'an in-flight task cannot derive a terminal duration');
  }
  task.status = 'failed'; task.completedAt = null;
  assert.equal((await read()).processingTime, null, 'missing completion does not invent timing');
  usage.requestParams = {};
  assert.equal((await read()).generationStatus, null, 'unknown task stays unknown');
  assert.equal(writes, 0);
  console.log('image usage duration and read-only history: PASS');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
