import { SEEDANCE20_STANDARD_480P_PRICE_YUAN_PER_SECOND } from './seedance20-pricing';

export const DOUBAO_SEED_VIDEO_ANALYSIS_MARKUP = 1.5;
export const TANVA_CREDITS_PER_YUAN = 100;

// This table is the user-facing product price for Seedance 2.0 video analysis.
// The token ratios below remain separate because they represent upstream
// gateway cost settlement and audit data, not the credits charged to users.
export const DOUBAO_SEED_LITE_VIDEO_ANALYSIS_MODEL =
  'doubao-seed-2-0-lite-260428' as const;
export const DOUBAO_SEED_PRO_SEEDANCE20_480P_PRICE_NUMERATOR = 1;
export const DOUBAO_SEED_PRO_SEEDANCE20_480P_PRICE_DENOMINATOR = 3;
export const DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_NUMERATOR = 1;
export const DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_DENOMINATOR = 10;
export const DOUBAO_SEED_MINI_SEEDANCE20_480P_PRICE_NUMERATOR = 1;
export const DOUBAO_SEED_MINI_SEEDANCE20_480P_PRICE_DENOMINATOR = 20;

// Official VolcEngine model price table (online inference, regular):
// https://www.volcengine.com/docs/82379/1544106
// Price snapshot verified on 2026-07-31.

export type DoubaoSeedVideoAnalysisModel =
  | 'doubao-seed-2-0-mini-260428'
  | 'doubao-seed-2-0-lite-260428'
  | 'doubao-seed-2-0-pro-260215';

export type DoubaoSeedDurationPricedModel = DoubaoSeedVideoAnalysisModel;

export type DoubaoSeedVideoAnalysisTier =
  | '0-32k'
  | '32-128k'
  | '128-256k';

export interface NewApiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  audioInputTokens: number;
}

type OfficialTierPrice = {
  inputYuanPerMillion: number;
  cachedInputYuanPerMillion: number;
  audioInputYuanPerMillion?: number;
  cachedAudioInputYuanPerMillion?: number;
  outputYuanPerMillion: number;
};

export interface DoubaoSeedVideoAnalysisBilling {
  billingMode: 'token_metered';
  model: DoubaoSeedVideoAnalysisModel;
  tier: DoubaoSeedVideoAnalysisTier;
  usage: NewApiTokenUsage;
  tokenBreakdown: {
    regularInputTokens: number;
    cachedInputTokens: number;
    audioInputTokens: number;
    cachedAudioInputTokens: number;
    outputTokens: number;
  };
  unitPriceYuanPerMillionTokens: {
    input: number;
    cachedInput: number;
    audioInput?: number;
    cachedAudioInput?: number;
    output: number;
  };
  officialCostYuan: number;
  markup: typeof DOUBAO_SEED_VIDEO_ANALYSIS_MARKUP;
  retailPriceYuan: number;
  creditsPerYuan: typeof TANVA_CREDITS_PER_YUAN;
  exactCredits: number;
  creditsCharged: number;
}

export interface DoubaoSeedDurationBilling {
  billingMode: 'duration_metered';
  model: DoubaoSeedDurationPricedModel;
  durationSec: number;
  pricingAnchor: 'seedance-2.0-480p';
  seedance20PriceYuanPerSecond: number;
  priceRatio: {
    numerator: number;
    denominator: number;
  };
  exactPriceYuanPerSecond: number;
  retailPriceYuan: number;
  creditsPerYuan: typeof TANVA_CREDITS_PER_YUAN;
  exactCredits: number;
  creditsCharged: number;
}

export type DoubaoSeedLiteVideoAnalysisDurationBilling = DoubaoSeedDurationBilling;

const DOUBAO_SEED_DURATION_PRICE_RATIOS: Record<
  DoubaoSeedDurationPricedModel,
  { numerator: number; denominator: number }
> = {
  'doubao-seed-2-0-pro-260215': {
    numerator: DOUBAO_SEED_PRO_SEEDANCE20_480P_PRICE_NUMERATOR,
    denominator: DOUBAO_SEED_PRO_SEEDANCE20_480P_PRICE_DENOMINATOR,
  },
  'doubao-seed-2-0-lite-260428': {
    numerator: DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_NUMERATOR,
    denominator: DOUBAO_SEED_LITE_SEEDANCE20_480P_PRICE_DENOMINATOR,
  },
  'doubao-seed-2-0-mini-260428': {
    numerator: DOUBAO_SEED_MINI_SEEDANCE20_480P_PRICE_NUMERATOR,
    denominator: DOUBAO_SEED_MINI_SEEDANCE20_480P_PRICE_DENOMINATOR,
  },
};

