import assert from 'node:assert/strict';
import {
  applySeedance25Price,
  calculateSeedance20BillingDuration,
  createSeedance20DiscountPricingTemplate,
} from '../src/ai/services/seedance20-pricing';
import { resolveManagedVendorPricing } from '../src/ai/services/model-pricing-resolver';

assert.deepEqual(calculateSeedance20BillingDuration(5, []), {
  outputDurationSec: 5,
  inputVideoDurationSec: 0,
  billingDurationSec: 5,
});

assert.deepEqual(calculateSeedance20BillingDuration(5, [5]), {
  outputDurationSec: 5,
  inputVideoDurationSec: 5,
  billingDurationSec: 10,
});

assert.deepEqual(calculateSeedance20BillingDuration(4, [2.345, 3.456]), {
  outputDurationSec: 4,
  inputVideoDurationSec: 5.801,
  billingDurationSec: 9.801,
});

assert.throws(
  () => calculateSeedance20BillingDuration(0, [5]),
  /output duration must be a positive number/,
);
assert.throws(
  () => calculateSeedance20BillingDuration(5, [Number.NaN]),
  /reference video durations must be positive numbers/,
);

assert.equal(applySeedance25Price(1.0), 1.875);
assert.equal(applySeedance25Price(1.2), 2.25);

const seedancePricing = createSeedance20DiscountPricingTemplate();
const seedance25Models = seedancePricing.dimensions
  ?.filter((dimension) => typeof dimension !== 'string' && dimension.key === 'seedanceModel')
  .flatMap((dimension) => (typeof dimension === 'string' ? [] : dimension.options ?? []))
  .map((option) => option.value);
assert.ok(seedance25Models?.includes('seedance-2.5'));

const seedance25Vendor = {
  vendorKey: 'seedance_api',
  pricing: seedancePricing,
};
assert.deepEqual(
  resolveManagedVendorPricing(seedance25Vendor, {
    seedanceModel: 'seedance-2.5',
    resolution: '480P',
    duration: 5,
  }),
  {
    source: 'vendor_rule',
    vendorKey: 'seedance_api',
    ruleKey: 'seedance25_480p',
    label: 'Seedance 2.5 480P',
    price: {
      priceYuan: 9.375,
      credits: 938,
    },
    evaluatorKey: 'seedance25_480p_eval',
    evaluatorType: 'linear',
    pricingVersion: 'v2',
    calcTrace: {
      evaluatorType: 'linear',
      unitField: 'duration',
      unitPriceYuan: 1.875,
      unitValue: 5,
    },
  },
);
assert.deepEqual(
  resolveManagedVendorPricing(seedance25Vendor, {
    seedanceModel: 'seedance-2.5',
    resolution: '720P',
    duration: 5,
  }).price,
  {
    priceYuan: 11.25,
    credits: 1125,
  },
);
assert.equal(
  resolveManagedVendorPricing(seedance25Vendor, {
    seedanceModel: 'seedance-2.5',
    resolution: '1080P',
    duration: 5,
  }).source,
  'none',
);

console.log('Seedance billing duration and Seedance 2.5 pricing verification passed');
