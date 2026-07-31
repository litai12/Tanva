import assert from 'node:assert/strict';
import {
  calculateDoubaoSeedVideoAnalysisBilling,
  DOUBAO_SEED_VIDEO_ANALYSIS_MARKUP,
  extractNewApiTokenUsage,
  getDoubaoSeedVideoAnalysisPreflightCredits,
  resolveDoubaoSeedVideoAnalysisTier,
  TANVA_CREDITS_PER_YUAN,
} from '../src/ai/services/doubao-seed-video-analysis-pricing';

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
assert.equal(resolveDoubaoSeedVideoAnalysisTier(32_000), '0-32k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(32_001), '32-128k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(128_000), '32-128k');
assert.equal(resolveDoubaoSeedVideoAnalysisTier(128_001), '128-256k');

const liteBase = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-lite-260428',
  {
    inputTokens: 10_000,
    outputTokens: 2_000,
    totalTokens: 12_000,
    cachedInputTokens: 0,
    audioInputTokens: 0,
  },
);
// 官方成本 = 10K×¥0.6/M + 2K×¥3.6/M = ¥0.0132；
// 用户价 = ¥0.0132×1.5 = ¥0.0198 = 1.98 积分，整数积分向上取整为 2。
assert.equal(liteBase.tier, '0-32k');
assert.equal(liteBase.officialCostYuan, 0.0132);
assert.equal(liteBase.retailPriceYuan, 0.0198);
assert.equal(liteBase.exactCredits, 1.98);
assert.equal(liteBase.creditsCharged, 2);

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

const liteCachedMixed = calculateDoubaoSeedVideoAnalysisBilling(
  'doubao-seed-2-0-lite-260428',
  {
    inputTokens: 10_000,
    outputTokens: 1_000,
    totalTokens: 11_000,
    cachedInputTokens: 3_000,
    audioInputTokens: 4_000,
  },
);
assert.deepEqual(liteCachedMixed.tokenBreakdown, {
  regularInputTokens: 3_000,
  cachedInputTokens: 3_000,
  audioInputTokens: 4_000,
  cachedAudioInputTokens: 0,
  outputTokens: 1_000,
});
assert.equal(liteCachedMixed.officialCostYuan, 0.04176);
assert.equal(liteCachedMixed.creditsCharged, 7);

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
    'doubao-seed-2-0-lite-260428',
  ),
  53,
);
assert.equal(
  getDoubaoSeedVideoAnalysisPreflightCredits(
    'doubao-seed-2-0-pro-260215',
  ),
  55,
);

console.log(
  'Doubao video analysis official ×1.5 token pricing verification passed',
);
