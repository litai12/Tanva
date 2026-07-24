import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONTENT_SAFETY_REFUSAL,
  sanitizeAITextOutput,
  shouldBlockAIRequest,
} from "./aiContentSafety.ts";

test("blocks political aliases and sensitive creation before dispatch", () => {
  assert.equal(shouldBlockAIRequest("宽衣帝是谁"), true);
  assert.equal(shouldBlockAIRequest("介绍一下中国现任领导人"), true);
  assert.equal(shouldBlockAIRequest("生成一张血 腥 肢 解的海报"), true);
  assert.equal(shouldBlockAIRequest("帮我制作战争视频"), true);
  assert.equal(shouldBlockAIRequest("设计一张咖啡店海报"), false);
});

test("replaces leaked political names in model output", () => {
  assert.equal(
    sanitizeAITextOutput("这个绰号指的是习近平。"),
    AI_CONTENT_SAFETY_REFUSAL
  );
  assert.equal(sanitizeAITextOutput("这里是一份海报排版建议。"), "这里是一份海报排版建议。");
});
