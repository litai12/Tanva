import assert from "node:assert/strict";
import test from "node:test";
import { GPT_IMAGE_25_VIP_MODELS, NANO_BANANA_21_MODEL, NANO_BANANA_21_OFFICIAL_MODEL, resolveExistingNanoImageModel, resolveNanoImageModelForRoute, getToapiImageRoute, getToapiImageSettings, getToapiImageFallbackCredits } from "./toapiImageModels.ts";
import { buildImageNodeCreditsPreviewConfig } from "./imageNodeCreditsPreviewConfig.ts";
import { expandNanoImageModelConfigs, buildGptImageModelSwitchPatch } from "./gptImage25.ts";

test("all 30 VIP quotes match execution settings and the approved price matrix", () => {
  const matrix = { low: [20, 30, 40], medium: [30, 40, 50], high: [40, 60, 80], xhigh: [60, 100, 140], max: [150, 300, 450] };
  for (const model of GPT_IMAGE_25_VIP_MODELS) {
    for (const [quality, prices] of Object.entries(matrix)) {
      for (const [i, imageSize] of ["1K", "2K", "4K"].entries()) {
        const preview = buildImageNodeCreditsPreviewConfig({ nodeType: "gptImage2", aiProvider: "nano2", model, bananaImageRoute: "stable", imageSize, gptImage2Quality: quality });
        const execution = getToapiImageSettings(model, imageSize, quality);
        for (const [key, value] of Object.entries(execution)) assert.deepEqual(preview.requestParams[key as keyof typeof preview.requestParams], value);
        assert.equal(getToapiImageFallbackCredits(model, imageSize, quality), prices[i]);
      }
    }
  }
});

test("VIP missing and auto quality default to high in preview and execution", () => {
  for (const quality of [undefined, "auto", "invalid"]) {
    const model = GPT_IMAGE_25_VIP_MODELS[0];
    assert.equal(getToapiImageSettings(model, "2K", quality).quality, "high");
    assert.equal(buildImageNodeCreditsPreviewConfig({ nodeType: "gptImage2", model, imageSize: "2K", gptImage2Quality: quality }).requestParams.quality, "high");
  }
});

test("ordinary 2.5 variants keep quality omitted even with old saved quality", () => {
  for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    const preview = buildImageNodeCreditsPreviewConfig({ nodeType: "gptImage2", model, imageSize: "4K", gptImage2Quality: "max", bananaImageRoute: "stable" });
    assert.equal(preview.requestParams.quality, undefined);
    assert.equal(preview.requestParams.providerOptions?.banana?.imageRoute, "normal");
  }
});

test("Nano2.1 quote keeps the precise model on all global routes and all resolutions", () => {
  for (const route of ["normal", "stable", "ultra"]) {
    for (const [index, imageSize] of ["1K", "2K", "4K"].entries()) {
      const preview = buildImageNodeCreditsPreviewConfig({ nodeType: "nano2", model: NANO_BANANA_21_MODEL, imageSize, bananaImageRoute: route, managedModelKey: "gemini-3.1-image", referenceImageCount: 14 });
      const actualModel = route === "stable" ? NANO_BANANA_21_OFFICIAL_MODEL : NANO_BANANA_21_MODEL;
      assert.equal(preview.model, actualModel);
      assert.equal(preview.requestParams.model, actualModel);
      assert.equal(preview.requestParams.managedModelKey, actualModel);
      assert.equal(preview.requestParams.providerOptions?.banana?.imageRoute, route === "stable" ? "stable" : "normal");
      assert.equal(preview.requestParams.imageSize, imageSize);
      assert.equal(getToapiImageFallbackCredits(actualModel, imageSize), (route === "stable" ? [30, 60, 90] : [20, 30, 40])[index]);
    }
  }
});

