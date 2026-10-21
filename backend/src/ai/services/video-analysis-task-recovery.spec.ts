import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { VideoAnalysisTaskService } from './video-analysis-task.service';

const clone = <T>(value: T): T => structuredClone(value);
const dto = { videoUrl: 'https://cdn.example.test/clip.mp4', prompt: '分析镜头', model: 'doubao-seed-2-1-lite-260915', clientRequestId: 'one-click', projectId: 'project-a' };
const request = (teamId?: string) => ({ user: { sub: 'user-a', email: 'private@example.test', passwordHash: 'must-not-persist', roles: ['member'] }, headers: { ...(teamId ? { 'x-team-id': teamId } : {}), 'user-agent': 'test' }, ip: '127.0.0.1' });

function fixture() {
  const rows = new Map<string, any>();
  const jobs = new Map<string, any>();
  let tick = 0;
  const controls = { enqueueError: false, unavailable: false, collision: false, member: true, adds: 0, retries: 0 };
  const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([key, condition]: [string, any]) => {
    if (key === 'AND') return condition.every((entry: any) => matches(row, entry));
    if (key === 'OR') return condition.some((entry: any) => matches(row, entry));
    if (key === 'metadata') {
      const value = (condition.path || []).reduce((parent: any, field: string) => parent?.[field], row.metadata);
      return value === condition.equals;
    }
    const actual = row[key];
    if (condition instanceof Date) return actual instanceof Date && actual.getTime() === condition.getTime();
    if (condition && typeof condition === 'object') {
      if ('not' in condition) return actual !== condition.not;
      if ('in' in condition) return condition.in.includes(actual);
      if ('equals' in condition) return actual === condition.equals;
      throw new Error(`unsupported fixture filter: ${key}`);
    }
    return actual === condition;
  });
  const apply = (row: any, data: any) => {
    Object.assign(row, clone(data), { updatedAt: new Date(Date.now() + ++tick) });
    return clone(row);
  };
  const prisma: any = {
    videoTask: {
      findUnique: async ({ where }: any) => clone(rows.get(where.id) || null),
      findUniqueOrThrow: async ({ where }: any) => {
        assert.ok(rows.has(where.id)); return clone(rows.get(where.id));
      },
      create: async ({ data }: any) => {
        if (controls.collision) {
          controls.collision = false;
          rows.set(data.id, { ...clone(data), metadata: { ...clone(data.metadata), requestHash: 'concurrent-different-request' }, createdAt: new Date(), updatedAt: new Date() });
          throw Object.assign(new Error('concurrent unique conflict'), { code: 'P2002' });
        }
        if (rows.has(data.id)) throw Object.assign(new Error('unique conflict'), { code: 'P2002' });
        const row = { ...clone(data), createdAt: new Date(), updatedAt: new Date(), error: null, completedAt: null };
        rows.set(data.id, row); return clone(row);
      },
      update: async ({ where, data }: any) => { const row = rows.get(where.id); assert.ok(row); return apply(row, data); },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows.values()) if (matches(row, where)) { apply(row, data); count++; }
        return { count };
      },
    },
    teamMembership: { findUnique: async () => controls.member ? { userId: 'user-a', teamId: 'team-a', role: 'member' } : null },
    project: { findUnique: async ({ where }: any) => ({ id: where.id, userId: 'user-a', teamId: 'team-a' }) },
    team: { findUnique: async ({ where }: any) => ({ id: where.id, isPersonal: false }) },
  };
  prisma.$transaction = async (work: any) => work(prisma);
  const queue = {
    getJob: async (id: string) => { if (controls.unavailable) throw new Error('Redis unavailable'); return jobs.get(id); },
    add: async (_name: string, _data: any, options: any) => {
      controls.adds++;
      if (controls.enqueueError) throw new Error('enqueue failed');
      const job: any = { state: 'waiting', failedReason: 'worker interrupted',
        getState: async () => job.state,
        retry: async () => { controls.retries++; if (controls.enqueueError) throw new Error('retry failed'); job.state = 'waiting'; },
        remove: async () => { jobs.delete(options.jobId); },
      };
      jobs.set(options.jobId, job); return job;
    },
  };
  const service: any = new VideoAnalysisTaskService({ get: () => undefined } as unknown as ConfigService, prisma, {} as any, {} as any);
  service.queue = queue;
  return { service, rows, jobs, controls };
}

