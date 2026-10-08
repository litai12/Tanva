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
import React, { useState } from 'react';
import {
  Button,
  Card,
  InputNumber,
  Select,
  Typography,
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../../../helpers';
import {
  isPositiveChannelMultiplier,
  officialTokenPriceCNY,
  preserveChannelTextPricing,
} from '../../../../helpers/channelTextPricing';
import { formatChannelTokenPrice } from '../../../../helpers/channelTextQuoteDisplay';

const { Text } = Typography;

export default function ChannelTextPricingEditor({
  setting,
  channelId,
  onChange,
  onSynchronized,
  t,
}) {
  const [selected, setSelected] = useState('');
  const [syncing, setSyncing] = useState(false);
  const models = Object.keys(setting.text_base_per_million_cny || {}).sort();
  if (!models.length) return null;
  const model = models.includes(selected) ? selected : models[0];
  const base = setting.text_base_per_million_cny[model];
  const official = setting.text_official_pricing?.[model];
  const priceMultiplier = setting.text_price_multiplier;
  const syncOfficial = async () => {
    setSyncing(true);
    try {
      const response = await API.post(
        `/api/channel/${channelId}/official-pricing/sync`,
        {},
      );
      if (!response.data.success)
        throw new Error(response.data.message || t('官价同步失败'));
      const result = response.data.data;
      onSynchronized(preserveChannelTextPricing(result.setting));
      showSuccess(
        t('官价同步完成：更新 {{count}} 个模型，{{skipped}} 个保留原报价', {
          count: result.synced_models.length,
          skipped: result.skipped_models.length,
        }),
      );
    } catch (error) {
      showError(error.message || t('官价同步失败'));
    } finally {
      setSyncing(false);
    }
  };
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
    <Card className='my-4 !rounded-lg'>
      <Text strong>{t('对话模型定价')}</Text>
      <p className='text-xs text-gray-600 my-2'>
        {t(
          '售价 = 人民币官价或基准价 × 官价倍率；分组折扣另计。普通保存保留价格快照。',
        )}
      </p>
      <label className='block text-sm mb-1'>{t('官价倍率')}</label>
      <InputNumber
        aria-label={t('官价倍率')}
        value={priceMultiplier}
        min={0.000001}
        step={0.1}
        suffix='×'
        disabled={syncing}
        onChange={(value) => onChange('text_price_multiplier', value)}
      />
      {!isPositiveChannelMultiplier(priceMultiplier) && (
        <p className='text-xs text-red-600'>{t('官价倍率必须为正数')}</p>
      )}
      <div className='flex items-center justify-between gap-2 my-3'>
        <Text size='small'>
          {t('已配置 {{count}} 个对话模型', { count: models.length })}
        </Text>
        <Button
          size='small'
          type='tertiary'
          loading={syncing}
          disabled={!channelId || syncing}
          onClick={syncOfficial}
        >
          {t('同步官价')}
        </Button>
      </div>
      <p className='text-xs text-gray-600 mb-3'>
        {t(
          '同步只更新已启用且已核验官方型号的人民币官价，保留官价倍率；未绑定型号保留原基准价。',
        )}
      </p>
      <Select
        className='w-full mb-3'
        filter
        value={model}
        onChange={setSelected}
        optionList={models.map((id) => ({ value: id, label: id }))}
      />
      {official ? (
        <>
          <Text className='block text-xs'>
            {t('官方型号')}：{official.official_model_id}
          </Text>
          <div className='grid grid-cols-3 gap-2 text-xs mt-3'>
            <Text>{t('计费维度')}</Text>
            <Text>{t('官方价（人民币）')}</Text>
            <Text>{t('售价（人民币）')}</Text>
            {fields
              .filter(
                ([key]) =>
                  base[key] !== undefined || official[key] !== undefined,
              )
              .map(([key, label]) => (
                <React.Fragment key={key}>
                  <span>{label}</span>
                  <span>{formatChannelTokenPrice(base[key])}</span>
                  <span>
                    {formatChannelTokenPrice(
                      base[key],
                      Number(priceMultiplier),
                    )}
                  </span>
                </React.Fragment>
              ))}
          </div>
          {official.tiers?.length > 1 && (
            <p className='text-xs text-gray-600 mt-2'>
              {t('长上下文按官方档位计费')} ·{' '}
              {official.tiers
                .map(
                  (tier) =>
                    `${tier.max_prompt_tokens ? `≤${tier.max_prompt_tokens}` : t('更长输入')} tokens: ${formatChannelTokenPrice(officialTokenPriceCNY(official, tier.input, setting.text_official_usd_to_cny))} / ${formatChannelTokenPrice(officialTokenPriceCNY(official, tier.output, setting.text_official_usd_to_cny))}`,
                )
                .join('；')}
            </p>
          )}
          {official.effective_until && (
            <p className='text-xs mt-2'>
              {t('当前官价有效至')} {official.effective_until}
            </p>
          )}
          {official.notes && <p className='text-xs mt-2'>{official.notes}</p>}
          <a
            className='text-xs text-blue-600 mt-2 block'
            href={official.source_url}
            target='_blank'
            rel='noopener noreferrer'
          >
            {t('官方定价来源')} · {official.verified_at}
          </a>
        </>
      ) : (
        <>
          <p className='text-xs text-gray-600'>
            {t('该模型未绑定可核验官价，基准价沿用上游快照。')}
          </p>
          <p className='text-xs mt-2'>
            {t('输入基准价')} {formatChannelTokenPrice(base.input)} ·{' '}
            {t('输入售价')}{' '}
            {formatChannelTokenPrice(base.input, Number(priceMultiplier))} / 1M
            tokens
          </p>
        </>
      )}
    </Card>
  );
}
