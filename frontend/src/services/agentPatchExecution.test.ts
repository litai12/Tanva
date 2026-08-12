import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAgentPatchExecutionReport,
  collectAgentNodeAssets,
} from "./agentPatchExecution.ts";

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
