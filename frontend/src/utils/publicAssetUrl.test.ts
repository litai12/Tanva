import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePublicAssetUrl } from './publicAssetUrl.ts';

describe('resolvePublicAssetUrl', () => {
  it('uses relative public files for a packaged Electron renderer', () => {
    assert.equal(resolvePublicAssetUrl('/Logo.svg', './'), './Logo.svg');
    assert.equal(resolvePublicAssetUrl('/models/duck.glb', './'), './models/duck.glb');
  });

  it('preserves the website root and external/runtime URLs', () => {
    assert.equal(resolvePublicAssetUrl('Logo.svg', '/'), '/Logo.svg');
    assert.equal(
      resolvePublicAssetUrl('https://assets.example/image.png', './'),
      'https://assets.example/image.png'
    );
    assert.equal(resolvePublicAssetUrl('blob:test', './'), 'blob:test');
  });
});
