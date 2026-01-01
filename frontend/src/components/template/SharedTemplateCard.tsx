import React from 'react';
import type { TemplateIndexEntry } from '@/types/template';
import './template-card.css';

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
  return (
    <div className="tpl-card" onClick={onClick}>
      <div className="tpl-card-thumb">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt={item.name} className="tpl-card-img" />
        ) : (
          <div className="tpl-card-noimg">暂无预览</div>
        )}
        {item.thumbnailSmall ? (
          <img src={item.thumbnailSmall} alt={`${item.name}-mini`} className="tpl-card-small" />
        ) : null}
      </div>
      <div className="tpl-card-body">
        <div className="tpl-card-name">{item.name}</div>
        {item.description ? <div className="tpl-card-desc">{item.description}</div> : null}
        {item.tags && item.tags.length ? <div className="tpl-card-tags">标签：{item.tags.join(' / ')}</div> : null}
      </div>
      {showDelete && (
        <button
          className="tpl-card-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          title="删除模板"
        >
          ×
        </button>
      )}
    </div>
  );
}


