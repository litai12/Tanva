import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const upstreamRoot = process.argv[2];
assert.ok(upstreamRoot, 'pass the local TapCanvas source directory');
const source = fs.readFileSync(path.join(upstreamRoot, 'apps/hono-api/src/modules/task/public-agents-chat.ts'), 'utf8');
const start = source.indexOf('export function readRootPhysicalContinuationSuspension(');
assert.ok(start >= 0);
const end = source.indexOf('\n/**\n * A physical continuation', start);
assert.ok(end > start);
const js = ts.transpileModule(source.slice(start, end).replace('export function', 'function'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const read = vm.runInNewContext(`${js};readRootPhysicalContinuationSuspension`, {
  readRecord: value => value && typeof value === 'object' && !Array.isArray(value) ? value : null,
});
const physicalRunExit = { version: 1, kind: 'replan', continuationTicket: {
  version: 1, ticketId: 'logical-ticket', taskRevision: 8,
  reasonCode: 'provider_stream_interrupted', nextTrigger: 'durable_resume',
} };
const suspension = { physicalRunId: 'actual-physical-run', progressRevision: 3, reasonCode: 'provider_stream_interrupted' };
assert.equal(read({ runtime: { physicalRunExit, suspension } }).physicalRunId, 'actual-physical-run');
assert.equal(read({ runtime: { physicalRunExit, suspension } }).progressRevision, 3);
assert.equal(read({ runtime: { physicalRunExit } }).physicalRunId, 'logical-ticket');
assert.equal(read({ runtime: { suspension } }).physicalRunId, 'actual-physical-run');
assert.equal(read({ runtime: { suspension: { ...suspension, progressRevision: -1 } } }), null);
assert.equal(read(null), null);
console.log('Local Hono source: 6 suspension identity assertions passed');
