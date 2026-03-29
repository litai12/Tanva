/// <reference lib="webworker" />

import { uploadToOSS, type OssUploadOptions } from "@/services/ossUploadService";

type UploadImageFileRequest = {
  type: "UPLOAD_IMAGE_FILE";
  requestId: string;
  file: File;
  authToken?: string;
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

// 无效的 MIME 类型黑名单
const INVALID_IMAGE_MIME_TYPES = [
  "text/html",
  "text/plain",
  "text/css",
  "text/javascript",
  "application/json",
  "application/javascript",
  "application/xml",
];

const isValidImageMimeType = (mimeType?: string | null): boolean => {
  if (!mimeType) return true;
  const lower = mimeType.toLowerCase().trim();
  if (INVALID_IMAGE_MIME_TYPES.some((t) => lower.startsWith(t))) return false;
  return lower.startsWith("image/") || lower === "application/pdf";
};

const normalizeOutputType = (type: string) => {
  const lower = type.toLowerCase();
  if (lower === "image/jpg") return "image/jpeg";
  return lower;
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

      if (!isValidImageMimeType(file.type)) {
        throw new Error(`无效的图片格式: ${file.type}`);
      }

      // 原图直传：历史上对 PNG/JPEG 做全分辨率离屏重编码会导致大图上传极慢、内存峰值高。
      const prepared = {
        blob: file as Blob,
        width: undefined as number | undefined,
        height: undefined as number | undefined,
        contentType,
      };

      const upload = await uploadToOSS(prepared.blob, {
        ...options,
        fileName,
        contentType: prepared.contentType || contentType,
        authToken: data.authToken,
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
