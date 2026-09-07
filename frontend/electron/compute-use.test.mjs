import test from 'node:test';
import assert from 'node:assert/strict';
import { computeUse, dispatchComputeUse } from './compute-use.mjs';

test('compute-use delegates external software work to the capability host', async () => {
  const calls = [];
  const result = await computeUse({
    host: { callTool: async (...args) => {
      calls.push(args);
      return { result: { isError: false, text: 'SketchUp model saved', truncated: false } };
    } },
    connectorId: 'sketchup',
    toolName: 'save_model',
    args: { path: '/tmp/model.skp' },
    taskId: 'task-1',
    action: 'update_material',
  });
  assert.deepEqual(calls, [['sketchup', 'save_model', { path: '/tmp/model.skp' }]]);
  assert.equal(result.text, 'SketchUp model saved');
  assert.equal(result.computeUse.connectorId, 'sketchup');
  assert.equal(result.computeUse.taskId, 'task-1');
  assert.equal(result.computeUse.action, 'update_material');
});

test('compute-use rejects an unregistered external operation before host execution', async () => {
  let called = false;
  await assert.rejects(
    computeUse({
      host: { callTool: async () => { called = true; return { result: {} }; } },
      connectorId: 'blender',
      toolName: 'execute_python',
      action: 'execute_python',
    }),
    /不允许的 compute-use 动作/
  );
  assert.equal(called, false);
});

test('dispatchComputeUse exposes canonical actions instead of raw connector tool names', async () => {
  const calls = [];
  const result = await dispatchComputeUse({
    host: { callTool: async (...args) => { calls.push(args); return { result: { text: 'ok' } }; } },
    connectorId: 'blender',
    action: 'render_scene',
    args: { sceneId: 'scene-1' },
  });
  assert.deepEqual(calls, [['blender', 'render_scene', { sceneId: 'scene-1' }]]);
  assert.equal(result.computeUse.action, 'render_scene');
});