const OFFICIAL_PRICING: Record<
  DoubaoSeedVideoAnalysisModel,
  Record<DoubaoSeedVideoAnalysisTier, OfficialTierPrice>
> = {
  'doubao-seed-2-0-pro-260215': {
    '0-32k': {
      inputYuanPerMillion: 3.2,
      cachedInputYuanPerMillion: 0.64,
      outputYuanPerMillion: 16,
    },
    '32-128k': {
      inputYuanPerMillion: 4.8,
      cachedInputYuanPerMillion: 0.96,
      outputYuanPerMillion: 24,
    },
    '128-256k': {
      inputYuanPerMillion: 9.6,
      cachedInputYuanPerMillion: 1.92,
      outputYuanPerMillion: 48,
    },
  },
  'doubao-seed-2-0-lite-260428': {
    '0-32k': {
      inputYuanPerMillion: 0.6,
      cachedInputYuanPerMillion: 0.12,
      audioInputYuanPerMillion: 9,
      cachedAudioInputYuanPerMillion: 1.8,
      outputYuanPerMillion: 3.6,
    },
    '32-128k': {
      inputYuanPerMillion: 0.9,
      cachedInputYuanPerMillion: 0.18,
      audioInputYuanPerMillion: 13.5,
      cachedAudioInputYuanPerMillion: 2.7,
      outputYuanPerMillion: 5.4,
    },
    '128-256k': {
      inputYuanPerMillion: 1.8,
      cachedInputYuanPerMillion: 0.36,
      audioInputYuanPerMillion: 27,
      cachedAudioInputYuanPerMillion: 5.4,
      outputYuanPerMillion: 10.8,
    },
  },
  'doubao-seed-2-0-mini-260428': {
    '0-32k': {
      inputYuanPerMillion: 0.2,
      cachedInputYuanPerMillion: 0.04,
      audioInputYuanPerMillion: 3,
      cachedAudioInputYuanPerMillion: 0.6,
      outputYuanPerMillion: 2,
    },
    '32-128k': {
      inputYuanPerMillion: 0.4,
      cachedInputYuanPerMillion: 0.08,
      audioInputYuanPerMillion: 6,
      cachedAudioInputYuanPerMillion: 1.2,
      outputYuanPerMillion: 4,
    },
    '128-256k': {
      inputYuanPerMillion: 0.8,
      cachedInputYuanPerMillion: 0.16,
      audioInputYuanPerMillion: 12,
      cachedAudioInputYuanPerMillion: 2.4,
      outputYuanPerMillion: 8,
    },
  },
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const nonNegativeInteger = (...values: unknown[]): number => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return 0;
};

const roundDecimal = (value: number, digits: number): number =>
  Number(value.toFixed(digits));

export function isDoubaoSeedVideoAnalysisModel(
  model: unknown,
): model is DoubaoSeedVideoAnalysisModel {
  return (
    model === 'doubao-seed-2-0-mini-260428' ||
    model === 'doubao-seed-2-0-lite-260428' ||
    model === 'doubao-seed-2-0-pro-260215'
  );
}

export function isDoubaoSeedDurationPricedModel(
  model: unknown,
): model is DoubaoSeedDurationPricedModel {
  return isDoubaoSeedVideoAnalysisModel(model);
}

export function isDoubaoSeedLiteDurationPricedModel(
  model: unknown,
): model is typeof DOUBAO_SEED_LITE_VIDEO_ANALYSIS_MODEL {
  return model === DOUBAO_SEED_LITE_VIDEO_ANALYSIS_MODEL;
}

/**
 * Product price for Doubao Seed 2.0 video analysis.
 *
 * Contract: the full analyzed media duration is priced against the standard
 * paid Seedance 2.0 480P per-second retail price. The current product ratios
 * are Pro 1/3, Lite 1/10, and Mini 1/20. Calculate the full request first and
 * only then round up to integer Tanva credits.
 */
