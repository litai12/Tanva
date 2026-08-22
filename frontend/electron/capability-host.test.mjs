import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DesktopCapabilityHost, validateStdioServerConfig } from './capability-host.mjs';

const fixture = fileURLToPath(new URL('./fixtures/mock-mcp-server.mjs', import.meta.url));

test('stdio config rejects PATH-resolved commands', () => {
  assert.throws(
    () => validateStdioServerConfig({ command: 'node', args: [] }),
    /绝对路径/
  );
  assert.throws(
    () => validateStdioServerConfig({ command: process.execPath, args: ['--api-key=secret'] }),
    /不能携带密钥/
  );
});

test('capability host connects, lists tools, and disconnects', async () => {
  const host = new DesktopCapabilityHost({ connectTimeoutMs: 5_000 });
  const status = await host.connect('test.connector', {
    command: process.execPath,
    args: [fixture],
    env: {},
  });
  assert.equal(status.transport, 'connected');
  assert.equal(status.toolCount, 1);
  assert.deepEqual(host.listTools('test.connector'), [
    {
      name: 'inspect_fixture',
      description: 'Read-only test tool',
      inputSchema: { type: 'object', properties: {} },
      risk: 'read',
    },
  ]);
  const call = await host.callTool('test.connector', 'inspect_fixture', { value: 'proof' });
  assert.equal(call.result.text, 'fixture:proof');
  assert.equal(call.result.isError, false);
  await host.disconnect('test.connector');
  assert.equal(host.getStatus('test.connector', true).transport, 'configured');
});
