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
export function preserveChannelTextPricing(setting) {
  if (!setting) return {};
  const parsed = typeof setting === 'string' ? JSON.parse(setting) : setting;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const preserved = {};
  for (const key of ['text_cost_per_million_cny', 'text_sale_multiplier']) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      preserved[key] = parsed[key];
    }
  }
  return preserved;
}
