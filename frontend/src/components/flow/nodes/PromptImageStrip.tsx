import React from 'react';
import type { SiblingImage } from '../hooks/usePromptSiblingImages';

type Props = {
  images: SiblingImage[];
  onInsert: (text: string) => void;
};

export default function PromptImageStrip({ images, onInsert }: Props) {
  if (images.length === 0) return null;

  return (
    <div className="prompt-image-strip nodrag nopan">
      {images.map((img) => (
        <button
          key={img.nodeId + img.index}
          className="prompt-image-strip__card"
          title={`点击插入 @图${img.index}`}
          onPointerDownCapture={(e) => { e.stopPropagation(); }}
          onMouseDownCapture={(e) => { e.stopPropagation(); }}
          onClick={(e) => {
            e.stopPropagation();
            onInsert(`@图${img.index}`);
          }}
        >
          <img
            src={img.url}
            alt={`图${img.index}`}
            className="prompt-image-strip__img"
            draggable={false}
          />
          {img.isVideo && (
            <span className="prompt-image-strip__video-icon" aria-hidden>▶</span>
          )}
          <span className="prompt-image-strip__badge">图{img.index}</span>
        </button>
      ))}
    </div>
  );
}
