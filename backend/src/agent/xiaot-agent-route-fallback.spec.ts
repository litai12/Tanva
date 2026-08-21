import 'reflect-metadata';
import assert from 'node:assert/strict';
import { XiaotAgentService } from './xiaot-agent.service';

async function run() {
  const requestedModels: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    requestedModels.push(body.model);
    if (requestedModels.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'team_insufficient_credits',
            message: '积分不足，无法调用三方生成',
          },
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const stream = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: '收到' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as typeof fetch;

  try {
    const chargedModels: string[] = [];
    const service = new XiaotAgentService(
      {
        get: (key: string) => {
          if (key === 'NEW_API_BASE_URL') return 'https://gateway.example.com';
          if (key === 'NEW_API_KEY') return 'test-key';
          return undefined;
        },
      } as any,
      {
        deductExact: async (
          _userId: string,
          _teamId: null,
          _credits: number,
          input: { model: string },
        ) => {
          chargedModels.push(input.model);
        },
      } as any,
      {} as any,
    );
    const events: string[] = [];
    await service.run(
      {
        sessionId: 'desktop-session',
        prompt: '画布里有什么？',
        mode: 'canvasAgent',
        model: 'xiaot-agent-deepseek-v4-flash',
      } as any,
      'user-1',
      (type) => events.push(type),
    );

    assert.deepEqual(requestedModels, [
      'xiaot-agent-deepseek-v4-flash',
      'xiaot-agent-gpt-5-6-luna',
    ]);
    assert.deepEqual(chargedModels, ['xiaot-agent-gpt-5-6-luna']);
    assert.ok(events.includes('final'));
    assert.equal(events.at(-1), 'done');
    console.log('xiaot agent route fallback verification passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
