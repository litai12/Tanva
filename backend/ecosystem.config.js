// PM2 process config for the Tanva backend.
//
// Why this file exists: the process was previously started with a bare
// `pm2 start dist/main.js` (no node_args, max_memory_restart=500MB). On
// 2026-06-25 it crashed with "JavaScript heap out of memory" — the V8 heap hit
// its ~2240MB default ceiling. Root cause was unbounded concurrent work (image
// worker concurrency defaulted to 1,000,000) plus single large in-memory
// buffers. Per-request byte caps were added in code; this file pins the memory
// budget and concurrency so the box (8GB total, shared with PG/Redis/new-api/
// nginx) can't OOM the process or trip the kernel OOM-killer.
//
// Memory budget (8GB box, ~2.5GB reserved for PG/Redis/new-api/nginx/OS):
//   --max-old-space-size=3072  → V8 heap cap 3GB
//   max_memory_restart 4096M   → RSS safety net, well under 8GB (RSS = heap +
//                                native buffers + sharp/libvips off-heap)
//   --heapsnapshot-near-heap-limit=2 → auto-dump a .heapsnapshot near the cap
//                                so the next OOM names the culprit
//
// Tuning: IMAGE_TASK_MAX_CONCURRENT bounds how many image jobs run at once
// (the rest queue in Redis, nothing is rejected). 200 is an aggressive start —
// it works because jobs spend most of their time awaiting upstream generation
// (low memory) and only buffer the result briefly, but correlated download
// peaks can still spike the heap. Watch `pm2 monit` under load; if RSS climbs
// toward 4GB or restarts happen, lower it (100 → 50). It's an env var, so just
// edit + `pm2 reload main --update-env`, no rebuild.
module.exports = {
  apps: [
    {
      name: 'main',
      script: 'dist/main.js',
      cwd: '/www/wwwroot/tanvas.cn/backend',
      exec_mode: 'fork',
      instances: 1,
      // -r ./dist/tracing.bootstrap.js preserves the original startup require.
      node_args: [
        '-r',
        './dist/tracing.bootstrap.js',
        '--max-old-space-size=3072',
        '--heapsnapshot-near-heap-limit=2',
      ],
      max_memory_restart: '4096M',
      env: {
        NODE_ENV: 'production',
        // Concurrency ceiling for the in-process image worker. Excess tasks
        // queue in Redis (waiting), they are not dropped. Lower if memory-bound.
        IMAGE_TASK_MAX_CONCURRENT: '1000',
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
