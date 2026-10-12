import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from './new-api.provider';

type RequestOptions = { body?: string };
const fakeConfig = (values: Record<string, string>) => ({ get: (key: string, fallback?: string) => values[key] ?? fallback }) as ConfigService;

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
  assert.equal('quality' in normalPayload, false);
  for (const quality of [undefined, 'auto', 'low', 'medium', 'high'] as const) {
    for (const imageRoute of ['normal', 'stable']) {
      for (const providerOptions of [{ banana: { imageRoute } }, { bananaImageRoute: imageRoute }]) {
        const payload = await captureImagePayload((provider) => provider.generateImage({
          model: 'gpt-image-2', prompt: '生成一只猫', quality, providerOptions,
        }));
        if (imageRoute === 'normal') {
          assert.equal('quality' in payload, false, 'normal route must omit saved quality');
        } else {
          assert.equal(payload.quality, quality === 'medium' || quality === 'high' ? quality : 'low');
        }
      }
    }
  }
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
    const provider = new NewApiProvider(fakeConfig({
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

  for (const model of ['gpt-image-2.5-flare-vip', 'gpt-image-2.5-sunburst-vip']) {
    for (const quality of [undefined, 'auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
      for (const imageSize of ['1K', '2K', '4K']) {
        const request = { model, prompt: 'VIP test', quality, imageSize, aspectRatio: '3:2', providerOptions: { banana: { imageRoute: 'stable' as const } } };
        const payload = await captureImagePayload(provider => provider.generateImage(request));
        assert.equal(payload.model, model);
        assert.equal(payload.quality, quality === undefined || quality === 'auto' ? 'high' : quality);
        assert.equal(payload.resolution, imageSize);
        assert.equal(payload.response_format, 'url');
        const edit = await captureImagePayload(provider => provider.editImage({ ...request, sourceImage: 'https://assets.example.test/a.png' }));
        assert.equal(edit.quality, payload.quality);
        const blend = await captureImagePayload(provider => provider.blendImages({ ...request, sourceImages: ['https://assets.example.test/a.png'] }));
        assert.equal(blend.quality, payload.quality);
      }
    }
  }
  const nanoRefs = Array.from({ length: 14 }, (_, i) => `https://assets.example.test/${i}.png?original=1`);
  const nano = await captureImagePayload(provider => provider.generateImage({ model: 'gemini-nano-banana-2.1', prompt: 'Nano test', imageUrls: nanoRefs, imageSize: '4K', aspectRatio: '8:1', providerOptions: { banana: { imageRoute: 'ultra' } } }));
  assert.equal(nano.model, 'gemini-nano-banana-2.1');
  assert.equal(nano.resolution, '4K');
  assert.equal(nano.size, '8:1');
  assert.equal(nano.response_format, 'url');
  assert.deepEqual(nano.image_urls, nanoRefs);
  for (const model of ['gpt-image-2.5-flare-vip', 'gpt-image-2.5-sunburst-vip', 'gemini-nano-banana-2.1', 'gemini-nano-banana-2.1-official']) {
    const keys = new NewApiProvider(fakeConfig({ NEW_API_KEY: 'normal-test', NEW_API_KEY_VIP: 'vip-test', NEW_API_KEY_SVIP: 'svip-test' }));
    await keys.initialize();
    for (const route of ['normal', 'stable', 'ultra']) assert.equal((keys as any).resolveApiKey({ banana: { imageRoute: route }, vendorKey: 'new_api' }, model), 'normal-test');
  }
  for (const model of ['gemini-nano-banana-2.1', 'gemini-nano-banana-2.1-official']) {
    for (const route of ['normal', 'stable'] as const) {
      const request = { model, prompt: 'Nano routes', imageUrls: nanoRefs, imageSize: '2K', aspectRatio: '4:3', providerOptions: { banana: { imageRoute: route } } };
      const expectedModel = route === 'stable' || model.endsWith('-official') ? 'gemini-nano-banana-2.1-official' : 'gemini-nano-banana-2.1';
      const generated = await captureImagePayload(provider => provider.generateImage(request));
      assert.equal(generated.model, expectedModel);
      assert.equal(generated.response_format, 'url');
      assert.equal(generated.resolution, '2K');
      assert.deepEqual(generated.image_urls, nanoRefs);
      const edit = await captureImagePayload(provider => provider.editImage({ ...request, sourceImage: nanoRefs[0] }));
      assert.equal(edit.model, expectedModel);
      const blend = await captureImagePayload(provider => provider.blendImages({ ...request, sourceImages: nanoRefs }));
      assert.equal(blend.model, expectedModel);
    }
  }
  await assert.rejects(() => provider.generateImage({ model: 'gemini-nano-banana-2.1-official', prompt: 'test', imageUrls: [...nanoRefs, nanoRefs[0]] }), /14/);
  await assert.rejects(() => provider.generateImage({ model: 'gemini-nano-banana-2.1', prompt: 'test', imageUrls: [...nanoRefs, nanoRefs[0]] }), /14/);
  await assert.rejects(() => provider.generateImage({ model: 'gpt-image-2.5-flare-vip', prompt: 'test', imageSize: '0.5K' }), /1K/);
  console.log('new-api image response format, Jichuan payload and 2.5 routing contract: ok');
}

void main();
