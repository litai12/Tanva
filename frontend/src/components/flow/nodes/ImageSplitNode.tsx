import React from 'react';
import {
  Handle,
  Position,
  NodeResizer,
  useReactFlow,
  useStore,
  useUpdateNodeInternals,
  type ReactFlowState,
  type Edge,
  type Node,
} from 'reactflow';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { imageSplitWorkerClient } from '@/services/imageSplitWorkerClient';
import { deleteFlowImage, parseFlowImageAssetRef, putFlowImageBlobs, toFlowImageAssetRef } from '@/services/flowImageAssetStore';
import { useFlowImageAssetUrl } from '@/hooks/useFlowImageAssetUrl';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { isPersistableImageRef, normalizePersistableImageRef, resolveImageToBlob } from '@/utils/imageSource';
import { canvasToBlob, createImageBitmapLimited } from '@/utils/imageConcurrency';
import SmartImage from '../../ui/SmartImage';
import { shallow } from 'zustand/shallow';

// 类型定义
type SplitRectItem = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LegacySplitImageItem = SplitRectItem & {
  imageData: string; // flow-asset / base64 / URL
};

type UpstreamImageItem = {
  id: string;
  imageData: string; // base64 或 URL
};

type CropInfo = {
  baseRef: string;
  rect: { x: number; y: number; width: number; height: number };
  sourceWidth?: number;
  sourceHeight?: number;
};

type CropSpec = {
  identity: string;
  baseRef: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'processing' | 'succeeded' | 'failed';
    inputImage?: string;
    inputImageUrl?: string;
    // 方案A：仅持久化裁切矩形，不持久化切片图片数据
    splitRects?: SplitRectItem[];
    sourceWidth?: number;
    sourceHeight?: number;
    // legacy：历史数据可能仍包含 splitImages
    splitImages?: LegacySplitImageItem[];
    outputCount?: number;
    error?: string;
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

const MIN_OUTPUT_COUNT = 1;
const MAX_OUTPUT_COUNT = 50;
const DEFAULT_OUTPUT_COUNT = 9;

const normalizeMimeType = (type: string): string => {
  const lower = type.trim().toLowerCase();
  if (lower === 'image/jpg') return 'image/jpeg';
  return lower;
};

const isRasterImage = (type: string): boolean => {
  const lower = normalizeMimeType(type);
  return (
    lower === 'image/png' ||
    lower === 'image/jpeg' ||
    lower === 'image/webp'
  );
};

const shouldBypassCanvasReencode = (type: string): boolean => {
  const lower = normalizeMimeType(type);
  if (lower === 'image/gif') return true; // 保留动图
  if (lower === 'image/svg+xml') return true; // 保留矢量
  return false;
};

const estimateSafeCanvas = (width: number, height: number): boolean => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  // 避免在主线程创建超大画布导致内存峰值过高
  return width * height <= 32_000_000; // ~32MP
};

const makeCanvas = (width: number, height: number): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const cropImageToBlob = async (params: CropInfo): Promise<Blob | null> => {
  const baseRef = params.baseRef?.trim?.() || '';
  if (!baseRef) return null;

  const w = Math.max(1, Math.round(params.rect.width));
  const h = Math.max(1, Math.round(params.rect.height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  // 目标输出尺寸：使用“源坐标系”的裁切尺寸
  const MAX_OUTPUT_PIXELS = 32_000_000;
  const outputScale = w * h > MAX_OUTPUT_PIXELS ? Math.sqrt(MAX_OUTPUT_PIXELS / (w * h)) : 1;
  const outW = Math.max(1, Math.floor(w * outputScale));
  const outH = Math.max(1, Math.floor(h * outputScale));

  const blob = await resolveImageToBlob(baseRef, { preferProxy: true });
  if (!blob) return null;

  // 优先 ImageBitmap
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmapLimited(blob);
      const naturalW = bitmap.width;
      const naturalH = bitmap.height;
      if (!naturalW || !naturalH) return null;

      const srcW = typeof params.sourceWidth === 'number' && params.sourceWidth > 0 ? params.sourceWidth : naturalW;
      const srcH = typeof params.sourceHeight === 'number' && params.sourceHeight > 0 ? params.sourceHeight : naturalH;

      const scaleX = srcW > 0 ? naturalW / srcW : 1;
      const scaleY = srcH > 0 ? naturalH / srcH : 1;

      const sx = Math.max(0, Math.min(naturalW - 1, Math.round(params.rect.x * scaleX)));
      const sy = Math.max(0, Math.min(naturalH - 1, Math.round(params.rect.y * scaleY)));
      const swRaw = Math.max(1, Math.round(params.rect.width * scaleX));
      const shRaw = Math.max(1, Math.round(params.rect.height * scaleY));
      const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
      const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

      const canvas = makeCanvas(outW, outH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      try {
        // @ts-ignore - 部分环境无此字段
        ctx.imageSmoothingEnabled = true;
      } catch {}
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
      return await canvasToBlob(canvas, { type: 'image/png' });
    } catch {
      return null;
    } finally {
      if (bitmap) {
        try { bitmap.close(); } catch {}
      }
    }
  }

  // 兜底：HTMLImageElement
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = objectUrl;
    });

    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return null;

    const srcW = typeof params.sourceWidth === 'number' && params.sourceWidth > 0 ? params.sourceWidth : naturalW;
    const srcH = typeof params.sourceHeight === 'number' && params.sourceHeight > 0 ? params.sourceHeight : naturalH;

    const scaleX = srcW > 0 ? naturalW / srcW : 1;
    const scaleY = srcH > 0 ? naturalH / srcH : 1;

    const sx = Math.max(0, Math.min(naturalW - 1, Math.round(params.rect.x * scaleX)));
    const sy = Math.max(0, Math.min(naturalH - 1, Math.round(params.rect.y * scaleY)));
    const swRaw = Math.max(1, Math.round(params.rect.width * scaleX));
    const shRaw = Math.max(1, Math.round(params.rect.height * scaleY));
    const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
    const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

    const canvas = makeCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try {
      // @ts-ignore - 部分环境无此字段
      ctx.imageSmoothingEnabled = true;
    } catch {}
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    return await canvasToBlob(canvas, { type: 'image/png' });
  } catch {
    return null;
  } finally {
    try { URL.revokeObjectURL(objectUrl); } catch {}
  }
};

// 仅用于运行时：通过 canvas 重编码，去除 EXIF/元数据，确保后续裁切坐标系一致（但不上传 OSS）
const normalizeBlobForRuntime = async (blob: Blob): Promise<Blob> => {
  const type = normalizeMimeType(blob.type || 'image/png');
  if (!type.startsWith('image/')) return blob;
  if (shouldBypassCanvasReencode(type)) return blob;
  if (!isRasterImage(type)) return blob;
  if (typeof createImageBitmap !== 'function') return blob;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmapLimited(blob);
    const width = bitmap.width;
    const height = bitmap.height;

    if (!estimateSafeCanvas(width, height)) return blob;

    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;

    ctx.drawImage(bitmap, 0, 0, width, height);
    const quality = type === 'image/jpeg' || type === 'image/webp' ? 0.92 : undefined;
    return await canvasToBlob(canvas, { type, quality });
  } catch {
    return blob;
  } finally {
    if (bitmap) {
      try { bitmap.close(); } catch {}
    }
  }
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

// 构建图片 src
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:image')) return trimmed;
  if (trimmed.startsWith('blob:')) return trimmed;
  if (trimmed.startsWith('/api/assets/proxy') || trimmed.startsWith('/assets/proxy')) {
    return proxifyRemoteAssetUrl(trimmed);
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }
  if (/^(templates|projects|uploads|videos)\//i.test(trimmed)) {
    return proxifyRemoteAssetUrl(
      `/api/assets/proxy?key=${encodeURIComponent(trimmed.replace(/^\/+/, ''))}`
    );
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return proxifyRemoteAssetUrl(trimmed);
  }
  return `data:image/png;base64,${trimmed}`;
};

