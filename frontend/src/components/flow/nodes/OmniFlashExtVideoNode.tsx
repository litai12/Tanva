import React from "react";
import { Handle, Position, useStore } from "reactflow";
import { Video, Download, Share2, AlertTriangle } from "lucide-react";
import GenerationProgressBar from "./GenerationProgressBar";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";
import { formatVideoProviderError } from "@/utils/videoProviderError";
import RunCreditBadge from "./RunCreditBadge";
import NodeSelect from "./NodeSelect";
import { useNodeRunCredits } from "../hooks/useNodeRunCredits";
import { useBackendCreditsPreview } from "../hooks/useBackendCreditsPreview";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    progressStartedAt?: number | string | null;
    videoUrl?: string;
    thumbnail?: string;
    error?: string;
    videoVersion?: number;
    onRun?: (id: string) => void;
    creditsPerCall?: number;
    managedModelKey?: string;
    resolution?: string;
    duration?: number;
    aspectRatio?: string;
    videoMode?: string;
  };
  selected?: boolean;
};

type FlowEdgeLike = {
  target?: string | null;
  targetHandle?: string | null;
};

type FlowStoreStateLike = {
  edges?: FlowEdgeLike[];
};

const DURATION_OPTIONS = [4, 6, 8, 10];
const RESOLUTION_OPTIONS = ["720P", "1080P", "4K"];
const ASPECT_OPTIONS = ["16:9", "9:16"];
const MODE_OPTIONS = [
  {
    value: "frame",
    label: "单图模式",
    description: "1 张图生成视频",
  },
  {
    value: "reference",
    label: "参考模式",
    description: "1~3 张参考图，或 1 条参考视频",
  },
];

const getStyles = (selected?: boolean) => ({
  card: {
    width: 300,
    padding: 10,
    background: "#fff",
    border: `1px solid ${selected ? "#2563eb" : "#e5e7eb"}`,
    borderRadius: 10,
    boxShadow: selected ? "0 0 0 2px rgba(37,99,235,0.12)" : "0 1px 2px rgba(0,0,0,0.04)",
    position: "relative" as const,
  },
  input: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
  },
  iconBtn: {
    width: 36,
    height: 32,
    borderRadius: 8,
    border: "none",
    background: "#111827",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
});

