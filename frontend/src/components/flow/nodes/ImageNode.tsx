// @ts-nocheck
import React from "react";
import { Handle, Position, useReactFlow, useStore, type ReactFlowState } from "reactflow";
import { NodeResizeControl } from "@reactflow/node-resizer";
import ImagePreviewModal, { type ImageItem } from "../../ui/ImagePreviewModal";
import SmartImage from "../../ui/SmartImage";
import { useImageHistoryStore } from "../../../stores/imageHistoryStore";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { imageUploadService } from "@/services/imageUploadService";
import { generateOssKey } from "@/services/ossUploadService";
import {
  deleteFlowImage,
  parseFlowImageAssetRef,
  putFlowImageBlobs,
  toFlowImageAssetRef,
} from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { shallow } from "zustand/shallow";

const RESIZE_EDGE_THICKNESS = 8;

const lineControlConfigs = [
  {
    position: "top",
    icon: "↕",
    style: {
      top: 0,
      bottom: "auto",
      left: 0,
      right: "auto",
      width: "100%",
      height: RESIZE_EDGE_THICKNESS,
      transform: "none",
      cursor: "ns-resize",
      pointerEvents: "auto",
    },
  },
  {
    position: "bottom",
    icon: "↕",
    style: {
      top: "auto",
      bottom: 0,
      left: 0,
      right: "auto",
      width: "100%",
      height: RESIZE_EDGE_THICKNESS,
      transform: "none",
      cursor: "ns-resize",
      pointerEvents: "auto",
    },
  },
];

const handleControlConfigs = [
  {
    position: "top-left",
    icon: "⤡",
    style: {
      width: 20,
      height: 20,
      pointerEvents: "auto",
      cursor: "nwse-resize",
    },
  },
  {
    position: "top-right",
    icon: "⤢",
    style: {
      width: 20,
      height: 20,
      pointerEvents: "auto",
      cursor: "nesw-resize",
    },
  },
  {
    position: "bottom-left",
    icon: "⤢",
    style: {
      width: 20,
      height: 20,
      pointerEvents: "auto",
      cursor: "nesw-resize",
    },
  },
  {
    position: "bottom-right",
    icon: "⤡",
    style: {
      width: 20,
      height: 20,
      pointerEvents: "auto",
      cursor: "nwse-resize",
    },
  },
];

type Props = {
  id: string;
  data: {
    imageData?: string;
    imageUrl?: string;
    thumbnail?: string;
    label?: string;
    boxW?: number;
    boxH?: number;
    imageName?: string;
    crop?: {
      x: number;
      y: number;
      width: number;
      height: number;
      sourceWidth?: number;
      sourceHeight?: number;
    };
  };
  selected?: boolean;
};

const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("data:image")) return trimmed;
  if (trimmed.startsWith("blob:")) return trimmed;
  if (trimmed.startsWith("/api/assets/proxy") || trimmed.startsWith("/assets/proxy")) {
    return proxifyRemoteAssetUrl(trimmed);
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return trimmed;
  }
  if (/^(templates|projects|uploads|videos)\//i.test(trimmed)) {
    return proxifyRemoteAssetUrl(
      `/api/assets/proxy?key=${encodeURIComponent(trimmed.replace(/^\/+/, ""))}`
    );
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return proxifyRemoteAssetUrl(trimmed);
  return `data:image/png;base64,${trimmed}`;
};

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const MAX_IMAGE_NAME_LENGTH = 28;

