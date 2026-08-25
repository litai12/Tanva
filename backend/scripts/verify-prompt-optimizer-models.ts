import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_PROMPT_OPTIMIZATION_MODEL,
  PROMPT_OPTIMIZATION_GATEWAY_MODELS,
  PROMPT_OPTIMIZATION_MODELS,
  resolvePromptOptimizationGatewayModel,
  resolvePromptOptimizationModel,
} from '../src/ai/prompt-optimization-models';
import { NewApiProvider } from '../src/ai/providers/new-api.provider';

const originalFetch = globalThis.fetch;
const requestedModels: unknown[] = [];

globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
  requestedModels.push(body.model);
  assert.equal(body.stream, false);
  assert.equal(body.mode, undefined);
  assert.equal(body.executionToolPolicy, undefined);
  assert.equal(body.user, undefined);
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${String(body.model)}`,
      choices: [
        { message: { role: 'assistant', content: 'optimized' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

async function main(): Promise<void> {
  assert.deepEqual(PROMPT_OPTIMIZATION_MODELS, [
    'gpt-5.6-luna',
    'gpt-5.6-terra',
  ]);
  assert.equal(DEFAULT_PROMPT_OPTIMIZATION_MODEL, 'gpt-5.6-terra');
  assert.equal(resolvePromptOptimizationModel('gpt-5.4'), 'gpt-5.6-terra');
  assert.equal(resolvePromptOptimizationModel('GPT-5.6-TERRA'), 'gpt-5.6-terra');
  assert.equal(resolvePromptOptimizationModel('deepseek-v4-flash'), 'gpt-5.6-terra');
  assert.equal(
    resolvePromptOptimizationGatewayModel('gpt-5.4'),
    'tanvas-right-gpt-5.6-terra',
  );

  const provider = new NewApiProvider(
    new ConfigService({
      NEW_API_BASE_URL: 'https://new-api.test',
      NEW_API_KEY: 'test-key',
    }),
  );
  await provider.initialize();

  for (const model of PROMPT_OPTIMIZATION_MODELS) {
    const result = await provider.generateText({
      prompt: '优化这段提示词',
      model: resolvePromptOptimizationGatewayModel(model),
    });
    assert.equal(result.success, true);
  }

  assert.deepEqual(
    requestedModels,
    PROMPT_OPTIMIZATION_MODELS.map(
      (model) => PROMPT_OPTIMIZATION_GATEWAY_MODELS[model],
    ),
  );
  console.log('prompt optimizer verified direct Right routing passed');
}

main()
  .finally(() => {
    globalThis.fetch = originalFetch;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
