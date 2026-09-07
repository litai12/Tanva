import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { locateSuspensionReader, patchApi } from './patch-runtime.mjs';

// Execute the actual bundled function without booting API listeners or DBs.
const files = process.argv.slice(2);
assert.ok(files.length > 0);
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const reader = locateSuspensionReader(source);
  const recordHelper = reader.text.match(/let \w+=(\w+)\(/)[1];
  const context = vm.createContext({ [recordHelper]: value =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : null });
  const read = vm.runInContext(`(${reader.text.slice(0, reader.text.lastIndexOf('}') + 1)})`, context);
  const ticket = { version: 1, ticketId: 'logical-ticket', taskRevision: 8, reasonCode: 'provider_stream_interrupted', nextTrigger: 'durable_resume' };
  const runtime = { physicalRunExit: { version: 1, kind: 'replan', continuationTicket: ticket },
    suspension: { physicalRunId: 'actual-physical-run', progressRevision: 3, reasonCode: 'provider_stream_interrupted' } };
  assert.equal(read({ runtime }).physicalRunId, 'actual-physical-run');
  assert.equal(read({ runtime }).progressRevision, 3);
  assert.equal(read({ runtime: { physicalRunExit: runtime.physicalRunExit } }).physicalRunId, 'logical-ticket');
  assert.equal(read(null), null);
  assert.equal(read({ runtime: { suspension: { ...runtime.suspension, progressRevision: -1 } } }), null);
  assert.equal(read({ runtime: { suspension: runtime.suspension } }).physicalRunId, 'actual-physical-run');
  assert.throws(() => patchApi(source), /already applied/);
  console.log(`${file}: 7 suspension identity assertions passed`);
}
