import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ImageTaskService } from './image-task.service';
import { WatermarkEntitlementService } from './watermark-entitlement.service';

type FakePrismaOptions = {
  user?: { role?: string; noWatermark?: boolean } | null;
  subscription?: { membershipPlanId: string } | null;
  plan?: { id: string; metadata?: unknown } | null;
  vipWhitelist?: boolean;
  plans?: Array<{ id: string; billingCycle: string; metadata?: unknown }>;
  fail?: boolean;
};

function createPrisma(options: FakePrismaOptions = {}): any {
  return {
    user: {
      findUnique: async ({ select }: any) => {
        if (options.fail) throw new Error('database unavailable');
        if (select?.vipEntitlementWhitelist !== undefined) {
          return { vipEntitlementWhitelist: options.vipWhitelist === true };
        }
        return options.user === undefined ? null : options.user;
      },
    },
    userMembershipSubscription: {
      findFirst: async () => options.subscription ?? null,
    },
    membershipPlan: {
      findUnique: async () => options.plan ?? null,
      findMany: async () => options.plans ?? [],
    },
  };
}

function createService(options: FakePrismaOptions = {}): WatermarkEntitlementService {
  return new WatermarkEntitlementService(createPrisma(options));
}

async function testEntitlement(): Promise<void> {
  assert.equal(
    await createService({ user: { role: 'admin' } }).canSkipWatermarkByUserId('u-admin'),
    true,
    'admin skips watermark',
  );
  assert.equal(
    await createService({ user: { role: 'normal_admin' } }).canSkipWatermarkByUserId('u-normal-admin'),
    true,
    'normal_admin skips watermark',
  );
  assert.equal(
    await createService({ user: { role: 'user', noWatermark: true } }).canSkipWatermarkByUserId('u-whitelist'),
    true,
    'unified whitelist noWatermark right skips watermark',
  );
  assert.equal(
    await createService({
      user: { role: 'user', noWatermark: false },
      subscription: { membershipPlanId: 'vip_69' },
      plan: { id: 'vip_69', metadata: null },
    }).canSkipWatermarkByUserId('u-member'),
    true,
    'active membership period skips watermark even without plan metadata',
  );
  assert.equal(
    await createService({
      user: { role: 'user', noWatermark: false },
      vipWhitelist: true,
      plans: [{ id: 'vip_599_yearly', billingCycle: 'yearly', metadata: {} }],
    }).canSkipWatermarkByUserId('u-vip-whitelist'),
    true,
    'yearly VIP whitelist resolves to an effective plan and skips watermark',
  );
  assert.equal(
    await createService({ user: { role: 'user', noWatermark: false } }).canSkipWatermarkByUserId('u-free'),
    false,
    'free user is watermarked',
  );
  assert.equal(
    await createService({ user: { role: 'user', noWatermark: false } }).canSkipWatermarkByUserId('anonymous'),
    false,
    'anonymous user is watermarked',
  );
  assert.equal(
    await createService({ user: { role: 'user', noWatermark: false } }).canSkipWatermarkByUserId(null),
    false,
    'missing user id is watermarked',
  );
  assert.equal(
    await createService({ fail: true }).canSkipWatermarkByUserId('u-error'),
    false,
    'entitlement lookup failure falls back to watermark',
  );
}

async function testAsyncUploadWatermark(): Promise<void> {
  const original = await sharp({
    create: { width: 64, height: 48, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  }).png().toBuffer();
  const marked = await sharp({
    create: { width: 32, height: 24, channels: 4, background: { r: 200, g: 10, b: 10, alpha: 1 } },
  }).png().toBuffer();

  const service = Object.create(ImageTaskService.prototype) as any;
  service.logger = { warn: () => undefined };
  let uploaded: { key: string; buffer: Buffer; mimeType: string } | null = null;
  service.oss = {
    isEnabled: () => true,
    putBufferWithHeaders: async (key: string, buffer: Buffer, mimeType: string) => {
      uploaded = { key, buffer, mimeType };
      return { url: `https://assets.example.test/${key}` };
    },
  };
  let watermarkCalls = 0;
  service.applyWatermarkSafely = async (buffer: Buffer) => {
    watermarkCalls += 1;
    assert.equal(Buffer.compare(buffer, original), 0, 'watermark receives the decoded provider image');
    return marked;
  };

  await service.uploadImagePayloadToOss(original.toString('base64'), 'u-free', false);
  assert.equal(watermarkCalls, 1);
  assert.equal(uploaded?.buffer, marked, 'async base64 results are watermarked before OSS upload');
  assert.equal(uploaded?.mimeType, 'image/png');

  uploaded = null;
  await service.uploadImagePayloadToOss(original.toString('base64'), 'u-member', true);
  assert.equal(watermarkCalls, 1, 'entitled users skip the async watermark');
  assert.equal(uploaded?.buffer.compare(original), 0, 'entitled async base64 result stays untouched');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(original, { headers: { 'content-type': 'image/png' } })) as any;
    uploaded = null;
    await service.uploadRemoteImageToOss('https://upstream.example.test/result.png', 'u-free', false);
    assert.equal(watermarkCalls, 2);
    assert.equal(uploaded?.buffer, marked, 'async remote URL results are watermarked before OSS upload');

    uploaded = null;
    await service.uploadRemoteImageToOss('https://upstream.example.test/result.png', 'u-member', true);
    assert.equal(watermarkCalls, 2, 'entitled users skip the remote watermark');
    assert.equal(uploaded?.buffer.compare(original), 0, 'entitled async remote result stays untouched');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main(): Promise<void> {
  await testEntitlement();
  await testAsyncUploadWatermark();
  console.log('watermark entitlement checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
