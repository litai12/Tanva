import assert from "node:assert/strict";
import {
  normalizeKlingOmniPrompt,
  translateKlingOmniPromptAliases,
} from "./kling-omni-prompt";

const run = (): void => {
  assert.equal(
    normalizeKlingOmniPrompt({
      prompt: "让@图1中的耳机转向@图2中的镜头",
      imageCount: 2,
    }),
    "让<<<image_1>>>中的耳机转向<<<image_2>>>中的镜头",
  );

  assert.equal(
    normalizeKlingOmniPrompt({
      prompt: "镜头缓慢环绕产品",
      imageCount: 2,
      videoCount: 1,
    }),
    "<<<image_1>>> <<<image_2>>> <<<video_1>>>\n镜头缓慢环绕产品",
  );

  assert.equal(
    normalizeKlingOmniPrompt({
      prompt: "<<<image_1>>>中的角色走进<<<image_2>>>的场景",
      imageCount: 2,
    }),
    "<<<image_1>>>中的角色走进<<<image_2>>>的场景",
  );

  assert.equal(
    translateKlingOmniPromptAliases("@图1入画，@图10保持不变", 2),
    "<<<image_1>>>入画，@图10保持不变",
  );

  assert.equal(
    normalizeKlingOmniPrompt({
      prompt: "@role1 @图1仙侠分镜画面脚本",
      imageCount: 1,
      namedImageAliases: [{ name: "role1", imageIndex: 1 }],
    }),
    "<<<image_1>>>仙侠分镜画面脚本",
  );

  assert.equal(
    normalizeKlingOmniPrompt({
      prompt: "@role10跟随@role1",
      imageCount: 1,
      namedImageAliases: [{ name: "role1", imageIndex: 1 }],
    }),
    "@role10跟随<<<image_1>>>",
  );
};

run();
console.log("kling-omni-prompt.spec: ok");
