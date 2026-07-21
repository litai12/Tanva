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
const originalTcApiKey = process.env.TC_API_KEY;
const originalTapCanvasApiKey = process.env.TAPCANVAS_API_KEY;

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

async function main(): Promise<void> {
  const provider = new NewApiProvider(
    new ConfigService({
      NEW_API_BASE_URL: 'https://new-api.test',
      NEW_API_KEY: 'new-api-key',
      TC_API_BASE_URL: 'https://tc-api.test',
      TC_API_KEY: 'tc-api-key',
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
  assert.equal(textResult.data?.metadata?.provider, 'tc-api');
  assert.equal(captured[0]?.url, 'https://tc-api.test/agents/llm/v1/chat/completions');
  assert.equal(captured[0]?.authorization, 'Bearer tc-api-key');
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
  assert.equal(captured[1]?.body.model, 'gpt-5.6');
  assert.equal(captured[1]?.url, 'https://tc-api.test/agents/llm/v1/chat/completions');

  const legacyResult = await provider.generateText({
    prompt: 'legacy route remains isolated',
    model: 'gemini-3.1-pro-preview',
  });
  assert.equal(legacyResult.success, true);
  assert.equal(captured[2]?.url, 'https://new-api.test/v1/chat/completions');
  assert.equal(captured[2]?.authorization, 'Bearer new-api-key');

  delete process.env.TC_API_KEY;
  delete process.env.TAPCANVAS_API_KEY;
  const missingKeyProvider = new NewApiProvider(
    new ConfigService({ NEW_API_KEY: 'new-api-key' }),
  );
  await missingKeyProvider.initialize();
  const missingKeyResult = await missingKeyProvider.generateText({ prompt: 'must fail' });
  assert.equal(missingKeyResult.success, false);
  assert.equal(missingKeyResult.error?.code, 'TC_API_TEXT_GENERATION_FAILED');
  assert.match(missingKeyResult.error?.message || '', /TC_API_KEY \/ TAPCANVAS_API_KEY/);

  console.log('tc-api GPT text routing verification passed');
}

main()
  .finally(() => {
    globalThis.fetch = originalFetch;
    if (originalTcApiKey === undefined) delete process.env.TC_API_KEY;
    else process.env.TC_API_KEY = originalTcApiKey;
    if (originalTapCanvasApiKey === undefined) delete process.env.TAPCANVAS_API_KEY;
    else process.env.TAPCANVAS_API_KEY = originalTapCanvasApiKey;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
