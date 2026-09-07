import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Apply only to the pinned production images in this directory's Dockerfiles.
// All replacements are checked before any output is written.
export function patchAgent(source) {
  const before = 'disposition: exhausted ? "waiting_for_evidence" : "repair_required"';
  assert.equal(source.split(before).length - 1, 1, 'unexpected agent interruption implementation');
  return source.replace(before, 'disposition: exhausted ? "replan_required" : "repair_required"');
}

export function locateSuspensionReader(source) {
  const candidates = [...source.matchAll(/function (\w+)\((\w+)\)\{/g)]
    .map(match => {
      const end = source.indexOf('function ', match.index + match[0].length);
      return { index: match.index, name: match[1], argument: match[2], text: source.slice(match.index, end) };
    })
    .filter(candidate => candidate.text.length < 2500 &&
      candidate.text.includes('nextTrigger==="durable_resume"') &&
      candidate.text.includes('?.suspension') && candidate.text.includes('physicalRunId'));
  assert.equal(candidates.length, 1, 'unexpected durable suspension reader implementation');
  return candidates[0];
}

export function patchApi(source) {
  const reader = locateSuspensionReader(source);
  const opening = `function ${reader.name}(${reader.argument}){`;
  // The ticket remains the existing fallback when no valid physical checkpoint
  // exists. A real checkpoint must always win the resume identity fence.
  const guard = `const checkpoint=${reader.argument}?.runtime?.suspension;` +
    'if(checkpoint&&typeof checkpoint==="object"&&!Array.isArray(checkpoint)&&' +
    'typeof checkpoint.reasonCode==="string"&&checkpoint.reasonCode.trim()&&' +
    'typeof checkpoint.physicalRunId==="string"&&checkpoint.physicalRunId.trim()&&' +
    'Number.isInteger(checkpoint.progressRevision)&&checkpoint.progressRevision>=0)' +
    'return{reasonCode:checkpoint.reasonCode.trim(),physicalRunId:checkpoint.physicalRunId.trim(),progressRevision:checkpoint.progressRevision};';
  assert.ok(!reader.text.includes('const checkpoint='), 'patch is already applied');
  return source.slice(0, reader.index) + reader.text.replace(opening, opening + guard) +
    source.slice(reader.index + reader.text.length);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, ...files] = process.argv.slice(2);
  assert.ok(kind === 'agent' || kind === 'api');
  assert.ok(files.length > 0);
  const outputs = files.map(file => ({ file, output: (kind === 'agent' ? patchAgent : patchApi)(fs.readFileSync(file, 'utf8')) }));
  for (const { file, output } of outputs) fs.writeFileSync(file, output);
  console.log(`Patched ${outputs.length} ${kind} runtime file(s)`);
}
