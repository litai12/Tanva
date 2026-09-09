import type { Node } from "@xyflow/react";

export type FlowGroupBounds = { x: number; y: number; width: number; height: number };

const positive = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

/** Group envelopes follow rendered content, not persisted initial box dimensions. */
export function computeFlowGroupBounds(
  nodes: Node[],
  childIds: string[],
  options: {
    getFallbackSize: (node: Node) => { width: number; height: number };
    padding: number;
    minWidth: number;
    minHeight: number;
  }
): FlowGroupBounds | null {
  const children = new Set(childIds);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (!children.has(node.id) || node.type === "nodeGroup") continue;
    const { x, y } = node.position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const fallback = options.getFallbackSize(node);
    // React Flow v12 writes ResizeObserver results to measured; width/height
    // and boxW/boxH may still describe the initial or requested size.
    const width = positive(node.measured?.width) ?? positive(node.width) ?? fallback.width;
    const height = positive(node.measured?.height) ?? positive(node.height) ?? fallback.height;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  if (minX === Infinity) return null;
  return {
    x: minX - options.padding,
    y: minY - options.padding,
    width: Math.max(options.minWidth, maxX - minX + options.padding * 2),
    height: Math.max(options.minHeight, maxY - minY + options.padding * 2),
  };
}
