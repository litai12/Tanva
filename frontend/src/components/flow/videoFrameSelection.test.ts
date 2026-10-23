import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoFrameSelection, selectVideoFrames, type VideoFrame } from './videoFrameSelection.ts';

const frames: VideoFrame[] = Array.from({ length: 5 }, (_, position) => ({
  index: position + 1,
  timestamp: position * 3,
  imageUrl: `https://assets.example/frame-${position + 1}.jpg`,
}));
const indexes = (selection: VideoFrame[]) => selection.map((frame) => frame.index);

test('empty, absent, and default frame selections are safe', () => {
  assert.deepEqual(selectVideoFrames({}), []);
  assert.deepEqual(selectVideoFrames({ frames: [], outputMode: 'range', rangeStart: 40 }), []);
  assert.deepEqual(selectVideoFrames({ frames }), frames);
  assert.equal(selectVideoFrames({ frames, outputMode: 'all', rangeEnd: 2 }).length, 5);
});

test('single frame selection is 1-based and includes the last frame', () => {
  assert.equal(selectVideoFrames({ frames, outputMode: 'single' })[0], frames[0]);
  assert.equal(selectVideoFrames({ frames, outputMode: 'single', selectedFrameIndex: 5 })[0], frames[4]);
});

test('range selection includes both endpoints, including a single-frame range', () => {
  assert.deepEqual(indexes(selectVideoFrames({ frames, outputMode: 'range', rangeStart: 2, rangeEnd: 4 })), [2, 3, 4]);
  assert.deepEqual(indexes(selectVideoFrames({ frames, outputMode: 'range', rangeStart: 5, rangeEnd: 5 })), [5]);
  assert.deepEqual(indexes(selectVideoFrames({ frames, outputMode: 'range', rangeStart: 1 })), [1, 2, 3, 4, 5]);
});

test('stale settings clamp to available frame numbers and reversed ranges normalize', () => {
  assert.deepEqual(indexes(selectVideoFrames({ frames, outputMode: 'range', rangeStart: 3, rangeEnd: 900 })), [3, 4, 5]);
  assert.deepEqual(indexes(selectVideoFrames({ frames, outputMode: 'range', rangeStart: 4, rangeEnd: 2 })), [2, 3, 4]);
  assert.deepEqual(indexes(selectVideoFrames({ frames, outputMode: 'range', rangeStart: 100, rangeEnd: 900 })), [5]);
  assert.deepEqual(indexes(selectVideoFrames({ frames, outputMode: 'single', selectedFrameIndex: 900 })), [5]);
});

test('invalid values use full-range defaults instead of silently dropping valid frames', () => {
  for (const invalid of [NaN, Infinity, -Infinity, 0, -1, 2.5]) {
    assert.deepEqual(selectVideoFrames({ frames, outputMode: 'range', rangeStart: invalid, rangeEnd: invalid }), frames);
    assert.deepEqual(indexes(selectVideoFrames({ frames, outputMode: 'single', selectedFrameIndex: invalid })), [1]);
  }
});

test('sparse frames select by frame number rather than array position and preserve original order', () => {
  const sparse = [frames[4], frames[0], frames[2]];
  assert.deepEqual(indexes(selectVideoFrames({ frames: sparse, outputMode: 'range', rangeStart: 2, rangeEnd: 5 })), [5, 3]);
  assert.equal(selectVideoFrames({ frames: sparse, outputMode: 'single', selectedFrameIndex: 3 })[0], frames[2]);
  assert.deepEqual(indexes(selectVideoFrames({ frames: sparse, outputMode: 'single', selectedFrameIndex: 4 })), [3]);
  assert.equal(normalizeVideoFrameSelection({ frames: sparse, rangeEnd: 99 }).rangeEnd, 5);
});

test('all frames retain duplicates and do not impose an arbitrary export limit or mutate data', () => {
  const many = Array.from({ length: 257 }, (_, position) => ({ ...frames[0], index: position + 1 }));
  const before = structuredClone(many);
  assert.equal(selectVideoFrames({ frames: many, outputMode: 'all' }).length, 257);
  assert.deepEqual(many, before);
  const duplicates = [frames[0], frames[0]];
  assert.equal(selectVideoFrames({ frames: duplicates, outputMode: 'all' }).length, 2);
});
