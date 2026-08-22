import readline from 'node:readline';

const lines = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

lines.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'tanva-test-server', version: '1.0.0' },
      },
    });
  } else if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'inspect_fixture',
            description: 'Read-only test tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      },
    });
  } else if (message.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text: `fixture:${message.params?.arguments?.value || 'ok'}` }],
      },
    });
  }
});
