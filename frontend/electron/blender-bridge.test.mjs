import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const bridge = join(dirname(fileURLToPath(import.meta.url)), '..', 'desktop-bundle', 'Settings', 'Skills', 'blender-mcp', 'blender_bridge.py');
const run = (requests) => new Promise((resolve, reject) => {
  const child = spawn('python3', [bridge], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let error = '';
  child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { error += chunk; });
  child.on('error', reject); child.on('close', (code) => code === 0 ? resolve({ lines: output.trim().split('\n').filter(Boolean).map(JSON.parse), error }) : reject(new Error(`bridge exited ${code}: ${error}`)));
  child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');
});

test('Blender bridge exposes MCP tools and creates a mesh without evaluating scripts', async () => {
  const outputPath = join(tmpdir(), `tanva-bridge-${Date.now()}.glb`);
  const result = await run([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_mesh', arguments: { mesh: { name: 'triangle', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] } } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_floor_plan_meshes', arguments: { height: 3, rooms: [{ id: 'living', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }] } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'export_glb', arguments: { outputPath } } },
  ]);
  assert.equal(result.lines[0].result.tools.some((tool) => tool.name === 'export_glb'), true);
  const created = JSON.parse(result.lines[1].result.content[0].text);
  assert.equal(created.vertexCount, 3); assert.equal(created.faceCount, 1);
  const room = JSON.parse(result.lines[2].result.content[0].text);
  assert.equal(room.roomCount, 1); assert.equal(room.objectIds.length, 1);
  const exported = JSON.parse(result.lines[3].result.content[0].text);
  assert.equal(exported.engine, 'tanva-glb-writer');
  assert.equal((await readFile(outputPath)).subarray(0, 4).toString('ascii'), 'glTF');
  await rm(outputPath, { force: true });
});
