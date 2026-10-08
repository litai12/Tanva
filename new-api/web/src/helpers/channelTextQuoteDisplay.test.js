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
  buildChannelTextQuoteRows,
  formatChannelTokenPrice,
} from './channelTextQuoteDisplay.js';

const quote = {
  channel_id: 77,
  model_name: 'runtime-model',
  enable_groups: ['default', 'vip', 'free', 'hidden'],
  text_sale_multiplier: 2,
  text_price_multiplier: 0.4,
  baseline_usd_to_cny: 7.3,
  official_pricing: {
    currency: 'USD',
    input: 1,
    output: 5,
    tiers: [
      { max_prompt_tokens: 272000, input: 1, output: 5 },
      { max_prompt_tokens: 0, input: 2, output: 7.5 },
    ],
  },
  input: 2.92,
  output: 14.6,
  cache_read: 0.0292,
  tiers: [
    {
      max_prompt_tokens: 272000,
      input: 2.92,
      output: 14.6,
      cache_read: 0.0292,
      cache_write: 0,
    },
    {
      max_prompt_tokens: 0,
      input: 5.84,
      output: 21.9,
      cache_read: 0.0584,
      cache_write: 0.73,
    },
  ],
};
const rows = buildChannelTextQuoteRows(
  [quote],
  { default: 1, vip: 0.5, free: 0 },
  { default: '', vip: '', free: '' },
);
assert.equal(rows.length, 6);
assert.equal(rows[0].priceMultiplier, 0.4);
assert.equal(rows[1].officialRate.input, 2);
assert.equal(rows[0].officialRate.input, 1);
assert.deepEqual(
  rows.slice(0, 2).map(({ lower, upper }) => ({ lower, upper })),
  [
    { lower: 0, upper: 272000 },
    { lower: 272001, upper: 0 },
  ],
);
assert.equal(
  formatChannelTokenPrice(rows[0].rate.input, rows[0].groupRatio),
  '¥2.92',
);
assert.equal(formatChannelTokenPrice(rows[0].rate.cache_read), '¥0.0292');
assert.equal(formatChannelTokenPrice(rows[0].rate.cache_write), '¥0');
assert.equal(formatChannelTokenPrice(rows[1].rate.output), '¥21.9');
assert.equal(
  formatChannelTokenPrice(rows[2].rate.input, rows[2].groupRatio),
  '¥1.46',
);
assert.equal(
  formatChannelTokenPrice(rows[4].rate.input, rows[4].groupRatio),
  '¥0',
);
assert.equal(formatChannelTokenPrice(undefined), '-');
assert.deepEqual(buildChannelTextQuoteRows(undefined), []);
assert.deepEqual(buildChannelTextQuoteRows([], {}, {}), []);
const baseRows = buildChannelTextQuoteRows([{ ...quote, tiers: undefined }]);
assert.equal(baseRows.length, 4);
assert.equal(baseRows[0].upper, 0);
assert.equal(formatChannelTokenPrice(baseRows[0].rate.input), '¥2.92');
console.log(
  'Channel retail CNY/M display: quotes, groups, cache, and context tiers passed',
);
