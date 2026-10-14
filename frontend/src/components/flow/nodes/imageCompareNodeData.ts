/** Compare nodes persist display preferences only; assets stay in upstream nodes. */
export type ImageCompareMode = 'side' | 'slider' | 'overlay' | 'toggle';
export type ImageCompareNodeData = {
  label?: string;
  compareMode?: ImageCompareMode;
  splitPercent?: number;
  overlayOpacity?: number;
  boxW?: number;
  boxH?: number;
  readOnly?: boolean;
  [key: string]: unknown;
};
export const IMAGE_COMPARE_TARGET_HANDLE_ID = 'images';
export const IMAGE_COMPARE_DEFAULT_SIZE = { width: 480, height: 320 } as const;
export const IMAGE_COMPARE_MIN_SIZE = { width: 320, height: 220 } as const;
export const IMAGE_COMPARE_MAX_SIZE = { width: 1600, height: 1200 } as const;
