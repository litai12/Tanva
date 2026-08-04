import assert from 'node:assert/strict';
import {
  calculateDoubaoSeedVideoAnalysisDurationBilling,
  calculateDoubaoSeedVideoAnalysisBilling,
  DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_DENOMINATOR,
  DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_NUMERATOR,
  DOUBAO_SEED_MINI_SEEDANCE20_480P_PRICE_DENOMINATOR,
  DOUBAO_SEED_MINI_SEEDANCE20_480P_PRICE_NUMERATOR,
  DOUBAO_SEED_PRO_SEEDANCE20_480P_PRICE_DENOMINATOR,
  DOUBAO_SEED_PRO_SEEDANCE20_480P_PRICE_NUMERATOR,
  DOUBAO_SEED_VIDEO_ANALYSIS_MARKUP,
  extractNewApiTokenUsage,
  getDoubaoSeedVideoAnalysisPreflightCredits,
  resolveDoubaoSeedVideoAnalysisTier,
  TANVA_CREDITS_PER_YUAN,
} from '../src/ai/services/doubao-seed-video-analysis-pricing';
import { SEEDANCE20_STANDARD_480P_PRICE_YUAN_PER_SECOND } from '../src/ai/services/seedance20-pricing';

const usage = extractNewApiTokenUsage({
  usage: {
    input_tokens: 10_000,
    output_tokens: 2_000,
    total_tokens: 12_000,
    input_tokens_details: {
      cached_tokens: 1_000,
      audio_tokens: 2_500,
    },
  },
});
assert.deepEqual(usage, {
  inputTokens: 10_000,
  outputTokens: 2_000,
  totalTokens: 12_000,
  cachedInputTokens: 1_000,
  audioInputTokens: 2_500,
});

assert.equal(DOUBAO_SEED_VIDEO_ANALYSIS_MARKUP, 1.5);
assert.equal(TANVA_CREDITS_PER_YUAN, 100);
assert.equal(SEEDANCE20_STANDARD_480P_PRICE_YUAN_PER_SECOND, 1.25);
assert.equal(DOUBAO_SEED_PRO_SEEDANCE20_480P_PRICE_NUMERATOR, 1);
assert.equal(DOUBAO_SEED_PRO_SEEDANCE20_480P_PRICE_DENOMINATOR, 3);
assert.equal(DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_NUMERATOR, 1);
assert.equal(DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_DENOMINATOR, 10);
assert.equal(DOUBAO_SEED_MINI_SEEDANCE20_480P_PRICE_NUMERATOR, 1);
assert.equal(DOUBAO_SEED_MINI_SEEDANCE20_480P_PRICE_DENOMINATOR, 20);
assert.equal(resolveDoubaoSeedVideoAnalysisTier(32_000), '0-32k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(32_001), '32-128k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(128_000), '32-128k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(128_001), '128-256k');

const durationCases = [
  {
    model: 'doubao-seed-2-0-pro-260215',
    denominator: 3,
    cases: [
      { durationSec: 1, exactCredits: 41.66666667, creditsCharged: 42 },
      { durationSec: 3, exactCredits: 125, creditsCharged: 125 },
      { durationSec: 10, exactCredits: 416.66666667, creditsCharged: 417 },
    ],
  },
  {
    model: 'doubao-seed-2-0-lite-260428',
    denominator: 10,
    cases: [
      { durationSec: 1, exactCredits: 12.5, creditsCharged: 13 },
      { durationSec: 3, exactCredits: 37.5, creditsCharged: 38 },
      { durationSec: 10, exactCredits: 125, creditsCharged: 125 },
    ],
  },
  {
    model: 'doubao-seed-2-0-mini-260428',
    denominator: 20,
    cases: [
      { durationSec: 1, exactCredits: 6.25, creditsCharged: 7 },
      { durationSec: 3, exactCredits: 18.75, creditsCharged: 19 },
      { durationSec: 10, exactCredits: 62.5, creditsCharged: 63 },
    ],
  },
] as const;

for (const modelCases of durationCases) {
  for (const expected of modelCases.cases) {
    const billing = calculateDoubaoSeedVideoAnalysisDurationBilling(
      modelCases.model,
      expected.durationSec,
    );
    assert.equal(billing.model, modelCases.model);
    assert.equal(billing.billingMode, 'duration_metered');
    assert.equal(billing.durationSec, expected.durationSec);
    assert.equal(billing.pricingAnchor, 'seedance-2.0-480p');
    assert.equal(billing.seedance20PriceYuanPerSecond, 1.25);
    assert.deepEqual(billing.priceRatio, { numerator: 1, denominator: modelCases.denominator });
    assert.equal(billing.exactCredits, expected.exactCredits);
    assert.equal(billing.creditsCharged, expected.creditsCharged);
  }
}

assert.throws(
  () => calculateDoubaoSeedVideoAnalysisDurationBilling('doubao-seed-2-0-lite-260428', 0),
  /duration must be positive/,
);

/*
 * The token calculator remains covered because it documents the upstream
 * gateway cost/audit format. It is no longer the user-facing billing mode for
 * the three Doubao video-analysis models.
 */
const miniTokenAudit = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-mini-260428',
  {
    inputTokens: 10_000,
    outputTokens: 2_000,
    totalTokens: 12_000,
    cachedInputTokens: 0,
    audioInputTokens: 0,
  },
);
assert.equal(miniTokenAudit.tier, '0-32k');
assert.equal(miniTokenAudit.officialCostYuan, 0.006);
assert.equal(miniTokenAudit.retailPriceYuan, 0.009);
assert.equal(miniTokenAudit.exactCredits, 0.9);

const proTokenAudit = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-pro-260215',
  {
    inputTokens: 128_001,
    outputTokens: 1_000,
    totalTokens: 129_001,
    cachedInputTokens: 0,
    audioInputTokens: 0,
  },
);
assert.equal(proTokenAudit.tier, '128-256k');
assert.deepEqual(proTokenAudit.unitPriceYuanPerMillionTokens, {
  input: 9.6,
  cachedInput: 1.92,
  output: 48,
});

assert.equal(
  getDoubaoSeedVideoAnalysisPreflightCredits(
    'doubao-seed-2-0-mini-260428',
  ),
  20,
);
assert.equal(
  getDoubaoSeedVideoAnalysisPreflightCredits(
    'doubao-seed-2-0-pro-260215',
  ),
  55,
);

console.log('Doubao video analysis duration pricing verification passed');
