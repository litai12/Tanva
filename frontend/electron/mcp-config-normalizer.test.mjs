import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReferenceMcpServer, parseJsonDocument, selectMcpServer } from './mcp-config-normalizer.mjs';

test('parses UTF-8 BOM JSON emitted by the reference app', () => {
  assert.deepEqual(parseJsonDocument('\uFEFF{"MCP":{"Servers":[]}}'), { MCP: { Servers: [] } });
});

test('reads a reference appsettings MCP.Servers entry', () => {
  const selected = selectMcpServer({
    MCP: {
      Servers: [
        { Name: 'GrasshopperMCP', Type: 'sse', Endpoint: 'http://127.0.0.1:26929/mcp', Enabled: true },
      ],
    },
  }, 'grasshopper');
  assert.deepEqual(selected, {
    type: 'sse',
    url: 'http://127.0.0.1:26929/mcp',
    headers: undefined,
  });
});

test('normalizes reference stdio launcher fields and matches MCP suffixes', () => {
  const selected = selectMcpServer({
    MCP: {
      Servers: [
        {
          Name: 'AutoCADMCP',
          Type: 'stdio',
          Command: '{PythonExe}',
          Args: ['{BaseDir}Settings\\Skills\\AutoCADMCP\\cad_mcp_launcher.py'],
          Cwd: '{BaseDir}Settings\\Skills\\AutoCADMCP',
          Env: { NO_COLOR: '1' },
        },
      ],
    },
  }, 'autocad');
  assert.deepEqual(selected, {
    type: 'stdio',
    command: '{PythonExe}',
    args: ['{BaseDir}Settings\\Skills\\AutoCADMCP\\cad_mcp_launcher.py'],
    cwd: '{BaseDir}Settings\\Skills\\AutoCADMCP',
    env: { NO_COLOR: '1' },
  });
});

test('keeps standard mcpServers JSON compatible', () => {
  const config = { type: 'streamable-http', url: 'https://example.invalid/mcp' };
  assert.deepEqual(selectMcpServer({ mcpServers: { RevitMCP: config } }, 'revit'), config);
  assert.deepEqual(normalizeReferenceMcpServer(config), {
    type: 'streamable-http',
    url: 'https://example.invalid/mcp',
    headers: undefined,
  });
});
