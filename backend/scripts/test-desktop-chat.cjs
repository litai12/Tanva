// Self-contained real-PostgreSQL billing regression. Creates/removes only its
// own ephemeral container; no production datasource or paid API is accessed.
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const backend = path.resolve(__dirname, '..');
const name = `tanva-desktop-chat-test-${randomUUID().slice(0, 8)}`;
function run(command, args, env = process.env, quiet = false) {
  const result = spawnSync(command, args, { cwd: backend, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (!quiet) { process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return (result.stdout || '').trim();
}
async function main() {
  let created = false;
  try {
    run('docker', ['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=local-only-test', '-e', 'POSTGRES_DB=desktop_chat_test', '-p', '127.0.0.1::5432', 'postgres:16-alpine'], process.env, true);
    created = true;
    const endpoint = run('docker', ['port', name, '5432'], process.env, true);
    if (!/^127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('Refusing non-local PostgreSQL endpoint');
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const result = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'desktop_chat_test'], { encoding: 'utf8' });
      if (result.status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
    const url = `postgresql://postgres:local-only-test@${endpoint}/desktop_chat_test`;
    const env = { ...process.env, DATABASE_URL: url, DESKTOP_CHAT_TEST_DATABASE_URL: url };
    console.log('Testing actual schema/services against an isolated local PostgreSQL 16 container. Model HTTP uses fixtures only.');
    run(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], env);
    run(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], env, true);
    run(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/desktop-chat/deepseek-pricing.spec.ts'], env);
    run(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/desktop-chat/desktop-chat.spec.ts'], env);
  } finally {
    if (created) run('docker', ['rm', '-f', name], process.env, true);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
