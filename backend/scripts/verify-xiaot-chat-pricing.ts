import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import type { CreditsService } from '../src/credits/credits.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  XIAOT_CHAT_CREDITS_PER_RUN,
  XiaotAgentService,
} from '../src/agent/xiaot-agent.service';

type Charge = {
  userId: string;
  teamId: string | null | undefined;
  amount: number;
  meta: {
    serviceType: string;
    serviceName?: string;
    provider?: string;
    model?: string;
    requestParams?: Record<string, unknown>;
  };
};

const charges: Charge[] = [];
const requestedModels: unknown[] = [];
const originalFetch = globalThis.fetch;
let requestCount = 0;

const makeSseResponse = (usageUnits?: number): Response => {
  const frames = [
    `data: ${JSON.stringify({
      choices: [{ delta: { content: '已完成' } }],
    })}\n\n`,
  ];
  if (usageUnits !== undefined) {
    frames.push(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { total_tokens: usageUnits },
      })}\n\n`,
    );
  } else {
    frames.push(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
      })}\n\n`,
    );
  }
  frames.push('data: [DONE]\n\n');
  return new Response(frames.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

globalThis.fetch = async (_input, init) => {
  requestCount += 1;
  const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  requestedModels.push(body.model);
  return requestCount === 1 ? makeSseResponse(4_867) : makeSseResponse();
};

async function main(): Promise<void> {
  const creditsService = {
    deductExact: async (
      userId: string,
      teamId: string | null | undefined,
      amount: number,
      meta: Charge['meta'],
    ) => {
      charges.push({ userId, teamId, amount, meta });
      return {
        success: true,
        newBalance: 998,
        apiUsageId: `usage-${charges.length}`,
        transactionId: `transaction-${charges.length}`,
        creditsCharged: amount,
      };
    },
  } as unknown as CreditsService;
  const prisma = {} as PrismaService;
  const service = new XiaotAgentService(
    new ConfigService({
      NEW_API_BASE_URL: 'https://new-api.test',
      NEW_API_KEY: 'test-key',
    }),
    creditsService,
    prisma,
  );

  await service.run(
    {
      prompt: '创建一个生图节点',
      mode: 'canvasAgent',
      model: 'xiaot-agent-deepseek-v4-flash',
    },
    'user-1',
    () => undefined,
  );
  await service.run(
    {
      prompt: '只回复一句话',
      mode: 'canvasAgent',
      model: 'xiaot-agent-gpt-5-6-terra',
    },
    'user-1',
    () => undefined,
  );
  await service.run(
    { prompt: '默认模型回复一句话', mode: 'canvasAgent' },
    'user-1',
    () => undefined,
  );

  assert.equal(XIAOT_CHAT_CREDITS_PER_RUN, 2);
  assert.equal(
    requestedModels[0],
    'xiaot-agent-deepseek-v4-flash',
    'DeepSeek V4 Flash 必须通过小T专属门面名转发',
  );
  assert.equal(
    requestedModels[1],
    'xiaot-agent-gpt-5-6-terra',
    'Terra 必须通过小T专属门面名转发',
  );
  assert.equal(
    requestedModels[2],
    'xiaot-agent-gpt-5-6-luna',
    '未指定模型时必须回落到小T-5.6 Luna',
  );
  assert.equal(charges.length, 3);
  assert.deepEqual(
    charges.map((charge) => charge.amount),
    [2, 2, 2],
    '有大额 usage 和无 usage 的成功对话都必须只扣 2 积分',
  );
  assert.equal(charges[0]?.meta.serviceType, 'agent-chat');
  assert.equal(charges[0]?.meta.serviceName, 'xiaot-agent');
  assert.equal(charges[0]?.meta.requestParams?.billingMode, 'fixed_per_completed_run');
  assert.equal(charges[0]?.meta.requestParams?.chatCredits, 2);
  assert.equal(
    charges[0]?.meta.requestParams?.usageUnits,
    4_867,
    '上游 usage 只应留作审计字段',
  );
  assert.equal(charges[1]?.meta.requestParams?.usageUnits, 0);
  assert.equal(charges[2]?.meta.requestParams?.usageUnits, 0);

  console.log('xiaot fixed 2-credit chat pricing verification passed');
}

main()
  .finally(() => {
    globalThis.fetch = originalFetch;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
