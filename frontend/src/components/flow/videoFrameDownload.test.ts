import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { buildVideoFramesZip, saveVideoFramesZip, type VideoFrameDownloadProgress } from './videoFrameDownload.ts';
import type { VideoFrame } from './videoFrameSelection.ts';

const frame = (index: number): VideoFrame => ({
  index,
  timestamp: (index - 1) * 1.25,
  imageUrl: `https://assets.example/original-${index}.jpg`,
  thumbnailDataUrl: `https://assets.example/thumbnail-${index}.jpg`,
});

test('ZIP reads every original URL, preserves bytes and MIME extensions, and reports progress', async () => {
  const frames = [frame(1), frame(2), frame(3)];
  const requested: string[] = [];
  const progress: VideoFrameDownloadProgress[] = [];
  const payloads = [new Uint8Array([255, 216, 1, 2, 255]), new Uint8Array([137, 80, 78, 71, 42]), new Uint8Array([82, 73, 70, 70, 22])];
  const blob = await buildVideoFramesZip(frames, async (url) => {
    requested.push(url);
    const position = requested.length - 1;
    return new Blob([payloads[position]], { type: ['image/jpeg', 'image/png', 'image/webp'][position] });
  }, (value) => progress.push(value));
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const filenames = Object.keys(archive);
  assert.deepEqual(requested, frames.map((entry) => entry.imageUrl));
  assert.deepEqual(filenames, ['frame_0001_0ms.jpg', 'frame_0002_1250ms.png', 'frame_0003_2500ms.webp']);
  filenames.forEach((filename, index) => assert.deepEqual(archive[filename], payloads[index]));
  assert.equal(blob.type, 'application/zip');
  assert.deepEqual(progress, [{ completed: 0, total: 3 }, { completed: 1, total: 3 }, { completed: 2, total: 3 }, { completed: 3, total: 3 }]);
});

test('single-frame ZIP and duplicate metadata retain every entry', async () => {
  const resolver = async () => new Blob(['original'], { type: 'image/jpeg' });
  const single = await buildVideoFramesZip([frame(4)], resolver);
  assert.deepEqual(Object.keys(unzipSync(new Uint8Array(await single.arrayBuffer()))), ['frame_0004_3750ms.jpg']);
  const duplicate = await buildVideoFramesZip([frame(4), frame(4)], resolver);
  assert.equal(Object.keys(unzipSync(new Uint8Array(await duplicate.arrayBuffer()))).length, 2);
});

test('read errors, missing images, empty blobs and non-image responses reject the entire ZIP', async () => {
  for (const failure of [
    async () => null,
    async () => new Blob([]),
    async () => new Blob(['<html>error</html>'], { type: 'text/html' }),
    async () => { throw new Error('network unavailable'); },
  ]) {
    let calls = 0;
    const progress: VideoFrameDownloadProgress[] = [];
    await assert.rejects(buildVideoFramesZip([frame(1), frame(2), frame(3)], async () => {
      calls += 1;
      return calls === 2 ? failure() : new Blob(['original'], { type: 'image/jpeg' });
    }, (value) => progress.push(value)), /Frame 2 download failed/);
    assert.equal(calls, 2);
    assert.deepEqual(progress.at(-1), { completed: 1, total: 3 });
  }
  await assert.rejects(buildVideoFramesZip([], async () => null), /No frames to download/);
  await assert.rejects(buildVideoFramesZip([{ ...frame(1), imageUrl: '' }], async () => null), /Original image URL is missing/);
});

test('ZIP exports every frame without a preview-size or batch cap', async () => {
  const frames = Array.from({ length: 257 }, (_, index) => frame(index + 1));
  const blob = await buildVideoFramesZip(frames, async () => new Blob(['frame'], { type: 'image/jpeg' }));
  assert.equal(Object.keys(unzipSync(new Uint8Array(await blob.arrayBuffer()))).length, 257);
});

test('download releases its temporary URL and anchor after clicking or a click error', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  try {
    for (const failClick of [false, true]) {
      const events: string[] = [];
      let cleanup: (() => void) | undefined;
      const link = {
        href: '', download: '',
        click() { events.push('click'); if (failClick) throw new Error('click failed'); },
        remove() { events.push('remove'); },
      };
      globalThis.document = { createElement: () => link, body: { appendChild: () => events.push('append') } } as unknown as Document;
      globalThis.window = { setTimeout(callback: () => void) { cleanup = callback; return 1; } } as unknown as Window & typeof globalThis;
      URL.createObjectURL = () => 'blob:frames-download';
      URL.revokeObjectURL = (url) => { assert.equal(url, 'blob:frames-download'); events.push('revoke'); };
      if (failClick) assert.throws(() => saveVideoFramesZip(new Blob(['zip']), 'frames.zip'), /click failed/);
      else saveVideoFramesZip(new Blob(['zip']), 'frames.zip');
      assert.equal(link.download, 'frames.zip');
      assert.deepEqual(events, ['append', 'click', 'remove']);
      assert.ok(cleanup);
      cleanup();
      assert.deepEqual(events, ['append', 'click', 'remove', 'revoke']);
    }
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else globalThis.window = originalWindow;
  }
});
