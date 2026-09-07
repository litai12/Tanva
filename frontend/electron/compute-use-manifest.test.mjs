import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { COMPUTE_USE_ACTIONS } from './compute-use-actions.mjs';

test('desktop bundle declares the complete compute-use capability domains', async () => {
  const path = fileURLToPath(new URL('../desktop-bundle/compute-use-manifest.json', import.meta.url));
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  for (const domain of ['sketchup', 'blender', 'rhino', 'autocad', 'knowledge', 'runtime', 'updates', 'business']) {
    assert.ok(manifest.domains.includes(domain), `missing domain: ${domain}`);
  }
  assert.equal(manifest.execution.rendererAccess, false);
  assert.equal(manifest.resultContract.requiresTaskId, true);
  assert.equal(manifest.resultContract.requiresProjectBinding, true);
  for (const domain of Object.keys(COMPUTE_USE_ACTIONS)) {
    assert.ok(manifest.domains.includes(domain), `action domain missing from manifest: ${domain}`);
  }
});
