import React from 'react';
import { Handle, Position, useStore, type ReactFlowState, type Node } from 'reactflow';
import SmartImage from '../../ui/SmartImage';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { useFlowImageAssetUrl } from '@/hooks/useFlowImageAssetUrl';
import {
  createEphemeralFlowImageObjectUrl,
  parseFlowImageAssetRef,
} from '@/services/flowImageAssetStore';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { imageUploadService } from '@/services/imageUploadService';
import { canvasToBlob } from '@/utils/imageConcurrency';
import { toRenderableImageSrc } from '@/utils/imageSource';
import { useLocaleText } from '@/utils/localeText';

type ImageItem = {
  id: string;
  imageData: string; // base64 或 URL
  thumbnailData?: string; // 节点预览用缩略图（可选）
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth?: number;
    sourceHeight?: number;
  };
  width?: number;
  height?: number;
};

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'processing' | 'ready' | 'error';
    error?: string;
    images: ImageItem[];
    outputImage?: string;
    backgroundColor?: string;
    padding?: number;
    gap?: number; // 图片之间的间隙宽度
    gridSize?: number; // 自动计算或手动指定
  };
  selected?: boolean;
};

const MAX_PREVIEW_IMAGES = 9;

// 构建图片 src - 优先使用 OSS URL，避免 proxy 降级
const buildImageSrc = (value?: string): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return toRenderableImageSrc(trimmed) || '';
};

function FlowImagePreview({ item, alt }: { item: ImageItem; alt: string }) {
  const value = item.thumbnailData || item.imageData;
  const assetId = React.useMemo(() => parseFlowImageAssetRef(value), [value]);
  const assetUrl = useFlowImageAssetUrl(assetId);
  const src = assetId ? (assetUrl || '') : buildImageSrc(value);

  const thumbSize = 48;
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const crop = item.crop;
  const canCrop =
    !!src &&
    !!crop &&
    crop.width > 0 &&
    crop.height > 0 &&
    typeof crop.sourceWidth === 'number' &&
    typeof crop.sourceHeight === 'number' &&
    crop.sourceWidth > 0 &&
    crop.sourceHeight > 0;

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

    if (!src) {
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
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      if (naturalW <= 0 || naturalH <= 0) return;

      ctx.clearRect(0, 0, thumbSize, thumbSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, thumbSize, thumbSize);

      if (canCrop && crop) {
        const sourceW = crop.sourceWidth || naturalW;
        const sourceH = crop.sourceHeight || naturalH;

        const scaleX = sourceW > 0 ? naturalW / sourceW : 1;
        const scaleY = sourceH > 0 ? naturalH / sourceH : 1;

        const sxRaw = crop.x * scaleX;
        const syRaw = crop.y * scaleY;
        const swRaw = crop.width * scaleX;
        const shRaw = crop.height * scaleY;

        const sx = Math.max(0, Math.min(naturalW - 1, sxRaw));
        const sy = Math.max(0, Math.min(naturalH - 1, syRaw));
        const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
        const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

        const scale = Math.max(thumbSize / sw, thumbSize / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        const dx = (thumbSize - dw) / 2;
        const dy = (thumbSize - dh) / 2;

        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        return;
      }

      // 无裁剪：cover
      const scale = Math.max(thumbSize / naturalW, thumbSize / naturalH);
      const dw = naturalW * scale;
      const dh = naturalH * scale;
      const dx = (thumbSize - dw) / 2;
      const dy = (thumbSize - dh) / 2;
      ctx.drawImage(img, 0, 0, naturalW, naturalH, dx, dy, dw, dh);
    };

    img.onload = draw;
    img.onerror = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, thumbSize, thumbSize);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, thumbSize, thumbSize);
    };
    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [canCrop, crop?.height, crop?.sourceHeight, crop?.sourceWidth, crop?.width, crop?.x, crop?.y, src]);

  return (
    <canvas ref={canvasRef} aria-label={alt} style={{ display: 'block' }} />
  );
}

function ImageGridNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const { status = 'idle', error, images = [], outputImage } = data;
  const [hover, setHover] = React.useState<string | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const projectId = useProjectContentStore((s) => s.projectId);

  const outputAssetId = React.useMemo(() => parseFlowImageAssetRef(outputImage), [outputImage]);
  const outputAssetUrl = useFlowImageAssetUrl(outputAssetId);
  const outputPreviewSrc = outputAssetId ? (outputAssetUrl || '') : buildImageSrc(outputImage);

  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  const backgroundColor = data.backgroundColor ?? '#ffffff';
  const padding = data.padding ?? 0;
  const gap = data.gap ?? 16; // 默认 16px 白色间隙

  const updateNodeData = React.useCallback((patch: Record<string, any>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch },
    }));
  }, [id]);

  // 获取所有连接的图片节点数据
  const connectedImages = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edges = state.edges.filter(
          (e) => e.target === id && (e.targetHandle === 'images' || !e.targetHandle)
        );
        if (edges.length === 0) return [];

        const result: ImageItem[] = [];
        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        const readSingleImageFromNode = (
          node: Node<any>
        ): { full?: string; thumb?: string } => {
          const d = node.data as any;
          const fullCandidate =
            d?.imageData ??
            d?.outputImage ??
            d?.imageUrl ??
            d?.thumbnailDataUrl ??
            d?.thumbnail;
          const thumbCandidate = d?.thumbnail ?? d?.thumbnailDataUrl;

          const normalize = (v: unknown): string | undefined => {
            if (typeof v !== 'string') return undefined;
            const trimmed = v.trim();
            return trimmed ? trimmed : undefined;
          };

          return { full: normalize(fullCandidate), thumb: normalize(thumbCandidate) };
        };

        const readImagesFromNode = (
          node: Node<any>,
          sourceHandle?: string | null,
          visited: Set<string> = new Set()
        ): ImageItem[] => {
          if (!node) return [];
          if (visited.has(node.id)) return [];
          visited.add(node.id);
          const d = (node.data ?? {}) as any;
          const normalize = (v: unknown): string | undefined => {
            if (typeof v !== 'string') return undefined;
            const trimmed = v.trim();
            return trimmed ? trimmed : undefined;
          };

          // ImageSplitNode：按 image1..imageN 读取（无 sourceHandle 时输出全部 splitImages）
          if (node.type === 'imageSplit') {
            const base = normalize(d?.inputImageUrl) || normalize(d?.inputImage);
            const splitRects = Array.isArray(d.splitRects) ? (d.splitRects as Array<any>) : [];
            const sourceWidth = typeof d.sourceWidth === 'number' ? d.sourceWidth : undefined;
            const sourceHeight = typeof d.sourceHeight === 'number' ? d.sourceHeight : undefined;

            const splitImages = Array.isArray(d.splitImages) ? (d.splitImages as Array<any>) : [];
            const pickAt = (idx: number): string | undefined => {
              const key = `image${idx + 1}`;
              const direct = normalize(d?.[key]);
              if (direct) return direct;
              return normalize(splitImages?.[idx]?.imageData);
            };

            if (typeof sourceHandle === 'string') {
              const match = /^image(\d+)$/.exec(sourceHandle);
              if (match) {
                const idx = Math.max(0, Number(match[1]) - 1);
                const rect = splitRects?.[idx];
                const x = typeof rect?.x === 'number' ? rect.x : Number(rect?.x ?? 0);
                const y = typeof rect?.y === 'number' ? rect.y : Number(rect?.y ?? 0);
                const w = typeof rect?.width === 'number' ? rect.width : Number(rect?.width ?? 0);
                const h = typeof rect?.height === 'number' ? rect.height : Number(rect?.height ?? 0);
                if (base && Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
                  return [{
                    id: `${node.id}-crop-${idx + 1}`,
                    imageData: base,
                    thumbnailData: base,
                    crop: { x, y, width: w, height: h, sourceWidth, sourceHeight },
                  }];
                }
                const value = pickAt(idx);
                return value
                  ? [{ id: `${node.id}-image${idx + 1}`, imageData: value, thumbnailData: value }]
                  : [];
              }
            }

            if (base && splitRects.length > 0) {
              return splitRects
                .map((rect, idx) => {
                  const x = typeof rect?.x === 'number' ? rect.x : Number(rect?.x ?? 0);
                  const y = typeof rect?.y === 'number' ? rect.y : Number(rect?.y ?? 0);
                  const w = typeof rect?.width === 'number' ? rect.width : Number(rect?.width ?? 0);
                  const h = typeof rect?.height === 'number' ? rect.height : Number(rect?.height ?? 0);
                  if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return null;
                  return {
                    id: `${node.id}-crop-${idx + 1}`,
                    imageData: base,
                    thumbnailData: base,
                    crop: { x, y, width: w, height: h, sourceWidth, sourceHeight },
                  } as ImageItem;
                })
                .filter((item): item is ImageItem => item !== null);
            }

            if (splitImages.length > 0) {
              return splitImages
                .map((img, idx) => {
                  const value = normalize(img?.imageData);
                  if (!value) return null;
                  return {
                    id: `${node.id}-split-${idx + 1}`,
                    imageData: value,
                    thumbnailData: value,
                  } as ImageItem;
                })
                .filter((item): item is ImageItem => item !== null);
            }
          }

          if (node.type === 'image' || node.type === 'imagePro') {
            const base = normalize(d?.imageData) || normalize(d?.imageUrl);
            const crop = d?.crop as
              | { x?: unknown; y?: unknown; width?: unknown; height?: unknown; sourceWidth?: unknown; sourceHeight?: unknown }
              | undefined;
            if (base && crop) {
              const x = typeof crop.x === 'number' ? crop.x : Number(crop.x ?? 0);
              const y = typeof crop.y === 'number' ? crop.y : Number(crop.y ?? 0);
              const w = typeof crop.width === 'number' ? crop.width : Number(crop.width ?? 0);
              const h = typeof crop.height === 'number' ? crop.height : Number(crop.height ?? 0);
              if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
                const sourceWidth = typeof crop.sourceWidth === 'number' ? crop.sourceWidth : Number(crop.sourceWidth ?? 0);
                const sourceHeight = typeof crop.sourceHeight === 'number' ? crop.sourceHeight : Number(crop.sourceHeight ?? 0);
                return [{
                  id: `${node.id}-crop`,
                  imageData: base,
                  thumbnailData: base,
                  crop: {
                    x,
                    y,
                    width: w,
                    height: h,
                    sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                    sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
                  },
                }];
              }
            }

            if (!base) {
              const upstream = state.edges.find(
                (e) => e.target === node.id && (e.targetHandle === 'img' || !e.targetHandle)
              );
              if (upstream) {
                const upstreamNode = nodeById.get(upstream.source);
                if (upstreamNode) {
                  return readImagesFromNode(upstreamNode, (upstream as any).sourceHandle, visited);
                }
              }
            }

            const fallback =
              base ||
              normalize(d?.thumbnailDataUrl) ||
              normalize(d?.thumbnail);
            return fallback
              ? [{ id: node.id, imageData: fallback, thumbnailData: fallback }]
              : [];
          }

          // VideoFrameExtractNode：按 sourceHandle 决定单帧/范围/全部
          if (node.type === 'videoFrameExtract' && Array.isArray(d.frames)) {
            const frames = d.frames as Array<{ index: number; imageUrl: string; thumbnailDataUrl?: string }>;
            const outputMode = d.outputMode ?? 'all';
            const selectedFrameIndex = d.selectedFrameIndex ?? 1;
            const rangeStart = d.rangeStart ?? 1;
            const rangeEnd = d.rangeEnd ?? frames.length;

            let outputFrames = frames;
            if (sourceHandle === 'image') {
              const idx = selectedFrameIndex - 1;
              outputFrames = frames[idx] ? [frames[idx]] : [];
            } else if (sourceHandle === 'images-range') {
              const start = Math.max(0, rangeStart - 1);
              const end = Math.min(frames.length, rangeEnd);
              outputFrames = frames.slice(start, end);
            } else if (sourceHandle === 'images') {
              outputFrames = frames;
            } else {
              // 兼容旧边：未标注 sourceHandle 时按节点 outputMode
              if (outputMode === 'single') {
                const idx = selectedFrameIndex - 1;
                outputFrames = frames[idx] ? [frames[idx]] : [];
              } else if (outputMode === 'range') {
                const start = Math.max(0, rangeStart - 1);
                const end = Math.min(frames.length, rangeEnd);
                outputFrames = frames.slice(start, end);
              } else {
                outputFrames = frames;
              }
            }

            return outputFrames
              .map((frame) => {
                const imageData = frame.imageUrl || frame.thumbnailDataUrl;
                if (!imageData) return null;
                const item: ImageItem = {
                  id: `${node.id}-frame-${frame.index}`,
                  // 拼合需尽量使用原图（imageUrl），缩略图仅用于预览
                  imageData,
                  thumbnailData: frame.thumbnailDataUrl || frame.imageUrl || undefined,
                };
                return item;
              })
              .filter((item): item is ImageItem => item !== null);
          }

          // Generate4 / GeneratePro4：支持 img1..img4（单张）以及 images（全量）
          if (node.type === 'generate4' || node.type === 'generatePro4') {
            const urls = Array.isArray(d.imageUrls) ? (d.imageUrls as string[]) : [];
            const imgs = Array.isArray(d.images) ? (d.images as string[]) : [];
            const thumbs = Array.isArray(d.thumbnails) ? (d.thumbnails as string[]) : [];

            const pickAt = (idx: number): string | undefined => {
              const value = urls[idx] ?? imgs[idx] ?? thumbs[idx];
              if (typeof value !== 'string') return undefined;
              const trimmed = value.trim();
              return trimmed ? trimmed : undefined;
            };

            const match = typeof sourceHandle === 'string' ? /^img(\d+)$/.exec(sourceHandle) : null;
            if (match) {
              const idx = Math.max(0, Number(match[1]) - 1);
              const value = pickAt(idx);
              const thumbRaw = typeof thumbs[idx] === 'string' ? thumbs[idx] : undefined;
              const thumb = thumbRaw?.trim() ? thumbRaw.trim() : undefined;
              return value
                ? [{ id: `${node.id}-img${idx + 1}`, imageData: value, thumbnailData: thumb }]
                : [];
            }

            // images 或未识别句柄：按“图集”处理，输出全部可用图片
            if (typeof sourceHandle !== 'string' || sourceHandle === 'images' || sourceHandle?.startsWith('images-')) {
              const out: ImageItem[] = [];
              const max = Math.max(urls.length, imgs.length, thumbs.length, 0);
              for (let idx = 0; idx < max; idx += 1) {
                const value = pickAt(idx);
                if (!value) continue;
                const thumbRaw = typeof thumbs[idx] === 'string' ? thumbs[idx] : undefined;
                const thumb = thumbRaw?.trim() ? thumbRaw.trim() : undefined;
                out.push({ id: `${node.id}-img${idx + 1}`, imageData: value, thumbnailData: thumb });
              }
              return out;
            }
          }

          // 通用：如果上游就是 images 类型输出且携带 images/imageUrls 数组，则按多图处理
          if (typeof sourceHandle === 'string' && (sourceHandle === 'images' || sourceHandle.startsWith('images-'))) {
            const urls = Array.isArray(d.imageUrls) ? (d.imageUrls as string[]) : [];
            const imgs = Array.isArray(d.images) ? (d.images as string[]) : [];
            const thumbs = Array.isArray(d.thumbnails) ? (d.thumbnails as string[]) : [];
            const max = Math.max(urls.length, imgs.length, thumbs.length, 0);
            if (max > 0) {
              const out: ImageItem[] = [];
              for (let idx = 0; idx < max; idx += 1) {
                const value = (urls[idx] ?? imgs[idx] ?? thumbs[idx]) as string | undefined;
                if (typeof value !== 'string') continue;
                const trimmed = value.trim();
                if (!trimmed) continue;
                const thumbRaw = typeof thumbs[idx] === 'string' ? thumbs[idx] : undefined;
                const thumb = thumbRaw?.trim() ? thumbRaw.trim() : undefined;
                out.push({ id: `${node.id}-images-${idx + 1}`, imageData: trimmed, thumbnailData: thumb });
              }
              return out;
            }
          }

          const { full, thumb } = readSingleImageFromNode(node);
          const resolvedFull = full || thumb;
          return resolvedFull ? [{ id: node.id, imageData: resolvedFull, thumbnailData: thumb }] : [];
        };

        edges.forEach((edge) => {
          const sourceNode = nodes.find((n: Node<any>) => n.id === edge.source);
          if (!sourceNode) return;

          readImagesFromNode(sourceNode, edge.sourceHandle).forEach((item) => result.push(item));
        });

        return result;
      },
      [id]
    )
  );

  // 合并连接的图片和手动添加的图片
  const allImages = React.useMemo(() => {
    const combined = [...connectedImages];
    images.forEach((img) => {
      if (!combined.find((c) => c.id === img.id)) {
        combined.push(img);
      }
    });
    return combined;
  }, [connectedImages, images]);

  // 计算网格尺寸
  const calculateGridSize = React.useCallback((count: number): number => {
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    if (count <= 9) return 3;
    if (count <= 16) return 4;
    if (count <= 25) return 5;
    return Math.ceil(Math.sqrt(count));
  }, []);

  const gridSize = data.gridSize ?? calculateGridSize(allImages.length);

  // 拼合图片核心逻辑
  const combineImages = React.useCallback(async () => {
    if (allImages.length === 0) {
      updateNodeData({ error: lt('没有图片可拼合', 'No images available to combine'), status: 'error' });
      return;
    }

    updateNodeData({ status: 'processing', error: undefined });

    let loadedImages: Array<{
      img: HTMLImageElement;
      item: ImageItem;
      revoke?: () => void;
      effectiveWidth: number;
      effectiveHeight: number;
      cropParams?: { sx: number; sy: number; sw: number; sh: number } | null;
    }> = [];
    try {
      // 加载所有图片并获取尺寸
      loadedImages = await Promise.all(
        allImages.map(async (item) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';

          const value = item.imageData;
          const assetId = parseFlowImageAssetRef(value);
          const ephemeral = assetId ? await createEphemeralFlowImageObjectUrl(assetId) : null;
          const src = assetId ? (ephemeral?.url || '') : buildImageSrc(value);
          if (!src) throw new Error(`${lt('图片加载失败', 'Failed to load image')}: ${item.id}`);

          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(`${lt('图片加载失败', 'Failed to load image')}: ${item.id}`));
            img.src = src;
          });

          const crop = item.crop;
          let effectiveWidth = img.naturalWidth;
          let effectiveHeight = img.naturalHeight;
          let cropParams: { sx: number; sy: number; sw: number; sh: number } | null = null;

          if (crop && crop.width > 0 && crop.height > 0) {
            const sourceW =
              typeof crop.sourceWidth === 'number' && crop.sourceWidth > 0
                ? crop.sourceWidth
                : img.naturalWidth;
            const sourceH =
              typeof crop.sourceHeight === 'number' && crop.sourceHeight > 0
                ? crop.sourceHeight
                : img.naturalHeight;

            const scaleX = sourceW > 0 ? img.naturalWidth / sourceW : 1;
            const scaleY = sourceH > 0 ? img.naturalHeight / sourceH : 1;

            const sx = Math.max(0, Math.min(img.naturalWidth - 1, crop.x * scaleX));
            const sy = Math.max(0, Math.min(img.naturalHeight - 1, crop.y * scaleY));
            const swRaw = Math.max(1, crop.width * scaleX);
            const shRaw = Math.max(1, crop.height * scaleY);

            const sw = Math.max(1, Math.min(img.naturalWidth - sx, swRaw));
            const sh = Math.max(1, Math.min(img.naturalHeight - sy, shRaw));

            cropParams = { sx, sy, sw, sh };
            // 目标尺寸以"源坐标系"的 crop.width/height 为准
            const targetW = Math.max(1, Math.round(crop.width));
            const targetH = Math.max(1, Math.round(crop.height));
            effectiveWidth = targetW;
            effectiveHeight = targetH;
          }

          return { img, item, revoke: ephemeral?.revoke, effectiveWidth, effectiveHeight, cropParams };
        })
      );

      // 找出最大尺寸
      let maxWidth = 0;
      let maxHeight = 0;
      loadedImages.forEach(({ effectiveWidth, effectiveHeight }) => {
        maxWidth = Math.max(maxWidth, effectiveWidth);
        maxHeight = Math.max(maxHeight, effectiveHeight);
      });

      // 计算画布尺寸（包含间隙）
      const grid = calculateGridSize(loadedImages.length);
      const cellWidth = maxWidth + padding * 2;
      const cellHeight = maxHeight + padding * 2;
      // 画布宽度 = 单元格宽度 * 列数 + 间隙宽度 * (列数 + 1)
      const canvasWidth = cellWidth * grid + gap * (grid + 1);
      const canvasHeight = cellHeight * grid + gap * (grid + 1);

      // 创建画布
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(lt('Canvas 不可用', 'Canvas is not available'));

      // 填充背景色
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 绘制每张图片（考虑间隙）
      loadedImages.forEach(({ img, cropParams, effectiveWidth, effectiveHeight }, index) => {
        const row = Math.floor(index / grid);
        const col = index % grid;

        // 计算单元格起始位置（包含间隙偏移）
        const cellX = gap + col * (cellWidth + gap);
        const cellY = gap + row * (cellHeight + gap);
        // 图片在单元格内居中
        const offsetX = (cellWidth - effectiveWidth) / 2;
        const offsetY = (cellHeight - effectiveHeight) / 2;

        if (cropParams) {
          ctx.drawImage(
            img,
            cropParams.sx,
            cropParams.sy,
            cropParams.sw,
            cropParams.sh,
            cellX + offsetX,
            cellY + offsetY,
            effectiveWidth,
            effectiveHeight
          );
        } else {
          ctx.drawImage(img, cellX + offsetX, cellY + offsetY, effectiveWidth, effectiveHeight);
        }
      });

      // 导出为 Blob（避免生成巨型 base64 字符串导致内存峰值）
      const outputBlob = await canvasToBlob(canvas, { type: 'image/png' });
      const uploadResult = await imageUploadService.uploadImageSource(outputBlob, {
        projectId: projectId ?? undefined,
        dir: projectId ? `projects/${projectId}/flow/images/` : 'uploads/flow/images/',
        fileName: `image_grid_${id}_${Date.now()}.png`,
        contentType: 'image/png',
      });
      if (!uploadResult.success || !uploadResult.asset?.url) {
        throw new Error(uploadResult.error || lt('图片上传失败', 'Image upload failed'));
      }

      updateNodeData({
        status: 'ready',
        outputImage: (uploadResult.asset.key || uploadResult.asset.url).trim(),
        gridSize: grid,
      });

      console.log(`[ImageGrid] ${lt('图片拼合完成', 'Combine completed')}: ${loadedImages.length} -> ${grid}x${grid}`);

    } catch (err: any) {
      console.error('[ImageGrid] combine failed:', err);
      updateNodeData({
        status: 'error',
        error: err.message || lt('拼合失败', 'Combine failed'),
      });
    } finally {
      try {
        loadedImages.forEach((it) => it.revoke?.());
      } catch {}
    }
  }, [allImages, backgroundColor, padding, gap, calculateGridSize, updateNodeData, projectId, id, lt]);

  const canCombine = allImages.length > 0 && status !== 'processing';

  // 预览图片（最多显示9个）
  const previewImages = allImages.slice(0, MAX_PREVIEW_IMAGES);

  return (
    <div
      style={{
        width: 300,
        padding: 10,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>Image Grid</div>
        <button
          onClick={combineImages}
          disabled={!canCombine}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            background: canCombine ? '#111827' : '#e5e7eb',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: canCombine ? 'pointer' : 'not-allowed',
          }}
        >
          {status === 'processing' ? lt('拼合中...', 'Combining...') : lt('拼合', 'Combine')}
        </button>
      </div>

      {/* 输入图片预览 */}
      <div style={{ background: '#f9fafb', borderRadius: 6, padding: 8 }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
          📥 {lt('输入图片', 'Input images')} ({allImages.length} {lt('张', '')})
        </div>
        {allImages.length > 0 ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {previewImages.map((item, index) => (
              <div
                key={item.id}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 4,
                  overflow: 'hidden',
                  border: '1px solid #e5e7eb',
                  position: 'relative',
                }}
              >
                <FlowImagePreview item={item} alt={lt(`图片 ${index + 1}`, `Image ${index + 1}`)} />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    fontSize: 9,
                    textAlign: 'center',
                    padding: '1px 0',
                  }}
                >
                  {index + 1}
                </div>
              </div>
            ))}
            {allImages.length > MAX_PREVIEW_IMAGES && (
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 4,
                  background: '#e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: '#6b7280',
                }}
              >
                +{allImages.length - MAX_PREVIEW_IMAGES}
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: 8 }}>
            {lt('支持单图、多图、图集：连接 image / images 输出即可', 'Supports single/multi/image-set input: connect image/images output')}
          </div>
        )}
      </div>

      {/* 网格信息 */}
      {allImages.length > 0 && (
        <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📐 {lt('网格', 'Grid')}: {gridSize}×{gridSize}</span>
          <span>|</span>
          <span>{lt('空位', 'Empty slots')}: {gridSize * gridSize - allImages.length}</span>
        </div>
      )}

      {/* 输出预览 */}
      {outputImage && (
        <div style={{ background: '#f3f4f6', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
            📤 {lt('输出结果', 'Output')}
          </div>
          <div
            style={{
              width: '100%',
              aspectRatio: '1',
              borderRadius: 4,
              overflow: 'hidden',
              border: '1px solid #e5e7eb',
            }}
          >
            <SmartImage
              src={outputPreviewSrc}
              alt={lt("拼合结果", "Combined result")}
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
            />
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {status === 'error' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', padding: '4px 8px', background: '#fef2f2', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* 连接点 - 输入 */}
      <Handle
        type="target"
        position={Position.Left}
        id="images"
        style={{ top: '50%', background: '#eab308', border: '1px solid #ca8a04' }}
        onMouseEnter={() => setHover('images-in')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 连接点 - 输出 */}
      <Handle
        type="source"
        position={Position.Right}
        id="img"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('img-out')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 工具提示 */}
      {hover === 'images-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          {lt('images（支持单图/多图/图集）', 'images (single/multi/set supported)')}
        </div>
      )}
      {hover === 'img-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          {lt('拼合图片', 'Combined image')}
        </div>
      )}

      {/* 隐藏的 canvas */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

export default React.memo(ImageGridNodeInner);
