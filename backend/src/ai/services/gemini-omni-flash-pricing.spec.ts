import assert from 'node:assert/strict';
import { resolveManagedVendorPricingV2 } from './model-pricing-resolver';
import {
  GEMINI_OMNI_FLASH_COST_YUAN,
  GEMINI_OMNI_FLASH_MARKUP,
  createGeminiOmniFlashPricingTemplate,
  getGeminiOmniFlashRetailPriceYuan,
  type GeminiOmniFlashDuration,
  type GeminiOmniFlashResolution,
} from './gemini-omni-flash-pricing';

const run = async (): Promise<void> => {
  const cases: Array<{
    resolution: GeminiOmniFlashResolution;
    durationSec: GeminiOmniFlashDuration;
    priceYuan: number;
    credits: number;
  }> = [
    { resolution: '720P', durationSec: 4, priceYuan: 1.575, credits: 158 },
    { resolution: '720P', durationSec: 6, priceYuan: 1.575, credits: 158 },
    { resolution: '720P', durationSec: 10, priceYuan: 2.1, credits: 210 },
    { resolution: '1080P', durationSec: 4, priceYuan: 2.1, credits: 210 },
    { resolution: '1080P', durationSec: 6, priceYuan: 2.1, credits: 210 },
    { resolution: '1080P', durationSec: 10, priceYuan: 2.625, credits: 263 },
  ];

  for (const testCase of cases) {
    assert.equal(
      getGeminiOmniFlashRetailPriceYuan(testCase.resolution, testCase.durationSec),
      testCase.priceYuan,
    );
    const resolved = await resolveManagedVendorPricingV2(
      {
        vendorKey: 'new_api',
        pricing: createGeminiOmniFlashPricingTemplate(),
      },
      testCase,
    );
    assert.equal(resolved.source, 'vendor_rule');
    assert.equal(resolved.price.priceYuan, testCase.priceYuan);
    assert.equal(resolved.price.credits, testCase.credits);
  }

  assert.equal(GEMINI_OMNI_FLASH_COST_YUAN['1080P'][10], 1.75);
  assert.equal(GEMINI_OMNI_FLASH_MARKUP, 1.5);
  assert.equal(getGeminiOmniFlashRetailPriceYuan('1080P', 10), 2.625);
};

run()
  .then(() => console.log('gemini-omni-flash-pricing.spec: ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
