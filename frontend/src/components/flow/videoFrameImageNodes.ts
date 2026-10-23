import type { Node, Rect } from '@xyflow/react';
import type { VideoFrame } from './videoFrameSelection.ts';

type FrameNodeOptions = {
  idPrefix: string;
  sourceNodeId: string;
  sourceBounds: Rect;
  occupiedBounds: Rect[];
  size: { w: number; h: number };
  frameLabel: (frame: VideoFrame) => string;
};

/** Create independent snapshots, so changing the selected frame cannot replace them. */
export function createVideoFrameImageNodes(
  frames: VideoFrame[],
  options: FrameNodeOptions,
): Node[] {
  if (!frames.length) return [];
  const { sourceBounds, size, occupiedBounds } = options;
  const gap = 60;
  const columns = Math.min(4, frames.length);
  const width = columns * size.w + (columns - 1) * gap;
  const height = Math.ceil(frames.length / columns) * (size.h + gap) - gap;
  const x = sourceBounds.x + sourceBounds.width + gap;
  let y = sourceBounds.y;

  // Move the whole grid below conflicts without moving existing project nodes.
  for (;;) {
    const conflicts = occupiedBounds.filter((bounds) => (
      x < bounds.x + bounds.width + gap && x + width + gap > bounds.x &&
      y < bounds.y + bounds.height + gap && y + height + gap > bounds.y
    ));
    if (!conflicts.length) break;
    y = Math.max(...conflicts.map((bounds) => bounds.y + bounds.height + gap));
  }

  return frames.map((frame, offset) => ({
    id: `${options.idPrefix}_${offset + 1}`,
    type: 'image',
    position: {
      x: x + (offset % columns) * (size.w + gap),
      y: y + Math.floor(offset / columns) * (size.h + gap),
    },
    initialWidth: size.w,
    initialHeight: size.h,
    selected: true,
    data: {
      imageUrl: frame.imageUrl,
      label: options.frameLabel(frame),
      imageName: options.frameLabel(frame),
      boxW: size.w,
      boxH: size.h,
      sourceVideoFrameNodeId: options.sourceNodeId,
      frameIndex: frame.index,
      frameTimestamp: frame.timestamp,
    },
  }));
}
