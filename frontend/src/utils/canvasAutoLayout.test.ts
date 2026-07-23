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
