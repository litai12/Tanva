#!/usr/bin/env node
/**
 * Image Task Queue Load Test
 *
 * Usage:
 *   node scripts/load-test-image-tasks.js --token "Bearer eyJ..." [options]
 *
 * Options:
 *   --token      JWT token (with or without "Bearer " prefix)
 *   --base       Base URL (default: http://localhost:4000)
 *   --concurrent Number of tasks to submit in parallel (default: 20)
 *   --total      Total tasks to submit (default: 50)
 *   --interval   ms between each batch submission (default: 0)
 *   --poll       Poll interval ms for status (default: 2000)
 *   --timeout    Max wait time ms per task (default: 120000)
 *   --type       Task type: generate|blend (default: generate)
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------- CLI args ----------
const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const BASE = get('--base', 'http://localhost:4000');
const RAW_TOKEN = get('--token', '');
const TOKEN = RAW_TOKEN.startsWith('Bearer ') ? RAW_TOKEN : `Bearer ${RAW_TOKEN}`;
const CONCURRENT = parseInt(get('--concurrent', '20'), 10);
const TOTAL = parseInt(get('--total', '50'), 10);
const POLL_MS = parseInt(get('--poll', '2000'), 10);
const TIMEOUT_MS = parseInt(get('--timeout', '120000'), 10);
const TASK_TYPE = get('--type', 'generate'); // generate | blend

if (!RAW_TOKEN) {
  console.error('❌  --token is required. Copy it from browser DevTools → Network → Authorization header.');
  process.exit(1);
}

// ---------- HTTP helpers ----------
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: TOKEN,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------- Task submission ----------
const GENERATE_BODY = {
  prompt: 'A serene mountain landscape at sunset, photorealistic',
  aspectRatio: '1:1',
};

const BLEND_BODY = {
  imageUrls: [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
  ],
  prompt: 'blend these two images',
  aspectRatio: '1:1',
};

async function submitTask() {
  const path =
    TASK_TYPE === 'blend'
      ? '/api/ai/blend-images-async'
      : '/api/ai/generate-image-async';
  const body = TASK_TYPE === 'blend' ? BLEND_BODY : GENERATE_BODY;
  const res = await request('POST', path, body);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Submit failed: HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  }
  const taskId = res.body?.taskId || res.body?.id;
  if (!taskId) throw new Error(`No taskId in response: ${JSON.stringify(res.body)}`);
  return taskId;
}

// ---------- Task polling ----------
async function pollTask(taskId) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const res = await request('GET', `/api/ai/image-task/${taskId}`);
    if (res.status !== 200) throw new Error(`Poll failed: HTTP ${res.status}`);
    const { status } = res.body;
    if (status === 'succeeded') return { result: 'succeeded', ms: Date.now() - start };
    if (status === 'failed') return { result: 'failed', ms: Date.now() - start, reason: res.body.error };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { result: 'timeout', ms: TIMEOUT_MS };
}

// ---------- Stats ----------
const stats = {
  submitted: 0,
  submitFailed: 0,
  succeeded: 0,
  failed: 0,
  timedOut: 0,
  durations: [],
};

function printStats(label) {
  const sorted = [...stats.durations].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const avg = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0;

  console.log(`\n═══ ${label} ═══`);
  console.log(`  Submitted   : ${stats.submitted} / ${TOTAL}  (failed to submit: ${stats.submitFailed})`);
  console.log(`  Succeeded   : ${stats.succeeded}`);
  console.log(`  Failed      : ${stats.failed}`);
  console.log(`  Timed out   : ${stats.timedOut}`);
  console.log(`  Latency     : avg=${avg}ms  p50=${p50}ms  p90=${p90}ms  p99=${p99}ms`);
}

// ---------- Main ----------
async function runTask(index) {
  const label = `#${String(index + 1).padStart(3, '0')}`;
  let taskId;
  try {
    taskId = await submitTask();
    stats.submitted++;
    console.log(`  ${label} queued  taskId=${taskId}`);
  } catch (e) {
    stats.submitFailed++;
    console.error(`  ${label} submit FAILED: ${e.message}`);
    return;
  }

  const outcome = await pollTask(taskId);
  if (outcome.result === 'succeeded') {
    stats.succeeded++;
    stats.durations.push(outcome.ms);
    console.log(`  ${label} ✅ succeeded  ${outcome.ms}ms`);
  } else if (outcome.result === 'failed') {
    stats.failed++;
    console.log(`  ${label} ❌ failed  ${outcome.ms}ms  reason=${outcome.reason ?? 'unknown'}`);
  } else {
    stats.timedOut++;
    console.log(`  ${label} ⏱  timeout after ${TIMEOUT_MS}ms`);
  }
}

async function main() {
  console.log(`\n🚀 Image Task Load Test`);
  console.log(`   Base      : ${BASE}`);
  console.log(`   Type      : ${TASK_TYPE}`);
  console.log(`   Total     : ${TOTAL}`);
  console.log(`   Concurrent: ${CONCURRENT}`);
  console.log(`   Poll      : ${POLL_MS}ms`);
  console.log(`   Timeout   : ${TIMEOUT_MS}ms\n`);

  const wallStart = Date.now();
  let index = 0;

  // Submit in batches of CONCURRENT
  while (index < TOTAL) {
    const batch = [];
    const batchSize = Math.min(CONCURRENT, TOTAL - index);
    console.log(`\n── Batch ${Math.floor(index / CONCURRENT) + 1}: submitting ${batchSize} tasks ──`);
    for (let i = 0; i < batchSize; i++) {
      batch.push(runTask(index + i));
    }
    await Promise.all(batch);
    index += batchSize;
    printStats('Running totals');
  }

  const wallMs = Date.now() - wallStart;
  console.log(`\n  Wall time: ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`  Throughput: ${((stats.succeeded / wallMs) * 1000).toFixed(2)} tasks/s (succeeded)`);
  printStats('FINAL RESULTS');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
