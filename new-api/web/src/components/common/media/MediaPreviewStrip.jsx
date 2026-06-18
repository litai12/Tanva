import React from 'react';
import { Image, Typography } from '@douyinfe/semi-ui';
import { IconPlayCircle } from '@douyinfe/semi-icons';

const { Text } = Typography;

const TILE_W = 140;
const TILE_H = 96;

const tileBaseStyle = {
  width: TILE_W,
  height: TILE_H,
  borderRadius: 8,
  border: '1px solid var(--semi-color-border)',
  overflow: 'hidden',
  background: 'var(--semi-color-fill-0)',
  flex: '0 0 auto',
};

/**
 * Renders a horizontal strip of image/video thumbnails extracted from a payload.
 * Display-only preview — clicking an image zooms (Semi PreviewGroup); clicking a
 * video opens it in a new tab (avoids autoplaying remote media in the modal).
 * Returns null when there is nothing to show.
 */
const MediaPreviewStrip = ({
  images = [],
  videos = [],
  totalImages,
  totalVideos,
  t = (x) => x,
}) => {
  if (!images.length && !videos.length) {
    return null;
  }

  const imgCount = typeof totalImages === 'number' ? totalImages : images.length;
  const vidCount = typeof totalVideos === 'number' ? totalVideos : videos.length;
  const truncated = imgCount > images.length || vidCount > videos.length;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Text style={{ fontWeight: 600 }}>{t('媒体预览')}</Text>
        <Text type='tertiary' size='small'>
          {t('图片')} ×{imgCount} · {t('视频')} ×{vidCount}
          {truncated
            ? `（${t('最多显示')} ${images.length + videos.length}）`
            : ''}
        </Text>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {images.length > 0 ? (
          <Image.PreviewGroup>
            {images.map((src) => (
              <Image
                key={src}
                src={src}
                width={TILE_W}
                height={TILE_H}
                style={tileBaseStyle}
                imgStyle={{
                  width: TILE_W,
                  height: TILE_H,
                  objectFit: 'cover',
                  borderRadius: 8,
                }}
                referrerPolicy='no-referrer'
                loading='lazy'
              />
            ))}
          </Image.PreviewGroup>
        ) : null}

        {videos.map((src) => (
          <div
            key={src}
            role='button'
            title={t('在新标签页中打开')}
            onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
            style={{ ...tileBaseStyle, position: 'relative', cursor: 'pointer' }}
          >
            <video
              src={src}
              muted
              preload='metadata'
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                background: 'rgba(0, 0, 0, 0.25)',
                pointerEvents: 'none',
              }}
            >
              <IconPlayCircle size='extra-large' />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MediaPreviewStrip;
