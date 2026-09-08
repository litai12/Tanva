import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAgentPatchExecutionReport,
  collectAgentNodeAssets,
  waitForAgentNodeResult,
} from "./agentPatchExecution.ts";

it('waits beyond five seconds for a submitted video and ignores its old asset while running', async () => {
  let clock = 0;
  const result = await waitForAgentNodeResult('video', () => clock < 20_000
    ? { status: 'running', taskId: 'accepted-task', videoUrl: 'https://assets.test/old.mp4' }
    : { status: 'succeeded', videoUrl: 'https://assets.test/new.mp4' },
    { now: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.equal(clock, 20_000);
  assert.equal(result.ok, true);
  assert.deepEqual(result.assets, [{ kind: 'video', url: 'https://assets.test/new.mp4' }]);
});

it('returns actual provider failures and bounds indefinitely pending jobs', async () => {
  let clock = 0;
  const options = { now: () => clock, sleep: async (ms: number) => { clock += ms; }, deadlineAt: 10_000 };
  const failure = await waitForAgentNodeResult('video', () => clock < 6000
    ? { status: 'running' } : { status: 'failed', error: 'provider rejected task' }, options);
  assert.equal(failure.error, 'provider rejected task');
  clock = 0;
  const timeout = await waitForAgentNodeResult('video', () => ({ status: 'running' }), options);
  assert.equal(timeout.ok, false);
  assert.equal(clock, 10_000);
  assert.match(timeout.error || '', /超时/);
});

describe("collectAgentNodeAssets", () => {
  it("collects and deduplicates durable image, video, and audio URLs", () => {
    assert.deepEqual(
      collectAgentNodeAssets({
        imageUrl: "https://assets.test/cover.png",
        imageUrls: ["https://assets.test/cover.png", "data:image/png;base64,abc"],
        videoResults: [{ videoUrl: "https://assets.test/clip.mp4" }],
        audioResults: [{ url: "https://assets.test/voice.mp3" }],
      }),
      [
        { kind: "image", url: "https://assets.test/cover.png" },
        { kind: "video", url: "https://assets.test/clip.mp4" },
        { kind: "audio", url: "https://assets.test/voice.mp3" },
      ]
    );
  });

  it("does not accept local previews as delivery evidence", () => {
    assert.deepEqual(
      collectAgentNodeAssets({
        imageUrl: "blob:https://tanva.test/local",
        imageData: "data:image/png;base64,abc",
      }),
      []
    );
  });
});

describe("buildAgentPatchExecutionReport", () => {
  it("preserves failures and aggregates unique assets", () => {
    const report = buildAgentPatchExecutionReport([
      {
        op: "runNode",
        ok: true,
        nodeId: "image-1",
        assets: [{ kind: "image", url: "https://assets.test/cover.png" }],
      },
      {
        op: "connectEdge",
        ok: false,
        assets: [],
        error: "edge rejected",
      },
    ]);
    assert.equal(report.succeededCount, 1);
    assert.equal(report.failedCount, 1);
    assert.deepEqual(report.assets, [
      { kind: "image", url: "https://assets.test/cover.png" },
    ]);
  });
});
