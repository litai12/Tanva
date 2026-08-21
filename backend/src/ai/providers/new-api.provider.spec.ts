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
  }).requestJson = async (_path, options) => {
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

  console.log('new-api image response format contract: ok');
}

void main();
