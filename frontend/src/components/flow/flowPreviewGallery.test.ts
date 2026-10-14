import assert from 'node:assert/strict';
import test from 'node:test';
import type { Node } from '@xyflow/react';
import { buildFlowPreviewGallery, primaryImage } from './flowPreviewGallery.ts';

const node = (id: string, x = 0, y = 0, data: Record<string, unknown> = {}, type = 'image'): Node => ({ id, type, position: { x, y }, measured: { height: 200 }, data: { imageUrl: `https://assets.test/${id}.png`, label: id, ...data } });

test('canvas gallery follows row clustering rather than history timestamps or insertion order', () => {
  const nodes = [node('last', 0, 201), node('right', 300, 0, { timestamp: 999 }), node('left', 0, 50), node('middle', 150, 60), node('empty', 0, 0, { imageUrl: '' }), node('text', 0, 0, {}, 'textNote'), node('video', 0, 0, {}, 'video')];
  assert.deepEqual(buildFlowPreviewGallery(nodes, 'right').map((item) => item.id), ['left', 'middle', 'right', 'last']);
  assert.equal(buildFlowPreviewGallery(nodes, 'right')[0].title, 'left');
  assert.ok(buildFlowPreviewGallery(nodes, 'right').every((item) => item.timestamp === undefined));
});

