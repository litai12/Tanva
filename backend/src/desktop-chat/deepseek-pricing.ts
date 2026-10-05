// Official CNY prices and UTC peak windows:
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
// Official 2026 Chinese holidays (the entire published holiday range applies):
// https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
export const DEEPSEEK_PRICING_VERSION = 'deepseek-flash-cny-2026-09-10-v1' as const;
export const DEEPSEEK_CREDIT_NANOS = 1_000_000_000n;

export interface DeepSeekHolidayCalendar {
  version: string;
  holidaysByYear: Readonly<Record<number, readonly string[]>>;
}

const holidayDates = (month: string, first: number, last: number): string[] =>
  Array.from({ length: last - first + 1 }, (_, index) =>
    `2026-${month}-${String(first + index).padStart(2, '0')}`);

export const DEEPSEEK_HOLIDAY_CALENDAR: DeepSeekHolidayCalendar = {
  version: 'cn-state-council-2026-20251104',
  holidaysByYear: {
    2026: [
      ...holidayDates('01', 1, 3), ...holidayDates('02', 15, 23),
      ...holidayDates('04', 4, 6), ...holidayDates('05', 1, 5),
      ...holidayDates('06', 19, 21), ...holidayDates('09', 25, 27),
      ...holidayDates('10', 1, 7),
    ],
  },
};

export interface DeepSeekPricingSnapshot {
  version: typeof DEEPSEEK_PRICING_VERSION;
  model: 'deepseek-flash';
  period: 'peak' | 'off_peak';
  requestedAt: string;
  beijingDate: string;
  holidayCalendarVersion: string;
  pricesCnyPerMillion: { cacheHit: number; cacheMiss: number; output: number };
  priceCurrency: 'CNY';
  markup: 1.5;
  creditsPerYuan: 100;
  rounding: 'ceil';
}

export interface DeepSeekNormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  totalTokens: number;
}

export interface DeepSeekUsageCalculation {
  /** Exact at nano-credit precision; never round to whole credits here. */
  exactCredits: number;
  /** Persist the exact amount for settlement and audit without floating-point drift. */
  exactCreditNanos: string;
  exactCreditsDecimal: string;
  officialCostCny: number;
  officialCostCnyDecimal: string;
  usage: DeepSeekNormalizedUsage;
}

const pricesFor = (period: DeepSeekPricingSnapshot['period']) => period === 'peak'
  ? { cacheHit: 0.04, cacheMiss: 2, output: 8 }
  : { cacheHit: 0.02, cacheMiss: 1, output: 4 };

export const createDeepSeekPricingSnapshot = (
  at: Date,
  calendar: DeepSeekHolidayCalendar = DEEPSEEK_HOLIDAY_CALENDAR,
): DeepSeekPricingSnapshot => {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new Error('DeepSeek pricing requires a valid request timestamp');
  }
  const beijingDate = new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const holidays = calendar.holidaysByYear[Number(beijingDate.slice(0, 4))];
  if (!Array.isArray(holidays) || !calendar.version) {
    throw new Error(`DeepSeek quote unavailable: Chinese holiday calendar is unknown for ${beijingDate.slice(0, 4)}`);
  }
  const weekday = at.getUTCDay();
  const hour = at.getUTCHours();
  // Makeup workdays on Saturday/Sunday remain off-peak under DeepSeek's rule.
  const peak = weekday >= 1 && weekday <= 5 && !holidays.includes(beijingDate)
    && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
  const period = peak ? 'peak' : 'off_peak';
  return {
    version: DEEPSEEK_PRICING_VERSION,
    model: 'deepseek-flash', period, requestedAt: at.toISOString(), beijingDate,
    holidayCalendarVersion: calendar.version,
    pricesCnyPerMillion: pricesFor(period), priceCurrency: 'CNY',
    markup: 1.5, creditsPerYuan: 100, rounding: 'ceil',
  };
};

const object = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid DeepSeek ${field}: expected an object`);
  }
  return value as Record<string, unknown>;
};

const tokens = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid DeepSeek usage ${field}: expected a nonnegative safe integer`);
  }
  return value;
};

const optionalTokens = (source: Record<string, unknown>, field: string): number | undefined =>
  source[field] === undefined ? undefined : tokens(source[field], field);

