import React from 'react';
import { Check } from 'lucide-react';
import { Handle, Position, useReactFlow, useStore, type ReactFlowState, type Edge, type Node } from 'reactflow';
import ImagePreviewModal from '../../ui/ImagePreviewModal';
import SmartImage from '../../ui/SmartImage';
import { aiImageService } from '@/services/aiImageService';
import { getTextModelForProvider } from '@/stores/aiChatStore';
import { canvasToBlob, createImageBitmapLimited, blobToDataUrl } from '@/utils/imageConcurrency';
import { parseFlowImageAssetRef } from '@/services/flowImageAssetStore';
import { useFlowImageAssetUrl } from '@/hooks/useFlowImageAssetUrl';
import { resolveImageToBlob, resolveImageToDataUrl, toRenderableImageSrc } from '@/utils/imageSource';
import { useLocaleText } from '@/utils/localeText';
import { resolveTextFromSourceNode } from '../utils/textSource';
import RunCreditBadge from './RunCreditBadge';
import { useCanvasStore } from '@/stores';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import {
  flowNodeControlField,
  flowNodeMutedWellBackground,
  flowNodeShellChrome,
  flowNodeWellOutlineBorder,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';
import { useFlowRenderMode } from '../FlowRenderModeContext';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    imageUrl?: string;
    prompt?: string;
    error?: string;
    analysisPrompt?: string;
    creditsPerCall?: number;
    managedModelKey?: string;
    vendorKey?: string;
    platformKey?: string;
    analysisProvider?: ProviderToggleValue;
  };
  selected?: boolean;
};

type ProviderToggleValue = 'banana-2.5' | 'banana' | 'banana-3.1';

const normalizeAnalysisProvider = (value?: string): ProviderToggleValue => {
  if (value === 'banana-2.5') return 'banana-2.5';
  if (value === 'banana-3.1') return 'banana-3.1';
  if (value === 'banana') return 'banana';
  return 'banana-2.5';
};

// 构建图片 src - 优先使用 OSS URL，避免 proxy 降级
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toRenderableImageSrc(trimmed) || undefined;
};

type CropInfo = {
  baseRef: string;
  rect: { x: number; y: number; width: number; height: number };
  sourceWidth?: number;
  sourceHeight?: number;
};

type ConnectedInput = { kind: 'crop'; crop: CropInfo } | { kind: 'base'; baseRef: string };
type ConnectedInputPreview = { id: string; baseRef: string; crop?: CropInfo };
const MAX_INPUT_PREVIEWS = 6;

const shouldPassWheelToCanvas = (event: { ctrlKey: boolean; metaKey: boolean }) => {
  const store = useCanvasStore.getState();
  const isModifierWheel = event.ctrlKey || event.metaKey;
  return store.wheelZoomMode === 'direct' ? !isModifierWheel : isModifierWheel;
};

function InputImageCropThumb({
  src,
  crop,
}: {
  src: string;
  crop: CropInfo;
}) {
  const { lowDetailMode } = useFlowRenderMode();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    if (lowDetailMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 44;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.round(size * dpr));
    canvas.height = Math.max(1, Math.round(size * dpr));
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    if (!src) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, size, size);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (cancelled) return;
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      if (!naturalW || !naturalH) {
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(0, 0, size, size);
        return;
      }

      const srcW =
        typeof crop.sourceWidth === 'number' && crop.sourceWidth > 0
          ? crop.sourceWidth
          : naturalW;
      const srcH =
        typeof crop.sourceHeight === 'number' && crop.sourceHeight > 0
          ? crop.sourceHeight
          : naturalH;
      const scaleX = srcW > 0 ? naturalW / srcW : 1;
      const scaleY = srcH > 0 ? naturalH / srcH : 1;
      const sx = Math.max(0, Math.min(naturalW - 1, crop.rect.x * scaleX));
      const sy = Math.max(0, Math.min(naturalH - 1, crop.rect.y * scaleY));
      const swRaw = Math.max(1, crop.rect.width * scaleX);
      const shRaw = Math.max(1, crop.rect.height * scaleY);
      const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
      const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

      const scale = Math.max(size / sw, size / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      const dx = (size - dw) / 2;
      const dy = (size - dh) / 2;

      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    };
    img.onerror = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, size, size);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [
    crop.rect.height,
    crop.rect.width,
    crop.rect.x,
    crop.rect.y,
    crop.sourceHeight,
    crop.sourceWidth,
    lowDetailMode,
    src,
  ]);

  if (lowDetailMode) {
    return (
      <div
        style={{
          display: 'block',
          width: 44,
          height: 44,
          background: '#e5e7eb',
        }}
      />
    );
  }

  return <canvas ref={canvasRef} style={{ display: 'block', width: 44, height: 44 }} />;
}

