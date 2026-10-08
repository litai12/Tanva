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
export function formatChannelTokenPrice(value, groupRatio = 1) {
  if (!Number.isFinite(value) || !Number.isFinite(groupRatio)) return '-';
  return `¥${(value * groupRatio).toLocaleString('en-US', { maximumFractionDigits: 10 })}`;
}

// API quotes are already retail CNY/M. Apply only the existing group discount,
// never the explanatory text_sale_multiplier or a currency conversion.
export function buildChannelTextQuoteRows(
  quotes,
  groupRatio = {},
  usableGroup,
) {
  if (!Array.isArray(quotes)) return [];
  return quotes.flatMap((quote) => {
    const groups = Array.isArray(quote.enable_groups)
      ? quote.enable_groups
      : [];
    const rates = quote.tiers?.length ? quote.tiers : [quote];
    return groups
      .filter(
        (group) =>
          !usableGroup ||
          Object.prototype.hasOwnProperty.call(usableGroup, group),
      )
      .flatMap((group) => {
        let lower = 0;
        return rates.map((rate, index) => {
          const upper = rate.max_prompt_tokens || 0;
          const official = quote.official_pricing;
          const officialRate = official?.tiers?.length
            ? official.tiers.find(
                (tier) =>
                  !tier.max_prompt_tokens || lower <= tier.max_prompt_tokens,
              )
            : official;
          const row = {
            key: `${quote.channel_id}/${quote.model_name}/${group}/${index}`,
            channelId: quote.channel_id,
            group,
            groupRatio: groupRatio[group] ?? 1,
            lower,
            upper,
            rate,
            official,
            officialRate,
            officialExchangeRate: quote.baseline_usd_to_cny,
            priceMultiplier: quote.text_price_multiplier,
          };
          lower = upper + 1;
          return row;
        });
      });
  });
}
