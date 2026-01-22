/// <reference lib="webworker" />

import { fetchWithAuth } from "@/services/authFetch";

type SplitImageSource =
  | { kind: "url"; url: string }
  | { kind: "blob"; blob: Blob };

export type SplitImageRequest = {
  type: "SPLIT_IMAGE";
  requestId: string;
  source: SplitImageSource;
  outputCount: number;
  authToken?: string;
};

export type SplitImageRectItem = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SplitImageRectsRequest = {
  type: "SPLIT_IMAGE_RECTS";
  requestId: string;
  source: SplitImageSource;
  outputCount: number;
  authToken?: string;
};

export type SplitImageResultItem = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  contentType: string;
  buffer: ArrayBuffer;
};

export type SplitImageResponse = {
  type: "SPLIT_IMAGE_RESULT";
  requestId: string;
  success: boolean;
  error?: string;
  items?: SplitImageResultItem[];
};

export type SplitImageRectsResponse = {
  type: "SPLIT_IMAGE_RECTS_RESULT";
  requestId: string;
  success: boolean;
  error?: string;
  rects?: SplitImageRectItem[];
  sourceWidth?: number;
  sourceHeight?: number;
};

const MIN_OUTPUT_COUNT = 1;
const MAX_OUTPUT_COUNT = 50;
const DEFAULT_OUTPUT_COUNT = 9;

const isWhitePixel = (r: number, g: number, b: number, threshold = 250): boolean =>
  r >= threshold && g >= threshold && b >= threshold;

const TRIM_MAX_PIXELS = 4_000_000; // ~4MP，避免单次 getImageData 过大导致内存峰值
const WHITE_BG_RATIO_THRESHOLD = 0.55;

const toLuma = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

// 更宽松的“白底/纸张底色”判断：用于去白边裁切（而非连通域检测）
const isLightBackgroundPixel = (r: number, g: number, b: number, a: number): boolean => {
  if (a <= 12) return true; // 透明视为背景

  // 纯白/近白：直接当背景（避免 JPEG 噪声导致的“白边连通”）
  if (r >= 245 && g >= 245 && b >= 245) return true;
  if (r >= 235 && g >= 235 && b >= 235) return true;

  // 纸张类底色：亮度高且色差小
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const luma = toLuma(r, g, b);
  return luma >= 225 && chroma <= 35;
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const findContentBounds = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): Bounds | null => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const idx = rowOffset + x * 4;
      if (!isLightBackgroundPixel(data[idx]!, data[idx + 1]!, data[idx + 2]!, data[idx + 3]!)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) return null;
  return { minX, minY, maxX, maxY };
};

const looksLikeWhiteBackground = async (bitmap: ImageBitmap): Promise<boolean> => {
  if (typeof OffscreenCanvas === "undefined") return false;

  const SAMPLE_SIZE = 96;
  const w = Math.min(SAMPLE_SIZE, bitmap.width);
  const h = Math.min(SAMPLE_SIZE, bitmap.height);
  if (w <= 0 || h <= 0) return false;

  const sampleCanvas = new OffscreenCanvas(w, h);
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true } as any);
  if (!sampleCtx) return false;

  try {
    // @ts-ignore - 部分环境无此字段
    sampleCtx.imageSmoothingEnabled = false;
  } catch {}

  sampleCtx.clearRect(0, 0, w, h);
  sampleCtx.drawImage(bitmap, 0, 0, w, h);

  const sampled = sampleCtx.getImageData(0, 0, w, h);
  const data = sampled.data;

  let white = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    if (isLightBackgroundPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) white += 1;
  }
  const ratio = total > 0 ? white / total : 0;
  return ratio >= WHITE_BG_RATIO_THRESHOLD;
};

type Region = { minX: number; minY: number; maxX: number; maxY: number };

