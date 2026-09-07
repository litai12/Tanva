import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { LocalCodexClient } from './local-codex-client.mjs';

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = { writable: true, write(payload) {
    const request = JSON.parse(payload);
    queueMicrotask(() => child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { method: request.method } })}\n`));
  }};
  child.kill = () => child.emit('exit', 0, null);
  return child;
}

test('local Codex client speaks app-server JSONL requests', async () => {
  const client = new LocalCodexClient({ executable: '/tmp/codex', spawnProcess: fakeSpawn });
  assert.deepEqual(await client.startThread({ ephemeral: true }), { method: 'thread/start' });
  assert.deepEqual(await client.startTurn({ threadId: 't1', input: [{ type: 'text', text: 'hi' }] }), { method: 'turn/start' });
  await client.close();
});