export function calculateDoubaoSeedVideoAnalysisDurationBilling(
  model: DoubaoSeedDurationPricedModel,
  durationSec: number,
): DoubaoSeedDurationBilling {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new RangeError('Doubao Seed video analysis duration must be positive');
  }

  const normalizedDurationSec = Number(durationSec.toFixed(3));
  const priceRatio = DOUBAO_SEED_DURATION_PRICE_RATIOS[model];
  const rawRetailPriceYuan =
    normalizedDurationSec *
    SEEDANCE20_STANDARD_480P_PRICE_YUAN_PER_SECOND *
    priceRatio.numerator /
    priceRatio.denominator;
  const rawExactCredits = rawRetailPriceYuan * TANVA_CREDITS_PER_YUAN;

  return {
    billingMode: 'duration_metered',
    model,
    durationSec: normalizedDurationSec,
    pricingAnchor: 'seedance-2.0-480p',
    seedance20PriceYuanPerSecond:
      SEEDANCE20_STANDARD_480P_PRICE_YUAN_PER_SECOND,
    priceRatio,
    exactPriceYuanPerSecond: roundDecimal(
      (SEEDANCE20_STANDARD_480P_PRICE_YUAN_PER_SECOND * priceRatio.numerator) /
        priceRatio.denominator,
      12,
    ),
    retailPriceYuan: roundDecimal(rawRetailPriceYuan, 12),
    creditsPerYuan: TANVA_CREDITS_PER_YUAN,
    exactCredits: roundDecimal(rawExactCredits, 8),
    creditsCharged: Math.max(1, Math.ceil(rawExactCredits - 1e-10)),
  };
}

/** Compatibility helper for callers that only handle the Lite model. */
export function calculateDoubaoSeedLiteVideoAnalysisDurationBilling(
  durationSec: number,
): DoubaoSeedLiteVideoAnalysisDurationBilling {
  return calculateDoubaoSeedVideoAnalysisDurationBilling(
    DOUBAO_SEED_LITE_VIDEO_ANALYSIS_MODEL,
    durationSec,
  );
}

/**
 * Normalizes both Responses API and Chat Completions usage payloads.
 *
 * Ark/new-api returns Responses usage as input_tokens/output_tokens and may
 * include cached/audio details. The Chat aliases are accepted so the helper is
 * resilient to a gateway compatibility conversion, but billing callers still
 * enforce a Doubao Seed model.
 */
export function extractNewApiTokenUsage(raw: unknown): NewApiTokenUsage {
  const root = asRecord(raw);
  const nestedData = asRecord(root?.data);
  const usage = asRecord(root?.usage) || asRecord(nestedData?.usage) || {};
  const inputDetails =
    asRecord(usage.input_tokens_details) ||
    asRecord(usage.prompt_tokens_details) ||
    {};

  const inputTokens = nonNegativeInteger(
    usage.input_tokens,
    usage.prompt_tokens,
    usage.inputTokens,
  );
  const outputTokens = nonNegativeInteger(
    usage.output_tokens,
    usage.completion_tokens,
    usage.outputTokens,
  );
  const cachedInputTokens = Math.min(
    inputTokens,
    nonNegativeInteger(
      inputDetails.cached_tokens,
      usage.prompt_cache_hit_tokens,
      usage.cached_tokens,
      usage.cachedInputTokens,
    ),
  );
  const audioInputTokens = Math.min(
    inputTokens,
    nonNegativeInteger(
      inputDetails.audio_tokens,
      usage.audio_input_tokens,
      usage.audioInputTokens,
    ),
  );
  const reportedTotal = nonNegativeInteger(
    usage.total_tokens,
    usage.totalTokens,
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(reportedTotal, inputTokens + outputTokens),
    cachedInputTokens,
    audioInputTokens,
  };
}

export function resolveDoubaoSeedVideoAnalysisTier(
  inputTokens: number,
): DoubaoSeedVideoAnalysisTier {
  if (inputTokens <= 32_000) return '0-32k';
  if (inputTokens <= 128_000) return '32-128k';
  return '128-256k';
}

