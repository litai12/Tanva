import 'reflect-metadata';
import assert from 'node:assert/strict';
import { XiaotAgentService } from './xiaot-agent.service';

const suspensionReasons = [
  'host_execution_required',
  'root_physical_execution_budget_exhausted',
] as const;

async function verifyHandoff(reason: (typeof suspensionReasons)[number]) {
  const originalFetch = globalThis.fetch;
  const patch = {
    op: 'addNode',
    node: { id: `prompt-${reason}`, type: 'textPrompt', data: { text: '一只小猫' } },
  };
  const stream = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'flow_patch_0',
            type: 'function',
            function: { name: 'flow_patch', arguments: JSON.stringify(patch) },
          }],
        },
        finish_reason: null,
      }],
    })}`,
    `data: ${JSON.stringify({
      error: {
        message: reason,
        type: 'server_error',
        code: 'xiaot_turn_suspended',
        details: {
          requestTerminal: {
            version: 1,
            terminal: true,
            status: 'suspended',
            reason,
          },
        },
      },
    })}`,
    'data: [DONE]',
    '',
  ].join('\n');

  globalThis.fetch = (async () => new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })) as typeof fetch;

  try {
    const charged: number[] = [];
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const service = new XiaotAgentService(
      {
        get: (key: string) => {
          if (key === 'NEW_API_BASE_URL') return 'https://gateway.example.com';
          if (key === 'NEW_API_KEY') return 'test-key';
          return undefined;
        },
      } as any,
      {
        deductExact: async (_userId: string, _teamId: null, credits: number) => {
          charged.push(credits);
        },
      } as any,
      {} as any,
    );

    await service.run(
      {
        sessionId: `desktop-${reason}`,
        prompt: '生成一只小猫',
        mode: 'canvasAgent',
        model: 'xiaot-agent-gpt-5-6-luna',
      } as any,
      'user-1',
      (type, payload) => events.push({ type, payload }),
    );

    const patchEvent = events.find((event) => event.type === 'flow_patch');
    assert.deepEqual(patchEvent?.payload.data, { patch });
    assert.ok(events.some((event) => event.type === 'final'));
    assert.equal(events.at(-1)?.type, 'done');
    assert.deepEqual(charged, [2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function run() {
  for (const reason of suspensionReasons) {
    await verifyHandoff(reason);
  }
  console.log('xiaot agent host handoff verification passed');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
