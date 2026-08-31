// PM2 process config for the Tanva backend.
//
// Why this file exists: the process was previously started with a bare
// `pm2 start dist/main.js` (no node_args, max_memory_restart=500MB). On
// 2026-06-25 it crashed with "JavaScript heap out of memory" — the V8 heap hit
// its ~2240MB default ceiling. Root cause was unbounded concurrent work (image
// worker concurrency defaulted to 1,000,000) plus single large in-memory
// buffers. Per-request byte caps were added in code; this file pins the memory
// budget and concurrency so the box (16GB total, shared with PG/Redis/new-api/
// nginx/Docker workloads) can't OOM the process or trip the kernel OOM-killer.
//
// Memory budget (production currently has 16GB and also runs PG/Redis/new-api/
// nginx/Docker workloads):
//   --max-old-space-size=3072  → V8 heap cap 3GB
//   idle recycle 2048M         → when the image worker is idle, recycle native
//                                allocator retention without interrupting a job
//   max_memory_restart 6144M   → emergency RSS safety net; intentionally above
//                                the idle recycle line so active jobs are not the
//                                normal restart path
//   --heapsnapshot-near-heap-limit=2 → auto-dump a .heapsnapshot near the cap
//                                so the next OOM names the culprit
//
// Tuning: IMAGE_TASK_MAX_CONCURRENT bounds how many image jobs run at once
// (the rest queue in Redis, nothing is rejected). Keep the established 1000
// ceiling; byte caps, Sharp limits, jemalloc and idle recycling govern memory.

const fs = require('node:fs');

const jemallocPath = [
  process.env.JEMALLOC_PATH,
  '/lib/x86_64-linux-gnu/libjemalloc.so.2',
  '/usr/local/lib/libjemalloc.so.2',
].find((candidate) => candidate && fs.existsSync(candidate));

const allocatorEnv =
  process.platform === 'linux' && jemallocPath
    ? {
        LD_PRELOAD: jemallocPath,
        MALLOC_CONF:
          process.env.MALLOC_CONF ||
          'background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:1000,metadata_thp:auto',
      }
    : process.platform === 'linux'
      ? { MALLOC_ARENA_MAX: '2' }
      : {};

module.exports = {
  apps: [
    {
      name: 'tanvas-api',
      script: 'dist/main.js',
      cwd: '/www/wwwroot/tanvas.cn/backend',
      interpreter: '/usr/bin/node',
      exec_mode: 'fork',
      instances: 1,
      // -r ./dist/tracing.bootstrap.js preserves the original startup require.
      node_args: [
        '-r',
        './dist/tracing.bootstrap.js',
        '--max-old-space-size=3072',
        '--heapsnapshot-near-heap-limit=2',
      ],
      max_memory_restart: '6144M',
      restart_delay: 3000,
      kill_timeout: 30000,
      listen_timeout: 30000,
      min_uptime: '30s',
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        PM2_MAX_MEMORY_RESTART_MB: '6144',
        ...allocatorEnv,
        // Preserve the established in-process image-worker concurrency ceiling.
        // Excess tasks queue in Redis (waiting); they are not dropped.
        IMAGE_TASK_MAX_CONCURRENT: '1000',
        // Native allocator retention is recycled only after the local worker has
        // no active jobs; PM2 then starts a clean process.
        IMAGE_TASK_IDLE_RECYCLE_MB: '2048',
        IMAGE_TASK_IDLE_RECYCLE_CHECK_MS: '30000',
        IMAGE_TASK_IDLE_RECYCLE_MIN_UPTIME_SEC: '300',
        IMAGE_TASK_OUTPUT_MAX_MB: '64',
        SHARP_CONCURRENCY: '1',
        SHARP_LIMIT_INPUT_PIXELS: '40000000',
        // Per-download / per-object byte caps (defaults already baked into code;
        // listed here so they're discoverable and tunable without a rebuild).
        // OSS_MAX_OBJECT_BYTES: '67108864',        // 64MB
        // ASSET_PROXY_MAX_BUFFER_BYTES: '67108864',// 64MB
        // VIDEO_DOWNLOAD_MAX_BYTES: '536870912',   // 512MB
        // IMAGE_DOWNLOAD_MAX_BYTES: '67108864',    // 64MB
      },
    },
  ],
};