const readImageFromNode = (node: Node<any>, sourceHandle?: string | null): string | undefined => {
  if (!node) return undefined;
  const d = (node.data ?? {}) as Record<string, unknown>;

  // imageSplit：按 image1..imageN 读取
  if (node.type === 'imageSplit' && typeof sourceHandle === 'string') {
    const match = /^image(\d+)$/.exec(sourceHandle);
    if (match) {
      const key = `image${match[1]}`;
      const direct = normalizeString(d[key]);
      if (direct) return direct;

      const splitImages = d.splitImages as LegacySplitImageItem[] | undefined;
      const idx = Math.max(0, Number(match[1]) - 1);
      const fromList = splitImages?.[idx]?.imageData;
      return normalizeString(fromList);
    }
  }

  // imageGrid：读取拼合后的 outputImage
  if (node.type === 'imageGrid') {
    return normalizeString(d.outputImage);
  }

  // videoFrameExtract：读取单帧 image
  if (node.type === 'videoFrameExtract' && sourceHandle === 'image') {
    const frames = d.frames as Array<{ index: number; imageUrl: string; thumbnailDataUrl?: string }> | undefined;
    if (!frames || frames.length === 0) return undefined;
    const selectedFrameIndex = (d.selectedFrameIndex ?? 1) as number;
    const idx = Math.max(0, Number(selectedFrameIndex) - 1);
    const frame = frames[idx];
    if (!frame) return undefined;
    // 输出语义优先使用原图（imageUrl），缩略图仅用于预览
    return normalizeString(frame.imageUrl) || normalizeString(frame.thumbnailDataUrl);
  }

  // Generate4 / GeneratePro4：按 img1..img4 读取
  if ((node.type === 'generate4' || node.type === 'generatePro4') && typeof sourceHandle === 'string') {
    const match = /^img(\d+)$/.exec(sourceHandle);
    if (match) {
      const idx = Math.max(0, Number(match[1]) - 1);
      const imageUrls = d.imageUrls as string[] | undefined;
      const images = d.images as string[] | undefined;
      const thumbnails = d.thumbnails as string[] | undefined;
      return (
        normalizeString(imageUrls?.[idx]) ||
        normalizeString(images?.[idx]) ||
        normalizeString(thumbnails?.[idx])
      );
    }
  }

  // 通用：优先读 imageData / imageUrl / outputImage，其次读 thumbnail/thumbnailDataUrl（兼容“仅缩略图”的节点数据）
  return (
    normalizeString(d.imageData) ||
    normalizeString(d.imageUrl) ||
    normalizeString(d.outputImage) ||
    normalizeString(d.thumbnailDataUrl) ||
    normalizeString(d.thumbnail)
  );
};

const readImagesFromNode = (node: Node<any>, sourceHandle?: string | null): UpstreamImageItem[] => {
  if (!node) return [];
  const d = (node.data ?? {}) as Record<string, unknown>;

  // videoFrameExtract：按 sourceHandle 决定单帧/范围/全部
  if (node.type === 'videoFrameExtract' && Array.isArray(d.frames)) {
    const frames = d.frames as Array<{ index: number; imageUrl: string; thumbnailDataUrl?: string }>;
    const selectedFrameIndex = (d.selectedFrameIndex ?? 1) as number;
    const rangeStart = (d.rangeStart ?? 1) as number;
    const rangeEnd = (d.rangeEnd ?? frames.length) as number;

    if (sourceHandle === 'image') {
      const idx = Math.max(0, Number(selectedFrameIndex) - 1);
      const frame = frames[idx];
      const value = normalizeString(frame?.thumbnailDataUrl) || normalizeString(frame?.imageUrl);
      return value ? [{ id: `${node.id}-frame-${idx + 1}`, imageData: value }] : [];
    }

    if (sourceHandle === 'images-range') {
      const start = Math.max(0, Number(rangeStart) - 1);
      const end = Math.min(frames.length, Math.max(start, Number(rangeEnd)));
      return frames
        .slice(start, end)
        .map((frame, i) => {
          const value = normalizeString(frame.imageUrl) || normalizeString(frame.thumbnailDataUrl);
          return value ? { id: `${node.id}-range-${start + i + 1}`, imageData: value } : null;
        })
        .filter(Boolean) as UpstreamImageItem[];
    }

    // 默认：全部帧（兼容未标注 sourceHandle 的旧边）
    return frames
      .map((frame, i) => {
        const value = normalizeString(frame.imageUrl) || normalizeString(frame.thumbnailDataUrl);
        return value ? { id: `${node.id}-images-${i + 1}`, imageData: value } : null;
      })
      .filter(Boolean) as UpstreamImageItem[];
  }

  // imageSplit：可输出单张（imageX）或整个 splitImages（兼容少数场景）
  if (node.type === 'imageSplit') {
    if (typeof sourceHandle === 'string') {
      const match = /^image(\d+)$/.exec(sourceHandle);
      if (match) {
        const key = `image${match[1]}`;
        const direct = normalizeString(d[key]);
        if (direct) return [{ id: `${node.id}-${key}`, imageData: direct }];

        const splitImages = d.splitImages as LegacySplitImageItem[] | undefined;
        const idx = Math.max(0, Number(match[1]) - 1);
        const fromList = normalizeString(splitImages?.[idx]?.imageData);
        return fromList ? [{ id: `${node.id}-split-${idx + 1}`, imageData: fromList }] : [];
      }
    }

    const splitImages = d.splitImages as LegacySplitImageItem[] | undefined;
    if (Array.isArray(splitImages) && splitImages.length > 0) {
      return splitImages
        .map((img, idx) => {
          const value = normalizeString(img?.imageData);
          return value ? { id: `${node.id}-split-${idx + 1}`, imageData: value } : null;
        })
        .filter(Boolean) as UpstreamImageItem[];
    }
  }

  // Generate4 / GeneratePro4：按 img1..img4 读取
  if ((node.type === 'generate4' || node.type === 'generatePro4') && typeof sourceHandle === 'string') {
    const match = /^img(\d+)$/.exec(sourceHandle);
    if (match) {
      const idx = Math.max(0, Number(match[1]) - 1);
      const imageUrls = d.imageUrls as string[] | undefined;
      const images = d.images as string[] | undefined;
      const thumbnails = d.thumbnails as string[] | undefined;
      const value =
        normalizeString(imageUrls?.[idx]) ||
        normalizeString(images?.[idx]) ||
        normalizeString(thumbnails?.[idx]);
      return value ? [{ id: `${node.id}-img-${idx + 1}`, imageData: value }] : [];
    }
  }

  const single = readImageFromNode(node, sourceHandle);
  return single ? [{ id: node.id, imageData: single }] : [];
};

// 检测像素是否为白色（允许一定容差）
const isWhitePixel = (r: number, g: number, b: number, threshold = 250): boolean => {
  return r >= threshold && g >= threshold && b >= threshold;
};

const TRIM_MAX_PIXELS = 4_000_000; // ~4MP，避免单次 getImageData 过大导致内存峰值
const WHITE_BG_RATIO_THRESHOLD = 0.55;

const toLuma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// 更宽松的“白底/纸张底色”判断：用于去白边裁切（而非连通域检测）
const isLightBackgroundPixel = (r: number, g: number, b: number, a: number): boolean => {
  if (a <= 12) return true; // 透明视为背景
  if (r >= 245 && g >= 245 && b >= 245) return true;
  if (r >= 235 && g >= 235 && b >= 235) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const luma = toLuma(r, g, b);
  return luma >= 225 && chroma <= 35;
};

type ContentBounds = { minX: number; minY: number; maxX: number; maxY: number };

