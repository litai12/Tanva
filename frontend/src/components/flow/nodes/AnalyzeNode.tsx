import React from 'react';
import { Handle, Position, useReactFlow, useStore, type ReactFlowState, type Edge, type Node } from 'reactflow';
import ImagePreviewModal from '../../ui/ImagePreviewModal';
import SmartImage from '../../ui/SmartImage';
import { aiImageService } from '@/services/aiImageService';
import { useAIChatStore, getImageModelForProvider } from '@/stores/aiChatStore';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';
import { canvasToBlob, createImageBitmapLimited, blobToDataUrl } from '@/utils/imageConcurrency';
import { parseFlowImageAssetRef } from '@/services/flowImageAssetStore';
import { useFlowImageAssetUrl } from '@/hooks/useFlowImageAssetUrl';
import { resolveImageToBlob, resolveImageToDataUrl } from '@/utils/imageSource';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    imageUrl?: string;
    prompt?: string;
    error?: string;
    analysisPrompt?: string;
  };
  selected?: boolean;
};

// 默认提示词
const DEFAULT_ANALYSIS_PROMPT = '分析一下这张图的内容，尽可能描述出来场景中的物体和特点，用一段提示词的方式输出';

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
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return proxifyRemoteAssetUrl(trimmed);
  return `data:image/png;base64,${trimmed}`;
};

type CropInfo = {
  baseRef: string;
  rect: { x: number; y: number; width: number; height: number };
  sourceWidth?: number;
  sourceHeight?: number;
};

const CanvasCropPreview = React.memo(({
  src,
  rect,
  sourceWidth,
  sourceHeight,
}: {
  src: string;
  rect: { x: number; y: number; width: number; height: number };
  sourceWidth?: number;
  sourceHeight?: number;
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 });

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };

    update();

    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(update);
      ro.observe(container);
    } catch {}

    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      try { ro?.disconnect(); } catch {}
    };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = size.w;
    const h = size.h;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    const drawPlaceholder = () => {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, w, h);
    };

    if (!src || !rect || rect.width <= 0 || rect.height <= 0 || w <= 0 || h <= 0) {
      drawPlaceholder();
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';

    const onLoad = () => {
      if (cancelled) return;
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      if (!naturalW || !naturalH) {
        drawPlaceholder();
        return;
      }

      const srcW = typeof sourceWidth === 'number' && sourceWidth > 0 ? sourceWidth : naturalW;
      const srcH = typeof sourceHeight === 'number' && sourceHeight > 0 ? sourceHeight : naturalH;

      const scaleX = srcW > 0 ? naturalW / srcW : 1;
      const scaleY = srcH > 0 ? naturalH / srcH : 1;

      const sxRaw = rect.x * scaleX;
      const syRaw = rect.y * scaleY;
      const exRaw = (rect.x + rect.width) * scaleX;
      const eyRaw = (rect.y + rect.height) * scaleY;

      const sx = Math.max(0, Math.min(naturalW - 1, Math.floor(sxRaw)));
      const sy = Math.max(0, Math.min(naturalH - 1, Math.floor(syRaw)));
      const ex = Math.max(sx + 1, Math.min(naturalW, Math.ceil(exRaw)));
      const ey = Math.max(sy + 1, Math.min(naturalH, Math.ceil(eyRaw)));
      const sw = Math.max(1, ex - sx);
      const sh = Math.max(1, ey - sy);

      // contain：避免把留白画进 canvas
      const fit = Math.min(w / sw, h / sh);
      const dw = Math.max(1, Math.round(sw * fit));
      const dh = Math.max(1, Math.round(sh * fit));

      canvas.style.width = `${dw}px`;
      canvas.style.height = `${dh}px`;
      canvas.width = Math.max(1, Math.round(dw * dpr));
      canvas.height = Math.max(1, Math.round(dh * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, dw, dh);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dw, dh);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    };

    const onError = () => {
      if (cancelled) return;
      drawPlaceholder();
    };

    img.onload = onLoad;
    img.onerror = onError;
    img.src = src;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [
    rect?.height,
    rect?.width,
    rect?.x,
    rect?.y,
    size.h,
    size.w,
    sourceHeight,
    sourceWidth,
    src,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', background: '#fff' }} />
    </div>
  );
});

