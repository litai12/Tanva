import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { CreditsService } from '../credits/credits.service';
import { PrismaService } from '../prisma/prisma.service';
import { XIAOT_CHAT_MODELS, XiaotAgentService } from './xiaot-agent.service';

async function run() {
  const requestedModels: string[] = [];
  const chargedModels: string[] = [];
  const originalFetch = globalThis.fetch;
  let fail = false;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}')) as { model: string };
    requestedModels.push(body.model);
    if (fail) return new Response(JSON.stringify({ error: { code: 'team_insufficient_credits' } }), { status: 402 });
    return new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: '收到' }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]', '',
    ].join('\n'), { status: 200 });
  }) as typeof fetch;
  try {
    const service = new XiaotAgentService(
      new ConfigService({ NEW_API_BASE_URL: 'https://gateway.example.com', NEW_API_KEY: 'test-key', XIAOT_AGENT_MODEL: 'xiaot-agent-gpt-5-6-luna' }),
      { deductExact: async (_userId: string, _teamId: null, _credits: number, input: { model: string }) => { chargedModels.push(input.model); } } as unknown as CreditsService,
      {} as PrismaService,
    );
    assert.deepEqual(XIAOT_CHAT_MODELS, ['xiaot-agent-deepseek-v4-flash']);
    for (const model of [undefined, 'xiaot-agent-gpt-5-6-luna', 'xiaot-agent-gpt-5-6-terra', 'deepseek-v4-flash', 'xiaot-agent-deepseek-v4-flash']) {
      await service.run({ sessionId: 'desktop-session', prompt: '画布里有什么？', mode: 'canvasAgent', model }, 'user-1', () => undefined);
      assert.equal(requestedModels.at(-1), 'xiaot-agent-deepseek-v4-flash');
      assert.equal(chargedModels.at(-1), 'xiaot-agent-deepseek-v4-flash');
    }
    fail = true;
    const count = requestedModels.length;
    await assert.rejects(service.run({ prompt: '生成小猫视频', mode: 'canvasAgent' }, 'user-1', () => undefined), /status=402/);
    assert.equal(requestedModels.length, count + 1, 'failed route must not submit another model');
    assert.equal(chargedModels.length, count, 'failed route must not settle credits');
    console.log('xiaot fixed DeepSeek routing and no-GPT-fallback verification passed');
  } finally { globalThis.fetch = originalFetch; }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
