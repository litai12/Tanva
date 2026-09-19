import type { Node } from '@xyflow/react';

export type SelectionAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
type Position = { x: number; y: number };

/** Align selected units; selected groups translate their members as one unit. */
export function computeSelectionAlignment(
  nodes: Node[],
  alignment: SelectionAlignment,
  getSize: (node: Node) => { width: number; height: number },
  lockedIds: ReadonlySet<string> = new Set(),
): Map<string, Position> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const parentId = (node: Node) => node.parentId || (node as Node & { parentNode?: string }).parentNode;
  const children = (node: Node): Node[] => {
    const ids = Array.isArray(node.data?.childNodeIds) ? node.data.childNodeIds : [];
    return nodes.filter(child => ids.includes(child.id) || parentId(child) === node.id);
  };
  const descendants = (node: Node, seen = new Set<string>()): Node[] => {
    seen.add(node.id);
    return children(node).flatMap(child => {
      if (seen.has(child.id)) return [];
      return [child, ...descendants(child, seen)];
    });
  };
  const selected = nodes.filter(node => node.selected && !node.hidden);
  const covered = new Set(selected.flatMap(node => descendants(node).map(child => child.id)));
  const units = selected.filter(node => !covered.has(node.id));
  const positions = new Map<string, Position>();
  if (units.length < 2) return positions;
  const absolute = (node: Node, seen = new Set<string>()): Position => {
    const pid = parentId(node);
    const parent = pid ? byId.get(pid) : undefined;
    if (!parent || seen.has(node.id)) return node.position;
    seen.add(node.id);
    const p = absolute(parent, seen);
    return { x: p.x + node.position.x, y: p.y + node.position.y };
  };
  const bounds = units.map(node => {
    const fallback = getSize(node);
    return {
      node, ...absolute(node),
      width: node.measured?.width || node.width || fallback.width,
      height: node.measured?.height || node.height || fallback.height,
    };
  });
  const left = Math.min(...bounds.map(b => b.x));
  const right = Math.max(...bounds.map(b => b.x + b.width));
  const top = Math.min(...bounds.map(b => b.y));
  const bottom = Math.max(...bounds.map(b => b.y + b.height));
  const vertical = ['left', 'center', 'right'].includes(alignment);
  const gap = 40;
  const isLocked = (node: Node) => [node, ...descendants(node)].some(n => lockedIds.has(n.id));
  // Keep visual order, opening only the gaps needed to prevent overlap.
  bounds.sort((a, b) => (vertical ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y)
    || a.node.id.localeCompare(b.node.id));
  const placed = bounds.filter(b => isLocked(b.node));
  for (const b of bounds) {
    const members = descendants(b.node);
    if (isLocked(b.node)) continue;
    let x = alignment === 'left' ? left : alignment === 'right' ? right - b.width
      : alignment === 'center' ? (left + right - b.width) / 2 : b.x;
    let y = alignment === 'top' ? top : alignment === 'bottom' ? bottom - b.height
      : alignment === 'middle' ? (top + bottom - b.height) / 2 : b.y;
    // Locked units are obstacles as well; never move them to make room.
    let collision;
    do {
      collision = placed.find(p => x < p.x + p.width + gap && x + b.width + gap > p.x
        && y < p.y + p.height + gap && y + b.height + gap > p.y);
      if (collision) {
        if (vertical) y = collision.y + collision.height + gap;
        else x = collision.x + collision.width + gap;
      }
    } while (collision);
    placed.push({ ...b, x, y });
    const dx = x - b.x;
    const dy = y - b.y;
    if (!dx && !dy) continue;
    const movingIds = new Set([b.node, ...members].map(node => node.id));
    for (const node of [b.node, ...members]) {
      // Parent-relative children follow their parent automatically.
      if (node !== b.node && movingIds.has(parentId(node) || '')) continue;
      positions.set(node.id, { x: node.position.x + dx, y: node.position.y + dy });
    }
  }
  return positions;
}
