import assert from "node:assert/strict";
import test from "node:test";
import { SharedRequestPool } from "./sharedRequestPool.ts";

test("deduplicates identical in-flight requests and caches the result", async () => {
  let calls = 0;
  let now = 100;
  const pool = new SharedRequestPool<number>({
    maxConcurrent: 2,
    ttlMs: 1000,
    maxEntries: 10,
    now: () => now,
  });
  const factory = async () => {
    calls += 1;
    return 42;
  };

  const [first, second] = await Promise.all([
    pool.request("same", factory),
    pool.request("same", factory),
  ]);
  assert.equal(first, 42);
  assert.equal(second, 42);
  assert.equal(calls, 1);

  assert.equal(await pool.request("same", factory), 42);
  assert.equal(calls, 1);

  now += 1001;
  assert.equal(await pool.request("same", factory), 42);
  assert.equal(calls, 2);
});

test("limits concurrency across different request keys", async () => {
  const pool = new SharedRequestPool<number>({
    maxConcurrent: 2,
    ttlMs: 0,
    maxEntries: 10,
  });
  let active = 0;
  let maxActive = 0;
  const releases: Array<() => void> = [];
  const factory = (value: number) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
    return value;
  };

  const requests = [
    pool.request("a", factory(1)),
    pool.request("b", factory(2)),
    pool.request("c", factory(3)),
  ];
  await Promise.resolve();
  assert.equal(active, 2);
  releases.shift()?.();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(maxActive, 2);
  assert.equal(active, 2);
  releases.shift()?.();
  releases.shift()?.();

  assert.deepEqual(await Promise.all(requests), [1, 2, 3]);
  assert.equal(maxActive, 2);
});
