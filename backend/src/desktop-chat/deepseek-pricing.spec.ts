import assert from 'node:assert/strict';
import {
  DEEPSEEK_CREDIT_NANOS,
  DEEPSEEK_HOLIDAY_CALENDAR,
  calculateDeepSeekUsage,
  createDeepSeekPricingSnapshot,
  estimateDeepSeekReservation,
  normalizeDeepSeekUsage, roundUpDeepSeekCredits,
} from './deepseek-pricing';

const snapshotAt = (time: string) => createDeepSeekPricingSnapshot(new Date(time));
const offPeak = snapshotAt('2026-10-05T01:00:00.000Z');
const peak = snapshotAt('2026-10-08T01:00:00.000Z');

const run = (): void => {
  assert.deepEqual(offPeak.pricesCnyPerMillion, { cacheHit: 0.02, cacheMiss: 1, output: 4 });
  assert.deepEqual(peak.pricesCnyPerMillion, { cacheHit: 0.04, cacheMiss: 2, output: 8 });
  assert.equal(offPeak.priceCurrency, 'CNY');
  assert.equal(offPeak.markup, 1.5);
  assert.equal(offPeak.creditsPerYuan, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(offPeak)), offPeak);

  // Each inclusive start and exclusive end, with millisecond precision.
  for (const [time, period] of [
    ['00:59:59.999', 'off_peak'], ['01:00:00.000', 'peak'],
    ['03:59:59.999', 'peak'], ['04:00:00.000', 'off_peak'],
    ['05:59:59.999', 'off_peak'], ['06:00:00.000', 'peak'],
    ['09:59:59.999', 'peak'], ['10:00:00.000', 'off_peak'],
  ]) {
    assert.equal(snapshotAt(`2026-10-08T${time}Z`).period, period, time);
  }
  for (const day of DEEPSEEK_HOLIDAY_CALENDAR.holidaysByYear[2026]) {
    assert.equal(snapshotAt(`${day}T01:00:00Z`).period, 'off_peak', day);
    assert.equal(snapshotAt(`${day}T06:00:00Z`).period, 'off_peak', day);
  }
  for (const day of ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']) {
    assert.equal(snapshotAt(`${day}T01:00:00Z`).period, 'off_peak', `makeup weekend ${day}`);
  }
  assert.equal(snapshotAt('2026-10-09T09:00:00Z').period, 'peak'); // Friday
  assert.equal(snapshotAt('2026-10-11T09:00:00Z').period, 'off_peak'); // Sunday
  assert.equal(snapshotAt('2026-09-30T09:00:00Z').period, 'peak');
  assert.equal(snapshotAt('2025-12-31T16:00:00Z').beijingDate, '2026-01-01');
  assert.throws(() => snapshotAt('2026-12-31T16:00:00Z'), /calendar is unknown for 2027/);
  assert.throws(() => snapshotAt('2025-12-31T15:59:59Z'), /calendar is unknown for 2025/);
  assert.throws(() => createDeepSeekPricingSnapshot(new Date(NaN)), /valid request timestamp/);
  const customCalendar = { version: 'test-2027', holidaysByYear: { 2027: ['2027-01-04'] } };
  assert.equal(createDeepSeekPricingSnapshot(new Date('2027-01-04T01:00:00Z'), customCalendar).period, 'off_peak');
  assert.equal(createDeepSeekPricingSnapshot(new Date('2027-01-05T01:00:00Z'), customCalendar).period, 'peak');

  const realUsage = { prompt_tokens: 18171, completion_tokens: 285, prompt_cache_hit_tokens: 0 };
  const bill = calculateDeepSeekUsage(offPeak, realUsage);
  assert.equal(bill.officialCostCny, 0.019311);
  assert.equal(bill.exactCredits, 2.89665);
  assert.equal(bill.exactCreditNanos, '2896650000');
  assert.equal(bill.exactCreditsDecimal, '2.89665');
  assert.equal(bill.officialCostCnyDecimal, '0.019311');
  assert.equal(calculateDeepSeekUsage(peak, realUsage).exactCreditNanos, '5793300000');
  assert.deepEqual(bill.usage, {
    inputTokens: 18171, outputTokens: 285, cacheHitTokens: 0, cacheMissTokens: 18171, totalTokens: 18456,
  });

  // Both provider-specific and standard cached usage must bill the same tokens.
  const chatCached = {
    prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200,
    prompt_tokens_details: { cached_tokens: 900 }, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100,
  };
  const responsesCached = {
    input_tokens: 1000, output_tokens: 200, total_tokens: 1200,
    input_tokens_details: { cached_tokens: 900 },
  };
  const cached = calculateDeepSeekUsage(offPeak, chatCached);
  assert.equal(cached.officialCostCny, 0.000918);
  assert.equal(cached.exactCredits, 0.1377);
  assert.equal(cached.exactCreditNanos, '137700000');
  assert.deepEqual(calculateDeepSeekUsage(offPeak, responsesCached), cached);
  assert.equal(calculateDeepSeekUsage(offPeak, { prompt_tokens: 1, completion_tokens: 0, prompt_cache_hit_tokens: 1 }).exactCreditNanos, '3000');
  assert.equal(calculateDeepSeekUsage(offPeak, { prompt_tokens: 1, completion_tokens: 0, prompt_cache_hit_tokens: 0 }).exactCreditNanos, '150000');
  assert.equal(calculateDeepSeekUsage(offPeak, { prompt_tokens: 0, completion_tokens: 1, prompt_cache_hit_tokens: 0 }).exactCreditNanos, '600000');
  assert.equal(calculateDeepSeekUsage(offPeak, { prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0 }).exactCreditNanos, '0');
  assert.equal(calculateDeepSeekUsage(offPeak, { prompt_tokens: 0, completion_tokens: 0, prompt_cache_hit_tokens: 0 }).exactCreditsDecimal, '0');
  assert.equal(normalizeDeepSeekUsage({ prompt_tokens: 1000, completion_tokens: 200, prompt_cache_miss_tokens: 100 }).cacheHitTokens, 900);
  assert.equal(roundUpDeepSeekCredits(bill.exactCreditNanos), 3);
  assert.equal(roundUpDeepSeekCredits('0'), 0);
  assert.equal(roundUpDeepSeekCredits('1'), 1);
  assert.equal(roundUpDeepSeekCredits('1000000000'), 1);
  assert.equal(roundUpDeepSeekCredits('1000000001'), 2);
  assert.throws(() => roundUpDeepSeekCredits('-1'));
  assert.throws(() => roundUpDeepSeekCredits('2147483648000000000'));
  // The exact amount remains available independently from integer rounding.
  assert.equal(BigInt(cached.exactCreditNanos) * 100000n, 13770000000000n);
  assert.equal(BigInt('150000') * 200000n, 30000000000n);
  const huge = calculateDeepSeekUsage(offPeak, {
    prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 0, prompt_cache_hit_tokens: 0,
  });
  assert.equal(huge.exactCreditNanos, '1351079888211148650000');
  assert.equal(huge.exactCreditsDecimal, '1351079888211.14865');
  assert.equal(huge.officialCostCnyDecimal, '9007199254.740991');

  for (const bad of [undefined, null, [], {}, { prompt_tokens: 1 }, { completion_tokens: 1 }, { prompt_tokens: 1, completion_tokens: 0 }]) {
    assert.throws(() => normalizeDeepSeekUsage(bad));
  }
  for (const field of ['prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens', 'total_tokens']) {
    for (const bad of [-1, 0.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => normalizeDeepSeekUsage({ prompt_tokens: 1, completion_tokens: 0, prompt_cache_hit_tokens: 0, [field]: bad }), `${field} ${String(bad)}`);
    }
  }
  for (const malformed of [null, [], 'bad', { cached_tokens: -1 }, { cached_tokens: '0' }]) {
    assert.throws(() => normalizeDeepSeekUsage({ prompt_tokens: 1, completion_tokens: 0, prompt_tokens_details: malformed }));
  }
  for (const extra of [
    { input_tokens: 2 }, { output_tokens: 2 },
    { prompt_tokens_details: { cached_tokens: 1 }, prompt_cache_hit_tokens: 0 },
    { prompt_tokens_details: { cached_tokens: 1 }, input_tokens_details: { cached_tokens: 0 } },
    { prompt_cache_hit_tokens: 2 }, { prompt_cache_miss_tokens: 2 },
    { prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 1 }, { total_tokens: 0 },
  ]) {
    assert.throws(() => normalizeDeepSeekUsage({ prompt_tokens: 1, completion_tokens: 0, prompt_cache_hit_tokens: 0, ...extra }));
  }
  assert.throws(() => normalizeDeepSeekUsage({ prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1, prompt_cache_hit_tokens: 0 }), /safe integer/);
  assert.throws(() => calculateDeepSeekUsage({ ...offPeak, markup: 2 } as any, realUsage), /snapshot/);
  assert.throws(() => calculateDeepSeekUsage({ ...offPeak, rounding: 'floor' } as any, realUsage), /snapshot/);
  assert.throws(() => calculateDeepSeekUsage({ ...offPeak, pricesCnyPerMillion: { cacheHit: 0.02, cacheMiss: 2, output: 4 } }, realUsage), /snapshot/);

  const body = { messages: [{ role: 'user', content: '你好🙂' }], max_tokens: 100 };
  const before = JSON.stringify(body);
  const reserved = estimateDeepSeekReservation(offPeak, body);
  assert.equal(JSON.stringify(body), before);
  assert.equal(reserved.inputTokenBudget, Buffer.byteLength(before, 'utf8') + 24 + 1024);
  assert.equal(reserved.outputTokenBudget, 100);
  assert.equal(reserved.outputBudgetBasis, 'explicit_max_tokens');
  assert.equal(reserved.creditsReserved, Math.ceil(reserved.exactCredits));
  assert.equal(estimateDeepSeekReservation(offPeak, { messages: [] }).outputTokenBudget, 384000);
  assert.equal(estimateDeepSeekReservation(offPeak, { max_completion_tokens: 200 }).outputTokenBudget, 200);
  const imageBudget = estimateDeepSeekReservation(offPeak, {
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }],
  });
  assert.equal(imageBudget.inputTokenBudget, 1000000);
  assert.equal(imageBudget.outputTokenBudget, 384000);
  assert.equal(imageBudget.creditsReserved, 381);
  assert.equal(imageBudget.inputBudgetBasis, 'multimodal_context_maximum');
  assert.equal(estimateDeepSeekReservation(peak, { image: 'data:image/png;base64,a' }).creditsReserved, 761);
  assert.equal(estimateDeepSeekReservation(offPeak, { messages: [{ content: 'x'.repeat(1000001) }] }).inputTokenBudget, 1000000);
  for (const maximum of [0, -1, 0.5, NaN, '100', 384001]) {
    assert.throws(() => estimateDeepSeekReservation(offPeak, { max_tokens: maximum }));
  }
  assert.throws(() => estimateDeepSeekReservation(offPeak, { max_tokens: 100, max_completion_tokens: 200 }), /Conflicting/);
};

try {
  run();
  console.log('deepseek-pricing.spec: ok');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
