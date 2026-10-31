#!/usr/bin/env node
// Reproduce / verify Prisma connection-pool capacity without going through the API.
//
// Fires N concurrent `pg_sleep(S)` queries through a PrismaClient built from
// DATABASE_URL (pool params stripped, then <extra> appended) and reports how
// many succeeded, error codes (P2024 = pool exhausted), and the peak number of
// DB connections the pool actually opened.
//
// Usage (from backend/):
//   node scripts/db-pool-loadtest.cjs "" 60 3                                   # Prisma default pool
//   node scripts/db-pool-loadtest.cjs "connection_limit=40&pool_timeout=20" 60 3
//
// Safe on prod: holds at most min(N, connection_limit) idle-sleeping
// connections for S seconds. Keep N*S small and below PG max_connections headroom.

const path = require('node:path');
const backendDir = path.resolve(__dirname, '..');
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env'), quiet: true });
const { PrismaClient } = require(path.join(backendDir, 'node_modules/@prisma/client'));

const extra = process.argv[2] || '';
const n = Number(process.argv[3] || 60);
const sleepSec = Number(process.argv[4] || 3);

const base = process.env.DATABASE_URL.replace(/[?&](connection_limit|pool_timeout)=[^&]*/g, '');
const url = extra ? base + (base.includes('?') ? '&' : '?') + extra : base;
const client = new PrismaClient({ datasources: { db: { url } } });
const monitor = new PrismaClient({ datasources: { db: { url: base } } });

(async () => {
  const started = Date.now();
  let ok = 0;
  let fail = 0;
  let peak = 0;
  const errs = {};
  const timer = setInterval(async () => {
    try {
      const rows = await monitor.$queryRawUnsafe(
        "select count(*)::int c from pg_stat_activity where datname = current_database() and query like '%from pg_sleep%' and state = 'active' and pid <> pg_backend_pid()",
      );
      peak = Math.max(peak, rows[0].c);
    } catch {}
  }, 400);

  await Promise.all(
    Array.from({ length: n }, () =>
      client.$queryRawUnsafe(`select 1::int as x from pg_sleep(${sleepSec})`).then(
        () => ok++,
        (e) => {
          fail++;
          const key = e.code || String(e.message).slice(0, 60);
          errs[key] = (errs[key] || 0) + 1;
        },
      ),
    ),
  );

  clearInterval(timer);
  console.log(JSON.stringify({ extra: extra || '(prisma default)', n, ok, fail, errs, peakDbConns: peak, ms: Date.now() - started }));
  await Promise.all([client.$disconnect(), monitor.$disconnect()]);
  process.exit(fail ? 1 : 0);
})();
