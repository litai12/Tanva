import type { ProjectContentSnapshot } from '@/types/project';

export const PROJECT_PREVIEW_MAX_IMAGES = 16;
export const PROJECT_PREVIEW_FETCH_LIMIT = 32;

export type ProjectPreviewCacheEntry = {
  version: number;
  images: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = normalizeString(item);
    return normalized ? [normalized] : [];
  });
}

export function isLikelyProjectPreviewImageRef(value: string): boolean {
  if (/^data:/i.test(value)) return /^data:image\//i.test(value);
  if (/^(blob:|flow-asset:)/i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^(projects|uploads|templates|videos|ai)\//i.test(value)) return true;
  if (/\.(png|jpe?g|webp|gif|avif|svg)([?#].*)?$/i.test(value)) return true;

  const compact = value.replace(/\s+/g, '');
  return compact.length > 1024 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

function addPreviewImage(images: string[], seen: Set<string>, value: unknown) {
  if (images.length >= PROJECT_PREVIEW_FETCH_LIMIT) return;
  const normalized = normalizeString(value);
  if (!normalized || !isLikelyProjectPreviewImageRef(normalized) || seen.has(normalized)) return;
  seen.add(normalized);
  images.push(normalized);
}

function addObjectImage(images: string[], seen: Set<string>, value: unknown) {
  if (!isRecord(value)) {
    addPreviewImage(images, seen, value);
    return;
  }

  addPreviewImage(
    images,
    seen,
    pickFirstString(
      value.previewUrl,
      value.previewKey,
      value.thumbnail,
      value.thumbnailDataUrl,
      value.thumbnailData,
      value.imageUrl,
      value.imageData,
      value.remoteUrl,
      value.key,
      value.url,
      value.src
    )
  );
}

function addObjectArrayImages(images: string[], seen: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    addObjectImage(images, seen, item);
    if (images.length >= PROJECT_PREVIEW_FETCH_LIMIT) return;
  }
}

function addIndexedImages(
  images: string[],
  seen: Set<string>,
  sourceValues: unknown,
  thumbnailValues?: unknown
) {
  const sources = toStringArray(sourceValues);
  const thumbnails = toStringArray(thumbnailValues);
  const count = Math.max(sources.length, thumbnails.length);

  for (let index = 0; index < count; index += 1) {
    addPreviewImage(images, seen, thumbnails[index] || sources[index]);
    if (images.length >= PROJECT_PREVIEW_FETCH_LIMIT) return;
  }
}

function addNodeDataImages(images: string[], seen: Set<string>, data: unknown) {
  if (!isRecord(data)) return;

  addIndexedImages(images, seen, data.imageUrls, data.thumbnails);
  addIndexedImages(images, seen, data.images, data.thumbnails);

  addObjectArrayImages(images, seen, data.images);
  addObjectArrayImages(images, seen, data.thumbnails);
  addObjectArrayImages(images, seen, data.frames);
  addObjectArrayImages(images, seen, data.splitImages);
  addObjectArrayImages(images, seen, data.referenceImages);
  addObjectArrayImages(images, seen, data.inputImages);
  addObjectArrayImages(images, seen, data.outputs);
  addObjectArrayImages(images, seen, data.results);
  addObjectArrayImages(images, seen, data.items);

  addPreviewImage(
    images,
    seen,
    pickFirstString(
      data.thumbnail,
      data.thumbnailDataUrl,
      data.thumbnailData,
      data.previewUrl,
      data.imageUrl,
      data.imageData,
      data.inputImage,
      data.sourceImage
    )
  );
}

export function extractProjectPreviewImages(content: ProjectContentSnapshot): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  const assets = content.assets;

  if (isRecord(assets)) {
    if (Array.isArray(assets.images)) {
      for (const asset of assets.images) {
        addPreviewImage(
          images,
          seen,
          isRecord(asset)
            ? pickFirstString(asset.previewUrl, asset.previewKey, asset.remoteUrl, asset.key, asset.url, asset.src)
            : asset
        );
        if (images.length >= PROJECT_PREVIEW_FETCH_LIMIT) return images;
      }
    }

    if (Array.isArray(assets.videos)) {
      for (const asset of assets.videos) {
        const videoAsset = asset as unknown as Record<string, unknown>;
        addPreviewImage(
          images,
          seen,
          pickFirstString(videoAsset.thumbnail, videoAsset.previewUrl, videoAsset.poster)
        );
        if (images.length >= PROJECT_PREVIEW_FETCH_LIMIT) return images;
      }
    }
  }

  const nodes = content.flow?.nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      addNodeDataImages(images, seen, node?.data);
      if (images.length >= PROJECT_PREVIEW_FETCH_LIMIT) return images;
    }
  }

  return images;
}

export function getProjectPreviewGridSize(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}
