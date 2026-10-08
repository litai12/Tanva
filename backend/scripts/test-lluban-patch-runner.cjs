const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tanva-lluban-patch-'));
const seedName = '2026-10-08/001-add-lluban-chat-channel.sql';
const scopeName = '2026-10-08/002-use-only-lluban-chat-channel.sql';
const pricingName = '2026-10-08/003-sync-lluban-official-prices.sql';
const sentinel = 'fixture-only-key-with-quote-\'-$-and-newline\nsecond-line';
try {
  const patchRoot = path.join(root, 'patches');
  fs.mkdirSync(path.join(patchRoot, '2026-10-08'), { recursive: true });
  fs.writeFileSync(path.join(patchRoot, seedName), '\\getenv lluban_key LLUBAN_API_KEY\nBEGIN;\nSELECT :\'lluban_key\';\nCOMMIT;\n');
  fs.writeFileSync(path.join(patchRoot, scopeName), '-- fixture: scope and shared readiness check\n');
  fs.writeFileSync(path.join(patchRoot, pricingName), '-- fixture: latest public pricing snapshot\n');
  // Replace only the container mount path so the real migration runner executes
  // against isolated fixture files. Its dependency/migration branches stay intact.
  const runnerSource = fs.readFileSync(path.join(__dirname, '../../new-api/patches/_apply.sh'), 'utf8');
  assert.ok(runnerSource.includes('cd /patches'));
  const runner = path.join(root, 'runner.sh');
  fs.writeFileSync(runner, runnerSource.replace('cd /patches', 'cd "$PATCH_TEST_ROOT"'));
  fs.writeFileSync(path.join(root, 'psql'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PATCH_CALL_LOG, JSON.stringify(args) + '\\n');
if (args.includes('-f')) {
  const filename = args[args.indexOf('-f') + 1];
  if (args.includes('lluban_scope_check_only=on')) {
    if (!filename.endsWith('002-use-only-lluban-chat-channel.sql')) process.exit(93);
    process.exit(process.env.PATCH_NOT_READY === '1' ? 18 : 0);
  }
  if (filename.endsWith('001-add-lluban-chat-channel.sql')) {
    if (process.env.LLUBAN_API_KEY !== process.env.PATCH_SENTINEL) process.exit(91);
    const sql = fs.readFileSync(filename, 'utf8');
    if (!sql.startsWith('\\\\getenv lluban_key LLUBAN_API_KEY\\n')) process.exit(92);
    // Exercise accidental secret-bearing PostgreSQL output on success/failure.
    process.stdout.write(process.env.LLUBAN_API_KEY);
    process.stderr.write(process.env.LLUBAN_API_KEY);
    process.exit(process.env.PATCH_FAIL === '1' ? 17 : 0);
  }
  process.exit(process.env.PATCH_LATER_FAIL === '1' ? 19 : 0);
}
const query = args[args.indexOf('-c') + 1] || '';
const db = fs.existsSync(process.env.PATCH_DB) ? JSON.parse(fs.readFileSync(process.env.PATCH_DB, 'utf8')) : [];
const selected = query.match(/filename\\s*=\\s*'([^']+)'/);
if (query.startsWith('SELECT 1 FROM schema_migrations') && selected &&
  (db.includes(selected[1]) || process.env.PATCH_ALREADY === '1' ||
   process.env.PATCH_SEED_APPLIED === '1' && selected[1] === '${seedName}')) console.log('1');
if (query.startsWith('INSERT INTO schema_migrations')) {
  const inserted = query.match(/VALUES \\('([^']+)'\\)/);
  if (!inserted) process.exit(94);
  fs.writeFileSync(process.env.PATCH_DB, JSON.stringify([...db,inserted[1]]));
}
`, { mode: 0o755 });

  function run(name, key, flags = {}) {
    const log = path.join(root, `${name}.jsonl`);
    const db = path.join(root, `${name}.db.json`);
    const result = spawnSync('sh', [runner], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PG_USER: 'fixture', PG_DB: 'fixture',
        PATCH_TEST_ROOT: patchRoot, PATCH_CALL_LOG: log, PATCH_DB: db, PATCH_SENTINEL: sentinel,
        LLUBAN_API_KEY: key, PATCH_FAIL: '0', PATCH_ALREADY: '0', PATCH_SEED_APPLIED: '0',
        PATCH_NOT_READY: '0', PATCH_LATER_FAIL: '0', ...flags },
    });
    const output = result.stdout + result.stderr;
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(!output.includes(sentinel), `${name}: credential leaked in runner output`);
    assert.ok(!JSON.stringify(calls).includes(sentinel), `${name}: credential leaked in command arguments`);
    const applied = fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, 'utf8')) : [];
    const executions = calls.filter(args => args.includes('-f') && !args.includes('lluban_scope_check_only=on'))
      .map(args => args[args.indexOf('-f') + 1].replace(/^\.\//, ''));
    return { result, output, calls, applied, executions };
  }
  const missing = run('missing', '');
  assert.equal(missing.result.status, 0);
  assert.match(missing.output, /Deferred .*LLUBAN_API_KEY is required/);
  assert.match(missing.output, /deferred\(missing-config\)=3/);
  assert.deepEqual(missing.applied, []);
  assert.deepEqual(missing.executions, []);
  assert.ok(!missing.calls.some(args => args.includes('-f')), 'No successor/preflight should execute without seed');

  const success = run('success', sentinel);
  assert.equal(success.result.status, 0);
  assert.deepEqual(success.applied, [seedName, scopeName, pricingName]);
  assert.deepEqual(success.executions, [seedName, scopeName, pricingName]);
  assert.equal(success.calls.filter(args => args.includes('lluban_scope_check_only=on')).length, 2);
  assert.match(success.output, /applied=3/);

  const failure = run('failure', sentinel, { PATCH_FAIL: '1' });
  assert.equal(failure.result.status, 17);
  assert.deepEqual(failure.applied, []);
  assert.deepEqual(failure.executions, [seedName]);
  assert.match(failure.output, /psql exit 17; migration not recorded/);

  const notReady = run('not-ready', '', { PATCH_SEED_APPLIED: '1', PATCH_NOT_READY: '1' });
  assert.equal(notReady.result.status, 0);
  assert.deepEqual(notReady.applied, []);
  assert.deepEqual(notReady.executions, []);
  assert.match(notReady.output, /channel, pricing or routes are not ready/);
  assert.match(notReady.output, /deferred\(missing-config\)=2/);

  const configured = run('configured-without-env-key', '', { PATCH_SEED_APPLIED: '1' });
  assert.equal(configured.result.status, 0);
  assert.deepEqual(configured.applied, [scopeName, pricingName]);
  assert.deepEqual(configured.executions, [scopeName, pricingName]);

  const laterFailure = run('later-failure', '', { PATCH_SEED_APPLIED: '1', PATCH_LATER_FAIL: '1' });
  assert.equal(laterFailure.result.status, 19);
  assert.deepEqual(laterFailure.applied, []);
  assert.deepEqual(laterFailure.executions, [scopeName]);

  const repeated = run('repeated', sentinel, { PATCH_ALREADY: '1' });
  assert.equal(repeated.result.status, 0);
  assert.deepEqual(repeated.applied, []);
  assert.ok(!repeated.calls.some(args => args.includes('-f')));
  assert.match(repeated.output, /skipped\(already-applied\)=3/);
  console.log('PASS: Lluban 001/002/003 dependency deferral, actual-contract preflight, configured seed, '
    + 'apply/failure/replay, and credential isolation.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