const findNonWhiteRegions = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): Region[] => {
  const visited = new Uint8Array(width * height);
  const regions: Region[] = [];

  const isNonWhiteIdx = (pixelIdx: number): boolean => {
    if (pixelIdx < 0 || pixelIdx >= width * height) return false;
    const idx = pixelIdx * 4;
    return !isWhitePixel(data[idx], data[idx + 1], data[idx + 2]);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIdx = y * width + x;
      if (visited[pixelIdx] || !isNonWhiteIdx(pixelIdx)) continue;

      const region: Region = { minX: x, minY: y, maxX: x, maxY: y };
      const queue: number[] = [pixelIdx];
      let head = 0;
      visited[pixelIdx] = 1;

      while (head < queue.length) {
        const idx = queue[head++]!;
        const cx = idx % width;
        const cy = Math.floor(idx / width);

        region.minX = Math.min(region.minX, cx);
        region.minY = Math.min(region.minY, cy);
        region.maxX = Math.max(region.maxX, cx);
        region.maxY = Math.max(region.maxY, cy);

        if (cx > 0) {
          const nIdx = idx - 1;
          if (!visited[nIdx] && isNonWhiteIdx(nIdx)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
        if (cx + 1 < width) {
          const nIdx = idx + 1;
          if (!visited[nIdx] && isNonWhiteIdx(nIdx)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
        if (cy > 0) {
          const nIdx = idx - width;
          if (!visited[nIdx] && isNonWhiteIdx(nIdx)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
        if (cy + 1 < height) {
          const nIdx = idx + width;
          if (!visited[nIdx] && isNonWhiteIdx(nIdx)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }

      const regionWidth = region.maxX - region.minX + 1;
      const regionHeight = region.maxY - region.minY + 1;
      if (regionWidth > 20 && regionHeight > 20) {
        regions.push(region);
      }
    }
  }

  regions.sort((a, b) => {
    const rowA = Math.floor(a.minY / 50);
    const rowB = Math.floor(b.minY / 50);
    if (rowA !== rowB) return rowA - rowB;
    return a.minX - b.minX;
  });

  return regions;
};

const shouldAttemptRegionDetect = async (bitmap: ImageBitmap): Promise<boolean> => {
  const totalPixels = bitmap.width * bitmap.height;
  const MAX_PIXELS_FOR_REGION_DETECT = 2_000_000; // ~2MP
  if (totalPixels > MAX_PIXELS_FOR_REGION_DETECT) return false;

  if (typeof OffscreenCanvas === "undefined") return false;

  const SAMPLE_SIZE = 96;
  const w = Math.min(SAMPLE_SIZE, bitmap.width);
  const h = Math.min(SAMPLE_SIZE, bitmap.height);
  if (w <= 0 || h <= 0) return false;

  const sampleCanvas = new OffscreenCanvas(w, h);
  const sampleCtx = sampleCanvas.getContext("2d");
  if (!sampleCtx) return false;

  sampleCtx.drawImage(bitmap, 0, 0, w, h);
  const sampled = sampleCtx.getImageData(0, 0, w, h);
  const data = sampled.data;

  let white = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    if (isWhitePixel(data[i], data[i + 1], data[i + 2])) white += 1;
  }

  const whiteRatio = total > 0 ? white / total : 0;
  return whiteRatio >= 0.55;
};

const splitByGrid = async (
  bitmap: ImageBitmap,
  count: number
): Promise<Array<Omit<SplitImageResultItem, "buffer" | "contentType"> & { blob: Blob }>> => {
  const safeCount = Math.min(
    MAX_OUTPUT_COUNT,
    Math.max(MIN_OUTPUT_COUNT, Math.floor(count || DEFAULT_OUTPUT_COUNT))
  );
  const cols = Math.max(1, Math.ceil(Math.sqrt(safeCount)));
  const rows = Math.max(1, Math.ceil(safeCount / cols));

  const out: Array<
    Omit<SplitImageResultItem, "buffer" | "contentType"> & { blob: Blob }
  > = [];

  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d");
  if (!ctx) return out;

  for (let i = 0; i < safeCount; i += 1) {
    const row = Math.floor(i / cols);
    const col = i % cols;

    const x0 = Math.round((col / cols) * bitmap.width);
    const x1 = Math.round(((col + 1) / cols) * bitmap.width);
    const y0 = Math.round((row / rows) * bitmap.height);
    const y1 = Math.round(((row + 1) / rows) * bitmap.height);

    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);

    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, x0, y0, w, h, 0, 0, w, h);

    const blob = await canvas.convertToBlob({ type: "image/png" });
    out.push({ index: i, x: x0, y: y0, width: w, height: h, blob });
  }

  return out;
};

const splitRectsByGrid = (
  bitmap: ImageBitmap,
  count: number
): SplitImageRectItem[] => {
  const safeCount = Math.min(
    MAX_OUTPUT_COUNT,
    Math.max(MIN_OUTPUT_COUNT, Math.floor(count || DEFAULT_OUTPUT_COUNT))
  );
  const cols = Math.max(1, Math.ceil(Math.sqrt(safeCount)));
  const rows = Math.max(1, Math.ceil(safeCount / cols));

  const out: SplitImageRectItem[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const row = Math.floor(i / cols);
    const col = i % cols;

    const x0 = Math.round((col / cols) * bitmap.width);
    const x1 = Math.round(((col + 1) / cols) * bitmap.width);
    const y0 = Math.round((row / rows) * bitmap.height);
    const y1 = Math.round(((row + 1) / rows) * bitmap.height);

    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);

    out.push({ index: i, x: x0, y: y0, width: w, height: h });
  }

  return out;
};

const splitByRegions = async (
  bitmap: ImageBitmap
): Promise<Array<Omit<SplitImageResultItem, "buffer" | "contentType"> & { blob: Blob }>> => {
  const out: Array<
    Omit<SplitImageResultItem, "buffer" | "contentType"> & { blob: Blob }
  > = [];

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true } as any);
  if (!ctx) return out;

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const regions = findNonWhiteRegions(imageData.data, imageData.width, imageData.height);
  if (!regions.length) return out;

  const regionCanvas = new OffscreenCanvas(1, 1);
  const regionCtx = regionCanvas.getContext("2d");
  if (!regionCtx) return out;

  for (let index = 0; index < regions.length && index < MAX_OUTPUT_COUNT; index += 1) {
    const region = regions[index]!;
    const regionWidth = region.maxX - region.minX + 1;
    const regionHeight = region.maxY - region.minY + 1;

    regionCanvas.width = regionWidth;
    regionCanvas.height = regionHeight;
    regionCtx.clearRect(0, 0, regionWidth, regionHeight);
    regionCtx.drawImage(
      bitmap,
      region.minX,
      region.minY,
      regionWidth,
      regionHeight,
      0,
      0,
      regionWidth,
      regionHeight
    );

    const blob = await regionCanvas.convertToBlob({ type: "image/png" });
    out.push({
      index,
      x: region.minX,
      y: region.minY,
      width: regionWidth,
      height: regionHeight,
      blob,
    });
  }

  return out;
};

const splitRectsByRegions = async (
  bitmap: ImageBitmap
): Promise<SplitImageRectItem[]> => {
  const out: SplitImageRectItem[] = [];

  if (typeof OffscreenCanvas === "undefined") return out;

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true } as any);
  if (!ctx) return out;

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const regions = findNonWhiteRegions(
    imageData.data,
    imageData.width,
    imageData.height
  );
  if (!regions.length) return out;

  for (let index = 0; index < regions.length && index < MAX_OUTPUT_COUNT; index += 1) {
    const region = regions[index]!;
    const regionWidth = region.maxX - region.minX + 1;
    const regionHeight = region.maxY - region.minY + 1;
    out.push({
      index,
      x: region.minX,
      y: region.minY,
      width: regionWidth,
      height: regionHeight,
    });
  }

  return out;
};

