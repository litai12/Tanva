import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuitCoordinator } from './app-lifecycle.mjs';

test('window close cleans up once, then quits', async () => {
  const calls = [];
  let finishCleanup;
  const coordinator = createQuitCoordinator({
    cleanup: () => new Promise((resolve) => {
      calls.push('cleanup');
      finishCleanup = resolve;
    }),
    quit: () => calls.push('quit'),
    cleanupTimeoutMs: 5_000,
  });

  const firstRequest = coordinator.requestQuit();
  const secondRequest = coordinator.requestQuit();

  assert.equal(firstRequest, secondRequest);
  assert.deepEqual(calls, []);
  await Promise.resolve();
  assert.deepEqual(calls, ['cleanup']);
  assert.equal(coordinator.isReadyToQuit(), false);

  finishCleanup();
  await firstRequest;

  assert.deepEqual(calls, ['cleanup', 'quit']);
  assert.equal(coordinator.isReadyToQuit(), true);
});

test('cleanup timeout cannot leave the application running', async () => {
  const calls = [];
  const coordinator = createQuitCoordinator({
    cleanup: () => new Promise(() => {}),
    quit: () => calls.push('quit'),
    cleanupTimeoutMs: 5,
  });

  await coordinator.requestQuit();

  assert.deepEqual(calls, ['quit']);
  assert.equal(coordinator.isReadyToQuit(), true);
});
