import 'reflect-metadata';
import assert from 'node:assert/strict';
import { XiaotAgentService } from './xiaot-agent.service';

const originalFetch = globalThis.fetch;
const events: string[] = [];
const requests: Record<string, unknown>[] = [];
let charges = 0;
const service = new XiaotAgentService(
  { get: (key: string) => key === 'NEW_API_BASE_URL' ? 'https://example.test' : undefined } as never,
  { deductExact: async () => { charges += 1; } } as never,
  {} as never,
);
function stream(value: unknown): Response {
  return new Response(`data: ${JSON.stringify(value)}\n\ndata: [DONE]\n\n`);
}
async function run() {
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    if (requests.length <= 3) {
      return stream({ choices: [{ delta: { tool_calls: [0, 1, 2, 3].map((index) => ({
        index, id: `query-${index}`, function: { name: 'host_tool', arguments: JSON.stringify({
          name: 'query_canvas', arguments: { scope: 'ids', nodeIds: [`node-${index}`] },
        }) },
      })) }, finish_reason: 'tool_calls' }] });
    }
    return stream({ choices: [{ delta: { content: '已读取四个节点的真实内容。' }, finish_reason: 'stop' }] });
  }) as typeof fetch;
  await service.run({
    prompt: '读取这些节点', sessionId: 'context-test', mode: 'canvasAgent',
    capabilityManifest: { protocol_version: '1.1', host: 'Tanva', nodeSpecs: [], ui: ['request_user_input'] },
    canvasContext: { nodes: [0, 1, 2, 3].map((i) => ({ id: `node-${i}`, type: 'textPrompt', data: { text: `内容-${i}` } })), edges: [] },
  }, 'user-1', (type) => events.push(type));
  assert.equal(requests.length, 4);
  for (const body of requests) {
    const messages = body.messages as Array<{ role: string; content: string }>;
    assert.ok(messages.some((m) => m.content.includes('<capability_manifest>')));
    assert.ok(messages.some((m) => m.content.includes('<canvas_context>')));
  }
  for (const body of requests.slice(1)) {
    assert.match(JSON.stringify(body.messages), /内容-3/, 'must not discard the fourth query');
  }
  assert.equal(charges, 1);
  assert.equal(events.filter((type) => type === 'step_completed').length, 3);
  assert.equal(events.at(-1), 'done');
  console.log('context handoff regression passed');
}
void run().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { globalThis.fetch = originalFetch; });
