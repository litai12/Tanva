import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreProjectHistoryState } from './projectContentHistoryState.ts';

test('history restore changes content without rolling back cloud or guard state', () => {
  const state = {
    projectId: 'project-1',
    content: { marker: 'current' },
    version: 75,
    dirty: true,
    dirtySince: 100,
    dirtyCounter: 12,
    saving: true,
    manualSaving: true,
    lastSavedAt: '2026-07-20T08:53:42.000Z',
    lastError: 'previous error',
    lastWarning: 'keep warning',
    hydrated: true,
    cacheValidationPending: true,
    staleContent: true,
    staleReason: 'save-rejected',
    projectViewReady: true,
  };
  const historyContent = { marker: 'history' };

  const restored = restoreProjectHistoryState(state, historyContent, 999);

  assert.equal(restored.content, historyContent);
  assert.equal(restored.version, 75);
  assert.equal(restored.lastSavedAt, state.lastSavedAt);
  assert.equal(restored.saving, true);
  assert.equal(restored.manualSaving, true);
  assert.equal(restored.cacheValidationPending, true);
  assert.equal(restored.staleContent, true);
  assert.equal(restored.staleReason, 'save-rejected');
  assert.equal(restored.projectViewReady, true);
  assert.equal(restored.dirty, true);
  assert.equal(restored.dirtySince, 100);
  assert.equal(restored.dirtyCounter, 13);
  assert.equal(restored.lastError, null);
  assert.equal(restored.lastWarning, 'keep warning');
});

test('history restore is ignored when no project is active', () => {
  const state = {
    projectId: null,
    content: null as { marker: string } | null,
    version: 1,
    dirty: false,
    dirtySince: null,
    dirtyCounter: 0,
    lastError: null,
  };

  const restored = restoreProjectHistoryState(state, { marker: 'history' }, 999);

  assert.equal(restored, state);
});
