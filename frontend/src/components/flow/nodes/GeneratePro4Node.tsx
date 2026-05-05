import React from "react";
import {
  Handle,
  Position,
  useReactFlow,
  useStore,
  type Node as RFNode,
  type Node as FlowNode,
  type ReactFlowState,
} from "reactflow";
import { Play, Plus, X, Link, Copy, Trash2, Download, FolderPlus, Send as SendIcon, Check } from "lucide-react";
import ImagePreviewModal from "../../ui/ImagePreviewModal";
import SmartImage from "../../ui/SmartImage";
import { useAIChatStore } from "@/stores/aiChatStore";
import { cn } from "@/lib/utils";
import { resolveTextFromSourceNode } from "../utils/textSource";
import ContextMenu from "../../ui/context-menu";
import { toRenderableImageSrc } from "@/utils/imageSource";
import { useLocaleText } from "@/utils/localeText";
import { flowLetterboxBackground, FLOW_NODE_DARK_SURFACE } from "./flowNodeDarkTheme";
import RunCreditBadge from "./RunCreditBadge";
import NodeSelect from "./NodeSelect";
import { useImageNodeCreditsPreview } from "../hooks/useImageNodeCreditsPreview";
import { useImeSafeTextList } from "../hooks/useImeSafeTextInput";
import {
  getFlowImageReferenceLimit,
  resolveFlowModelProvider,
  type FlowModelProvider,
} from "@/utils/flowModelProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";

// 长宽比图标
const AspectRatioIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox='0 0 16 16'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    {...props}
  >
    <rect
      x='2'
      y='4'
      width='12'
      height='8'
      stroke='currentColor'
      strokeWidth='1.5'
      fill='none'
      rx='1'
    />
  </svg>
);

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    images?: string[];
    imageUrls?: string[];
    thumbnails?: string[]; // 缩略图
    error?: string;
    aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
    imageSize?: "1K" | "2K" | "4K" | null;
    prompts?: string[];
    imageWidth?: number;
    modelProvider?: FlowModelProvider;
    creditsPerCall?: number;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

const DEFAULT_IMAGE_WIDTH = 340;
const MIN_IMAGE_WIDTH = 200;
const MAX_IMAGE_WIDTH = 800;

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

const normalizeImageValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const readConnectedImageCountFromNode = (
  node: FlowNode,
  sourceHandle?: string | null
): number => {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const getStringAt = (list: unknown, idx: number): string | undefined => {
    if (!Array.isArray(list)) return undefined;
    return normalizeImageValue(list[idx]);
  };
  const hasImageAt = (idx: number): boolean =>
    Boolean(
      getStringAt(d.imageUrls, idx) ||
        getStringAt(d.images, idx) ||
        getStringAt(d.thumbnails, idx)
    );

  if (typeof sourceHandle === "string") {
    const singleMatch = /^img(\d+)$/.exec(sourceHandle);
    if (singleMatch) return hasImageAt(Math.max(0, Number(singleMatch[1]) - 1)) ? 1 : 0;
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
    let count = 0;
    for (let idx = 0; idx < max; idx += 1) {
      if (hasImageAt(idx)) count += 1;
    }
    return count;
  }

  return normalizeImageValue(d.imageData) ||
    normalizeImageValue(d.imageUrl) ||
    normalizeImageValue(d.outputImage) ||
    normalizeImageValue(d.inputImage) ||
    normalizeImageValue(d.inputImageUrl) ||
    normalizeImageValue(d.thumbnailDataUrl) ||
    normalizeImageValue(d.thumbnail)
    ? 1
    : 0;
};

// 构建图片 src - 优先使用 OSS URL，避免 proxy 降级
const buildImageSrc = (value?: string): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return toRenderableImageSrc(trimmed) || "";
};

