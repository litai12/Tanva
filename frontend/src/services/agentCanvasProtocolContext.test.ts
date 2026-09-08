import assert from "node:assert/strict";
import test from "node:test";
import { buildXiaotCanvasRequestContext, queryXiaotCanvasContext, TANVA_CAPABILITY_MANIFEST, VIDEO_NODE_TYPES, EXECUTABLE_MEDIA_NODE_TYPES } from "./agentCanvasProtocol.ts";

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

test("a later scoped query reads an unselected node omitted from the initial request", () => {
  const snapshot = { nodes: [
    { id: "note", type: "textNote", data: { text: "LOCAL_CANVAS_0908", preview: "data:image/png;base64,private" } },
    { id: "other", type: "image", data: { text: "unrelated-secret" } },
  ], edges: [] };
  assert.deepEqual(buildXiaotCanvasRequestContext(snapshot, "读取文本节点").nodes, []);
  const result = queryXiaotCanvasContext(snapshot, { scope: "ids", nodeIds: ["note"] });
  assert.equal(result.returnedNodeCount, 1);
  assert.match(JSON.stringify(result), /LOCAL_CANVAS_0908/);
  assert.doesNotMatch(JSON.stringify(result), /unrelated-secret|data:image/);
  assert.equal(queryXiaotCanvasContext(snapshot, { scope: "search", query: "textNote" }).returnedNodeCount, 1);
});

test("scoped canvas queries are bounded and reject unsupported scopes", () => {
  const snapshot = { nodes: Array.from({ length: 30 }, (_, i) => ({ id: `note-${i}`, type: "textNote", data: { text: "text" } })), edges: [] };
  const result = queryXiaotCanvasContext(snapshot, { scope: "search", query: "text" });
  assert.equal(result.returnedNodeCount, 12);
  assert.equal(result.truncated, true);
  assert.ok(queryXiaotCanvasContext(snapshot, { scope: "all" }).error);
});

test("explicit queries use full node text beyond the sidebar preview", () => {
  const text = '正文'.repeat(100) + '_TAIL';
  const result = queryXiaotCanvasContext({ nodes: [{ id: 'long-note', type: 'textNote', data: { text } }], edges: [] }, { scope: 'ids', nodeIds: ['long-note'] });
  assert.equal(((result.nodes as Array<{data:{text:string}}>)[0].data.text), text);
});

test("Wan3 is advertised and participates in actual media execution verification", () => {
  assert.ok(TANVA_CAPABILITY_MANIFEST.nodeSpecs.some((node) => node.type === 'wan30Video'));
  assert.ok(VIDEO_NODE_TYPES.has('wan30Video'));
  assert.ok(EXECUTABLE_MEDIA_NODE_TYPES.has('wan30Video'));
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
