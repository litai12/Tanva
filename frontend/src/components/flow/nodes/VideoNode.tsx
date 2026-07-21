// @ts-nocheck
import React from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { useLocaleText } from "@/utils/localeText";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const MAX_VIDEO_NAME_LENGTH = 28;

// 支持的视频格式
const SUPPORTED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime", // MOV
  "video/x-msvideo", // AVI
  "video/mpeg",      // MPEG/MPG
  "video/3gpp",      // 3GP
  "video/x-flv",     // FLV
];

const SUPPORTED_EXTENSIONS = ".mp4,.mov,.avi,.mpeg,.mpg,.3gp,.flv";

const normalizeVideoDuration = (value: unknown): number | undefined => {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0
    ? Number(duration.toFixed(3))
    : undefined;
};

const readVideoFileDuration = (file: File): Promise<number | undefined> =>
  new Promise((resolve) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(normalizeVideoDuration(duration));
    };

    const timeoutId = window.setTimeout(() => finish(), 10_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish();
    video.src = objectUrl;
  });

type Props = {
  id: string;
  data: {
    videoUrl?: string;      // OSS URL
    videoName?: string;
    label?: string;
    boxW?: number;
    boxH?: number;
    mimeType?: string;
    duration?: number;
    status?: 'idle' | 'uploading' | 'ready' | 'error';
    error?: string;
  };
  selected?: boolean;
};

const stopMediaInteraction = (event: React.SyntheticEvent) => {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
};

