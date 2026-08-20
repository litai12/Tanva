import assert from "node:assert/strict";
import test from "node:test";
import { buildXiaotCanvasRequestContext } from "./agentCanvasProtocol.ts";

test("xiaot canvas request never sends the whole snapshot", () => {
  const nodes = Array.from({ length: 20 }, (_, index) => ({
    id: `node-${index}`,
    type: index === 0 ? "textPrompt" : "image",
    selected: index === 1,
    data: {
      text: index === 0 ? "一个苹果" : `hidden-${index}`,
      preview: index === 2 ? `data:image/png;base64,${"a".repeat(2000)}` : undefined,
    },
  }));
  const result = buildXiaotCanvasRequestContext({ nodes, edges: [] }, "提示词是什么");
  const sentNodes = result.nodes as Array<Record<string, unknown>>;
  assert.equal((result.summary as Record<string, unknown>).nodeCount, 20);
  assert.deepEqual(sentNodes.map((node) => node.id), ["node-1", "node-0"]);
  assert.doesNotMatch(JSON.stringify(result), /hidden-19/);
  assert.doesNotMatch(JSON.stringify(result), /data:image/);
});

test("a greeting sends only the summary when nothing is selected", () => {
  const result = buildXiaotCanvasRequestContext(
    { nodes: [{ id: "secret", type: "textNote", data: { text: "private" } }], edges: [] },
    "你好",
  );
  assert.deepEqual(result.nodes, []);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("a presentation request includes the relevant htmlPpt node", () => {
  const result = buildXiaotCanvasRequestContext(
    {
      nodes: [
        { id: "deck-1", type: "htmlPpt", title: "建筑设计汇报", slideCount: 12 },
        { id: "private-note", type: "textNote", text: "not relevant" },
      ],
      edges: [],
    },
    "继续修改这套 PPT"
  );

  assert.deepEqual(
    (result.nodes as Array<Record<string, unknown>>).map((node) => node.id),
    ["deck-1"]
  );
  assert.doesNotMatch(JSON.stringify(result), /not relevant/);
});