const findContentBoundsInRect = (
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): ContentBounds | null => {
  let minX = x1;
  let minY = y1;
  let maxX = -1;
  let maxY = -1;

  for (let y = y0; y < y1; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = x0; x < x1; x += 1) {
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

const looksLikeWhiteBackgroundFromSample = (img: HTMLImageElement): boolean => {
  const w = Math.min(96, img.width);
  const h = Math.min(96, img.height);
  if (w <= 0 || h <= 0) return false;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx =
    (canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null) ||
    (canvas.getContext('2d') as CanvasRenderingContext2D | null);
  if (!ctx) return false;
  try {
    // @ts-ignore - 部分环境无此字段
    ctx.imageSmoothingEnabled = false;
  } catch {}

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const sampled = ctx.getImageData(0, 0, w, h);
  const data = sampled.data;
  let white = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    if (isLightBackgroundPixel(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!)) white += 1;
  }
  const ratio = total > 0 ? white / total : 0;
  return ratio >= WHITE_BG_RATIO_THRESHOLD;
};

const trimRectsByDownsample = (
  img: HTMLImageElement,
  rects: SplitRectItem[]
): SplitRectItem[] => {
  if (!rects.length) return rects;
  if (img.width <= 0 || img.height <= 0) return rects;

  const totalPixels = img.width * img.height;
  const scale =
    totalPixels > TRIM_MAX_PIXELS ? Math.sqrt(TRIM_MAX_PIXELS / totalPixels) : 1;
  const sw = Math.max(1, Math.floor(img.width * scale));
  const sh = Math.max(1, Math.floor(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx =
    (canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null) ||
    (canvas.getContext('2d') as CanvasRenderingContext2D | null);
  if (!ctx) return rects;
  try {
    // @ts-ignore - 部分环境无此字段
    ctx.imageSmoothingEnabled = false;
  } catch {}

  ctx.clearRect(0, 0, sw, sh);
  ctx.drawImage(img, 0, 0, sw, sh);
  const imageData = ctx.getImageData(0, 0, sw, sh);
  const data = imageData.data;
  const scaleX = sw / img.width;
  const scaleY = sh / img.height;

  return rects.map((rect) => {
    const x0 = Math.max(0, Math.min(sw - 1, Math.floor(rect.x * scaleX)));
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(rect.y * scaleY)));
    const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((rect.x + rect.width) * scaleX)));
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((rect.y + rect.height) * scaleY)));

    const bounds = findContentBoundsInRect(data, sw, x0, y0, x1, y1);
    if (!bounds) return rect;

    const ox0 = Math.max(0, Math.min(img.width - 1, Math.floor(bounds.minX / scaleX)));
    const oy0 = Math.max(0, Math.min(img.height - 1, Math.floor(bounds.minY / scaleY)));
    const ox1 = Math.max(ox0 + 1, Math.min(img.width, Math.ceil((bounds.maxX + 1) / scaleX)));
    const oy1 = Math.max(oy0 + 1, Math.min(img.height, Math.ceil((bounds.maxY + 1) / scaleY)));

    const trimmed = {
      ...rect,
      x: ox0,
      y: oy0,
      width: Math.max(1, ox1 - ox0),
      height: Math.max(1, oy1 - oy0),
    };

    if (trimmed.width < 2 || trimmed.height < 2) return rect;
    return trimmed;
  });
};

type SplitRectsResult = {
  rects: SplitRectItem[];
  sourceWidth: number;
  sourceHeight: number;
};

const splitRectsByGrid = async (imageSrc: string, count: number): Promise<SplitRectsResult> => {
  const safeCount = Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, Math.floor(count || DEFAULT_OUTPUT_COUNT)));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const cols = Math.max(1, Math.ceil(Math.sqrt(safeCount)));
        const rows = Math.max(1, Math.ceil(safeCount / cols));

        let rects: SplitRectItem[] = [];

        for (let i = 0; i < safeCount; i += 1) {
          const row = Math.floor(i / cols);
          const col = i % cols;

          const x0 = Math.round((col / cols) * img.width);
          const x1 = Math.round(((col + 1) / cols) * img.width);
          const y0 = Math.round((row / rows) * img.height);
          const y1 = Math.round(((row + 1) / rows) * img.height);

          const w = Math.max(1, x1 - x0);
          const h = Math.max(1, y1 - y0);

          rects.push({ index: i, x: x0, y: y0, width: w, height: h });
        }

        // 白底场景：按内容去白边（避免“报纸/证件照”类切片带大面积白边）
        if (looksLikeWhiteBackgroundFromSample(img)) {
          rects = trimRectsByDownsample(img, rects);
        }

        resolve({ rects, sourceWidth: img.width, sourceHeight: img.height });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageSrc;
  });
};

// 智能检测并分割图片
const detectAndSplitRects = async (imageSrc: string): Promise<SplitRectsResult> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        // 先用小尺寸采样判断是否值得做“非白色连通域”检测：
        // 对于照片/满屏内容图，连通域扫描会遍历大量像素并产生巨大队列（内存与 CPU 开销很高），
        // 而最终也会回落到网格切分，因此直接跳过。
        const totalPixels = img.width * img.height;
        const MAX_PIXELS_FOR_REGION_DETECT = 2_000_000; // ~2MP
        const SAMPLE_SIZE = 96;
        const looksLikeWhiteBackground = looksLikeWhiteBackgroundFromSample(img);
        if (!looksLikeWhiteBackground || totalPixels > MAX_PIXELS_FOR_REGION_DETECT) {
          resolve({ rects: [], sourceWidth: img.width, sourceHeight: img.height });
          return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建 canvas context'));
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data, width, height } = imageData;

        // 检测非白色区域的边界框
        const regions = findNonWhiteRegions(data, width, height);

        const rects: SplitRectItem[] = [];
        regions.forEach((region, index) => {
          const regionWidth = region.maxX - region.minX + 1;
          const regionHeight = region.maxY - region.minY + 1;

          rects.push({
            index,
            x: region.minX,
            y: region.minY,
            width: regionWidth,
            height: regionHeight,
          });
        });

        // 去白边：基于完整 imageData 做精确裁切（仅小图/白底场景执行）
        const trimmed = rects.map((r) => {
          const x0 = Math.max(0, Math.min(width - 1, Math.floor(r.x)));
          const y0 = Math.max(0, Math.min(height - 1, Math.floor(r.y)));
          const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(r.x + r.width)));
          const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(r.y + r.height)));
          const bounds = findContentBoundsInRect(data, width, x0, y0, x1, y1);
          if (!bounds) return r;

          const tx0 = Math.max(0, Math.min(width - 1, bounds.minX));
          const ty0 = Math.max(0, Math.min(height - 1, bounds.minY));
          const tx1 = Math.max(tx0 + 1, Math.min(width, bounds.maxX + 1));
          const ty1 = Math.max(ty0 + 1, Math.min(height, bounds.maxY + 1));
          const next = {
            ...r,
            x: tx0,
            y: ty0,
            width: Math.max(1, tx1 - tx0),
            height: Math.max(1, ty1 - ty0),
          };
          if (next.width < 2 || next.height < 2) return r;
          return next;
        });

        resolve({ rects: trimmed, sourceWidth: img.width, sourceHeight: img.height });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = imageSrc;
  });
};

// 查找非白色区域
type Region = { minX: number; minY: number; maxX: number; maxY: number };