const clampRectToBitmap = (
  rect: SplitImageRectItem,
  bitmapW: number,
  bitmapH: number
): SplitImageRectItem => {
  const x0 = Math.max(0, Math.min(bitmapW - 1, Math.floor(rect.x)));
  const y0 = Math.max(0, Math.min(bitmapH - 1, Math.floor(rect.y)));
  const x1 = Math.max(x0 + 1, Math.min(bitmapW, Math.ceil(rect.x + rect.width)));
  const y1 = Math.max(y0 + 1, Math.min(bitmapH, Math.ceil(rect.y + rect.height)));
  return {
    index: rect.index,
    x: x0,
    y: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  };
};

const trimRectToContent = async (
  bitmap: ImageBitmap,
  rect: SplitImageRectItem,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D
): Promise<SplitImageRectItem> => {
  const safe = clampRectToBitmap(rect, bitmap.width, bitmap.height);
  const area = safe.width * safe.height;
  const scale = area > TRIM_MAX_PIXELS ? Math.sqrt(TRIM_MAX_PIXELS / area) : 1;
  const sw = Math.max(1, Math.floor(safe.width * scale));
  const sh = Math.max(1, Math.floor(safe.height * scale));

  canvas.width = sw;
  canvas.height = sh;
  try {
    // @ts-ignore - 部分环境无此字段
    ctx.imageSmoothingEnabled = false;
  } catch {}
  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(bitmap, safe.x, safe.y, safe.width, safe.height, 0, 0, sw, sh);

  const img = ctx.getImageData(0, 0, sw, sh);
  const bounds = findContentBounds(img.data, sw, sh);
  if (!bounds) return safe;

  const scaleX = sw / safe.width;
  const scaleY = sh / safe.height;

  const x0 = safe.x + Math.floor(bounds.minX / scaleX);
  const y0 = safe.y + Math.floor(bounds.minY / scaleY);
  const x1 = safe.x + Math.ceil((bounds.maxX + 1) / scaleX);
  const y1 = safe.y + Math.ceil((bounds.maxY + 1) / scaleY);

  const clampedX0 = Math.max(0, Math.min(bitmap.width - 1, x0));
  const clampedY0 = Math.max(0, Math.min(bitmap.height - 1, y0));
  const clampedX1 = Math.max(clampedX0 + 1, Math.min(bitmap.width, x1));
  const clampedY1 = Math.max(clampedY0 + 1, Math.min(bitmap.height, y1));

  const trimmed = {
    index: rect.index,
    x: clampedX0,
    y: clampedY0,
    width: Math.max(1, clampedX1 - clampedX0),
    height: Math.max(1, clampedY1 - clampedY0),
  };

  // 过滤极端情况：如果裁得过小，保留原 rect（避免误判导致内容丢失）
  if (trimmed.width < 2 || trimmed.height < 2) return safe;

  return trimmed;
};

