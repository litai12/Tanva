import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import ts from 'typescript';
import { SINGLE_IMAGE_TASK_NODE_TYPES } from './flowProgressRuntime.ts';

// Exercise the real callbacks without mounting the canvas or calling a paid provider.
const source = readFileSync(new URL('./FlowOverlay.tsx', import.meta.url), 'utf8');
const react = { useCallback: (callback: unknown) => callback };
function loadCallback(name: string, end: string, dependencies: Record<string, unknown>) {
  dependencies = {
    rf: { getNode: () => ({ type: 'gptImage2', data: {} }) },
    normalizeFlowNodeType: (type: string) => type,
    FLOW_VIDEO_GENERATION_NODE_TYPES: new Set(),
    ...dependencies,
  };
  const start = source.indexOf(`  const ${name} = React.useCallback(`);
  assert.ok(start >= 0);
  const finish = source.indexOf(end, start);
  assert.ok(finish > start);
  const output = ts.transpileModule(source.slice(start, finish) + `\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(dependencies), output)(...Object.values(dependencies));
}

test('GPT Image 2 and 2.5 requests scope identical node IDs to the current project', () => {
  const branch = source.indexOf('if (node.type === "nano2" || node.type === "gptImage2")');
  const start = source.indexOf('          const requestPayload: AIImageGenerateRequest = {', branch);
  const end = source.indexOf('\n\n          const result =', start);
  assert.ok(branch >= 0 && start > branch && end > start);
  const output = ts.transpileModule(source.slice(start, end) + '\nreturn requestPayload;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const requestedModel of ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) {
    const dependencies = {
      promptText: '一只猫', requestedModel, latestBananaImageRoute: 'normal',
      nano2AspectRatio: '16:9', imageDatas: [], nano2Resolution: '1K',
      node: { id: 'shared-node-id', type: 'gptImage2' }, clientProjectId: 'project-a',
      gptImage2OfficialFallback: false, gptImage2Quality: undefined,
      gptImage2Background: undefined, gptImage2Moderation: undefined,
      gptImage2OutputFormat: undefined, gptImage2OutputCompression: undefined,
      gptImage2MaskUrl: undefined,
    };
    const build = new Function(...Object.keys(dependencies), output);
    const first = build(...Object.values(dependencies));
    const second = build(...Object.values({ ...dependencies, clientProjectId: 'project-b' }));
    assert.equal(first.model, requestedModel);
    assert.equal(first.nodeId, second.nodeId);
    assert.equal(first.projectId, 'project-a');
    assert.equal(second.projectId, 'project-b');
  }
});

for (const terminal of ['succeeded', 'failed', 'not-found'] as const) {
  test(`image recovery survives an unavailable first query and reaches ${terminal}`, async () => {
    let nodes = [{ id: 'image-1', type: 'gptImage2', data: { status: 'running', taskId: 'original-task' } }];
    const marker = source.indexOf('  const recoveredTaskIdsRef =');
    const start = source.indexOf('  React.useEffect(', marker);
    const end = source.indexOf('\n\n  // 视频任务身份', start);
    const effectSource = source.slice(start, end)
      .replaceAll('import("@/utils/imageTaskPoller")', 'imageTaskPoller');
    const output = ts.transpileModule('const effect = ' + effectSource.trim() + '\nreturn effect;', {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    let pollCalls = 0;
    const dependencies = {
      React: { useEffect: (callback: unknown) => callback }, nodes,
      recoveredTaskIdsRef: { current: new Set() }, SINGLE_IMAGE_TASK_NODE_TYPES,
      queryImageTaskStatusViaAPI: async () => ({ success: false, error: { code: 'HTTP_503' } }),
      setNodes: (update: (current: typeof nodes) => typeof nodes) => { nodes = update(nodes); },
      imageTaskPoller: Promise.resolve({
        waitForTask: async (taskId: string) => {
          assert.equal(taskId, 'original-task');
          pollCalls++;
          if (terminal === 'not-found') throw new Error('Task original-task not found');
          return { status: terminal, imageUrl: terminal === 'succeeded' ? 'https://example.com/cat.png' : undefined, error: terminal === 'failed' ? 'provider rejected request' : undefined };
        },
        describeTaskPollError: () => '任务已失效，请重新生成。',
      }),
    };
    const effect = new Function(...Object.keys(dependencies), output)(...Object.values(dependencies));
    effect();
    await setImmediate();
    assert.equal(pollCalls, 1);
    assert.equal(nodes[0].data.taskId, 'original-task');
    assert.equal(nodes[0].data.status, terminal === 'succeeded' ? 'succeeded' : 'failed');
  });
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