const findNonWhiteRegions = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): Region[] => {
  // 创建访问标记数组
  const visited = new Uint8Array(width * height);
  const regions: Region[] = [];

  const isNonWhiteIdx = (pixelIdx: number): boolean => {
    if (pixelIdx < 0 || pixelIdx >= width * height) return false;
    const idx = pixelIdx * 4;
    return !isWhitePixel(data[idx], data[idx + 1], data[idx + 2]);
  };

  // 使用连通域（BFS）查找连通区域
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      if (visited[pixelIdx] || !isNonWhiteIdx(pixelIdx)) continue;

      // 发现新区域，使用 BFS 扩展
      const region: Region = { minX: x, minY: y, maxX: x, maxY: y };
      const queue: number[] = [pixelIdx];
      let head = 0;
      visited[pixelIdx] = 1;

      while (head < queue.length) {
        const idx = queue[head++]!;
        const cx = idx % width;
        const cy = Math.floor(idx / width);

        // 更新边界
        region.minX = Math.min(region.minX, cx);
        region.minY = Math.min(region.minY, cy);
        region.maxX = Math.max(region.maxX, cx);
        region.maxY = Math.max(region.maxY, cy);

        // 检查四个方向的邻居（避免每像素创建 neighbors 数组）
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

      // 过滤太小的区域（噪点）
      const regionWidth = region.maxX - region.minX + 1;
      const regionHeight = region.maxY - region.minY + 1;
      if (regionWidth > 20 && regionHeight > 20) {
        regions.push(region);
      }
    }
  }

  // 按位置排序（从上到下，从左到右）
  regions.sort((a, b) => {
    const rowA = Math.floor(a.minY / 50);
    const rowB = Math.floor(b.minY / 50);
    if (rowA !== rowB) return rowA - rowB;
    return a.minX - b.minX;
  });

  return regions;
};

