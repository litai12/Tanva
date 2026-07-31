import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VideoProviderService } from '../src/ai/services/video-provider.service';

type CapturedRequest = {
  url: string;
  authorization: string | null;
  body: Record<string, any>;
};

const captured: CapturedRequest[] = [];
const originalFetch = globalThis.fetch;
const originalEnv = {
  NEW_API_BASE_URL: process.env.NEW_API_BASE_URL,
  NEW_API_KEY: process.env.NEW_API_KEY,
  NEW_API_TOKEN: process.env.NEW_API_TOKEN,
};

globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  const body = JSON.parse(String(init?.body || '{}')) as Record<string, any>;
  captured.push({
    url: String(input),
    authorization: headers.get('authorization'),
    body,
  });

  return new Response(
    JSON.stringify({
      id: `gateway-task-${captured.length}`,
      status: 'queued',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
};

const restoreEnv = (key: keyof typeof originalEnv): void => {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const createService = (): VideoProviderService =>
  new VideoProviderService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

async function main(): Promise<void> {
  process.env.NEW_API_BASE_URL = 'https://new-api.test';
  process.env.NEW_API_KEY = 'new-api-key';
  delete process.env.NEW_API_TOKEN;

  const service = createService();
  const happyhorse = await service.createDashscopeVideoTask({
    model: 'happyhorse-1.0-video-edit',
    input: {
      prompt: 'replace the jacket',
      media: [
        { type: 'video', url: 'https://assets.test/source.mp4' },
        { type: 'reference_image', url: 'https://assets.test/jacket.png' },
      ],
    },
    parameters: {
      resolution: '720P',
      ratio: '16:9',
      duration: 5,
      watermark: false,
    },
  });

  assert.equal(happyhorse.taskId, 'newapi:gateway-task-1');
  assert.equal(happyhorse.execution?.vendorKey, 'new_api');
  assert.equal(happyhorse.execution?.routedProvider, 'dashscope');
  assert.equal(captured[0]?.url, 'https://new-api.test/v1/videos');
  assert.equal(captured[0]?.authorization, 'Bearer new-api-key');
  assert.equal(captured[0]?.body.model, 'happyhorse-1.0-video-edit');
  assert.equal(captured[0]?.body.duration, 5);
  assert.equal(captured[0]?.body.aspect_ratio, '16:9');
  assert.deepEqual(captured[0]?.body.metadata?.input?.media, [
    { type: 'video', url: 'https://assets.test/source.mp4' },
    { type: 'reference_image', url: 'https://assets.test/jacket.png' },
  ]);
  assert.deepEqual(captured[0]?.body.metadata?.parameters, {
    resolution: '720P',
    ratio: '16:9',
    duration: 5,
    watermark: false,
  });

  const wanR2v = await service.createDashscopeVideoTask({
    model: 'wan2.6-r2v',
    input: {
      prompt: 'continue the action',
      reference_video_urls: [
        'https://assets.test/a.mp4',
        'https://assets.test/b.mp4',
      ],
    },
    parameters: {
      size: '1280*720',
      duration: 10,
      shot_type: 'multi',
    },
  });

  assert.equal(wanR2v.taskId, 'newapi:gateway-task-2');
  assert.deepEqual(captured[1]?.body.metadata?.input?.reference_video_urls, [
    'https://assets.test/a.mp4',
    'https://assets.test/b.mp4',
  ]);
  assert.equal(captured[1]?.body.metadata?.parameters?.shot_type, 'multi');

  const controllerSource = readFileSync(
    join(process.cwd(), 'src/ai/ai.controller.ts'),
    'utf8',
  );
  assert.doesNotMatch(controllerSource, /DASHSCOPE_API_KEY/);
  assert.doesNotMatch(
    controllerSource,
    /https:\/\/dashscope\.aliyuncs\.com\/api\/v1\/services\/aigc\/video-generation/,
  );

  delete process.env.NEW_API_KEY;
  const missingKeyService = createService();
  await assert.rejects(
    () =>
      missingKeyService.createDashscopeVideoTask({
        model: 'wan2.6-t2v',
        input: { prompt: 'must fail locally' },
      }),
    /NEW_API_KEY/,
  );

  console.log('DashScope video routing through new-api verification passed');
}

main()
  .finally(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('NEW_API_BASE_URL');
    restoreEnv('NEW_API_KEY');
    restoreEnv('NEW_API_TOKEN');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
