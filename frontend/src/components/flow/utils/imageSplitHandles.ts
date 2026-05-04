export const getImageSplitHandleIndex = (handle?: string | null): number | null => {
  if (typeof handle !== "string") return null;
  const match = /^(?:image|img)(\d+)$/i.exec(handle.trim());
  if (!match) return null;

  const index = Number(match[1]) - 1;
  return Number.isInteger(index) && index >= 0 ? index : null;
};

export const getImageSplitPrimaryHandleId = (index: number): string => `image${index + 1}`;

export const getImageSplitCompatHandleId = (index: number): string => `img${index + 1}`;

export const isImageSplitHandle = (handle?: string | null): boolean =>
  getImageSplitHandleIndex(handle) !== null;
