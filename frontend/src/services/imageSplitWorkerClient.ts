import type {
  SplitImageRequest,
  SplitImageRectItem,
  SplitImageRectsRequest,
  SplitImageResultItem,
  SplitImageResponse,
  SplitImageRectsResponse,
} from "../workers/imageSplitWorker";

export type WorkerSplitImageSource =
  | { kind: "url"; url: string }
  | { kind: "blob"; blob: Blob };

export type WorkerSplitImageResult = {
  success: boolean;
  error?: string;
  items?: SplitImageResultItem[];
};

export type WorkerSplitImageRectsResult = {
  success: boolean;
  error?: string;
  rects?: SplitImageRectItem[];
  sourceWidth?: number;
  sourceHeight?: number;
};

type PendingRequest = {
  kind: "images" | "rects";
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

const WORKER_TIMEOUT_MS = 60_000;

class ImageSplitWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();

  isSupported(): boolean {
    return typeof Worker !== "undefined";
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL("../workers/imageSplitWorker.ts", import.meta.url), {
      type: "module",
    });

    worker.addEventListener(
      "message",
      (event: MessageEvent<SplitImageResponse | SplitImageRectsResponse>) => {
      const data = event.data;
      if (!data) return;

      if (data.type === "SPLIT_IMAGE_RESULT") {
        const pending = this.pending.get(data.requestId);
        if (!pending) return;

        clearTimeout(pending.timeoutId);
        this.pending.delete(data.requestId);
        pending.resolve({
          success: data.success,
          error: data.error,
          items: data.items,
        } satisfies WorkerSplitImageResult);
        return;
      }

      if (data.type === "SPLIT_IMAGE_RECTS_RESULT") {
        const pending = this.pending.get(data.requestId);
        if (!pending) return;

        clearTimeout(pending.timeoutId);
        this.pending.delete(data.requestId);
        pending.resolve({
          success: data.success,
          error: data.error,
          rects: data.rects,
          sourceWidth: data.sourceWidth,
          sourceHeight: data.sourceHeight,
        } satisfies WorkerSplitImageRectsResult);
      }
    }
    );

    worker.addEventListener("error", (error) => {
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

  async splitImage(
    source: WorkerSplitImageSource,
    options: { outputCount: number }
  ): Promise<WorkerSplitImageResult> {
    if (!this.isSupported()) {
      return { success: false, error: "当前环境不支持 Web Worker" };
    }

    const worker = this.ensureWorker();
    const requestId = `img_split_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    return await new Promise<WorkerSplitImageResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("图片分割超时，请重试"));
      }, WORKER_TIMEOUT_MS);

      this.pending.set(requestId, {
        kind: "images",
        resolve,
        reject,
        timeoutId,
      });

      const payload: SplitImageRequest = {
        type: "SPLIT_IMAGE",
        requestId,
        source,
        outputCount: options.outputCount,
      };

      worker.postMessage(payload);
    });
  }

  async splitImageRects(
    source: WorkerSplitImageSource,
    options: { outputCount: number }
  ): Promise<WorkerSplitImageRectsResult> {
    if (!this.isSupported()) {
      return { success: false, error: "当前环境不支持 Web Worker" };
    }

    const worker = this.ensureWorker();
    const requestId = `img_split_rects_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    return await new Promise<WorkerSplitImageRectsResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("图片分割超时，请重试"));
      }, WORKER_TIMEOUT_MS);

      this.pending.set(requestId, {
        kind: "rects",
        resolve,
        reject,
        timeoutId,
      });

      const payload: SplitImageRectsRequest = {
        type: "SPLIT_IMAGE_RECTS",
        requestId,
        source,
        outputCount: options.outputCount,
      };

      worker.postMessage(payload);
    });
  }
}

export const imageSplitWorkerClient = new ImageSplitWorkerClient();