const agree = (first: number | undefined, second: number | undefined, field: string) => {
  if (first !== undefined && second !== undefined && first !== second) {
    throw new Error(`Conflicting DeepSeek usage ${field}`);
  }
  return first ?? second;
};

const cachedTokens = (source: Record<string, unknown>, field: string): number | undefined =>
  source[field] === undefined ? undefined : optionalTokens(object(source[field], field), 'cached_tokens');

export const normalizeDeepSeekUsage = (usage: unknown): DeepSeekNormalizedUsage => {
  const raw = object(usage, 'usage');
  const input = agree(optionalTokens(raw, 'input_tokens'), optionalTokens(raw, 'prompt_tokens'), 'input tokens');
  const output = agree(optionalTokens(raw, 'output_tokens'), optionalTokens(raw, 'completion_tokens'), 'output tokens');
  if (input === undefined || output === undefined) {
    throw new Error('DeepSeek usage requires input and output token counts');
  }
  const standardHit = agree(cachedTokens(raw, 'input_tokens_details'), cachedTokens(raw, 'prompt_tokens_details'), 'standard cache tokens');
  // Standard cached_tokens takes precedence, but disagreeing legacy counters are
  // invalid rather than silently selecting a different billable quantity.
  const hitReported = agree(standardHit, optionalTokens(raw, 'prompt_cache_hit_tokens'), 'cache hit tokens');
  const missReported = optionalTokens(raw, 'prompt_cache_miss_tokens');
  if (hitReported === undefined && missReported === undefined) {
    throw new Error('DeepSeek usage requires cache hit or cache miss token counts');
  }
  const hit = hitReported ?? input - missReported!;
  if (hit < 0 || hit > input || (missReported !== undefined && hit + missReported !== input)) {
    throw new Error('Invalid DeepSeek cache usage: cache hit + miss must equal input tokens');
  }
  const total = input + output;
  if (!Number.isSafeInteger(total)) throw new Error('Invalid DeepSeek usage: total tokens exceeds safe integer range');
  const reportedTotal = optionalTokens(raw, 'total_tokens');
  if (reportedTotal !== undefined && reportedTotal !== total) {
    throw new Error('Invalid DeepSeek usage: total tokens must equal input + output tokens');
  }
  return { inputTokens: input, outputTokens: output, cacheHitTokens: hit, cacheMissTokens: input - hit, totalTokens: total };
};

const decimalString = (amount: bigint, fractionalDigits: number): string => {
  const scale = 10n ** BigInt(fractionalDigits);
  const whole = (amount / scale).toString();
  const fraction = (amount % scale).toString().padStart(fractionalDigits, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};

export const calculateDeepSeekUsage = (
  snapshot: DeepSeekPricingSnapshot,
  usage: unknown,
): DeepSeekUsageCalculation => {
  if (snapshot.version !== DEEPSEEK_PRICING_VERSION || snapshot.model !== 'deepseek-flash'
      || !['peak', 'off_peak'].includes(snapshot.period) || snapshot.markup !== 1.5
      || snapshot.creditsPerYuan !== 100 || snapshot.priceCurrency !== 'CNY' || snapshot.rounding !== 'ceil') {
    throw new Error('Invalid DeepSeek pricing snapshot');
  }
  const expected = pricesFor(snapshot.period);
  if (snapshot.pricesCnyPerMillion.cacheHit !== expected.cacheHit
      || snapshot.pricesCnyPerMillion.cacheMiss !== expected.cacheMiss
      || snapshot.pricesCnyPerMillion.output !== expected.output) {
    throw new Error('Invalid DeepSeek official price snapshot');
  }
  const normalized = normalizeDeepSeekUsage(usage);
  // Official off-peak rates in fen per million tokens: 2/100/400.
  // CNY = weighted / 1e8; credit nanos = CNY * 150 * 1e9.
  const multiplier = snapshot.period === 'peak' ? 2n : 1n;
  const weighted = multiplier * (BigInt(normalized.cacheHitTokens) * 2n
    + BigInt(normalized.cacheMissTokens) * 100n + BigInt(normalized.outputTokens) * 400n);
  const nanos = weighted * 1500n;
  const exactCredits = Number(nanos) / Number(DEEPSEEK_CREDIT_NANOS);
  const officialCostCny = Number(weighted) / 100_000_000;
  if (!Number.isFinite(exactCredits) || !Number.isFinite(officialCostCny)) {
    throw new Error('DeepSeek pricing amount exceeds supported numeric range');
  }
  return {
    exactCredits, exactCreditNanos: nanos.toString(), exactCreditsDecimal: decimalString(nanos, 9),
    officialCostCny, officialCostCnyDecimal: decimalString(weighted, 8), usage: normalized,
  };
};

export interface DeepSeekReservation extends DeepSeekUsageCalculation {
  creditsReserved: number;
  inputTokenBudget: number;
  outputTokenBudget: number;
  inputBudgetBasis: 'text_bytes_with_overhead' | 'multimodal_context_maximum';
  outputBudgetBasis: 'explicit_max_tokens' | 'official_output_maximum';
}

// These are provider capability ceilings, not limits imposed on the user's body.
export const DEEPSEEK_CONTEXT_TOKEN_MAXIMUM = 1_000_000;
export const DEEPSEEK_OUTPUT_TOKEN_MAXIMUM = 384_000;

const hasImage = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasImage);
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return fields.type === 'image_url' || fields.type === 'input_image'
    || fields.image_url !== undefined || fields.image !== undefined
    || Object.values(fields).some(hasImage);
};