function GeneratePro4NodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const { status, error } = data;
  const images = React.useMemo(() => data.images || [], [data.images]);
  const imageUrls = React.useMemo(() => data.imageUrls || [], [data.imageUrls]);
  const thumbnails = React.useMemo(() => data.thumbnails || [], [data.thumbnails]);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState(0);
  const [isTextFocused, setIsTextFocused] = React.useState(false);
  const [isAspectMenuOpen, setIsAspectMenuOpen] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const aspectMenuRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const promptBoxRef = React.useRef<HTMLDivElement>(null);
  const imageBoxRef = React.useRef<HTMLDivElement>(null);

  // 全局状态
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const chatTheme = useAIChatStore((state) => state.chatTheme);
  const isFlowDark = chatTheme === "black";
  const effectiveProvider = React.useMemo<FlowModelProvider>(
    () => resolveFlowModelProvider(data.modelProvider, aiProvider),
    [aiProvider, data.modelProvider]
  );
  const isProMode = true;
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
        description: lt("Nano Banana/Gemini 2.5", "Nano Banana/Gemini 2.5"),
      },
      {
        value: "banana",
        label: "Pro",
        description: lt("Nano Banana Pro+Gemini 3.0", "Nano Banana Pro+Gemini 3.0"),
      },
      {
        value: "banana-3.1",
        label: "Ultra",
        description: lt("Nano Banana 2/Gemini 3.1", "Nano Banana 2/Gemini 3.1"),
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
  const maxReferenceImages = React.useMemo(
    () => getFlowImageReferenceLimit(currentProviderValue),
    [currentProviderValue]
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
  const connectedInputImageCount = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edgeWithOrder = collectOrderedInputEdges(state.edges, id);
        if (edgeWithOrder.length === 0) return 0;

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

        let count = 0;
        for (let edgeIdx = 0; edgeIdx < edgeWithOrder.length; edgeIdx += 1) {
          const { edge } = edgeWithOrder[edgeIdx];
          const sourceNode = resolveSourceNode(edge.source);
          if (!sourceNode) continue;
          count += readConnectedImageCountFromNode(sourceNode, edge.sourceHandle);
        }
        return Math.min(count, maxReferenceImages);
      },
      [id, maxReferenceImages]
    )
  );

  // 检测外部文本连接
  const rf = useReactFlow();
  const [externalPrompts, setExternalPrompts] = React.useState<string[]>([]);
  const [externalSourceIds, setExternalSourceIds] = React.useState<string[]>([]);

  const refreshExternalPrompts = React.useCallback(
    (optimisticSource?: { sourceId: string; patch: Record<string, unknown> } | null) => {
      const currentEdges = rf.getEdges();
      const textEdges = currentEdges.filter((e) => e.target === id && e.targetHandle === "text");

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
          typeof optimisticSource.patch === "object"
        ) {
          sourceNode = {
            ...sourceNode,
            data: { ...(sourceNode.data as Record<string, unknown>), ...optimisticSource.patch },
          } as RFNode;
        }
        if (!sourceNode) continue;
        const resolved = resolveTextFromSourceNode(sourceNode, edge.sourceHandle);
        if (resolved && resolved.trim().length) prompts.push(resolved.trim());
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

  React.useEffect(() => {
    const handleEdgesChange = () => {
      refreshExternalPrompts();
    };
    window.addEventListener("flow:edgesChange", handleEdgesChange);
    return () => window.removeEventListener("flow:edgesChange", handleEdgesChange);
  }, [refreshExternalPrompts]);

  React.useEffect(() => {
    if (externalSourceIds.length === 0) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch?: Record<string, unknown> }>).detail;
      if (!detail?.id || !externalSourceIds.includes(detail.id)) return;
      if (detail.patch && typeof detail.patch === "object") {
        refreshExternalPrompts({ sourceId: detail.id, patch: detail.patch });
      } else {
        refreshExternalPromptsDeferred();
      }
    };
    window.addEventListener("flow:updateNodeData", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:updateNodeData",
        handler as EventListener
      );
  }, [externalSourceIds, refreshExternalPrompts, refreshExternalPromptsDeferred]);

  // 图片区域宽度
  const imageWidth = data.imageWidth || DEFAULT_IMAGE_WIDTH;

  // 提示词数组
  const prompts = React.useMemo(() => {
    const p = data.prompts || [""];
    return p.length > 0 ? p : [""];
  }, [data.prompts]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<Element, Event>)
      .nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  // 更新单个提示词
  const updatePrompt = React.useCallback(
    (index: number, value: string) => {
      const newPrompts = [...prompts];
      newPrompts[index] = value;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { prompts: newPrompts } },
        })
      );
    },
    [id, prompts]
  );
  const promptInputs = useImeSafeTextList(prompts, updatePrompt);

  // 添加新提示词
  const addPrompt = React.useCallback(() => {
    const newPrompts = [...prompts, ""];
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { prompts: newPrompts } },
      })
    );
  }, [id, prompts]);

  // 删除提示词
  const removePrompt = React.useCallback(
    (index: number) => {
      if (prompts.length <= 1) return;
      const newPrompts = prompts.filter((_, i) => i !== index);
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { prompts: newPrompts } },
        })
      );
    },
    [id, prompts]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 右键菜单处理
  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopy = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:copyNode', { detail: { nodeId: id } }));
  }, [id]);

  const handleDelete = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:deleteNode', { detail: { nodeId: id } }));
  }, [id]);

  const handleDownload = React.useCallback((index: number) => {
    const img = imageUrls[index] || images[index];
    if (!img) return;
    const src = buildImageSrc(img);
    const link = document.createElement('a');
    link.href = src;
    link.download = `generate_pro4_${id}_${index + 1}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [imageUrls, images, id]);

  const handleAddToLibrary = React.useCallback(() => {
    const firstImage = imageUrls[0] || images[0];
    if (!firstImage) return;
    window.dispatchEvent(new CustomEvent('flow:addToLibrary', {
      detail: { imageData: firstImage, nodeId: id, nodeType: 'generatePro4' }
    }));
  }, [imageUrls, images, id]);

  // 长宽比选项
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

  // 更新长宽比
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
  const imageSizeValue: '1K' | '2K' | '4K' =
    data.imageSize === '2K' || data.imageSize === '4K' ? data.imageSize : '1K';

  const imageSizeOptions: Array<{ label: string; value: '1K' | '2K' | '4K' }> = React.useMemo(() => {
    return [
      { label: '1K', value: '1K' },
      { label: '2K', value: '2K' },
      { label: '4K', value: '4K' },
    ];
  }, []);

  const updateImageSize = React.useCallback((size: '1K' | '2K' | '4K') => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { imageSize: size } }
      })
    );
  }, [id]);

  React.useEffect(() => {
    if (data.imageSize === imageSizeValue) return;
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { imageSize: imageSizeValue } }
      })
    );
  }, [data.imageSize, id, imageSizeValue]);

  const { credits: backendCredits } = useImageNodeCreditsPreview({
    nodeType: "generatePro",
    aiProvider: currentProviderValue,
    bananaImageRoute,
    imageSize: imageSizeValue,
    aspectRatio: aspectRatioValue || undefined,
    outputImageCount: 4,
    referenceImageCount: connectedInputImageCount,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview]);

  // 点击外部关闭长宽比菜单
  React.useEffect(() => {
    if (!isAspectMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        aspectMenuRef.current &&
        !aspectMenuRef.current.contains(e.target as Node)
      ) {
        setIsAspectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAspectMenuOpen]);

  // 角点拖拽调整大小
  const handleResizeStart = React.useCallback(
    (corner: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = imageWidth;
      let lastWidth = startWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let widthChange = 0;
        if (corner === "top-left") {
          widthChange = -Math.max(deltaX, deltaY);
        } else if (corner === "top-right") {
          widthChange = Math.max(deltaX, -deltaY);
        } else if (corner === "bottom-left") {
          widthChange = Math.max(-deltaX, deltaY);
        } else if (corner === "bottom-right") {
          widthChange = Math.max(deltaX, deltaY);
        }

        const newWidth = Math.max(
          MIN_IMAGE_WIDTH,
          Math.min(MAX_IMAGE_WIDTH, startWidth + widthChange)
        );
        const incrementalChange = newWidth - lastWidth;
        lastWidth = newWidth;

        if (incrementalChange === 0) return;

        const positionOffsetX = -incrementalChange / 2;
        const positionOffsetY = -incrementalChange / 2;

        window.dispatchEvent(
          new CustomEvent("flow:updateNodeData", {
            detail: {
              id,
              patch: {
                imageWidth: newWidth,
                _positionOffset: { x: positionOffsetX, y: positionOffsetY },
              },
            },
          })
        );
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [imageWidth, id]
  );

  // 预览用集合
  const previewCollection = React.useMemo(
    () =>
      (imageUrls.length ? imageUrls : images).map((value, i) => ({
        id: `${id}-${i}`,
        src: buildImageSrc(value),
        title: lt(`第 ${i + 1} 张`, `Image ${i + 1}`),
      })),
    [id, imageUrls, images, lt]
  );

  // 2x2 网格渲染单元
  const renderCell = (idx: number) => {
    const img = imageUrls[idx] || images[idx];
    const thumb = thumbnails[idx];
    const displaySrc = thumb ? buildImageSrc(thumb) : (img ? buildImageSrc(img) : "");
    // 并发模式：status 是 running 且这张图片还没有生成出来，都显示生成中
    const isGenerating = status === "running" && !img;
    return (
      <div
        key={idx}
        onDoubleClick={() => {
          if (img) {
            setPreviewIndex(idx);
            setPreview(true);
          }
        }}
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background: displaySrc
            ? "transparent"
            : isFlowDark
              ? FLOW_NODE_DARK_SURFACE.imageWellBg
              : "#f8f9fa",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          cursor: img ? "pointer" : "default",
        }}
        title={img ? lt("双击预览", "Double click to preview") : undefined}
      >
        {displaySrc ? (
          <SmartImage
            src={displaySrc}
            alt=''
            loading="lazy"
            decoding="async"
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: flowLetterboxBackground(isFlowDark),
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            {isGenerating ? lt("生成中...", "Generating...") : lt("空", "Empty")}
          </span>
        )}
        {/* 图片序号标签 */}
        <div
          style={{
            position: "absolute",
            left: 6,
            top: 6,
            fontSize: 10,
            color: isFlowDark ? "#d1d5db" : "#6b7280",
            background: isFlowDark ? "rgba(22,22,22,0.9)" : "rgba(255,255,255,0.85)",
            padding: "2px 6px",
            borderRadius: 4,
            fontWeight: 500,
          }}
        >
          {idx + 1}
        </div>
        {/* 单张图片底部进度条 - 并发模式下所有正在生成的图片都显示 */}
        {isGenerating && (
          <div
            style={{
              position: "absolute",
              bottom: 4,
              left: 4,
              right: 4,
              height: 4,
              background: "rgba(59, 130, 246, 0.2)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              className='generatepro4-progress-bar'
              style={{
                height: "100%",
                background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                borderRadius: 2,
                width: "30%",
              }}
            />
          </div>
        )}
      </div>
    );
  };

  // 角点样式
  const cornerStyle: React.CSSProperties = {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#3b82f6",
    cursor: "nwse-resize",
    zIndex: 20,
  };

  // 计算 Handle 的垂直位置（对应4张图片）
  const handlePositions = ["20%", "40%", "60%", "80%"];

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      style={{
        width: imageWidth + 24,
        background: "transparent",
        position: "relative",
        padding: "0 12px",
      }}
    >
      {/* 进度条动画样式 */}
      <style>{`
        @keyframes generatepro4-slide {
          0% { transform: translateX(0); }
          50% { transform: translateX(233%); }
          100% { transform: translateX(0); }
        }
        .generatepro4-progress-bar {
          animation: generatepro4-slide 1.2s ease-in-out infinite;
        }
      `}</style>
      {/* 图片区域容器 */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              onPointerDownCapture={stopNodeDrag}
              style={{
                height: 26,
                minWidth: 54,
                borderRadius: 999,
                padding: "0 10px",
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
                      const nextImageSize =
                        option.value === "banana-2.5"
                          ? "1K"
                          : data.imageSize === "2K" || data.imageSize === "4K"
                          ? data.imageSize
                          : "1K";
                      window.dispatchEvent(
                        new CustomEvent("flow:updateNodeData", {
                          detail: {
                            id,
                            patch: {
                              modelProvider: option.value,
                              imageSize: nextImageSize,
                            },
                          },
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

      <div ref={imageBoxRef} style={{ position: "relative" }}>
        {/* 选中时的蓝色边框 */}
        {selected && (
          <div
            style={{
              position: "absolute",
              top: -2,
              left: -2,
              right: -2,
              bottom: -2,
              border: "2px solid #3b82f6",
              borderRadius: 0,
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        )}

        {/* 2x2 图片网格区域 */}
        <div
          style={{
            position: "relative",
            width: imageWidth,
            background: isFlowDark ? FLOW_NODE_DARK_SURFACE.gridFrameBg : "#f8f9fa",
            borderRadius: 12,
            overflow: "hidden",
            padding: 8,
            border: isFlowDark ? `1px solid ${FLOW_NODE_DARK_SURFACE.imageWellBorder}` : undefined,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => renderCell(i))}
          </div>
        </div>

        {/* 选中时的四个角点 */}
        {selected && (
          <>
            <div
              className='nodrag'
              style={{
                ...cornerStyle,
                top: -5,
                left: -5,
                cursor: "nwse-resize",
              }}
              onMouseDown={handleResizeStart("top-left")}
            />
            <div
              className='nodrag'
              style={{
                ...cornerStyle,
                top: -5,
                right: -5,
                cursor: "nesw-resize",
              }}
              onMouseDown={handleResizeStart("top-right")}
            />
            <div
              className='nodrag'
              style={{
                ...cornerStyle,
                bottom: -5,
                left: -5,
                cursor: "nesw-resize",
              }}
              onMouseDown={handleResizeStart("bottom-left")}
            />
            <div
              className='nodrag'
              style={{
                ...cornerStyle,
                bottom: -5,
                right: -5,
                cursor: "nwse-resize",
              }}
              onMouseDown={handleResizeStart("bottom-right")}
            />
          </>
        )}

        {/* 左侧图片输入 Handle - 放在图像框中间 */}
        <Handle
          className='tanva-beta-handle tanva-beta-handle-image'
          type='target'
          position={Position.Left}
          id='img'
          style={{
            top: "50%",
            left: -12,
            width: 8,
            height: 8,
            background: "#f97316",
            border: "none",
            boxShadow: "none",
          }}
          onMouseEnter={() => setHover("img-in")}
          onMouseLeave={() => setHover(null)}
        />

        {/* 右侧4个输出 Handle，分别对应4张图片 */}
        {[1, 2, 3, 4].map((num, idx) => (
          <Handle
            className='tanva-beta-handle tanva-beta-handle-image'
            key={`img${num}`}
            type='source'
            position={Position.Right}
            id={`img${num}`}
            style={{
              top: handlePositions[idx],
              right: -12,
              width: 8,
              height: 8,
              background: "#f97316",
              border: "none",
              boxShadow: "none",
            }}
            onMouseEnter={() => setHover(`img${num}-out`)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {/* Handle 提示 - 图片输入 */}
        {hover === "img-in" && (
          <div
            className='flow-tooltip'
            style={{
              position: "absolute",
              left: -16,
              top: "50%",
              transform: "translate(-100%, -50%)",
              zIndex: 10,
            }}
          >
            image
          </div>
        )}
        {/* Handle 提示 - 图片输出 */}
        {[1, 2, 3, 4].map(
          (num, idx) =>
            hover === `img${num}-out` && (
              <div
                key={`tooltip-${num}`}
                className='flow-tooltip'
                style={{
                  position: "absolute",
                  right: -16,
                  top: handlePositions[idx],
                  transform: "translate(100%, -50%)",
                  zIndex: 10,
                }}
              >
                image#{num}
              </div>
            )
        )}
      </div>

      {/* 多个提示词输入框 */}
      {prompts.map((_prompt, index) => {
        const promptInput = promptInputs.bind(index);
        return (
        <div
          key={index}
          ref={index === 0 ? promptBoxRef : undefined}
          style={{ marginTop: 8, position: "relative" }}
        >
          <div
            className='group nodrag nopan'
            style={{
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #e5e7eb",
              padding: "12px 16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              position: "relative",
            }}
          >
            {/* 外部连接的提示词显示（仅第一个输入框展示） */}
            {index === 0 && externalPrompts.length > 0 && (
              <div
                className="tanva-agent-external-prompts"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {externalPrompts.map((externalPrompt, externalIndex) => (
                  <div
                    className="tanva-agent-external-prompt-chip"
                    key={externalIndex}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 6,
                      padding: "8px 10px",
                      background: "#f0f9ff",
                      borderRadius: 8,
                      border: "1px solid #bae6fd",
                    }}
                  >
                    <Link
                      className="tanva-agent-external-prompt-icon"
                      style={{
                        width: 14,
                        height: 14,
                        color: "#0ea5e9",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <span
                      className="tanva-agent-external-prompt-text"
                      style={{
                        fontSize: 13,
                        color: "#0369a1",
                        lineHeight: 1.4,
                        wordBreak: "break-word",
                        maxHeight: 60,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {externalPrompt.length > 100
                        ? `${externalPrompt.slice(0, 100)}...`
                        : externalPrompt}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <textarea
              className='nodrag nopan nowheel'
              value={promptInput.value}
              onChange={promptInput.onChange}
              onCompositionStart={promptInput.onCompositionStart}
              onCompositionEnd={promptInput.onCompositionEnd}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onRun();
                }
              }}
              placeholder={
                index === 0
                  ? externalPrompts.length > 0
                    ? lt("输入额外提示词（可选）...", "Enter additional prompt (optional)...")
                    : lt("输入提示词...", "Enter prompt...")
                  : lt("输入额外提示词（可选）...", "Enter additional prompt (optional)...")
              }
              rows={2}
              style={{
                width: "100%",
                fontSize: 14,
                lineHeight: 1.5,
                border: "none",
                outline: "none",
                background: "transparent",
                resize: "none",
                color: "#374151",
                paddingRight: prompts.length > 1 ? 24 : 0,
              }}
              onWheelCapture={(event) => {
                event.stopPropagation();
                (
                  event.nativeEvent as Event & {
                    stopImmediatePropagation?: () => void;
                  }
                )?.stopImmediatePropagation?.();
              }}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
                (
                  event.nativeEvent as Event & {
                    stopImmediatePropagation?: () => void;
                  }
                )?.stopImmediatePropagation?.();
              }}
              onMouseDownCapture={(event) => {
                event.stopPropagation();
                (
                  event.nativeEvent as Event & {
                    stopImmediatePropagation?: () => void;
                  }
                )?.stopImmediatePropagation?.();
              }}
              onFocus={() => setIsTextFocused(true)}
              onBlur={() => setIsTextFocused(false)}
              disabled={status === "running"}
            />

            {/* 删除按钮 - 只有多个时显示 */}
            {prompts.length > 1 && (
              <button
                onClick={() => removePrompt(index)}
                onPointerDownCapture={stopNodeDrag}
                className='absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100'
                title={lt('删除此提示词', 'Delete this prompt')}
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>

          {/* 第一个提示词框的 Handle */}
          {index === 0 && (
            <>
              <Handle
                className='tanva-beta-handle tanva-beta-handle-text'
                type='target'
                position={Position.Left}
                id='text'
                style={{
                  top: "50%",
                  left: -12,
                  width: 8,
                  height: 8,
                  background: "#22c55e",
                  border: "none",
                  boxShadow: "none",
                }}
                onMouseEnter={() => setHover("text-in")}
                onMouseLeave={() => setHover(null)}
              />
              <Handle
                className='tanva-beta-handle tanva-beta-handle-text'
                type='source'
                position={Position.Right}
                id='text'
                style={{
                  top: "50%",
                  right: -12,
                  width: 8,
                  height: 8,
                  background: "#22c55e",
                  border: "none",
                  boxShadow: "none",
                }}
                onMouseEnter={() => setHover("text-out")}
                onMouseLeave={() => setHover(null)}
              />

              {hover === "text-in" && (
                <div
                  className='flow-tooltip'
                  style={{
                    position: "absolute",
                    left: -16,
                    top: "50%",
                    transform: "translate(-100%, -50%)",
                    zIndex: 10,
                  }}
                >
                  prompt
                </div>
              )}
              {hover === "text-out" && (
                <div
                  className='flow-tooltip'
                  style={{
                    position: "absolute",
                    right: -16,
                    top: "50%",
                    transform: "translate(100%, -50%)",
                    zIndex: 10,
                  }}
                >
                  prompt
                </div>
              )}
            </>
          )}
        </div>
        );
      })}

      {/* 选中或文字聚焦时显示：添加提示词按钮和按钮组 */}
      {(selected || isTextFocused) && (
        <>
          {/* 添加提示词按钮 */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: 4,
              marginBottom: 4,
            }}
          >
            <button
              onClick={addPrompt}
              onPointerDownCapture={stopNodeDrag}
              className='text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors cursor-pointer'
              title={lt('添加提示词', 'Add prompt')}
              style={{
                padding: 0,
                background: "transparent",
                border: "none",
              }}
            >
              <Plus style={{ width: 12, height: 12 }} />
            </button>
          </div>

          {/* 按钮组 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
            }}
          >
          <div className='tanva-agent-toolbar inline-flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass'>
            {/* 长宽比选择按钮 - 仅 Pro 模式显示 */}
            {isProMode && (
              <div className='relative' ref={aspectMenuRef}>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsAspectMenuOpen(!isAspectMenuOpen);
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
                  title={aspectRatioValue ? `${lt('长宽比', 'Aspect ratio')}: ${aspectRatioValue}` : lt("选择长宽比", "Select aspect ratio")}
                >
                  <AspectRatioIcon style={{ width: 14, height: 14 }} />
                </button>
              </div>
            )}

            {/* HD 图像尺寸选择按钮 - 仅 Pro 模式显示 */}
            {isProMode && (
              <div className="relative">
                <NodeSelect
                  value={imageSizeValue}
                  options={imageSizeOptions.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                  }))}
                  onChange={(nextValue) =>
                    updateImageSize(nextValue === "2K" || nextValue === "4K" ? nextValue : "1K")
                  }
                  variant="compact"
                  align="center"
                  menuLabel={lt('分辨率', 'Resolution')}
                  title={imageSizeValue ? `${lt('分辨率', 'Resolution')}: ${imageSizeValue}` : lt('选择分辨率', 'Select resolution')}
                  className='min-w-[56px] justify-center'
                  contentClassName='min-w-[140px]'
                />
              </div>
            )}

            {/* Run 按钮 */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRun();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              disabled={status === "running"}
              onPointerDownCapture={stopNodeDrag}
              className='tanva-agent-toolbar-btn run-btn-with-credit p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed'
              title={status === "running" ? lt("生成中...", "Generating...") : lt("运行生成", "Run generation")}
            >
              <span className='run-text-trigger'>
                <Play style={{ width: 14, height: 14 }} />
              </span>
              <RunCreditBadge credits={resolvedRunCredits} runButton />
            </button>
          </div>

          {/* 长宽比水平选择栏 - 仅 Pro 模式显示 */}
          {isProMode && isAspectMenuOpen && (
            <div className='tanva-agent-toolbar-panel bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1.5 flex items-center gap-1'>
              {aspectOptions.map((opt) => (
                <button
                  key={opt.value || "auto"}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateAspectRatio(opt.value);
                    setIsAspectMenuOpen(false);
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  className={cn(
                    "tanva-agent-toolbar-option px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap",
                    aspectRatioValue === opt.value ||
                      (!aspectRatioValue && opt.value === "")
                      ? "tanva-agent-toolbar-option-active bg-gray-800 text-white font-medium"
                      : "text-gray-700 hover:bg-gray-100"
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
      {status === "failed" && error && (
        <div
          style={{
            fontSize: 12,
            color: "#ef4444",
            marginTop: 8,
            whiteSpace: "pre-wrap",
            padding: "8px 12px",
            background: "#fef2f2",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={previewCollection[previewIndex]?.src || ""}
        imageTitle={lt('四图预览', '4-image preview')}
        onClose={() => setPreview(false)}
        imageCollection={previewCollection}
        currentImageId={previewCollection[previewIndex]?.id}
        onImageChange={(imageId: string) => {
          const i = previewCollection.findIndex((it) => it.id === imageId);
          if (i >= 0) setPreviewIndex(i);
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
              disabled: !(images.length || imageUrls.length),
            },
            {
              label: lt('下载图片', 'Download image'),
              icon: <Download className="w-4 h-4" />,
              onClick: () => handleDownload(0),
              disabled: !(images.length || imageUrls.length),
            },
            {
              label: lt('发送到画板', 'Send to canvas'),
              icon: <SendIcon className="w-4 h-4" />,
              onClick: onSend,
              disabled: !(images.length || imageUrls.length),
            },
          ]}
        />
      )}
    </div>
  );
}

export default React.memo(GeneratePro4NodeInner);
