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
import { preserveChannelTextPricing } from './channelTextPricing.js';

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
