import assert from 'node:assert/strict';
import test from 'node:test';
import { useDesktopMediaPreviewStore } from './mediaPreviewState';

test('desktop media preview opens in place and switches within its collection', () => {
  useDesktopMediaPreviewStore.getState().open({
    id: 'preview-1',
    title: '猫咪图片',
    items: [
      { id: 'cat-1', url: 'https://example.com/cat-1.png' },
      { id: 'cat-2', url: 'https://example.com/cat-2.png' },
    ],
    currentItemId: 'cat-1',
    createdAt: '2026-08-21T00:00:00.000Z',
  });

  useDesktopMediaPreviewStore.getState().select('cat-2');
  assert.equal(useDesktopMediaPreviewStore.getState().preview?.currentItemId, 'cat-2');

  useDesktopMediaPreviewStore.getState().select('missing');
  assert.equal(useDesktopMediaPreviewStore.getState().preview?.currentItemId, 'cat-2');
});
