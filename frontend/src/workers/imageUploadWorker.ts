/// <reference lib="webworker" />

import { uploadToOSS, type OssUploadOptions } from "@/services/ossUploadService";

type UploadImageFileRequest = {
  type: "UPLOAD_IMAGE_FILE";
  requestId: string;
  file: File;
  options: OssUploadOptions & {
    fileName?: string;
    contentType?: string;
  };
};

type UploadImageFileResponse = {
  type: "UPLOAD_IMAGE_FILE_RESULT";
  requestId: string;
  success: boolean;
  error?: string;
  asset?: {
    url: string;
    key?: string;
    fileName?: string;
    width?: number;
    height?: number;
    contentType?: string;
    size?: number;
  };
};

type WorkerRequest = UploadImageFileRequest;

const isRasterImage = (type: string) => {
  const lower = type.toLowerCase();
  return (
    lower === "image/png" ||
    lower === "image/jpeg" ||
    lower === "image/jpg" ||
    lower === "image/webp"
  );
};

const shouldBypassCanvas = (type: string) => {
  const lower = type.toLowerCase();
  if (lower === "image/gif") return true; // 保留动图
  if (lower === "image/svg+xml") return true; // 保留矢量
  return false;
};

const normalizeOutputType = (type: string) => {
  const lower = type.toLowerCase();
  if (lower === "image/jpg") return "image/jpeg";
  return lower;
};

const estimateSafeCanvas = (width: number, height: number) => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  // 避免极大图片在 worker 里创建离屏画布导致内存峰值过高
  return width * height <= 32_000_000; // ~32MP
};

const convertViaOffscreenCanvas = async (file: File): Promise<{
  blob: Blob;
  width?: number;
  height?: number;
  contentType: string;
}> => {
  const contentType = normalizeOutputType(file.type || "image/png");

  if (
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    return { blob: file, contentType };
  }

  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;

  if (!estimateSafeCanvas(width, height)) {
    try {
      bitmap.close();
    } catch {}
    return { blob: file, width, height, contentType };
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    try {
      bitmap.close();
    } catch {}
    return { blob: file, width, height, contentType };
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  try {
    bitmap.close();
  } catch {}

  const quality =
    contentType === "image/jpeg" || contentType === "image/webp"
      ? 0.92
      : undefined;

  const blob = await canvas.convertToBlob({ type: contentType, quality });
  return { blob, width, height, contentType: blob.type || contentType };
};

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const data = event.data;

  if (data?.type !== "UPLOAD_IMAGE_FILE") return;

  const run = async (): Promise<UploadImageFileResponse> => {
    try {
      const file = data.file;
      const options = data.options || {};

      const fileName = options.fileName || file.name;
      const contentType = normalizeOutputType(options.contentType || file.type);

      const prepared = await (async () => {
        if (!contentType) return { blob: file as Blob, width: undefined, height: undefined, contentType };
        if (shouldBypassCanvas(contentType)) {
          return { blob: file as Blob, width: undefined, height: undefined, contentType };
        }
        if (!isRasterImage(contentType)) {
          return { blob: file as Blob, width: undefined, height: undefined, contentType };
        }
        return await convertViaOffscreenCanvas(file);
      })();

      const upload = await uploadToOSS(prepared.blob, {
        ...options,
        fileName,
        contentType: prepared.contentType || contentType,
      });

      if (!upload.success || !upload.url) {
        return {
          type: "UPLOAD_IMAGE_FILE_RESULT",
          requestId: data.requestId,
          success: false,
          error: upload.error || "OSS 上传失败",
        };
      }

      return {
        type: "UPLOAD_IMAGE_FILE_RESULT",
        requestId: data.requestId,
        success: true,
        asset: {
          url: upload.url,
          key: upload.key,
          fileName,
          width: prepared.width,
          height: prepared.height,
          contentType: prepared.contentType || contentType,
          size: prepared.blob.size,
        },
      };
    } catch (error: unknown) {
      return {
        type: "UPLOAD_IMAGE_FILE_RESULT",
        requestId: data.requestId,
        success: false,
        error:
          error instanceof Error
            ? error.message
            : typeof error === "string"
            ? error
            : "图片上传失败，请重试",
      };
    }
  };

  void run().then((resp) => {
    self.postMessage(resp);
  });
});

export {};
