// @ts-nocheck
import React from "react";
import { Handle, Position, useReactFlow, useStore, type ReactFlowState } from "reactflow";
import { NodeResizeControl } from "@reactflow/node-resizer";
import ImagePreviewModal, { type ImageItem } from "../../ui/ImagePreviewModal";
import { useImageHistoryStore } from "../../../stores/imageHistoryStore";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { parseFlowImageAssetRef } from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { resolveImageToBlob } from "@/utils/imageSource";
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

const ImageContent = React.memo(({ displaySrc, isResizing, onDrop, onDragOver, onDoubleClick }: {
  displaySrc?: string;
  isResizing?: boolean;
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
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      border: "1px solid #e5e7eb",
      cursor: "pointer",
    }}
    title='拖拽图片到此或双击上传'
  >
    {displaySrc ? (
      <img
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

          // Image 节点 - 支持把上游输入继续往下传
          if (node.type === "image") {
            const upstream = edges.find(
              (e) => e.target === nodeId && e.targetHandle === "img"
            );
            const upstreamResolved = upstream
              ? resolveFromNode(upstream.source, upstream, visited)
              : undefined;
            if (upstreamResolved) return upstreamResolved;

            const direct =
              (nodeData.imageData as string | undefined) ||
              (nodeData.imageUrl as string | undefined) ||
              (nodeData.thumbnail as string | undefined);
            return direct || undefined;
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

  // ImageSplit -> Image：运行时裁剪预览（不落库）
  const imageSplitCropInfo = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edges = state.edges || [];
        const edgeToThis = edges.find((e) => e.target === id && e.targetHandle === "img");
        if (!edgeToThis) return null;

        const srcNode = state.getNodes().find((n) => n.id === edgeToThis.source);
        if (!srcNode || srcNode.type !== "imageSplit") return null;

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

  const [imageSplitPreviewSrc, setImageSplitPreviewSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (imageSplitPreviewSrc && imageSplitPreviewSrc.startsWith("blob:")) {
        try { URL.revokeObjectURL(imageSplitPreviewSrc); } catch {}
      }
    };
  }, [imageSplitPreviewSrc]);

  React.useEffect(() => {
    let cancelled = false;

    const makeCanvas = (cw: number, ch: number): any => {
      if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(cw, ch);
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      return canvas;
    };

    const canvasToBlob = async (canvas: any): Promise<Blob> => {
      if (canvas && typeof canvas.convertToBlob === "function") {
        return await canvas.convertToBlob({ type: "image/png" });
      }
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b: Blob | null) => (b ? resolve(b) : reject(new Error("导出失败"))),
          "image/png"
        );
      });
    };

    const run = async () => {
      if (!imageSplitCropInfo) {
        setImageSplitPreviewSrc(null);
        return;
      }

      const blob = await resolveImageToBlob(imageSplitCropInfo.baseRef, { preferProxy: true });
      if (!blob || cancelled) {
        if (!cancelled) setImageSplitPreviewSrc(null);
        return;
      }

      const rect = imageSplitCropInfo.rect;

      const cropWithBitmap = async (): Promise<string | null> => {
        if (typeof createImageBitmap !== "function") return null;
        const bitmap = await createImageBitmap(blob);
        try {
          const naturalW = bitmap.width;
          const naturalH = bitmap.height;
          if (!naturalW || !naturalH) return null;

          const srcW =
            typeof imageSplitCropInfo.sourceWidth === "number" && imageSplitCropInfo.sourceWidth > 0
              ? imageSplitCropInfo.sourceWidth
              : naturalW;
          const srcH =
            typeof imageSplitCropInfo.sourceHeight === "number" && imageSplitCropInfo.sourceHeight > 0
              ? imageSplitCropInfo.sourceHeight
              : naturalH;

          const scaleX = srcW > 0 ? naturalW / srcW : 1;
          const scaleY = srcH > 0 ? naturalH / srcH : 1;

          const sx = Math.max(0, Math.min(naturalW - 1, rect.x * scaleX));
          const sy = Math.max(0, Math.min(naturalH - 1, rect.y * scaleY));
          const swRaw = Math.max(1, rect.width * scaleX);
          const shRaw = Math.max(1, rect.height * scaleY);
          const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
          const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

          // 预览尺寸上限：避免一次生成过多大图导致内存激增
          const MAX_PREVIEW_DIM = 512;
          const outScale = Math.min(1, MAX_PREVIEW_DIM / Math.max(sw, sh));
          const outW = Math.max(1, Math.round(sw * outScale));
          const outH = Math.max(1, Math.round(sh * outScale));

          const canvas = makeCanvas(outW, outH);
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;

          ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
          const outBlob = await canvasToBlob(canvas);
          return URL.createObjectURL(outBlob);
        } finally {
          try { bitmap.close(); } catch {}
        }
      };

      const cropWithImageElement = async (): Promise<string | null> => {
        const objectUrl = URL.createObjectURL(blob);
        try {
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("图片解码失败"));
            img.src = objectUrl;
          });

          const naturalW = img.naturalWidth || img.width;
          const naturalH = img.naturalHeight || img.height;
          if (!naturalW || !naturalH) return null;

          const srcW =
            typeof imageSplitCropInfo.sourceWidth === "number" && imageSplitCropInfo.sourceWidth > 0
              ? imageSplitCropInfo.sourceWidth
              : naturalW;
          const srcH =
            typeof imageSplitCropInfo.sourceHeight === "number" && imageSplitCropInfo.sourceHeight > 0
              ? imageSplitCropInfo.sourceHeight
              : naturalH;

          const scaleX = srcW > 0 ? naturalW / srcW : 1;
          const scaleY = srcH > 0 ? naturalH / srcH : 1;

          const sx = Math.max(0, Math.min(naturalW - 1, rect.x * scaleX));
          const sy = Math.max(0, Math.min(naturalH - 1, rect.y * scaleY));
          const swRaw = Math.max(1, rect.width * scaleX);
          const shRaw = Math.max(1, rect.height * scaleY);
          const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
          const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

          const MAX_PREVIEW_DIM = 512;
          const outScale = Math.min(1, MAX_PREVIEW_DIM / Math.max(sw, sh));
          const outW = Math.max(1, Math.round(sw * outScale));
          const outH = Math.max(1, Math.round(sh * outScale));

          const canvas = makeCanvas(outW, outH);
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;

          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
          const outBlob = await canvasToBlob(canvas);
          return URL.createObjectURL(outBlob);
        } finally {
          try { URL.revokeObjectURL(objectUrl); } catch {}
        }
      };

      let croppedUrl: string | null = null;
      try {
        croppedUrl = await cropWithBitmap();
      } catch {
        croppedUrl = null;
      }
      if (!croppedUrl) {
        try {
          croppedUrl = await cropWithImageElement();
        } catch {
          croppedUrl = null;
        }
      }

      if (cancelled) {
        if (croppedUrl && croppedUrl.startsWith("blob:")) {
          try { URL.revokeObjectURL(croppedUrl); } catch {}
        }
        return;
      }

      setImageSplitPreviewSrc(croppedUrl);
    };

    run().catch(() => {
      if (!cancelled) setImageSplitPreviewSrc(null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    imageSplitCropInfo?.baseRef,
    imageSplitCropInfo?.rect?.x,
    imageSplitCropInfo?.rect?.y,
    imageSplitCropInfo?.rect?.width,
    imageSplitCropInfo?.rect?.height,
    imageSplitCropInfo?.sourceWidth,
    imageSplitCropInfo?.sourceHeight,
  ]);

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
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      const displayName = normalizedFileName || "未命名图片";
      const ev = new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { imageData: base64, imageName: displayName } },
      });
      window.dispatchEvent(ev);

      const newImageId = `${id}-${Date.now()}`;
      setCurrentImageId(newImageId);
      void recordImageHistoryEntry({
        id: newImageId,
        base64,
        title: displayName,
        nodeId: id,
        nodeType: "image",
        fileName: file.name || `flow_image_${newImageId}.png`,
        projectId,
      }).then(({ remoteUrl }) => {
        // 上传到 OSS 成功后，用 URL 替换节点内的 base64，显著减少项目数据体积与渲染压力
        if (!remoteUrl) return;
        try {
          const current = rf.getNode(id);
          if ((current?.data as any)?.imageData !== base64) return;
        } catch {}
        window.dispatchEvent(
          new CustomEvent("flow:updateNodeData", {
            detail: { id, patch: { imageUrl: remoteUrl, imageData: undefined, thumbnail: undefined } },
          })
        );
      }).catch(() => {});
    };
    reader.readAsDataURL(file);
  }, [id, projectId]);

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
        displaySrc={imageSplitPreviewSrc || displaySrc}
        isResizing={isResizing}
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
