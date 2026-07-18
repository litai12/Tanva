import React from 'react';
import { Handle, Position, useReactFlow, useStore, type Node as RFNode, type Node as FlowNode, type ReactFlowState } from '@xyflow/react';
import { Send as SendIcon, Play, Plus, X, Link, Copy, Trash2, Download, FolderPlus, Check, Globe, Square } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import SmartImage from '../../ui/SmartImage';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import GenerationProgressBar from './GenerationProgressBar';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { flowLetterboxBackground } from './flowNodeDarkTheme';
import { cn } from '@/lib/utils';
import { resolveTextFromSourceNode } from '../utils/textSource';
import ContextMenu from '../../ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import { parseFlowImageAssetRef } from '@/services/flowImageAssetStore';
import { useFlowImageAssetUrl } from '@/hooks/useFlowImageAssetUrl';
import { toRenderableImageSrc } from '@/utils/imageSource';
import { useLocaleText } from '@/utils/localeText';
import RunCreditBadge from './RunCreditBadge';
import { useImageNodeCreditsPreview } from '../hooks/useImageNodeCreditsPreview';
import { useImeSafeTextList } from '../hooks/useImeSafeTextInput';
import { useFlowRenderMode } from '../FlowRenderModeContext';
import { getImageSplitHandleIndex } from '../utils/imageSplitHandles';
import {
  getFlowImageReferenceLimit,
  resolveFlowModelProvider,
  type FlowModelProvider,
} from '@/utils/flowModelProvider';

// 长宽比图标
const AspectRatioIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect x="2" y="4" width="12" height="8" stroke="currentColor" strokeWidth="1.5" fill="none" rx="1" />
  </svg>
);

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    progressStartedAt?: number | string | null;
    imageData?: string;
    imageUrl?: string;
    thumbnail?: string; // 缩略图，用于节点显示
    responseText?: string;
    textResponse?: string;
    title?: string;
    enableWebSearch?: boolean;
    error?: string;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
    imageSize?: '0.5K' | '1K' | '2K' | '4K' | null;
    prompts?: string[];
    imageWidth?: number;
    promptHeight?: number;
    creditsPerCall?: number;
    managedModelKey?: string;
    vendorKey?: string;
    platformKey?: string;
    modelProvider?: FlowModelProvider;
    onRun?: (id: string) => void;
    onStop?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

// 构建图片 src - 优先使用 OSS URL，避免 proxy 降级
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toRenderableImageSrc(trimmed) || undefined;
};

const MIN_IMAGE_WIDTH = 150;
const MAX_IMAGE_WIDTH = 600;
const DEFAULT_IMAGE_WIDTH = 296;
const MIN_PROMPT_HEIGHT = 60;
const MAX_PROMPT_HEIGHT = 400;
const DEFAULT_PROMPT_HEIGHT = 80;
const DEFAULT_NODE_TITLE = 'Agent';
const EMPTY_CONNECTED_INPUT_IMAGES: ConnectedInputImage[] = [];

type OrderedInputEdge = {
  edge: ReactFlowState['edges'][number];
  index: number;
};

const isImageInputHandle = (handle?: string | null): boolean => {
  if (!handle || handle === 'img') return true;
  return /^img\d+$/.test(handle);
};

const imageInputHandleRank = (handle?: string | null): number => {
  if (!handle || handle === 'img') return 0;
  const match = /^img(\d+)$/.exec(handle);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Number(match[1]) - 1);
};

const collectOrderedInputEdges = (
  edges: ReactFlowState['edges'],
  targetId: string
): OrderedInputEdge[] => {
  const matched: OrderedInputEdge[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i];
    if (edge.target !== targetId) continue;
    if (!isImageInputHandle(edge.targetHandle)) continue;
    matched.push({ edge, index: i });
  }
  if (matched.length <= 1) return matched;
  matched.sort((a, b) => {
    const rankDelta =
      imageInputHandleRank(a.edge.targetHandle) -
      imageInputHandleRank(b.edge.targetHandle);
    if (rankDelta !== 0) return rankDelta;
    return a.index - b.index;
  });
  return matched;
};

type ConnectedInputImage = {
  id: string;
  imageData: string;
  thumbnailData?: string;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth?: number;
    sourceHeight?: number;
  };
};

const areConnectedCropsEqual = (
  a?: ConnectedInputImage["crop"],
  b?: ConnectedInputImage["crop"]
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.sourceWidth === b.sourceWidth &&
    a.sourceHeight === b.sourceHeight
  );
};

const areConnectedInputImagesEqual = (
  a: ConnectedInputImage[],
  b: ConnectedInputImage[]
): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.imageData !== right.imageData ||
      left.thumbnailData !== right.thumbnailData ||
      !areConnectedCropsEqual(left.crop, right.crop)
    ) {
      return false;
    }
  }
  return true;
};

const normalizeImageValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const parseCropInfo = (
  value: unknown
):
  | {
      x: number;
      y: number;
      width: number;
      height: number;
      sourceWidth?: number;
      sourceHeight?: number;
    }
  | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const crop = value as Record<string, unknown>;
  const x = typeof crop.x === 'number' ? crop.x : Number(crop.x ?? 0);
  const y = typeof crop.y === 'number' ? crop.y : Number(crop.y ?? 0);
  const width =
    typeof crop.width === 'number' ? crop.width : Number(crop.width ?? 0);
  const height =
    typeof crop.height === 'number' ? crop.height : Number(crop.height ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) {
    return undefined;
  }
  const sourceWidth =
    typeof crop.sourceWidth === 'number'
      ? crop.sourceWidth
      : Number(crop.sourceWidth ?? 0);
  const sourceHeight =
    typeof crop.sourceHeight === 'number'
      ? crop.sourceHeight
      : Number(crop.sourceHeight ?? 0);
  return {
    x,
    y,
    width,
    height,
    sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
    sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
  };
};

