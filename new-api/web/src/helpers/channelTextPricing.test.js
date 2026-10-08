/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict';
import {
  channelOfficialInputMultiplier,
  isPositiveChannelMultiplier,
  officialTokenPriceCNY,
  preserveChannelTextPricing,
} from './channelTextPricing.js';

const contract = {
  text_cost_per_million_cny: {
    'gpt-6.1-sol': { input: 2.92, output: 14.6, cache_read: 0.292 },
    'claude-opus-4-6': { input: 7.3, output: 36.5, cache_create: 9.125 },
  },
  text_sale_multiplier: 2,
};
const loadedSetting = JSON.stringify({
  ...contract,
  force_format: false,
  unrelated: 'omit',
});
const editorSettings = {
  ...preserveChannelTextPricing(loadedSetting),
  force_format: false,
  proxy: '',
};
// The advanced-setting handler serializes its loaded state after a change.
const changedSetting = JSON.stringify({
  ...editorSettings,
  force_format: true,
});
// Submit rebuilds setting from the edited fields, retaining just this contract.
const savedSetting = JSON.stringify({
  ...preserveChannelTextPricing(changedSetting),
  force_format: true,
  system_prompt: 'updated prompt',
});
assert.deepEqual(preserveChannelTextPricing(savedSetting), contract);
assert.equal(JSON.parse(savedSetting).force_format, true);
assert.equal(JSON.parse(savedSetting).system_prompt, 'updated prompt');
assert.equal(JSON.parse(savedSetting).unrelated, undefined);
assert.deepEqual(preserveChannelTextPricing('{}'), {});
assert.deepEqual(preserveChannelTextPricing(undefined), {});
assert.deepEqual(preserveChannelTextPricing({ text_sale_multiplier: 0 }), {
  text_sale_multiplier: 0,
});
assert.deepEqual(
  preserveChannelTextPricing({ text_cost_per_million_cny: {} }),
  { text_cost_per_million_cny: {} },
);
console.log('Channel text pricing contract: edit/save roundtrip passed');

const official = {
  currency: 'USD',
  official_model_id: 'verified-model',
  input: 2,
  output: 10,
  source_url: 'https://example.test/pricing',
  verified_at: '2026-10-08',
};
const singleContract = {
  text_base_per_million_cny: { 'verified-model': { input: 14.6, output: 73 } },
  text_price_multiplier: 0.4,
  text_official_pricing: { 'verified-model': official },
  text_official_usd_to_cny: 7.3,
};
const editedSingle = {
  ...preserveChannelTextPricing(JSON.stringify(singleContract)),
  text_price_multiplier: 0.6,
};
assert.equal(editedSingle.text_price_multiplier, 0.6);
assert.deepEqual(
  editedSingle.text_base_per_million_cny,
  singleContract.text_base_per_million_cny,
);
assert.deepEqual(
  editedSingle.text_official_pricing,
  singleContract.text_official_pricing,
);
assert.equal(officialTokenPriceCNY(official, 2, 7.3), 14.6);
assert.equal(officialTokenPriceCNY({ currency: 'CNY' }, 2, 7.3), 2);
assert.equal(officialTokenPriceCNY(official, undefined, 7.3), undefined);
assert.equal(channelOfficialInputMultiplier(14.6, 0.4, official, 7.3), 0.4);
for (const value of [0, -1, NaN, Infinity, '', null, undefined])
  assert.equal(isPositiveChannelMultiplier(value), false);
assert.equal(isPositiveChannelMultiplier(0.4), true);