export const estimateDeepSeekReservation = (
  snapshot: DeepSeekPricingSnapshot,
  requestBody: Record<string, unknown>,
): DeepSeekReservation => {
  const maxTokens = optionalTokens(requestBody, 'max_tokens');
  const maxCompletionTokens = optionalTokens(requestBody, 'max_completion_tokens');
  const explicitMaximum = agree(maxTokens, maxCompletionTokens, 'output budget');
  if (explicitMaximum !== undefined && (explicitMaximum < 1 || explicitMaximum > DEEPSEEK_OUTPUT_TOKEN_MAXIMUM)) {
    throw new Error('DeepSeek output budget must be between 1 and 384000 tokens');
  }
  const serialized = JSON.stringify(requestBody);
  const image = hasImage(requestBody);
  // A byte bound includes text/tool JSON; per-message plus fixed overhead
  // accounts for provider framing. For images use the full context ceiling.
  const messages = Array.isArray(requestBody.messages) ? requestBody.messages.length : 0;
  const inputTokenBudget = image ? DEEPSEEK_CONTEXT_TOKEN_MAXIMUM
    : Math.min(DEEPSEEK_CONTEXT_TOKEN_MAXIMUM, Buffer.byteLength(serialized, 'utf8') + messages * 24 + 1024);
  const outputTokenBudget = explicitMaximum ?? DEEPSEEK_OUTPUT_TOKEN_MAXIMUM;
  const calculation = calculateDeepSeekUsage(snapshot, {
    prompt_tokens: inputTokenBudget, completion_tokens: outputTokenBudget,
    prompt_cache_hit_tokens: 0,
  });
  const nanos = BigInt(calculation.exactCreditNanos);
  // Reserve the upper-bound integer expense; settlement rounds each physical request up.
  const creditsReserved = Number((nanos + DEEPSEEK_CREDIT_NANOS - 1n) / DEEPSEEK_CREDIT_NANOS);
  return {
    ...calculation, creditsReserved, inputTokenBudget, outputTokenBudget,
    inputBudgetBasis: image ? 'multimodal_context_maximum' : 'text_bytes_with_overhead',
    outputBudgetBasis: explicitMaximum === undefined ? 'official_output_maximum' : 'explicit_max_tokens',
  };
};

/** User policy: each physical request rounds its exact fee upward once. */
export const roundUpDeepSeekCredits = (exactCreditNanos: string): number => {
  if (!/^\d{1,30}$/.test(exactCreditNanos)) throw new Error('Invalid DeepSeek exact amount');
  const nanos = BigInt(exactCreditNanos);
  const credits = (nanos + DEEPSEEK_CREDIT_NANOS - 1n) / DEEPSEEK_CREDIT_NANOS;
  if (credits > 2147483647n) throw new Error('DeepSeek integer credit charge overflow');
  return Number(credits);
};
