/** Desktop admission uses explicit gateway kinds and live executable IDs.
 * Names/families never establish a model's modality or price. */
export interface DesktopChannelQuote {
  channel_id: number; model_name: string; currency: 'CNY'; enable_groups: string[];
  input: number; output: number; cache_read?: number; cache_write?: number;
  tiers?: DesktopChannelQuote[]; text_price_multiplier?: number;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const rate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function validRates(value: Record<string, unknown>) {
  if (!rate(value.input) || !(Number(value.input) > 0) || !rate(value.output)) return false;
  for (const key of ['cache_read', 'cache_write', 'cache_write_5m', 'cache_write_1h', 'image_input', 'audio_input']) {
    if (value[key] !== undefined && !rate(value[key])) return false;
  }
  return true;
}
function quote(value: unknown): DesktopChannelQuote | undefined {
  const item = record(value);
  if (!item || item.currency !== 'CNY' || !Number.isSafeInteger(item.channel_id) || Number(item.channel_id) <= 0 ||
      typeof item.model_name !== 'string' || !Array.isArray(item.enable_groups) ||
      !item.enable_groups.length || !item.enable_groups.every(group => typeof group === 'string' && group) || !validRates(item)) return;
  if (item.tiers !== undefined) {
    if (!Array.isArray(item.tiers) || !item.tiers.length) return;
    let prior = 0;
    for (let index = 0; index < item.tiers.length; index++) {
      const tier = record(item.tiers[index]);
      if (!tier || !validRates(tier) || !Number.isSafeInteger(tier.max_prompt_tokens)) return;
      const limit = Number(tier.max_prompt_tokens);
      if (index === item.tiers.length - 1 ? limit !== 0 : limit <= prior) return;
      prior = limit;
    }
  }
  return item as unknown as DesktopChannelQuote;
}
function capabilities(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return; }
  }
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}
export function desktopModelsFromGateway(liveModels: unknown, pricing: unknown) {
  const liveData = record(liveModels)?.data;
  const priceData = record(pricing)?.data;
  if (!Array.isArray(liveData) || !Array.isArray(priceData)) throw new Error('Invalid gateway model catalog');
  const live = new Map<string, Record<string, unknown>>();
  for (const item of liveData) {
    const model = record(item);
    if (typeof model?.id === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(model.id)) live.set(model.id, model);
  }
  return priceData.flatMap(value => {
    const item = record(value);
    if (!item || item.model_kind !== 'chat' || typeof item.model_name !== 'string' || !live.has(item.model_name) ||
        !Array.isArray(item.channel_text_prices)) return [];
    const quotes = item.channel_text_prices.map(quote).filter((value): value is DesktopChannelQuote => !!value && value.model_name === item.model_name);
    if (!quotes.length) return [];
    const multipliers = quotes.map(quote => quote.text_price_multiplier);
    const uniformMultiplier = multipliers.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value === multipliers[0])
      ? multipliers[0] : undefined;
    const declared = capabilities(item.capabilities) ?? capabilities(live.get(item.model_name)?.capabilities);
    const efforts = Array.isArray(item.reasoning_efforts) && item.reasoning_efforts.every(effort => typeof effort === 'string') ? item.reasoning_efforts : [];
    return [{ id: item.model_name, name: item.model_name, available: true, streaming: false,
      ...(declared ? { supportsTools: declared.includes('function_calling') || declared.includes('tool_calls'),
        supportsVision: declared.includes('vision') || declared.includes('image_input') } : {}),
      reasoningEfforts: efforts,
      pricing: { unit: 'token', currency: 'credits', priceCurrency: 'CNY', rounding: 'ceil', markup: 1,
        settlementSource: 'new_api_consumption', creditsPerYuan: 100, quota_type: 0,
        ...(uniformMultiplier !== undefined ? { input_ratio: uniformMultiplier } : {}),
        inputCnyPerMillion: Math.max(...quotes.map(quote => quote.input)),
        outputCnyPerMillion: Math.max(...quotes.map(quote => quote.output)),
        channel_text_prices: quotes } }];
  });
}
