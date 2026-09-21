import 'reflect-metadata';
import assert from 'node:assert/strict';
import { AgentRuntimeService } from './agent-runtime.service';

async function main() {
  for (const enabled of [undefined, 'false']) {
    const paused = new AgentRuntimeService({} as never, {} as never,
      { get: () => enabled } as never,
      { run: () => assert.fail('disabled route must not call upstream') } as never);
    assert.throws(() => paused.createRun({ prompt: '你好', mode: 'canvasAgent' }, 'owner'),
      /小T Beta 暂时停用/);
    assert.equal((paused as any).runs.size, 0, 'disabled requests must not allocate a run');
  }
  let observed: unknown;
  const runtime = new AgentRuntimeService({} as never, {} as never, { get: () => 'true' } as never, {
    run: async (_dto: unknown, _user: string, _emit: unknown, _team: unknown, _continuation: unknown,
      query: (args: Record<string, unknown>) => Promise<Record<string, unknown>>) => {
      observed = await query({ scope: 'ids', nodeIds: ['hidden'] });
    },
  } as never);
  const run = runtime.createRun({ prompt: '读取节点', mode: 'canvasAgent', browserContextQueries: true }, 'owner');
  await new Promise((resolve) => setTimeout(resolve, 10));
  const event = runtime.getEvents(run.id, 'owner').find((item) => item.type === 'host_context_query');
  assert.ok(event);
  const queryId = String(event.data?.queryId);
  assert.throws(() => runtime.submitCanvasContext(run.id, 'other-user', queryId, {}));
  assert.throws(() => runtime.submitCanvasContext(run.id, 'owner', 'other-query', {}));
  assert.throws(() => runtime.submitCanvasContext(run.id, 'owner', queryId, { text: 'x'.repeat(256001) }));
  const result = { nodes: [{ id: 'hidden', data: { text: 'browser-only-value' } }] };
  assert.deepEqual(runtime.submitCanvasContext(run.id, 'owner', queryId, result), { accepted: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(observed, result);
  assert.equal(runtime.getRun(run.id, 'owner').status, 'completed');
  assert.throws(() => runtime.submitCanvasContext(run.id, 'owner', queryId, result));
  console.log('browser host context ownership, bounded payload, single consumption passed');
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
