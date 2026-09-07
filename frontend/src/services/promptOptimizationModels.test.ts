import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROMPT_OPTIMIZATION_MODEL,
  PROMPT_OPTIMIZATION_MODELS,
  getPromptOptimizationModelLabel,
  resolvePromptOptimizationModel,
} from "./promptOptimizationModels.ts";

test("prompt optimizer exposes only DeepSeek", () => {
  assert.deepEqual(PROMPT_OPTIMIZATION_MODELS, [
    "deepseek-v4-flash",
  ]);
  assert.equal(DEFAULT_PROMPT_OPTIMIZATION_MODEL, "deepseek-v4-flash");
});

test("legacy, unavailable and unknown prompt optimizer models migrate to DeepSeek", () => {
  assert.equal(resolvePromptOptimizationModel("gpt-5.4"), "deepseek-v4-flash");
  assert.equal(resolvePromptOptimizationModel(undefined), "deepseek-v4-flash");
  assert.equal(resolvePromptOptimizationModel("deepseek-v4-flash"), "deepseek-v4-flash");
  assert.equal(
    getPromptOptimizationModelLabel("gpt-5.6-terra"),
    "DeepSeek V4 Flash",
  );
});
