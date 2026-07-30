import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from '../src/ai/providers/new-api.provider';

const captured: Array<{ url: string; authorization: string | null; body: any }> = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  captured.push({
    url: String(input),
    authorization: headers.get('authorization'),
    body: JSON.parse(String(init?.body || '{}')),
  });
  return new Response(
    JSON.stringify({ choices: [{ message: { content: 'video verified' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

async function main(): Promise<void> {
  const provider = new NewApiProvider(
    new ConfigService({
      NEW_API_BASE_URL: 'https://new-api.test',
      NEW_API_KEY: 'new-api-key',
    }),
  );
  await provider.initialize();

  const result = await provider.analyzeVideo({
    prompt: '分析视频',
    videoData: Buffer.from('tiny-video').toString('base64'),
    mimeType: 'video/mp4',
    fileName: 'sample.mp4',
    model: 'gemini-3.5-flash',
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.text, 'video verified');
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.url, 'https://new-api.test/v1/chat/completions');
  assert.equal(captured[0]?.authorization, 'Bearer new-api-key');
  assert.equal(captured[0]?.body.model, 'gemini-3.5-flash');

  const content = captured[0]?.body.messages?.[0]?.content;
  assert.deepEqual(content?.[0], { type: 'text', text: '分析视频' });
  assert.equal(content?.[1]?.type, 'file');
  assert.equal(content?.[1]?.file?.filename, 'sample.mp4');
  assert.equal(
    content?.[1]?.file?.file_data,
    `data:video/mp4;base64,${Buffer.from('tiny-video').toString('base64')}`,
  );

  const invalid = await provider.analyzeVideo({
    videoData: Buffer.from('not-a-video').toString('base64'),
    mimeType: 'image/png',
  });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error?.code, 'VIDEO_ANALYSIS_FAILED');
  assert.match(invalid.error?.message || '', /MIME type/);
  assert.equal(captured.length, 1);

  console.log('new-api video analysis verification passed');
}

main()
  .finally(() => {
    globalThis.fetch = originalFetch;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
