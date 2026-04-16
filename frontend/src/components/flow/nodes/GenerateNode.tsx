import React from "react";
import { Handle, Position, useStore, type Node as FlowNode, type ReactFlowState } from "reactflow";
import { Send as SendIcon, Check } from "lucide-react";
import ImagePreviewModal, { type ImageItem } from "../../ui/ImagePreviewModal";
import SmartImage from "../../ui/SmartImage";
import { useImageHistoryStore } from "../../../stores/imageHistoryStore";
import GenerationProgressBar from "./GenerationProgressBar";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { parseFlowImageAssetRef } from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { toRenderableImageSrc } from "@/utils/imageSource";
import { useAIChatStore } from "@/stores/aiChatStore";
import { useLocaleText } from "@/utils/localeText";
import { flowImagePreviewWell, flowLetterboxBackground } from "./flowNodeDarkTheme";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../../ui/dropdown-menu";
import RunCreditBadge from "./RunCreditBadge";
import NodeSelect from "./NodeSelect";
import { useImageNodeCreditsPreview } from "../hooks/useImageNodeCreditsPreview";
import { useFlowRenderMode } from "../FlowRenderModeContext";
import {
  getFlowModelProviderMode,
  resolveFlowModelProvider,
  type FlowModelProvider,
} from "@/utils/flowModelProvider";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    imageData?: string;
    imageUrl?: string;
    thumbnail?: string;
    error?: string;
    aspectRatio?:
      | "1:1"
      | "2:3"
      | "3:2"
      | "3:4"
      | "4:3"
      | "4:5"
      | "5:4"
      | "9:16"
      | "16:9"
      | "21:9"
      | "4:1"
      | "1:4"
      | "8:1"
      | "1:8";
    imageSize?: "0.5K" | "1K" | "2K" | "4K";
    presetPrompt?: string;
    creditsPerCall?: number;
    managedModelKey?: string;
    vendorKey?: string;
    platformKey?: string;
    modelProvider?: FlowModelProvider;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
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

// 构建图片 src - 优先使用 OSS URL，避免 proxy 降级
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toRenderableImageSrc(trimmed) || undefined;
};

const MAX_INPUT_PREVIEWS = 6;
const EMPTY_CONNECTED_INPUT_IMAGES: ConnectedInputImage[] = [];

type OrderedInputEdge = {
  edge: ReactFlowState["edges"][number];
  index: number;
};

const isImageInputHandle = (handle?: string | null): boolean => {
  if (!handle || handle === "img") return true;
  return /^img\d+$/.test(handle);
};

const imageInputHandleRank = (handle?: string | null): number => {
  if (!handle || handle === "img") return 0;
  const match = /^img(\d+)$/.exec(handle);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Number(match[1]) - 1);
};

