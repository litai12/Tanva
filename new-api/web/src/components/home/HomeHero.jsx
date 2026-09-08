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
import { Button } from '@douyinfe/semi-ui';
import { IconCopy, IconKey } from '@douyinfe/semi-icons';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { copy, showSuccess } from '../../helpers';

const HomeHero = ({ serverAddress, user }) => {
  const { t } = useTranslation();
  const primaryTarget = user ? '/console/token' : '/login';

  const handleCopyBaseUrl = async () => {
    const copied = await copy(serverAddress);
    if (copied) {
      showSuccess(t('接口地址已复制'));
    }
  };

  return (
    <section className='tc-home-hero' aria-labelledby='tc-home-title'>
      <div className='tc-home-hero__content'>
        <div className='tc-home-hero__eyebrow'>
          <span className='tc-home-hero__eyebrow-dot' aria-hidden='true' />
          <span className='tc-home-hero__eyebrow-text'>
            {t('统一 AI 模型基础设施')}
          </span>
        </div>

        <div className='tc-home-hero__copy'>
          <h1 className='tc-home-hero__title' id='tc-home-title'>
            {t('稳定、快速、可观测的大模型接口')}
          </h1>
          <p className='tc-home-hero__description'>
            {t(
              '一个入口连接主流模型。查看实时配置、管理 API 令牌，追踪每次调用。',
            )}
          </p>
        </div>

        <div className='tc-home-endpoint' aria-label={t('API 接入地址')}>
          <div className='tc-home-endpoint__meta'>
            <span className='tc-home-endpoint__label'>{t('API 基址')}</span>
            <span className='tc-home-endpoint__protocol'>
              {serverAddress.startsWith('https:') ? 'HTTPS' : 'HTTP'}
            </span>
          </div>
          <div className='tc-home-endpoint__value-row'>
            <code className='tc-home-endpoint__value'>{serverAddress}</code>
            <Button
              className='tc-home-endpoint__copy'
              theme='borderless'
              type='tertiary'
              icon={<IconCopy className='tc-home-endpoint__copy-icon' />}
              onClick={handleCopyBaseUrl}
              aria-label={t('复制 API 基址')}
            />
          </div>
        </div>

        <div className='tc-home-hero__actions'>
          <Link className='tc-home-hero__primary-link' to={primaryTarget}>
            <Button
              className='tc-home-hero__primary-action'
              theme='solid'
              type='primary'
              icon={<IconKey />}
            >
              {user ? t('管理 API 令牌') : t('登录后使用')}
            </Button>
          </Link>
          <Link className='tc-home-hero__secondary-link' to='/pricing'>
            <Button
              className='tc-home-hero__secondary-action'
              theme='light'
              type='tertiary'
            >
              {t('查看模型与价格')}
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default HomeHero;
