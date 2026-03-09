import React from 'react';
import { Handle, Position, useStore, type ReactFlowState, type Node } from 'reactflow';
import SmartImage from '../../ui/SmartImage';
import { resolveImageToBlob, toRenderableImageSrc } from '@/utils/imageSource';
import { canvasToBlob, createImageBitmapLimited } from '@/utils/imageConcurrency';
import { imageUploadService } from '@/services/imageUploadService';
import { useProjectContentStore } from '@/stores/projectContentStore';

type CompressionLevel = 'light' | 'balanced' | 'strong';

type CropSpec = {
  baseRef: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

type InputSpec =
  | { kind: 'base'; baseRef: string }
  | { kind: 'crop'; crop: CropSpec }
  | null;

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'processing' | 'ready' | 'error';
    level?: CompressionLevel;
    inputImage?: string;
    outputImage?: string;
    imageData?: string;
    originalBytes?: number;
    outputBytes?: number;
    compressionRatio?: number;
    error?: string;
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

const PRESET_CONFIG: Record<CompressionLevel, { label: string; scale: number; quality: number }> = {
  light: { label: '轻度', scale: 1, quality: 0.88 },
  balanced: { label: '均衡', scale: 0.84, quality: 0.76 },
  strong: { label: '强压缩', scale: 0.7, quality: 0.62 },
};

const MAX_OUTPUT_PIXELS = 20_000_000; // 20MP safeguard

const normalizeString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
};

const buildImageSrc = (value?: string): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return toRenderableImageSrc(trimmed) || '';
};

const makeCanvas = (width: number, height: number): HTMLCanvasElement | OffscreenCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const readFrameImageFromVideoExtractNode = (
  data: Record<string, unknown>
): string => {
  const frames = Array.isArray(data.frames) ? (data.frames as Array<Record<string, unknown>>) : [];
  if (!frames.length) return '';

  const selectedFrameIndex = Number(data.selectedFrameIndex ?? 1);
  const idx = Math.max(0, selectedFrameIndex - 1);
  const frame = frames[idx];
  if (!frame) return '';

  return (
    normalizeString(frame.imageUrl) ||
    normalizeString(frame.thumbnailDataUrl)
  );
};

const readImageFromNode = (node: Node<Record<string, unknown>>, sourceHandle?: string | null): string => {
  if (!node) return '';
  const d = (node.data ?? {}) as Record<string, unknown>;

  if (node.type === 'imageSplit' && typeof sourceHandle === 'string') {
    const match = /^image(\d+)$/.exec(sourceHandle);
    if (match) {
      const key = `image${match[1]}`;
      const direct = normalizeString(d[key]);
      if (direct) return direct;

      const splitImages = Array.isArray(d.splitImages)
        ? (d.splitImages as Array<Record<string, unknown>>)
        : [];
      const idx = Math.max(0, Number(match[1]) - 1);
      return normalizeString(splitImages[idx]?.imageData);
    }
  }

  if (node.type === 'imageGrid') {
    return normalizeString(d.outputImage);
  }

  if (node.type === 'videoFrameExtract' && sourceHandle === 'image') {
    return readFrameImageFromVideoExtractNode(d);
  }

  if ((node.type === 'generate4' || node.type === 'generatePro4') && typeof sourceHandle === 'string') {
    const match = /^img(\d+)$/.exec(sourceHandle);
    if (match) {
      const idx = Math.max(0, Number(match[1]) - 1);
      const imageUrls = Array.isArray(d.imageUrls) ? (d.imageUrls as string[]) : [];
      const images = Array.isArray(d.images) ? (d.images as string[]) : [];
      const thumbnails = Array.isArray(d.thumbnails) ? (d.thumbnails as string[]) : [];
      return (
        normalizeString(imageUrls[idx]) ||
        normalizeString(images[idx]) ||
        normalizeString(thumbnails[idx])
      );
    }
  }

  return (
    normalizeString(d.imageData) ||
    normalizeString(d.imageUrl) ||
    normalizeString(d.outputImage) ||
    normalizeString(d.thumbnailDataUrl) ||
    normalizeString(d.thumbnail)
  );
};

