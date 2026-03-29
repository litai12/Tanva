import React from 'react';
import type { TemplateIndexEntry } from '@/types/template';
import SmartImage from '@/components/ui/SmartImage';
import './template-card.css';
import { useTranslation } from 'react-i18next';

interface Props {
  item: {
    id: string;
    name: string;
    category?: string;
    description?: string;
    tags?: string[];
    thumbnail?: string;
    thumbnailSmall?: string;
  };
  onClick?: () => void;
  onDelete?: () => void;
  showDelete?: boolean;
}

export default function SharedTemplateCard({ item, onClick, onDelete, showDelete }: Props) {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = (zhText: string, enText: string) => (isZh ? zhText : enText);

  return (
    <div className="tpl-card" onClick={onClick}>
      <div className="tpl-card-thumb">
        {item.thumbnail ? (
          <SmartImage src={item.thumbnail} alt={item.name} className="tpl-card-img" />
        ) : (
          <div className="tpl-card-noimg">{lt('暂无预览', 'No preview')}</div>
        )}
        {item.thumbnailSmall ? (
          <SmartImage src={item.thumbnailSmall} alt={`${item.name}-mini`} className="tpl-card-small" />
        ) : null}
      </div>
      <div className="tpl-card-body">
        <div className="tpl-card-name">{item.name}</div>
        {item.description ? <div className="tpl-card-desc">{item.description}</div> : null}
        {item.tags && item.tags.length ? <div className="tpl-card-tags">{lt('标签：', 'Tags: ')}{item.tags.join(' / ')}</div> : null}
      </div>
      {showDelete && (
        <button
          className="tpl-card-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          title={lt('删除模板', 'Delete template')}
        >
          ×
        </button>
      )}
    </div>
  );
}
