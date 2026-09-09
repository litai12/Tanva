import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";
import { computeFlowGroupBounds } from "./flowGroupBounds.ts";

const options = {
  getFallbackSize: () => ({ width: 260, height: 200 }),
  padding: 24, minWidth: 220, minHeight: 160,
};
const image = (overrides: Partial<Node> = {}): Node => ({
  id: "image", type: "gptImage2", position: { x: 100, y: 600 },
  data: { boxW: 260, boxH: 200 }, width: 260, height: 200,
  measured: { width: 320, height: 580 }, ...overrides,
});

test("group contains the full generated image panel despite stale default dimensions", () => {
  const node = image();
  const before = structuredClone(node);
  assert.deepEqual(computeFlowGroupBounds([node], [node.id], options), {
    x: 76, y: 576, width: 368, height: 628,
  });
  assert.deepEqual(node, before, "computing bounds never moves or changes a child");
});

test("successive preview growth and shrinkage both update the envelope", () => {
  const heights = [200, 580, 720, 300];
  assert.deepEqual(heights.map((height) => computeFlowGroupBounds(
    [image({ measured: { width: 320, height } })], ["image"], options
  )?.height), heights.map((height) => height + 48));
});

test("only group members contribute, including members at negative positions", () => {
  const nodes = [image(), image({ id: "left", position: { x: -400, y: -200 } }),
    image({ id: "outside", position: { x: 10000, y: 10000 } })];
  assert.deepEqual(computeFlowGroupBounds(nodes, ["image", "left"], options), {
    x: -424, y: -224, width: 868, height: 1428,
  });
});

test("unmeasured or hidden nodes fall back to valid dimensions", () => {
  assert.equal(computeFlowGroupBounds([image({ measured: { width: 0, height: 0 }, hidden: true })], ["image"], options)?.height, 248);
  assert.equal(computeFlowGroupBounds([image({ measured: undefined, width: undefined, height: undefined })], ["image"], options)?.height, 248);
  assert.equal(computeFlowGroupBounds([], ["missing"], options), null);
});
