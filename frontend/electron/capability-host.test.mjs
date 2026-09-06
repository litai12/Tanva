import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DesktopCapabilityHost,
  validateHttpServerConfig,
  validateStdioServerConfig,
  validateToolArguments,
} from './capability-host.mjs';

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

test('HTTP MCP config only permits secure or loopback endpoints', () => {
  assert.equal(
    validateHttpServerConfig({ type: 'streamable-http', url: 'http://127.0.0.1:8765/mcp' }).type,
    'streamable-http'
  );
  assert.equal(
    validateHttpServerConfig({ type: 'sse', url: 'https://mcp.example.test/sse' }).type,
    'sse'
  );
  assert.throws(
    () => validateHttpServerConfig({ url: 'http://mcp.example.test/mcp' }),
    /HTTPS|localhost/
  );
  assert.throws(
    () => validateHttpServerConfig({ url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer secret' } }),
    /不能内含密钥/
  );
});

test('tool arguments are checked against the MCP input schema before execution', () => {
  const schema = {
    type: 'object',
    required: ['name', 'count'],
    properties: {
      name: { type: 'string' },
      count: { type: 'integer', enum: [1, 2, 3] },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };
  assert.deepEqual(
    validateToolArguments(schema, { name: 'wall', count: 2, tags: ['north'] }),
    { name: 'wall', count: 2, tags: ['north'] }
  );
  assert.throws(() => validateToolArguments(schema, { count: 2 }), /name.*必填/);
  assert.throws(() => validateToolArguments(schema, { name: 'wall', count: 4 }), /枚举/);
  assert.throws(() => validateToolArguments(schema, { name: 'wall', count: 2, tags: [1] }), /tags\[0\].*string/);
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
