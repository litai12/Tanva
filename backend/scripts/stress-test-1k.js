#!/usr/bin/env node
/**
 * 1000-task Gemini stress test + real-time monitor
 *
 * Usage:
 *   node scripts/stress-test-1k.js [--total 1000] [--batch 30] [--delay 200]
 *
 * Generates a JWT token automatically from JWT_ACCESS_SECRET in backend/.env
 * Submits tasks and monitors queue + memory in parallel.
 */

const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { URL } = require('url');

// ── load .env ─────────────────────────────────────────────────────────────────
function loadEnv(envPath) {
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const env = loadEnv(path.join(__dirname, '../.env'));
const JWT_SECRET = env.JWT_ACCESS_SECRET || 'dev-access-secret';
const BACKEND_PID = 82083; // NestJS server pid after auto-restart

// ── sign JWT without external lib (HS256 pure JS) ────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function signJwt(payload, secret) {
  const crypto = require('crypto');
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64url(JSON.stringify(payload));
  const sig     = b64url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

// user ID seen in server logs
const USER_ID = 'e29fe054-2185-4294-9195-8458d1501360';
const TOKEN = 'Bearer ' + signJwt(
  { sub: USER_ID, email: 'test@load.test', role: 'user', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 86400 },
  JWT_SECRET
);

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg  = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i+1] : def; };
const TOTAL      = parseInt(arg('--total',  '1000'), 10);
const BATCH_SIZE = parseInt(arg('--batch',  '30'),   10);   // concurrent per wave
const WAVE_DELAY = parseInt(arg('--delay',  '200'),  10);   // ms between waves
const BASE       = arg('--base', 'http://localhost:4000');

// ── HTTP helper ───────────────────────────────────────────────────────────────
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const u   = new URL(urlPath, BASE);
    const lib = u.protocol === 'https:' ? https : http;
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: TOKEN,
        ...(buf ? { 'Content-Length': buf.length } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (buf) req.write(buf);
    req.end();
  });
}

// ── Redis queue monitor (raw TCP, no deps) ────────────────────────────────────
class RedisMonitor {
  constructor(host='127.0.0.1', port=6379) {
    this.host = host; this.port = port; this.net = require('net');
  }
  _cmd(...args) {
    return new Promise((resolve, reject) => {
      const s   = new this.net.Socket();
      const cmd = `*${args.length}\r\n` + args.map(a => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('');
      let buf   = '';
      s.setTimeout(3000);
      s.connect(this.port, this.host, () => s.write(cmd));
      s.on('data', d => { buf += d; s.destroy(); });
      s.on('close', () => {
        // parse simple integer or bulk
        const m = buf.match(/:(\d+)/); resolve(m ? parseInt(m[1],10) : 0);
      });
      s.on('error', () => resolve(0));
      s.on('timeout', () => { s.destroy(); resolve(0); });
    });
  }
  async stats(queue='image-tasks') {
    const [wait, active, delayed, completed, failed] = await Promise.all([
      this._cmd('LLEN', `bull:${queue}:wait`),
      this._cmd('LLEN', `bull:${queue}:active`),
      this._cmd('ZCARD', `bull:${queue}:delayed`),
      this._cmd('ZCARD', `bull:${queue}:completed`),
      this._cmd('ZCARD', `bull:${queue}:failed`),
    ]);
    return { wait, active, delayed, completed, failed };
  }
}

// ── Process memory (read /proc/PID/status or macOS ps) ───────────────────────
function getProcessMemMB(pid) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`ps -o rss= -p ${pid} 2>/dev/null`, { encoding:'utf8' }).trim();
    return Math.round(parseInt(out, 10) / 1024); // KB → MB
  } catch { return 0; }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
const st = { submitted: 0, failed: 0, rateLimited: 0, startMs: Date.now(), waves: 0 };

// ── GEMINI prompt pool ────────────────────────────────────────────────────────
const PROMPTS = [
  'A neon-lit cyberpunk street at midnight, ultra-detailed',
  'Watercolor painting of a Japanese garden in spring',
  'Surreal melting clock landscape, oil painting style',
  'Aerial view of a futuristic city with flying cars',
  'Close-up of a hummingbird feeding on a flower, macro photography',
  'Abstract geometric patterns in vibrant colors',
  'Ancient temple ruins overgrown with jungle vegetation',
  'A serene lake reflecting snow-capped mountains at dawn',
  'Steampunk submarine underwater, detailed illustration',
  'Portrait of an elderly woman with expressive eyes',
];

function randomPrompt(i) {
  return `[Stress test #${i}] ` + PROMPTS[i % PROMPTS.length];
}

// ── Submit a single generate task ─────────────────────────────────────────────
async function submitOne(i) {
  try {
    const res = await request('POST', '/api/ai/generate-image-async', {
      prompt: randomPrompt(i),
      aspectRatio: '1:1',
    });
    if (res.status === 200 || res.status === 201) {
      st.submitted++;
      return res.body?.taskId || res.body?.id || '?';
    } else if (res.status === 429) {
      st.rateLimited++;
      return null;
    } else {
      st.failed++;
      return null;
    }
  } catch (e) {
    st.failed++;
    return null;
  }
}