const VideoContent = React.memo(({
  videoUrl,
  onDrop,
  onDragOver,
  onDoubleClick,
  status,
  error,
  onDurationChange,
  lt,
}: {
  videoUrl?: string;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDoubleClick: () => void;
  status?: string;
  error?: string;
  onDurationChange: (duration: number) => void;
  lt: (zhText: string, enText: string) => string;
}) => (
  <div
    onDrop={onDrop}
    onDragOver={onDragOver}
    onDoubleClick={onDoubleClick}
    style={{
      flex: 1,
      minHeight: 160,
      background: "#000",
      borderRadius: 6,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      border: "1px solid #e5e7eb",
      cursor: "pointer",
    }}
    title={lt("拖拽视频到此或双击上传", "Drag video here or double click to upload")}
  >
    {status === 'uploading' ? (
      <div style={{ textAlign: "center", color: "#9ca3af" }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
        <span style={{ fontSize: 12 }}>{lt("上传中...", "Uploading...")}</span>
      </div>
    ) : status === 'error' ? (
      <div style={{ textAlign: "center", color: "#ef4444", padding: 12 }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>❌</div>
        <span style={{ fontSize: 11 }}>{error || lt('上传失败', 'Upload failed')}</span>
      </div>
    ) : videoUrl ? (
      <video
        className="nodrag nopan nowheel"
        src={videoUrl}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#000",
        }}
        controls
        preload="metadata"
        onLoadedMetadata={(event) => {
          const duration = normalizeVideoDuration(event.currentTarget.duration);
          if (duration !== undefined) onDurationChange(duration);
        }}
        onPointerDownCapture={stopMediaInteraction}
        onMouseDownCapture={stopMediaInteraction}
        onTouchStartCapture={stopMediaInteraction}
        onDoubleClickCapture={stopMediaInteraction}
      />
    ) : (
      <div style={{ textAlign: "center", color: "#9ca3af" }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>🎬</div>
        <span style={{ fontSize: 12 }}>{lt("拖拽视频到此或双击上传", "Drag video here or double click to upload")}</span>
        <div style={{ fontSize: 10, marginTop: 4, color: "#6b7280" }}>
          {lt("支持 MP4, MOV, AVI, MPEG, 3GP, FLV", "Supports MP4, MOV, AVI, MPEG, 3GP, FLV")}
        </div>
      </div>
    )}
  </div>
));

function VideoNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const projectId = useProjectContentStore((state) => state.projectId);
  const [hover, setHover] = React.useState<string | null>(null);

  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  const truncatedVideoName = React.useMemo(() => {
    const name = data.videoName || "";
    if (!name) return "";
    if (name.length > MAX_VIDEO_NAME_LENGTH) {
      return `${name.slice(0, MAX_VIDEO_NAME_LENGTH - 3)}...`;
    }
    return name;
  }, [data.videoName]);

  const updateNodeData = React.useCallback((patch: Record<string, any>) => {
    window.dispatchEvent(new CustomEvent("flow:updateNodeData", {
      detail: { id, patch },
    }));
  }, [id]);

  const handleDurationChange = React.useCallback((duration: number) => {
    const normalizedDuration = normalizeVideoDuration(duration);
    if (normalizedDuration === undefined) return;
    const currentDuration = normalizeVideoDuration(data.duration);
    if (currentDuration !== undefined && Math.abs(currentDuration - normalizedDuration) < 0.001) {
      return;
    }
    updateNodeData({ duration: normalizedDuration });
  }, [data.duration, updateNodeData]);

  // 上传视频到 OSS
  const uploadVideoToOSS = React.useCallback(async (file: File): Promise<string> => {
    const { ossUploadService } = await import("@/services/ossUploadService");

    const dir = projectId ? `projects/${projectId}/videos/` : "videos/";
    const result = await ossUploadService.uploadToOSS(file, {
      dir,
      projectId: null,
      fileName: file.name || `video-${Date.now()}.mp4`,
      contentType: file.type || "video/mp4",
      maxSize: 500 * 1024 * 1024, // 500MB
    });

    if (!result.success || !result.url) {
      throw new Error(result.error || lt("上传失败", "Upload failed"));
    }
    return result.url;
  }, [lt, projectId]);

  const handleFiles = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    // 验证文件类型
    if (!SUPPORTED_VIDEO_TYPES.includes(file.type) && !file.name.match(/\.(mp4|mov|avi|mpeg|mpg|3gp|flv)$/i)) {
      updateNodeData({
        status: 'error',
        error: lt('不支持的视频格式', 'Unsupported video format')
      });
      return;
    }

    const videoName = file.name || lt("未命名视频", "Untitled video");

    // 设置上传状态
    updateNodeData({
      status: 'uploading',
      videoName,
      mimeType: file.type,
      duration: undefined,
      error: undefined,
    });

    try {
      const [videoUrl, duration] = await Promise.all([
        uploadVideoToOSS(file),
        readVideoFileDuration(file),
      ]);

      updateNodeData({
        videoUrl,
        videoName,
        mimeType: file.type,
        duration,
        status: 'ready',
        error: undefined,
      });

      console.log(`✅ Video uploaded: ${videoName} -> ${videoUrl}`);
    } catch (err: any) {
      console.error("❌ Video upload failed:", err);
      updateNodeData({
        status: 'error',
        error: err.message || lt('上传失败', 'Upload failed'),
      });
    }
  }, [lt, updateNodeData, uploadVideoToOSS]);

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

  const handleClear = React.useCallback(() => {
    updateNodeData({
      videoUrl: undefined,
      videoName: undefined,
      mimeType: undefined,
      duration: undefined,
      status: 'idle',
      error: undefined,
    });
  }, [updateNodeData]);

  return (
    <div
      className="flow-video-node"
      style={{
        width: data.boxW || 320,
        height: data.boxH || 280,
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
      {/* 标题栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>{data.label || "Video"}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {data.videoUrl && (
            <button
              onClick={handleClear}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              {lt("清空", "Clear")}
            </button>
          )}
        </div>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_EXTENSIONS}
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* 视频名称 */}
      {truncatedVideoName && (
        <div
          style={{
            fontSize: 12,
            color: "#6b7280",
            marginBottom: 4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={data.videoName}
        >
          {truncatedVideoName}
        </div>
      )}

      {/* 视频内容区域 */}
      <VideoContent
        videoUrl={data.videoUrl}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDoubleClick={handleDoubleClick}
        status={data.status}
        error={data.error}
        onDurationChange={handleDurationChange}
        lt={lt}
      />

      {/* 连接点 */}
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        onMouseEnter={() => setHover("video-out")}
        onMouseLeave={() => setHover(null)}
      />

      {/* 工具提示 */}
      {hover === "video-out" && (
        <div
          className="flow-tooltip"
          style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}
        >
          video
        </div>
      )}
    </div>
  );
}

export default React.memo(VideoNodeInner);