const CanvasCropPreview = React.memo(({
  src,
  rect,
  sourceWidth,
  sourceHeight,
  isResizing,
}: {
  src: string;
  rect: { x: number; y: number; width: number; height: number };
  sourceWidth?: number;
  sourceHeight?: number;
  isResizing?: boolean;
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

    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      try { ro?.disconnect(); } catch {}
    };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = size.w;
    const h = size.h;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    const drawPlaceholder = () => {
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, w, h);
    };

    if (!src || !rect || rect.width <= 0 || rect.height <= 0 || w <= 0 || h <= 0) {
      drawPlaceholder();
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.decoding = "async";

    const onLoad = () => {
      if (cancelled) return;
      const naturalW = img.naturalWidth || img.width;
      const naturalH = img.naturalHeight || img.height;
      if (!naturalW || !naturalH) {
        drawPlaceholder();
        return;
      }

      const srcW = typeof sourceWidth === "number" && sourceWidth > 0 ? sourceWidth : naturalW;
      const srcH = typeof sourceHeight === "number" && sourceHeight > 0 ? sourceHeight : naturalH;

      const scaleX = srcW > 0 ? naturalW / srcW : 1;
      const scaleY = srcH > 0 ? naturalH / srcH : 1;

      const sxRaw = rect.x * scaleX;
      const syRaw = rect.y * scaleY;
      const exRaw = (rect.x + rect.width) * scaleX;
      const eyRaw = (rect.y + rect.height) * scaleY;

      // 像素对齐：避免在等比缩放时取样到裁剪边缘外，产生白边/透明边
      const sx = Math.max(0, Math.min(naturalW - 1, Math.floor(sxRaw)));
      const sy = Math.max(0, Math.min(naturalH - 1, Math.floor(syRaw)));
      const ex = Math.max(sx + 1, Math.min(naturalW, Math.ceil(exRaw)));
      const ey = Math.max(sy + 1, Math.min(naturalH, Math.ceil(eyRaw)));
      const sw = Math.max(1, ex - sx);
      const sh = Math.max(1, ey - sy);

      // contain：画布尺寸等于实际渲染尺寸，避免把留白画进 canvas（右键保存/导出会带白边）
      const fit = Math.min(w / sw, h / sh);
      const dw = Math.max(1, Math.round(sw * fit));
      const dh = Math.max(1, Math.round(sh * fit));

      canvas.style.width = `${dw}px`;
      canvas.style.height = `${dh}px`;
      canvas.width = Math.max(1, Math.round(dw * dpr));
      canvas.height = Math.max(1, Math.round(dh * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, dw, dh);
      ctx.fillStyle = "#ffffff";
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
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          background: "#fff",
          transform: isResizing ? "translateZ(0)" : undefined,
        }}
      />
    </div>
  );
});

const ImageContent = React.memo(({ displaySrc, canvasCrop, isResizing, uploading, uploadError, onDrop, onDragOver, onDoubleClick }: {
  displaySrc?: string;
  isResizing?: boolean;
  uploading?: boolean;
  uploadError?: string;
  canvasCrop?: {
    src: string;
    rect: { x: number; y: number; width: number; height: number };
    sourceWidth?: number;
    sourceHeight?: number;
  };
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDoubleClick: () => void;
}) => (
  <div
    onDrop={onDrop}
    onDragOver={onDragOver}
    onDoubleClick={onDoubleClick}
    onClick={() => {}}
    style={{
      flex: 1,
      minHeight: 120,
      background: "#fff",
      borderRadius: 6,
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      border: "1px solid #e5e7eb",
      cursor: "pointer",
    }}
    title='拖拽图片到此或双击上传'
  >
    {Boolean(uploading) && (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          background: "rgba(255,255,255,0.6)",
          zIndex: 10,
          fontSize: 12,
          color: "#374151",
        }}
      >
        正在上传…
      </div>
    )}
    {!uploading && uploadError ? (
      <div
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          bottom: 8,
          zIndex: 10,
          pointerEvents: "none",
          fontSize: 12,
          color: "#b91c1c",
          background: "rgba(255,255,255,0.9)",
          border: "1px solid #fecaca",
          borderRadius: 6,
          padding: "6px 8px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={uploadError}
      >
        上传失败：{uploadError}
      </div>
    ) : null}
    {canvasCrop ? (
      <CanvasCropPreview
        src={canvasCrop.src}
        rect={canvasCrop.rect}
        sourceWidth={canvasCrop.sourceWidth}
        sourceHeight={canvasCrop.sourceHeight}
        isResizing={isResizing}
      />
    ) : displaySrc ? (
      <SmartImage
        src={displaySrc}
        alt=''
        decoding="async"
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#fff",
          transform: isResizing ? "translateZ(0)" : undefined,
        }}
      />
    ) : (
      <span style={{ fontSize: 12, color: "#9ca3af" }}>
        拖拽图片到此或双击上传
      </span>
    )}
  </div>
));