const cropImageToBlob = async (crop: CropSpec): Promise<Blob | null> => {
  const baseRef = normalizeString(crop.baseRef);
  if (!baseRef) return null;

  const srcBlob = await resolveImageToBlob(baseRef, { preferProxy: true });
  if (!srcBlob) return null;

  const outputW = Math.max(1, Math.round(crop.width));
  const outputH = Math.max(1, Math.round(crop.height));
  if (outputW <= 0 || outputH <= 0) return null;

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmapLimited(srcBlob);
      const naturalW = bitmap.width;
      const naturalH = bitmap.height;
      if (!naturalW || !naturalH) return null;

      const sourceW = typeof crop.sourceWidth === 'number' && crop.sourceWidth > 0 ? crop.sourceWidth : naturalW;
      const sourceH = typeof crop.sourceHeight === 'number' && crop.sourceHeight > 0 ? crop.sourceHeight : naturalH;
      const scaleX = sourceW > 0 ? naturalW / sourceW : 1;
      const scaleY = sourceH > 0 ? naturalH / sourceH : 1;

      const sx = Math.max(0, Math.min(naturalW - 1, Math.round(crop.x * scaleX)));
      const sy = Math.max(0, Math.min(naturalH - 1, Math.round(crop.y * scaleY)));
      const swRaw = Math.max(1, Math.round(crop.width * scaleX));
      const shRaw = Math.max(1, Math.round(crop.height * scaleY));
      const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
      const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

      const canvas = makeCanvas(outputW, outputH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outputW, outputH);
      return await canvasToBlob(canvas, { type: 'image/png' });
    } finally {
      if (bitmap) {
        try { bitmap.close(); } catch {}
      }
    }
  }

  const objectUrl = URL.createObjectURL(srcBlob);
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

    const sourceW = typeof crop.sourceWidth === 'number' && crop.sourceWidth > 0 ? crop.sourceWidth : naturalW;
    const sourceH = typeof crop.sourceHeight === 'number' && crop.sourceHeight > 0 ? crop.sourceHeight : naturalH;
    const scaleX = sourceW > 0 ? naturalW / sourceW : 1;
    const scaleY = sourceH > 0 ? naturalH / sourceH : 1;

    const sx = Math.max(0, Math.min(naturalW - 1, Math.round(crop.x * scaleX)));
    const sy = Math.max(0, Math.min(naturalH - 1, Math.round(crop.y * scaleY)));
    const swRaw = Math.max(1, Math.round(crop.width * scaleX));
    const shRaw = Math.max(1, Math.round(crop.height * scaleY));
    const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
    const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

    const canvas = makeCanvas(outputW, outputH);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputW, outputH);
    return await canvasToBlob(canvas, { type: 'image/png' });
  } catch {
    return null;
  } finally {
    try { URL.revokeObjectURL(objectUrl); } catch {}
  }
};

const compressBlob = async (
  sourceBlob: Blob,
  level: CompressionLevel
): Promise<Blob> => {
  const preset = PRESET_CONFIG[level];

  const renderToCanvas = async (
    draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number) => void,
    sourceWidth: number,
    sourceHeight: number
  ): Promise<Blob> => {
    const safetyScale = sourceWidth * sourceHeight > MAX_OUTPUT_PIXELS
      ? Math.sqrt(MAX_OUTPUT_PIXELS / (sourceWidth * sourceHeight))
      : 1;
    const targetScale = Math.min(1, preset.scale * safetyScale);
    const outW = Math.max(1, Math.round(sourceWidth * targetScale));
    const outH = Math.max(1, Math.round(sourceHeight * targetScale));

    const canvas = makeCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');

    if ('imageSmoothingEnabled' in ctx) {
      try {
        ctx.imageSmoothingEnabled = true;
      } catch {}
    }

    draw(ctx, outW, outH);
    return await canvasToBlob(canvas, {
      type: 'image/webp',
      quality: preset.quality,
    });
  };

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmapLimited(sourceBlob);
      return await renderToCanvas(
        (ctx, width, height) => ctx.drawImage(bitmap as ImageBitmap, 0, 0, width, height),
        bitmap.width,
        bitmap.height
      );
    } finally {
      if (bitmap) {
        try { bitmap.close(); } catch {}
      }
    }
  }

  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = objectUrl;
    });

    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    if (!w || !h) throw new Error('图片尺寸无效');

    return await renderToCanvas(
      (ctx, width, height) => ctx.drawImage(image, 0, 0, width, height),
      w,
      h
    );
  } finally {
    try { URL.revokeObjectURL(objectUrl); } catch {}
  }
};

