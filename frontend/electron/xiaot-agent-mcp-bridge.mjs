import readline from 'node:readline';

const endpoint = process.env.TANVA_XIAOT_AGENT_URL;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const error = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } });

async function callXiaot(params) {
  if (!endpoint) throw new Error('TANVA_XIAOT_AGENT_URL 未配置');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: params.input, context: params.context || {}, model: params.model }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`小T请求失败（${response.status}）`);
  const payload = await response.json();
  return { content: [{ type: 'text', text: typeof payload?.text === 'string' ? payload.text : JSON.stringify(payload) }] };
}

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params?.protocolVersion || '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'tanva-xiaot-agent', version: '1.0.0' } } });
  } else if (request.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'xiaot_agent', description: 'Ask the remote 小T agent when Codex needs creative or domain execution.', inputSchema: { type: 'object', required: ['input'], properties: { input: { type: 'string', minLength: 1, maxLength: 32_000 }, context: { type: 'object' }, model: { type: 'string' } } } }] } });
  } else if (request.method === 'tools/call' && request.params?.name === 'xiaot_agent') {
    try { send({ jsonrpc: '2.0', id: request.id, result: await callXiaot(request.params.arguments || {}) }); }
    catch (e) { error(request.id, e instanceof Error ? e.message : '小T调用失败'); }
  }
});
