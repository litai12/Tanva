import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import { computeSelectionAlignment } from './flowSelectionAlignment.ts';

const node = (id: string, x: number, y: number, extra: Partial<Node> = {}): Node => ({
  id, position: { x, y }, data: {}, selected: true, measured: { width: 100, height: 60 }, ...extra,
});
const size = () => ({ width: 999, height: 999 });
test('six alignments use measured bounds and preserve the other axis and unselected nodes', () => {
  const nodes = [node('a', -100, -50), node('b', 200, 150, { measured: { width: 200, height: 100 } }), node('outside', 900, 900, { selected: false })];
  const expected = {
    left: [{ x: -100, y: -50 }, { x: -100, y: 150 }],
    center: [{ x: 100, y: -50 }, { x: 50, y: 150 }],
    right: [{ x: 300, y: -50 }, { x: 200, y: 150 }],
    top: [{ x: -100, y: -50 }, { x: 200, y: -50 }],
    middle: [{ x: -100, y: 70 }, { x: 200, y: 50 }],
    bottom: [{ x: -100, y: 190 }, { x: 200, y: 150 }],
  };
  for (const alignment of Object.keys(expected) as (keyof typeof expected)[]) {
    const result = computeSelectionAlignment(nodes, alignment, size);
    assert.deepEqual(nodes.slice(0, 2).map(n => result.get(n.id) || n.position), expected[alignment]);
    assert.equal(result.has('outside'), false);
  }
});
test('selected groups move absolute children once and retain parent-relative children', () => {
  const nodes = [node('anchor', 0, 0), node('group', 300, 0, { type: 'nodeGroup', data: { childNodeIds: ['child', 'relative'] } }),
    node('child', 320, 50), node('relative', 20, 80, { parentId: 'group' })];
  const result = computeSelectionAlignment(nodes, 'left', size);
  assert.deepEqual(result.get('group'), { x: 0, y: 0 });
  assert.deepEqual(result.get('child'), { x: 20, y: 50 });
  assert.equal(result.has('relative'), false);
  assert.equal(computeSelectionAlignment(nodes, 'left', size, new Set(['child'])).size, 0);
});
test('individual children align in absolute space without moving an unselected parent', () => {
  const nodes = [node('group', 300, 100, { type: 'nodeGroup', selected: false }), node('child', 20, 50, { parentId: 'group' }), node('anchor', 0, 0)];
  const result = computeSelectionAlignment(nodes, 'left', size);
  assert.deepEqual(result.get('child'), { x: -300, y: 50 });
  assert.equal(result.has('group'), false);
  assert.equal(computeSelectionAlignment([nodes[1]], 'left', size).size, 0);
});