const readConnectedImagesFromNode = (
  node: FlowNode,
  sourceHandle?: string | null
): ConnectedInputImage[] => {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const getStringAt = (list: unknown, idx: number): string | undefined => {
    if (!Array.isArray(list)) return undefined;
    return normalizeImageValue(list[idx]);
  };
  const pickAt = (idx: number): ConnectedInputImage[] => {
    const full =
      getStringAt(d.imageUrls, idx) ||
      getStringAt(d.images, idx) ||
      getStringAt(d.thumbnails, idx);
    if (!full) return [];
    const thumb = getStringAt(d.thumbnails, idx);
    return [{ id: `${node.id}-img${idx + 1}`, imageData: full, thumbnailData: thumb }];
  };

  if (typeof sourceHandle === 'string') {
    const splitIdx = node.type === 'imageSplit' ? getImageSplitHandleIndex(sourceHandle) : null;
    if (splitIdx !== null) {
      const idx = splitIdx;
      const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
      const rect = splitRects[idx];
      const rectRecord =
        rect && typeof rect === 'object' ? (rect as Record<string, unknown>) : {};
      const x = typeof rectRecord.x === 'number' ? rectRecord.x : Number(rectRecord.x ?? 0);
      const y = typeof rectRecord.y === 'number' ? rectRecord.y : Number(rectRecord.y ?? 0);
      const width =
        typeof rectRecord.width === 'number'
          ? rectRecord.width
          : Number(rectRecord.width ?? 0);
      const height =
        typeof rectRecord.height === 'number'
          ? rectRecord.height
          : Number(rectRecord.height ?? 0);
      const splitBase =
        normalizeImageValue(d.inputImageUrl) || normalizeImageValue(d.inputImage);
      if (
        splitBase &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        width > 0 &&
        height > 0
      ) {
        const sourceWidth =
          typeof d.sourceWidth === 'number' ? d.sourceWidth : Number(d.sourceWidth ?? 0);
        const sourceHeight =
          typeof d.sourceHeight === 'number' ? d.sourceHeight : Number(d.sourceHeight ?? 0);
        return [
          {
            id: `${node.id}-image${idx + 1}`,
            imageData: splitBase,
            thumbnailData: splitBase,
            crop: {
              x,
              y,
              width,
              height,
              sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
              sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
            },
          },
        ];
      }

      const direct = normalizeImageValue(d[`image${idx + 1}`]);
      const splitImages = Array.isArray(d.splitImages) ? d.splitImages : [];
      const legacyCandidate = splitImages[idx];
      const legacy =
        legacyCandidate && typeof legacyCandidate === 'object'
          ? normalizeImageValue((legacyCandidate as { imageData?: unknown }).imageData)
          : undefined;
      const value = direct || legacy;
      return value
        ? [{ id: `${node.id}-image${idx + 1}`, imageData: value, thumbnailData: value }]
        : [];
    }

    const singleMatch = /^img(\d+)$/.exec(sourceHandle);
    if (singleMatch) {
      const idx = Math.max(0, Number(singleMatch[1]) - 1);
      return pickAt(idx);
    }
  }

  if (
    typeof sourceHandle === 'string' &&
    (sourceHandle === 'images' || sourceHandle.startsWith('images-'))
  ) {
    const max = Math.max(
      Array.isArray(d.imageUrls) ? d.imageUrls.length : 0,
      Array.isArray(d.images) ? d.images.length : 0,
      Array.isArray(d.thumbnails) ? d.thumbnails.length : 0
    );
    const out: ConnectedInputImage[] = [];
    for (let idx = 0; idx < max; idx += 1) {
      out.push(...pickAt(idx));
    }
    return out;
  }

  const full =
    normalizeImageValue(d.imageData) ||
    normalizeImageValue(d.imageUrl) ||
    normalizeImageValue(d.outputImage) ||
    normalizeImageValue(d.inputImage) ||
    normalizeImageValue(d.inputImageUrl) ||
    normalizeImageValue(d.thumbnailDataUrl) ||
    normalizeImageValue(d.thumbnail);
  const thumb =
    normalizeImageValue(d.thumbnail) || normalizeImageValue(d.thumbnailDataUrl);
  const crop = parseCropInfo(d.crop);

  return full
    ? [
        {
          id: node.id,
          imageData: full,
          thumbnailData: thumb,
          crop,
        },
      ]
    : [];
};

