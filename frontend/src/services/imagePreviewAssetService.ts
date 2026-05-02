import { imageUploadService } from "@/services/imageUploadService";
import { createImagePreviewDataUrl } from "@/utils/imagePreview";
import { resolveImageToBlob } from "@/utils/imageSource";

export const DEFAULT_IMAGE_RENDER_PREVIEW_MAX_SIZE = 1600;

export type UploadedImagePreviewAsset = {
  url: string;
  key?: string;
  width?: number;
  height?: number;
  contentType?: string;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type ImagePreviewAssetOptions = {
  projectId?: string | null;
  dir?: string;
  fileName?: string;
  maxSize?: number;
  quality?: number;
};

const isStringSource = (source: string | Blob | File): source is string =>
  typeof source === "string";

const withObjectUrl = async <T>(
  blob: Blob,
  fn: (url: string) => Promise<T>
): Promise<T> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await fn(objectUrl);
  } finally {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {}
  }
};

const loadImageDimensionsFromUrl = (url: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (width > 0 && height > 0) {
        resolve({ width, height });
      } else {
        reject(new Error("invalid image dimensions"));
      }
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });

export async function readImageDimensionsFromSource(
  source: string | Blob | File
): Promise<{ width?: number; height?: number }> {
  try {
    const blob = isStringSource(source)
      ? await resolveImageToBlob(source, { preferProxy: true })
      : source;
    if (!blob || blob.size <= 0) return {};

    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      try {
        const width = bitmap.width || 0;
        const height = bitmap.height || 0;
        return width > 0 && height > 0 ? { width, height } : {};
      } finally {
        try {
          bitmap.close();
        } catch {}
      }
    }

    return await withObjectUrl(blob, async (url) => loadImageDimensionsFromUrl(url));
  } catch {
    return {};
  }
}

const inferPreviewFileName = (fileName?: string): string => {
  const raw = typeof fileName === "string" && fileName.trim()
    ? fileName.trim()
    : `image-${Date.now()}.png`;
  const base = raw.replace(/\.[a-z0-9]+$/i, "");
  return `${base}-preview.webp`;
};

export async function createUploadedImagePreviewAsset(
  source: string | Blob | File,
  options: ImagePreviewAssetOptions = {}
): Promise<UploadedImagePreviewAsset | null> {
  const maxSize = options.maxSize ?? DEFAULT_IMAGE_RENDER_PREVIEW_MAX_SIZE;
  const sourceBlob = isStringSource(source)
    ? await resolveImageToBlob(source, { preferProxy: true })
    : source;
  if (!sourceBlob || sourceBlob.size <= 0) return null;

  const sourceDims = await readImageDimensionsFromSource(sourceBlob);
  const cacheKey = isStringSource(source) ? source.trim().slice(0, 512) : undefined;
  const previewDataUrl = await withObjectUrl(sourceBlob, async (previewInput) =>
    createImagePreviewDataUrl(previewInput, {
      maxSize,
      mimeType: "image/webp",
      quality: options.quality ?? 0.82,
      cacheKey,
    })
  );

  if (!previewDataUrl || !/^data:image\//i.test(previewDataUrl)) {
    return null;
  }

  const previewDims = await readImageDimensionsFromSource(previewDataUrl);
  const sourceMax = Math.max(sourceDims.width ?? 0, sourceDims.height ?? 0);
  const previewMax = Math.max(previewDims.width ?? 0, previewDims.height ?? 0);
  if (sourceMax > maxSize && previewMax >= sourceMax) {
    return null;
  }

  const upload = await imageUploadService.uploadImageSource(previewDataUrl, {
    projectId: options.projectId ?? undefined,
    dir:
      options.dir ??
      (options.projectId
        ? `projects/${options.projectId}/image-previews/`
        : "uploads/image-previews/"),
    fileName: inferPreviewFileName(options.fileName),
    contentType: "image/webp",
  });

  if (!upload.success || !upload.asset?.url) {
    return null;
  }

  return {
    url: upload.asset.url,
    key: upload.asset.key,
    width: previewDims.width ?? upload.asset.width,
    height: previewDims.height ?? upload.asset.height,
    contentType: upload.asset.contentType || "image/webp",
    sourceWidth: sourceDims.width,
    sourceHeight: sourceDims.height,
  };
}