function SplitRectPreview({
  index,
  rect,
  sourceSrc,
  sourceWidth,
  sourceHeight,
}: {
  index: number;
  rect: SplitRectItem;
  sourceSrc?: string;
  sourceWidth?: number;
  sourceHeight?: number;
}) {
  const thumbSize = 48;
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const canRender =
    !!sourceSrc &&
    typeof sourceWidth === 'number' &&
    typeof sourceHeight === 'number' &&
    sourceWidth > 0 &&
    sourceHeight > 0 &&
    rect.width > 0 &&
    rect.height > 0;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.round(thumbSize * dpr));
    canvas.height = Math.max(1, Math.round(thumbSize * dpr));
    canvas.style.width = `${thumbSize}px`;
    canvas.style.height = `${thumbSize}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, thumbSize, thumbSize);

    if (!canRender || !sourceSrc) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, thumbSize, thumbSize);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    const draw = () => {
      if (cancelled) return;
      const srcW = sourceWidth || img.naturalWidth || img.width;
      const srcH = sourceHeight || img.naturalHeight || img.height;

      const scaleX = srcW > 0 ? (img.naturalWidth || img.width) / srcW : 1;
      const scaleY = srcH > 0 ? (img.naturalHeight || img.height) / srcH : 1;

      const sxRaw = rect.x * scaleX;
      const syRaw = rect.y * scaleY;
      const swRaw = rect.width * scaleX;
      const shRaw = rect.height * scaleY;

      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;

      const sx = Math.max(0, Math.min(naturalW - 1, sxRaw));
      const sy = Math.max(0, Math.min(naturalH - 1, syRaw));
      const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
      const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

      // cover 渲染：让裁剪块填满 48x48
      const scale = Math.max(thumbSize / sw, thumbSize / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const dx = (thumbSize - dw) / 2;
      const dy = (thumbSize - dh) / 2;

      ctx.clearRect(0, 0, thumbSize, thumbSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, thumbSize, thumbSize);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    };

    img.onload = draw;
    img.onerror = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, thumbSize, thumbSize);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, thumbSize, thumbSize);
    };
    img.src = sourceSrc;

    return () => {
      cancelled = true;
    };
  }, [canRender, rect.height, rect.width, rect.x, rect.y, sourceHeight, sourceSrc, sourceWidth]);

  return (
    <div style={{
      width: thumbSize,
      height: thumbSize,
      border: '1px solid #d1d5db',
      borderRadius: 4,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      <span style={{
        position: 'absolute',
        bottom: 0,
        right: 0,
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: 10,
        padding: '1px 3px',
      }}>
        {index + 1}
      </span>
    </div>
  );
}

function ImageSplitNodeInner({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const edgesRef = React.useRef<Edge[]>(edges);
  const projectId = useProjectContentStore((s) => s.projectId);

  const [splitRects, setSplitRects] = React.useState<SplitRectItem[]>(() => {
    if (Array.isArray(data.splitRects) && data.splitRects.length > 0) {
      return data.splitRects;
    }
    const legacy = Array.isArray(data.splitImages) ? data.splitImages : [];
    return legacy.map((it) => ({
      index: it.index,
      x: it.x,
      y: it.y,
      width: it.width,
      height: it.height,
    }));
  });
  const [sourceSize, setSourceSize] = React.useState<{ width: number; height: number }>(() => ({
    width: typeof data.sourceWidth === 'number' ? data.sourceWidth : 0,
    height: typeof data.sourceHeight === 'number' ? data.sourceHeight : 0,
  }));
  const [outputCount, setOutputCount] = React.useState<number>(
    Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, data.outputCount || DEFAULT_OUTPUT_COUNT))
  );
  const [hover, setHover] = React.useState<string | null>(null);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [derivedInputRef, setDerivedInputRef] = React.useState<string | null>(null);
  const derivedInputRefLatest = React.useRef<string | null>(null);

  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  React.useEffect(() => {
    derivedInputRefLatest.current = derivedInputRef;
  }, [derivedInputRef]);

  // 组件卸载时清理“仅运行时”的临时裁切输入，避免 IndexedDB 资源累积
  React.useEffect(() => {
    return () => {
      const ref = derivedInputRefLatest.current;
      const assetId = ref ? parseFlowImageAssetRef(ref) : null;
      if (!assetId) return;
      void deleteFlowImage(assetId).catch(() => {});
    };
  }, []);

  // 同步 edges ref
  React.useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const hasInputConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.some(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        ),
      [id]
    )
  );

  // 从连接的节点读取图片
  const connectedImage = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        // 兼容历史/导入的 edge：targetHandle 可能缺失或为 image；
        // 也兼容“边存在但 source 节点已删除/不含图片”的情况，尝试从所有入边中选取第一个可用图片。
        const candidateEdges = state.edges.filter(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        );
        if (candidateEdges.length === 0) return undefined;

        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        const resolveFromNode = (
          nodeId: string,
          incomingEdge?: Edge,
          visited: Set<string> = new Set()
        ): string | undefined => {
          if (!nodeId) return undefined;
          if (visited.has(nodeId)) return undefined;
          visited.add(nodeId);

          const node = nodeById.get(nodeId);
          if (!node) return undefined;

          // Image 节点：其“显示的图片”可能来自上游连线而非自身 data，需要继续向上追溯
          if (node.type === 'image') {
            const upstream = state.edges.find(
              (e) => e.target === nodeId && e.targetHandle === 'img'
            );
            const upstreamResolved = upstream
              ? resolveFromNode(upstream.source, upstream, visited)
              : undefined;
            if (upstreamResolved) return upstreamResolved;
          }

          return readImageFromNode(node as Node<any>, incomingEdge?.sourceHandle);
        };

        for (const edge of candidateEdges) {
          const value = resolveFromNode(edge.source, edge);
          if (value) return value;
        }

        return undefined;
      },
      [id]
    )
  );

  // 用于判断“上游图片是否真的换了”的稳定标识：
  // - Image 节点上传流程会在 imageData(flow-asset/blob) <-> imageUrl(OSS key/url) 间切换；
  //   若直接用 connectedImage 做变更检测，会误判为“换图”导致 split 结果被清空。
  // - 这里优先取可持久化的 imageUrl（并去代理包装），作为 identity key。
  const connectedImageIdentity = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const candidateEdges = state.edges.filter(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        );
        if (candidateEdges.length === 0) return undefined;

        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        const resolveFromNode = (
          nodeId: string,
          incomingEdge?: Edge,
          visited: Set<string> = new Set()
        ): string | undefined => {
          if (!nodeId) return undefined;
          if (visited.has(nodeId)) return undefined;
          visited.add(nodeId);

          const node = nodeById.get(nodeId);
          if (!node) return undefined;

          // Image 节点：优先用 imageUrl 作为 identity（上传完成后 imageData 会被清空）
          if (node.type === 'image') {
            const upstream = state.edges.find((e) => e.target === nodeId && e.targetHandle === 'img');
            const upstreamResolved = upstream
              ? resolveFromNode(upstream.source, upstream, visited)
              : undefined;
            if (upstreamResolved) return upstreamResolved;

            const d = (node.data ?? {}) as Record<string, unknown>;
            const candidate =
              normalizeString(d.imageUrl) ||
              normalizeString(d.imageData) ||
              normalizeString(d.thumbnailDataUrl) ||
              normalizeString(d.thumbnail);
            if (!candidate) return undefined;
            return isPersistableImageRef(candidate) ? normalizePersistableImageRef(candidate) : candidate;
          }

          const candidate = readImageFromNode(node as Node<any>, incomingEdge?.sourceHandle);
          if (!candidate) return undefined;
          return isPersistableImageRef(candidate) ? normalizePersistableImageRef(candidate) : candidate;
        };

        for (const edge of candidateEdges) {
          const value = resolveFromNode(edge.source, edge);
          if (value) return value;
        }

        return undefined;
      },
      [id]
    )
  );

  // ImageSplit 输出（imageX）与 Image(crop) 作为输入时：动态生成“裁切后的临时图片”(flow-asset)，避免下游继续使用整图。
  const incomingCropSpec = useStore(
    React.useCallback(
      (state: ReactFlowState): CropSpec | null => {
        const candidateEdges = state.edges.filter(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        );
        if (candidateEdges.length === 0) return null;

        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        const normalizeIdentityBase = (value: string): string => {
          const trimmed = value.trim();
          if (!trimmed) return trimmed;
          return isPersistableImageRef(trimmed) ? normalizePersistableImageRef(trimmed) : trimmed;
        };

        const specFromImageSplit = (node: Node<any>, sourceHandle?: string | null): CropSpec | null => {
          const d = (node.data ?? {}) as any;
          const baseRef = normalizeString(d.inputImageUrl) || normalizeString(d.inputImage) || '';
          if (!baseRef) return null;

          const handle = typeof sourceHandle === 'string' ? sourceHandle.trim() : '';
          const match = handle ? /^image(\d+)$/.exec(handle) : null;
          if (!match) return null;
          const idx = Math.max(0, Number(match[1]) - 1);

          const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
          const rect = splitRects?.[idx];
          const x = typeof rect?.x === 'number' ? rect.x : Number(rect?.x ?? 0);
          const y = typeof rect?.y === 'number' ? rect.y : Number(rect?.y ?? 0);
          const w = typeof rect?.width === 'number' ? rect.width : Number(rect?.width ?? 0);
          const h = typeof rect?.height === 'number' ? rect.height : Number(rect?.height ?? 0);
          if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return null;

          const sourceWidth = typeof d.sourceWidth === 'number' ? d.sourceWidth : undefined;
          const sourceHeight = typeof d.sourceHeight === 'number' ? d.sourceHeight : undefined;
          const identityBase = normalizeIdentityBase(baseRef);
          return {
            identity: `${identityBase}#split:${idx}:${x},${y},${w},${h}@${sourceWidth || 0}x${sourceHeight || 0}`,
            baseRef,
            x,
            y,
            width: w,
            height: h,
            sourceWidth,
            sourceHeight,
          };
        };

        const specFromImageNode = (node: Node<any>): CropSpec | null => {
          const d = (node.data ?? {}) as any;

          // 1) 若 Image 节点本身有 crop（通常来自 ImageSplit 的“生成节点”），直接用它
          const baseRef = normalizeString(d.imageData) || normalizeString(d.imageUrl) || '';
          const crop = d?.crop as any;
          if (baseRef && crop) {
            const x = typeof crop.x === 'number' ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === 'number' ? crop.y : Number(crop.y ?? 0);
            const w = typeof crop.width === 'number' ? crop.width : Number(crop.width ?? 0);
            const h = typeof crop.height === 'number' ? crop.height : Number(crop.height ?? 0);
            if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              const sourceWidth = typeof crop.sourceWidth === 'number' ? crop.sourceWidth : Number(crop.sourceWidth ?? 0);
              const sourceHeight = typeof crop.sourceHeight === 'number' ? crop.sourceHeight : Number(crop.sourceHeight ?? 0);
              const identityBase = normalizeIdentityBase(baseRef);
              return {
                identity: `${identityBase}#crop:${x},${y},${w},${h}@${sourceWidth || 0}x${sourceHeight || 0}`,
                baseRef,
                x,
                y,
                width: w,
                height: h,
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              };
            }
          }

          // 2) 若 Image 节点只是“显示”来自上游（例如 ImageSplit -> Image），回溯上游 imageSplit 生成 crop
          const upstream = state.edges.find(
            (e) => e.target === node.id && (e.targetHandle === 'img' || !e.targetHandle)
          );
          if (upstream) {
            const up = nodeById.get(upstream.source);
            if (up?.type === 'imageSplit') {
              return specFromImageSplit(up, (upstream as any).sourceHandle);
            }
          }

          return null;
        };

        for (const edge of candidateEdges) {
          const srcNode = nodeById.get(edge.source);
          if (!srcNode) continue;

          if (srcNode.type === 'imageSplit') {
            const spec = specFromImageSplit(srcNode, (edge as any).sourceHandle);
            if (spec) return spec;
            continue;
          }

          if (srcNode.type === 'image' || srcNode.type === 'imagePro') {
            const spec = specFromImageNode(srcNode);
            if (spec) return spec;
            continue;
          }
        }

        return null;
      },
      [id]
    ),
    shallow
  );

  // 基于裁切信息生成临时 flow-asset 输入（不落库；仅用于下游继续 split）
  const deriveSeqRef = React.useRef(0);
  React.useEffect(() => {
    const spec = incomingCropSpec;
    const nextIdentity = spec?.identity || null;
    deriveSeqRef.current += 1;
    const seq = deriveSeqRef.current;

    if (!spec || !nextIdentity) {
      setDerivedInputRef((prev) => {
        const prevAssetId = prev ? parseFlowImageAssetRef(prev) : null;
        if (prevAssetId) void deleteFlowImage(prevAssetId).catch(() => {});
        return null;
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      const blob = await cropImageToBlob({
        baseRef: spec.baseRef,
        rect: { x: spec.x, y: spec.y, width: spec.width, height: spec.height },
        sourceWidth: spec.sourceWidth,
        sourceHeight: spec.sourceHeight,
      });
      if (!blob || cancelled || deriveSeqRef.current !== seq) return;

      const [assetId] = await putFlowImageBlobs([{
        blob,
        projectId: projectId ?? null,
        nodeId: id,
      }]);
      if (!assetId) return;

      if (cancelled || deriveSeqRef.current !== seq) {
        void deleteFlowImage(assetId).catch(() => {});
        return;
      }

      const ref = toFlowImageAssetRef(assetId);
      setDerivedInputRef((prev) => {
        const prevAssetId = prev ? parseFlowImageAssetRef(prev) : null;
        if (prevAssetId && prevAssetId !== assetId) {
          void deleteFlowImage(prevAssetId).catch(() => {});
        }
        return ref;
      });
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [incomingCropSpec?.identity, id, projectId]);

  // 若上游来自 imageGrid（直接连或经由 image 节点传递），优先读取其“输入图片列表”，避免用像素连通域误分割成大量碎片
  const upstreamImageGridInputs = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const candidateEdges = state.edges.filter(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        );
        if (candidateEdges.length === 0) return [];

        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        const findImageGridNode = (nodeId: string, visited: Set<string>): Node<any> | undefined => {
          if (!nodeId) return undefined;
          if (visited.has(nodeId)) return undefined;
          visited.add(nodeId);

          const node = nodeById.get(nodeId);
          if (!node) return undefined;
          if (node.type === 'imageGrid') return node;

          if (node.type === 'image') {
            const upstream = state.edges.find((e) => e.target === nodeId && e.targetHandle === 'img');
            if (!upstream) return undefined;
            return findImageGridNode(upstream.source, visited);
          }

          return undefined;
        };

        const readImageGridInputs = (gridNode: Node<any>): UpstreamImageItem[] => {
          const gridId = gridNode.id;
          const result: UpstreamImageItem[] = [];

          const connectedEdges = state.edges.filter(
            (e) => e.target === gridId && e.targetHandle === 'images'
          );

          for (const edge of connectedEdges) {
            const sourceNode = nodeById.get(edge.source);
            if (!sourceNode) continue;
            readImagesFromNode(sourceNode as Node<any>, edge.sourceHandle).forEach((it) => result.push(it));
          }

          const manualImages = (gridNode.data as any)?.images as Array<{ id: string; imageData: string }> | undefined;
          if (Array.isArray(manualImages)) {
            manualImages.forEach((img) => {
              const value = normalizeString(img?.imageData);
              if (!value) return;
              if (!result.find((r) => r.id === img.id)) {
                result.push({ id: img.id, imageData: value });
              }
            });
          }

          return result;
        };

        for (const edge of candidateEdges) {
          const gridNode = findImageGridNode(edge.source, new Set());
          if (!gridNode) continue;
          const inputs = readImageGridInputs(gridNode);
          if (inputs.length > 0) return inputs;
        }

        return [];
      },
      [id]
    )
  );

  const rawInputImage = React.useMemo(() => {
    const persisted = normalizeString(data.inputImageUrl) || normalizeString(data.inputImage);
    // 方案A：当已有 splitRects 时，优先使用持久化的原图引用，保证“坐标系一致”（避免上传/去 EXIF 后坐标不匹配导致预览变形）
    if (persisted && Array.isArray(data.splitRects) && data.splitRects.length > 0) {
      return persisted;
    }
    return connectedImage || data.inputImage || data.inputImageUrl;
  }, [connectedImage, data.inputImage, data.inputImageUrl, data.splitRects]);
  const effectiveInputImage = React.useMemo(() => {
    // 已经完成 split 并落了 splitRects：继续用持久化引用作为基底，避免坐标系漂移
    if (Array.isArray(data.splitRects) && data.splitRects.length > 0) {
      return rawInputImage;
    }
    return normalizeString(derivedInputRef) || rawInputImage;
  }, [data.splitRects, derivedInputRef, rawInputImage]);
  const inputAssetId = React.useMemo(() => parseFlowImageAssetRef(effectiveInputImage), [effectiveInputImage]);
  const inputAssetUrl = useFlowImageAssetUrl(inputAssetId);

  const inputImageSrc = React.useMemo(() => {
    if (inputAssetId) return inputAssetUrl || undefined;
    return buildImageSrc(effectiveInputImage);
  }, [effectiveInputImage, inputAssetId, inputAssetUrl]);
  const canSplit = !!normalizeString(effectiveInputImage);

  // 更新节点数据
  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch }
    }));
  }, [id]);

  // 上游输入发生变化时，清理 split 结果（避免继续显示/输出旧图）
  const inputIdentityRef = React.useRef<string | undefined>(undefined);
  const inputIdentityInitedRef = React.useRef(false);
  const hasAnySplitResult =
    splitRects.length > 0 ||
    (Array.isArray(data.splitRects) && data.splitRects.length > 0) ||
    (Array.isArray(data.splitImages) && data.splitImages.length > 0);

  const resetSplitResult = React.useCallback(() => {
    setSplitRects([]);
    setSourceSize({ width: 0, height: 0 });

    const patch: Record<string, unknown> = {
      status: 'idle',
      error: undefined,
      splitRects: [],
      splitImages: undefined,
      sourceWidth: undefined,
      sourceHeight: undefined,
      // 清理旧输入引用：让 UI/输出完全跟随当前连线输入
      inputImageUrl: undefined,
      inputImage: undefined,
    };
    for (let i = 1; i <= MAX_OUTPUT_COUNT; i += 1) {
      patch[`image${i}`] = undefined;
    }
    updateNodeData(patch);
  }, [updateNodeData]);

  React.useEffect(() => {
    const currentIdentity = normalizeString(incomingCropSpec?.identity || normalizeString(connectedImageIdentity));

    // 初始化：记录当前 identity，并在“明确是不同持久化引用”的情况下做一次兜底清理
    if (!inputIdentityInitedRef.current) {
      inputIdentityInitedRef.current = true;
      inputIdentityRef.current = currentIdentity;

      const persisted =
        normalizeString(data.inputImageUrl) ||
        normalizeString(data.inputImage) ||
        undefined;
      const persistedIdentity =
        persisted && isPersistableImageRef(persisted) ? normalizePersistableImageRef(persisted) : persisted;

      if (
        hasAnySplitResult &&
        currentIdentity &&
        persistedIdentity &&
        isPersistableImageRef(currentIdentity) &&
        isPersistableImageRef(persistedIdentity) &&
        currentIdentity !== persistedIdentity
      ) {
        resetSplitResult();
      }
      return;
    }

    const prevIdentity = inputIdentityRef.current;
    inputIdentityRef.current = currentIdentity;

    if (!hasAnySplitResult) return;
    if (!currentIdentity) return;

    // identity 变化（或从无到有）：认为上游真的换图，清空历史 split 结果
    if (!prevIdentity || prevIdentity !== currentIdentity) {
      resetSplitResult();
    }
  }, [
    connectedImageIdentity,
    incomingCropSpec?.identity,
    data.inputImage,
    data.inputImageUrl,
    hasAnySplitResult,
    resetSplitResult,
  ]);

  // 同步外部数据变化
  React.useEffect(() => {
    const nextRects = Array.isArray(data.splitRects) ? data.splitRects : [];
    if (nextRects.length > 0) {
      setSplitRects((prev) => (prev === nextRects ? prev : nextRects));
    } else {
      const legacy = Array.isArray(data.splitImages) ? data.splitImages : [];
      const derived = legacy.map((it) => ({
        index: it.index,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
      }));
      setSplitRects((prev) => (prev.length ? prev : derived));
    }

    const nextSourceWidth = typeof data.sourceWidth === 'number' ? data.sourceWidth : 0;
    const nextSourceHeight = typeof data.sourceHeight === 'number' ? data.sourceHeight : 0;
    if (nextSourceWidth > 0 && nextSourceHeight > 0) {
      setSourceSize((prev) => {
        if (prev.width === nextSourceWidth && prev.height === nextSourceHeight) return prev;
        return { width: nextSourceWidth, height: nextSourceHeight };
      });
    }
  }, [data.splitRects, data.splitImages, data.sourceWidth, data.sourceHeight]);

  React.useEffect(() => {
    const count = data.outputCount || DEFAULT_OUTPUT_COUNT;
    if (count !== outputCount) {
      setOutputCount(Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, count)));
    }
  }, [data.outputCount]);

  // 执行分割
  const handleSplit = React.useCallback(async () => {
    if (!normalizeString(effectiveInputImage)) {
      updateNodeData({ status: 'failed', error: '没有输入图片', splitRects: [] });
      setSplitRects([]);
      setSourceSize({ width: 0, height: 0 });
      return;
    }

    setIsProcessing(true);
    updateNodeData({ status: 'processing', error: undefined });

    let revokeObjectUrl: (() => void) | null = null;
    try {
      const normalizePersistableRef = (value: string): string => {
        const trimmed = value.trim();
        if (!trimmed) return trimmed;

        if (trimmed.startsWith('/api/assets/proxy') || trimmed.startsWith('/assets/proxy')) {
          try {
            const url = new URL(trimmed, window.location.origin);
            const key = url.searchParams.get('key');
            if (key) return key.replace(/^\/+/, '');
            const remote = url.searchParams.get('url');
            if (remote) return remote;
          } catch {}
          return trimmed;
        }

        const withoutLeading = trimmed.replace(/^\/+/, '');
        if (/^(templates|projects|uploads|videos)\//i.test(withoutLeading)) {
          return withoutLeading;
        }

        return trimmed;
      };

      const rawInput = normalizeString(effectiveInputImage)!;
      const normalizedInputRef = normalizePersistableRef(rawInput);
      // 图片分割本身不需要上传 OSS：优先用 blob/canvas 在运行时完成；
      // 只有当“保存/接口调用”不支持 canvas 时，才在对应链路里上传并替换引用。
      let runtimeInputRef = normalizedInputRef;
      let runtimeBlob: Blob | null = null;

      if (!isPersistableImageRef(normalizedInputRef)) {
        const blob = await resolveImageToBlob(rawInput, { preferProxy: true });
        if (!blob) throw new Error('无法读取图片数据');
        const normalizedBlob = await normalizeBlobForRuntime(blob);
        runtimeBlob = normalizedBlob;

        const [assetId] = await putFlowImageBlobs([{
          blob: normalizedBlob,
          projectId: projectId ?? null,
          nodeId: id,
        }]);
        if (!assetId) throw new Error('图片暂存失败');
        runtimeInputRef = toFlowImageAssetRef(assetId);
      }

      const preferredCount = upstreamImageGridInputs.length > 0
        ? Math.max(outputCount, upstreamImageGridInputs.length)
        : outputCount;
      const safeCount = Math.min(
        MAX_OUTPUT_COUNT,
        Math.max(MIN_OUTPUT_COUNT, Math.floor(preferredCount || DEFAULT_OUTPUT_COUNT))
      );

      let rects: SplitRectItem[] = [];
      let sourceWidth = 0;
      let sourceHeight = 0;

      // 优先使用 Worker + OffscreenCanvas（避免主线程卡顿）
      if (imageSplitWorkerClient.isSupported()) {
        const source = ((): { kind: 'blob'; blob: Blob } | { kind: 'url'; url: string } => {
          if (runtimeBlob) return { kind: 'blob' as const, blob: runtimeBlob };
          const url = buildImageSrc(runtimeInputRef);
          if (!url) throw new Error('图片加载失败');
          return { kind: 'url' as const, url };
        })();

        const result = await imageSplitWorkerClient.splitImageRects(source, { outputCount: safeCount });
        if (!result.success || !Array.isArray(result.rects)) {
          throw new Error(result.error || '分割失败');
        }
        rects = result.rects.slice(0, MAX_OUTPUT_COUNT);
        sourceWidth = result.sourceWidth ?? 0;
        sourceHeight = result.sourceHeight ?? 0;
      } else {
        let splitSrc: string | undefined;
        if (runtimeBlob) {
          const objectUrl = URL.createObjectURL(runtimeBlob);
          splitSrc = objectUrl;
          revokeObjectUrl = () => {
            try { URL.revokeObjectURL(objectUrl); } catch {}
          };
        } else {
          splitSrc = buildImageSrc(runtimeInputRef) || inputImageSrc;
        }
        if (!splitSrc) throw new Error('图片加载失败');
        const detected = await detectAndSplitRects(splitSrc);
        rects = detected.rects;
        sourceWidth = detected.sourceWidth;
        sourceHeight = detected.sourceHeight;

        // 对“整张图是一个连通块 / 无法识别区域”的情况做兜底：按输出数量做等分网格切图
        // 端口语义：输出数量必须严格等于 safeCount，否则认为“检测结果不可靠”，回退到网格切分。
        const countMismatch = rects.length !== safeCount;
        const tooManyPieces =
          rects.length > Math.min(MAX_OUTPUT_COUNT, Math.max(safeCount, DEFAULT_OUTPUT_COUNT)) * 2;
        if (countMismatch || rects.length <= 1 || tooManyPieces) {
          const grid = await splitRectsByGrid(splitSrc, safeCount);
          rects = grid.rects;
          sourceWidth = grid.sourceWidth;
          sourceHeight = grid.sourceHeight;
        }
        rects = rects.slice(0, MAX_OUTPUT_COUNT);
      }

      setSplitRects(rects);
      if (sourceWidth > 0 && sourceHeight > 0) {
        setSourceSize({ width: sourceWidth, height: sourceHeight });
      }

      // 自动扩展输出端口数量
      const newOutputCount = Math.min(MAX_OUTPUT_COUNT, Math.max(outputCount, rects.length));
      if (newOutputCount !== outputCount) {
        setOutputCount(newOutputCount);
      }

      const patch: Record<string, unknown> = {
        status: 'succeeded',
        inputImageUrl: runtimeInputRef,
        inputImage: undefined,
        splitRects: rects,
        sourceWidth: sourceWidth || undefined,
        sourceHeight: sourceHeight || undefined,
        outputCount: newOutputCount,
        error: undefined
      };

      // 清理旧字段（避免历史残留误读，也避免把临时图片数据落库）
      patch.splitImages = undefined;
      for (let i = 1; i <= MAX_OUTPUT_COUNT; i += 1) {
        patch[`image${i}`] = undefined;
      }

      updateNodeData(patch);
    } catch (err) {
      updateNodeData({
        status: 'failed',
        error: err instanceof Error ? err.message : '分割失败',
        splitRects: [],
        splitImages: undefined
      });
      setSplitRects([]);
      setSourceSize({ width: 0, height: 0 });
    } finally {
      try {
        revokeObjectUrl?.();
      } catch {}
      setIsProcessing(false);
    }
  }, [id, inputAssetId, inputImageSrc, outputCount, projectId, rawInputImage, updateNodeData, upstreamImageGridInputs]);

  // 更新输出端口数量
  const handleOutputCountChange = React.useCallback((value: number) => {
    const count = Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, value));
    setOutputCount(count);
    updateNodeData({ outputCount: count });
  }, [updateNodeData]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<unknown, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const getHandleTopPercent = React.useCallback((index: number) => {
    if (outputCount <= 1) return 50;
    return 10 + (index / (outputCount - 1)) * 80;
  }, [outputCount]);

  const boxW = data.boxW || 320;
  const boxH = data.boxH || 400;
  const hasLegacySplitImages = Array.isArray(data.splitImages) && data.splitImages.length > 0;
  const canGenerateNodes = canSplit && (splitRects.length > 0 || hasLegacySplitImages);

  // 当输出端口数量变化时，强制 React Flow 重新计算句柄位置
  React.useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputCount, boxW, boxH, updateNodeInternals]);

  // 一键生成 Image 节点并连接
  const handleGenerateImageNodes = React.useCallback(() => {
    const legacy = Array.isArray(data.splitImages) ? data.splitImages : [];
    const count = Math.min(outputCount, Math.max(splitRects.length, legacy.length));
    if (!canSplit) {
      window.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            message: '没有可用的输入图片，无法生成节点（请先连接输入并完成 Split）。',
            type: 'info',
          },
        })
      );
      return;
    }
    if (count <= 0) {
      window.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            message: '未发现分割结果：请先点击 Split 再生成节点。',
            type: 'info',
          },
        })
      );
      return;
    }

    const currentNode = rf.getNode(id);
    if (!currentNode) return;

    const nodeX = currentNode.position.x;
    const nodeY = currentNode.position.y;
    const nodeWidth = boxW;
    const imageNodeWidth = 280;
    const imageNodeHeight = 240;
    const gapX = 100;
    const gapY = 20;

    const startX = nodeX + nodeWidth + gapX;

    const totalHeight = count * imageNodeHeight + (count - 1) * gapY;
    const startY = nodeY + (boxH - totalHeight) / 2;

    const newNodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      data: {
        imageData?: string;
        imageUrl?: string;
        crop?: { x: number; y: number; width: number; height: number; sourceWidth?: number; sourceHeight?: number };
        label?: string;
        boxW: number;
        boxH: number;
      };
    }> = [];

    const newEdges: Array<{
      id: string;
      source: string;
      sourceHandle: string;
      target: string;
      targetHandle: string;
    }> = [];

    // 优先使用 ImageSplit 自己的 inputImageUrl（Split 时归一化后的“基底引用”），
    // 避免误用上游 thumbnail 造成切片分辨率变低。
    const baseRef =
      normalizeString(data.inputImageUrl) ||
      normalizeString(rawInputImage) ||
      normalizeString(data.inputImage) ||
      normalizeString(connectedImage) ||
      '';
    const basePatch = baseRef
      ? (isPersistableImageRef(baseRef) ? { imageUrl: baseRef } : { imageData: baseRef })
      : null;
    const cropSourceWidth = sourceSize.width > 0 ? sourceSize.width : undefined;
    const cropSourceHeight = sourceSize.height > 0 ? sourceSize.height : undefined;

    for (let i = 0; i < count; i++) {
      const imageNodeId = `image-${id}-${i + 1}-${Date.now()}`;
      const y = startY + i * (imageNodeHeight + gapY);

      newNodes.push({
        id: imageNodeId,
        type: 'image',
        position: { x: startX, y },
        data: {
          label: `图片 ${i + 1}`,
          boxW: imageNodeWidth,
          boxH: imageNodeHeight,
        },
      });
      const rect = splitRects[i];
      const canUseCrop =
        !!basePatch &&
        !!rect &&
        rect.width > 0 &&
        rect.height > 0;

      if (canUseCrop && rect) {
        Object.assign(newNodes[newNodes.length - 1]!.data, basePatch);
        newNodes[newNodes.length - 1]!.data.crop = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          sourceWidth: cropSourceWidth,
          sourceHeight: cropSourceHeight,
        };
      } else if (legacy.length > 0) {
        // 兜底：缺少 baseRef 时沿用 legacy 切片数据
        newNodes[newNodes.length - 1]!.data.imageData = legacy[i]!.imageData;
      }

      newEdges.push({
        id: `edge-${id}-${imageNodeId}`,
        source: id,
        sourceHandle: `image${i + 1}`,
        target: imageNodeId,
        targetHandle: 'img',
      });
    }

    rf.setNodes((nodes) => [...nodes, ...newNodes]);
    rf.setEdges((edges) => [...edges, ...newEdges]);
  }, [rf, id, data.inputImage, data.inputImageUrl, data.splitImages, outputCount, splitRects, boxW, boxH, canSplit, connectedImage, rawInputImage, sourceSize.height, sourceSize.width]);

  return (
    <div style={{
      width: boxW,
      minHeight: boxH,
      padding: 12,
      background: '#fff',
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      boxShadow,
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <NodeResizer
        isVisible
        minWidth={280}
        minHeight={300}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0 }}
        onResize={(_, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id
            ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } }
            : n
          ));
        }}
      />

      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Image Split</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleGenerateImageNodes}
            disabled={!canGenerateNodes}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: canGenerateNodes ? '#059669' : '#9ca3af',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: canGenerateNodes ? 'pointer' : 'not-allowed',
              opacity: canGenerateNodes ? 1 : 0.6,
            }}
            title={
              !canGenerateNodes
                ? (canSplit ? '请先完成 Split 再生成节点' : '请先连接输入图片并完成 Split')
                : hasLegacySplitImages
                  ? '一键生成 Image 节点并连接（legacy：使用 splitImages）'
                  : '一键生成 Image 节点并连接（方案A：基于 splitRects，运行时裁图，不落库）'
            }
          >
            生成节点
          </button>
          <button
            onClick={handleSplit}
            disabled={isProcessing || !canSplit}
            title={
              isProcessing
                ? '处理中...'
                : !canSplit
                  ? (hasInputConnection ? '已连接但未读取到图片（检查上游输出/连线句柄）' : '请先连接输入图片')
                  : '开始分割'
            }
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: (isProcessing || !canSplit) ? '#9ca3af' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: (isProcessing || !canSplit) ? 'not-allowed' : 'pointer',
            }}
          >
            {isProcessing ? '处理中...' : 'Split'}
          </button>
        </div>
      </div>

      {/* 输出数量配置 */}
      <div className="nodrag nopan" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: '#6b7280' }}>输出端口</label>
        <input
          type="number"
          min={MIN_OUTPUT_COUNT}
          max={MAX_OUTPUT_COUNT}
          value={outputCount}
          onChange={(e) => handleOutputCountChange(Number(e.target.value))}
          onPointerDown={stopNodeDrag}
          onPointerDownCapture={stopNodeDrag}
          onMouseDown={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onClick={stopNodeDrag}
          onClickCapture={stopNodeDrag}
          className="nodrag nopan"
          style={{
            width: 60,
            fontSize: 12,
            padding: '2px 6px',
            border: '1px solid #e5e7eb',
            borderRadius: 6
          }}
        />
        <span style={{ fontSize: 11, color: '#9ca3af' }}>(1-50)</span>
      </div>

      {/* 输入图片预览 */}
      <div style={{
        background: '#f9fafb',
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        minHeight: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 6,
      }}>
        {inputImageSrc ? (
          <SmartImage
            src={inputImageSrc}
            alt="输入图片"
            style={{ maxWidth: '100%', maxHeight: 120, objectFit: 'contain' }}
          />
        ) : (
          <>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>等待输入图片...</span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {hasInputConnection ? '已连接：是（但未读取到图片）' : '已连接：否'}
            </span>
          </>
        )}
      </div>

      {/* 状态显示 */}
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        状态: {isProcessing
          ? '处理中...'
          : data.status === 'failed'
            ? '失败'
            : splitRects.length > 0
              ? `已分割 ${splitRects.length} 张图片`
              : 'idle'}
      </div>

      {/* 错误信息 */}
      {data.status === 'failed' && data.error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{data.error}</div>
      )}

      {/* 分割结果预览 */}
      {splitRects.length > 0 && (
        <div style={{
          flex: 1,
          minHeight: 80,
          maxHeight: 150,
          overflow: 'auto',
          background: '#f0fdf4',
          borderRadius: 6,
          padding: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
        }}>
          {splitRects.slice(0, outputCount).map((rect, i) => (
            <SplitRectPreview
              key={`${rect.index}-${i}`}
              index={i}
              rect={rect}
              sourceSrc={inputImageSrc}
              sourceWidth={sourceSize.width}
              sourceHeight={sourceSize.height}
            />
          ))}
        </div>
      )}

      {/* 输入端口 */}
      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
        onMouseEnter={() => setHover('img-in')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 动态输出端口 */}
      {Array.from({ length: outputCount }).map((_, i) => {
        const portId = `image${i + 1}`;
        const topPercent = getHandleTopPercent(i);
        return (
          <Handle
            key={portId}
            type="source"
            position={Position.Right}
            id={portId}
            style={{ top: `${topPercent}%`, transform: 'translateY(-50%)' }}
            onMouseEnter={() => setHover(`${portId}-out`)}
            onMouseLeave={() => setHover(null)}
          />
        );
      })}

      {/* 工具提示 */}
      {hover === 'img-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          输入图片
        </div>
      )}
      {hover?.endsWith('-out') && (
        <div className="flow-tooltip" style={{
          right: -8,
          top: `${getHandleTopPercent(parseInt(hover.replace('image', '').replace('-out', '')) - 1)}%`,
          transform: 'translate(100%, -50%)'
        }}>
          图片 #{hover.replace('image', '').replace('-out', '')}
        </div>
      )}
    </div>
  );
}

export default React.memo(ImageSplitNodeInner);
