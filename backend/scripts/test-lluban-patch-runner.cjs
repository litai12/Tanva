const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tanva-lluban-patch-'));
const patchName = '2026-10-08/001-add-lluban-chat-channel.sql';
const sentinel = 'fixture-only-key-with-quote-\'-$-and-newline\nsecond-line';
try {
  const patchRoot = path.join(root, 'patches');
  fs.mkdirSync(path.join(patchRoot, '2026-10-08'), { recursive: true });
  fs.writeFileSync(path.join(patchRoot, patchName), '\\getenv lluban_key LLUBAN_API_KEY\nBEGIN;\nSELECT :\'lluban_key\';\nCOMMIT;\n');
  // Replace only the container mount path so the production runner can execute
  // against an isolated fixture. Its branch and migration logic stay unchanged.
  const runnerSource = fs.readFileSync(path.join(__dirname, '../../new-api/patches/_apply.sh'), 'utf8');
  assert.ok(runnerSource.includes('cd /patches'));
  const runner = path.join(root, 'runner.sh');
  fs.writeFileSync(runner, runnerSource.replace('cd /patches', 'cd "$PATCH_TEST_ROOT"'));
  fs.writeFileSync(path.join(root, 'psql'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PATCH_CALL_LOG, JSON.stringify(args) + '\\n');
if (args.includes('-f')) {
  if (process.env.LLUBAN_API_KEY !== process.env.PATCH_SENTINEL) process.exit(91);
  const sql = fs.readFileSync(args[args.indexOf('-f') + 1], 'utf8');
  if (!sql.startsWith('\\\\getenv lluban_key LLUBAN_API_KEY\\n')) process.exit(92);
  // Exercise accidental secret-bearing PostgreSQL output on success and failure.
  process.stdout.write(process.env.LLUBAN_API_KEY);
  process.stderr.write(process.env.LLUBAN_API_KEY);
  process.exit(process.env.PATCH_FAIL === '1' ? 17 : 0);
}
const query = args[args.indexOf('-c') + 1] || '';
if (query.startsWith('SELECT 1 FROM schema_migrations') && process.env.PATCH_ALREADY === '1') console.log('1');
`, { mode: 0o755 });

  function run(name, key, flags = {}) {
    const log = path.join(root, `${name}.jsonl`);
    const result = spawnSync('sh', [runner], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PG_USER: 'fixture', PG_DB: 'fixture',
        PATCH_TEST_ROOT: patchRoot, PATCH_CALL_LOG: log, PATCH_SENTINEL: sentinel,
        LLUBAN_API_KEY: key, PATCH_FAIL: '0', PATCH_ALREADY: '0', ...flags },
    });
    const output = result.stdout + result.stderr;
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(!output.includes(sentinel), `${name}: credential leaked in runner output`);
    assert.ok(!JSON.stringify(calls).includes(sentinel), `${name}: credential leaked in command arguments`);
    return { result, output, calls, applied: calls.some(args => args.some(arg => arg.startsWith('INSERT INTO schema_migrations'))) };
  }
  const missing = run('missing', '');
  assert.equal(missing.result.status, 0);
  assert.match(missing.output, /Deferred .*LLUBAN_API_KEY is required/);
  assert.equal(missing.applied, false);
  assert.ok(!missing.calls.some(args => args.includes('-f')));

  const success = run('success', sentinel);
  assert.equal(success.result.status, 0);
  assert.equal(success.applied, true);
  assert.match(success.output, /applied=1/);

  const failure = run('failure', sentinel, { PATCH_FAIL: '1' });
  assert.equal(failure.result.status, 17);
  assert.equal(failure.applied, false);
  assert.match(failure.output, /psql exit 17; migration not recorded/);

  const repeated = run('repeated', sentinel, { PATCH_ALREADY: '1' });
  assert.equal(repeated.result.status, 0);
  assert.equal(repeated.applied, false);
  assert.ok(!repeated.calls.some(args => args.includes('-f')));
  assert.match(repeated.output, /skipped\(already-applied\)=1/);
  console.log('Lluban patch runner: missing key, apply, failure, repeat, and secret isolation passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