function ImageCompressNodeInner({ id, data, selected = false }: Props) {
  const projectId = useProjectContentStore((s) => s.projectId);
  const [isProcessing, setIsProcessing] = React.useState(false);

  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch },
      })
    );
  }, [id]);

  const connectedInput = useStore(
    React.useCallback(
      (state: ReactFlowState): InputSpec => {
        const edge = state.edges.find(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        );
        if (!edge) return null;

        const nodeById = new Map(state.getNodes().map((n) => [n.id, n]));

        const resolveFromNode = (
          node: Node<Record<string, unknown>> | undefined,
          sourceHandle?: string | null,
          visited: Set<string> = new Set()
        ): InputSpec => {
          if (!node) return null;
          if (visited.has(node.id)) return null;
          visited.add(node.id);

          const d = (node.data ?? {}) as Record<string, unknown>;
          const handle = typeof sourceHandle === 'string' ? sourceHandle.trim() : '';

          if (node.type === 'imageSplit') {
            const baseRef = normalizeString(d.inputImageUrl) || normalizeString(d.inputImage);
            if (baseRef && handle) {
              const match = /^image(\d+)$/.exec(handle);
              const idx = match ? Math.max(0, Number(match[1]) - 1) : -1;
              if (idx >= 0) {
                const splitRects = Array.isArray(d.splitRects)
                  ? (d.splitRects as Array<Record<string, unknown>>)
                  : [];
                const rect = splitRects[idx];
                const x = typeof rect?.x === 'number' ? rect.x : Number(rect?.x ?? 0);
                const y = typeof rect?.y === 'number' ? rect.y : Number(rect?.y ?? 0);
                const w = typeof rect?.width === 'number' ? rect.width : Number(rect?.width ?? 0);
                const h = typeof rect?.height === 'number' ? rect.height : Number(rect?.height ?? 0);
                if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
                  return {
                    kind: 'crop',
                    crop: {
                      baseRef,
                      x,
                      y,
                      width: w,
                      height: h,
                      sourceWidth: typeof d.sourceWidth === 'number' ? d.sourceWidth : undefined,
                      sourceHeight: typeof d.sourceHeight === 'number' ? d.sourceHeight : undefined,
                    },
                  };
                }
              }
            }

            const fallback = readImageFromNode(node, sourceHandle);
            return fallback ? { kind: 'base', baseRef: fallback } : null;
          }

          if (node.type === 'image' || node.type === 'imagePro') {
            const baseRef = normalizeString(d.imageData) || normalizeString(d.imageUrl);
            const crop = d.crop as Record<string, unknown> | undefined;
            if (baseRef && crop) {
              const x = typeof crop.x === 'number' ? crop.x : Number(crop.x ?? 0);
              const y = typeof crop.y === 'number' ? crop.y : Number(crop.y ?? 0);
              const w = typeof crop.width === 'number' ? crop.width : Number(crop.width ?? 0);
              const h = typeof crop.height === 'number' ? crop.height : Number(crop.height ?? 0);
              if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
                const sourceWidth = typeof crop.sourceWidth === 'number'
                  ? crop.sourceWidth
                  : Number(crop.sourceWidth ?? 0);
                const sourceHeight = typeof crop.sourceHeight === 'number'
                  ? crop.sourceHeight
                  : Number(crop.sourceHeight ?? 0);
                return {
                  kind: 'crop',
                  crop: {
                    baseRef,
                    x,
                    y,
                    width: w,
                    height: h,
                    sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                    sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
                  },
                };
              }
            }

            const direct = readImageFromNode(node, sourceHandle);
            if (direct) {
              return { kind: 'base', baseRef: direct };
            }

            const upstream = state.edges.find(
              (e) => e.target === node.id && (e.targetHandle === 'img' || !e.targetHandle)
            );
            if (!upstream) return null;
            return resolveFromNode(
              nodeById.get(upstream.source),
              upstream.sourceHandle,
              visited
            );
          }

          const direct =
            (node.type === 'videoFrameExtract' && handle === 'image')
              ? readFrameImageFromVideoExtractNode(d)
              : readImageFromNode(node, sourceHandle);

          return direct ? { kind: 'base', baseRef: direct } : null;
        };

        return resolveFromNode(nodeById.get(edge.source), edge.sourceHandle);
      },
      [id]
    )
  );

  const level: CompressionLevel = PRESET_CONFIG[data.level as CompressionLevel]
    ? (data.level as CompressionLevel)
    : 'balanced';

  const inputRef = connectedInput?.kind === 'crop'
    ? connectedInput.crop.baseRef
    : connectedInput?.kind === 'base'
    ? connectedInput.baseRef
    : normalizeString(data.inputImage);

  const outputRef = normalizeString(data.outputImage) || normalizeString(data.imageData);
  const inputPreviewSrc = buildImageSrc(inputRef);
  const outputPreviewSrc = buildImageSrc(outputRef);
  const finalPreviewSrc = outputPreviewSrc || inputPreviewSrc;

  const handleCompress = React.useCallback(async () => {
    if (!connectedInput || isProcessing) {
      if (!connectedInput) {
        updateNodeData({ status: 'error', error: '没有输入图片，请先连接图片节点' });
      }
      return;
    }

    setIsProcessing(true);
    updateNodeData({ status: 'processing', error: undefined });

    try {
      const sourceBlob = connectedInput.kind === 'crop'
        ? await cropImageToBlob(connectedInput.crop)
        : await resolveImageToBlob(connectedInput.baseRef, { preferProxy: true });

      if (!sourceBlob) {
        throw new Error('无法读取输入图片');
      }

      const compressedBlob = await compressBlob(sourceBlob, level);
      if (!compressedBlob || compressedBlob.size <= 0) {
        throw new Error('压缩结果为空');
      }

      const uploadResult = await imageUploadService.uploadImageSource(compressedBlob, {
        projectId: projectId ?? undefined,
        dir: projectId ? `projects/${projectId}/flow/images/` : 'uploads/flow/images/',
        fileName: `image_compress_${id}_${Date.now()}.webp`,
        contentType: 'image/webp',
      });

      if (!uploadResult.success || !uploadResult.asset?.url) {
        throw new Error(uploadResult.error || '压缩图片上传失败');
      }

      const outputImage = (uploadResult.asset.key || uploadResult.asset.url).trim();
      if (!outputImage) {
        throw new Error('上传后未返回可用图片引用');
      }

      const inputIdentity = connectedInput.kind === 'crop'
        ? connectedInput.crop.baseRef
        : connectedInput.baseRef;

      const ratio = sourceBlob.size > 0 ? compressedBlob.size / sourceBlob.size : 1;

      updateNodeData({
        status: 'ready',
        error: undefined,
        level,
        inputImage: inputIdentity,
        outputImage,
        imageData: outputImage,
        originalBytes: sourceBlob.size,
        outputBytes: compressedBlob.size,
        compressionRatio: Number(ratio.toFixed(4)),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '压缩失败';
      updateNodeData({
        status: 'error',
        error: message,
      });
    } finally {
      setIsProcessing(false);
    }
  }, [connectedInput, id, isProcessing, level, projectId, updateNodeData]);

  const handleLevelChange = React.useCallback((value: CompressionLevel) => {
    updateNodeData({ level: value });
  }, [updateNodeData]);

  const displayRatio =
    typeof data.compressionRatio === 'number' && Number.isFinite(data.compressionRatio)
      ? `${Math.round(data.compressionRatio * 100)}%`
      : '--';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>Image Compress</div>
        <button
          onClick={handleCompress}
          disabled={!connectedInput || isProcessing || data.status === 'processing'}
          style={{
            fontSize: 12,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: '4px 8px',
            background: !connectedInput || isProcessing || data.status === 'processing' ? '#f3f4f6' : '#111827',
            color: !connectedInput || isProcessing || data.status === 'processing' ? '#9ca3af' : '#fff',
            cursor: !connectedInput || isProcessing || data.status === 'processing' ? 'not-allowed' : 'pointer',
          }}
        >
          {isProcessing || data.status === 'processing' ? '压缩中...' : '压缩'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label htmlFor={`compress-level-${id}`} style={{ fontSize: 12, color: '#4b5563', whiteSpace: 'nowrap' }}>
          压缩档位
        </label>
        <select
          id={`compress-level-${id}`}
          value={level}
          onChange={(e) => handleLevelChange(e.target.value as CompressionLevel)}
          style={{
            flex: 1,
            fontSize: 12,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: '6px 8px',
            background: '#fff',
            color: '#111827',
          }}
        >
          {(Object.keys(PRESET_CONFIG) as CompressionLevel[]).map((key) => (
            <option key={key} value={key}>
              {PRESET_CONFIG[key].label}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          width: '100%',
          height: 170,
          background: '#f9fafb',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
        }}
      >
        {finalPreviewSrc ? (
          <SmartImage
            src={finalPreviewSrc}
            alt='Compressed preview'
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
            loading='lazy'
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9ca3af',
              fontSize: 12,
            }}
          >
            连接图片后可预览
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: '#4b5563', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>状态: {data.status || 'idle'}</div>
        <div>体积比: {displayRatio}</div>
        <div>
          原始: {typeof data.originalBytes === 'number' ? `${Math.round(data.originalBytes / 1024)} KB` : '--'}
        </div>
        <div>
          输出: {typeof data.outputBytes === 'number' ? `${Math.round(data.outputBytes / 1024)} KB` : '--'}
        </div>
      </div>

      {data.status === 'error' && data.error && (
        <div
          style={{
            fontSize: 12,
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            padding: '6px 8px',
            wordBreak: 'break-word',
          }}
        >
          {data.error}
        </div>
      )}

      <Handle type='target' position={Position.Left} id='img' style={{ background: '#16a34a' }} />
      <Handle type='source' position={Position.Right} id='image' style={{ background: '#2563eb' }} />
    </div>
  );
}

export default React.memo(ImageCompressNodeInner);
