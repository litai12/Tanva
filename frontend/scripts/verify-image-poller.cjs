const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/utils/imageTaskPoller.ts'), 'utf8').replaceAll('import.meta.env', '({})');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(setImmediate);
async function check(status, cancelled) {
  let now = 0, settled = false, cancelCalls = 0;
  const timers = [];
  const exports = {};
  const context = {
    exports, Date: { now: () => now },
    setTimeout: (fn) => timers.push(fn),
    require: (name) => {
      assert.equal(name, '@/services/authFetch');
      return { fetchWithAuth: async (_, init) => {
        if (init.method === 'POST') { cancelCalls++; return { ok: cancelled, json: async () => ({ cancelled }) }; }
        return { ok: true, json: async () => ({ status }) };
      } };
    },
  };
  vm.runInNewContext(code, context);
  exports.waitForTask('task', 100, 'node').then(() => { settled = true; }, () => { settled = true; });
  await flush();
  now = 60 * 60 * 1000;
  timers.shift()();
  await flush();
  assert.equal(settled, status === 'queued' && cancelled);
  assert.equal(cancelCalls, status === 'queued' ? 1 : 0);
  exports.cancelTask('task');
}
(async () => {
  await check('processing', false);
  await check('queued', false);
  await check('queued', true);
  console.log('image polling terminal safety: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
