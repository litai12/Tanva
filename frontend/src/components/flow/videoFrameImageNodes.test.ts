import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoFrameImageNodes } from './videoFrameImageNodes.ts';

const frames = Array.from({ length: 6 }, (_, offset) => ({
  index: offset + 3,
  timestamp: offset * 3,
  imageUrl: `https://assets.example.com/frame-${offset + 3}.jpg`,
  thumbnailDataUrl: `https://assets.example.com/thumb-${offset + 3}.jpg`,
}));
const options = {
  idPrefix: 'batch-unique',
  sourceNodeId: 'extract',
  sourceBounds: { x: 200, y: 100, width: 300, height: 500 },
  occupiedBounds: [{ x: 200, y: 100, width: 300, height: 500 }],
  size: { w: 260, h: 240 },
  frameLabel: (frame: { index: number }) => `帧 ${frame.index}`,
};

test('expands every selected frame as an independent full-resolution image snapshot', () => {
  const nodes = createVideoFrameImageNodes(frames, options);
  assert.equal(nodes.length, frames.length);
  assert.equal(new Set(nodes.map((node) => node.id)).size, frames.length);
  nodes.forEach((node, index) => {
    assert.equal(node.type, 'image');
    assert.equal(node.data.imageUrl, frames[index].imageUrl);
    assert.equal(node.data.label, `帧 ${frames[index].index}`);
    assert.equal(node.data.frameIndex, frames[index].index);
    assert.equal(node.data.frameTimestamp, frames[index].timestamp);
    assert.equal(node.parentId, undefined);
    assert.equal(node.data.imageData, undefined);
    assert.equal(node.data.thumbnail, undefined);
    assert.equal(node.selected, true);
  });
  assert.equal(nodes[4].position.x, nodes[0].position.x);
  assert.ok(nodes[4].position.y >= nodes[0].position.y + options.size.h + 60);
  assert.doesNotMatch(JSON.stringify(nodes), /data:image|blob:|thumb-/);
  assert.deepEqual(frames.map((frame) => frame.index), [3, 4, 5, 6, 7, 8]);
});

test('avoids existing nodes and earlier batches while preserving source world coordinates', () => {
  const occupiedBounds = [
    ...options.occupiedBounds,
    { x: 560, y: 100, width: 260, height: 240 },
    { x: 900, y: 400, width: 260, height: 500 },
  ];
  const nodes = createVideoFrameImageNodes(frames, { ...options, occupiedBounds });
  assert.equal(nodes[0].position.x, 560);
  assert.ok(nodes[0].position.y >= 960);
  for (const node of nodes) {
    for (const bounds of occupiedBounds) {
      const { x, y } = node.position;
      assert.ok(x >= bounds.x + bounds.width || x + 260 <= bounds.x ||
        y >= bounds.y + bounds.height || y + 240 <= bounds.y);
    }
  }
  const nextBatch = createVideoFrameImageNodes(frames, {
    ...options,
    idPrefix: 'another-batch',
    occupiedBounds: occupiedBounds.concat(nodes.map((node) => ({
      ...node.position, width: 260, height: 240,
    }))),
  });
  assert.ok(nextBatch[0].position.y > nodes.at(-1)!.position.y);
  assert.equal(new Set([...nodes, ...nextBatch].map((node) => node.id)).size, 12);
});

test('empty extraction creates no image nodes', () => {
  assert.deepEqual(createVideoFrameImageNodes([], options), []);
});
