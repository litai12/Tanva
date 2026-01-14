import type { OssUploadOptions } from "./ossUploadService";

export type WorkerImageUploadOptions = OssUploadOptions & {
  fileName?: string;
  contentType?: string;
};

export type WorkerImageUploadResult = {
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

type UploadImageFileRequest = {
  type: "UPLOAD_IMAGE_FILE";
  requestId: string;
  file: File;
  options: WorkerImageUploadOptions;
};

type UploadImageFileResponse = {
  type: "UPLOAD_IMAGE_FILE_RESULT";
  requestId: string;
  success: boolean;
  error?: string;
  asset?: WorkerImageUploadResult["asset"];
};

type PendingRequest = {
  resolve: (value: WorkerImageUploadResult) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

const WORKER_TIMEOUT_MS = 60_000;

class ImageUploadWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();

  isSupported(): boolean {
    return typeof Worker !== "undefined";
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(
      new URL("../workers/imageUploadWorker.ts", import.meta.url),
      { type: "module" }
    );

    worker.addEventListener("message", (event: MessageEvent<UploadImageFileResponse>) => {
      const data = event.data;
      if (!data || data.type !== "UPLOAD_IMAGE_FILE_RESULT") return;

      const pending = this.pending.get(data.requestId);
      if (!pending) return;

      clearTimeout(pending.timeoutId);
      this.pending.delete(data.requestId);
      pending.resolve({
        success: data.success,
        error: data.error,
        asset: data.asset,
      });
    });

    worker.addEventListener("error", (error) => {
      // 若 worker 崩溃：拒绝所有挂起请求并重建实例
      this.rejectAllPending(error);
      this.worker = null;
    });

    this.worker = worker;
    return worker;
  }

  private rejectAllPending(reason: unknown) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(reason);
    }
    this.pending.clear();
  }

  async uploadImageFile(
    file: File,
    options: WorkerImageUploadOptions = {}
  ): Promise<WorkerImageUploadResult> {
    if (!this.isSupported()) {
      return { success: false, error: "当前环境不支持 Web Worker" };
    }

    const worker = this.ensureWorker();
    const requestId = `img_upload_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    return await new Promise<WorkerImageUploadResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("图片上传超时，请重试"));
      }, WORKER_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, reject, timeoutId });

      const payload: UploadImageFileRequest = {
        type: "UPLOAD_IMAGE_FILE",
        requestId,
        file,
        options,
      };
      worker.postMessage(payload);
    });
  }
}

export const imageUploadWorkerClient = new ImageUploadWorkerClient();