export function calculateDoubaoSeedVideoAnalysisBilling(
  model: DoubaoSeedVideoAnalysisModel,
  usage: NewApiTokenUsage,
): DoubaoSeedVideoAnalysisBilling {
  const normalizedUsage: NewApiTokenUsage = {
    inputTokens: nonNegativeInteger(usage.inputTokens),
    outputTokens: nonNegativeInteger(usage.outputTokens),
    totalTokens: nonNegativeInteger(usage.totalTokens),
    cachedInputTokens: 0,
    audioInputTokens: 0,
  };
  normalizedUsage.cachedInputTokens = Math.min(
    normalizedUsage.inputTokens,
    nonNegativeInteger(usage.cachedInputTokens),
  );
  normalizedUsage.audioInputTokens = Math.min(
    normalizedUsage.inputTokens,
    nonNegativeInteger(usage.audioInputTokens),
  );
  normalizedUsage.totalTokens = Math.max(
    normalizedUsage.totalTokens,
    normalizedUsage.inputTokens + normalizedUsage.outputTokens,
  );

  const tier = resolveDoubaoSeedVideoAnalysisTier(normalizedUsage.inputTokens);
  const unitPrice = OFFICIAL_PRICING[model][tier];

  // Responses only exposes one cached_tokens total. Allocate cache hits to
  // non-audio input first, then to audio if the cached total exceeds it.
  const nonAudioInputTokens = Math.max(
    0,
    normalizedUsage.inputTokens - normalizedUsage.audioInputTokens,
  );
  const cachedInputTokens = Math.min(
    normalizedUsage.cachedInputTokens,
    nonAudioInputTokens,
  );
  const cachedAudioInputTokens = Math.min(
    normalizedUsage.audioInputTokens,
    Math.max(0, normalizedUsage.cachedInputTokens - cachedInputTokens),
  );
  const regularInputTokens = Math.max(
    0,
    nonAudioInputTokens - cachedInputTokens,
  );
  const regularAudioInputTokens = Math.max(
    0,
    normalizedUsage.audioInputTokens - cachedAudioInputTokens,
  );

  // Pro does not publish an audio-input price. If the gateway unexpectedly
  // labels any Pro input as audio, bill it at the regular/cache input rate
  // instead of silently making those tokens free.
  const audioInputPrice =
    unitPrice.audioInputYuanPerMillion ?? unitPrice.inputYuanPerMillion;
  const cachedAudioInputPrice =
    unitPrice.cachedAudioInputYuanPerMillion ??
    unitPrice.cachedInputYuanPerMillion;

  const rawOfficialCostYuan =
    (
      regularInputTokens * unitPrice.inputYuanPerMillion +
      cachedInputTokens * unitPrice.cachedInputYuanPerMillion +
      regularAudioInputTokens * audioInputPrice +
      cachedAudioInputTokens * cachedAudioInputPrice +
      normalizedUsage.outputTokens * unitPrice.outputYuanPerMillion
    ) /
    1_000_000;
  const rawRetailPriceYuan =
    rawOfficialCostYuan * DOUBAO_SEED_VIDEO_ANALYSIS_MARKUP;
  const rawExactCredits = rawRetailPriceYuan * TANVA_CREDITS_PER_YUAN;
  const officialCostYuan = roundDecimal(rawOfficialCostYuan, 12);
  const retailPriceYuan = roundDecimal(rawRetailPriceYuan, 12);
  const exactCredits = roundDecimal(rawExactCredits, 8);
  const creditsCharged =
    rawExactCredits > 0
      ? Math.max(1, Math.ceil(rawExactCredits - 1e-10))
      : 0;

  return {
    billingMode: 'token_metered',
    model,
    tier,
    usage: normalizedUsage,
    tokenBreakdown: {
      regularInputTokens,
      cachedInputTokens,
      audioInputTokens: regularAudioInputTokens,
      cachedAudioInputTokens,
      outputTokens: normalizedUsage.outputTokens,
    },
    unitPriceYuanPerMillionTokens: {
      input: unitPrice.inputYuanPerMillion,
      cachedInput: unitPrice.cachedInputYuanPerMillion,
      ...(unitPrice.audioInputYuanPerMillion !== undefined
        ? { audioInput: unitPrice.audioInputYuanPerMillion }
        : {}),
      ...(unitPrice.cachedAudioInputYuanPerMillion !== undefined
        ? { cachedAudioInput: unitPrice.cachedAudioInputYuanPerMillion }
        : {}),
      output: unitPrice.outputYuanPerMillion,
    },
    officialCostYuan,
    markup: DOUBAO_SEED_VIDEO_ANALYSIS_MARKUP,
    retailPriceYuan,
    creditsPerYuan: TANVA_CREDITS_PER_YUAN,
    exactCredits,
    creditsCharged,
  };
}

/**
 * A lightweight preflight balance guard, not the final price. It covers the
 * first official context tier (32K input plus the configured 16,384-token
 * output ceiling); final deduction always uses the returned usage.
 */
export function getDoubaoSeedVideoAnalysisPreflightCredits(
  model: DoubaoSeedVideoAnalysisModel,
): number {
  const price = OFFICIAL_PRICING[model]['0-32k'];
  const inputPrice = Math.max(
    price.inputYuanPerMillion,
    price.audioInputYuanPerMillion ?? 0,
  );
  const officialMaximum =
    (32_000 * inputPrice + 16_384 * price.outputYuanPerMillion) /
    1_000_000;
  return Math.ceil(
    officialMaximum *
      DOUBAO_SEED_VIDEO_ANALYSIS_MARKUP *
      TANVA_CREDITS_PER_YUAN,
  );
}
