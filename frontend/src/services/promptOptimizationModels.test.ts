import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROMPT_OPTIMIZATION_MODEL,
  PROMPT_OPTIMIZATION_MODELS,
  getPromptOptimizationModelLabel,
  resolvePromptOptimizationModel,
} from "./promptOptimizationModels.ts";

test("prompt optimizer exposes exactly the verified Right model set", () => {
  assert.deepEqual(PROMPT_OPTIMIZATION_MODELS, [
    "gpt-5.6-luna",
    "gpt-5.6-terra",
  ]);
  assert.equal(DEFAULT_PROMPT_OPTIMIZATION_MODEL, "gpt-5.6-terra");
});

test("legacy, unavailable and unknown prompt optimizer models migrate to Terra", () => {
  assert.equal(resolvePromptOptimizationModel("gpt-5.4"), "gpt-5.6-terra");
  assert.equal(resolvePromptOptimizationModel(undefined), "gpt-5.6-terra");
  assert.equal(resolvePromptOptimizationModel("deepseek-v4-flash"), "gpt-5.6-terra");
  assert.equal(
    getPromptOptimizationModelLabel("gpt-5.6-terra"),
    "GPT-5.6 Terra",
  );
});
