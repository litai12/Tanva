import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from './new-api.provider';

type RequestOptions = { body?: string };

async function captureImagePayload(
  invoke: (provider: NewApiProvider) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const provider = new NewApiProvider(new ConfigService());
  let captured: Record<string, unknown> | undefined;

  (provider as unknown as {
    requestJson: (path: string, options: RequestOptions) => Promise<unknown>;
  }).requestJson = async (path, options) => {
    assert.equal(path, '/v1/images/generations');
    captured = JSON.parse(options.body || '{}') as Record<string, unknown>;
    return { data: [{ url: 'https://assets.example.test/generated.png' }] };
  };

  const result = await invoke(provider);
  assert.equal((result as { success?: boolean }).success, true);
  assert.ok(captured, 'expected image request payload to be captured');
  return captured;
}

async function main(): Promise<void> {
  for (const model of [
    'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image-preview',
  ]) {
    const payload = await captureImagePayload((provider) =>
      provider.generateImage({
        model,
        prompt: '生成一只猫',
        outputFormat: 'png',
      }),
    );
    assert.equal(payload.response_format, 'url');
    assert.equal('output_format' in payload, false);
  }

  const aliasedPayload = await captureImagePayload((provider) =>
    provider.editImage({
      model: 'gemini-3.1-image-edit',
      prompt: '把猫改成橘色',
      sourceImage: 'https://assets.example.test/source.png',
      outputFormat: 'webp',
    }),
  );
  assert.equal(aliasedPayload.model, 'gemini-3.1-flash-image-preview');
  assert.equal(aliasedPayload.response_format, 'url');
  assert.equal('output_format' in aliasedPayload, false);

  const normalPayload = await captureImagePayload((provider) =>
    provider.generateImage({
      model: 'gpt-image-2',
      prompt: '生成一只猫',
      outputFormat: 'png',
    }),
  );
  assert.equal(normalPayload.output_format, 'png');
  assert.equal('response_format' in normalPayload, false);

  for (const model of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5']) {
    const payload = await captureImagePayload((provider) => provider.generateImage({
      model, quality: 'max', prompt: '生成产品图', imageSize: '2K', aspectRatio: '3:2',
      imageUrls: ['https://assets.example.test/reference.png'],
      providerOptions: { banana: { imageRoute: 'stable' } },
    }));
    assert.equal(payload.model, model);
    assert.equal(payload.quality, model === 'gpt-image-2.5' ? 'max' : undefined);
    assert.equal(payload.resolution, '2K');
    assert.deepEqual(payload.image_urls, ['https://assets.example.test/reference.png']);
    const provider = new NewApiProvider(new ConfigService({
      NEW_API_KEY: 'normal-test', NEW_API_KEY_VIP: 'vip-test', NEW_API_KEY_SVIP: 'svip-test',
    }));
    await provider.initialize();
    assert.equal((provider as any).resolveApiKey({ banana: { imageRoute: 'stable' }, vendorKey: 'new_api' }, model), 'normal-test');
    assert.equal((provider as any).resolveApiKey({ banana: { imageRoute: 'ultra' } }, model), 'normal-test');
  }

  for (const quality of ['high', 'xhigh', 'max'] as const) {
    for (const imageUrls of [undefined, ['https://assets.example.test/a.png', 'https://assets.example.test/b.png']]) {
      const payload = await captureImagePayload((provider) => provider.generateImage({
        model: 'gpt-image-2.5', prompt: '只修改杯子颜色', quality,
        imageSize: '1K', aspectRatio: '1:1', imageUrls,
      }));
      assert.equal(payload.model, 'gpt-image-2.5');
      assert.equal(payload.quality, quality);
      assert.equal(payload.size, '1:1');
      assert.equal(payload.resolution, '1K');
      assert.deepEqual(payload.image_urls, imageUrls);
      assert.equal(payload.n, 1);
    }
  }
  const provider = new NewApiProvider(new ConfigService());
  await assert.rejects(() => provider.generateImage({
    model: 'gpt-image-2.5', prompt: 'edit', imageUrls: ['data:image/png;base64,abc'],
  }), /HTTP|URL|远程/);
  console.log('new-api image response format, Jichuan payload and 2.5 routing contract: ok');
}

void main();
