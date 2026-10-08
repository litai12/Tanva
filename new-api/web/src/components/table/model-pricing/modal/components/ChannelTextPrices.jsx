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
import React from 'react';
import { Card, Typography } from '@douyinfe/semi-ui';
import {
  buildChannelTextQuoteRows,
  formatChannelTokenPrice,
} from '../../../../../helpers/channelTextQuoteDisplay';
import { officialTokenPriceCNY } from '../../../../../helpers/channelTextPricing';

const { Text } = Typography;

const ChannelTextPrices = ({ modelData, groupRatio, usableGroup, t }) => {
  const rows = buildChannelTextQuoteRows(
    modelData?.channel_text_prices,
    groupRatio,
    usableGroup,
  );
  if (!rows.length) return null;
  const fields = [
    ['input', t('输入')],
    ['output', t('输出')],
    ['cache_read', t('缓存读取')],
    ['cache_write', t('缓存写入')],
    ['cache_write_5m', t('缓存写入（5分钟）')],
    ['cache_write_1h', t('缓存写入（1小时）')],
    ['image_input', t('图片输入')],
    ['audio_input', t('音频输入')],
  ];
  return (
    <Card className='!rounded-2xl shadow-sm border-0 mb-6'>
      <Text className='text-lg font-medium'>{t('渠道对话售价')}</Text>
      <p className='text-xs text-gray-600 mt-1 mb-4'>
        {t('人民币 / 100万 tokens；已包含官价倍率及所列分组倍率。')}
      </p>
      <div className='space-y-4'>
        {rows.map((row) => (
          <div key={row.key} className='border rounded-lg p-3'>
            <div className='font-medium text-sm'>
              {t('渠道')} #{row.channelId} · {row.group} · {t('分组倍率')}{' '}
              {row.groupRatio}x
            </div>
            {row.priceMultiplier !== undefined && (
              <div className='text-xs mt-1'>
                {t('官价倍率')}：{row.priceMultiplier}×
              </div>
            )}
            {row.official ? (
              <div className='text-xs text-gray-600 mt-1'>
                {t('官方型号')}：{row.official.official_model_id} ·{' '}
                <a
                  className='text-blue-600'
                  href={row.official.source_url}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {t('官方定价来源')}
                </a>{' '}
                · {row.official.verified_at}
                {row.official.effective_until &&
                  ` · ${t('当前官价有效至')} ${row.official.effective_until}`}
              </div>
            ) : (
              <div className='text-xs text-gray-600 mt-1'>
                {t('未绑定可核验官价，沿用上游基准价快照。')}
              </div>
            )}
            <div className='text-xs text-gray-600 my-2'>
              {t('输入上下文')}：{row.lower.toLocaleString('en-US')}
              {' – '}
              {row.upper ? row.upper.toLocaleString('en-US') : t('不限')} tokens
            </div>
            <dl className='grid grid-cols-2 gap-x-4 gap-y-2 text-xs'>
              {fields
                .filter(([key]) => row.rate[key] !== undefined)
                .map(([key, label]) => (
                  <div key={key}>
                    <dt className='text-gray-600'>{label}</dt>
                    <dd className='font-mono'>
                      {formatChannelTokenPrice(row.rate[key], row.groupRatio)}
                    </dd>
                    {row.officialRate?.[key] !== undefined && (
                      <div className='text-gray-500'>
                        {t('官价')}{' '}
                        {formatChannelTokenPrice(
                          officialTokenPriceCNY(
                            row.official,
                            row.officialRate[key],
                            row.officialExchangeRate,
                          ),
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default ChannelTextPrices;