// ── Display helpers ───────────────────────────────────────────────────────────
function clearLine() { process.stdout.write('\r\x1b[K'); }
function moveCursorUp(n) { process.stdout.write(`\x1b[${n}A`); }

const HEADER_LINES = 12;
let firstPrint = true;

async function printStatus(redis) {
  const q   = await redis.stats();
  const mem = getProcessMemMB(BACKEND_PID);
  const elapsed = ((Date.now() - st.startMs) / 1000).toFixed(0);
  const rate = elapsed > 0 ? (st.submitted / elapsed).toFixed(1) : '0';

  const rateLimitPct = TOTAL > 0 ? ((st.rateLimited / TOTAL) * 100).toFixed(1) : '0';
  const lines = [
    ``,
    `  ┌─ Image Task Stress Test (${TOTAL} Gemini tasks) ${'─'.repeat(23)}`,
    `  │  Elapsed     : ${elapsed}s       Submit rate: ${rate} tasks/s`,
    `  │  Accepted    : ${String(st.submitted).padStart(4)} / ${TOTAL}`,
    `  │  Rate-limited: ${String(st.rateLimited).padStart(4)}  (429) ${rateLimitPct}%`,
    `  │  Errors      : ${String(st.failed).padStart(4)}  (5xx/net)`,
    `  ├─ Queue ─────────────────────────────────────────────────`,
    `  │  Wait        : ${String(q.wait).padStart(5)}  (queued, not yet processed)`,
    `  │  Active      : ${String(q.active).padStart(5)}  (worker concurrency in use)`,
    `  │  Completed   : ${String(q.completed).padStart(5)}`,
    `  │  Failed      : ${String(q.failed).padStart(5)}`,
    `  ├─ Server Memory (pid ${BACKEND_PID}) ──────────────────────────`,
    `  │  RSS          : ${mem} MB`,
    `  └${'─'.repeat(58)}`,
    ``,
  ];

  if (!firstPrint) moveCursorUp(lines.length);
  firstPrint = false;
  console.log(lines.join('\n'));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const redis = new RedisMonitor();

  console.log(`\n🚀  Starting stress test`);
  console.log(`    Target  : ${TOTAL} tasks`);
  console.log(`    Batch   : ${BATCH_SIZE} concurrent per wave`);
  console.log(`    Delay   : ${WAVE_DELAY}ms between waves`);
  console.log(`    Backend : ${BASE}\n`);

  // start periodic display
  const displayTimer = setInterval(() => printStatus(redis), 1500);

  let index = 0;
  while (index < TOTAL) {
    st.waves++;
    const size   = Math.min(BATCH_SIZE, TOTAL - index);
    const tasks  = Array.from({ length: size }, (_, k) => submitOne(index + k));
    await Promise.all(tasks);
    index += size;
    if (WAVE_DELAY > 0 && index < TOTAL) {
      await new Promise(r => setTimeout(r, WAVE_DELAY));
    }
  }

  // All submitted — keep monitoring until queue drains or 10 min pass
  console.log(`\n\n  ✅  All ${st.submitted} tasks submitted (${st.failed} failed).`);
  console.log(`  Monitoring queue drain… (Ctrl+C to stop)\n`);
  firstPrint = true; // reset cursor tracking for the drain phase

  await new Promise(resolve => {
    let idleCount = 0;
    const drainTimer = setInterval(async () => {
      const q = await redis.stats();
      await printStatus(redis);
      if (q.wait === 0 && q.active === 0) {
        idleCount++;
        if (idleCount >= 3) { clearInterval(drainTimer); resolve(); }
      } else {
        idleCount = 0;
      }
    }, 3000);

    // hard timeout: 10 min
    setTimeout(() => { clearInterval(drainTimer); resolve(); }, 600_000);
  });

  clearInterval(displayTimer);

  // final snapshot
  const q   = await redis.stats();
  const mem = getProcessMemMB(BACKEND_PID);
  console.log(`\n══════════ FINAL SUMMARY ══════════`);
  console.log(`  Accepted     : ${st.submitted} / ${TOTAL}`);
  console.log(`  Rate-limited : ${st.rateLimited} (429)`);
  console.log(`  Errors       : ${st.failed}`);
  console.log(`  Q.wait       : ${q.wait}`);
  console.log(`  Q.active     : ${q.active}`);
  console.log(`  Q.completed  : ${q.completed}`);
  console.log(`  Q.failed     : ${q.failed}`);
  console.log(`  Server RSS   : ${mem} MB`);
  console.log(`  Elapsed      : ${((Date.now()-st.startMs)/1000).toFixed(0)}s`);
  console.log(`═══════════════════════════════════\n`);
}

main().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1); });