function AnalysisNodeInner({ id, data, selected = false }: Props) {
  const rf = useReactFlow();
  const { status, error } = data;
  const incomingEdge = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.find(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        ),
      [id]
    )
  );
  const connectedInput = useStore(
    React.useCallback(
      (state: ReactFlowState): { kind: 'crop'; crop: CropInfo } | { kind: 'base'; baseRef: string } | null => {
        const edge = state.edges.find(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        );
        if (!edge) return null;

        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));
        const srcNode = nodeById.get(edge.source);
        if (!srcNode) return null;

        const sourceHandle = (edge as any).sourceHandle as string | undefined;
        const handle = typeof sourceHandle === 'string' ? sourceHandle.trim() : '';

        const normalize = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

        const toCropInfoFromImageSplit = (node: Node<any>, h: string): CropInfo | null => {
          const d = (node.data ?? {}) as any;
          const baseRef = normalize(d.inputImageUrl) || normalize(d.inputImage);
          if (!baseRef) return null;

          const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
          const match = h ? /^image(\d+)$/.exec(h) : null;
          const idx = match ? Math.max(0, Number(match[1]) - 1) : 0;
          const rect = splitRects?.[idx];
          const x = typeof rect?.x === 'number' ? rect.x : Number(rect?.x ?? 0);
          const y = typeof rect?.y === 'number' ? rect.y : Number(rect?.y ?? 0);
          const w = typeof rect?.width === 'number' ? rect.width : Number(rect?.width ?? 0);
          const hh = typeof rect?.height === 'number' ? rect.height : Number(rect?.height ?? 0);
          if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || hh <= 0) return null;

          const sourceWidth = typeof d.sourceWidth === 'number' ? d.sourceWidth : undefined;
          const sourceHeight = typeof d.sourceHeight === 'number' ? d.sourceHeight : undefined;
          return {
            baseRef,
            rect: { x, y, width: w, height: hh },
            sourceWidth,
            sourceHeight,
          };
        };

        // ImageSplit -> Analysis：直接按 splitRects 裁切
        if (srcNode.type === 'imageSplit') {
          const crop = toCropInfoFromImageSplit(srcNode, handle);
          return crop ? { kind: 'crop', crop } : null;
        }

        const resolveCropFromImageChain = (
          node: Node<any>,
          visited: Set<string>
        ): CropInfo | null => {
          if (!node || visited.has(node.id)) return null;
          visited.add(node.id);

          if (node.type !== 'image' && node.type !== 'imagePro') return null;

          const d = (node.data ?? {}) as any;
          const crop = d?.crop as any;
          const baseRef = normalize(d.imageData) || normalize(d.imageUrl);

          if (crop && baseRef) {
            const x = typeof crop.x === 'number' ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === 'number' ? crop.y : Number(crop.y ?? 0);
            const w = typeof crop.width === 'number' ? crop.width : Number(crop.width ?? 0);
            const hh = typeof crop.height === 'number' ? crop.height : Number(crop.height ?? 0);
            if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && hh > 0) {
              const sourceWidth = typeof crop.sourceWidth === 'number' ? crop.sourceWidth : Number(crop.sourceWidth ?? 0);
              const sourceHeight = typeof crop.sourceHeight === 'number' ? crop.sourceHeight : Number(crop.sourceHeight ?? 0);
              return {
                baseRef,
                rect: { x, y, width: w, height: hh },
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              };
            }
          }

          const upstreamEdge = state.edges.find(
            (e) => e.target === node.id && (e.targetHandle === 'img' || !e.targetHandle)
          );
          if (!upstreamEdge) return null;
          const up = nodeById.get(upstreamEdge.source);
          const upHandle = (upstreamEdge as any).sourceHandle as string | undefined;
          const upH = typeof upHandle === 'string' ? upHandle.trim() : '';
          if (up?.type === 'imageSplit') {
            return toCropInfoFromImageSplit(up, upH);
          }
          if (up?.type === 'image' || up?.type === 'imagePro') {
            return resolveCropFromImageChain(up, visited);
          }
          return null;
        };

        // Image/ImagePro -> Analysis：优先读取节点 crop；否则尝试回溯其上游 imageSplit / image 链路
        if (srcNode.type === 'image' || srcNode.type === 'imagePro') {
          const d = (srcNode.data ?? {}) as any;
          const baseRef = normalize(d.imageData) || normalize(d.imageUrl);
          const derivedCrop = resolveCropFromImageChain(srcNode, new Set());
          if (derivedCrop) {
            return { kind: 'crop', crop: derivedCrop };
          }

          const fallback = baseRef || normalize(d.thumbnailDataUrl) || normalize(d.thumbnail);
          return fallback ? { kind: 'base', baseRef: fallback } : null;
        }

        // 其他节点：尽量读取可用图片字段作为预览
        const d = (srcNode.data ?? {}) as any;
        if (srcNode.type === 'generate4' || srcNode.type === 'generatePro4') {
          const idx = handle?.startsWith('img') ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1)) : 0;
          const urls = Array.isArray(d?.imageUrls) ? (d.imageUrls as string[]) : [];
          const imgs = Array.isArray(d?.images) ? (d.images as string[]) : [];
          const thumbs = Array.isArray(d?.thumbnails) ? (d.thumbnails as string[]) : [];
          const picked = normalize(urls[idx]) || normalize(imgs[idx]) || normalize(thumbs[idx]);
          return picked ? { kind: 'base', baseRef: picked } : null;
        }
        const direct =
          normalize(d.imageData) ||
          normalize(d.imageUrl) ||
          normalize(d.outputImage) ||
          normalize(d.thumbnailDataUrl) ||
          normalize(d.thumbnail);
        return direct ? { kind: 'base', baseRef: direct } : null;
      },
      [id]
    )
  );

  const fallbackRaw = React.useMemo(() => (data.imageData || data.imageUrl)?.trim() || '', [data.imageData, data.imageUrl]);
  const fallbackAssetId = React.useMemo(() => parseFlowImageAssetRef(fallbackRaw), [fallbackRaw]);
  const fallbackAssetUrl = useFlowImageAssetUrl(fallbackAssetId);
  const fallbackPreviewSrc = React.useMemo(() => {
    if (fallbackAssetId) return fallbackAssetUrl || undefined;
    return buildImageSrc(fallbackRaw);
  }, [fallbackAssetId, fallbackAssetUrl, fallbackRaw]);

  React.useEffect(() => {
    if (incomingEdge) return;
    if (!data.imageData && !data.imageUrl) return;
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { imageData: undefined, imageUrl: undefined } },
      })
    );
  }, [incomingEdge, data.imageData, data.imageUrl, id]);

  const connectedBaseRef = connectedInput?.kind === 'crop'
    ? connectedInput.crop.baseRef
    : connectedInput?.kind === 'base'
      ? connectedInput.baseRef
      : '';
  const connectedAssetId = React.useMemo(() => parseFlowImageAssetRef(connectedBaseRef), [connectedBaseRef]);
  const connectedAssetUrl = useFlowImageAssetUrl(connectedAssetId);
  const connectedBaseSrc = React.useMemo(() => {
    if (!connectedBaseRef) return undefined;
    if (connectedAssetId) return connectedAssetUrl || undefined;
    return buildImageSrc(connectedBaseRef);
  }, [connectedAssetId, connectedAssetUrl, connectedBaseRef]);

  const hasAnyInput = Boolean(connectedInput || fallbackPreviewSrc);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const imageModel = React.useMemo(
    () => getImageModelForProvider(aiProvider),
    [aiProvider]
  );
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  const promptInput = data.analysisPrompt ?? DEFAULT_ANALYSIS_PROMPT;

  // 用于追踪分析进行中的状态
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  // 初始化节点提示词
  React.useEffect(() => {
    if (typeof data.analysisPrompt === 'undefined') {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { analysisPrompt: DEFAULT_ANALYSIS_PROMPT } }
      }));
    }
  }, [data.analysisPrompt, id]);

  const onAnalyze = React.useCallback(async () => {
    if (!hasAnyInput || status === 'running' || isAnalyzing) return;

    const promptToUse = (data.analysisPrompt ?? DEFAULT_ANALYSIS_PROMPT).trim();
    if (!promptToUse.length) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: 'Prompt cannot be empty' } }
      }));
      return;
    }

    // 更新节点状态为运行中
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { status: 'running', error: undefined, prompt: '', text: '' } }
    }));

    try {
      // 标记正在分析
      setIsAnalyzing(true);

      const cropImageToDataUrl = async (params: {
        baseRef: string;
        rect: { x: number; y: number; width: number; height: number };
        sourceWidth?: number;
        sourceHeight?: number;
      }): Promise<string | null> => {
        const baseRef = params.baseRef?.trim?.() || '';
        if (!baseRef) return null;
        const w = Math.max(1, Math.round(params.rect.width));
        const h = Math.max(1, Math.round(params.rect.height));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

        const MAX_OUTPUT_PIXELS = 32_000_000;
        const outputScale = w * h > MAX_OUTPUT_PIXELS ? Math.sqrt(MAX_OUTPUT_PIXELS / (w * h)) : 1;
        const outW = Math.max(1, Math.floor(w * outputScale));
        const outH = Math.max(1, Math.floor(h * outputScale));

        const blob = await resolveImageToBlob(baseRef, { preferProxy: true });
        if (!blob) return null;

        const makeCanvas = (cw: number, ch: number): any => {
          if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(cw, ch);
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          return canvas;
        };

        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmapLimited(blob);
          try {
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
            const outBlob = await canvasToBlob(canvas, { type: 'image/png' });
            return await blobToDataUrl(outBlob);
          } finally {
            try { bitmap.close(); } catch {}
          }
        }

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
          const outBlob = await canvasToBlob(canvas, { type: 'image/png' });
          return await blobToDataUrl(outBlob);
        } finally {
          try { URL.revokeObjectURL(objectUrl); } catch {}
        }
      };

      const resolveNodeImageToDataUrl = async (
        node: Node,
        sourceHandle?: string | null,
        visited: Set<string> = new Set()
      ): Promise<string | null> => {
        if (!node?.id) return null;
        if (visited.has(node.id)) return null;
        visited.add(node.id);

        const d = (node.data ?? {}) as any;
        const handle = typeof sourceHandle === 'string' ? sourceHandle.trim() : '';

        if (node.type === 'imageSplit') {
          const base =
            (typeof d.inputImageUrl === 'string' && d.inputImageUrl.trim()) ||
            (typeof d.inputImage === 'string' && d.inputImage.trim()) ||
            '';
          const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
          const match = handle ? /^image(\d+)$/.exec(handle) : null;
          const idx = match ? Math.max(0, Number(match[1]) - 1) : 0;
          const rect = splitRects?.[idx];
          const x = typeof rect?.x === 'number' ? rect.x : Number(rect?.x ?? 0);
          const y = typeof rect?.y === 'number' ? rect.y : Number(rect?.y ?? 0);
          const w = typeof rect?.width === 'number' ? rect.width : Number(rect?.width ?? 0);
          const h = typeof rect?.height === 'number' ? rect.height : Number(rect?.height ?? 0);
          if (base && Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
            return await cropImageToDataUrl({
              baseRef: base,
              rect: { x, y, width: w, height: h },
              sourceWidth: typeof d.sourceWidth === 'number' ? d.sourceWidth : undefined,
              sourceHeight: typeof d.sourceHeight === 'number' ? d.sourceHeight : undefined,
            });
          }
          const legacy = Array.isArray(d.splitImages) ? d.splitImages : [];
          const legacyValue = legacy?.[idx]?.imageData;
          if (typeof legacyValue === 'string' && legacyValue.trim()) {
            return await resolveImageToDataUrl(legacyValue.trim(), { preferProxy: true });
          }
          return null;
        }

        if (node.type === 'image' || node.type === 'imagePro') {
          const upstream = rf.getEdges().find(
            (e) => e.target === node.id && (e.targetHandle === 'img' || !e.targetHandle)
          );

          const crop = (d as any)?.crop as
            | { x?: unknown; y?: unknown; width?: unknown; height?: unknown; sourceWidth?: unknown; sourceHeight?: unknown }
            | undefined;
          if (crop) {
            const x = typeof crop.x === 'number' ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === 'number' ? crop.y : Number(crop.y ?? 0);
            const w = typeof crop.width === 'number' ? crop.width : Number(crop.width ?? 0);
            const h = typeof crop.height === 'number' ? crop.height : Number(crop.height ?? 0);
            const sourceWidth = typeof crop.sourceWidth === 'number' ? crop.sourceWidth : Number(crop.sourceWidth ?? 0);
            const sourceHeight = typeof crop.sourceHeight === 'number' ? crop.sourceHeight : Number(crop.sourceHeight ?? 0);
            const baseRef =
              (typeof d.imageData === 'string' && d.imageData.trim()) ||
              (typeof d.imageUrl === 'string' && d.imageUrl.trim()) ||
              '';
            if (baseRef && Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              const cropped = await cropImageToDataUrl({
                baseRef,
                rect: { x, y, width: w, height: h },
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              });
              if (cropped) return cropped;
            }
          }

          // 作为显示节点时，图片可能来自上游连线（例如 ImageSplit -> Image）
          if (upstream) {
            const src = rf.getNode(upstream.source);
            if (src) {
              return await resolveNodeImageToDataUrl(src as any, (upstream as any).sourceHandle, visited);
            }
          }
        }

        if (node.type === 'generate4' || node.type === 'generatePro4') {
          const idx = handle?.startsWith('img') ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1)) : 0;
          const urls = Array.isArray(d?.imageUrls) ? (d.imageUrls as string[]) : [];
          const imgs = Array.isArray(d?.images) ? (d.images as string[]) : [];
          const thumbs = Array.isArray(d?.thumbnails) ? (d.thumbnails as string[]) : [];
          const candidate =
            (typeof urls[idx] === 'string' && urls[idx].trim()) ||
            (typeof imgs[idx] === 'string' && imgs[idx].trim()) ||
            (typeof thumbs[idx] === 'string' && thumbs[idx].trim()) ||
            (typeof d?.imageData === 'string' && d.imageData.trim()) ||
            (typeof d?.imageUrl === 'string' && d.imageUrl.trim()) ||
            '';
          return candidate ? await resolveImageToDataUrl(candidate, { preferProxy: true }) : null;
        }

        const direct =
          (typeof d.imageData === 'string' && d.imageData.trim()) ||
          (typeof d.imageUrl === 'string' && d.imageUrl.trim()) ||
          (typeof d.outputImage === 'string' && d.outputImage.trim()) ||
          (typeof d.thumbnailDataUrl === 'string' && d.thumbnailDataUrl.trim()) ||
          (typeof d.thumbnail === 'string' && d.thumbnail.trim()) ||
          '';
        if (direct) return await resolveImageToDataUrl(direct, { preferProxy: true });

        return null;
      };

      const resolveAnalyzeSource = async (): Promise<string> => {
        const edge = incomingEdge || rf.getEdges().find((e) => e.target === id && (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle));
        if (edge) {
          const srcNode = rf.getNode(edge.source);
          if (srcNode) {
            const dataUrl = await resolveNodeImageToDataUrl(srcNode as any, (edge as any).sourceHandle, new Set());
            if (dataUrl) return dataUrl;
          }
        }

        const raw = (data.imageData || data.imageUrl)?.trim() || '';
        if (!raw) throw new Error('缺少图片输入');
        const dataUrl = await resolveImageToDataUrl(raw, { preferProxy: true });
        if (!dataUrl) throw new Error('图片加载失败');
        return dataUrl;
      };

      const result = await aiImageService.analyzeImage({
        prompt: promptToUse,
        sourceImage: await resolveAnalyzeSource(),
        aiProvider,
        model: imageModel,
      });

      if (!result.success || !result.data) {
        const message = result.error?.message || 'Analysis failed, please try again later';
        throw new Error(message);
      }

      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'succeeded', error: undefined, prompt: result.data.analysis, text: result.data.analysis } }
      }));
      console.log('✅ Analysis finished. Result synced to node:', result.data.analysis.substring(0, 50) + '...');

    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('❌ Analysis failed:', msg);

      // 更新节点状态为失败
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: msg, prompt: '', text: '' } }
      }));

    } finally {
      setIsAnalyzing(false);
    }
  }, [aiProvider, data.analysisPrompt, data.imageData, data.imageUrl, hasAnyInput, id, imageModel, incomingEdge, isAnalyzing, rf, status]);

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  const onPromptChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { analysisPrompt: value } }
    }));
  }, [id]);

  return (
    <div
      style={{
        width: 260,
        padding: 8,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>Analysis</div>
        <button
          onClick={onAnalyze}
          disabled={status === 'running' || !hasAnyInput || isAnalyzing}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            background: (status === 'running' || !hasAnyInput || isAnalyzing) ? '#e5e7eb' : '#111827',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: (status === 'running' || !hasAnyInput || isAnalyzing) ? 'not-allowed' : 'pointer',
          }}
        >
          {status === 'running' || isAnalyzing ? 'Running...' : 'Run'}
        </button>
      </div>

      <div
        onDoubleClick={() => hasAnyInput && setPreview(true)}
        style={{
          width: '100%',
          height: 140,
          background: '#fff',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: '1px solid #eef0f2',
        }}
        title={hasAnyInput ? 'Double click to preview' : undefined}
      >
        {connectedInput?.kind === 'crop' && connectedBaseSrc ? (
          <CanvasCropPreview
            src={connectedBaseSrc}
            rect={connectedInput.crop.rect}
            sourceWidth={connectedInput.crop.sourceWidth}
            sourceHeight={connectedInput.crop.sourceHeight}
          />
        ) : connectedBaseSrc ? (
          <SmartImage
            src={connectedBaseSrc}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
          />
        ) : fallbackPreviewSrc ? (
          <SmartImage
            src={fallbackPreviewSrc}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>Waiting for image input</span>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Analysis Prompt</div>
        <textarea
          className="nodrag nopan nowheel"
          value={promptInput}
          onChange={onPromptChange}
          onWheelCapture={(event) => {
            event.stopPropagation();
            if (event.nativeEvent?.stopImmediatePropagation) {
              event.nativeEvent.stopImmediatePropagation();
            }
          }}
          onPointerDownCapture={(event) => {
            event.stopPropagation();
            if (event.nativeEvent?.stopImmediatePropagation) {
              event.nativeEvent.stopImmediatePropagation();
            }
          }}
          onMouseDownCapture={(event) => {
            event.stopPropagation();
          }}
          placeholder="Enter prompt for analysis"
          style={{
            width: '100%',
            minHeight: 70,
            resize: 'none',
            fontSize: 12,
            lineHeight: 1.4,
            padding: '6px 8px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: '#fff',
            color: '#111827',
            fontFamily: 'inherit',
          }}
          disabled={status === 'running' || isAnalyzing}
        />
      </div>

      <div
        style={{
          minHeight: 72,
          maxHeight: 120,
          overflowY: 'auto',
          background: '#f9fafb',
          borderRadius: 6,
          padding: 8,
          fontSize: 12,
          color: '#374151',
          whiteSpace: 'pre-wrap',
        }}
      >
        {data.prompt ? data.prompt : <span style={{ color: '#9ca3af' }}>Analysis result will appear here</span>}
      </div>

      {status === 'failed' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('img-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="prompt"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'img-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          image
        </div>
      )}
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          prompt
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={connectedBaseSrc || fallbackPreviewSrc || ''}
        imageTitle="Analysis Preview"
        onClose={() => setPreview(false)}
        imageCollection={[]}
        currentImageId=""
        onImageChange={() => {}}
      />
    </div>
  );
}

export default React.memo(AnalysisNodeInner);