test("Nano2 model switches persist without replacing results or graph identity", () => {
  const oldModel = "gemini-3.1-flash-image-preview";
  const configs = expandNanoImageModelConfigs([{ nodeKey: "nano2", category: "image", status: "normal", sortOrder: 1, nameZh: "Nano2", nameEn: "Nano2", creditsPerCall: 40, metadata: { model: oldModel, resolutions: ["0.5K", "1K", "2K", "4K"], showGoogleSearch: true, supportedModels: [oldModel, NANO_BANANA_21_MODEL], managedRoutesByModel: { [NANO_BANANA_21_MODEL]: { modelKey: NANO_BANANA_21_MODEL, vendors: [{ vendorKey: "new_api", creditsPerCall: 30 }] } } } }]);
  assert.equal(configs[0].metadata?.managedModelKey, "gemini-3.1-image");
  const oldPatch = buildGptImageModelSwitchPatch({ model: oldModel, nodeConfigKey: "nano2", nodeConfigNameZh: configs[0].nameZh, nodeConfigNameEn: configs[0].nameEn, nodeConfigMetadata: configs[0].metadata, creditsPerCall: 40, enabled: true })!;
  assert.equal(oldPatch.managedModelKey, "gemini-3.1-image");
  const oldPreview = buildImageNodeCreditsPreviewConfig({ nodeType: "nano2", model: oldModel, aiProvider: "nano2", managedModelKey: String(oldPatch.managedModelKey), bananaImageRoute: "stable" });
  assert.equal(oldPreview.requestParams.managedModelKey, "gemini-3.1-image");
  assert.equal(oldPreview.requestParams.providerOptions?.banana?.imageRoute, "stable");
  assert.equal(configs[0].metadata?.showGoogleSearch, true);
  assert.deepEqual(configs[0].metadata?.resolutions, ["0.5K", "1K", "2K", "4K"]);
  const initial = { id: "existing-node", model: oldModel, imageUrl: "https://example.com/result.png", selected: true, resolution: "0.5K", presetPrompt: "keep me" };
  const config = configs[1];
  const patch = buildGptImageModelSwitchPatch({ model: NANO_BANANA_21_MODEL, nodeConfigKey: "nano2", nodeConfigNameZh: config.nameZh, nodeConfigNameEn: config.nameEn, nodeConfigMetadata: config.metadata, creditsPerCall: 30, enabled: true });
  const restored = JSON.parse(JSON.stringify({ ...initial, ...patch }));
  assert.equal(restored.model, NANO_BANANA_21_MODEL);
  assert.equal(restored.resolution, "1K");
  assert.equal(restored.maxReferenceImages, 14);
  assert.equal(restored.id, initial.id);
  assert.equal(restored.imageUrl, initial.imageUrl);
  assert.equal(restored.selected, true);
  assert.equal(restored.presetPrompt, initial.presetPrompt);
});

test("new model aspect ratios normalize old unsupported values identically for quote and execution", () => {
  for (const model of [...GPT_IMAGE_25_VIP_MODELS, NANO_BANANA_21_MODEL]) {
    const settings = getToapiImageSettings(model, "0.5K", "auto", "2:1");
    const preview = buildImageNodeCreditsPreviewConfig({ nodeType: model === NANO_BANANA_21_MODEL ? "nano2" : "gptImage2", model, imageSize: "0.5K", gptImage2Quality: "auto", aspectRatio: "2:1" });
    assert.equal(settings.imageSize, "1K");
    assert.equal(settings.aspectRatio, "1:1");
    assert.equal(preview.requestParams.imageSize, settings.imageSize);
    assert.equal(preview.requestParams.aspectRatio, settings.aspectRatio);
  }
});


test("missing historical Nano2 model stays old while explicit 2.1 follows global route", () => {
  const oldModel = "gemini-3.1-flash-image-preview";
  for (const route of ["normal", "stable", "ultra"]) {
    assert.equal(resolveNanoImageModelForRoute(undefined, route), oldModel);
    assert.equal(resolveNanoImageModelForRoute("", route), oldModel);
    assert.equal(resolveNanoImageModelForRoute(oldModel, route), oldModel);
    const actual = resolveNanoImageModelForRoute(NANO_BANANA_21_MODEL, route);
    assert.equal(actual, route === "stable" ? NANO_BANANA_21_OFFICIAL_MODEL : NANO_BANANA_21_MODEL);
    assert.equal(getToapiImageSettings(actual, "2K").providerOptions.banana.imageRoute, getToapiImageRoute(actual));
  }
  assert.equal(resolveExistingNanoImageModel(undefined), oldModel);
});
