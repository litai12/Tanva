export type VideoFrame = {
  index: number;
  timestamp: number;
  imageUrl: string;
  thumbnailDataUrl?: string;
};

export type VideoFrameSelectionData = {
  frames?: VideoFrame[];
  outputMode?: 'all' | 'single' | 'range';
  selectedFrameIndex?: number;
  rangeStart?: number;
  rangeEnd?: number;
};

const frameNumber = (frame: VideoFrame, position: number): number =>
  Number.isSafeInteger(frame.index) && frame.index >= 1 ? frame.index : position + 1;

const validNumber = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : fallback;

/** Normalize stale settings against the actual frame numbers, without a frame-count cap. */
export function normalizeVideoFrameSelection(data: VideoFrameSelectionData) {
  const frames = Array.isArray(data.frames) ? data.frames : [];
  const numbers = frames.map(frameNumber);
  let first = numbers[0] ?? 1;
  let last = first;
  for (const number of numbers) {
    first = Math.min(first, number);
    last = Math.max(last, number);
  }
  const clamp = (value: number) => Math.min(last, Math.max(first, value));
  const requestedIndex = clamp(validNumber(data.selectedFrameIndex, numbers[0] ?? first));
  // Sparse historical arrays still select one available frame, preferring the earlier frame on a tie.
  const selectedFrameIndex = numbers.reduce((nearest, number) => {
    const distance = Math.abs(number - requestedIndex);
    const previousDistance = Math.abs(nearest - requestedIndex);
    return distance < previousDistance || (distance === previousDistance && number < nearest)
      ? number
      : nearest;
  }, numbers[0] ?? first);
  const start = clamp(validNumber(data.rangeStart, first));
  const end = clamp(validNumber(data.rangeEnd, last));
  const outputMode: 'all' | 'single' | 'range' =
    data.outputMode === 'single' || data.outputMode === 'range' ? data.outputMode : 'all';
  return {
    outputMode,
    selectedFrameIndex,
    rangeStart: Math.min(start, end),
    rangeEnd: Math.max(start, end),
    maxFrameIndex: last,
  };
}

/** Select by 1-based frame number; range endpoints are inclusive. Preserve source order and references. */
export function selectVideoFrames(data: VideoFrameSelectionData): VideoFrame[] {
  const frames = Array.isArray(data.frames) ? data.frames : [];
  if (frames.length === 0) return [];
  const selection = normalizeVideoFrameSelection(data);
  if (selection.outputMode === 'single') {
    const position = frames.findIndex((frame, index) => frameNumber(frame, index) === selection.selectedFrameIndex);
    return position >= 0 ? [frames[position]] : [];
  }
  if (selection.outputMode === 'range') {
    return frames.filter((frame, index) => {
      const number = frameNumber(frame, index);
      return number >= selection.rangeStart && number <= selection.rangeEnd;
    });
  }
  return frames;
}
