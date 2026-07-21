import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVideoProviderErrorMessage,
  validateVideoGenerationResponse,
} from "./videoProviderResponse.ts";

test("preserves a specific HTTP 400 prompt-length error", () => {
  assert.throws(
    () =>
      validateVideoGenerationResponse(
        { statusCode: 400, message: "提示词过长，请缩短后重试", error: "Bad Request" },
        { ok: false, status: 400 }
      ),
    /提示词过长，请缩短后重试/
  );
});

test("joins Nest validation message arrays", () => {
  assert.equal(
    extractVideoProviderErrorMessage(
      { message: ["prompt must be shorter", "prompt exceeds the model limit"] },
      "fallback"
    ),
    "prompt must be shorter; prompt exceeds the model limit"
  );
});

test("rejects an HTTP 200 failure payload before polling", () => {
  assert.throws(
    () =>
      validateVideoGenerationResponse(
        { taskId: "usage-1", status: "failed", error: { message: "prompt too long" } },
        { ok: true, status: 200 }
      ),
    /prompt too long/
  );
});

test("rejects an HTTP 200 payload without a task ID", () => {
  assert.throws(
    () =>
      validateVideoGenerationResponse(
        { status: "processing" },
        { ok: true, status: 200 }
      ),
    /未返回有效任务 ID/
  );
});

test("returns a normalized valid task ID for a successful creation response", () => {
  const result = validateVideoGenerationResponse(
    { taskId: "  newapi:task-1  ", status: "queued", apiUsageId: "usage-1" },
    { ok: true, status: 200 }
  );

  assert.equal(result.taskId, "newapi:task-1");
  assert.equal(result.apiUsageId, "usage-1");
});
