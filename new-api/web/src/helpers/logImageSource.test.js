import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLogImageSource } from './logImageSource.js';

test('log previews preserve remote references and reject executable sources', () => {
  for (const url of ['https://example.com/image.png', '/logo.png'])
    assert.equal(resolveLogImageSource(url).url, url);
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'invalid',
    null,
  ])
    assert.equal(resolveLogImageSource(value).url, '');
});
test('legacy image data is displayed via a revocable Blob URL', async () => {
  const data = 'iVBORw0KGgo=';
  const jpeg = resolveLogImageSource('/9j/4AAQ');
  assert.ok(jpeg.url.startsWith('blob:'));
  jpeg.release();
  for (const input of [data, `data:image/png;base64,${data}`]) {
    const resolved = resolveLogImageSource(input);
    assert.ok(resolved.url.startsWith('blob:'));
    const response = await fetch(resolved.url);
    assert.equal(response.headers.get('content-type'), 'image/png');
    resolved.release();
    await assert.rejects(fetch(resolved.url));
  }
});
