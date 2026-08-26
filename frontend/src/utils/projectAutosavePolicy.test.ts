import assert from 'node:assert/strict';
import test from 'node:test';
import { hasFlowNodesForAutosave } from './projectAutosavePolicy.ts';

test('skips autosave when flow is missing', () => {
  assert.equal(hasFlowNodesForAutosave({}), false);
});

test('skips autosave when flow nodes are empty', () => {
  assert.equal(
    hasFlowNodesForAutosave({
      flow: {
        nodes: [],
        edges: [],
      },
    }),
    false
  );
});

test('skips autosave when flow only contains edges', () => {
  assert.equal(
    hasFlowNodesForAutosave({
      flow: {
        nodes: [],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
      },
    }),
    false
  );
});

test('allows autosave when flow contains at least one node', () => {
  assert.equal(
    hasFlowNodesForAutosave({
      flow: {
        nodes: [
          {
            id: 'node-1',
            type: 'textPrompt',
            position: { x: 0, y: 0 },
            data: {},
          },
        ],
        edges: [],
      },
    }),
    true
  );
});
