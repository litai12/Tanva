import assert from 'node:assert/strict';
import { CREDIT_PRICING_CONFIG, type ServiceType } from '../src/credits/credits.config';
import { CreditsService } from '../src/credits/credits.service';

type ImageRoute = 'normal' | 'stable';
type ImageSize = '0.5K' | '1K' | '2K' | '4K';

const service = Object.create(CreditsService.prototype) as CreditsService;
const resolveCredits = (
  serviceType: ServiceType,
  route: ImageRoute,
  imageSize: ImageSize,
  extra: Record<string, unknown> = {},
): number | null =>
  (
    service as unknown as {
      resolveTencentBananaResolutionCredits: (
        type: ServiceType,
        params: Record<string, unknown>,
      ) => number | null;
    }
  ).resolveTencentBananaResolutionCredits(serviceType, {
    bananaImageRoute: route,
    imageSize,
    ...extra,
  });

const bananaCases: Array<{
  serviceType: ServiceType;
  route: ImageRoute;
  expected: Partial<Record<ImageSize, number>>;
}> = [
  {
    serviceType: 'gemini-2.5-image',
    route: 'normal',
    expected: { '1K': 20 },
  },
  {
    serviceType: 'gemini-3-pro-image',
    route: 'normal',
    expected: { '1K': 60, '2K': 70, '4K': 85 },
  },
  {
    serviceType: 'gemini-3.1-image',
    route: 'normal',
    expected: { '0.5K': 40, '1K': 40, '2K': 50, '4K': 70 },
  },
  {
    serviceType: 'gemini-2.5-image',
    route: 'stable',
    expected: { '1K': 40 },
  },
  {
    serviceType: 'gemini-3-pro-image',
    route: 'stable',
    expected: { '1K': 130, '2K': 130, '4K': 240 },
  },
  {
    serviceType: 'gemini-3.1-image',
    route: 'stable',
    expected: { '0.5K': 45, '1K': 65, '2K': 100, '4K': 155 },
  },
];

for (const testCase of bananaCases) {
  for (const [imageSize, expected] of Object.entries(testCase.expected)) {
    assert.equal(
      resolveCredits(
        testCase.serviceType,
        testCase.route,
        imageSize as ImageSize,
      ),
      expected,
      `${testCase.serviceType}/${testCase.route}/${imageSize}`,
    );
  }
}

const gptNormal = { '1K': 20, '2K': 30, '4K': 40 } as const;
for (const [imageSize, expected] of Object.entries(gptNormal)) {
  assert.equal(
    resolveCredits('gpt-image-2', 'normal', imageSize as ImageSize, {
      quality: 'auto',
    }),
    expected,
  );
}

const gptTencent = {
  low: { '1K': 30, '2K': 40, '4K': 50 },
  medium: { '1K': 60, '2K': 120, '4K': 190 },
  high: { '1K': 230, '2K': 460, '4K': 760 },
} as const;
for (const [quality, prices] of Object.entries(gptTencent)) {
  for (const [imageSize, expected] of Object.entries(prices)) {
    assert.equal(
      resolveCredits('gpt-image-2', 'stable', imageSize as ImageSize, { quality }),
      expected,
      `gpt-image-2/stable/${quality}/${imageSize}`,
    );
  }
}

assert.equal(
  resolveCredits('gpt-image-2', 'stable', '2K', {
    quality: 'medium',
    referenceImageCount: 3,
  }),
  150,
  'GPT Image 2 尊享线路应在 2K Medium 120 积分上追加 3 × 10 参考图积分',
);
assert.equal(CREDIT_PRICING_CONFIG['gpt-image-2'].creditsPerCall, 20);
assert.deepEqual(CREDIT_PRICING_CONFIG['gemini-3-pro-image'].resolutionPricing, {
  '1K': 60,
  '2K': 70,
  '4K': 85,
});
assert.deepEqual(CREDIT_PRICING_CONFIG['gemini-3.1-image'].resolutionPricing, {
  '0.5K': 40,
  '1K': 40,
  '2K': 50,
  '4K': 70,
});

console.log('Tanvas normal/premium image pricing verification passed');
