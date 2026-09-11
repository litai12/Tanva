import assert from "node:assert/strict";
import test from "node:test";
import { expandGptImageModelConfigs, buildGptImageModelSwitchPatch, normalizeCanvasGptImage25Model, type GptImageModelOption } from "./gptImage25.ts";

const option = (model: string): GptImageModelOption => ({
  model,
  nodeConfigKey: model.startsWith("gpt-image-2.5") ? "gptImage25" : "gptImage2",
  nodeConfigNameZh: model,
  nodeConfigNameEn: model,
  creditsPerCall: model === "gpt-image-2.5" ? 20 : 40,
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
  assert.equal(next.creditsPerCall, 40);
  assert.equal(next.imageUrl, saved.imageUrl);
  assert.equal(next.presetPrompt, saved.presetPrompt);
});

test("retired base nodes migrate to Flare and cannot be selected again", () => {
  assert.equal(normalizeCanvasGptImage25Model("gpt-image-2.5", "gptImage25"), "gpt-image-2.5-flare");
  assert.equal(normalizeCanvasGptImage25Model("", "gptImage25"), "gpt-image-2.5-flare");
  assert.equal(normalizeCanvasGptImage25Model("", "", "gpt-image-2.5"), "gpt-image-2.5-flare");
  assert.equal(buildGptImageModelSwitchPatch(option("gpt-image-2.5")), null);
});

test("disabled catalog options cannot produce a model switch", () => {
  assert.equal(buildGptImageModelSwitchPatch({ ...option("gpt-image-2.5"), enabled: false }), null);
});

test("explicit variants survive switching and JSON persistence", () => {
  for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    const patch = buildGptImageModelSwitchPatch(option(model))!;
    const restored = JSON.parse(JSON.stringify(Object.assign({ quality: "max" }, patch)));
    assert.equal(normalizeCanvasGptImage25Model(restored.model, restored.nodeConfigKey), model);
    assert.equal(restored.managedModelKey, model);
    assert.equal(restored.quality, undefined);
  }
});


test("legacy keys only fill missing model values", () => {
  assert.equal(normalizeCanvasGptImage25Model("", "gptImage25Flare", "gpt-image-2.5"), "gpt-image-2.5-flare");
  assert.equal(normalizeCanvasGptImage25Model("", "gptImage25Sunburst"), "gpt-image-2.5-sunburst");
  assert.equal(normalizeCanvasGptImage25Model("gpt-image-2.5-flare", "gptImage25Sunburst"), "gpt-image-2.5-flare");
});

test("catalog options expose exact model labels and isolated pricing routes", () => {
  const routes = Object.fromEntries(["gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].map((modelKey, index) => [modelKey, { modelKey, vendors: [{ vendorKey: "new_api", creditsPerCall: 20 + index }] }]));
  const configs = expandGptImageModelConfigs([{ nodeKey: "gptImage25", nameZh: "GPT", nameEn: "GPT", category: "image", status: "normal", sortOrder: 1, creditsPerCall: 20, metadata: { supportedModels: ["gpt-image-2.5-flare"], managedRoutesByModel: routes } }]);
  assert.deepEqual(configs.map(c => c.nameZh), ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
  for (const config of configs) {
    assert.equal(config.metadata?.managedRoutes.modelKey, config.metadata?.model);
    assert.deepEqual(config.metadata?.supportedModels, ["gpt-image-2.5-flare"]);
  }
});
