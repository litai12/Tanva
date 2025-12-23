// @ts-nocheck
import React from "react";
import { Handle, Position, useReactFlow } from "reactflow";
import { NodeResizeControl } from "@reactflow/node-resizer";
import ImagePreviewModal, { type ImageItem } from "../../ui/ImagePreviewModal";
import { useImageHistoryStore } from "../../../stores/imageHistoryStore";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import { useProjectContentStore } from "@/stores/projectContentStore";

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
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed;
  return `data:image/png;base64,${trimmed}`;
};

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const MAX_IMAGE_NAME_LENGTH = 28;

function ImageNodeInner({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const fullSrc = buildImageSrc(data.imageData);
  const displaySrc = buildImageSrc(data.thumbnail) || fullSrc;
  const projectId = useProjectContentStore((state) => state.projectId);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>("");
  const [hasInputConnection, setHasInputConnection] = React.useState(false);
  const [isResizing, setIsResizing] = React.useState(false);
  const updateNodeSize = React.useCallback(
    (width: number, height: number) => {
      const nextWidth = Math.max(width, MIN_WIDTH);
      const nextHeight = Math.max(height, MIN_HEIGHT);
      rf.setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                data: { ...n.data, boxW: nextWidth, boxH: nextHeight },
              }
            : n
        )
      );
    },
    [rf, id]
  );
  const handleResizeStart = React.useCallback(() => {
    setIsResizing(true);
  }, []);
  const handleResize = React.useCallback(
    (evt: any, params: any) => {
      if (!params) return;
      updateNodeSize(params.width, params.height);
    },
    [updateNodeSize]
  );
  const handleResizeEnd = React.useCallback(
    (evt: any, params: any) => {
      setIsResizing(false);
      if (!params) return;
      updateNodeSize(params.width, params.height);
    },
    [updateNodeSize]
  );
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  // 检查输入连线状态
  React.useEffect(() => {
    const checkConnections = () => {
      const edges = rf.getEdges();
      const hasConnection = edges.some(
        (edge) => edge.target === id && edge.targetHandle === "img"
      );
      setHasInputConnection(hasConnection);
    };

    // 初始检查
    checkConnections();

    // 设置定期检查（简单方案）
    const interval = setInterval(checkConnections, 100);
    return () => clearInterval(interval);
  }, [rf, id]);

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

  const handleFiles = async (files: FileList | null) => {
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
      });
    };
    reader.readAsDataURL(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
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
  };

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

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDoubleClick={() => fullSrc && setPreview(true)}
        onClick={() => {
          if (!displaySrc) {
            inputRef.current?.click();
          }
        }}
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
          cursor: displaySrc ? "default" : "pointer",
        }}
        title='拖拽图片到此或点击上传'
      >
        {displaySrc ? (
          <img
            src={displaySrc}
            alt=''
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#fff",
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            拖拽图片到此或点击上传
          </span>
        )}
      </div>

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