function InputImageCropThumb({
  src,
  crop,
}: {
  src: string;
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth?: number;
    sourceHeight?: number;
  };
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
    img.crossOrigin = 'anonymous';
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
      const sx = Math.max(0, Math.min(naturalW - 1, crop.x * scaleX));
      const sy = Math.max(0, Math.min(naturalH - 1, crop.y * scaleY));
      const swRaw = Math.max(1, crop.width * scaleX);
      const shRaw = Math.max(1, crop.height * scaleY);
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
    crop.height,
    crop.sourceHeight,
    crop.sourceWidth,
    crop.width,
    crop.x,
    crop.y,
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
  lt,
  crop,
  onOpenPreview,
}: {
  value: string;
  order: number;
  lt: (zh: string, en: string) => string;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth?: number;
    sourceHeight?: number;
  };
  onOpenPreview: (value: string) => void;
}) {
  const assetId = React.useMemo(() => parseFlowImageAssetRef(value), [value]);
  const assetUrl = useFlowImageAssetUrl(assetId);
  const src = assetId ? (assetUrl || undefined) : buildImageSrc(value);

  return (
    <div
      style={{
        position: 'relative',
        width: 44,
        height: 44,
        flexShrink: 0,
      }}
      title={lt(`输入图 ${order}`, `Input ${order}`)}
    >
      <button
        type='button'
        onClick={() => onOpenPreview(value)}
        onPointerDownCapture={(event) => {
          event.stopPropagation();
          const nativeEvent = (event as React.SyntheticEvent<Element, Event>)
            .nativeEvent as Event & { stopImmediatePropagation?: () => void };
          nativeEvent.stopImmediatePropagation?.();
        }}
        onMouseDownCapture={(event) => {
          event.stopPropagation();
          const nativeEvent = (event as React.SyntheticEvent<Element, Event>)
            .nativeEvent as Event & { stopImmediatePropagation?: () => void };
          nativeEvent.stopImmediatePropagation?.();
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
              alt=''
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

function GenerateProNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const { status, error } = data;
  const responseText = (
    (typeof data.responseText === 'string' ? data.responseText : '') ||
    (typeof data.textResponse === 'string' ? data.textResponse : '')
  ).trim();

  // 原图用于预览和下载
  const rawFullValue = data.imageUrl || data.imageData;
  const fullAssetId = React.useMemo(() => parseFlowImageAssetRef(rawFullValue), [rawFullValue]);
  const fullAssetUrl = useFlowImageAssetUrl(fullAssetId);
  const fullSrc = React.useMemo(() => {
    if (fullAssetId) return fullAssetUrl || undefined;
    return buildImageSrc(rawFullValue);
  }, [fullAssetId, fullAssetUrl, rawFullValue]);

  // 缩略图用于节点显示（优先使用缩略图，没有则用原图）
  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(() => parseFlowImageAssetRef(rawThumbValue), [rawThumbValue]);
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const displaySrc = React.useMemo(() => {
    if (thumbAssetId) return thumbAssetUrl || fullSrc;
    return buildImageSrc(rawThumbValue) || fullSrc;
  }, [thumbAssetId, thumbAssetUrl, rawThumbValue, fullSrc]);

  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [previewOverrideValue, setPreviewOverrideValue] = React.useState<string>('');
  const previewOverrideAssetId = React.useMemo(
    () => parseFlowImageAssetRef(previewOverrideValue),
    [previewOverrideValue]
  );
  const previewOverrideAssetUrl = useFlowImageAssetUrl(previewOverrideAssetId);
  const previewOverrideSrc = React.useMemo(() => {
    if (!previewOverrideValue) return '';
    if (previewOverrideAssetId) return previewOverrideAssetUrl || '';
    return buildImageSrc(previewOverrideValue) || '';
  }, [previewOverrideAssetId, previewOverrideAssetUrl, previewOverrideValue]);
  const normalizedTitle = React.useMemo(
    () =>
      typeof data.title === 'string' && data.title.trim().length > 0
        ? data.title.trim()
        : DEFAULT_NODE_TITLE,
    [data.title]
  );
  const [title, setTitle] = React.useState<string>(normalizedTitle);
  const [titleDraft, setTitleDraft] = React.useState<string>(normalizedTitle);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [isTextFocused, setIsTextFocused] = React.useState(false); // 文字输入框是否聚焦
  const [isAspectMenuOpen, setIsAspectMenuOpen] = React.useState(false);
  const [isImageSizeMenuOpen, setIsImageSizeMenuOpen] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const aspectMenuRef = React.useRef<HTMLDivElement>(null);
  const imageSizeMenuRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  // 图片宽度
  const imageWidth = data.imageWidth || DEFAULT_IMAGE_WIDTH;
  // 提示词区域高度
  const promptHeight = data.promptHeight || DEFAULT_PROMPT_HEIGHT;

  // 提示词数组，至少有一个
  const prompts = React.useMemo(() => {
    const p = data.prompts || [''];
    return p.length > 0 ? p : [''];
  }, [data.prompts]);

  // 使用全局图片历史记录 - 只在预览时才获取
  const projectId = useProjectContentStore((state) => state.projectId);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const chatTheme = useAIChatStore((state) => state.chatTheme);
  const isFlowDark = chatTheme === 'black';
  const globalWebSearchEnabled = useAIChatStore((state) => state.enableWebSearch);
  const enableWebSearch = data.enableWebSearch ?? globalWebSearchEnabled;
  const effectiveProvider = React.useMemo<FlowModelProvider>(
    () => resolveFlowModelProvider(data.modelProvider, aiProvider),
    [aiProvider, data.modelProvider]
  );
  const maxInputPreviews = React.useMemo(
    () => getFlowImageReferenceLimit(effectiveProvider),
    [effectiveProvider]
  );

  type ProviderToggleValue = 'banana-2.5' | 'banana' | 'banana-3.1';
  const providerToggleOptions = React.useMemo<Array<{
    value: ProviderToggleValue;
    label: string;
    description: string;
  }>>(
    () => [
      {
        value: 'banana-2.5',
        label: 'Fast',
        description: lt('Nano Banana/Gemini 2.5', 'Nano Banana/Gemini 2.5'),
      },
      {
        value: 'banana',
        label: 'Pro',
        description: lt('Nano Banana Pro+Gemini 3.5', 'Nano Banana Pro+Gemini 3.5'),
      },
      {
        value: 'banana-3.1',
        label: 'Ultra',
        description: lt('Nano Banana 2/Gemini 3.1', 'Nano Banana 2/Gemini 3.1'),
      },
    ],
    [lt]
  );

  const currentProviderValue = effectiveProvider;

  const currentProviderOption = React.useMemo(
    () =>
      providerToggleOptions.find((option) => option.value === currentProviderValue) ??
      providerToggleOptions[1],
    [currentProviderValue, providerToggleOptions]
  );

  React.useEffect(() => {
    if (
      typeof data.modelProvider === "string" &&
      data.modelProvider.trim().length > 0
    ) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { modelProvider: currentProviderValue } },
      })
    );
  }, [currentProviderValue, data.modelProvider, id]);

  // 判断是否为高质量模式（Pro / Ultra）
  const isProMode = true;

  const rf = useReactFlow();
  // 移除 useEdges() - 改用事件监听方式获取外部提示词，避免频繁重渲染
  // 支持多个外部提示词输入
  const [externalPrompts, setExternalPrompts] = React.useState<string[]>([]);
  const [externalSourceIds, setExternalSourceIds] = React.useState<string[]>([]);

  // 只在预览模式下才获取历史记录，避免不必要的重渲染
  const allImages = React.useMemo(() => {
    if (!preview) return [];
    const history = useImageHistoryStore.getState().history;
    const projectHistory = projectId
      ? history.filter((item) => {
          const pid = item.projectId ?? null;
          return pid === projectId || pid === null;
        })
      : history;
    return projectHistory.map(
      (item) =>
        ({
          id: item.id,
          src: item.src,
          title: item.title,
          timestamp: item.timestamp,
        }) as ImageItem,
    );
     
  }, [preview, projectId]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<Element, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const connectedInputImages = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edgeWithOrder = collectOrderedInputEdges(state.edges, id);
        if (edgeWithOrder.length === 0) return EMPTY_CONNECTED_INPUT_IMAGES;

        const nodeLookup = (
          state as ReactFlowState & { nodeLookup?: Map<string, FlowNode> }
        ).nodeLookup;
        const hasNodeLookup =
          nodeLookup && typeof nodeLookup.get === 'function';
        const fallbackNodes = hasNodeLookup
          ? null
          : ((state as ReactFlowState & { nodes?: FlowNode[] }).nodes ||
            state.nodes);
        const fallbackNodeById = fallbackNodes
          ? new Map(fallbackNodes.map((node) => [node.id, node]))
          : null;
        const resolveSourceNode = (sourceId: string): FlowNode | undefined => {
          const fromLookup = hasNodeLookup ? nodeLookup!.get(sourceId) : undefined;
          return fromLookup || fallbackNodeById?.get(sourceId);
        };

        const out: ConnectedInputImage[] = [];

        for (let edgeIdx = 0; edgeIdx < edgeWithOrder.length; edgeIdx += 1) {
          const { edge } = edgeWithOrder[edgeIdx];
          const sourceNode = resolveSourceNode(edge.source);
          if (!sourceNode) continue;
          const items = readConnectedImagesFromNode(sourceNode, edge.sourceHandle);
          for (let itemIdx = 0; itemIdx < items.length; itemIdx += 1) {
            const item = items[itemIdx];
            out.push({
              ...item,
              id: `${edge.id || edge.source}-${edgeIdx}-${item.id}-${itemIdx}`,
            });
            if (out.length >= maxInputPreviews) {
              return out;
            }
          }
        }

        return out;
      },
      [id, maxInputPreviews]
    ),
    areConnectedInputImagesEqual
  );

  const refreshExternalPrompts = React.useCallback(
    (optimisticSource?: { sourceId: string; patch: Record<string, unknown> } | null) => {
      const currentEdges = rf.getEdges();
      // 获取所有连接到 text handle 的边
      const textEdges = currentEdges.filter((e) => e.target === id && e.targetHandle === 'text');

      if (textEdges.length === 0) {
        setExternalPrompts([]);
        setExternalSourceIds([]);
        return;
      }

      const sourceIds: string[] = [];
      const prompts: string[] = [];

      for (const edge of textEdges) {
        sourceIds.push(edge.source);
        let sourceNode: RFNode | undefined = rf.getNode(edge.source) as RFNode | undefined;
        if (
          optimisticSource &&
          sourceNode &&
          edge.source === optimisticSource.sourceId &&
          optimisticSource.patch &&
          typeof optimisticSource.patch === 'object'
        ) {
          sourceNode = {
            ...sourceNode,
            data: { ...(sourceNode.data as Record<string, unknown>), ...optimisticSource.patch },
          } as RFNode;
        }
        if (sourceNode) {
          const resolved = resolveTextFromSourceNode(sourceNode, edge.sourceHandle);
          if (resolved && resolved.trim().length) {
            prompts.push(resolved.trim());
          }
        }
      }

      setExternalSourceIds(sourceIds);
      setExternalPrompts(prompts);
    },
    [id, rf],
  );

  const refreshExternalPromptsTimerRef = React.useRef<number | null>(null);
  const refreshExternalPromptsDeferred = React.useCallback(() => {
    if (refreshExternalPromptsTimerRef.current !== null) {
      window.clearTimeout(refreshExternalPromptsTimerRef.current);
    }
    refreshExternalPromptsTimerRef.current = window.setTimeout(() => {
      refreshExternalPromptsTimerRef.current = null;
      refreshExternalPrompts();
    }, 0);
  }, [refreshExternalPrompts]);

  React.useEffect(() => {
    refreshExternalPrompts();
  }, [refreshExternalPrompts]);

  React.useEffect(() => {
    return () => {
      if (refreshExternalPromptsTimerRef.current !== null) {
        window.clearTimeout(refreshExternalPromptsTimerRef.current);
      }
    };
  }, []);

  // 监听边的变化（连接/断开）来刷新外部提示词
  React.useEffect(() => {
    const handleEdgesChange = () => {
      refreshExternalPrompts();
    };
    window.addEventListener('flow:edgesChange', handleEdgesChange);
    return () => window.removeEventListener('flow:edgesChange', handleEdgesChange);
  }, [refreshExternalPrompts]);

  React.useEffect(() => {
    if (externalSourceIds.length === 0) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch?: Record<string, unknown> }>).detail;
      if (!detail?.id || !externalSourceIds.includes(detail.id)) return;
      // 同一事件周期内 Flow 的 setNodes 可能尚未提交，用事件里的 patch 与当前节点合并后再解析，避免外链文案卡在旧值
      if (detail.patch && typeof detail.patch === 'object') {
        refreshExternalPrompts({ sourceId: detail.id, patch: detail.patch });
      } else {
        refreshExternalPromptsDeferred();
      }
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [externalSourceIds, refreshExternalPrompts, refreshExternalPromptsDeferred]);

  // 更新单个提示词
  const updatePrompt = React.useCallback((index: number, value: string) => {
    const newPrompts = [...prompts];
    newPrompts[index] = value;
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { prompts: newPrompts } }
      })
    );
  }, [id, prompts]);
  const promptInputs = useImeSafeTextList(prompts, updatePrompt);

  // 添加新提示词
  const addPrompt = React.useCallback(() => {
    const newPrompts = [...prompts, ''];
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { prompts: newPrompts } }
      })
    );
  }, [id, prompts]);

  // 删除提示词
  const removePrompt = React.useCallback((index: number) => {
    if (prompts.length <= 1) return; // 至少保留一个
    const newPrompts = prompts.filter((_, i) => i !== index);
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { prompts: newPrompts } }
      })
    );
  }, [id, prompts]);

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  const openInputPreview = React.useCallback((value: string) => {
    const next = value.trim();
    if (!next) return;
    setPreviewOverrideValue(next);
    setCurrentImageId('');
    setPreview(true);
  }, []);

  // 右键菜单处理
  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);

  // 复制节点（写入 Flow 剪贴板，支持 Ctrl/Cmd+V 或 Ctrl/Cmd+Shift+V 粘贴）
  const handleCopy = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:copyNode', { detail: { nodeId: id } }));
  }, [id]);

  // 删除节点
  const handleDelete = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:deleteNode', { detail: { nodeId: id } }));
  }, [id]);

  // 下载图片（使用原图）
  const handleDownload = React.useCallback(() => {
    if (!fullSrc) return;
    const link = document.createElement('a');
    link.href = fullSrc;
    link.download = `generate_pro_${id}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [fullSrc, id]);

  // 添加到个人库
  const handleAddToLibrary = React.useCallback(() => {
    const source = data.imageUrl || data.imageData;
    if (!source) return;
    window.dispatchEvent(new CustomEvent('flow:addToLibrary', {
      detail: { imageData: source, nodeId: id, nodeType: 'generatePro' }
    }));
  }, [data.imageData, data.imageUrl, id]);

  // 长宽比选项
  const aspectOptions: Array<{ label: string; value: string }> = React.useMemo(() => ([
    { label: lt('自动', 'Auto'), value: '' },
    { label: '1:1', value: '1:1' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '2:3', value: '2:3' },
    { label: '3:2', value: '3:2' },
    { label: '4:5', value: '4:5' },
    { label: '5:4', value: '5:4' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
    { label: '21:9', value: '21:9' },
  ]), [lt]);

  // 更新长宽比
  const updateAspectRatio = React.useCallback((ratio: string) => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: {
          id,
          patch: {
            aspectRatio: ratio || undefined
          }
        }
      })
    );
  }, [id]);

  const normalizeImageSizeForProvider = React.useCallback(
    (
      provider: FlowModelProvider,
      size: '0.5K' | '1K' | '2K' | '4K' | null | undefined
    ): '0.5K' | '1K' | '2K' | '4K' => {
      if (!size) return '1K';
      if (provider === 'banana-2.5') {
        return '1K';
      }
      if (provider === 'banana') {
        if (size === '1K' || size === '2K' || size === '4K') return size;
        return '1K';
      }
      return size;
    },
    []
  );

  const aspectRatioValue = data.aspectRatio ?? '';
  const imageSizeValue = normalizeImageSizeForProvider(
    currentProviderValue,
    data.imageSize ?? null
  );
  const { credits: backendCredits } = useImageNodeCreditsPreview({
    nodeType: "generatePro",
    aiProvider: currentProviderValue,
    bananaImageRoute,
    imageSize: imageSizeValue,
    aspectRatio: aspectRatioValue || undefined,
    referenceImageCount: connectedInputImages.length,
    managedModelKey: data.managedModelKey,
    vendorKey: data.vendorKey,
    platformKey: data.platformKey,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;

  const imageSizeOptions: Array<{ label: string; value: '0.5K' | '1K' | '2K' | '4K' }> = React.useMemo(() => {
    if (currentProviderValue === 'banana-2.5') {
      return [
        { label: '1K', value: '1K' },
      ];
    }
    if (currentProviderValue === 'banana-3.1') {
      return [
        { label: '0.5K', value: '0.5K' },
        { label: '1K', value: '1K' },
        { label: '2K', value: '2K' },
        { label: '4K', value: '4K' },
      ];
    }
    return [
      { label: '1K', value: '1K' },
      { label: '2K', value: '2K' },
      { label: '4K', value: '4K' },
    ];
  }, [currentProviderValue]);

  // 更新图像尺寸
  const updateImageSize = React.useCallback((size: '0.5K' | '1K' | '2K' | '4K') => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: {
          id,
          patch: {
            imageSize: size
          }
        }
      })
    );
  }, [id]);

  React.useEffect(() => {
    const rawImageSize = data.imageSize ?? null;
    if (rawImageSize === imageSizeValue) return;
    updateImageSize(imageSizeValue);
  }, [data.imageSize, imageSizeValue, updateImageSize]);

  // 处理图片切换
  const handleImageChange = React.useCallback((imageId: string) => {
    const selectedImage = allImages.find(item => item.id === imageId);
    if (selectedImage) {
      setPreviewOverrideValue('');
      setCurrentImageId(imageId);
    }
  }, [allImages]);

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreview(false);
        setPreviewOverrideValue('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  React.useEffect(() => {
    setTitle(normalizedTitle);
    if (!isEditingTitle) {
      setTitleDraft(normalizedTitle);
    }
  }, [normalizedTitle, isEditingTitle]);

  React.useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  // 点击外部关闭长宽比菜单
  React.useEffect(() => {
    if (!isAspectMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (aspectMenuRef.current && !aspectMenuRef.current.contains(e.target as Node)) {
        setIsAspectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAspectMenuOpen]);

  React.useEffect(() => {
    if (!isImageSizeMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (imageSizeMenuRef.current && !imageSizeMenuRef.current.contains(e.target as Node)) {
        setIsImageSizeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isImageSizeMenuOpen]);

  React.useEffect(() => {
    if (!isProMode) {
      setIsImageSizeMenuOpen(false);
    }
  }, [isProMode]);

  // 处理角点拖拽调整大小 - 以中心点为基准
  const handleResizeStart = React.useCallback((corner: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = imageWidth;
    let lastWidth = startWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      // 根据角点位置决定调整方向
      let widthChange = 0;

      if (corner === 'top-left') {
        // 左上角：向左上拖放大，向右下拖缩小
        widthChange = -Math.max(deltaX, deltaY * (4/3));
      } else if (corner === 'top-right') {
        // 右上角：向右上拖放大，向左下拖缩小
        widthChange = Math.max(deltaX, -deltaY * (4/3));
      } else if (corner === 'bottom-left') {
        // 左下角：向左下拖放大，向右上拖缩小
        widthChange = Math.max(-deltaX, deltaY * (4/3));
      } else if (corner === 'bottom-right') {
        // 右下角：向右下拖放大，向左上拖缩小
        widthChange = Math.max(deltaX, deltaY * (4/3));
      }

      const newWidth = Math.max(MIN_IMAGE_WIDTH, Math.min(MAX_IMAGE_WIDTH, startWidth + widthChange));

      // 计算相对于上一次的增量变化
      const incrementalChange = newWidth - lastWidth;
      lastWidth = newWidth;

      if (incrementalChange === 0) return;

      // 计算需要偏移的位置（增量变化的一半，高度按比例）- 以中心点为基准
      const positionOffsetX = -incrementalChange / 2;
      const positionOffsetY = -(incrementalChange * 0.75) / 2;

      // 同时更新宽度和位置
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: {
            id,
            patch: {
              imageWidth: newWidth,
              _positionOffset: { x: positionOffsetX, y: positionOffsetY }
            }
          }
        })
      );
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [imageWidth, id]);

  // 计算图片高度（保持4:3比例）
  const imageHeight = imageWidth * 0.75;

  // 角点样式
  const cornerStyle: React.CSSProperties = {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#3b82f6',
    cursor: 'nwse-resize',
    zIndex: 20,
  };

  // 处理 prompt 区域高度拖拽
  const handlePromptResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const startY = e.clientY;
    const startHeight = promptHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(MIN_PROMPT_HEIGHT, Math.min(MAX_PROMPT_HEIGHT, startHeight + deltaY));

      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { promptHeight: newHeight } }
        })
      );
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [promptHeight, id]);

  const startTitleEditing = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setTitleDraft(title);
    setIsEditingTitle(true);
  }, [title]);

  const commitTitle = React.useCallback((raw: string) => {
    const trimmed = raw.trim();
    const nextTitle = trimmed.length ? trimmed : DEFAULT_NODE_TITLE;
    setTitle(nextTitle);
    setTitleDraft(nextTitle);
    setIsEditingTitle(false);
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { title: nextTitle } }
    }));
  }, [id]);

  const cancelTitleEditing = React.useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft(title);
  }, [title]);

  const toggleWebSearch = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: {
        id,
        patch: {
          enableWebSearch: !enableWebSearch,
        }
      }
    }));
  }, [enableWebSearch, id]);

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      style={{
        width: imageWidth + 24, // 加上左右 padding
        background: 'transparent',
        position: 'relative',
        padding: '0 12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
        }}
      >
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => commitTitle(titleDraft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitle(titleDraft);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelTitleEditing();
              }
            }}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            className='nodrag nopan tanva-flow-node-title'
            style={{
              minWidth: 80,
              maxWidth: imageWidth * 0.5,
              fontSize: 16,
              fontWeight: 600,
              lineHeight: 1,
              color: '#111827',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              padding: '2px 8px',
              background: '#fff',
              outline: 'none',
            }}
          />
        ) : (
          <div
            className='tanva-flow-node-title'
            onDoubleClick={startTitleEditing}
            title={lt('双击编辑标题', 'Double click to edit title')}
            style={{
              fontWeight: 600,
              lineHeight: 1,
              color: '#111827',
              cursor: 'text',
              userSelect: 'none',
            }}
          >
            {title}
          </div>
        )}
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
                ...(chatTheme === 'black'
                  ? {
                      color: '#ffffff',
                      background: '#343434',
                      border: '1px solid #4a4a4a',
                    }
                  : {
                      color: currentProviderValue === 'banana-3.1' ? '#0f172a' : '#475569',
                      background: currentProviderValue === 'banana-3.1' ? '#e2e8f0' : '#f1f5f9',
                      border: '1px solid #e2e8f0',
                    }),
              }}
            >
              <span>{currentProviderOption.label}</span>
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
                      const normalizedNextImageSize = normalizeImageSizeForProvider(
                        option.value,
                        (data.imageSize ?? null) as '0.5K' | '1K' | '2K' | '4K' | null
                      );
                      const nextPatch: {
                        modelProvider: ProviderToggleValue;
                        imageSize?: '0.5K' | '1K' | '2K' | '4K' | null;
                      } = { modelProvider: option.value };
                      if (normalizedNextImageSize !== (data.imageSize ?? null)) {
                        nextPatch.imageSize = normalizedNextImageSize;
                      }
                      window.dispatchEvent(
                        new CustomEvent("flow:updateNodeData", {
                          detail: { id, patch: nextPatch },
                        })
                      );
                    }
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-3 py-2 text-xs',
                    isActive ? 'bg-gray-100 text-gray-800' : 'text-slate-600'
                  )}
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

      {/* 图片区域容器 */}
      <div style={{ position: 'relative' }}>
        {/* 选中时的蓝色边框 - 标准矩形无圆角 */}
        {selected && (
          <div
            style={{
              position: 'absolute',
              top: -2,
              left: -2,
              right: -2,
              bottom: -2,
              border: '2px solid #3b82f6',
              borderRadius: 0,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}

        {/* 图片区域 */}
        <div
          onDoubleClick={() => {
            if (!fullSrc) return;
            setPreviewOverrideValue('');
            setPreview(true);
          }}
          style={{
            position: 'relative',
            width: imageWidth,
            height: imageHeight,
            background: displaySrc ? 'transparent' : (isFlowDark ? '#161616' : '#f8f9fa'),
            borderRadius: 12,
            border: isFlowDark ? '1px solid #2f2f2f' : '1px solid #e5e7eb',
            overflow: 'hidden',
            cursor: displaySrc ? 'pointer' : 'default',
          }}
          title={displaySrc ? lt('双击预览', 'Double click to preview') : undefined}
        >
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {displaySrc ? (
              <SmartImage
                src={displaySrc}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: flowLetterboxBackground(isFlowDark),
                }}
              />
            ) : (
              <span style={{ fontSize: 12, color: '#9ca3af' }}>{lt('等待生成', 'Waiting for generation')}</span>
            )}
          </div>

          {connectedInputImages.length > 0 && (
            <div
              className='nodrag nopan nowheel'
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              onDoubleClickCapture={(event) => {
                event.stopPropagation();
                const nativeEvent = (event as React.SyntheticEvent<Element, Event>)
                  .nativeEvent as Event & { stopImmediatePropagation?: () => void };
                nativeEvent.stopImmediatePropagation?.();
              }}
              style={{
                position: 'absolute',
                left: 8,
                bottom: 8,
                zIndex: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: 'calc(100% - 16px)',
                overflowX: 'auto',
                padding: 4,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.82)',
                border: '1px solid rgba(229,231,235,0.9)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                backdropFilter: 'blur(4px)',
              }}
              title={lt('输入图顺序会影响融合效果', 'Input order affects blending')}
            >
              {connectedInputImages.map((item, idx) => (
                <InputImageThumb
                  key={item.id}
                  value={
                    item.crop
                      ? item.imageData
                      : item.thumbnailData || item.imageData
                  }
                  order={idx + 1}
                  lt={lt}
                  crop={item.crop}
                  onOpenPreview={openInputPreview}
                />
              ))}
            </div>
          )}
        </div>

        {/* 选中时的四个角点 */}
        {selected && (
          <>
            <div
              className="nodrag"
              style={{ ...cornerStyle, top: -5, left: -5, cursor: 'nwse-resize' }}
              onMouseDown={handleResizeStart('top-left')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, top: -5, right: -5, cursor: 'nesw-resize' }}
              onMouseDown={handleResizeStart('top-right')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, bottom: -5, left: -5, cursor: 'nesw-resize' }}
              onMouseDown={handleResizeStart('bottom-left')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, bottom: -5, right: -5, cursor: 'nwse-resize' }}
              onMouseDown={handleResizeStart('bottom-right')}
            />
          </>
        )}

        {/* 图片区域的 Handle */}
        <Handle
          className="tanva-beta-handle tanva-beta-handle-image"
          type="target"
          position={Position.Left}
          id="img"
          style={{
            top: '50%',
            left: -12,
            width: 8,
            height: 8,
            background: '#f97316',
            border: 'none',
            boxShadow: 'none',
          }}
          onMouseEnter={() => setHover('img-in')}
          onMouseLeave={() => setHover(null)}
        />
        <Handle
          className="tanva-beta-handle tanva-beta-handle-image"
          type="source"
          position={Position.Right}
          id="img"
          style={{
            top: '50%',
            right: -12,
            width: 8,
            height: 8,
            background: '#f97316',
            border: 'none',
            boxShadow: 'none',
          }}
          onMouseEnter={() => setHover('img-out')}
          onMouseLeave={() => setHover(null)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            // 触发创建新节点并连线的事件
            window.dispatchEvent(
              new CustomEvent('flow:duplicateAndConnect', {
                detail: {
                  sourceId: id,
                  sourceHandle: 'img',
                  targetHandle: 'img',
                  nodeType: 'generatePro',
                  offsetX: imageWidth + 100, // 水平偏移
                }
              })
            );
          }}
        />

        {hover === 'img-in' && (
          <div className="flow-tooltip" style={{
            position: 'absolute',
            left: -16,
            top: '50%',
            transform: 'translate(-100%, -50%)',
            zIndex: 10,
          }}>image</div>
        )}
        {hover === 'img-out' && (
          <div className="flow-tooltip" style={{
            position: 'absolute',
            right: -16,
            top: '50%',
            transform: 'translate(100%, -50%)',
            zIndex: 10,
          }}>image</div>
        )}
      </div>

      {/* 进度条区域 - 与文字框上缘对齐 */}
      <div style={{ height: 14, position: 'relative' }}>
        {status === 'running' && (
          <div style={{
            position: 'absolute',
            bottom: -6,
            left: 16,
            right: 16,
            zIndex: 10,
          }}>
            <GenerationProgressBar
              status={status}
              simulateDurationMs={60 * 1000}
              startedAt={data.progressStartedAt}
              runKey={id}
            />
          </div>
        )}
      </div>

      {/* 多个提示词输入框 - 带白色背景和圆角 */}
      {prompts.map((_prompt, index) => {
        const promptInput = promptInputs.bind(index);
        return (
        <div key={index} style={{ marginTop: index === 0 ? 0 : 8, position: 'relative' }}>
          <div
            className="group"
            style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              padding: '12px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              position: 'relative',
              minHeight: index === 0 ? promptHeight : undefined,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {index === 0 && externalPrompts.length > 0 && (
              <div className="tanva-agent-external-prompts" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {externalPrompts.map((extPrompt, extIndex) => (
                  <div
                    className="tanva-agent-external-prompt-chip"
                    key={extIndex}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      padding: '8px 10px',
                      background: '#f0f9ff',
                      borderRadius: 8,
                      border: '1px solid #bae6fd',
                    }}
                  >
                    <Link className="tanva-agent-external-prompt-icon" style={{ width: 14, height: 14, color: '#0ea5e9', flexShrink: 0, marginTop: 2 }} />
                    <span
                      className="tanva-agent-external-prompt-text"
                      style={{
                        fontSize: 13,
                        color: '#0369a1',
                        lineHeight: 1.4,
                        wordBreak: 'break-word',
                        maxHeight: 60,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {extPrompt.length > 100 ? `${extPrompt.slice(0, 100)}...` : extPrompt}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <textarea
              className="nodrag nopan nowheel"
              value={promptInput.value}
              onChange={promptInput.onChange}
              onCompositionStart={promptInput.onCompositionStart}
              onCompositionEnd={promptInput.onCompositionEnd}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onRun();
                }
              }}
              placeholder={index === 0
                ? (externalPrompts.length > 0 ? lt("输入额外提示词...", "Enter additional prompt...") : lt("输入提示词...", "Enter prompt..."))
                : lt("输入额外提示词...", "Enter additional prompt...")}
              style={{
                width: '100%',
                flex: 1,
                minHeight: 40,
                fontSize: 14,
                lineHeight: 1.5,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                resize: 'none',
                color: '#374151',
                paddingRight: prompts.length > 1 ? 24 : 0,
              }}
              onWheelCapture={(event) => {
                event.stopPropagation();
                (event.nativeEvent as Event & { stopImmediatePropagation?: () => void })?.stopImmediatePropagation?.();
              }}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
                (event.nativeEvent as Event & { stopImmediatePropagation?: () => void })?.stopImmediatePropagation?.();
              }}
              onMouseDownCapture={(event) => {
                event.stopPropagation();
                (event.nativeEvent as Event & { stopImmediatePropagation?: () => void })?.stopImmediatePropagation?.();
              }}
              onFocus={() => setIsTextFocused(true)}
              onBlur={() => setIsTextFocused(false)}
            />
            {/* 删除按钮 - 只有多个时显示，hover时才可见 */}
            {prompts.length > 1 && (
              <button
                onClick={() => removePrompt(index)}
                onPointerDownCapture={stopNodeDrag}
                className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                title={lt("删除此提示词", "Delete this prompt")}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
            {/* 底部拖拽条 - 仅第一个提示词框显示 */}
            {index === 0 && (
              <div
                className="nodrag"
                onMouseDown={handlePromptResizeStart}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 16,
                  right: 16,
                  height: 8,
                  cursor: 'ns-resize',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 3,
                    borderRadius: 2,
                    background: '#d1d5db',
                    opacity: 0.6,
                    transition: 'opacity 0.15s',
                  }}
                  className="group-hover:opacity-100"
                />
              </div>
            )}
          </div>

          {/* 第一个提示词框的 Handle */}
          {index === 0 && (
            <>
              <Handle
                className="tanva-beta-handle tanva-beta-handle-text"
                type="target"
                position={Position.Left}
                id="text"
                style={{
                  top: '50%',
                  left: -12,
                  width: 8,
                  height: 8,
                  background: '#22c55e',
                  border: 'none',
                  boxShadow: 'none',
                }}
                onMouseEnter={() => setHover('prompt-in')}
                onMouseLeave={() => setHover(null)}
              />
              <Handle
                className="tanva-beta-handle tanva-beta-handle-text"
                type="source"
                position={Position.Right}
                id="text"
                style={{
                  top: '50%',
                  right: -12,
                  width: 8,
                  height: 8,
                  background: '#22c55e',
                  border: 'none',
                  boxShadow: 'none',
                }}
                onMouseEnter={() => setHover('prompt-out')}
                onMouseLeave={() => setHover(null)}
              />

              {hover === 'prompt-in' && (
                <div className="flow-tooltip" style={{
                  position: 'absolute',
                  left: -16,
                  top: '50%',
                  transform: 'translate(-100%, -50%)',
                  zIndex: 10,
                }}>prompt</div>
              )}
              {hover === 'prompt-out' && (
                <div className="flow-tooltip" style={{
                  position: 'absolute',
                  right: -16,
                  top: '50%',
                  transform: 'translate(100%, -50%)',
                  zIndex: 10,
                }}>prompt</div>
              )}
            </>
          )}
        </div>
        );
      })}

      {responseText && (
        <div style={{ marginTop: 8, position: 'relative' }}>
          <div
            className='nodrag nopan nowheel'
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              padding: '10px 14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {lt('返回文字', 'Response')}
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: '#374151',
                whiteSpace: 'pre-wrap',
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              {responseText}
            </div>
          </div>

          <Handle
            className='tanva-beta-handle tanva-beta-handle-text'
            type='source'
            position={Position.Right}
            id='response-text'
            style={{
              top: '50%',
              right: -12,
              width: 8,
              height: 8,
              background: '#22c55e',
              border: 'none',
              boxShadow: 'none',
            }}
            onMouseEnter={() => setHover('response-out')}
            onMouseLeave={() => setHover(null)}
          />

          {hover === 'response-out' && (
            <div className='flow-tooltip' style={{
              position: 'absolute',
              right: -16,
              top: '50%',
              transform: 'translate(100%, -50%)',
              zIndex: 10,
            }}>{lt('返回文字', 'response text')}</div>
          )}
        </div>
      )}

      {/* 选中或文字聚焦时显示：添加提示词按钮和按钮组 */}
      {(selected || isTextFocused) && (
        <>
          {/* 添加提示词按钮 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginTop: 4,
              marginBottom: 4,
            }}
          >
            <button
              onClick={addPrompt}
              onPointerDownCapture={stopNodeDrag}
              className="text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
              title={lt("添加提示词", "Add prompt")}
              style={{
                padding: 0,
                background: 'transparent',
                border: 'none',
              }}
            >
              <Plus style={{ width: 12, height: 12 }} />
            </button>
          </div>

          {/* 按钮组 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div
              className="tanva-agent-toolbar inline-flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass"
            >
              {/* 长宽比选择按钮 - 仅 Pro 模式显示 */}
              {isProMode && (
                <div className="relative" ref={aspectMenuRef}>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsAspectMenuOpen(!isAspectMenuOpen);
                      setIsImageSizeMenuOpen(false);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={cn(
                      "tanva-agent-toolbar-btn p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center",
                      (isAspectMenuOpen || aspectRatioValue) ? "tanva-agent-toolbar-btn-active bg-gray-800 text-white border-gray-800" : ""
                    )}
                    title={aspectRatioValue ? `${lt('长宽比', 'Aspect ratio')}: ${aspectRatioValue}` : lt('选择长宽比', 'Select aspect ratio')}
                  >
                    <AspectRatioIcon style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              )}

              {/* HD 图像尺寸选择按钮 - 仅 Pro 模式显示 */}
              {isProMode && (
                <div className="relative" ref={imageSizeMenuRef}>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsImageSizeMenuOpen(!isImageSizeMenuOpen);
                      setIsAspectMenuOpen(false);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={cn(
                      "tanva-agent-toolbar-btn h-8 rounded-full border transition-all duration-200 px-2 text-[10px] font-medium inline-flex items-center justify-center min-w-[40px]",
                      imageSizeValue || isImageSizeMenuOpen
                        ? isFlowDark
                          ? "bg-[#1d1d1d] text-white border-[#404040] hover:bg-[#262626]"
                          : "bg-slate-900 text-white border-slate-900 hover:bg-slate-900"
                        : isFlowDark
                        ? "bg-[#252525]/95 border-[#404040] text-[#e5e7eb] hover:bg-[#2d2d2d]"
                        : "bg-white/50 border-gray-300 text-gray-700 hover:bg-gray-800/10 hover:border-gray-800/20"
                    )}
                    title={imageSizeValue ? `${lt('分辨率', 'Resolution')}: ${imageSizeValue}` : lt('选择分辨率', 'Select resolution')}
                  >
                    <span className="font-medium text-[10px] leading-none">
                      {imageSizeValue || 'HD'}
                    </span>
                  </button>
                </div>
              )}

              {isProMode && (
                <button
                  onClick={toggleWebSearch}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  className={cn(
                    "tanva-agent-toolbar-btn p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center",
                    enableWebSearch ? "tanva-agent-toolbar-btn-active bg-gray-800 text-white border-gray-800" : ""
                  )}
                  title={enableWebSearch ? lt('联网已开启', 'Web search enabled') : lt('联网已关闭', 'Web search disabled')}
                >
                  <Globe style={{ width: 14, height: 14 }} />
                </button>
              )}

              {/* Run 按钮 */}
              {status === 'running' ? (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    data.onStop?.(id);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  title="停止并重置，可重新生成"
                  className="tanva-agent-toolbar-btn p-0 h-8 w-8 rounded-full flex items-center justify-center"
                  style={{ background: "#111827", color: "#fff", border: "none", cursor: "pointer" }}
                >
                  <Square style={{ width: 12, height: 12 }} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRun();
                  }}
                  onMouseDown={(e) => {
                    // 阻止点击时节点失去选中状态
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  className="tanva-agent-toolbar-btn run-btn-with-credit p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center"
                  title={lt('运行生成', 'Run generation')}
                >
                  <span className='run-text-trigger'>
                    <Play style={{ width: 14, height: 14 }} />
                  </span>
                  <RunCreditBadge credits={resolvedRunCredits} runButton />
                </button>
              )}
            </div>

            {/* 长宽比水平选择栏 - 仅 Pro 模式显示 */}
            {isProMode && isAspectMenuOpen && (
              <div
                className="tanva-agent-toolbar-panel bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1.5 flex items-center gap-1"
              >
                {aspectOptions.map(opt => (
                  <button
                    key={opt.value || 'auto'}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateAspectRatio(opt.value);
                      setIsAspectMenuOpen(false);
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={cn(
                      "tanva-agent-toolbar-option px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap",
                      (aspectRatioValue === opt.value || (!aspectRatioValue && opt.value === ''))
                        ? "tanva-agent-toolbar-option-active bg-gray-800 text-white font-medium"
                        : "text-gray-700 hover:bg-gray-100"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {isProMode && isImageSizeMenuOpen && (
              <div
                className={cn(
                  "tanva-agent-toolbar-panel rounded-full shadow-lg px-2 py-1.5 flex items-center gap-1",
                  isFlowDark ? "bg-[#1e1e1e] border border-[#404040]" : "bg-white border border-gray-200"
                )}
              >
                {imageSizeOptions.map((opt) => (
                  <button
                    key={opt.value || 'auto'}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateImageSize(opt.value);
                      setIsImageSizeMenuOpen(false);
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={cn(
                      "tanva-agent-toolbar-option px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap border",
                      imageSizeValue === opt.value || (!imageSizeValue && opt.value === null)
                        ? isFlowDark
                          ? "bg-[#3a3a3a] text-white border-[#525252]"
                          : "bg-gray-100 text-gray-800 border-gray-200"
                        : isFlowDark
                        ? "text-[#e5e7eb] border-transparent hover:bg-white/10"
                        : "text-gray-700 border-transparent hover:bg-gray-100"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

          </div>
        </>
      )}

      {/* 状态和错误信息 */}
      {status === 'failed' && error && (
        <div style={{
          fontSize: 12,
          color: '#ef4444',
          marginTop: 8,
          whiteSpace: 'pre-wrap',
          padding: '8px 12px',
          background: '#fef2f2',
          borderRadius: 8,
        }}>
          {error}
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          previewOverrideSrc ||
          (allImages.length > 0 && currentImageId
            ? allImages.find(item => item.id === currentImageId)?.src || fullSrc || ''
            : fullSrc || '')
        }
        imageTitle={lt("全局图片预览", "Global image preview")}
        onClose={() => {
          setPreview(false);
          setPreviewOverrideValue('');
        }}
        imageCollection={previewOverrideSrc ? [] : allImages}
        currentImageId={previewOverrideSrc ? '' : currentImageId}
        onImageChange={(imageId: string) => {
          if (previewOverrideSrc) return;
          handleImageChange(imageId);
        }}
      />

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          items={[
            {
              label: lt('复制节点', 'Copy node'),
              icon: <Copy className="w-4 h-4" />,
              onClick: handleCopy,
            },
            {
              label: lt('删除节点', 'Delete node'),
              icon: <Trash2 className="w-4 h-4" />,
              onClick: handleDelete,
            },
            {
              label: lt('添加到库', 'Add to library'),
              icon: <FolderPlus className="w-4 h-4" />,
              onClick: handleAddToLibrary,
              disabled: !(data.imageData || data.imageUrl),
            },
            {
              label: lt('下载图片', 'Download image'),
              icon: <Download className="w-4 h-4" />,
              onClick: handleDownload,
              disabled: !(data.imageData || data.imageUrl),
            },
            {
              label: lt('发送到画板', 'Send to canvas'),
              icon: <SendIcon className="w-4 h-4" />,
              onClick: onSend,
              disabled: !(data.imageData || data.imageUrl),
            },
          ]}
        />
      )}
    </div>
  );
}

export default React.memo(GenerateProNodeInner);
