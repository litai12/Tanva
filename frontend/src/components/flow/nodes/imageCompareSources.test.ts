import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveImageCompareInputs } from './imageCompareSources.ts';
import type { GalleryNode, GalleryEdge } from '../flowPreviewGallery.ts';

const node = (id: string, type = 'image', data: Record<string, unknown> = {}, x = 0, y = 0): GalleryNode => ({ id, type, position: { x, y }, data });
const edge = (source: string, sourceHandle = 'img'): GalleryEdge => ({ source, target: 'compare', sourceHandle, targetHandle: 'images' });

test('compare orders all connected images visually and follows upstream changes without copying assets', () => {
  const nodes = [node('right', 'image', { imageUrl: 'https://assets.test/right.png' }, 300), node('left', 'image', { imageUrl: 'https://assets.test/left.png' }), node('waiting'), node('unconnected', 'image', { imageUrl: 'https://assets.test/private.png' })];
  const edges = [edge('right'), edge('waiting'), edge('left')];
  const before = JSON.stringify(nodes);
  assert.deepEqual(resolveImageCompareInputs(nodes, edges, 'compare').map((source) => source.nodeId), ['left', 'right']);
  assert.equal(JSON.stringify(nodes), before);
  nodes[0].data.imageUrl = 'https://assets.test/new.png';
  nodes[2].data.imageUrl = 'https://assets.test/ready.png';
  const sources = resolveImageCompareInputs(nodes, edges, 'compare');
  assert.equal(sources.find((source) => source.nodeId === 'right')?.src, 'https://assets.test/new.png');
  assert.equal(sources.length, 3);
  assert.equal(resolveImageCompareInputs(nodes, [edge('left')], 'compare').length, 1);
});

test('same generator connected through separate output handles preserves both selected images', () => {
  const nodes = [node('multi', 'generate4', { imageUrls: ['https://assets.test/1.png', 'https://assets.test/2.png', 'https://assets.test/3.png'] })];
  const sources = resolveImageCompareInputs(nodes, [edge('multi', 'img3'), edge('multi', 'img2')], 'compare');
  assert.deepEqual(sources.map((source) => source.src), ['https://assets.test/3.png', 'https://assets.test/2.png']);
  assert.notEqual(sources[0].inputId, sources[1].inputId);
});

test('split ports and connected image chains retain current crop metadata instead of exposing original image', () => {
  const crop = { x: 50, y: 0, width: 50, height: 100 };
  const nodes = [node('split', 'imageSplit', { inputImageUrl: 'https://assets.test/base.png', sourceWidth: 100, sourceHeight: 100, splitRects: [{ ...crop, x: 0 }, crop] }), node('linked', 'image', { imageUrl: 'https://assets.test/stale.png' })];
  const edges = [edge('split', 'image2'), edge('linked'), { source: 'split', target: 'linked', sourceHandle: 'image2', targetHandle: 'img' }];
  const before = JSON.stringify(nodes);
  const sources = resolveImageCompareInputs(nodes, edges, 'compare');
  assert.equal(sources.length, 2);
  for (const source of sources) {
    assert.equal(source.src, 'https://assets.test/base.png');
    assert.deepEqual(source.crop, { ...crop, sourceWidth: 100, sourceHeight: 100 });
  }
  assert.equal(JSON.stringify(nodes), before);
});

test('selected frame, parent position, missing sources and foreign input handles resolve safely', () => {
  const nodes = [node('frame', 'videoFrameExtract', { frames: [{ imageUrl: 'https://assets.test/1.png' }, { imageUrl: 'https://assets.test/2.png' }], selectedFrameIndex: 2 }), { ...node('child', 'image', { imageUrl: 'https://assets.test/child.png' }, 5), parentId: 'parent' }, node('parent', 'nodeGroup', {}, -100)];
  const edges = [edge('frame', 'image'), edge('child'), edge('missing'), { ...edge('frame', 'image'), targetHandle: 'text' }];
  const sources = resolveImageCompareInputs(nodes, edges, 'compare');
  assert.deepEqual(sources.map((source) => source.nodeId), ['child', 'frame']);
  assert.equal(sources[1].src, 'https://assets.test/2.png');
});
