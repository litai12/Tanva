import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  resolveDesktopRuntimePaths,
  resolveMcpConfigPlaceholders,
} from './desktop-runtime.mjs';

test('resolves reference package runtime executables from a bundle root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-runtime-'));
  try {
    const pythonName = process.platform === 'win32' ? 'python.exe' : 'python3';
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    await mkdir(join(root, 'Settings', 'IsolatedPython'), { recursive: true });
    await mkdir(join(root, 'Settings', 'IsolatedNode'), { recursive: true });
    await writeFile(join(root, 'Settings', 'IsolatedPython', pythonName), 'fixture');
    await writeFile(join(root, 'Settings', 'IsolatedNode', nodeName), 'fixture');

    const paths = resolveDesktopRuntimePaths({
      packaged: true,
      resourcesPath: root,
      frontendRoot: '/unused',
      env: {},
    });
    assert.equal(paths.baseDir, root);
    assert.equal(paths.pythonAvailable, true);
    assert.equal(paths.nodeAvailable, true);
    const resolved = resolveMcpConfigPlaceholders({
      type: 'stdio',
      command: '{PythonExe}',
      args: ['{BaseDir}Settings\\Skills\\AutoCADMCP\\cad_mcp_launcher.py'],
      cwd: '{BaseDir}Settings\\Skills\\AutoCADMCP',
    }, paths);
    assert.equal(resolved.command, join(root, 'Settings', 'IsolatedPython', pythonName));
    assert.equal(resolved.args[0], join(root, 'Settings', 'Skills', 'AutoCADMCP', 'cad_mcp_launcher.py'));
    assert.equal(resolved.cwd, join(root, 'Settings', 'Skills', 'AutoCADMCP'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not expand arbitrary environment placeholders', () => {
  const paths = { baseDir: '/bundle', pythonExe: '/bundle/python', nodeExe: '/bundle/node' };
  const config = resolveMcpConfigPlaceholders({ command: '{HOME}/evil', env: { TOKEN: '{NodeExe}' } }, paths);
  assert.equal(config.command, '{HOME}/evil');
  assert.equal(config.env.TOKEN, '/bundle/node');
});

test('uses the packaged desktop-bundle directory as BaseDir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-resources-'));
  try {
    const bundleRoot = join(root, 'desktop-bundle');
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    await mkdir(join(bundleRoot, 'Settings', 'IsolatedNode'), { recursive: true });
    await writeFile(join(bundleRoot, 'Settings', 'IsolatedNode', nodeName), 'fixture');
    const paths = resolveDesktopRuntimePaths({ packaged: true, resourcesPath: root, env: {} });
    assert.equal(paths.baseDir, bundleRoot);
    assert.equal(paths.nodeAvailable, true);
    assert.equal(paths.nodeExe, join(bundleRoot, 'Settings', 'IsolatedNode', nodeName));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolves Windows runtime names when packaging is evaluated off Windows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tanva-win-runtime-'));
  try {
    await mkdir(join(root, 'Settings', 'IsolatedPython'), { recursive: true });
    await mkdir(join(root, 'Settings', 'IsolatedNode'), { recursive: true });
    await writeFile(join(root, 'Settings', 'IsolatedPython', 'python.exe'), 'fixture');
    await writeFile(join(root, 'Settings', 'IsolatedNode', 'node.exe'), 'fixture');
    const paths = resolveDesktopRuntimePaths({
      packaged: true,
      resourcesPath: root,
      env: {},
      platform: 'win32',
    });
    assert.equal(paths.pythonExe, join(root, 'Settings', 'IsolatedPython', 'python.exe'));
    assert.equal(paths.nodeExe, join(root, 'Settings', 'IsolatedNode', 'node.exe'));
    assert.equal(paths.pythonAvailable, true);
    assert.equal(paths.nodeAvailable, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
