import React from 'react';
import type { SiblingImage } from '../hooks/usePromptSiblingImages';
import SmartImage from '@/components/ui/SmartImage';

type Props = {
  images: SiblingImage[];
  onInsert?: (text: string) => void;
  onImageSelect?: (image: SiblingImage) => void;
};

export default function PromptImageStrip({ images, onInsert, onImageSelect }: Props) {
  if (images.length === 0) return null;

  return (
    <div className="prompt-image-strip nodrag nopan">
      {images.map((img) => (
        <button
          type="button"
          key={`${img.nodeId}::${img.index}`}
          className="prompt-image-strip__card"
          title={`点击插入 @图${img.index}`}
          onPointerDownCapture={(e) => { e.stopPropagation(); }}
          onMouseDownCapture={(e) => { e.stopPropagation(); }}
          onClick={(e) => {
            e.stopPropagation();
            if (onImageSelect) {
              onImageSelect(img);
              return;
            }
            onInsert?.(`@图${img.index}`);
          }}
        >
          <SmartImage
            src={img.url}
            alt={`图${img.index}`}
            className="prompt-image-strip__img"
            draggable={false}
          />
          {img.isVideo && (
            <span className="prompt-image-strip__video-icon" aria-hidden="true">▶</span>
          )}
          <span className="prompt-image-strip__badge">图{img.index}</span>
        </button>
      ))}
    </div>
  );
}
