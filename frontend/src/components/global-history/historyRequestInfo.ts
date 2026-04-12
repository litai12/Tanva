import type { GlobalImageHistoryItem } from '@/services/globalImageHistoryApi';

const REQUEST_PROMPT_KEYS = [
  'requestPrompt',
  'originalPrompt',
  'fullPrompt',
  'promptText',
  'prompt',
  'textPrompt',
  'inputPrompt',
  'userPrompt',
] as const;

const REQUEST_IMAGE_KEYS = [
  'requestThumbnailUrl',
  'requestThumbnail',
  'thumbnailUrl',
  'thumbnail',
  'sourceImageUrl',
  'referenceImage',
  'inputImageUrl',
  'imageUrl',
  'image',
  'cover',
  'poster',
] as const;

const REQUEST_IMAGE_LIST_KEYS = [
  'sourceImages',
  'referenceImages',
  'inputImages',
  'images',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
};

const isRenderableImageRef = (value?: string): boolean => {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;
  if (/^[A-Za-z0-9+/=]{80,}$/.test(trimmed)) return false;
  return true;
};

const findNestedString = (
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined => {
  if (depth > 2 || !isRecord(value)) return undefined;

  for (const key of keys) {
    const candidate = pickString(value[key]);
    if (candidate) return candidate;
  }

  for (const nested of Object.values(value)) {
    const candidate = findNestedString(nested, keys, depth + 1);
    if (candidate) return candidate;
  }

  return undefined;
};

const findNestedImage = (
  value: unknown,
  depth = 0
): string | undefined => {
  if (depth > 2 || !isRecord(value)) return undefined;

  for (const key of REQUEST_IMAGE_KEYS) {
    const candidate = pickString(value[key]);
    if (isRenderableImageRef(candidate)) return candidate;
  }

  for (const key of REQUEST_IMAGE_LIST_KEYS) {
    const list = value[key];
    if (Array.isArray(list)) {
      for (const entry of list) {
        const candidate = pickString(entry);
        if (isRenderableImageRef(candidate)) return candidate;
      }
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const entry of nested) {
        if (isRecord(entry)) {
          const candidate = findNestedImage(entry, depth + 1);
          if (candidate) return candidate;
        }
      }
      continue;
    }
    const candidate = findNestedImage(nested, depth + 1);
    if (candidate) return candidate;
  }

  return undefined;
};

export const getHistoryRequestPrompt = (item: GlobalImageHistoryItem): string | undefined => {
  return pickString(
    findNestedString(item.metadata, REQUEST_PROMPT_KEYS),
    item.prompt
  );
};

export const getHistoryRequestThumbnail = (item: GlobalImageHistoryItem): string | undefined => {
  return findNestedImage(item.metadata);
};
