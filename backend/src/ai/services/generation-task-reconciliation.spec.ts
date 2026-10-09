import assert from 'node:assert/strict';
import { GenerationTaskService } from './generation-task.service';

async function main() {
  const now = Date.now();
  const old = new Date(now - 2 * 60 * 60 * 1000);
  const rows = ['processing', 'queued', 'processing'].map((status, index) => ({
    id: `task-${index}`, userId: 'owner', nodeId: `node-${index}`, type: 'generate',
    status, createdAt: old, updatedAt: old, completedAt: null as Date | null,
    requestData: { projectId: 'project' }, error: null as string | null,
  }));
  const events: any[] = [];
  const usageUpdates: any[] = [];
  const service: any = Object.assign(Object.create(GenerationTaskService.prototype), {
    logger: { warn() {}, error() {} },
    publishTaskStatus: async (projectId: string, payload: any) => { events.push({ projectId, ...payload }); },
    prisma: {
      videoTask: { updateMany: async () => ({ count: 0 }) },
      imageTask: {
        findMany: async ({ where }: any) => rows
          .filter((row) => row.status === where.status && row.updatedAt < where.updatedAt.lt)
          .map((row) => ({ ...row })),
        updateMany: async ({ where, data }: any) => {
          const row = rows.find((candidate) => candidate.id === where.id)!;
          // A worker completes between the scan and cleanup: never overwrite it.
          if (row.id === 'task-2') { row.status = 'succeeded'; row.updatedAt = new Date(now); }
          if (row.status !== where.status || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      apiUsageRecord: {
        updateMany: async (args: any) => {
          usageUpdates.push(args);
          if (args.where.requestParams.equals === 'task-0') throw new Error('usage metadata unavailable');
          return { count: 1 };
        },
      },
    },
  });
  await service.reconcileStuckTasks();
  assert.equal(rows[0].status, 'failed');
  assert.equal(rows[1].status, 'failed', 'one usage metadata failure must not block the next task');
  assert.equal(rows[2].status, 'succeeded', 'concurrent real completion is preserved');
  for (const row of rows.slice(0, 2)) {
    assert(row.completedAt instanceof Date, 'terminal task records its completion timestamp');
    const event = events.find((item) => item.taskId === row.id);
    assert.equal(event.projectId, 'project');
    assert.equal(event.status, 'failed');
    assert.equal(event.category, 'image');
    assert.equal(event.error, row.error);
  }
  assert.equal(events.length, 2);
  assert.equal(usageUpdates.length, 2);
  for (const update of usageUpdates) {
    assert.equal(update.where.userId, 'owner');
    assert.equal(update.where.responseStatus, 'pending');
    assert.equal(update.where.processingTime, null, 'preserve already-recorded execution durations');
    assert.deepEqual(update.where.requestParams.path, ['taskId']);
    assert(update.data.processingTime >= 2 * 60 * 60 * 1000);
    assert.deepEqual(Object.keys(update.data).sort(), ['errorMessage', 'processingTime'], 'no billing transition or refund');
  }
  await service.reconcileStuckTasks();
  assert.equal(events.length, 2, 'terminal tasks are not finalized a second time');
  console.log('generation task terminal reconciliation: PASS');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
