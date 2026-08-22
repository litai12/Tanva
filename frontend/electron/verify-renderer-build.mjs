import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const indexPath = resolve(import.meta.dirname, '..', 'dist', 'index.html');
const html = await readFile(indexPath, 'utf8');

assert.match(
  html,
  /<script[^>]+src="\.\/assets\//,
  'Desktop renderer entry script must use a path relative to index.html'
);
assert.match(
  html,
  /<link[^>]+href="\.\/assets\//,
  'Desktop renderer stylesheet must use a path relative to index.html'
);
assert.doesNotMatch(
  html,
  /(?:src|href)="\/(?!\/)/,
  'Desktop renderer contains a root-absolute asset that cannot load through file://'
);

console.log('[tanva-desktop] renderer asset paths are file:// compatible');
