import type { Edge, Node } from "reactflow";

// 「一键整理」触发事件：FloatingHeader 里的按钮 dispatch，FlowOverlay 里监听执行。
export const FLOW_AUTO_LAYOUT_EVENT = "flow:auto-layout";

type XY = { x: number; y: number };
type Size = { w: number; h: number };

// 节点尺寸读取器（由调用方注入，复用 FlowOverlay 的 getNodeRenderSize）。
export type NodeSizeGetter = (node: Node) => Size;

export interface AutoLayoutOptions {
  getSize: NodeSizeGetter;
  gapX?: number;
  gapY?: number;
}

// 按连线拓扑分层的自动布局（DAG 生成树 / 森林，从上到下逐层排布）。
// 算法自 TapCanvas computeTreeLayout 移植，去掉领域字段依赖，纯几何：
//   - 每个节点取「第一条入边」的源作为父（生成树，忽略多父/环）。
//   - 无入边的节点为根（游离节点即为独立根），根按原 x 从左到右排。
//   - 逐层求最大宽/高作为该层的行高与单元宽；子树宽度决定水平占位并居中。
//   - 以当前包围盒左上角 (minX, minY) 为锚点，整理后整体不远离原位。
// 只返回需要移动的节点目标坐标；不含尺寸变更。
export function computeAutoLayout(
  nodesInScope: Node[],
  edgesInScope: Edge[],
  options: AutoLayoutOptions
): Map<string, XY> {
  const gapX = options.gapX ?? 64;
  const gapY = options.gapY ?? 80;
  const getSize = options.getSize;
  const positions = new Map<string, XY>();
  if (!nodesInScope.length) return positions;

  const posX = (n: Node): number => Number(n.position?.x ?? 0) || 0;
  const posY = (n: Node): number => Number(n.position?.y ?? 0) || 0;

  const idSet = new Set(nodesInScope.map((n) => n.id));
  const nodeById = new Map(nodesInScope.map((n) => [n.id, n] as const));

  const incoming = new Map<string, string[]>();
  nodesInScope.forEach((n) => incoming.set(n.id, []));
  edgesInScope.forEach((e) => {
    if (!idSet.has(e.source) || !idSet.has(e.target)) return;
    if (e.source === e.target) return;
    incoming.get(e.target)!.push(e.source);
  });

  // 生成树：每个节点至多一个父（第一条入边胜出）。
  const parentOf = new Map<string, string>();
  nodesInScope.forEach((n) => {
    const ins = incoming.get(n.id) || [];
    if (ins.length) parentOf.set(n.id, ins[0]);
  });

  const childrenOf = new Map<string, string[]>();
  nodesInScope.forEach((n) => childrenOf.set(n.id, []));
  parentOf.forEach((p, child) => {
    if (!childrenOf.has(p)) return;
    childrenOf.get(p)!.push(child);
  });

  const roots = nodesInScope
    .filter((n) => !parentOf.has(n.id))
    .sort((a, b) => posX(a) - posX(b))
    .map((n) => n.id);
  if (!roots.length && nodesInScope.length) {
    roots.push(nodesInScope[nodesInScope.length - 1].id);
  }

  const depthOf = new Map<string, number>();
  const seen = new Set<string>();
  const queue = roots.map((r) => ({ id: r, depth: 0 }));
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    depthOf.set(cur.id, cur.depth);
    const kids = (childrenOf.get(cur.id) || [])
      .slice()
      .sort((a, b) => posX(nodeById.get(a)!) - posX(nodeById.get(b)!));
    kids.forEach((k) => queue.push({ id: k, depth: cur.depth + 1 }));
  }
  nodesInScope.forEach((n) => {
    if (!depthOf.has(n.id)) depthOf.set(n.id, 0);
  });

  // 基础尺寸 → 每层最大宽/高作为单元格尺寸。
  const baseSizes = new Map<string, Size>();
  nodesInScope.forEach((n) => baseSizes.set(n.id, getSize(n)));

  const maxDepth = Math.max(0, ...nodesInScope.map((n) => depthOf.get(n.id) || 0));
  const levelHeights: number[] = Array.from({ length: maxDepth + 1 }, () => 0);
  const levelWidths: number[] = Array.from({ length: maxDepth + 1 }, () => 0);
  nodesInScope.forEach((n) => {
    const d = depthOf.get(n.id) || 0;
    const sz = baseSizes.get(n.id)!;
    levelHeights[d] = Math.max(levelHeights[d], sz.h);
    levelWidths[d] = Math.max(levelWidths[d], sz.w);
  });

  const minX = Math.min(...nodesInScope.map(posX));
  const minY = Math.min(...nodesInScope.map(posY));
  const levelY: number[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    levelY[d] = d === 0 ? minY : levelY[d - 1] + levelHeights[d - 1] + gapY;
  }

  const cellSizes = new Map<string, Size>();
  nodesInScope.forEach((n) => {
    const d = depthOf.get(n.id) || 0;
    cellSizes.set(n.id, {
      w: levelWidths[d] || baseSizes.get(n.id)!.w,
      h: levelHeights[d] || baseSizes.get(n.id)!.h,
    });
  });

  const subtreeWidth = new Map<string, number>();
  const computeSubtreeWidth = (id: string): number => {
    if (subtreeWidth.has(id)) return subtreeWidth.get(id)!;
    if (!nodeById.has(id)) {
      subtreeWidth.set(id, 0);
      return 0;
    }
    const selfW = cellSizes.get(id)!.w;
    const kids = (childrenOf.get(id) || [])
      .slice()
      .sort((a, b) => posX(nodeById.get(a)!) - posX(nodeById.get(b)!));
    if (!kids.length) {
      subtreeWidth.set(id, selfW);
      return selfW;
    }
    const kidsTotal =
      kids.reduce((sum, k) => sum + computeSubtreeWidth(k), 0) +
      gapX * Math.max(0, kids.length - 1);
    const total = Math.max(selfW, kidsTotal);
    subtreeWidth.set(id, total);
    return total;
  };
  roots.forEach((r) => computeSubtreeWidth(r));

  const place = (id: string, leftX: number) => {
    if (!nodeById.has(id)) return;
    const sw = computeSubtreeWidth(id);
    const w = cellSizes.get(id)!.w;
    const x = leftX + (sw - w) / 2;
    const y = levelY[depthOf.get(id) || 0] ?? minY;
    positions.set(id, { x, y });

    const kids = (childrenOf.get(id) || [])
      .slice()
      .sort((a, b) => posX(nodeById.get(a)!) - posX(nodeById.get(b)!));
    const kidsWidth =
      kids.reduce((sum, k) => sum + computeSubtreeWidth(k), 0) +
      gapX * Math.max(0, kids.length - 1);
    let cursor = leftX + (sw - kidsWidth) / 2;
    kids.forEach((k) => {
      place(k, cursor);
      cursor += computeSubtreeWidth(k) + gapX;
    });
  };

  let forestCursor = minX;
  roots.forEach((r) => {
    place(r, forestCursor);
    forestCursor += computeSubtreeWidth(r) + gapX;
  });

  return positions;
}