function ImageNodeInner({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const hasInputConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.some(
          (edge) => edge.target === id && edge.targetHandle === "img"
        ),
      [id]
    )
  );

  // 从连接的节点读取图片（支持 imageGrid / videoFrameExtract / image 的链式传递）
  const connectedFrameImage = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edges = state.edges || [];
        const nodes = state.getNodes();
        const nodeById = new Map(nodes.map((n) => [n.id, n]));

        const resolveFromNode = (
          nodeId: string,
          incomingEdge?: any,
          visited: Set<string> = new Set()
        ): string | undefined => {
          if (!nodeId) return undefined;
          if (visited.has(nodeId)) return undefined;
          visited.add(nodeId);

          const node = nodeById.get(nodeId);
          if (!node) return undefined;

          const nodeData = node.data || {};

          // imageGrid 节点 - 读取拼合后的图片
          if (node.type === "imageGrid") {
            const outputImage = nodeData.outputImage as string | undefined;
            return outputImage || undefined;
          }

          // videoFrameExtract 节点 - 读取单帧图片
          if (node.type === "videoFrameExtract" && incomingEdge?.sourceHandle === "image") {
            const frames = nodeData.frames as
              | Array<{ index: number; imageUrl: string; thumbnailDataUrl?: string }>
              | undefined;
            if (!frames || frames.length === 0) return undefined;

            const selectedFrameIndex = (nodeData.selectedFrameIndex ?? 1) as number;
            const idx = selectedFrameIndex - 1;
            const frame = frames[idx];
            if (!frame) return undefined;

          // 节点展示优先使用缩略图（thumbnailDataUrl）；链路传递的“原图优先”在下游节点的解析里处理
          return frame.thumbnailDataUrl || frame.imageUrl;
        }

          // Image 节点 - 优先使用节点自身的图片，其次才回溯上游
          if (node.type === "image" || node.type === "imagePro") {
            const direct =
              (nodeData.imageData as string | undefined) ||
              (nodeData.imageUrl as string | undefined) ||
              (nodeData.thumbnail as string | undefined);
            if (direct) return direct || undefined;

            const upstream = edges.find(
              (e) => e.target === nodeId && e.targetHandle === "img"
            );
            const upstreamResolved = upstream
              ? resolveFromNode(upstream.source, upstream, visited)
              : undefined;
            if (upstreamResolved) return upstreamResolved;
          }

          // 兜底：尽量兼容其他输出图片的节点
          const fallback =
            (nodeData.outputImage as string | undefined) ||
            (nodeData.imageData as string | undefined) ||
            (nodeData.imageUrl as string | undefined) ||
            (nodeData.thumbnail as string | undefined) ||
            (nodeData.img as string | undefined) ||
            (nodeData.image as string | undefined);
          return fallback || undefined;
        };

        // 查找连接到 img 输入句柄的边
        const edgeToThis = edges.find(
          (e) => e.target === id && e.targetHandle === "img"
        );
        if (!edgeToThis) return undefined;

        return resolveFromNode(edgeToThis.source, edgeToThis);
      },
      [id]
    )
  );

  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const rawFullValue = connectedFrameImage || data.imageData || data.imageUrl;
  const fullAssetId = React.useMemo(() => parseFlowImageAssetRef(rawFullValue), [rawFullValue]);
  const fullAssetUrl = useFlowImageAssetUrl(fullAssetId);
  const fullSrc = React.useMemo(() => {
    if (fullAssetId) return fullAssetUrl || undefined;
    return buildImageSrc(rawFullValue);
  }, [fullAssetId, fullAssetUrl, rawFullValue]);

  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(() => parseFlowImageAssetRef(rawThumbValue), [rawThumbValue]);
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const displaySrc = React.useMemo(() => {
    if (thumbAssetId) return thumbAssetUrl || fullSrc;
    return buildImageSrc(rawThumbValue) || fullSrc;
  }, [thumbAssetId, thumbAssetUrl, rawThumbValue, fullSrc]);

  const nodeCropInfo = React.useMemo(() => {
    const crop = (data as any)?.crop as
      | { x?: unknown; y?: unknown; width?: unknown; height?: unknown; sourceWidth?: unknown; sourceHeight?: unknown }
      | undefined;
    if (!crop) return null;

    const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
    const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
    const w = typeof crop.width === "number" ? crop.width : Number(crop.width ?? 0);
    const h = typeof crop.height === "number" ? crop.height : Number(crop.height ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return null;

    const sourceWidth = typeof crop.sourceWidth === "number" ? crop.sourceWidth : Number(crop.sourceWidth ?? 0);
    const sourceHeight = typeof crop.sourceHeight === "number" ? crop.sourceHeight : Number(crop.sourceHeight ?? 0);

    // 运行时预览优先使用本地 flow-asset/blob（上传中 key 可能尚不可用）
    const baseRef =
      (typeof (data as any)?.imageData === "string" && (data as any).imageData.trim()) ||
      (typeof (data as any)?.imageUrl === "string" && (data as any).imageUrl.trim()) ||
      (typeof connectedFrameImage === "string" && connectedFrameImage.trim()) ||
      "";
    if (!baseRef) return null;

    return {
      baseRef,
      rect: { x, y, width: w, height: h },
      sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
      sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
    };
  }, [connectedFrameImage, (data as any)?.crop?.height, (data as any)?.crop?.sourceHeight, (data as any)?.crop?.sourceWidth, (data as any)?.crop?.width, (data as any)?.crop?.x, (data as any)?.crop?.y, data.imageData, data.imageUrl]);

  // ImageSplit -> Image：运行时裁剪预览（不落库）
  const imageSplitCropInfo = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edges = state.edges || [];
        const edgeToThis = edges.find((e) => e.target === id && e.targetHandle === "img");
        if (!edgeToThis) return null;

        const srcNode = state.getNodes().find((n) => n.id === edgeToThis.source);
        if (!srcNode) return null;

        if (srcNode.type === "image" || srcNode.type === "imagePro") {
          const d = (srcNode.data || {}) as any;
          const crop = d?.crop as
            | { x?: unknown; y?: unknown; width?: unknown; height?: unknown; sourceWidth?: unknown; sourceHeight?: unknown }
            | undefined;
          const baseRef =
            (typeof d.imageData === "string" && d.imageData.trim()) ||
            (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
            "";
          if (crop && baseRef) {
            const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
            const w = typeof crop.width === "number" ? crop.width : Number(crop.width ?? 0);
            const h = typeof crop.height === "number" ? crop.height : Number(crop.height ?? 0);
            if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              const sourceWidth = typeof crop.sourceWidth === "number" ? crop.sourceWidth : Number(crop.sourceWidth ?? 0);
              const sourceHeight = typeof crop.sourceHeight === "number" ? crop.sourceHeight : Number(crop.sourceHeight ?? 0);
              return {
                baseRef,
                rect: { x, y, width: w, height: h },
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              };
            }
          }
          return null;
        }

        if (srcNode.type !== "imageSplit") return null;

        const handle = (edgeToThis as any).sourceHandle as string | undefined;
        const match = typeof handle === "string" ? /^image(\\d+)$/.exec(handle) : null;
        if (!match) return null;
        const idx = Math.max(0, Number(match[1]) - 1);

        const d = (srcNode.data || {}) as any;
        const baseRef =
          (typeof d.inputImageUrl === "string" && d.inputImageUrl.trim()) ||
          (typeof d.inputImage === "string" && d.inputImage.trim()) ||
          "";
        if (!baseRef) return null;

        const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
        const rect = splitRects?.[idx];
        const x = typeof rect?.x === "number" ? rect.x : Number(rect?.x ?? 0);
        const y = typeof rect?.y === "number" ? rect.y : Number(rect?.y ?? 0);
        const w = typeof rect?.width === "number" ? rect.width : Number(rect?.width ?? 0);
        const h = typeof rect?.height === "number" ? rect.height : Number(rect?.height ?? 0);
        if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) return null;

        const sourceWidth = typeof d.sourceWidth === "number" ? d.sourceWidth : undefined;
        const sourceHeight = typeof d.sourceHeight === "number" ? d.sourceHeight : undefined;
        return {
          baseRef,
          rect: { x, y, width: w, height: h },
          sourceWidth,
          sourceHeight,
        };
      },
      [id]
    ),
    shallow
  );

  const cropInfo = nodeCropInfo || imageSplitCropInfo;
  const cropBaseRef = cropInfo?.baseRef;
  const cropAssetId = React.useMemo(() => parseFlowImageAssetRef(cropBaseRef), [cropBaseRef]);
  const cropAssetUrl = useFlowImageAssetUrl(cropAssetId);
  const cropSrc = React.useMemo(() => {
    if (!cropInfo || !cropBaseRef) return undefined;
    if (cropAssetId) return cropAssetUrl || undefined;
    return buildImageSrc(cropBaseRef);
  }, [cropAssetId, cropAssetUrl, cropBaseRef, cropInfo]);
  const canvasCrop = cropInfo && cropSrc
    ? {
      src: cropSrc,
      rect: cropInfo.rect,
      sourceWidth: cropInfo.sourceWidth,
      sourceHeight: cropInfo.sourceHeight,
    }
    : undefined;

  const projectId = useProjectContentStore((state) => state.projectId);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>("");
  const [isResizing, setIsResizing] = React.useState(false);
  const updateNodeSize = React.useCallback(
    (width: number, height: number) => {
      const nextWidth = Math.max(1, Math.round(Math.max(width, MIN_WIDTH)));
      const nextHeight = Math.max(1, Math.round(Math.max(height, MIN_HEIGHT)));
      rf.setNodes((ns) => {
        const idx = ns.findIndex((n) => n.id === id);
        if (idx < 0) return ns;
        const node = ns[idx];
        const prevW = (node?.data as any)?.boxW;
        const prevH = (node?.data as any)?.boxH;
        if (prevW === nextWidth && prevH === nextHeight) return ns;
        const next = ns.slice();
        next[idx] = {
          ...node,
          data: { ...(node.data || {}), boxW: nextWidth, boxH: nextHeight },
        };
        return next;
      });
    },
    [rf, id]
  );

  const resizeRafRef = React.useRef<number | null>(null);
  const resizePendingRef = React.useRef<{ w: number; h: number } | null>(null);
  const flushResizeRef = React.useRef<(() => void) | null>(null);

  flushResizeRef.current = () => {
    resizeRafRef.current = null;
    const pending = resizePendingRef.current;
    resizePendingRef.current = null;
    if (!pending) return;
    updateNodeSize(pending.w, pending.h);
  };

  const scheduleResize = React.useCallback(
    (w: number, h: number) => {
      resizePendingRef.current = { w, h };
      if (resizeRafRef.current != null) return;
      resizeRafRef.current = window.requestAnimationFrame(() => {
        flushResizeRef.current?.();
      });
    },
    []
  );

  React.useEffect(() => {
    return () => {
      if (resizeRafRef.current != null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      resizePendingRef.current = null;
    };
  }, []);
  const handleResizeStart = React.useCallback(() => {
    setIsResizing(true);
  }, []);
  const handleResize = React.useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      if (!params) return;
      scheduleResize(params.width, params.height);
    },
    [scheduleResize]
  );
  const handleResizeEnd = React.useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      setIsResizing(false);
      if (!params) return;
      if (resizeRafRef.current != null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      resizePendingRef.current = null;
      updateNodeSize(params.width, params.height);
    },
    [updateNodeSize]
  );
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  // 使用全局图片历史记录
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
  const nodeHistoryEntry = React.useMemo(
    () => projectHistory.find((item) => item.nodeId === id),
    [projectHistory, id]
  );
  const resolvedImageName = React.useMemo(() => {
    const direct =
      typeof data.imageName === "string" ? data.imageName.trim() : "";
    if (direct) return direct;
    const fromCurrent = currentImageId
      ? allImages.find((item) => item.id === currentImageId)?.title?.trim()
      : "";
    if (fromCurrent) return fromCurrent;
    return nodeHistoryEntry?.title?.trim() || "";
  }, [data.imageName, currentImageId, allImages, nodeHistoryEntry]);
  const truncatedImageName = React.useMemo(() => {
    if (!resolvedImageName) return "";
    if (resolvedImageName.length > MAX_IMAGE_NAME_LENGTH) {
      const safeLength = Math.max(0, MAX_IMAGE_NAME_LENGTH - 3);
      return `${resolvedImageName.slice(0, safeLength)}...`;
    }
    return resolvedImageName;
  }, [resolvedImageName]);
  const shouldShowImageName = Boolean(data.imageData && truncatedImageName);
  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview]);

  const handleFiles = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    const normalizedFileName = (file.name || "").trim();
    const displayName = normalizedFileName || "未命名图片";

    const uploadDir = projectId
      ? `projects/${projectId}/images/`
      : "uploads/images/";
    const { key } = generateOssKey({
      projectId,
      dir: uploadDir,
      fileName: file.name,
      contentType: file.type,
    });

    let flowAssetId: string | null = null;
    let previewRef: string | null = null;
    try {
      const [assetId] = await putFlowImageBlobs([
        { blob: file, projectId: projectId ?? null, nodeId: id },
      ]);
      if (assetId) {
        flowAssetId = assetId;
        previewRef = toFlowImageAssetRef(assetId);
      }
    } catch {}

    // IndexedDB 不可用时兜底走 blob: ObjectURL（仅运行时，保存前必须上传替换）
    let fallbackObjectUrl: string | null = null;
    if (!previewRef) {
      try {
        fallbackObjectUrl = URL.createObjectURL(file);
        previewRef = fallbackObjectUrl;
      } catch {}
    }

    if (!previewRef) return;

    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            imageData: previewRef,
            imageUrl: key, // 先关联 key，避免上传中触发保存导致图片丢失
            imageName: displayName,
            uploading: true,
            uploadError: undefined,
          },
        },
      })
    );

    const newImageId = `${id}-${Date.now()}`;
    setCurrentImageId(newImageId);

    const containsRef = (value: unknown, ref: string): boolean => {
      if (typeof value === "string") return value === ref;
      if (Array.isArray(value)) return value.some((v) => containsRef(v, ref));
      if (value && typeof value === "object") {
        return Object.values(value as Record<string, unknown>).some((v) =>
          containsRef(v, ref)
        );
      }
      return false;
    };

    const isPreviewRefStillUsedInFlow = (ref: string): boolean => {
      try {
        const nodes = rf.getNodes();
        return nodes.some((n) => containsRef(n?.data, ref));
      } catch {
        return false;
      }
    };

    const tryCleanupPreviewRef = (ref: string) => {
      // 延迟一拍，确保 flow:updateNodeData 已生效
      setTimeout(() => {
        if (isPreviewRefStillUsedInFlow(ref)) return;
        if (flowAssetId) {
          void deleteFlowImage(flowAssetId).catch(() => {});
        } else if (fallbackObjectUrl && fallbackObjectUrl.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(fallbackObjectUrl);
          } catch {}
        }
      }, 0);
    };

    try {
      const uploadResult = await imageUploadService.uploadImageFile(file, {
        projectId: projectId ?? undefined,
        dir: uploadDir,
        fileName: file.name || `flow_image_${newImageId}.png`,
        key,
      });

      if (!uploadResult.success || !uploadResult.asset?.url) {
        window.dispatchEvent(
          new CustomEvent("flow:updateNodeData", {
            detail: {
              id,
              patch: {
                uploading: false,
                uploadError: uploadResult.error || "上传失败",
              },
            },
          })
        );
        return;
      }

      const persistedRef = (uploadResult.asset.key || key || uploadResult.asset.url).trim();
      if (!persistedRef) return;

      // 防止并发上传回写覆盖：确认节点仍在使用本次 previewRef
      try {
        const current = rf.getNode(id);
        const currentPreview = (current?.data as any)?.imageData;
        if (currentPreview && currentPreview !== previewRef) {
          // 节点已被用户替换为新图片：仅做清理，不回写
          tryCleanupPreviewRef(previewRef);
          return;
        }
      } catch {}

      // 上传成功后：切换为可持久化引用，并清理本地临时图片（flow-asset/blob）
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              imageUrl: persistedRef,
              imageData: undefined,
              thumbnail: undefined,
              uploading: false,
              uploadError: undefined,
            },
          },
        })
      );

      void recordImageHistoryEntry({
        id: newImageId,
        remoteUrl: uploadResult.asset.url,
        title: displayName,
        nodeId: id,
        nodeType: "image",
        fileName: uploadResult.asset.fileName || file.name || `flow_image_${newImageId}.png`,
        projectId,
        keepThumbnail: false,
      }).catch(() => {});

      tryCleanupPreviewRef(previewRef);
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              uploading: false,
              uploadError: err?.message || "上传失败",
            },
          },
        })
      );
    }
  }, [id, projectId, rf]);

  const onDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDoubleClick = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onPaste = React.useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const items = e.clipboardData?.items;
    if (!items) return;

    // 遍历剪贴板项，查找图片
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const fileList = new DataTransfer();
          fileList.items.add(file);
          handleFiles(fileList.files);
          return;
        }
      }
    }
  }, [handleFiles]);

  return (
    <div
      className={`flow-image-node${
        isResizing ? " flow-image-node--resizing" : ""
      }`}
      onPaste={onPaste}
      tabIndex={0}
      style={{
        width: data.boxW || 260,
        height: data.boxH || 240,
        padding: 8,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        outline: "none",
      }}
    >
      {lineControlConfigs.map((config) => (
        <NodeResizeControl
          key={`line-${config.position}`}
          position={config.position}
          variant='line'
          className='image-node-resize-line'
          style={config.style}
          minWidth={MIN_WIDTH}
          minHeight={MIN_HEIGHT}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      ))}
      {handleControlConfigs.map((config) => (
        <NodeResizeControl
          key={`handle-${config.position}`}
          position={config.position}
          className='image-node-resize-handle'
          style={config.style}
          minWidth={MIN_WIDTH}
          minHeight={MIN_HEIGHT}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      ))}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>{data.label || "Image"}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {hasInputConnection && (
            <button
              onClick={() => {
                // 只断开输入连线，不清空图片数据
                try {
                  const edges = rf.getEdges();
                  const remain = edges.filter(
                    (e) => !(e.target === id && e.targetHandle === "img")
                  );
                  rf.setEdges(remain);
                } catch {}
              }}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              内置
            </button>
          )}
          {data.imageData && (
            <button
              onClick={() => {
                const ev = new CustomEvent("flow:updateNodeData", {
                  detail: {
                    id,
                    patch: { imageData: undefined, imageName: undefined },
                  },
                });
                window.dispatchEvent(ev);
                // 同步断开输入连线
                try {
                  const edges = rf.getEdges();
                  const remain = edges.filter(
                    (e) => !(e.target === id && e.targetHandle === "img")
                  );
                  rf.setEdges(remain);
                } catch {}
              }}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              清空
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type='file'
        accept='image/*'
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {shouldShowImageName && (
        <div
          style={{
            fontSize: 12,
            color: "#6b7280",
            marginBottom: 4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={resolvedImageName}
        >
          {truncatedImageName}
        </div>
      )}

      <ImageContent
        displaySrc={displaySrc}
        canvasCrop={canvasCrop}
        isResizing={isResizing}
        uploading={Boolean((data as any)?.uploading)}
        uploadError={typeof (data as any)?.uploadError === "string" ? (data as any).uploadError : ""}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDoubleClick={handleDoubleClick}
      />

      <Handle
        type='target'
        position={Position.Left}
        id='img'
        onMouseEnter={() => setHover("img-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='img'
        onMouseEnter={() => setHover("img-out")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "img-in" && (
        <div
          className='flow-tooltip'
          style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}
        >
          image
        </div>
      )}
      {hover === "img-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}
        >
          image
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
        imageTitle='全局图片预览'
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={(imageId: string) => {
          const selectedImage = allImages.find((item) => item.id === imageId);
          if (selectedImage) {
            setCurrentImageId(imageId);
          }
        }}
      />
    </div>
  );
}

export default React.memo(ImageNodeInner);
