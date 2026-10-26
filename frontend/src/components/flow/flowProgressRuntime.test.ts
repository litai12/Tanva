import assert from "node:assert/strict";
import test from "node:test";
import { startFlowProgressRun, startFlowImageRun } from "./flowProgressRuntime.ts";

test("replaces a stale timestamp whenever a node starts a new run", () => {
  const previousData = {
    status: "succeeded",
    imageUrl: "https://assets.example/result.png",
    progressStartedAt: 1_000,
  };
  const secondRun = startFlowProgressRun(previousData, 4_000);

  assert.equal(secondRun.progressStartedAt, 4_000);
  assert.equal(secondRun.status, "succeeded");
  assert.equal(secondRun.imageUrl, previousData.imageUrl);
  assert.equal(previousData.progressStartedAt, 1_000);
});

test("image reruns show activity immediately without recovering the previous result", () => {
  const previous = {
    status: "succeeded", taskId: "old-paid-task", taskPhase: "processing",
    error: "old error", progressStartedAt: 1000, imageUrl: "https://assets.example/old.png",
  };
  const next = startFlowImageRun(previous, 4000);
  assert.equal(next.status, "running");
  assert.equal(next.taskId, undefined);
  assert.equal(next.taskPhase, undefined);
  assert.equal(next.error, undefined);
  assert.equal(next.progressStartedAt, 4000);
  assert.equal(next.imageUrl, previous.imageUrl);
  assert.equal(previous.taskId, "old-paid-task");
});

test('collab patches never carry another client\'s run state', async () => {
  const { stripFlowRunStateForCollab } = await import('./flowProgressRuntime.ts');
  const running = { aspectRatio: '21:9', resolution: '4K', imageUrl: 'https://oss/a.jpg', status: 'running',
    progressStartedAt: 1, taskPhase: 'processing', taskId: 't1', error: undefined };
  assert.deepEqual(stripFlowRunStateForCollab(running), { aspectRatio: '21:9', resolution: '4K', imageUrl: 'https://oss/a.jpg' });
  const settings = { aspectRatio: '1:1' };
  assert.equal(stripFlowRunStateForCollab(settings), settings, 'no copy when nothing to strip');
});
