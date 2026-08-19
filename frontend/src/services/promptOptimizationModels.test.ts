import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROMPT_OPTIMIZATION_MODEL,
  PROMPT_OPTIMIZATION_MODELS,
  getPromptOptimizationModelLabel,
  resolvePromptOptimizationModel,
} from "./promptOptimizationModels.ts";

test("prompt optimizer exposes exactly the supported three-model set", () => {
  assert.deepEqual(PROMPT_OPTIMIZATION_MODELS, [
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "deepseek-v4-flash",
  ]);
  assert.equal(DEFAULT_PROMPT_OPTIMIZATION_MODEL, "gpt-5.6-luna");
});

test("legacy and unknown prompt optimizer models migrate to Luna", () => {
  assert.equal(resolvePromptOptimizationModel("gpt-5.4"), "gpt-5.6-luna");
  assert.equal(resolvePromptOptimizationModel(undefined), "gpt-5.6-luna");
  assert.equal(
    resolvePromptOptimizationModel("deepseek-v4-flash"),
    "deepseek-v4-flash",
  );
  assert.equal(
    getPromptOptimizationModelLabel("gpt-5.6-terra"),
    "小T-5.6 Terra",
  );
});
