import 'reflect-metadata';
import assert from 'node:assert/strict';
import { XiaotAgentService } from './xiaot-agent.service';

async function main() {
  const originalFetch = globalThis.fetch;
  let legacyCharges = 0;
  const orders: any[] = [];
  const outputStatuses: string[] = [];
  const emitted: any[] = [];
  let requests = 0;
  const coordinator = {
    isGatewayEnabled: () => true,
    begin: async (input: any) => { orders.push(input); return { apiUsageId: input.identity, gatewayMode: true, duplicate: false }; },
    gatewayHeaders: async (charge: any, request: any) => {
      assert.equal(JSON.parse(request.rawBody).model, 'xiaot-agent-deepseek-v4-flash');
      return { 'X-Tanva-Order-Id': charge.apiUsageId, 'X-Tanva-Signature': 'test' };
    },
    gatewayOutput: async (_charge: any, _output: any, status: string) => {
      outputStatuses.push(status); return { enabled: true, status: 'pending' };
    },
  };
  const service = new XiaotAgentService({ get: () => undefined } as any,
    { deductExact: async () => { legacyCharges++; } } as any, {} as any, coordinator as any);
  globalThis.fetch = async (_url, init) => {
    requests++;
    assert.equal((init?.headers as any)['X-Tanva-Order-Id'], `stable-run:${requests - 1}`);
    const delta = requests < 3 ? { tool_calls: [{ index: 0, id: `query-${requests}`,
      function: { name: 'host_tool', arguments: JSON.stringify({ name: 'query_canvas', arguments: { scope: 'all' } }) } }] }
      : { content: '真实完成正文' };
    const frame = { choices: [{ delta, finish_reason: requests < 3 ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 100000, total_tokens: 100000 } };
    return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
  };
  try {
    await service.run({ prompt: '读取画布', sessionId: 'session', mode: 'canvasAgent', canvasContext: { nodes: [], edges: [] } },
      'user-test', (type, payload) => emitted.push({ type, ...payload }), undefined, undefined, undefined, 'stable-run');
    assert.equal(requests, 3);
    assert.deepEqual(orders.map(order => order.identity), ['stable-run:0', 'stable-run:1', 'stable-run:2']);
    assert.deepEqual(outputStatuses, ['ready', 'ready', 'ready']);
    assert.equal(legacyCharges, 0, 'gateway mode must not double-charge legacy two credits');
    const final = emitted.find(event => event.type === 'final');
    assert.equal(final.data.text, '真实完成正文');
    assert.equal(final.data.billingOrders.length, 3, 'pending consumption cannot discard successful output');
    assert.ok(final.data.billingOrders.every((bill: any) => bill.basis === 'gateway_fixed_price'));
    console.log('Xiaot physical orders, pending output and legacy charge exclusion: passed');
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