function InputImageThumb({
  value,
  order,
  crop,
  lt,
  onOpenPreview,
}: {
  value: string;
  order: number;
  crop?: CropInfo;
  lt: (zh: string, en: string) => string;
  onOpenPreview: (value: string) => void;
}) {
  const assetId = React.useMemo(() => parseFlowImageAssetRef(value), [value]);
  const assetUrl = useFlowImageAssetUrl(assetId);
  const src = assetId ? (assetUrl || undefined) : buildImageSrc(value);

  return (
    <div
      style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}
      title={lt(`输入图 ${order}`, `Input ${order}`)}
      className="nodrag nopan"
    >
      <button
        type="button"
        onClick={() => onOpenPreview(value)}
        onPointerDownCapture={(event) => {
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
        }}
        onMouseDownCapture={(event) => {
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation?.();
        }}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid #d1d5db',
          background: '#f8fafc',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          display: 'block',
        }}
      >
        {src ? (
          crop ? (
            <InputImageCropThumb src={src} crop={crop} />
          ) : (
            <SmartImage
              src={src}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                background: '#fff',
              }}
            />
          )
        ) : null}
      </button>
      <div
        style={{
          position: 'absolute',
          left: 4,
          top: 4,
          width: 14,
          height: 14,
          borderRadius: '999px',
          background: '#111827',
          color: '#fff',
          fontSize: 9,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.28)',
          lineHeight: 1,
          zIndex: 2,
        }}
      >
        {order}
      </div>
    </div>
  );
}

function AnalysisNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const rf = useReactFlow();
  const { status, error } = data;
  const incomingEdges = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.filter(
          (e) =>
            e.target === id &&
            (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
        ),
      [id]
    )
  );
  const connectedInputPreviews = useStore(
    React.useCallback(
      (state: ReactFlowState): ConnectedInputPreview[] => {
        const edgeWithOrder = state.edges
          .map((edge, index) => ({ edge, index }))
          .filter(
            ({ edge }) =>
              edge.target === id &&
              (edge.targetHandle === 'img' || edge.targetHandle === 'image' || !edge.targetHandle)
          )
          .sort((a, b) => a.index - b.index);
        if (edgeWithOrder.length === 0) return [];

        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));
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

        const resolveBaseFromImageChain = (
          node: Node<any>,
          visited: Set<string>
        ): string => {
          if (!node || visited.has(node.id)) return '';
          visited.add(node.id);

          const d = (node.data ?? {}) as any;
          const direct =
            normalize(d.imageData) ||
            normalize(d.imageUrl) ||
            normalize(d.thumbnailDataUrl) ||
            normalize(d.thumbnail) ||
            '';
          if (direct) return direct;

          const upstreamEdge = state.edges.find(
            (e) => e.target === node.id && (e.targetHandle === 'img' || !e.targetHandle)
          );
          if (!upstreamEdge) return '';

          const up = nodeById.get(upstreamEdge.source);
          if (!up) return '';

          if (up.type === 'imageSplit') {
            const upData = (up.data ?? {}) as any;
            return normalize(upData.inputImageUrl) || normalize(upData.inputImage) || '';
          }

          return resolveBaseFromImageChain(up, visited);
        };

        const resolveInputFromEdge = (edge: Edge): ConnectedInput | null => {
          const srcNode = nodeById.get(edge.source);
          if (!srcNode) return null;

          const sourceHandle = (edge as any).sourceHandle as string | undefined;
          const handle = typeof sourceHandle === 'string' ? sourceHandle.trim() : '';

          if (srcNode.type === 'imageSplit') {
            const crop = toCropInfoFromImageSplit(srcNode, handle);
            return crop ? { kind: 'crop', crop } : null;
          }

          if (srcNode.type === 'image' || srcNode.type === 'imagePro') {
            const d = (srcNode.data ?? {}) as any;
            const baseRef = normalize(d.imageData) || normalize(d.imageUrl);
            const derivedCrop = resolveCropFromImageChain(srcNode, new Set());
            if (derivedCrop) {
              return { kind: 'crop', crop: derivedCrop };
            }

            const fallback =
              baseRef ||
              normalize(d.thumbnailDataUrl) ||
              normalize(d.thumbnail) ||
              resolveBaseFromImageChain(srcNode, new Set());
            return fallback ? { kind: 'base', baseRef: fallback } : null;
          }

          const d = (srcNode.data ?? {}) as any;
          if (
            srcNode.type === 'generate4' ||
            srcNode.type === 'generatePro4' ||
            srcNode.type === 'midjourneyV7' ||
            srcNode.type === 'niji7'
          ) {
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
        };

        const out: ConnectedInputPreview[] = [];
        edgeWithOrder.forEach(({ edge, index }) => {
          const resolved = resolveInputFromEdge(edge);
          if (!resolved) return;
          if (resolved.kind === 'crop') {
            out.push({
              id: `${edge.id || edge.source}-${index}-crop`,
              baseRef: resolved.crop.baseRef,
              crop: resolved.crop,
            });
            return;
          }
          out.push({
            id: `${edge.id || edge.source}-${index}-base`,
            baseRef: resolved.baseRef,
          });
        });

        return out.slice(0, MAX_INPUT_PREVIEWS);
      },
      [id]
    )
  );

  const fallbackRaw = React.useMemo(() => (data.imageData || data.imageUrl)?.trim() || '', [data.imageData, data.imageUrl]);
  const inputPreviews = React.useMemo<ConnectedInputPreview[]>(() => {
    if (connectedInputPreviews.length > 0) return connectedInputPreviews;
    if (!fallbackRaw) return [];
    return [
      {
        id: `${id}-fallback`,
        baseRef: fallbackRaw,
      },
    ];
  }, [connectedInputPreviews, fallbackRaw, id]);

  React.useEffect(() => {
    if (incomingEdges.length > 0) return;
    if (!data.imageData && !data.imageUrl) return;
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { imageData: undefined, imageUrl: undefined } },
      })
    );
  }, [incomingEdges.length, data.imageData, data.imageUrl, id]);

  const hasAnyInput = inputPreviews.length > 0;
  const incomingImageCount = incomingEdges.length;
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [previewValue, setPreviewValue] = React.useState('');
  const defaultPreviewValue = inputPreviews[0]?.baseRef || '';
  const effectivePreviewValue = previewValue || defaultPreviewValue;
  const previewAssetId = React.useMemo(
    () => parseFlowImageAssetRef(effectivePreviewValue),
    [effectivePreviewValue]
  );
  const previewAssetUrl = useFlowImageAssetUrl(previewAssetId);
  const previewSrc = React.useMemo(() => {
    if (!effectivePreviewValue) return '';
    if (previewAssetId) return previewAssetUrl || '';
    return buildImageSrc(effectivePreviewValue) || '';
  }, [effectivePreviewValue, previewAssetId, previewAssetUrl]);
  const openPreview = React.useCallback((value: string) => {
    const next = value.trim();
    if (!next) return;
    setPreviewValue(next);
    setPreview(true);
  }, []);
  React.useEffect(() => {
    if (!previewValue) return;
    const stillExists = inputPreviews.some((item) => item.baseRef === previewValue);
    if (!stillExists) {
      setPreviewValue('');
    }
  }, [inputPreviews, previewValue]);
  const providerToggleOptions = React.useMemo<Array<{
    value: ProviderToggleValue;
    label: string;
    description: string;
  }>>(
    () => [
      {
        value: 'banana-2.5',
        label: 'Fast',
        description: lt('Nano Banana+Gemini 2.5', 'Nano Banana+Gemini 2.5'),
      },
      {
        value: 'banana',
        label: 'Pro',
        description: lt('Nano Banana Pro+Gemini 3.0', 'Nano Banana Pro+Gemini 3.0'),
      },
      {
        value: 'banana-3.1',
        label: 'Ultra',
        description: lt('Nano Banana 2+Gemini 3.1', 'Nano Banana 2+Gemini 3.1'),
      },
    ],
    [lt]
  );
  const currentProviderValue = normalizeAnalysisProvider(data.analysisProvider);
  const currentProviderOption = React.useMemo(
    () =>
      providerToggleOptions.find((option) => option.value === currentProviderValue) ??
      providerToggleOptions[1],
    [currentProviderValue, providerToggleOptions]
  );
  const effectiveProvider = currentProviderValue;
  const analyzeBananaImageRoute: 'normal' = 'normal';
  const analysisModel = React.useMemo(
    () => getTextModelForProvider(effectiveProvider),
    [effectiveProvider]
  );
  const providerFallbackCredits = React.useMemo(() => 10, []);
  const resolvedRunCredits = providerFallbackCredits;
  const shell = flowNodeShellChrome(isFlowDark, !!selected);
  const controlField = flowNodeControlField(isFlowDark);
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';
  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<Element, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const defaultAnalysisPrompt = lt(
    '分析一下这张图的内容，尽可能描述场景中的物体和特点，用一段提示词方式输出。',
    'Analyze this image. Describe the scene objects and characteristics in one prompt-style paragraph.'
  );
  const promptInput = data.analysisPrompt ?? defaultAnalysisPrompt;

  // 用于追踪分析进行中的状态
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  // 初始化节点提示词
  React.useEffect(() => {
    if (typeof data.analysisPrompt === 'undefined') {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { analysisPrompt: defaultAnalysisPrompt } }
      }));
    }
  }, [data.analysisPrompt, defaultAnalysisPrompt, id]);

  React.useEffect(() => {
    if (typeof data.analysisProvider === 'undefined') {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { analysisProvider: 'banana-2.5' as ProviderToggleValue } },
        })
      );
    }
  }, [data.analysisProvider, id]);

  const readConnectedExtraPrompt = React.useCallback((): string => {
    try {
      const edges = rf.getEdges().filter((e) => e.target === id && e.targetHandle === 'text');
      if (edges.length === 0) return '';

      const promptParts = edges
        .map((edge) => {
          if (!edge?.source) return '';
          const src = rf.getNode(edge.source);
          const sourceHandle =
            typeof edge.sourceHandle === 'string' ? edge.sourceHandle : undefined;
          return resolveTextFromSourceNode(src, sourceHandle)?.trim() ?? '';
        })
        .filter((text) => text.length > 0);

      if (promptParts.length === 0) return '';
      return Array.from(new Set(promptParts)).join('\n\n');
    } catch {
      return '';
    }
  }, [id, rf]);

  const onAnalyze = React.useCallback(async () => {
    if (!hasAnyInput || status === 'running' || isAnalyzing) return;

    const basePrompt = (data.analysisPrompt ?? defaultAnalysisPrompt).trim();
    const extraPrompt = readConnectedExtraPrompt();
    const promptToUse = extraPrompt ? `${basePrompt}\n\n${extraPrompt}` : basePrompt;
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

      const resolveFirstCandidateDataUrl = async (
        ...candidates: unknown[]
      ): Promise<string | null> => {
        for (const candidate of candidates) {
          const value = typeof candidate === 'string' ? candidate.trim() : '';
          if (!value) continue;
          const resolved = await resolveImageToDataUrl(value, { preferProxy: true });
          if (resolved) return resolved;
        }
        return null;
      };

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
            img.onerror = () => reject(new Error(lt('图片解码失败', 'Image decode failed')));
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
          const legacyResolved = await resolveFirstCandidateDataUrl(legacyValue);
          if (legacyResolved) return legacyResolved;
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
            const cropBaseCandidates = Array.from(
              new Set(
                [
                  typeof d.imageData === 'string' ? d.imageData.trim() : '',
                  typeof d.imageUrl === 'string' ? d.imageUrl.trim() : '',
                ].filter((value) => value.length > 0)
              )
            );
            if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              for (const baseRef of cropBaseCandidates) {
                const cropped = await cropImageToDataUrl({
                  baseRef,
                  rect: { x, y, width: w, height: h },
                  sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                  sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
                });
                if (cropped) return cropped;
              }
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

        if (
          node.type === 'generate4' ||
          node.type === 'generatePro4' ||
          node.type === 'midjourneyV7' ||
          node.type === 'niji7'
        ) {
          const idx = handle?.startsWith('img') ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1)) : 0;
          const urls = Array.isArray(d?.imageUrls) ? (d.imageUrls as string[]) : [];
          const imgs = Array.isArray(d?.images) ? (d.images as string[]) : [];
          const thumbs = Array.isArray(d?.thumbnails) ? (d.thumbnails as string[]) : [];
          return await resolveFirstCandidateDataUrl(
            urls[idx],
            imgs[idx],
            thumbs[idx],
            d?.imageData,
            d?.imageUrl
          );
        }

        return await resolveFirstCandidateDataUrl(
          d.imageData,
          d.imageUrl,
          d.outputImage,
          d.thumbnailDataUrl,
          d.thumbnail
        );
      };

      const resolveAnalyzeSources = async (): Promise<string[]> => {
        const edges = incomingEdges.length
          ? incomingEdges
          : rf.getEdges().filter(
              (e) =>
                e.target === id &&
                (e.targetHandle === 'img' || e.targetHandle === 'image' || !e.targetHandle)
            );
        if (edges.length) {
          const sourceCandidates = await Promise.all(
            edges.map(async (edge) => {
              const srcNode = rf.getNode(edge.source);
              if (!srcNode) return '';
              const dataUrl = await resolveNodeImageToDataUrl(
                srcNode as any,
                (edge as any).sourceHandle,
                new Set()
              );
              return dataUrl?.trim() || '';
            })
          );
          const normalized = Array.from(new Set(sourceCandidates.filter((value) => value.length > 0)));
          if (normalized.length) return normalized;
        }

        const dataUrl = await resolveFirstCandidateDataUrl(data.imageData, data.imageUrl);
        if (!dataUrl) throw new Error(lt('图片加载失败', 'Image load failed'));
        return [dataUrl];
      };

      const analysisSources = await resolveAnalyzeSources();
      const primarySource = analysisSources[0];
      if (!primarySource) {
        throw new Error(lt('缺少图片输入', 'Missing image input'));
      }

      const result = await aiImageService.analyzeImage({
        prompt: promptToUse,
        sourceImage: primarySource,
        sourceImages: analysisSources.length > 1 ? analysisSources : undefined,
        aiProvider: effectiveProvider,
        model: analysisModel,
        providerOptions: {
          banana: {
            imageRoute: analyzeBananaImageRoute,
          },
          bananaImageRoute: analyzeBananaImageRoute,
        },
      });

      if (!result.success || !result.data) {
        const message = result.error?.message || 'Analysis failed, please try again later';
        throw new Error(message);
      }

      const finalAnalysis = (result.data.analysis || '').trim();
      if (!finalAnalysis) {
        throw new Error('Analysis returned empty response, please try again later');
      }

      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'succeeded', error: undefined, prompt: finalAnalysis, text: finalAnalysis } }
      }));
      console.log('✅ Analysis finished. Result synced to node:', finalAnalysis.substring(0, 50) + '...');

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
  }, [analysisModel, analyzeBananaImageRoute, data.analysisPrompt, data.imageData, data.imageUrl, defaultAnalysisPrompt, effectiveProvider, hasAnyInput, id, incomingEdges, isAnalyzing, lt, readConnectedExtraPrompt, rf, status]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>
      ).detail;
      if (!detail || detail.id !== id) return;
      void (async () => {
        try {
          await onAnalyze();
          detail.done?.(true);
        } catch {
          detail.done?.(false);
        }
      })();
    };
    window.addEventListener('flow:run-node', handler as EventListener);
    return () =>
      window.removeEventListener('flow:run-node', handler as EventListener);
  }, [id, onAnalyze]);

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
        background: shell.background,
        color: shell.color,
        border: `1px solid ${shell.borderColor}`,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontWeight: 600, color: shell.color }}>Analysis</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onPointerDownCapture={stopNodeDrag}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                className='nodrag nopan tanva-flow-provider-mode-badge'
                title={lt('切换模型模式', 'Switch model mode')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1px 8px',
                  borderRadius: 50,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  ...(isFlowDark
                    ? {
                        color: '#ffffff',
                        background: '#343434',
                        border: '1px solid #4a4a4a',
                      }
                    : {
                        color:
                          currentProviderValue === 'banana-3.1'
                            ? '#0f172a'
                            : '#475569',
                        background:
                          currentProviderValue === 'banana-3.1'
                            ? '#e2e8f0'
                            : '#f1f5f9',
                        border: '1px solid #e2e8f0',
                      }),
                }}
              >
                {currentProviderOption.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side='bottom'
              sideOffset={8}
              className='min-w-[200px] rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md'
            >
              <DropdownMenuLabel className='px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400'>
                {lt('模型切换', 'Model switch')}
              </DropdownMenuLabel>
              {providerToggleOptions.map((option) => {
                const isActive = currentProviderValue === option.value;
                return (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (currentProviderValue !== option.value) {
                        window.dispatchEvent(
                          new CustomEvent('flow:updateNodeData', {
                            detail: { id, patch: { analysisProvider: option.value } },
                          })
                        );
                      }
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                      isActive ? 'bg-gray-100 text-gray-800' : 'text-slate-600'
                    }`}
                  >
                    <div className='flex-1 space-y-0.5'>
                      <div className='font-medium leading-none'>{option.label}</div>
                      <div className='text-[11px] leading-snug text-slate-400'>{option.description}</div>
                    </div>
                    {isActive && <Check className='h-3.5 w-3.5 text-slate-700' />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <button
          onClick={onAnalyze}
          disabled={status === 'running' || !hasAnyInput || isAnalyzing}
          className='run-btn-with-credit'
          style={{
            fontSize: 12,
            minHeight: 30,
            padding: '0 10px',
            background: (status === 'running' || !hasAnyInput || isAnalyzing) ? '#e5e7eb' : '#111827',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: (status === 'running' || !hasAnyInput || isAnalyzing) ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={
            status === 'running' || isAnalyzing
              ? 'Running...'
              : resolvedRunCredits
              ? `${lt('本次消耗', 'Cost')}: ${resolvedRunCredits} ${lt('积分', 'credits')}`
              : lt('运行分析', 'Run analysis')
          }
        >
          {status === 'running' || isAnalyzing ? (
            <span className='run-text-trigger'>Running...</span>
          ) : (
            <>
              <span className='run-text-trigger'>Run</span>
              {resolvedRunCredits ? (
                <RunCreditBadge credits={resolvedRunCredits} runButton />
              ) : null}
            </>
          )}
        </button>
      </div>

      {inputPreviews.length > 0 ? (
        <div
          className="nodrag nopan nowheel"
          onPointerDownCapture={(event) => {
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation?.();
          }}
          onMouseDownCapture={(event) => {
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation?.();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            overflowX: 'auto',
            paddingBottom: 2,
          }}
          title={lt('输入图顺序会影响分析结果', 'Input order affects analysis results')}
        >
          {inputPreviews.map((item, idx) => (
            <InputImageThumb
              key={item.id}
              value={item.baseRef}
              order={idx + 1}
              crop={item.crop}
              lt={lt}
              onOpenPreview={openPreview}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            width: '100%',
            minHeight: 52,
            borderRadius: 6,
            border: `1px solid ${flowNodeWellOutlineBorder(isFlowDark)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: flowNodeMutedWellBackground(isFlowDark),
          }}
        >
          <span style={{ fontSize: 12, color: '#9ca3af' }}>Waiting for image input</span>
        </div>
      )}
      {incomingImageCount > 1 && (
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          {lt('已连接', 'Connected')} {incomingImageCount} {lt('张图片输入', 'image inputs')}
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: shell.color }}>Analysis Prompt</div>
        <textarea
          className="nodrag nopan nowheel"
          value={promptInput}
          onChange={onPromptChange}
          onWheelCapture={(event) => {
            if (shouldPassWheelToCanvas(event)) return;
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
            fontFamily: 'inherit',
            ...controlField,
          }}
          disabled={status === 'running' || isAnalyzing}
        />
      </div>

      <div
        style={{
          minHeight: 72,
          maxHeight: 120,
          overflowY: 'auto',
          background: flowNodeMutedWellBackground(isFlowDark),
          borderRadius: 6,
          padding: 8,
          fontSize: 12,
          color: isFlowDark ? '#d1d5db' : '#374151',
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
        style={{ top: '38%' }}
        onMouseEnter={() => setHover('img-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '76%' }}
        onMouseEnter={() => setHover('text-in')}
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
        <div className="flow-tooltip" style={{ left: -8, top: '38%', transform: 'translate(-100%, -50%)' }}>
          image
        </div>
      )}
      {hover === 'text-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '76%', transform: 'translate(-100%, -50%)' }}>
          {lt('追加提示词', 'extra prompt')}
        </div>
      )}
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          prompt
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={previewSrc}
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