function OmniFlashExtVideoNode({ id, data, selected }: Props) {
  const { lt, language } = useLocaleText();
  const styles = getStyles(selected);
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const [isDownloading, setIsDownloading] = React.useState(false);

  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch } }));
  }, [id]);

  const sanitizeMediaUrl = React.useCallback((url?: string | null) => {
    if (!url || typeof url !== "string") return undefined;
    const trimmed = url.trim();
    if (!trimmed) return undefined;
    const markdownSplit = trimmed.split("](");
    const candidate = markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
    const spaceIdx = candidate.indexOf(" ");
    return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
  }, []);

  const sanitizedVideoUrl = React.useMemo(
    () => sanitizeMediaUrl(data.videoUrl),
    [data.videoUrl, sanitizeMediaUrl]
  );

  const resolution =
    typeof data.resolution === "string" && RESOLUTION_OPTIONS.includes(data.resolution.toUpperCase())
      ? data.resolution.toUpperCase()
      : "720P";
  const duration =
    typeof data.duration === "number" && DURATION_OPTIONS.includes(data.duration)
      ? data.duration
      : 6;
  const aspectRatio =
    typeof data.aspectRatio === "string" && ASPECT_OPTIONS.includes(data.aspectRatio)
      ? data.aspectRatio
      : "16:9";
  const configuredVideoMode = data.videoMode === "reference" ? "reference" : "frame";

  const imageInputCount = useStore(
    React.useCallback(
      (state: FlowStoreStateLike) =>
        (state.edges || []).filter(
          (e) => e.target === id && e.targetHandle === "image"
        ).length,
      [id]
    )
  );
  const videoInputCount = useStore(
    React.useCallback(
      (state: FlowStoreStateLike) =>
        (state.edges || []).filter(
          (e) => e.target === id && e.targetHandle === "video"
        ).length,
      [id]
    )
  );
  const textInputCount = useStore(
    React.useCallback(
      (state: FlowStoreStateLike) =>
        (state.edges || []).filter(
          (e) => e.target === id && e.targetHandle === "text"
        ).length,
      [id]
    )
  );

  const effectiveVideoMode = videoInputCount > 0 ? "reference" : configuredVideoMode;

  const validationMessages = React.useMemo(() => {
    const msgs: string[] = [];
    if (textInputCount === 0) {
      msgs.push(lt("请连接提示词", "Connect a prompt"));
    }
    if (videoInputCount > 1) {
      msgs.push(lt("参考视频最多 1 条", "Reference video: max 1"));
    }
    if (imageInputCount > 3) {
      msgs.push(lt("图片最多 3 张", "Images: max 3"));
    } else if (effectiveVideoMode === "frame" && imageInputCount > 1) {
      msgs.push(lt("单图模式只接 1 张图", "Single-image mode accepts 1 image"));
    }
    return msgs;
  }, [imageInputCount, textInputCount, videoInputCount, effectiveVideoMode, lt]);

  const imageHandleTooltip = React.useMemo(
    () =>
      effectiveVideoMode === "reference"
        ? lt("参考图片：1~3 张", "Reference images: 1-3")
        : lt("单图生成视频：1 张图", "Single-image video: 1 image"),
    [effectiveVideoMode, lt]
  );

  const previewRequestParams = React.useMemo(
    () => ({
      managedModelKey: "omni-flash-ext",
      modelKey: "omni-flash-ext",
      resolution: resolution.toLowerCase(),
      ...(videoInputCount > 0 ? {} : { duration, durationSec: duration }),
      aspectRatio,
      videoMode: effectiveVideoMode,
      hasReferenceVideo: videoInputCount > 0,
    }),
    [duration, resolution, aspectRatio, effectiveVideoMode, videoInputCount]
  );

  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: "kling-video",
    model: "omni-flash-ext",
    requestParams: previewRequestParams,
    enabled: true,
  });

  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;
  const { credits: runCredits, hasCredits: hasRunCredits } = useNodeRunCredits(resolvedRunCredits);

  const copyVideoLink = React.useCallback(async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt(lt("请手动复制以下链接：", "Please manually copy this link:"), url);
    }
  }, [lt]);

  const triggerDownload = React.useCallback(async (url?: string) => {
    if (!url || isDownloading) return;
    setIsDownloading(true);
    try {
      const downloadUrl = proxifyRemoteAssetUrl(url, { forceProxy: true });
      const response = await fetch(downloadUrl, { mode: "cors", credentials: "omit" });
      if (response.ok) {
        const blob = await response.blob();
        const videoBlob = blob.type.startsWith("video/") ? blob : new Blob([blob], { type: "video/mp4" });
        const blobUrl = URL.createObjectURL(videoBlob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `omni-flash-ext-${new Date().toISOString().split("T")[0]}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading]);

  const tooltip = (key: string, top: string, text: string) =>
    hover === key ? (
      <div className="flow-tooltip" style={{ left: -8, top, transform: "translate(-100%, -50%)" }}>
        {text}
      </div>
    ) : null;

  const previewAspectStyle = aspectRatio === "9:16" ? "9/16" : "16/9";
  const displayError = React.useMemo(
    () =>
      data.error
        ? formatVideoProviderError(data.error, {
            language,
            fallbackZh: "视频生成失败，请调整提示词或素材后重试。",
            fallbackEn: "Video generation failed. Please revise the prompt or media and try again.",
          })
        : "",
    [data.error, language]
  );

  React.useEffect(() => {
    setPreviewAspect(previewAspectStyle);
  }, [previewAspectStyle]);

  return (
    <div style={styles.card}>
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: "20%" }}
        onMouseEnter={() => setHover("text")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "43%" }}
        onMouseEnter={() => setHover("image")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: "66%" }}
        onMouseEnter={() => setHover("video-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("video-out")}
        onMouseLeave={() => setHover(null)}
      />

      {tooltip("text", "20%", lt("提示词（必填）", "Prompt (required)"))}
      {tooltip("image", "43%", imageHandleTooltip)}
      {tooltip("video-in", "66%", lt("参考视频（最多 1 个）", "Reference video (max 1)"))}
      {hover === "video-out" && (
        <div className="flow-tooltip" style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>
          {lt("生成视频输出", "Generated video output")}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <Video size={16} />
          <span>Omni Flash Ext</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className="tanva-video-header-btn tanva-video-header-run run-btn-with-credit"
            onClick={() => data.onRun?.(id)}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={data.status === "running"}
            style={{
              ...styles.iconBtn,
              width: hasRunCredits ? "auto" : styles.iconBtn.width,
              minWidth: hasRunCredits ? 64 : styles.iconBtn.width,
              padding: hasRunCredits ? "0 10px" : undefined,
              background: data.status === "running" ? "#e5e7eb" : "#111827",
              opacity: data.status === "running" ? 0.6 : 1,
              cursor: data.status === "running" ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            {data.status === "running" ? (
              <span className="run-text-trigger">Running...</span>
            ) : (
              <>
                <span className="run-text-trigger">Run</span>
                {hasRunCredits ? <RunCreditBadge credits={runCredits} runButton /> : null}
              </>
            )}
          </button>
          <button
            className="tanva-video-header-btn tanva-video-header-share"
            onClick={() => copyVideoLink(data.videoUrl)}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={!data.videoUrl}
            style={{ ...styles.iconBtn, opacity: data.videoUrl ? 1 : 0.35, cursor: data.videoUrl ? "pointer" : "not-allowed" }}
          >
            <Share2 size={14} />
          </button>
          <button
            className="tanva-video-header-btn tanva-video-header-download"
            onClick={() => triggerDownload(data.videoUrl)}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={!data.videoUrl || isDownloading}
            style={{
              ...styles.iconBtn,
              background: !data.videoUrl || isDownloading ? "#e5e7eb" : "#111827",
              opacity: !data.videoUrl || isDownloading ? 0.35 : 1,
              cursor: !data.videoUrl || isDownloading ? "not-allowed" : "pointer",
            }}
          >
            {isDownloading ? <span style={{ fontSize: 10, fontWeight: 600, color: "#111827" }}>...</span> : <Download size={14} />}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: videoInputCount > 0 ? 4 : 8 }}>
        <label style={{ fontSize: 11, color: "#475569" }}>
          <div style={{ marginBottom: 3 }}>{lt("模式", "Mode")}</div>
          <NodeSelect
            value={effectiveVideoMode}
            options={MODE_OPTIONS}
            onChange={(v) => updateNodeData({ videoMode: v })}
            menuLabel={lt("模式", "Mode")}
            title={lt("选择生成模式", "Select generation mode")}
          />
        </label>
        <label style={{ fontSize: 11, color: "#475569" }}>
          <div style={{ marginBottom: 3 }}>{lt("时长", "Duration")}</div>
          <NodeSelect
            value={String(duration)}
            options={DURATION_OPTIONS.map((v) => ({ value: String(v), label: `${v}s` }))}
            onChange={(v) => updateNodeData({ duration: Number(v) })}
            menuLabel={lt("时长", "Duration")}
            title={lt("选择时长", "Select duration")}
          />
        </label>
        <label style={{ fontSize: 11, color: "#475569" }}>
          <div style={{ marginBottom: 3 }}>{lt("分辨率", "Resolution")}</div>
          <NodeSelect
            value={resolution}
            options={RESOLUTION_OPTIONS.map((v) => ({ value: v, label: v }))}
            onChange={(v) => updateNodeData({ resolution: v })}
            menuLabel={lt("分辨率", "Resolution")}
            title={lt("选择分辨率", "Select resolution")}
          />
        </label>
        <label style={{ fontSize: 11, color: "#475569" }}>
          <div style={{ marginBottom: 3 }}>{lt("比例", "Ratio")}</div>
          <NodeSelect
            value={aspectRatio}
            options={ASPECT_OPTIONS.map((v) => ({ value: v, label: v }))}
            onChange={(v) => updateNodeData({ aspectRatio: v })}
            menuLabel={lt("比例", "Ratio")}
            title={lt("选择画面比例", "Select aspect ratio")}
          />
        </label>
      </div>
      {videoInputCount > 0 && (
        <div style={{ marginBottom: 8, color: "#64748b", fontSize: 10, lineHeight: 1.35 }}>
          {lt(
            "已接入参考视频：本次按参考模式发送，不下发时长。",
            "Reference video connected: this run uses reference mode and omits duration."
          )}
        </div>
      )}

      {/* Video preview */}
      <div
        style={{
          width: "100%",
          aspectRatio: previewAspect,
          minHeight: 120,
          background: "#f8fafc",
          borderRadius: 6,
          border: "1px solid #eef0f2",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          marginBottom: 8,
        }}
      >
        {sanitizedVideoUrl ? (
          <video
            key={`${sanitizedVideoUrl}-${data.videoVersion || 0}`}
            controls
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6, background: "#000" }}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`);
            }}
          >
            <source src={sanitizedVideoUrl} type="video/mp4" />
          </video>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "#94a3b8" }}>
            <Video size={24} strokeWidth={2} />
            <div style={{ fontSize: 11 }}>{lt("等待生成...", "Waiting for generation...")}</div>
          </div>
        )}
      </div>

      <GenerationProgressBar status={data.status || "idle"} startedAt={data.progressStartedAt} runKey={id} />

      {validationMessages.length > 0 && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #fcd34d",
            background: "#fffbeb",
            color: "#92400e",
            fontSize: 11,
            display: "grid",
            gap: 4,
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
            <AlertTriangle size={12} />
            <span>{lt("参数提示", "Validation hints")}</span>
          </div>
          {validationMessages.map((msg, idx) => (
            <div key={`omni-flash-ext-validation-${idx}`}>{`${idx + 1}. ${msg}`}</div>
          ))}
        </div>
      )}

      {displayError && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 8px",
            background: "#fef2f2",
            border: "1px solid #fecdd3",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 12,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <AlertTriangle size={14} />
          <span>{displayError}</span>
        </div>
      )}
    </div>
  );
}

export default React.memo(OmniFlashExtVideoNode);