test('real Tanva childNodeIds groups exclude other groups and ungrouped images', () => {
  const nodes = [node('a'), node('b', 200), node('other'), node('top'), node('group', 0, 0, { childNodeIds: ['a', 'b'] }, 'nodeGroup'), node('other-group', 0, 0, { childNodeIds: ['other'] }, 'nodeGroup')];
  assert.deepEqual(buildFlowPreviewGallery(nodes, 'a').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(buildFlowPreviewGallery(nodes, 'top').map((item) => item.id), ['top']);
});

test('parentId and legacy parentNode use the same scope without leaking neighboring groups', () => {
  const nodes = [{ ...node('a'), parentId: 'group' }, { ...node('b', 200), parentNode: 'group' }, { ...node('other'), parentId: 'different-group' }, node('top'), node('group', 1000, 1000, {}, 'nodeGroup')];
  assert.deepEqual(buildFlowPreviewGallery(nodes, 'a').map((item) => item.id), ['a', 'b']);
  assert.deepEqual(buildFlowPreviewGallery(nodes, 'missing'), []);
});

test('same URL on two real nodes stays as two candidates and snapshot never mutates design data', () => {
  const nodes = [node('a'), node('b', 200, 0, { imageUrl: 'https://assets.test/a.png' })];
  const before = JSON.stringify(nodes);
  const gallery = buildFlowPreviewGallery(nodes, 'a');
  assert.equal(gallery.length, 2);
  gallery[0].src = 'blob:preview-only';
  assert.equal(JSON.stringify(nodes), before);
  const otherProject = [node('other-project')];
  assert.deepEqual(buildFlowPreviewGallery(otherProject, 'a'), []);
  assert.equal(buildFlowPreviewGallery(nodes, 'a')[0].src, 'https://assets.test/a.png');
});

test('linked image displays selected multi-image output and selected extracted frame', () => {
  const nodes = [node('multi', 0, 0, { imageUrl: undefined, imageUrls: ['https://assets.test/1.png', 'https://assets.test/2.png', 'https://assets.test/3.png'] }, 'generate4'), node('linked', 300, 0, { imageUrl: 'https://assets.test/stale.png' }), node('frame', 0, 0, { imageUrl: undefined, selectedFrameIndex: 2, frames: [{ imageUrl: 'https://assets.test/frame1.png' }, { imageUrl: 'https://assets.test/frame2.png' }] }, 'videoFrameExtract'), node('linked-frame', 600)];
  const gallery = buildFlowPreviewGallery(nodes, 'linked', [{ source: 'multi', target: 'linked', sourceHandle: 'img3', targetHandle: 'img' }, { source: 'frame', target: 'linked-frame', sourceHandle: 'image', targetHandle: 'img' }]);
  assert.equal(gallery.find((item) => item.id === 'multi')?.src, 'https://assets.test/1.png');
  assert.equal(gallery.find((item) => item.id === 'linked')?.src, 'https://assets.test/3.png');
  assert.equal(gallery.find((item) => item.id === 'linked-frame')?.src, 'https://assets.test/frame2.png');
});

test('split crop and image crop survive connected chains as runtime preview metadata', () => {
  const rect = { x: 50, y: 0, width: 50, height: 100 };
  const nodes = [node('split', 0, 0, { imageUrl: undefined, inputImageUrl: 'https://assets.test/base.png', sourceWidth: 100, sourceHeight: 100, splitRects: [{ ...rect, x: 0 }, rect] }, 'imageSplit'), node('linked', 300, 0, { imageUrl: undefined }), node('chain', 600, 0, { imageUrl: undefined }), node('direct', 900, 0, { crop: rect })];
  const gallery = buildFlowPreviewGallery(nodes, 'linked', [{ source: 'split', target: 'linked', sourceHandle: 'image2', targetHandle: 'img' }, { source: 'linked', target: 'chain', sourceHandle: 'img', targetHandle: 'img' }]);
  for (const id of ['linked', 'chain']) {
    assert.equal(gallery.find((item) => item.id === id)?.src, 'https://assets.test/base.png');
    assert.deepEqual(gallery.find((item) => item.id === id)?.crop, { ...rect, sourceWidth: 100, sourceHeight: 100 });
  }
  assert.deepEqual(gallery.find((item) => item.id === 'direct')?.crop, { ...rect, sourceWidth: undefined, sourceHeight: undefined });
});

test('cyclic linked image inputs remain bounded and fall back to their real stored resource', () => {
  const nodes = [node('a'), node('b', 200)];
  const gallery = buildFlowPreviewGallery(nodes, 'a', [{ source: 'a', target: 'b', targetHandle: 'img' }, { source: 'b', target: 'a', targetHandle: 'img' }]);
  assert.equal(gallery.length, 2);
  assert.ok(gallery.every((item) => item.src.startsWith('https://assets.test/')));
});


test('ImagePro reads its own full asset without inheriting input or stored crop metadata', () => {
  const crop = { x: 50, y: 0, width: 50, height: 100 };
  const nodes = [node('upstream', 0, 0, { crop }), node('pro', 300, 0, { imageUrl: 'https://assets.test/pro.png', imageData: 'https://assets.test/backup.png', outputImage: 'https://assets.test/unrendered.png', crop }, 'imagePro'), node('empty-pro', 600, 0, { imageUrl: undefined, imageData: undefined, crop }, 'imagePro')];
  const edges = [{ source: 'upstream', target: 'pro', targetHandle: 'img' }, { source: 'upstream', target: 'empty-pro', targetHandle: 'img' }];
  const byId = new Map(nodes.map((item) => [item.id, item]));
  assert.deepEqual(primaryImage(nodes[1], byId, edges), { src: 'https://assets.test/pro.png' });
  assert.equal(primaryImage(nodes[2], byId, edges), null);
  nodes[1].data.imageUrl = undefined;
  assert.deepEqual(primaryImage(nodes[1], byId, edges), { src: 'https://assets.test/backup.png' });
});

test('historical split output keys match requested ports and keep runtime crop priority', () => {
  const split = node('split', 0, 0, { imageUrl: undefined, image2: 'https://assets.test/primary-slice.png', img2: 'https://assets.test/compat-slice.png', splitImages: [{}, { imageData: 'https://assets.test/legacy-slice.png' }] }, 'imageSplit');
  const byId = new Map([[split.id, split]]);
  const before = JSON.stringify(split);
  assert.deepEqual(primaryImage(split, byId, [], new Set(), 'img2'), { src: 'https://assets.test/primary-slice.png' });
  assert.equal(JSON.stringify(split), before);
  split.data.image2 = undefined;
  assert.deepEqual(primaryImage(split, byId, [], new Set(), 'image2'), { src: 'https://assets.test/compat-slice.png' });
  split.data.img2 = undefined;
  assert.equal(primaryImage(split, byId, [], new Set(), 'image2')?.src, 'https://assets.test/legacy-slice.png');
  assert.equal(primaryImage(split, byId, [], new Set(), 'image3'), null);
  const crop = { x: 50, y: 0, width: 50, height: 100 };
  split.data.inputImageUrl = 'https://assets.test/base.png';
  split.data.splitRects = [{ ...crop, x: 0 }, crop];
  split.data.image2 = 'https://assets.test/primary-slice.png';
  assert.equal(primaryImage(split, byId, [], new Set(), 'image2')?.src, 'https://assets.test/base.png');
  assert.equal(primaryImage(split, byId, [], new Set(), 'image2')?.crop?.x, 50);
});
