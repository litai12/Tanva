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
  const requestUrl = String(input);
  if (requestUrl.startsWith('https://assets.test/')) {
    return new Response(Uint8Array.from([137, 80, 78, 71]), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '4',
      },
    });
  }
  const headers = new Headers(init?.headers);
  captured.push({
    url: requestUrl,
    authorization: headers.get('authorization'),
    body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
  });
  return new Response(
    JSON.stringify(
      requestUrl.endsWith('/v1/images/generations')
        ? { data: [{ url: 'https://assets.test/generated-gift-box.png' }] }
        : { choices: [{ message: { content: 'verified' } }] },
    ),
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
    model: 'gpt-5.6-luna',
    enableWebSearch: true,
    thinkingLevel: 'high',
    imageUrls: ['https://assets.test/reference.png'],
  });
  assert.equal(textResult.success, true);
  assert.equal(textResult.data?.metadata?.provider, 'new-api');
  assert.equal(captured[0]?.url, 'https://new-api.test/v1/responses');
  assert.equal(captured[0]?.authorization, 'Bearer new-api-key');
  assert.equal(captured[0]?.body.model, 'gpt-5.6-luna');
  assert.deepEqual(captured[0]?.body.tools, [{ type: 'web_search' }]);
  assert.deepEqual(captured[0]?.body.reasoning, { effort: 'high' });
  assert.deepEqual(
    (captured[0]?.body.input as Array<{ content?: unknown }> | undefined)?.[0]?.content,
    [
      { type: 'input_text', text: 'find public sources' },
      { type: 'input_image', image_url: 'https://assets.test/reference.png' },
    ],
  );

  const analysisResult = await provider.analyzeImage({
    sourceImage: 'https://assets.test/source.png',
  });
  assert.equal(analysisResult.success, true);
  assert.equal(captured[1]?.body.model, 'gemini-2.5-flash');
  assert.equal(captured[1]?.url, 'https://new-api.test/v1/chat/completions');
  assert.equal(captured[1]?.authorization, 'Bearer new-api-key');
  const analysisContent = (
    captured[1]?.body.messages as Array<{ content?: Array<Record<string, any>> }> | undefined
  )?.[0]?.content;
  assert.equal(
    String(analysisContent?.[1]?.image_url?.url || ''),
    'https://assets.test/source.png',
  );

  const legacyResult = await provider.generateText({
    prompt: 'legacy model uses the same gateway',
    model: 'gemini-3.1-pro-preview',
  });
  assert.equal(legacyResult.success, true);
  assert.equal(captured[2]?.url, 'https://new-api.test/v1/chat/completions');
  assert.equal(captured[2]?.authorization, 'Bearer new-api-key');

  const giftBoxResult = await provider.blendImages({
    prompt:
      '参考图1的构图和内容，给图2礼盒生成一张手提礼盒的展示图，背景是图2的类似红色渐变的感觉',
    sourceImages: [
      'https://assets.test/composition-reference.png',
      'https://assets.test/gift-box-reference.png',
    ],
    model: 'gpt-image-2',
    imageSize: '2K',
  });
  assert.equal(giftBoxResult.success, true);
  assert.equal(giftBoxResult.data?.imageUrl, 'https://assets.test/generated-gift-box.png');
  assert.equal(captured[3]?.url, 'https://new-api.test/v1/images/generations');
  assert.equal(captured[3]?.body.model, 'gpt-image-2');
  assert.equal(captured[3]?.body.resolution, '2K');
  assert.deepEqual(captured[3]?.body.image_urls, [
    'https://assets.test/composition-reference.png',
    'https://assets.test/gift-box-reference.png',
  ]);
  assert.equal(captured[3]?.body.tools, undefined);

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
