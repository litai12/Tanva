import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { NewApiProvider } from '../providers/new-api.provider';
import { ImageTaskService } from './image-task.service';
import {
  ImageReferencePreparationService,
  isPublicImageAddress,
  imageReferenceByteLimit,
  needsToapisReferencePreparation,
  TOAPIS_REFERENCE_MAX_BYTES,
} from './image-reference-preparation.service';

const SOURCE_URL = 'https://assets.example.test/rendered.png?x-tos-process=image/crop,w_3200,h_3000';

async function main(): Promise<void> {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.2.1',
    '::1', 'fd00::1', 'fe80::1', '::ffff:7f00:1', '::ffff:192.168.0.1']) {
    assert.equal(isPublicImageAddress(address), false, address);
  }
  assert.equal(isPublicImageAddress('8.8.8.8'), true);
  assert.equal(isPublicImageAddress('2606:4700:4700::1111'), true);
  assert.equal(needsToapisReferencePreparation('gpt-image-2', { banana: { imageRoute: 'stable' } }), false);
  assert.equal(needsToapisReferencePreparation('gpt-image-2'), true);
  assert.equal(needsToapisReferencePreparation('gemini-3.1-image-edit', { bananaImageRoute: 'stable' }), false);
  for (const model of ['gemini-3.1-image', 'gemini-3.1-image-edit', 'gemini-3.1-image-blend',
    'gemini-3.1-flash-image-preview']) {
    for (const imageRoute of ['normal', 'stable', 'ultra']) {
      for (const options of [{ bananaImageRoute: imageRoute }, { banana: { imageRoute } }]) {
        assert.equal(imageReferenceByteLimit(model, options), imageRoute === 'normal'
          ? TOAPIS_REFERENCE_MAX_BYTES : undefined);
      }
    }
  }
  assert.equal(needsToapisReferencePreparation('gemini-nano-banana-2.1-official'), false);
  assert.equal(imageReferenceByteLimit('gpt-image-2'), 50_000_000);
  assert.equal(imageReferenceByteLimit('gemini-3.1-flash-image-preview'), 20 * 1024 * 1024);
  assert.equal(imageReferenceByteLimit('gpt-image-2.5-flare'), undefined);
  assert.equal(needsToapisReferencePreparation('seedream-5-0'), false);
  assert.equal(needsToapisReferencePreparation('gemini-3-pro-image-preview'), false);

  let source = await sharp({ create: { width: 64, height: 48, channels: 4,
    background: { r: 50, g: 20, b: 200, alpha: 0.5 } } }).png().toBuffer();
  const uploads: Array<{ key: string; buffer: Buffer; mimeType: string }> = [];
  const service = new ImageReferencePreparationService({
    putBufferWithHeaders: async (key: string, buffer: Buffer, mimeType: string) => {
      uploads.push({ key, buffer, mimeType });
      return { key, url: `https://assets.example.test/${key}` };
    },
  } as any);
  (service as any).probeSize = async () => undefined;
  const downloads: string[] = [];
  (service as any).download = async (url: string, path: string) => {
    downloads.push(url);
    await fs.writeFile(path, source);
    return source.length;
  };
  const unchanged = await service.prepare([SOURCE_URL, SOURCE_URL], 'gpt-image-2');
  assert.deepEqual(unchanged, { urls: [SOURCE_URL, SOURCE_URL], adjustments: [] });
  assert.deepEqual(downloads, [SOURCE_URL], 'duplicate source is read once, with render/crop query preserved');
  assert.equal(uploads.length, 0, 'compliant reference is neither reencoded nor uploaded');
  await service.prepare([SOURCE_URL], 'gpt-image-2', { bananaImageRoute: 'stable' });
  assert.equal(downloads.length, 1, 'Tencent GPT stable retains its separate contract');
  await service.prepare([SOURCE_URL], 'gemini-3.1-image-edit', { banana: { imageRoute: 'stable' } });
  assert.equal(downloads.length, 1, 'Tencent Gemini stable skips ToAPIs preparation');

  // A poorly compressed PNG larger than the production rejection shrinks losslessly.
  source = await sharp({ create: { width: 3200, height: 3000, channels: 3,
    background: { r: 127, g: 80, b: 180 } } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(source.length > TOAPIS_REFERENCE_MAX_BYTES);
  const lossless = await service.prepare([SOURCE_URL], 'gemini-3.1-flash-image-preview');
  assert.equal(lossless.adjustments[0].width, 3200);
  assert.equal(lossless.adjustments[0].height, 3000);
  assert.equal(lossless.adjustments[0].format, 'png');
  assert.ok(uploads[0].buffer.length <= TOAPIS_REFERENCE_MAX_BYTES);
  const pixel = await sharp(uploads[0].buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...pixel], [127, 80, 180]);
  assert.ok(lossless.urls[0].startsWith('https://'));
  assert.equal(lossless.adjustments[0].originalUrl, SOURCE_URL);

  // Actual 27+ MiB noisy PNG: same-size JPEG fits, avoiding loss of input dimensions.
  source = await sharp(randomBytes(3200 * 3000 * 3), {
    raw: { width: 3200, height: 3000, channels: 3 },
  }).ensureAlpha().png({ compressionLevel: 0 }).toBuffer();
  assert.equal((await sharp(source).metadata()).hasAlpha, true);
  assert.equal((await sharp(source).stats()).isOpaque, true);
  const beforeGpt = uploads.length;
  const gptCompliant = await service.prepare([SOURCE_URL], 'gpt-image-2');
  assert.deepEqual(gptCompliant, { urls: [SOURCE_URL], adjustments: [] });
  assert.equal(uploads.length, beforeGpt, '27MiB GPT2 source fits its 50MB contract');
  const opaque = await service.prepare([SOURCE_URL], 'gemini-3.1-flash-image-preview');
  assert.equal(opaque.adjustments[0].width, 3200);
  assert.equal(opaque.adjustments[0].height, 3000);
  assert.equal(opaque.adjustments[0].format, 'jpeg');
  assert.ok(opaque.adjustments[0].preparedBytes <= TOAPIS_REFERENCE_MAX_BYTES);

  // Alpha must survive when random pixels require an actual proportional downsize.
  source = await sharp(randomBytes(3200 * 2000 * 4), {
    raw: { width: 3200, height: 2000, channels: 4 },
  }).png({ compressionLevel: 0 }).toBuffer();
  const transparent = await service.prepare([SOURCE_URL], 'gemini-3.1-flash-image-preview');
  const adjusted = transparent.adjustments[0];
  assert.equal(adjusted.format, 'png');
  assert.ok(adjusted.width < 3200);
  assert.ok(Math.abs(adjusted.width / adjusted.height - 1.6) < 0.002);
  assert.ok(adjusted.preparedBytes <= TOAPIS_REFERENCE_MAX_BYTES);
  assert.equal((await sharp(uploads[2].buffer).metadata()).hasAlpha, true);

  // Provider boundary covers synchronous and async callers for all three verbs.
  const prepareCalls: string[][] = [];
  const provider = new NewApiProvider(new ConfigService(), undefined, {
    prepare: async (urls: string[]) => {
      prepareCalls.push(urls);
      return { urls: urls.map((_, index) => `https://prepared.example.test/${index}.png`),
        adjustments: [{ originalUrl: urls[0], preparedUrl: 'https://prepared.example.test/0.png' }] };
    },
  } as any);
  const payloads: any[] = [];
  (provider as any).requestJson = async (_path: string, options: any) => {
    payloads.push(JSON.parse(options.body));
    return { data: [{ url: 'https://assets.example.test/result.png' }] };
  };
  const results = [
    await provider.generateImage({ model: 'gpt-image-2.5-flare', prompt: 'unchanged', imageUrls: [SOURCE_URL] }),
    await provider.editImage({ model: 'gpt-image-2.5-flare', prompt: 'unchanged', sourceImage: SOURCE_URL }),
    await provider.blendImages({ model: 'gpt-image-2.5-flare', prompt: 'unchanged', sourceImages: [SOURCE_URL] }),
  ];
  for (const result of results) assert.ok(result.data?.metadata?.imageReferencePreparation);
  for (const payload of payloads) {
    assert.deepEqual(payload.image_urls, ['https://prepared.example.test/0.png']);
    assert.equal(payload.prompt, 'unchanged');
  }
  assert.equal(prepareCalls.length, 3);
  const failingProvider = new NewApiProvider(new ConfigService(), undefined, {
    prepare: async () => { throw new Error('source unavailable before submission'); },
  } as any);
  let failedSubmissions = 0;
  (failingProvider as any).requestJson = async () => { failedSubmissions += 1; };
  await assert.rejects(failingProvider.editImage({ model: 'gemini-3.1-image-edit',
    prompt: 'unchanged', sourceImage: SOURCE_URL }), /before submission/);
  assert.equal(failedSubmissions, 0, 'failed preparation never submits a generation or retries');

  // Async generation retains the same crop URL before preparation; legacy providers still resize.
  let received: any;
  let legacyResizeCount = 0;
  const taskService = Object.create(ImageTaskService.prototype) as any;
  taskService.oss = { withImageResize: (url: string) => { legacyResizeCount += 1; return `${url}&legacy=1`; } };
  taskService.providerFactory = { getProvider: () => ({ generateImage: async (request: any) => {
    received = request;
    return { success: true, data: { imageUrl: 'https://assets.example.test/result.png' } };
  } }) };
  await taskService.runGenerateTask({ prompt: 'unchanged', aiProvider: 'new-api' },
    { imageUrls: [SOURCE_URL] }, 'gemini-3.1-flash-image-preview');
  assert.deepEqual(received.imageUrls, [SOURCE_URL]);
  assert.equal(legacyResizeCount, 0);
  await taskService.runGenerateTask({ prompt: 'unchanged', aiProvider: 'new-api' },
    { imageUrls: [SOURCE_URL], providerOptions: { bananaImageRoute: 'stable' } }, 'gpt-image-2');
  assert.equal(legacyResizeCount, 1);
  await taskService.runGenerateTask({ prompt: 'unchanged', aiProvider: 'new-api' },
    { imageUrls: [SOURCE_URL] }, 'gemini-nano-banana-2.1');
  assert.equal(legacyResizeCount, 1, 'Nano2.1 retains its established skip-resize contract');
  await taskService.runGenerateTask({ prompt: 'unchanged', aiProvider: 'new-api' },
    { imageUrls: [SOURCE_URL], providerOptions: { banana: { imageRoute: 'stable' } } },
    'gemini-3.1-flash-image-preview');
  assert.equal(legacyResizeCount, 2, 'Tencent Gemini stable retains existing async OSS resize');
  assert.deepEqual(received.imageUrls, [`${SOURCE_URL}&legacy=1`]);

  // Exercise download safeguards without any network access or image generation.
  const downloader = new ImageReferencePreparationService({} as any) as any;
  const originalFetch = globalThis.fetch;
  let requested = 0;
  try {
    globalThis.fetch = (async () => { requested += 1; return new Response(null, {
      status: 302, headers: { location: 'http://127.0.0.1/private.png' },
    }); }) as any;
    await assert.rejects(downloader.download('https://8.8.8.8/image.png', '/unused'), /本机或私有网络/);
    assert.equal(requested, 1, 'private redirect is blocked before a second request');
    globalThis.fetch = (async () => new Response('x', {
      headers: { 'content-length': String(65 * 1024 * 1024) },
    })) as any;
    await assert.rejects(downloader.download('https://8.8.8.8/image.png', '/unused'), /64MiB/);
    globalThis.fetch = (async (_url: unknown, options: any) => {
      assert.equal(options.method, 'HEAD');
      return new Response(null, { headers: { 'content-length': '1024', 'content-type': 'image/png' } });
    }) as any;
    let unnecessaryGet = 0;
    downloader.download = async () => { unnecessaryGet += 1; throw new Error('GET should not happen'); };
    assert.deepEqual(await downloader.prepare(['https://8.8.8.8/image.png'], 'gemini-3.1-image'), {
      urls: ['https://8.8.8.8/image.png'], adjustments: [],
    });
    assert.equal(unnecessaryGet, 0, 'compliant HEAD skips GET and decoding');
    globalThis.fetch = (async () => new Response(null, { headers: { 'content-type': 'image/png' } })) as any;
    assert.equal(await downloader.probeSize('https://8.8.8.8/image.png'), undefined);
    globalThis.fetch = (async () => new Response(null, { status: 405 })) as any;
    assert.equal(await downloader.probeSize('https://8.8.8.8/image.png'), undefined);
    globalThis.fetch = (async () => new Response(null, { headers: {
      'content-length': '1024', 'content-type': 'image/png', 'content-encoding': 'gzip',
    } })) as any;
    assert.equal(await downloader.probeSize('https://8.8.8.8/image.png'), undefined,
      'compressed HTTP representation length cannot prove decoded image size');
    globalThis.fetch = (async () => new Response(null, { headers: {
      'content-length': String(30 * 1024 * 1024), 'content-type': 'image/png',
    } })) as any;
    downloader.download = async (_url: string, path: string) => {
      await fs.writeFile(path, Buffer.from('small image body'));
      return 16;
    };
    assert.deepEqual(await downloader.prepare(['https://8.8.8.8/image.png'], 'gemini-3.1-image'), {
      urls: ['https://8.8.8.8/image.png'], adjustments: [],
    }, 'oversized declared HEAD with actually small GET retains original image');

    const capTester = new ImageReferencePreparationService({} as any) as any;
    let sentChunks = 0;
    globalThis.fetch = (async () => new Response(new ReadableStream({ pull(controller) {
      if (++sentChunks <= 65) controller.enqueue(new Uint8Array(1024 * 1024));
      else controller.close();
    } }), { headers: { 'content-length': '1' } })) as any;
    const directory = await fs.mkdtemp('/tmp/tanva-image-reference-cap-test-');
    try {
      await assert.rejects(capTester.download('https://8.8.8.8/image.png', `${directory}/input`), /64MiB/);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  } finally { globalThis.fetch = originalFetch; }
  console.log('image reference preparation: lossless, 27MiB JPEG, transparent resize, all provider verbs, async generation, and download safety passed');
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
