import assert from 'node:assert/strict';
import {
  applySeedance25Price,
  calculateSeedance20BillingDuration,
  createSeedance20DiscountPricingTemplate,
} from '../src/ai/services/seedance20-pricing';
import {
  resolveManagedConsumerPolicy,
  resolveManagedVendorPricing,
} from '../src/ai/services/model-pricing-resolver';
import { applyConsumerCreditDiscount } from '../src/credits/consumer-credit-operation';

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

// Seedance 2.5 editing sends duration=-1 upstream, but its actual 10-second
// output follows the 10-second input and must be billed as 10 + 10 seconds.
assert.deepEqual(calculateSeedance20BillingDuration(10, [10]), {
  outputDurationSec: 10,
  inputVideoDurationSec: 10,
  billingDurationSec: 20,
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
assert.equal(applySeedance25Price(3.0), 5.625);
assert.equal(applySeedance25Price(6.0), 11.25);

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
assert.deepEqual(
  resolveManagedVendorPricing(seedance25Vendor, {
    seedanceModel: 'seedance-2.5',
    resolution: '1080P',
    duration: 5,
  }).price,
  {
    priceYuan: 28.125,
    credits: 2813,
  },
);
assert.deepEqual(
  resolveManagedVendorPricing(seedance25Vendor, {
    seedanceModel: 'seedance-2.5',
    resolution: '4K',
    duration: 5,
  }).price,
  {
    priceYuan: 56.25,
    credits: 5625,
  },
);

const seedance25Context = {
  seedanceModel: 'seedance-2.5',
  resolution: '1080P',
  duration: 5,
};
assert.equal(
  resolveManagedConsumerPolicy(
    seedancePricing,
    seedance25Context,
    new Date('2026-08-14T13:59:59+08:00'),
  )?.discount,
  undefined,
);
const activeDiscountPolicy = resolveManagedConsumerPolicy(
  seedancePricing,
  seedance25Context,
  new Date('2026-08-14T14:00:00+08:00'),
);
assert.equal(activeDiscountPolicy?.discount?.multiplier, 0.72);
assert.deepEqual(
  applyConsumerCreditDiscount({
    listCredits: 2813,
    catalogPriceYuan: 28.125,
    consumerPolicy: activeDiscountPolicy,
  }),
  {
    listCredits: 2813,
    chargedCredits: 2025,
    multiplier: 0.72,
    listPriceYuan: 28.125,
    chargedPriceYuan: 20.25,
    policyKey: 'seedance25_1080p_72_campaign',
    label: 'Seedance 2.5 1080P 限时 72 折',
    startsAt: '2026-08-14T14:00:00+08:00',
    endsAt: '2026-09-17T14:00:00+08:00',
  },
);
assert.equal(
  resolveManagedConsumerPolicy(
    seedancePricing,
    seedance25Context,
    new Date('2026-09-17T14:00:00+08:00'),
  )?.discount,
  undefined,
);
assert.deepEqual(
  resolveManagedConsumerPolicy(
    seedancePricing,
    { ...seedance25Context, resolution: '4K' },
    new Date('2026-08-17T12:00:00+08:00'),
  )?.availability,
  {
    available: false,
    message: '暂未开放',
    policyKey: 'seedance25_4k_unavailable',
    label: 'Seedance 2.5 4K 暂未开放',
  },
);

// A spec policy can override a model-wide campaign without coupling either
// operation to the catalog pricing rule.
assert.equal(
  resolveManagedConsumerPolicy(
    {
      consumerPolicies: [
        {
          policyKey: 'whole_model',
          enabled: true,
          priority: 100,
          conditions: {
            all: [{ field: 'seedanceModel', op: 'eq', value: 'seedance-2.5' }],
          },
          discount: { multiplier: 0.8 },
        },
        {
          policyKey: 'resolution_override',
          enabled: true,
          priority: 200,
          conditions: {
            all: [
              { field: 'seedanceModel', op: 'eq', value: 'seedance-2.5' },
              { field: 'resolution', op: 'eq', value: '1080P' },
            ],
          },
          discount: { multiplier: 0.72 },
        },
      ],
    },
    seedance25Context,
  )?.discount?.multiplier,
  0.72,
);

console.log('Seedance billing duration and Seedance 2.5 pricing verification passed');
