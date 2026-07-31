import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from '../src/ai/providers/new-api.provider';

const captured: Array<{ url: string; authorization: string | null; body: any }> = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  captured.push({
    url,
    authorization: headers.get('authorization'),
    body: JSON.parse(String(init?.body || '{}')),
  });
  return new Response(
    JSON.stringify(
      url.endsWith('/v1/responses')
        ? {
            output_text: 'doubao video verified',
            usage: {
              input_tokens: 12_000,
              output_tokens: 1_500,
              total_tokens: 13_500,
              input_tokens_details: {
                cached_tokens: 500,
                audio_tokens: 2_000,
              },
            },
          }
        : { choices: [{ message: { content: 'video verified' } }] },
    ),
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

  const doubaoResult = await provider.analyzeVideo({
    prompt: '输出分镜表',
    videoUrl: 'https://cdn.example.com/storyboard.mp4',
    model: 'doubao-seed-2-0-lite-260428',
  });
  assert.equal(doubaoResult.success, true);
  assert.equal(doubaoResult.data?.text, 'doubao video verified');
  assert.deepEqual(doubaoResult.data?.metadata?.usage, {
    inputTokens: 12_000,
    outputTokens: 1_500,
    totalTokens: 13_500,
    cachedInputTokens: 500,
    audioInputTokens: 2_000,
  });
  assert.equal(captured.length, 2);
  assert.equal(captured[1]?.url, 'https://new-api.test/v1/responses');
  assert.equal(captured[1]?.body.model, 'doubao-seed-2-0-lite-260428');
  assert.equal(captured[1]?.body.max_output_tokens, 16384);
  assert.deepEqual(captured[1]?.body.input?.[0]?.content, [
    {
      type: 'input_video',
      video_url: 'https://cdn.example.com/storyboard.mp4',
    },
    {
      type: 'input_text',
      text: '输出分镜表',
    },
  ]);

  const missingDoubaoUrl = await provider.analyzeVideo({
    prompt: '分析视频',
    model: 'doubao-seed-2-0-pro-260215',
  });
  assert.equal(missingDoubaoUrl.success, false);
  assert.equal(missingDoubaoUrl.error?.code, 'VIDEO_ANALYSIS_FAILED');
  assert.match(missingDoubaoUrl.error?.message || '', /videoUrl/);
  assert.equal(captured.length, 2);

  const invalid = await provider.analyzeVideo({
    videoData: Buffer.from('not-a-video').toString('base64'),
    mimeType: 'image/png',
  });
  assert.equal(invalid.success, false);
  assert.equal(invalid.error?.code, 'VIDEO_ANALYSIS_FAILED');
  assert.match(invalid.error?.message || '', /MIME type/);
  assert.equal(captured.length, 2);

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
