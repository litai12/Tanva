import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { SINGLE_IMAGE_TASK_NODE_TYPES } from './flowProgressRuntime.ts';

// Exercise the real callbacks without mounting the canvas or calling a paid provider.
const source = readFileSync(new URL('./FlowOverlay.tsx', import.meta.url), 'utf8');
const react = { useCallback: (callback: unknown) => callback };
function loadCallback(name: string, end: string, dependencies: Record<string, unknown>) {
  const start = source.indexOf(`  const ${name} = React.useCallback(`);
  assert.ok(start >= 0);
  const finish = source.indexOf(end, start);
  assert.ok(finish > start);
  const output = ts.transpileModule(source.slice(start, finish) + `\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(dependencies), output)(...Object.values(dependencies));
}

test('rapid clicks submit once; completion unlocks the node', async () => {
  let finish!: () => void;
  let calls = 0;
  const lock = { current: new Set<string>() };
  const run = loadCallback('runNode', '  // 小T agent 画布桥', {
    React: react, runNodeInFlightRef: lock,
    runNodeInner: () => { calls++; return new Promise<void>((resolve) => { finish = resolve; }); },
    setNodes: () => {}, SINGLE_IMAGE_TASK_NODE_TYPES,
  });
  const first = run('image-1');
  await Promise.all([run('image-1'), run('image-1')]);
  assert.equal(calls, 1);
  assert.equal(lock.current.has('image-1'), true);
  finish();
  await first;
  assert.equal(lock.current.size, 0);
  const next = run('image-1');
  assert.equal(calls, 2);
  finish();
  await next;
});

test('preparation failure displays an error and releases the lock', async () => {
  let nodes = [{ id: 'image-1', type: 'generatePro', data: { status: 'running' } }];
  const lock = { current: new Set<string>() };
  const run = loadCallback('runNode', '  // 小T agent 画布桥', {
    React: react, runNodeInFlightRef: lock,
    runNodeInner: async () => { throw new Error('reference upload failed'); },
    setNodes: (update: (value: typeof nodes) => typeof nodes) => { nodes = update(nodes); },
    SINGLE_IMAGE_TASK_NODE_TYPES,
  });
  await assert.rejects(run('image-1'), /reference upload failed/);
  assert.equal(nodes[0].data.status, 'failed');
  assert.equal(lock.current.size, 0);
});

for (const scenario of ['preparing', 'processing', 'cancelled'] as const) {
  test(`stop during ${scenario} keeps activity until polling confirms termination`, async () => {
    const node = { id: 'image-1', type: 'generatePro', data: {
      status: 'running', taskId: scenario === 'preparing' ? undefined : 'paid-task-1',
    } };
    const before = structuredClone(node);
    let cancelCalls = 0;
    const events: unknown[] = [];
    const stop = loadCallback('stopNode', '  const runGlobalNodes', {
      React: react, rf: { getNode: () => node }, SINGLE_IMAGE_TASK_NODE_TYPES,
      cancelImageTaskViaAPI: async (taskId: string) => {
        assert.equal(taskId, 'paid-task-1');
        cancelCalls++;
        return { cancelled: scenario === 'cancelled' };
      },
      window: { dispatchEvent: (event: unknown) => { events.push(event); } },
      CustomEvent: class { constructor(public type: string, public options: unknown) {} },
      setNodes: () => { assert.fail('must not reset before terminal polling'); },
    });
    await stop('image-1');
    assert.deepEqual(node, before);
    assert.equal(cancelCalls, scenario === 'preparing' ? 0 : 1);
    assert.equal(events.length, 1);
  });
}
