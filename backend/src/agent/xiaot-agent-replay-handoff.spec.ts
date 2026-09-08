import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { XiaotAgentService } from './xiaot-agent.service';
import { isXiaotDeferredReplayFrame, replayXiaotTurn } from './xiaot-agent-recovery';

const hostResult = {
  response: {
    text: '',
    trace: {
      requestTerminal: { status: 'suspended', reason: 'host_execution_required' },
      continuationRegistration: {
        status: 'external_handoff', effectOwner: 'host_execution',
        ticketId: 'ticket-1', commandCount: 1, runNodeCount: 0,
      },
    },
  },
};
const frame = (event: string, id: string, data: unknown) =>
  `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

async function run() {
  assert.equal(isXiaotDeferredReplayFrame({ event: 'result', id: 'turn#2', data: hostResult }), false);
  assert.equal(isXiaotDeferredReplayFrame({ event: 'result', id: 'turn#2', data: {
    response: { trace: { requestTerminal: { status: 'suspended' }, continuationRegistration: { status: 'registered' } } },
  } }), true, 'server-owned continuation must keep waiting');
  assert.equal(isXiaotDeferredReplayFrame({ event: 'result', id: 'turn#2', data: {
    response: { trace: { ...hostResult.response.trace, continuationRegistration: {
      ...hostResult.response.trace.continuationRegistration, commandCount: 0,
    } } },
  } }), true, 'an empty handoff cannot claim ownership');

  const originalFetch = globalThis.fetch;
  let submits = 0;
  let replays = 0;
  let cancellations = 0;
  let charges = 0;
  const events: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith('/v1/chat/completions')) {
      submits++;
      if (submits === 1) return new Response('data: {"id":"chatcmpl-turn-1","choices":[]}\n\n');
      const body = JSON.parse(String(init?.body));
      assert.match(JSON.stringify(body.messages), /host_tool_results/);
      assert.match(JSON.stringify(body.messages), /capability_manifest/);
      assert.match(JSON.stringify(body.messages), /canvas_context/);
      assert.match(JSON.stringify(body.messages), /真实节点内容/);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已读取真实节点内容"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        },
        cancel() { cancellations++; },
      }));
    }
    replays++;
    assert.equal(replays, 1, 'host handoff must not reconnect waiting for itself');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.turnId, 'turn-1');
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          frame('tool', 'turn-1#1', { toolName: 'host_tool', toolCallId: 'q-1', status: 'succeeded',
            input: { name: 'query_canvas', arguments: { scope: 'ids', nodeIds: ['n-1'] } } }) +
          frame('result', 'turn-1#2', hostResult),
        ));
        // Deliberately no EOF: a terminal result must release this transport.
      },
      cancel() { cancellations++; },
    }));
  }) as typeof fetch;
  try {
    const service = new XiaotAgentService(
      new ConfigService({ NEW_API_BASE_URL: 'https://gateway.test', NEW_API_KEY: 'test', XIAOT_AGENT_TIMEOUT_MS: '2000' }),
      { deductExact: async () => { charges++; } } as never,
      {} as never,
    );
    await service.run({
      sessionId: 'handoff-test', prompt: '读取节点', mode: 'canvasAgent',
      capabilityManifest: { protocol_version: '1', host: 'tanva', nodeSpecs: [], patchOps: [] },
      canvasContext: { nodes: [{ id: 'n-1', type: 'textPrompt', data: { text: '真实节点内容' } }], edges: [] },
    }, 'user-test', (event) => events.push(event));
    assert.equal(submits, 2);
    assert.equal(charges, 1);
    assert.equal(cancellations, 2, 'both replay and live terminal streams must be released');
    assert.equal(events.at(-1), 'done');
  } finally { globalThis.fetch = originalFetch; }

  let connections = 0;
  let canceled = 0;
  await replayXiaotTurn({
    gatewayBaseUrl: 'https://gateway.test', apiKey: 'test', sessionKey: 'host:test', turnId: 'turn',
    signal: AbortSignal.timeout(2000), replayResyncDelayMs: 0, onFrame: () => {},
    fetchImpl: async () => {
      connections++;
      const data = connections === 1
        ? frame('resync', 'turn#1', { publicTurnId: 'turn', latestEventId: 'turn#1', recovery: { kind: 'status_reconcile', referenceId: 'turn' } })
        : frame('done', 'turn#2', {});
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(data)); },
        cancel() { canceled++; },
      }));
    },
  });
  assert.equal(connections, 2, 'resync must advance even when the old connection stays open');
  assert.equal(canceled, 2);
  console.log('replayed host handoff, context continuation, single settlement and SSE cleanup: passed');
}
void run().catch((error) => { console.error(error); process.exitCode = 1; });