const collectOrderedInputEdges = (
  edges: ReactFlowState["edges"],
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
const HIDDEN_SOURCE_HANDLE_STYLE: React.CSSProperties = {
  width: 1,
  height: 1,
  opacity: 0,
  border: "none",
  background: "transparent",
  pointerEvents: "none",
};

const normalizeImageValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
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
  if (!value || typeof value !== "object") return undefined;
  const crop = value as Record<string, unknown>;
  const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
  const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
  const width =
    typeof crop.width === "number" ? crop.width : Number(crop.width ?? 0);
  const height =
    typeof crop.height === "number" ? crop.height : Number(crop.height ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) {
    return undefined;
  }
  const sourceWidth =
    typeof crop.sourceWidth === "number"
      ? crop.sourceWidth
      : Number(crop.sourceWidth ?? 0);
  const sourceHeight =
    typeof crop.sourceHeight === "number"
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

  if (typeof sourceHandle === "string") {
    const singleMatch = /^img(\d+)$/.exec(sourceHandle);
    if (singleMatch) {
      const idx = Math.max(0, Number(singleMatch[1]) - 1);
      return pickAt(idx);
    }

    const splitMatch = /^image(\d+)$/.exec(sourceHandle);
    if (splitMatch) {
      const idx = Math.max(0, Number(splitMatch[1]) - 1);
      const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
      const rect = splitRects[idx];
      const rectRecord =
        rect && typeof rect === "object" ? (rect as Record<string, unknown>) : {};
      const x = typeof rectRecord.x === "number" ? rectRecord.x : Number(rectRecord.x ?? 0);
      const y = typeof rectRecord.y === "number" ? rectRecord.y : Number(rectRecord.y ?? 0);
      const width =
        typeof rectRecord.width === "number"
          ? rectRecord.width
          : Number(rectRecord.width ?? 0);
      const height =
        typeof rectRecord.height === "number"
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
          typeof d.sourceWidth === "number" ? d.sourceWidth : Number(d.sourceWidth ?? 0);
        const sourceHeight =
          typeof d.sourceHeight === "number" ? d.sourceHeight : Number(d.sourceHeight ?? 0);
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
        legacyCandidate && typeof legacyCandidate === "object"
          ? normalizeImageValue((legacyCandidate as { imageData?: unknown }).imageData)
          : undefined;
      const value = direct || legacy;
      return value
        ? [{ id: `${node.id}-image${idx + 1}`, imageData: value, thumbnailData: value }]
        : [];
    }
  }

  if (
    typeof sourceHandle === "string" &&
    (sourceHandle === "images" || sourceHandle.startsWith("images-"))
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

  // 优先使用运行时当前渲染资源（imageData/inputImage），保证连线缩略图即时更新
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 44;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.round(size * dpr));
    canvas.height = Math.max(1, Math.round(size * dpr));
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    if (!src) {
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, size, size);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) return;
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      if (!naturalW || !naturalH) {
        ctx.fillStyle = "#f3f4f6";
        ctx.fillRect(0, 0, size, size);
        return;
      }

      const srcW =
        typeof crop.sourceWidth === "number" && crop.sourceWidth > 0
          ? crop.sourceWidth
          : naturalW;
      const srcH =
        typeof crop.sourceHeight === "number" && crop.sourceHeight > 0
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
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    };
    img.onerror = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#f3f4f6";
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
          display: "block",
          width: 44,
          height: 44,
          background: "#e5e7eb",
        }}
      />
    );
  }

  return <canvas ref={canvasRef} style={{ display: "block", width: 44, height: 44 }} />;
}

function InputImageThumb({
  value,
  order,
  lt,
  crop,
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
}) {
  const assetId = React.useMemo(() => parseFlowImageAssetRef(value), [value]);
  const assetUrl = useFlowImageAssetUrl(assetId);
  const src = assetId ? (assetUrl || undefined) : buildImageSrc(value);

  return (
    <div
      style={{
        position: "relative",
        width: 44,
        height: 44,
        flexShrink: 0,
      }}
      title={lt(`输入图 ${order}`, `Input ${order}`)}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid #d1d5db",
        background: "#f8fafc",
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
              width: "100%",
              height: "100%",
              objectFit: "cover",
              background: "#fff",
            }}
          />
        )
      ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: 4,
          top: 4,
          width: 14,
          height: 14,
          borderRadius: "999px",
          background: "#111827",
          color: "#fff",
          fontSize: 9,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid #fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.28)",
          lineHeight: 1,
          zIndex: 2,
        }}
      >
        {order}
      </div>
    </div>
  );
}

function GenerateNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const { status, error } = data;
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const chatTheme = useAIChatStore((state) => state.chatTheme);
  const isFlowDark = chatTheme === "black";
  const effectiveProvider = React.useMemo<FlowModelProvider>(
    () => resolveFlowModelProvider(data.modelProvider, aiProvider),
    [aiProvider, data.modelProvider]
  );
  const rawFullValue = data.imageUrl || data.imageData;
  const fullAssetId = React.useMemo(() => parseFlowImageAssetRef(rawFullValue), [rawFullValue]);
  const fullAssetUrl = useFlowImageAssetUrl(fullAssetId);
  const fullSrc = fullAssetId ? (fullAssetUrl || undefined) : buildImageSrc(rawFullValue);

  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(() => parseFlowImageAssetRef(rawThumbValue), [rawThumbValue]);
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const displaySrc = thumbAssetId ? (thumbAssetUrl || fullSrc) : (buildImageSrc(rawThumbValue) || fullSrc);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>("");
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  // 使用全局图片历史记录
  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const projectHistory = React.useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);
  const allImages = React.useMemo(
    () =>
      projectHistory.map(
        (item) =>
          ({
            id: item.id,
            src: item.src,
            title: item.title,
            timestamp: item.timestamp,
          } as ImageItem)
      ),
    [projectHistory]
  );

  const connectedInputImages = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edgeWithOrder = collectOrderedInputEdges(state.edges, id);
        if (edgeWithOrder.length === 0) return EMPTY_CONNECTED_INPUT_IMAGES;

        const nodeLookup = (
          state as ReactFlowState & { nodeLookup?: Map<string, FlowNode> }
        ).nodeLookup;
        const hasNodeLookup =
          nodeLookup && typeof nodeLookup.get === "function";
        const fallbackNodes = hasNodeLookup
          ? null
          : ((state as ReactFlowState & { nodes?: FlowNode[] }).nodes ||
            state.getNodes());
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
            if (out.length >= MAX_INPUT_PREVIEWS) {
              return out;
            }
          }
        }

        return out;
      },
      [id]
    )
  );

  const updateAspectRatio = React.useCallback(
    (ratio: string) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              aspectRatio: ratio || undefined,
            },
          },
        })
      );
    },
    [id]
  );

  const aspectRatioValue = data.aspectRatio ?? "";
  const imageSizeValue = data.imageSize ?? "";
  const aspectOptions: Array<{ label: string; value: string }> = React.useMemo(
    () => [
      { label: lt("自动", "Auto"), value: "" },
      { label: "1:1", value: "1:1" },
      { label: "3:4", value: "3:4" },
      { label: "4:3", value: "4:3" },
      { label: "2:3", value: "2:3" },
      { label: "3:2", value: "3:2" },
      { label: "4:5", value: "4:5" },
      { label: "5:4", value: "5:4" },
      { label: "9:16", value: "9:16" },
      { label: "16:9", value: "16:9" },
      { label: "21:9", value: "21:9" },
    ],
    [lt]
  );

  const providerMode = React.useMemo(
    () => getFlowModelProviderMode(effectiveProvider),
    [effectiveProvider]
  );

  type ProviderToggleValue = "banana-2.5" | "banana" | "banana-3.1";
  const providerToggleOptions = React.useMemo<Array<{
    value: ProviderToggleValue;
    label: string;
    description: string;
  }>>(
    () => [
      {
        value: "banana-2.5",
        label: "Fast",
        description: lt("Nano Banana+Gemini 2.5", "Nano Banana+Gemini 2.5"),
      },
      {
        value: "banana",
        label: "Pro",
        description: lt("Nano Banana Pro+Gemini 3.0", "Nano Banana Pro+Gemini 3.0"),
      },
      {
        value: "banana-3.1",
        label: "Ultra",
        description: lt("Nano Banana 2+Gemini 3.1", "Nano Banana 2+Gemini 3.1"),
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

  const showAspectRatioSelector = true;
  const showImageSizeSelector = true;
  const showSizeControls = showAspectRatioSelector || showImageSizeSelector;
  const showTextOutputHandle = providerMode === "ultra";

  const imageSizeOptions: Array<{ label: string; value: string }> = React.useMemo(() => {
    const autoOption = { label: lt("自动", "Auto"), value: "" };
    const base = [
      autoOption,
      { label: "1K", value: "1K" },
      { label: "2K", value: "2K" },
      { label: "4K", value: "4K" },
    ];
    if (providerMode === "fast") {
      return [autoOption, { label: "1K", value: "1K" }];
    }
    if (providerMode === "ultra") {
      return [
        autoOption,
        { label: "0.5K", value: "0.5K" },
        { label: "1K", value: "1K" },
        { label: "2K", value: "2K" },
        { label: "4K", value: "4K" },
      ];
    }
    return base;
  }, [lt, providerMode]);

  const { credits: backendCredits } = useImageNodeCreditsPreview({
    nodeType: "generate",
    aiProvider: currentProviderValue,
    bananaImageRoute,
    imageSize: imageSizeValue || undefined,
    aspectRatio: aspectRatioValue || undefined,
    referenceImageCount: connectedInputImages.length,
    managedModelKey: data.managedModelKey,
    vendorKey: data.vendorKey,
    platformKey: data.platformKey,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<Element, Event>)
      .nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const updateImageSize = React.useCallback(
    (size: string) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              imageSize: size || undefined,
            },
          },
        })
      );
    },
    [id]
  );

  const presetPromptValue = data.presetPrompt ?? "";
  const updatePresetPrompt = React.useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { presetPrompt: value } },
        })
      );
    },
    [id]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 处理图片切换
  const handleImageChange = React.useCallback(
    (imageId: string) => {
      const selectedImage = allImages.find((item) => item.id === imageId);
      if (selectedImage) {
        setCurrentImageId(imageId);
        // 这里可以选择是否更新节点的图片数据
        // 暂时只更新预览，不更新节点数据
      }
    },
    [allImages]
  );

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview]);

  React.useEffect(() => {
    if (showTextOutputHandle) return;
    setHover((prev) => (prev === "prompt-out" ? null : prev));
  }, [showTextOutputHandle]);

  return (
    <div
      style={{
        width: 260,
        padding: 8,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Generate</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onPointerDownCapture={stopNodeDrag}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                className='nodrag nopan tanva-flow-provider-mode-badge'
                title={lt("切换模型模式", "Switch model mode")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "1px 8px",
                  borderRadius: 50,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  ...(chatTheme === "black"
                    ? {
                        color: "#ffffff",
                        background: "#343434",
                        border: "1px solid #4a4a4a",
                      }
                    : {
                        color:
                          currentProviderValue === "banana-3.1"
                            ? "#0f172a"
                            : "#475569",
                        background:
                          currentProviderValue === "banana-3.1"
                            ? "#e2e8f0"
                            : "#f1f5f9",
                        border: "1px solid #e2e8f0",
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
                {lt("模型切换", "Model switch")}
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
                          new CustomEvent("flow:updateNodeData", {
                            detail: { id, patch: { modelProvider: option.value } },
                          })
                        );
                      }
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                      isActive ? "bg-gray-100 text-gray-800" : "text-slate-600"
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onRun}
            disabled={status === "running"}
            className='run-btn-with-credit'
            style={{
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              minHeight: 30,
              padding: "0 10px",
              background: status === "running" ? "#e5e7eb" : "#111827",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: status === "running" ? "not-allowed" : "pointer",
              gap: 6,
            }}
            title={
              status === "running"
                ? lt("生成中...", "Generating...")
                : resolvedRunCredits
                ? `${lt("本次消耗", "Cost")}: ${resolvedRunCredits} ${lt(
                    "积分",
                    "credits"
                  )}`
                : lt("运行生成", "Run generation")
            }
          >
            {status === "running" ? (
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
          <button
            onClick={onSend}
            disabled={!(data.imageData || data.imageUrl)}
            title={!(data.imageData || data.imageUrl) ? lt("无可发送的图像", "No image to send") : lt("发送到画布", "Send to canvas")}
            style={{
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              width: 34,
              height: 30,
              padding: 0,
              background: !(data.imageData || data.imageUrl) ? "#e5e7eb" : "#111827",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: !(data.imageData || data.imageUrl) ? "not-allowed" : "pointer",
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <label
          style={{
            display: "block",
            fontSize: 12,
            color: "#6b7280",
            marginBottom: 2,
          }}
        >
          {lt("预设提示词", "Preset prompt")}
        </label>
        <input
          value={presetPromptValue}
          onChange={(event) => updatePresetPrompt(event.target.value)}
          placeholder={lt('生成时自动拼接在提示词前', 'Auto-prepended before the prompt during generation')}
          style={{
            width: "100%",
            fontSize: 12,
            padding: "4px 6px",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            outline: "none",
            background: "#fff",
          }}
          onPointerDownCapture={stopNodeDrag}
          onPointerDown={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onMouseDown={stopNodeDrag}
        />
        {connectedInputImages.length > 0 && (
          <div
            className='nodrag nopan nowheel'
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              overflowX: "auto",
              paddingBottom: 2,
              marginTop: 8,
            }}
            title={lt("输入图顺序会影响融合效果", "Input order affects blending")}
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
              />
            ))}
          </div>
        )}
      </div>
      {showSizeControls && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent:
              showAspectRatioSelector && showImageSizeSelector
                ? "space-between"
                : "flex-start",
            marginBottom: 6,
          }}
        >
          {showAspectRatioSelector && (
            <label
              className='nodrag nopan'
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              {lt("尺寸", "Aspect")}
              <select
                value={aspectRatioValue}
                onChange={(e) => updateAspectRatio(e.target.value)}
                onPointerDown={stopNodeDrag}
                onPointerDownCapture={stopNodeDrag}
                onMouseDown={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                onClick={stopNodeDrag}
                onClickCapture={stopNodeDrag}
                className='nodrag nopan'
                style={{
                  fontSize: 12,
                  padding: "2px 6px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  color: "#111827",
                }}
              >
                {aspectOptions.map((opt) => (
                  <option key={opt.value || "auto"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showImageSizeSelector && (
            <label
              className='nodrag nopan'
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
	              {lt("分辨率", "Resolution")}
	              <NodeSelect
	                value={imageSizeValue}
	                options={imageSizeOptions.map((opt) => ({
	                  value: opt.value,
	                  label: opt.label,
	                }))}
	                onChange={updateImageSize}
	                menuLabel={lt("分辨率", "Resolution")}
	                title={lt("选择分辨率", "Select resolution")}
	                className='min-w-[96px]'
	                contentClassName='min-w-[140px]'
	              />
	            </label>
          )}
        </div>
      )}
      <div
        onDoubleClick={() => fullSrc && setPreview(true)}
        style={{
          width: "100%",
          height: 160,
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          ...flowImagePreviewWell(isFlowDark, {
            background: "#fff",
            border: "1px solid #eef0f2",
          }),
        }}
        title={displaySrc ? lt("双击预览", "Double click to preview") : undefined}
      >
        {displaySrc ? (
          <SmartImage
            src={displaySrc}
            alt=''
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: flowLetterboxBackground(isFlowDark),
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{lt("等待生成", "Waiting for generation")}</span>
        )}
      </div>
      <GenerationProgressBar status={status} simulateDurationMs={60 * 1000} />
      {status === "failed" && error && (
        <div
          style={{
            fontSize: 12,
            color: "#ef4444",
            marginTop: 4,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {/* 输入：img 在上，text 在下；输出：img、text */}
      <Handle
        type='target'
        position={Position.Left}
        id='img'
        style={{ top: "35%" }}
        onMouseEnter={() => setHover("img-in")}
        onMouseLeave={() => setHover(null)}
      />
      {/* 兼容历史多图输入句柄，避免旧连线 targetHandle=img2/img3... 报错 */}
      {["img2", "img3", "img4", "img5", "img6"].map((legacyHandleId) => (
        <Handle
          key={legacyHandleId}
          type='target'
          position={Position.Left}
          id={legacyHandleId}
          style={{
            top: "35%",
            width: 1,
            height: 1,
            opacity: 0,
            border: "none",
            background: "transparent",
            pointerEvents: "none",
          }}
        />
      ))}
      <Handle
        type='target'
        position={Position.Left}
        id='text'
        style={{ top: "65%" }}
        onMouseEnter={() => setHover("prompt-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='img'
        style={{ top: "35%" }}
        onMouseEnter={() => setHover("img-out")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='text'
        style={{ top: "65%", ...(showTextOutputHandle ? null : HIDDEN_SOURCE_HANDLE_STYLE) }}
        onMouseEnter={() => setHover("prompt-out")}
        onMouseLeave={() => setHover(null)}
      />

      {hover === "img-in" && (
        <div
          className='flow-tooltip'
          style={{ left: -8, top: "35%", transform: "translate(-100%, -50%)" }}
        >
          image
        </div>
      )}
      {hover === "prompt-in" && (
        <div
          className='flow-tooltip'
          style={{ left: -8, top: "65%", transform: "translate(-100%, -50%)" }}
        >
          prompt
        </div>
      )}
      {hover === "img-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "35%", transform: "translate(100%, -50%)" }}
        >
          image
        </div>
      )}
      {showTextOutputHandle && hover === "prompt-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "65%", transform: "translate(100%, -50%)" }}
        >
          prompt
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src ||
              fullSrc ||
              ""
            : fullSrc || ""
        }
        imageTitle={lt('全局图片预览', 'Global image preview')}
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
    </div>
  );
}

export default React.memo(GenerateNodeInner);
