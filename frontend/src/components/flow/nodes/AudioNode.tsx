// @ts-nocheck
import React from "react";
import { Handle, Position, useReactFlow, useStore, type ReactFlowState } from "reactflow";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { useLocaleText } from "@/utils/localeText";

const MAX_AUDIO_NAME_LENGTH = 28;
const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB
const COMPACT_NODE_HEIGHT = 128;
const COMPACT_CONTENT_HEIGHT = 72;

const SUPPORTED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/x-flac",
  "audio/webm",
  "audio/amr",
  "audio/aiff",
  "audio/x-aiff",
  "audio/x-ms-wma",
];

const SUPPORTED_AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "aac",
  "m4a",
  "ogg",
  "opus",
  "flac",
  "webm",
  "weba",
  "amr",
  "aiff",
  "aif",
  "wma",
];

const SUPPORTED_AUDIO_PATTERN = new RegExp(
  `\\.(${SUPPORTED_AUDIO_EXTENSIONS.join("|")})$`,
  "i"
);

const SUPPORTED_EXTENSIONS = SUPPORTED_AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(",");

type Props = {
  id: string;
  data: {
    audioUrl?: string;
    audioName?: string;
    label?: string;
    boxW?: number;
    boxH?: number;
    mimeType?: string;
    duration?: number;
    status?: "idle" | "uploading" | "ready" | "error";
    error?: string;
  };
  selected?: boolean;
};

const isSupportedAudioFile = (file: File): boolean => {
  const name = (file?.name || "").trim();
  const mime = (file?.type || "").trim().toLowerCase();
  if (mime.startsWith("audio/")) return true;
  if (SUPPORTED_AUDIO_MIME_TYPES.includes(mime)) return true;
  return SUPPORTED_AUDIO_PATTERN.test(name);
};

const readAudioDuration = async (file: File): Promise<number | undefined> => {
  try {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;

    const duration = await new Promise<number>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("timeout")), 5000);
      audio.addEventListener(
        "loadedmetadata",
        () => {
          window.clearTimeout(timeout);
          resolve(audio.duration || 0);
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeout);
          reject(new Error("load-failed"));
        },
        { once: true }
      );
    });

    URL.revokeObjectURL(objectUrl);
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  } catch {
    return undefined;
  }
};

const AudioContent = React.memo(
  ({
    audioUrl,
    mimeType,
    onDrop,
    onDragOver,
    onDoubleClick,
    status,
    error,
    lt,
  }: {
    audioUrl?: string;
    mimeType?: string;
    onDrop: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDoubleClick: () => void;
    status?: string;
    error?: string;
    lt: (zhText: string, enText: string) => string;
  }) => (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDoubleClick={onDoubleClick}
      style={{
        height: COMPACT_CONTENT_HEIGHT,
        minHeight: COMPACT_CONTENT_HEIGHT,
        background: "#f8fafc",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        border: "1px solid #e5e7eb",
        cursor: "pointer",
        padding: 12,
      }}
      title={lt("拖拽语音到此或双击上传", "Drag audio here or double click to upload")}
    >
      {status === "uploading" ? (
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {lt("上传中...", "Uploading...")}
        </span>
      ) : status === "error" ? (
        <span style={{ fontSize: 11, color: "#dc2626" }}>
          {error || lt("上传失败", "Upload failed")}
        </span>
      ) : audioUrl ? (
        <audio controls style={{ width: "100%" }}>
          <source src={audioUrl} type={mimeType || "audio/mpeg"} />
        </audio>
      ) : (
        <div style={{ textAlign: "center", color: "#6b7280" }}>
          <div style={{ fontSize: 12 }}>
            {lt("拖拽语音到此或双击上传", "Drag audio here or double click to upload")}
          </div>
          <div style={{ fontSize: 10, marginTop: 4, color: "#94a3b8" }}>
            MP3, WAV, M4A, AAC, OGG, FLAC, OPUS, WEBM, AMR, AIFF, WMA
          </div>
        </div>
      )}
    </div>
  )
);

function AudioNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const projectId = useProjectContentStore((state) => state.projectId);
  const [hover, setHover] = React.useState<string | null>(null);
  const incomingAudioUrl = useStore((state: ReactFlowState | any) => {
    const edges = Array.isArray(state?.edges) ? state.edges : [];
    const nodes = Array.isArray(state?.nodes)
      ? state.nodes
      : state?.nodeLookup && typeof state.nodeLookup.values === "function"
      ? Array.from(state.nodeLookup.values())
      : state?.nodeInternals && typeof state.nodeInternals.values === "function"
      ? Array.from(state.nodeInternals.values())
      : [];
    const inEdge = edges.find(
      (edge) => edge.target === id && edge.targetHandle === "audio"
    );
    if (!inEdge) return undefined;
    const sourceNode = nodes.find((node) => node.id === inEdge.source);
    if (!sourceNode) return undefined;
    const sourceData = (sourceNode.data || {}) as Record<string, any>;
    if (typeof sourceData.audioUrl === "string" && sourceData.audioUrl.trim()) {
      return sourceData.audioUrl.trim();
    }
    if (Array.isArray(sourceData.audioUrls)) {
      const firstAudio = sourceData.audioUrls.find(
        (value: unknown) => typeof value === "string" && value.trim().length > 0
      );
      if (typeof firstAudio === "string") {
        return firstAudio.trim();
      }
    }
    return undefined;
  });
  const hasInputConnection = useStore((state: ReactFlowState | any) =>
    (Array.isArray(state?.edges) ? state.edges : []).some(
      (edge) => edge.target === id && edge.targetHandle === "audio"
    )
  );

  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  const truncatedAudioName = React.useMemo(() => {
    const name = data.audioName || "";
    if (!name) return "";
    if (name.length > MAX_AUDIO_NAME_LENGTH) {
      return `${name.slice(0, MAX_AUDIO_NAME_LENGTH - 3)}...`;
    }
    return name;
  }, [data.audioName]);

  const updateNodeData = React.useCallback(
    (patch: Record<string, any>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  const uploadAudioToOSS = React.useCallback(
    async (file: File): Promise<string> => {
      const { ossUploadService } = await import("@/services/ossUploadService");
      const fallbackName = `audio-${Date.now()}.mp3`;
      const dir = projectId ? `projects/${projectId}/audios/` : "uploads/audios/";
      const result = await ossUploadService.uploadToOSS(file, {
        dir,
        projectId: null,
        fileName: file.name || fallbackName,
        contentType: file.type || "audio/mpeg",
        maxSize: MAX_AUDIO_SIZE,
      });

      if (!result.success || !result.url) {
        throw new Error(result.error || lt("上传失败", "Upload failed"));
      }
      return result.url;
    },
    [lt, projectId]
  );

  const handleFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];

      if (!isSupportedAudioFile(file)) {
        updateNodeData({
          status: "error",
          error: lt("不支持的语音格式", "Unsupported audio format"),
        });
        return;
      }

      const audioName = file.name || lt("未命名语音", "Untitled audio");

      updateNodeData({
        status: "uploading",
        audioName,
        mimeType: file.type || undefined,
        error: undefined,
      });

      try {
        const duration = await readAudioDuration(file);
        const audioUrl = await uploadAudioToOSS(file);

        updateNodeData({
          audioUrl,
          audioName,
          mimeType: file.type || undefined,
          duration,
          status: "ready",
          error: undefined,
        });
      } catch (err: any) {
        updateNodeData({
          status: "error",
          error: err?.message || lt("上传失败", "Upload failed"),
        });
      }
    },
    [lt, updateNodeData, uploadAudioToOSS]
  );

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDoubleClick = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleClear = React.useCallback(() => {
    updateNodeData({
      audioUrl: undefined,
      audioName: undefined,
      mimeType: undefined,
      duration: undefined,
      status: "idle",
      error: undefined,
    });
  }, [updateNodeData]);

  const handleDetachInput = React.useCallback(() => {
    try {
      const edges = rf.getEdges();
      const remain = edges.filter(
        (edge) => !(edge.target === id && edge.targetHandle === "audio")
      );
      rf.setEdges(remain);
    } catch {}
  }, [id, rf]);

  const displayAudioUrl = incomingAudioUrl || data.audioUrl;
  const displayMimeType =
    incomingAudioUrl && !data.audioUrl ? undefined : data.mimeType;
  const nodeHeight =
    typeof data.boxH === "number" && data.boxH > 0
      ? Math.min(data.boxH, COMPACT_NODE_HEIGHT)
      : COMPACT_NODE_HEIGHT;

  return (
    <div
        className="flow-audio-node"
      style={{
        width: data.boxW || 320,
        height: nodeHeight,
        padding: 8,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        display: "flex",
        flexDirection: "column",
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
        <div style={{ fontWeight: 600 }}>{data.label || lt("语音节点", "Audio Node")}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {hasInputConnection && (
            <button
              onClick={handleDetachInput}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              {lt("断开", "Detach")}
            </button>
          )}
          {data.audioUrl && (
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

      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_EXTENSIONS}
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {truncatedAudioName && (
        <div
          style={{
            fontSize: 12,
            color: "#6b7280",
            marginBottom: 4,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={data.audioName}
        >
          {truncatedAudioName}
        </div>
      )}

      <AudioContent
        audioUrl={displayAudioUrl}
        mimeType={displayMimeType}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDoubleClick={handleDoubleClick}
        status={data.status}
        error={data.error}
        lt={lt}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="audio"
        onMouseEnter={() => setHover("audio-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="audio"
        onMouseEnter={() => setHover("audio-out")}
        onMouseLeave={() => setHover(null)}
      />

      {hover === "audio-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}
        >
          audio
        </div>
      )}
      {hover === "audio-out" && (
        <div
          className="flow-tooltip"
          style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}
        >
          audio
        </div>
      )}
    </div>
  );
}

export default React.memo(AudioNodeInner);
