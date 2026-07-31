import assert from 'node:assert/strict';
import {
  calculateDoubaoSeedLiteVideoAnalysisDurationBilling,
  calculateDoubaoSeedVideoAnalysisBilling,
  DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_DENOMINATOR,
  DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_NUMERATOR,
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
assert.equal(DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_NUMERATOR, 1);
assert.equal(DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_DENOMINATOR, 3);
assert.equal(resolveDoubaoSeedVideoAnalysisTier(32_000), '0-32k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(32_001), '32-128k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(128_000), '32-128k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(128_001), '128-256k');

const miniBase = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-mini-260428',
  {
    inputTokens: 10_000,
    outputTokens: 2_000,
    totalTokens: 12_000,
    cachedInputTokens: 0,
    audioInputTokens: 0,
  },
);
// Mini/Pro continue to use token metering. Lite has a separate duration price.
assert.equal(miniBase.tier, '0-32k');
assert.equal(miniBase.officialCostYuan, 0.006);
assert.equal(miniBase.retailPriceYuan, 0.009);
assert.equal(miniBase.exactCredits, 0.9);
assert.equal(miniBase.creditsCharged, 1);

const miniAudio = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-mini-260428',
  {
    inputTokens: 10_000,
    outputTokens: 1_000,
    totalTokens: 11_000,
    cachedInputTokens: 0,
    audioInputTokens: 10_000,
  },
);
assert.equal(miniAudio.officialCostYuan, 0.032);
assert.equal(miniAudio.exactCredits, 4.8);
assert.equal(miniAudio.creditsCharged, 5);

const miniCachedMixed = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-mini-260428',
  {
    inputTokens: 10_000,
    outputTokens: 1_000,
    totalTokens: 11_000,
    cachedInputTokens: 3_000,
    audioInputTokens: 4_000,
  },
);
assert.deepEqual(miniCachedMixed.tokenBreakdown, {
  regularInputTokens: 3_000,
  cachedInputTokens: 3_000,
  audioInputTokens: 4_000,
  cachedAudioInputTokens: 0,
  outputTokens: 1_000,
});
assert.equal(miniCachedMixed.officialCostYuan, 0.01472);
assert.equal(miniCachedMixed.creditsCharged, 3);

const durationCases = [
  { durationSec: 1, exactCredits: 41.66666667, creditsCharged: 42 },
  { durationSec: 3, exactCredits: 125, creditsCharged: 125 },
  { durationSec: 5, exactCredits: 208.33333333, creditsCharged: 209 },
  { durationSec: 10, exactCredits: 416.66666667, creditsCharged: 417 },
  { durationSec: 30, exactCredits: 1_250, creditsCharged: 1_250 },
  { durationSec: 60, exactCredits: 2_500, creditsCharged: 2_500 },
] as const;

for (const expected of durationCases) {
  const billing = calculateDoubaoSeedLiteVideoAnalysisDurationBilling(
    expected.durationSec,
  );
  assert.equal(billing.billingMode, 'duration_metered');
  assert.equal(billing.durationSec, expected.durationSec);
  assert.equal(billing.pricingAnchor, 'seedance-2.0-480p');
  assert.equal(billing.seedance20PriceYuanPerSecond, 1.25);
  assert.deepEqual(billing.priceRatio, { numerator: 1, denominator: 3 });
  assert.equal(billing.exactCredits, expected.exactCredits);
  assert.equal(billing.creditsCharged, expected.creditsCharged);
}

assert.throws(
  () => calculateDoubaoSeedLiteVideoAnalysisDurationBilling(0),
  /duration must be positive/,
);

const miniCachedAudio = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-mini-260428',
  {
    inputTokens: 10_000,
    outputTokens: 1_000,
    totalTokens: 11_000,
    cachedInputTokens: 8_000,
    audioInputTokens: 4_000,
  },
);
assert.deepEqual(miniCachedAudio.tokenBreakdown, {
  regularInputTokens: 0,
  cachedInputTokens: 6_000,
  audioInputTokens: 2_000,
  cachedAudioInputTokens: 2_000,
  outputTokens: 1_000,
});
assert.equal(miniCachedAudio.officialCostYuan, 0.00944);
assert.equal(miniCachedAudio.creditsCharged, 2);

const proHigh = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-pro-260215',
  {
    inputTokens: 128_001,
    outputTokens: 1_000,
    totalTokens: 129_001,
    cachedInputTokens: 0,
    audioInputTokens: 0,
  },
);
assert.equal(proHigh.tier, '128-256k');
assert.deepEqual(proHigh.unitPriceYuanPerMillionTokens, {
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

console.log(
  'Doubao video analysis duration/token pricing verification passed',
);
