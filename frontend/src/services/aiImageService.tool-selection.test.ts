import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalSingleToolSelection } from "./toolSelectionRouting";

test("a single distinct available tool is selected locally", () => {
  const result = resolveLocalSingleToolSelection({
    userInput: "用这张场景设计一张新图",
    availableTools: ["editImage", "editImage"],
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      selectedTool: "editImage",
      parameters: { prompt: "用这张场景设计一张新图" },
      confidence: 1,
      reasoning: "Only one tool is available; selected locally",
    },
  });
});

test("multiple distinct tools require the backend Right selector", () => {
  assert.equal(
    resolveLocalSingleToolSelection({
      userInput: "判断编辑还是分析",
      availableTools: ["editImage", "analyzeImage"],
    }),
    null,
  );
});