async function main() {
  {
    const { service, rows, controls } = fixture();
    const first = await service.submit(dto, request(), 'user-a');
    const again = await service.submit(dto, request(), 'user-a');
    assert.equal(again.taskId, first.taskId);
    assert.equal(controls.adds, 1, 'duplicate clicks must not enqueue another execution');
    await assert.rejects(service.submit({ ...dto, prompt: 'different' }, request(), 'user-a'), /参数|一致/);
    await assert.rejects(service.get(first.taskId, 'user-b'), /不存在/);
    const stored = rows.get(first.taskId).metadata.billingRequest;
    assert.equal(stored.user.email, undefined);
    assert.equal(stored.user.passwordHash, undefined);
    assert.equal(stored.user.roles, undefined);
    assert.equal(stored.user.id || stored.user.sub, 'user-a');
  }
  {
    const { service, controls } = fixture();
    controls.collision = true;
    await assert.rejects(service.submit(dto, request(), 'user-a'), /参数|一致/, 'the P2002 path must recheck the winning request hash');
    assert.equal(controls.adds, 0);
  }
  {
    const { service, rows, jobs, controls } = fixture();
    const first = await service.submit(dto, request('team-a'), 'user-a');
    await assert.rejects(service.submit(dto, request('team-b'), 'user-a'), /参数|一致/);
    rows.get(first.taskId).status = 'failed';
    jobs.get(first.taskId).state = 'failed';
    await assert.rejects(service.submit({ ...dto, resumeTaskId: first.taskId }, request('team-b'), 'user-a'), /参数|一致/);
    await assert.rejects(service.submit({ ...dto, projectId: 'project-b', resumeTaskId: first.taskId }, request('team-a'), 'user-a'), /参数|一致/);
    assert.equal(controls.retries, 0);
    const resumed = await Promise.all([
      service.submit({ ...dto, resumeTaskId: first.taskId }, request('team-a'), 'user-a'),
      service.submit({ ...dto, resumeTaskId: first.taskId }, request('team-a'), 'user-a'),
    ]);
    assert.equal(controls.retries, 1, 'concurrent resume clicks must admit one attempt');
    assert.ok(resumed.every((result: any) => result.taskId === first.taskId));
    assert.equal(rows.get(first.taskId).metadata.attempt, 2);
    assert.equal(rows.get(first.taskId).metadata.billingRequest.headers['x-team-id'], 'team-a');
  }
  {
    const { service, rows, controls } = fixture();
    controls.enqueueError = true;
    const first = await service.submit(dto, request(), 'user-a');
    assert.equal(first.status, 'failed', 'enqueue failure must not strand the task as queued');
    controls.enqueueError = false;
    const resumed = await service.submit({ ...dto, resumeTaskId: first.taskId }, request(), 'user-a');
    assert.equal(resumed.status, 'queued');
    assert.equal(rows.get(first.taskId).metadata.attempt, 2);
  }
  {
    const { service, rows, jobs, controls } = fixture();
    const first = await service.submit(dto, request(), 'user-a');
    rows.get(first.taskId).status = 'failed'; jobs.get(first.taskId).state = 'failed';
    controls.enqueueError = true;
    await service.submit({ ...dto, resumeTaskId: first.taskId }, request(), 'user-a').catch(() => undefined);
    assert.equal(rows.get(first.taskId).status, 'failed', 'a Redis retry failure must stay recoverable');
    controls.enqueueError = false;
    await service.submit({ ...dto, resumeTaskId: first.taskId }, request(), 'user-a');
    assert.equal(rows.get(first.taskId).status, 'queued');
  }
  {
    const { service, rows, jobs, controls } = fixture();
    const first = await service.submit(dto, request(), 'user-a');
    let executions = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    service.registerExecutor(async () => { executions++; await gate; return { text: 'one completed result' }; });
    const a = service.execute(first.taskId);
    const b = service.execute(first.taskId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(executions, 1, 'the database claim must prevent duplicate provider POSTs');
    release(); await Promise.all([a, b]);
    assert.equal(rows.get(first.taskId).status, 'succeeded');
    assert.equal(controls.adds, 1);
    assert.equal(jobs.size, 1);
    await service.execute(first.taskId);
    assert.equal(executions, 1, 'a completed task must never execute again automatically');
  }
  {
    const { service, rows, jobs, controls } = fixture();
    const first = await service.submit(dto, request(), 'user-a');
    rows.get(first.taskId).status = 'processing'; jobs.get(first.taskId).state = 'failed';
    const interrupted = await service.get(first.taskId, 'user-a');
    assert.equal(interrupted.status, 'failed');
    assert.equal(controls.adds, 1, 'querying recovery state must not submit work');
    rows.get(first.taskId).status = 'processing'; controls.unavailable = true;
    const unavailable = await service.get(first.taskId, 'user-a');
    assert.equal(unavailable.status, 'processing', 'a Redis outage does not prove that analysis failed');
    assert.ok(unavailable.pollingWarning);
    assert.equal(controls.adds, 1);
  }
  console.log('Video analysis task recovery: 7 scenarios passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
