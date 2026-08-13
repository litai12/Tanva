import assert from "node:assert/strict";
import test from "node:test";
import { startFlowProgressRun } from "./flowProgressRuntime.ts";

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
