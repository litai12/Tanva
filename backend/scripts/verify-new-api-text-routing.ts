import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from '../src/ai/providers/new-api.provider';

type CapturedRequest = {
  url: string;
  authorization: string | null;
  body: Record<string, unknown>;
};

const captured: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;
const originalEnv = {
  NEW_API_BASE_URL: process.env.NEW_API_BASE_URL,
  NEW_API_KEY: process.env.NEW_API_KEY,
  NEW_API_TOKEN: process.env.NEW_API_TOKEN,
  TC_API_KEY: process.env.TC_API_KEY,
  TAPCANVAS_API_KEY: process.env.TAPCANVAS_API_KEY,
};

globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  captured.push({
    url: String(input),
    authorization: headers.get('authorization'),
    body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
  });
  return new Response(
    JSON.stringify({ choices: [{ message: { content: 'verified' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

const restoreEnv = (key: keyof typeof originalEnv): void => {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

async function main(): Promise<void> {
  process.env.NEW_API_BASE_URL = 'https://new-api.test';
  process.env.NEW_API_KEY = 'new-api-key';
  process.env.TC_API_KEY = 'must-not-be-used';
  process.env.TAPCANVAS_API_KEY = 'must-not-be-used';

  const provider = new NewApiProvider(
    new ConfigService({
      NEW_API_BASE_URL: 'https://new-api.test',
      NEW_API_KEY: 'new-api-key',
    }),
  );
  await provider.initialize();

  assert.equal(provider.isAvailable(), true);

  const textResult = await provider.generateText({
    prompt: 'find public sources',
    enableWebSearch: true,
    thinkingLevel: 'high',
    imageUrls: ['https://assets.test/reference.png'],
  });
  assert.equal(textResult.success, true);
  assert.equal(textResult.data?.metadata?.provider, 'new-api');
  assert.equal(captured[0]?.url, 'https://new-api.test/v1/chat/completions');
  assert.equal(captured[0]?.authorization, 'Bearer new-api-key');
  assert.equal(captured[0]?.body.model, 'gpt-5.4');
  assert.deepEqual(captured[0]?.body.tools, [{ type: 'web_search_preview' }]);
  assert.equal(captured[0]?.body.thinking_level, 'high');
  assert.deepEqual(
    (captured[0]?.body.messages as Array<{ content?: unknown }> | undefined)?.[0]?.content,
    [
      { type: 'text', text: 'find public sources' },
      { type: 'image_url', image_url: { url: 'https://assets.test/reference.png' } },
    ],
  );

  const analysisResult = await provider.analyzeImage({
    sourceImage: 'https://assets.test/source.png',
  });
  assert.equal(analysisResult.success, true);
  assert.equal(captured[1]?.body.model, 'gpt-5.6-luna');
  assert.equal(captured[1]?.url, 'https://new-api.test/v1/chat/completions');
  assert.equal(captured[1]?.authorization, 'Bearer new-api-key');

  const legacyResult = await provider.generateText({
    prompt: 'legacy model uses the same gateway',
    model: 'gemini-3.1-pro-preview',
  });
  assert.equal(legacyResult.success, true);
  assert.equal(captured[2]?.url, 'https://new-api.test/v1/chat/completions');
  assert.equal(captured[2]?.authorization, 'Bearer new-api-key');

  delete process.env.NEW_API_KEY;
  delete process.env.NEW_API_TOKEN;
  const missingKeyProvider = new NewApiProvider(new ConfigService({}));
  await missingKeyProvider.initialize();
  const missingKeyResult = await missingKeyProvider.generateText({ prompt: 'must fail' });
  assert.equal(missingKeyResult.success, false);
  assert.equal(missingKeyResult.error?.code, 'TEXT_GENERATION_FAILED');
  assert.match(missingKeyResult.error?.message || '', /NEW_API_KEY/);

  console.log('new-api GPT text routing verification passed');
}

main()
  .finally(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('NEW_API_BASE_URL');
    restoreEnv('NEW_API_KEY');
    restoreEnv('NEW_API_TOKEN');
    restoreEnv('TC_API_KEY');
    restoreEnv('TAPCANVAS_API_KEY');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
