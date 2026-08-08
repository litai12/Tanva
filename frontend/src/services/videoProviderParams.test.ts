import assert from "node:assert/strict";
import test from "node:test";

import {
  buildViduRequestSemantics,
  resolveViduVideoMode,
} from "./videoProviderParams.ts";

test("Vidu one-image prompt remains first-frame generation", () => {
  assert.equal(
    resolveViduVideoMode({
      hasImage2Input: false,
      imageCount: 1,
    }),
    "img2video",
  );
});

test("Vidu explicit reference mode is authoritative", () => {
  assert.equal(
    resolveViduVideoMode({
      hasImage2Input: false,
      imageCount: 1,
      explicitVideoMode: "reference",
    }),
    "reference2video",
  );
});

test("Vidu Q3 selects q3-pro for generation and q3 for references", () => {
  const generated = buildViduRequestSemantics({
    rawViduModel: "q3",
    hasImage2Input: false,
    imageCount: 1,
    hasPrompt: true,
  });
  assert.equal(generated.videoMode, "img2video");
  assert.equal(generated.viduModelVariant, "q3-pro");

  const referenced = buildViduRequestSemantics({
    rawViduModel: "q3",
    hasImage2Input: false,
    imageCount: 3,
    hasPrompt: true,
    explicitVideoMode: "reference",
  });
  assert.equal(referenced.videoMode, "reference2video");
  assert.equal(referenced.viduModelVariant, "q3");
});

test("Vidu q3-mix remains reference-only", () => {
  const semantics = buildViduRequestSemantics({
    rawViduModel: "q3-mix",
    hasImage2Input: false,
    imageCount: 1,
    hasPrompt: true,
    explicitVideoMode: "text",
  });
  assert.equal(semantics.videoMode, "reference2video");
  assert.equal(semantics.viduModelVariant, "q3-mix");
});
