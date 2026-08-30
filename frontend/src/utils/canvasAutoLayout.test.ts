import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";
import {
  computeTidyByCategoryLayout,
  resolveNodeLayoutSize,
} from "./canvasAutoLayout.ts";

const imageNode = (
  id: string,
  x: number,
  data: Record<string, unknown> = {}
): Node => ({
  id,
  type: "gptImage2",
  position: { x, y: 0 },
  data,
  width: 260,
  height: 180,
});

test("persisted box size wins over stale React Flow measurements", () => {
  const node = imageNode("large", 0, { boxW: 600, boxH: 420 });
  assert.deepEqual(resolveNodeLayoutSize(node, { w: 220, h: 160 }), {
    w: 600,
    h: 420,
  });
});

test("image grid leaves enough horizontal room for resized nodes", () => {
  const nodes = [imageNode("large", 0, { boxW: 600 }), imageNode("next", 10)];
  const positions = computeTidyByCategoryLayout(nodes, {
    getSize: (node) => resolveNodeLayoutSize(node, { w: 220, h: 160 }),
  });

  assert.equal(positions.get("next")?.x, 624);
});

test("next image row uses the tallest persisted height", () => {
  const nodes = [
    imageNode("large", 0, { boxH: 700 }),
    imageNode("second", 10),
    imageNode("third", 20),
    imageNode("fourth", 30),
  ];
  const positions = computeTidyByCategoryLayout(nodes, {
    getSize: (node) => resolveNodeLayoutSize(node, { w: 220, h: 160 }),
  });

  assert.equal(positions.get("fourth")?.y, 740);
});

test("selection layout moves only targeted nodes", () => {
  const nodes = [
    imageNode("unselected", -500),
    imageNode("selected-a", 100),
    imageNode("selected-b", 900),
  ];
  const positions = computeTidyByCategoryLayout(nodes, {
    getSize: (node) => resolveNodeLayoutSize(node, { w: 220, h: 160 }),
    targetIds: new Set(["selected-a", "selected-b"]),
  });

  assert.equal(positions.has("unselected"), false);
  assert.deepEqual(positions.get("selected-a"), { x: 100, y: 0 });
  assert.deepEqual(positions.get("selected-b"), { x: 384, y: 0 });
});

test("selection layout keeps groups atomic", () => {
  const child = imageNode("child", 530);
  child.position.y = 40;
  const group: Node = {
    id: "group",
    type: "nodeGroup",
    position: { x: 500, y: 20 },
    data: { childNodeIds: ["child"] },
    width: 400,
    height: 300,
  };
  const sibling = imageNode("sibling", 0);

  const memberOnly = computeTidyByCategoryLayout([group, child, sibling], {
    getSize: (node) => resolveNodeLayoutSize(node, { w: 220, h: 160 }),
    targetIds: new Set(["child"]),
  });
  assert.equal(memberOnly.size, 0);

  const selectedGroup = computeTidyByCategoryLayout([group, child, sibling], {
    getSize: (node) => resolveNodeLayoutSize(node, { w: 220, h: 160 }),
    targetIds: new Set(["group", "sibling"]),
  });
  assert.deepEqual(selectedGroup.get("sibling"), { x: 0, y: 0 });
  assert.deepEqual(selectedGroup.get("group"), { x: 284, y: 0 });
  assert.deepEqual(selectedGroup.get("child"), { x: 314, y: 20 });
});
