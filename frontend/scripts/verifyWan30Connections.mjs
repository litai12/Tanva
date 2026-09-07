import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual FlowOverlay callbacks without mounting the entire app.
const source = ts.createSourceFile('FlowOverlay.tsx', readFileSync(new URL('../src/components/flow/FlowOverlay.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
    if (['normalizeHandleValue', 'isTextSourceHandle', 'textSourceTypes', 'videoSourceTypes', 'isImageSourceHandle', 'isValidConnection', 'canAcceptConnection'].includes(node.name.text)) {
      callbacks.set(node.name.text, node.initializer.arguments[0].getText(source));
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
function load(name, scope = {}) {
  assert.ok(callbacks.has(name), `Missing production callback: ${name}`);
  const js = ts.transpileModule(`const callback = ${callbacks.get(name)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn callback;`)(...Object.values(scope));
}
const nodes = new Map([
  ['prompt', { type: 'textPrompt', data: {} }],
  ['image', { type: 'image', data: {} }],
  ['video', { type: 'video', data: {} }],
  ['wan', { type: 'wan30Video', data: {} }],
]);
let edges = [];
const rf = { getNode: id => nodes.get(id), getEdges: () => edges };
const valid = load('isValidConnection', {
  rf,
  textSourceTypes: load('textSourceTypes')(),
  videoSourceTypes: load('videoSourceTypes')(),
  isImageSourceHandle: load('isImageSourceHandle', { normalizeHandleValue: load('normalizeHandleValue') }),
  isTextSourceHandle: load('isTextSourceHandle', { normalizeHandleValue: load('normalizeHandleValue') }),
});
const accepts = load('canAcceptConnection', { rf });
const connection = { source: 'prompt', sourceHandle: 'text', target: 'wan', targetHandle: 'text' };
assert.equal(valid(connection), true, 'Prompt must connect to Wan3.0');
assert.equal(accepts(connection), true, 'Empty Wan3.0 input must accept a prompt');
edges = [{ ...connection, id: 'existing' }];
assert.equal(accepts(connection), true, 'An existing prompt must permit replacement');
for (const source of ['image', 'video']) assert.equal(valid({ ...connection, source }), false);
for (const targetHandle of ['audio', null]) {
  assert.equal(valid({ ...connection, targetHandle }), false);
  assert.equal(accepts({ ...connection, targetHandle }), false);
}
assert.equal(valid({ ...connection, source: 'wan' }), false);
assert.equal(valid({ ...connection, source: 'missing' }), false);
assert.equal(valid({ ...connection, sourceHandle: 'image' }), false);
console.log('Wan3.0 production connection callbacks: all checks passed.');

for (const [source, sourceHandle, targetHandle, limit] of [['image', 'img', 'image', 10], ['image', 'img', 'image-2', 1], ['video', 'video', 'video', 5]]) {
  const mediaConnection = { ...connection, source, sourceHandle, targetHandle };
  assert.equal(valid(mediaConnection), true, `${source} must connect to ${targetHandle}`);
  edges = Array.from({ length: limit - 1 }, (_, i) => ({ ...mediaConnection, id: String(i) }));
  assert.equal(accepts(mediaConnection), true);
  edges.push({ ...mediaConnection, id: 'full' });
  assert.equal(accepts(mediaConnection), false, `${targetHandle} must enforce capacity`);
}
assert.equal(valid({ ...connection, source: 'image', sourceHandle: 'img', targetHandle: 'video' }), false);
console.log('Wan3.0 image, end-frame, video connection and capacity checks passed.');
