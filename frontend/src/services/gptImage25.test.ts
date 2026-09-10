import assert from "node:assert/strict";
import test from "node:test";
import { buildGptImageModelSwitchPatch, normalizeCanvasGptImage25Model, type GptImageModelOption } from "./gptImage25.ts";

const option = (model: string): GptImageModelOption => ({
  model,
  nodeConfigKey: model === "gpt-image-2.5" ? "gptImage25" : "gptImage2",
  nodeConfigNameZh: model,
  nodeConfigNameEn: model,
  creditsPerCall: 20,
  enabled: true,
  nodeConfigMetadata: { model, maxReferenceImages: model === "gpt-image-2.5" ? null : 16 },
});

test("switching a saved legacy 2.5 node to 2 survives execution normalization", () => {
  const saved = { model: "gpt-image-2.5-flare", nodeConfigKey: "gptImage25Flare", quality: "max", vendorKey: "jichuan", imageUrl: "https://example.com/result.png", presetPrompt: "keep me" };
  const next = { ...saved, ...buildGptImageModelSwitchPatch(option("gpt-image-2")) };
  assert.equal(normalizeCanvasGptImage25Model(next.model, next.nodeConfigKey), "gpt-image-2");
  assert.equal(next.managedModelKey, "gpt-image-2");
  assert.equal(next.quality, "auto");
  assert.equal(next.vendorKey, undefined);
  assert.equal(next.maxReferenceImages, 16);
  assert.equal(next.imageUrl, saved.imageUrl);
  assert.equal(next.presetPrompt, saved.presetPrompt);
});

test("switching to 2.5 resets quality and old reference limits with the new routing identity", () => {
  const next = { quality: "low", maxReferenceImages: 1, ...buildGptImageModelSwitchPatch(option("gpt-image-2.5")) };
  assert.equal(next.quality, "max");
  assert.equal(next.maxReferenceImages, null);
  assert.equal(next.managedModelKey, "gpt-image-2.5");
  assert.equal(normalizeCanvasGptImage25Model(next.model!, next.nodeConfigKey), "gpt-image-2.5");
});

test("disabled catalog options cannot produce a model switch", () => {
  assert.equal(buildGptImageModelSwitchPatch({ ...option("gpt-image-2.5"), enabled: false }), null);
});

test("legacy variants still normalize to the single supported 2.5 model", () => {
  for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    assert.equal(normalizeCanvasGptImage25Model(model), "gpt-image-2.5");
  }
});
