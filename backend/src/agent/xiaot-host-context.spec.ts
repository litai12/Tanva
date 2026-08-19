import assert from 'node:assert/strict';
import {
  buildCanvasContextSummary,
  buildCapabilityManifestSummary,
  queryCanvasContext,
  queryCapabilityManifest,
  resolveLocalGreeting,
} from './xiaot-host-context';

const canvas = {
  nodes: [
    { id: 'a', type: 'textPrompt', selected: true, data: { text: '一个苹果' } },
    { id: 'b', type: 'generatePro', data: { imageUrl: 'https://example.com/a.png' } },
  ],
  edges: [{ id: 'e', source: 'a', target: 'b' }],
};

const summary = buildCanvasContextSummary(canvas);
const summaryNode = (summary.nodes as Array<{ data?: Record<string, unknown> }>)[0];
assert.equal(summaryNode.data?.nodeCount, 2);
assert.equal(summaryNode.data?.edgeCount, 1);
assert.deepEqual(summaryNode.data?.selectedNodeIds, ['a']);
assert.doesNotMatch(JSON.stringify(summary), /example\.com/);

const clientBounded = buildCanvasContextSummary({
  summary: { nodeCount: 99, edgeCount: 120, nodeTypes: [{ type: 'textPrompt', count: 40 }] },
  nodes: [canvas.nodes[0]],
  edges: [],
});
const clientSummaryNode = (clientBounded.nodes as Array<{ data?: Record<string, unknown> }>)[0];
assert.equal(clientSummaryNode.data?.nodeCount, 99);

const promptScoped = buildCanvasContextSummary(
  { ...canvas, nodes: canvas.nodes.map((node) => ({ ...node, selected: false })) },
  '画布上的提示词是什么？',
);
assert.match(JSON.stringify(promptScoped), /一个苹果/);

const neighbors = queryCanvasContext(canvas, { scope: 'neighbors', nodeIds: ['a'] });
assert.deepEqual(
  (neighbors.nodes as Array<{ id: string }>).map((node) => node.id),
  ['a', 'b'],
);

const manifest = {
  nodeSpecs: [{ type: 'generatePro', label: '生图', params: { size: '4K' } }],
};
assert.match(JSON.stringify(buildCapabilityManifestSummary(manifest)), /4K/);
assert.match(
  JSON.stringify(queryCapabilityManifest(manifest, { nodeTypes: ['generatePro'] })),
  /4K/,
);

assert.equal(resolveLocalGreeting('你好！'), '你好！有什么我可以帮你处理的吗？');
assert.equal(resolveLocalGreeting('你好，帮我生成苹果'), null);
