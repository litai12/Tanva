import assert from 'node:assert/strict';
import {
  resolveImageTaskRuntimeConfig,
  shouldRecycleIdleImageTaskProcess,
} from './image-task-runtime.config';

const defaults = resolveImageTaskRuntimeConfig({});
assert.equal(defaults.maxConcurrent, 1000);
assert.equal(defaults.outputMaxBytes, 64 * 1024 * 1024);
assert.equal(defaults.idleRecycleRssBytes, 0);

const configured = resolveImageTaskRuntimeConfig({
  IMAGE_TASK_MAX_CONCURRENT: '120',
  IMAGE_TASK_IDLE_RECYCLE_MB: '2048',
  IMAGE_TASK_IDLE_RECYCLE_CHECK_MS: '15000',
  IMAGE_TASK_IDLE_RECYCLE_MIN_UPTIME_SEC: '600',
  IMAGE_TASK_OUTPUT_MAX_MB: '32',
});
assert.equal(configured.maxConcurrent, 120);
assert.equal(configured.idleRecycleRssBytes, 2048 * 1024 * 1024);
assert.equal(configured.idleRecycleCheckMs, 15000);
assert.equal(configured.idleRecycleMinUptimeSec, 600);
assert.equal(configured.outputMaxBytes, 32 * 1024 * 1024);

assert.equal(
  shouldRecycleIdleImageTaskProcess({
    rssBytes: 3 * 1024 * 1024 * 1024,
    activeJobs: 0,
    uptimeSec: 700,
    config: configured,
  }),
  true,
);
assert.equal(
  shouldRecycleIdleImageTaskProcess({
    rssBytes: 3 * 1024 * 1024 * 1024,
    activeJobs: 1,
    uptimeSec: 700,
    config: configured,
  }),
  false,
);
assert.equal(
  shouldRecycleIdleImageTaskProcess({
    rssBytes: 1024 * 1024 * 1024,
    activeJobs: 0,
    uptimeSec: 700,
    config: configured,
  }),
  false,
);

console.log('image task runtime config checks passed');
