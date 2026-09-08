import React, { useEffect, useState } from 'react';
import { resolveLogImageSource } from '../../../helpers/logImageSource';
import { Image } from '@douyinfe/semi-ui';

export default function MjImageThumbnail({ src, alt, onOpen, t }) {
  const [preview, setPreview] = useState({ source: '', url: '' });
  useEffect(() => {
    const resolved = resolveLogImageSource(src);
    setPreview({ source: src, url: resolved.url });
    return resolved.release;
  }, [src]);
  const imageUrl = preview.source === src ? preview.url : '';
  if (!imageUrl) return <span role='status'>{t('图片不可预览')}</span>;
  return (
    <a
      href={imageUrl}
      aria-label={alt}
      onClick={(event) => {
        event.preventDefault();
        onOpen(imageUrl);
      }}
      style={{ display: 'inline-flex', flexShrink: 0 }}
    >
      <Image
        src={imageUrl}
        alt={alt}
        width={96}
        height={80}
        loading='lazy'
        preview={false}
        imgStyle={{ objectFit: 'contain' }}
        style={{ borderRadius: 6, overflow: 'hidden' }}
        fallback={<span role='status'>{t('图片加载失败')}</span>}
      />
    </a>
  );
}
