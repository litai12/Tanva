const { spawnSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const backend = path.resolve(__dirname, '..');
const name = `tanva-enterprise-test-${randomUUID().slice(0, 8)}`;
function run(command, args, env = process.env, quiet = false, input) { const result = spawnSync(command, args, { cwd: backend, env, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); if (!quiet) { process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); } if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed (${result.status})`); return (result.stdout || '').trim(); }
async function main() {
  let created = false;
  try {
    run('docker', ['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=local-only-test', '-e', 'POSTGRES_DB=enterprise_library_test', '-p', '127.0.0.1::5432', 'postgres:16-alpine'], process.env, true); created = true;
    const endpoint = run('docker', ['port', name, '5432'], process.env, true); if (!/^127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('Refusing non-local PostgreSQL endpoint');
    for (let attempt = 0; attempt < 50; attempt++) { if (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' }).status === 0) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    const url = `postgresql://postgres:local-only-test@${endpoint}/enterprise_library_test`, env = { ...process.env, DATABASE_URL: url, ENTERPRISE_LIBRARY_TEST_DATABASE_URL: url };
    run(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], env);
    const migration = readFileSync(path.join(backend, 'prisma/migrations/202610120001_enterprise_knowledge/migration.sql'), 'utf8');
    run('docker', ['exec', '-i', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'enterprise_library_test'], env, false, 'DROP TABLE "EnterpriseKnowledgeRevision"; DROP TABLE "EnterpriseKnowledgeDocument";\n' + migration);
    if (process.argv[2]) {
      const child = spawn(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/enterprise-library/enterprise-library.spec.ts'], { cwd: backend, env: { ...env, ENTERPRISE_LIBRARY_HTTP_FIXTURE_PATH: process.argv[2] }, stdio: 'inherit' });
      const terminate = () => child.kill('SIGTERM'); process.once('SIGTERM', terminate); process.once('SIGINT', terminate);
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Fixture backend exited ${code}`))); });
      process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', terminate);
    } else run(process.execPath, ['node_modules/ts-node/dist/bin.js', '--transpile-only', 'src/enterprise-library/enterprise-library.spec.ts'], env);
  } finally { if (created) run('docker', ['rm', '-f', name], process.env, true); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
