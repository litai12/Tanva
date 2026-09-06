import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { getBundledMcpConfig, isBundledMcpConfigAvailable } from './desktop-mcp-templates.mjs';

test('builds a reference SketchUp stdio template when bundled files exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-mcp-'));
  try {
    const python = join(root, 'Settings', 'IsolatedPython', 'python3');
    const bridge = join(root, 'Settings', 'Skills', 'SketchUpMCP', 'stdio_bridge.py');
    await mkdir(join(root, 'Settings', 'IsolatedPython'), { recursive: true });
    await mkdir(join(root, 'Settings', 'Skills', 'SketchUpMCP'), { recursive: true });
    await writeFile(python, 'fixture');
    await writeFile(bridge, 'fixture');
    const config = getBundledMcpConfig('sketchup', { baseDir: root, pythonExe: python, nodeExe: '' }, 'darwin');
    assert.equal(config.type, 'stdio');
    assert.equal(config.command, python);
    assert.equal(config.args[0], bridge);
    assert.equal(isBundledMcpConfigAvailable(config), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps HTTP Grasshopper as an explicit endpoint and does not mark it bundled', () => {
  const config = getBundledMcpConfig('grasshopper', { baseDir: '/bundle', pythonExe: '', nodeExe: '' }, 'win32');
  assert.deepEqual(config, { type: 'sse', url: 'http://127.0.0.1:26929/mcp' });
  assert.equal(isBundledMcpConfigAvailable(config), false);
});

test('does not advertise Windows executables as usable on macOS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-mcp-'));
  try {
    const command = join(root, 'python.exe');
    const bridge = join(root, 'stdio_bridge.py');
    await writeFile(command, 'fixture');
    await writeFile(bridge, 'fixture');
    assert.equal(isBundledMcpConfigAvailable({
      type: 'stdio',
      command,
      args: [bridge],
    }, 'darwin'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('passes the reference Windows launcher serve command', () => {
  const config = getBundledMcpConfig('windows', {
    baseDir: '/bundle',
    pythonExe: 'C:/bundle/Settings/IsolatedPython/python.exe',
    nodeExe: '',
  }, 'win32');
  assert.deepEqual(config.args.slice(-1), ['serve']);
});