const trimRectsToContent = async (
  bitmap: ImageBitmap,
  rects: SplitImageRectItem[]
): Promise<SplitImageRectItem[]> => {
  if (!rects.length) return rects;
  if (typeof OffscreenCanvas === "undefined") return rects;

  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d", { willReadFrequently: true } as any);
  if (!ctx) return rects;

  const out: SplitImageRectItem[] = [];
  for (const rect of rects) {
    out.push(await trimRectToContent(bitmap, rect, canvas, ctx));
  }
  return out;
};

const resolveSourceToBlob = async (
  source: SplitImageSource,
  authToken?: string
): Promise<Blob> => {
  if (source.kind === "blob") {
    // 验证 blob 是图片类型
    if (source.blob.type && !source.blob.type.startsWith("image/")) {
      throw new Error(`无效的图片格式: ${source.blob.type}`);
    }
    return source.blob;
  }

  const url = typeof source.url === "string" ? source.url.trim() : "";
  if (!url) throw new Error("缺少图片地址");

  const init: RequestInit = /^blob:/i.test(url) ? {} : { mode: "cors", credentials: "omit" };
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
  const response = await fetchWithAuth(url, {
    ...init,
    headers,
    auth: "omit",
    allowRefresh: false,
  });
  if (!response.ok) {
    throw new Error(`图片加载失败 (${response.status})`);
  }
  const blob = await response.blob();

  // 验证返回的内容是图片类型
  if (blob.type && !blob.type.startsWith("image/")) {
    throw new Error(`源图片无法解码: 服务器返回了 ${blob.type} 而非图片`);
  }

  return blob;
};

self.addEventListener(
  "message",
  (
    event: MessageEvent<SplitImageRequest | SplitImageRectsRequest>
  ) => {
    const data = event.data;
    if (!data) return;

    if (data.type === "SPLIT_IMAGE") {
      const run = async (): Promise<SplitImageResponse> => {
        try {
          if (
            typeof createImageBitmap !== "function" ||
            typeof OffscreenCanvas === "undefined"
          ) {
            return {
              type: "SPLIT_IMAGE_RESULT",
              requestId: data.requestId,
              success: false,
              error: "当前环境不支持 OffscreenCanvas/createImageBitmap",
            };
          }

          const safeCount = Math.min(
            MAX_OUTPUT_COUNT,
            Math.max(MIN_OUTPUT_COUNT, Math.floor(data.outputCount || DEFAULT_OUTPUT_COUNT))
          );

          const blob = await resolveSourceToBlob(data.source, data.authToken);
          const bitmap = await createImageBitmap(blob);

          let pieces: Array<
            Omit<SplitImageResultItem, "buffer" | "contentType"> & { blob: Blob }
          > = [];

          const canDetect = await shouldAttemptRegionDetect(bitmap);
          if (canDetect) {
            pieces = await splitByRegions(bitmap);
          }

          const tooManyPieces =
            pieces.length >
            Math.min(MAX_OUTPUT_COUNT, Math.max(safeCount, DEFAULT_OUTPUT_COUNT)) * 2;

          if (pieces.length <= 1 || tooManyPieces) {
            pieces = await splitByGrid(bitmap, safeCount);
          }

          try {
            bitmap.close();
          } catch {}

          const sliced = pieces.slice(0, MAX_OUTPUT_COUNT);
          const items: SplitImageResultItem[] = [];

          for (const piece of sliced) {
            const contentType = piece.blob.type || "image/png";
            const buffer = await piece.blob.arrayBuffer();
            items.push({
              index: piece.index,
              x: piece.x,
              y: piece.y,
              width: piece.width,
              height: piece.height,
              contentType,
              buffer,
            });
          }

          return {
            type: "SPLIT_IMAGE_RESULT",
            requestId: data.requestId,
            success: true,
            items,
          };
        } catch (error: unknown) {
          return {
            type: "SPLIT_IMAGE_RESULT",
            requestId: data.requestId,
            success: false,
            error:
              error instanceof Error
                ? error.message
                : typeof error === "string"
                ? error
                : "图片分割失败",
          };
        }
      };

      void run().then((resp) => {
        const transfer: Transferable[] = [];
        if (resp.success && Array.isArray(resp.items)) {
          resp.items.forEach((it) => {
            if (it.buffer) transfer.push(it.buffer);
          });
        }
        self.postMessage(resp, transfer);
      });
      return;
    }

    if (data.type !== "SPLIT_IMAGE_RECTS") return;

    const run = async (): Promise<SplitImageRectsResponse> => {
      try {
        if (
          typeof createImageBitmap !== "function" ||
          typeof OffscreenCanvas === "undefined"
        ) {
          return {
            type: "SPLIT_IMAGE_RECTS_RESULT",
            requestId: data.requestId,
            success: false,
            error: "当前环境不支持 OffscreenCanvas/createImageBitmap",
          };
        }

        const safeCount = Math.min(
          MAX_OUTPUT_COUNT,
          Math.max(MIN_OUTPUT_COUNT, Math.floor(data.outputCount || DEFAULT_OUTPUT_COUNT))
        );

        const blob = await resolveSourceToBlob(data.source, data.authToken);
        const bitmap = await createImageBitmap(blob);

        let rects: SplitImageRectItem[] = [];
        let usedGrid = false;

        const canDetect = await shouldAttemptRegionDetect(bitmap);
        if (canDetect) {
          rects = await splitRectsByRegions(bitmap);
        }

        const tooManyPieces =
          rects.length >
          Math.min(MAX_OUTPUT_COUNT, Math.max(safeCount, DEFAULT_OUTPUT_COUNT)) * 2;

        // 端口语义：输出数量必须严格等于 safeCount。
        // - 连通域检测可能得到任意数量的区域（更像“份数”），会破坏“端口数量(1-50)”的语义；
        // - 网格切分则能保证输出数量与每块尺寸稳定（例如 2048 -> 16 份，每块 512x512）。
        //
        // 因此：仅当连通域检测刚好得到 safeCount 时才采纳，否则回退到网格切分。
        if (rects.length !== safeCount || rects.length <= 1 || tooManyPieces) {
          rects = splitRectsByGrid(bitmap, safeCount);
          usedGrid = true;
        }

        // 去白边裁切会改变每块输出尺寸；仅在“连通域检测模式”下启用，避免网格切分出现尺寸不一致。
        if (!usedGrid && (await looksLikeWhiteBackground(bitmap))) {
          rects = await trimRectsToContent(bitmap, rects);
        }

        const sourceWidth = bitmap.width;
        const sourceHeight = bitmap.height;
        try {
          bitmap.close();
        } catch {}

        return {
          type: "SPLIT_IMAGE_RECTS_RESULT",
          requestId: data.requestId,
          success: true,
          rects: rects.slice(0, MAX_OUTPUT_COUNT),
          sourceWidth,
          sourceHeight,
        };
      } catch (error: unknown) {
        return {
          type: "SPLIT_IMAGE_RECTS_RESULT",
          requestId: data.requestId,
          success: false,
          error:
            error instanceof Error
              ? error.message
              : typeof error === "string"
              ? error
              : "图片分割失败",
        };
      }
    };

    void run().then((resp) => {
      self.postMessage(resp);
    });
  }
);

export {};
