import React from "react";
import { Handle, Position } from "reactflow";
import { Video, Share2, Download, Plus, Minus } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";
import RunCreditBadge from "./RunCreditBadge";
import { useNodeRunCredits } from "../hooks/useNodeRunCredits";
import { useBackendCreditsPreview } from "../hooks/useBackendCreditsPreview";

type VideoHistoryItem = {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  prompt: string;
  createdAt: string;
  elapsedSeconds?: number;
  quality?: string;
  referenceCount?: number;
};

type Resolution = "720P" | "1080P";
type Ratio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";

type HappyhorseModel =
  | "happyhorse-1.0-t2v"
  | "happyhorse-1.0-i2v"
  | "happyhorse-1.0-r2v"
  | "happyhorse-1.0-video-edit";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    videoUrl?: string;
    thumbnail?: string;
    error?: string;
    videoVersion?: number;
    onRun?: (id: string) => void;
    creditsPerCall?: number;
    model?: HappyhorseModel;
    ratio?: Ratio;
    resolution?: Resolution;
    duration?: number;
    referenceCount?: number; // 1 ~ 9（仅 r2v 模式生效）
    history?: VideoHistoryItem[];
    taskId?: string;
    apiUsageId?: string;
    pendingPrompt?: string;
    pendingQuality?: string;
    pendingReferenceCount?: number;
  };
  selected?: boolean;
};

const RATIO_OPTIONS: Ratio[] = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const RESOLUTION_OPTIONS: Resolution[] = ["720P", "1080P"];
const DURATION_OPTIONS: number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const MIN_REFS = 1;
const MAX_REFS = 9;

const DEFAULT_MODEL: HappyhorseModel = "happyhorse-1.0-r2v";

const MODEL_OPTIONS: Array<{ value: HappyhorseModel; zh: string; en: string }> = [
  { value: "happyhorse-1.0-t2v",        zh: "文生视频",   en: "Text → Video" },
  { value: "happyhorse-1.0-i2v",        zh: "图生视频",   en: "Image → Video" },
  { value: "happyhorse-1.0-r2v",        zh: "参考视频",   en: "Reference → Video" },
  { value: "happyhorse-1.0-video-edit", zh: "视频改写",   en: "Video Edit" },
];

type ModelCaps = {
  /** 是否使用 image-N 列表（r2v 才动态 1~9，i2v/video-edit 固定 1 张） */
  imageHandles: number; // image-1 到 image-N 的 N；0 表示无 image handle
  /** 是否需要 video 输入 handle（仅 video-edit） */
  hasVideoHandle: boolean;
  /** 是否暴露画幅下拉 */
  showsRatio: boolean;
  /** 是否允许调整 referenceCount（仅 r2v） */
  showsReferenceCount: boolean;
};

const computeCaps = (model: HappyhorseModel, referenceCount: number): ModelCaps => {
  const cappedRefs = Math.min(MAX_REFS, Math.max(MIN_REFS, referenceCount));
  switch (model) {
    case "happyhorse-1.0-t2v":
      return { imageHandles: 0, hasVideoHandle: false, showsRatio: true, showsReferenceCount: false };
    case "happyhorse-1.0-i2v":
      return { imageHandles: 1, hasVideoHandle: false, showsRatio: false, showsReferenceCount: false };
    case "happyhorse-1.0-r2v":
      return { imageHandles: cappedRefs, hasVideoHandle: false, showsRatio: true, showsReferenceCount: true };
    case "happyhorse-1.0-video-edit":
      return { imageHandles: 1, hasVideoHandle: true, showsRatio: false, showsReferenceCount: false };
  }
};

function HappyhorseR2VNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadFeedback, setDownloadFeedback] = React.useState<{
    type: "progress" | "success" | "error";
    message: string;
  } | null>(null);
  const downloadFeedbackTimer = React.useRef<number | undefined>(undefined);
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const [ratioMenuOpen, setRatioMenuOpen] = React.useState(false);
  const [resMenuOpen, setResMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);

  const model: HappyhorseModel = (data.model as HappyhorseModel) || DEFAULT_MODEL;
  const ratio: Ratio = (data.ratio as Ratio) || "16:9";
  const resolution: Resolution = (data.resolution as Resolution) || "720P";
  const duration: number =
    typeof data.duration === "number" && Number.isFinite(data.duration)
      ? Math.min(15, Math.max(3, Math.round(data.duration)))
      : 5;
  const referenceCount: number = (() => {
    const raw = Number(data.referenceCount);
    if (!Number.isFinite(raw)) return 1;
    return Math.min(MAX_REFS, Math.max(MIN_REFS, Math.round(raw)));
  })();
  const caps = React.useMemo(
    () => computeCaps(model, referenceCount),
    [model, referenceCount]
  );

  const previewRequestParams = React.useMemo(
    () => ({
      generationMode:
        model === "happyhorse-1.0-t2v"
          ? "t2v"
          : model === "happyhorse-1.0-i2v"
          ? "i2v"
          : model === "happyhorse-1.0-video-edit"
          ? "video-edit"
          : "r2v",
      resolution,
      duration,
      durationSec: duration,
    }),
    [model, resolution, duration]
  );
  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: "happyhorse-r2v-video",
    model,
    requestParams: {
      managedModelKey: model,
      modelKey: model,
      vendorKey: "dashscope",
      platformKey: "dashscope",
      aiProvider: "dashscope",
      ...previewRequestParams,
    },
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;
  const { credits: runCredits, hasCredits: hasRunCredits } =
    useNodeRunCredits(resolvedRunCredits);

  const historyItems = React.useMemo<VideoHistoryItem[]>(
    () => (Array.isArray(data.history) ? data.history : []),
    [data.history]
  );

  const dispatchPatch = React.useCallback(
    (patch: Record<string, any>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", { detail: { id, patch } })
      );
    },
    [id]
  );

  const handleApplyHistory = React.useCallback(
    (item: VideoHistoryItem) => {
      const patch: Record<string, any> = {
        videoUrl: item.videoUrl,
        thumbnail: item.thumbnail,
        videoVersion: Number(data.videoVersion || 0) + 1,
      };
      if (data.status !== "running") {
        patch.status = "succeeded";
        patch.error = undefined;
      }
      dispatchPatch(patch);
    },
    [dispatchPatch, data.videoVersion, data.status]
  );

  const formatHistoryTime = React.useCallback((iso: string) => {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }, []);

  const truncatePrompt = React.useCallback(
    (text: string) => {
      if (!text) return lt("（无提示词）", "(No prompt)");
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    },
    [lt]
  );

  const scheduleFeedbackClear = React.useCallback((delay: number = 3000) => {
    if (downloadFeedbackTimer.current) {
      window.clearTimeout(downloadFeedbackTimer.current);
      downloadFeedbackTimer.current = undefined;
    }
    downloadFeedbackTimer.current = window.setTimeout(() => {
      setDownloadFeedback(null);
      downloadFeedbackTimer.current = undefined;
    }, delay);
  }, []);

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
    () => sanitizeMediaUrl((data as any)?.videoUrl),
    [data, sanitizeMediaUrl]
  );
  const sanitizedThumbnail = React.useMemo(
    () => sanitizeMediaUrl((data as any)?.thumbnail),
    [data, sanitizeMediaUrl]
  );

  React.useEffect(() => {
    if (!videoRef.current || !sanitizedVideoUrl) return;
    try {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      videoRef.current.load();
    } catch (error) {
      console.warn("Unable to reset video player", error);
    }
  }, [sanitizedVideoUrl]);

  React.useEffect(() => {
    return () => {
      if (downloadFeedbackTimer.current) {
        window.clearTimeout(downloadFeedbackTimer.current);
        downloadFeedbackTimer.current = undefined;
      }
    };
  }, []);

  const copyVideoLink = React.useCallback(
    async (url?: string) => {
      if (!url) {
        setDownloadFeedback({
          type: "error",
          message: lt("没有可复制的视频链接", "No video link to copy"),
        });
        scheduleFeedbackClear(2000);
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          setDownloadFeedback({
            type: "success",
            message: lt("已复制视频链接", "Video link copied"),
          });
          scheduleFeedbackClear(2000);
          return;
        }
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setDownloadFeedback({
          type: "success",
          message: lt("已复制视频链接", "Video link copied"),
        });
        scheduleFeedbackClear(2000);
      } catch {
        setDownloadFeedback({
          type: "error",
          message: lt("复制失败", "Copy failed"),
        });
        scheduleFeedbackClear(2000);
      }
    },
    [scheduleFeedbackClear, lt]
  );

  const triggerDownload = React.useCallback(
    async (url?: string) => {
      if (!url || isDownloading) return;
      setIsDownloading(true);
      setDownloadFeedback({
        type: "progress",
        message: lt("视频下载中，请稍等...", "Downloading video, please wait..."),
      });
      try {
        const isOss = url.includes("aliyuncs.com");
        const downloadUrl = isOss
          ? url
          : proxifyRemoteAssetUrl(url, { forceProxy: true });
        const response = await fetch(downloadUrl, {
          mode: "cors",
          credentials: "omit",
        });
        if (response.ok) {
          const blob = await response.blob();
          const videoBlob = blob.type.startsWith("video/")
            ? blob
            : new Blob([blob], { type: "video/mp4" });
          const blobUrl = URL.createObjectURL(videoBlob);
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = `video-${new Date().toISOString().split("T")[0]}.mp4`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
          setDownloadFeedback({
            type: "success",
            message: lt("下载完成", "Download complete"),
          });
        } else {
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setDownloadFeedback({
            type: "success",
            message: lt(
              "已在新标签页打开视频链接",
              "Opened video link in a new tab"
            ),
          });
        }
        scheduleFeedbackClear(3000);
      } catch (error) {
        console.error("Download failed:", error);
        setDownloadFeedback({
          type: "error",
          message: lt(
            "下载失败，请稍后重试",
            "Download failed, please try again later"
          ),
        });
        scheduleFeedbackClear(4000);
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, scheduleFeedbackClear, lt]
  );

  const renderPreview = () => {
    const commonStyle: React.CSSProperties = {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      borderRadius: 6,
      background: "#000",
    };
    if (sanitizedVideoUrl) {
      return (
        <video
          key={`${sanitizedVideoUrl}-${data.videoVersion || 0}`}
          ref={videoRef}
          controls
          poster={sanitizedThumbnail}
          style={commonStyle}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`);
            }
          }}
        >
          <source src={sanitizedVideoUrl} type="video/mp4" />
        </video>
      );
    }
    if (sanitizedThumbnail) {
      return (
        <SmartImage
          src={sanitizedThumbnail}
          alt="video thumbnail"
          style={commonStyle}
        />
      );
    }
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          color: "#94a3b8",
        }}
      >
        <Video size={24} strokeWidth={2} />
        <div style={{ fontSize: 11 }}>
          {lt("等待生成...", "Waiting for generation...")}
        </div>
      </div>
    );
  };

  const imageHandleCount = caps.imageHandles;
  const referenceIndices = React.useMemo(
    () => Array.from({ length: imageHandleCount }, (_, i) => i + 1),
    [imageHandleCount]
  );

  const handleAdjustReferenceCount = React.useCallback(
    (delta: number) => {
      const next = Math.min(MAX_REFS, Math.max(MIN_REFS, referenceCount + delta));
      if (next !== referenceCount) {
        dispatchPatch({ referenceCount: next });
      }
    },
    [dispatchPatch, referenceCount]
  );

  const handleSelectModel = React.useCallback(
    (next: HappyhorseModel) => {
      if (next === model) return;
      // 切换 model 时同时通知 FlowOverlay 清理不兼容连线
      dispatchPatch({ model: next });
      window.dispatchEvent(
        new CustomEvent("happyhorse:modelChanged", {
          detail: { id, model: next },
        })
      );
    },
    [dispatchPatch, id, model]
  );

  // image handle 在 25%~75% 之间均分；image-1 永远是首位（i2v / video-edit 用同一 handle id）
  const refHandleTopBase = 25;
  const refHandleStep = imageHandleCount > 0 ? 50 / imageHandleCount : 50;

  return (
    <div
      style={{
        width: 280,
        padding: 10,
        background: "#fff",
        border: `1px solid ${selected ? "#2563eb" : "#e5e7eb"}`,
        borderRadius: 10,
        boxShadow: selected
          ? "0 0 0 2px rgba(37,99,235,0.12)"
          : "0 1px 2px rgba(0,0,0,0.04)",
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: "10%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      {referenceIndices.map((idx, arrIdx) => (
        <Handle
          key={`image-${idx}`}
          type="target"
          position={Position.Left}
          id={`image-${idx}`}
          style={{
            top: `${refHandleTopBase + refHandleStep * (arrIdx + 0.5)}%`,
          }}
          onMouseEnter={() => setHover(`image-${idx}-in`)}
          onMouseLeave={() => setHover(null)}
        />
      ))}
      {caps.hasVideoHandle && (
        <Handle
          type="target"
          position={Position.Left}
          id="video"
          style={{ top: "82%" }}
          onMouseEnter={() => setHover("video-in")}
          onMouseLeave={() => setHover(null)}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("video-out")}
        onMouseLeave={() => setHover(null)}
      />

      {hover === "text-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "10%", transform: "translate(-100%, -50%)" }}
        >
          prompt
        </div>
      )}
      {referenceIndices.map((idx, arrIdx) =>
        hover === `image-${idx}-in` ? (
          <div
            key={`tip-image-${idx}`}
            className="flow-tooltip"
            style={{
              left: -8,
              top: `${refHandleTopBase + refHandleStep * (arrIdx + 0.5)}%`,
              transform: "translate(-100%, -50%)",
            }}
          >
            character{idx}
          </div>
        ) : null
      )}
      {hover === "video-in" && caps.hasVideoHandle && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "82%", transform: "translate(-100%, -50%)" }}
        >
          video
        </div>
      )}
      {hover === "video-out" && (
        <div
          className="flow-tooltip"
          style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}
        >
          video
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Video size={18} />
          <span>{lt("快乐马", "HappyHorse")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className="tanva-video-header-btn tanva-video-header-run run-btn-with-credit"
            onClick={() => data.onRun?.(id)}
            disabled={data.status === "running"}
            style={{
              minWidth: hasRunCredits ? 64 : 36,
              height: 32,
              padding: hasRunCredits ? "0 10px" : undefined,
              borderRadius: 8,
              border: "none",
              background: data.status === "running" ? "#e5e7eb" : "#111827",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: data.status === "running" ? "not-allowed" : "pointer",
              fontSize: 12,
              opacity: data.status === "running" ? 0.6 : 1,
            }}
          >
            {data.status === "running" ? (
              <span className="run-text-trigger">Running...</span>
            ) : (
              <>
                <span className="run-text-trigger">Run</span>
                {hasRunCredits ? (
                  <RunCreditBadge credits={runCredits} runButton />
                ) : null}
              </>
            )}
          </button>
          <button
            className="tanva-video-header-btn tanva-video-header-share"
            onClick={() => copyVideoLink((data as any)?.videoUrl)}
            title={lt("复制链接", "Copy link")}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: "#111827",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: (data as any)?.videoUrl ? "pointer" : "not-allowed",
              color: "#fff",
              opacity: (data as any)?.videoUrl ? 1 : 0.35,
            }}
            disabled={!(data as any)?.videoUrl}
          >
            <Share2 size={14} />
          </button>
          <button
            className="tanva-video-header-btn tanva-video-header-download"
            onClick={() => triggerDownload((data as any)?.videoUrl)}
            title={lt("下载视频", "Download video")}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: !(data as any)?.videoUrl ? "#e5e7eb" : "#111827",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: !(data as any)?.videoUrl ? "not-allowed" : "pointer",
              color: "#fff",
              opacity: !(data as any)?.videoUrl ? 0.35 : 1,
            }}
            disabled={!(data as any)?.videoUrl || isDownloading}
          >
            {isDownloading ? (
              <span style={{ fontSize: 10, fontWeight: 600, color: "#111827" }}>
                ···
              </span>
            ) : (
              <Download size={14} />
            )}
          </button>
        </div>
      </div>

      {downloadFeedback && (
        <div
          style={{
            margin: "2px 0",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 11,
            border: `1px solid ${
              downloadFeedback.type === "error"
                ? "#fecaca"
                : downloadFeedback.type === "success"
                ? "#bbf7d0"
                : "#bfdbfe"
            }`,
            background:
              downloadFeedback.type === "error"
                ? "#fef2f2"
                : downloadFeedback.type === "success"
                ? "#ecfdf5"
                : "#eff6ff",
            color:
              downloadFeedback.type === "error"
                ? "#b91c1c"
                : downloadFeedback.type === "success"
                ? "#15803d"
                : "#1d4ed8",
          }}
        >
          {downloadFeedback.message}
        </div>
      )}

      {/* 模式选择 */}
      <div
        className="sora2-dropdown"
        style={{ marginBottom: 8, position: "relative" }}
      >
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          {lt("模式", "Mode")}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRatioMenuOpen(false);
            setResMenuOpen(false);
            setDurationMenuOpen(false);
            setModelMenuOpen((o) => !o);
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <span>
            {(() => {
              const opt = MODEL_OPTIONS.find((m) => m.value === model);
              return opt ? lt(opt.zh, opt.en) : model;
            })()}
          </span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>
            {modelMenuOpen ? "▴" : "▾"}
          </span>
        </button>
        {modelMenuOpen && (
          <div
            className="sora2-dropdown-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              zIndex: 20,
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 8,
              boxShadow: "0 8px 16px rgba(15,23,42,0.08)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {MODEL_OPTIONS.map((opt) => {
                const active = opt.value === model;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      handleSelectModel(opt.value);
                      setModelMenuOpen(false);
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: `1px solid ${active ? "#2563eb" : "#e5e7eb"}`,
                      background: active ? "#2563eb" : "#fff",
                      color: active ? "#fff" : "#111827",
                      fontSize: 12,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {lt(opt.zh, opt.en)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 参考图数量 +/-（仅 r2v 模式） */}
      {caps.showsReferenceCount && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {lt("参考图数量", "Reference images")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              disabled={referenceCount <= MIN_REFS}
              onClick={() => handleAdjustReferenceCount(-1)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: referenceCount <= MIN_REFS ? "#f3f4f6" : "#fff",
                cursor: referenceCount <= MIN_REFS ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Minus size={12} />
            </button>
            <span style={{ minWidth: 18, textAlign: "center", fontSize: 12 }}>
              {referenceCount}
            </span>
            <button
              type="button"
              disabled={referenceCount >= MAX_REFS}
              onClick={() => handleAdjustReferenceCount(1)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: referenceCount >= MAX_REFS ? "#f3f4f6" : "#fff",
                cursor: referenceCount >= MAX_REFS ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      )}

      {/* ratio 下拉（仅 t2v / r2v 暴露；i2v / video-edit 由输入决定画幅） */}
      {caps.showsRatio && (
        <div
          className="sora2-dropdown"
          style={{ marginBottom: 8, position: "relative" }}
        >
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("画幅", "Ratio")}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setResMenuOpen(false);
              setDurationMenuOpen(false);
              setRatioMenuOpen((o) => !o);
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <span>{ratio}</span>
            <span style={{ fontSize: 16, lineHeight: 1 }}>
              {ratioMenuOpen ? "▴" : "▾"}
            </span>
          </button>
          {ratioMenuOpen && (
            <div
              className="sora2-dropdown-menu"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                zIndex: 20,
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 8,
                boxShadow: "0 8px 16px rgba(15,23,42,0.08)",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {RATIO_OPTIONS.map((opt) => {
                  const active = opt === ratio;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        dispatchPatch({ ratio: opt });
                        setRatioMenuOpen(false);
                      }}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: `1px solid ${active ? "#2563eb" : "#e5e7eb"}`,
                        background: active ? "#2563eb" : "#fff",
                        color: active ? "#fff" : "#111827",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* resolution 下拉 */}
      <div
        className="sora2-dropdown"
        style={{ marginBottom: 8, position: "relative" }}
      >
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          {lt("分辨率", "Resolution")}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRatioMenuOpen(false);
            setDurationMenuOpen(false);
            setResMenuOpen((o) => !o);
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <span>{resolution}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>
            {resMenuOpen ? "▴" : "▾"}
          </span>
        </button>
        {resMenuOpen && (
          <div
            className="sora2-dropdown-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              zIndex: 20,
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 8,
              boxShadow: "0 8px 16px rgba(15,23,42,0.08)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {RESOLUTION_OPTIONS.map((opt) => {
                const active = opt === resolution;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      dispatchPatch({ resolution: opt });
                      setResMenuOpen(false);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "#2563eb" : "#e5e7eb"}`,
                      background: active ? "#2563eb" : "#fff",
                      color: active ? "#fff" : "#111827",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* duration 下拉 */}
      <div
        className="sora2-dropdown"
        style={{ marginBottom: 8, position: "relative" }}
      >
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          {lt("时间长度", "Duration")}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRatioMenuOpen(false);
            setResMenuOpen(false);
            setDurationMenuOpen((o) => !o);
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: "#fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <span>{lt(`${duration}秒`, `${duration}s`)}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>
            {durationMenuOpen ? "▴" : "▾"}
          </span>
        </button>
        {durationMenuOpen && (
          <div
            className="sora2-dropdown-menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              zIndex: 20,
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 8,
              boxShadow: "0 8px 16px rgba(15,23,42,0.08)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DURATION_OPTIONS.map((opt) => {
                const active = opt === duration;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      dispatchPatch({ duration: opt });
                      setDurationMenuOpen(false);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "#2563eb" : "#e5e7eb"}`,
                      background: active ? "#2563eb" : "#fff",
                      color: active ? "#fff" : "#111827",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          width: "100%",
          aspectRatio: previewAspect,
          minHeight: 140,
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
        {renderPreview()}
      </div>
      <GenerationProgressBar status={data.status || "idle"} />

      {historyItems.length > 0 && (
        <div
          className="tanva-video-history"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
            }}
            onClick={() => setShowHistory(!showHistory)}
          >
            <span
              style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}
            >
              {lt("历史记录", "History")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {historyItems.length} {lt("条", "items")}
              </span>
              <span style={{ fontSize: 14, color: "#64748b" }}>
                {showHistory ? "▴" : "▾"}
              </span>
            </div>
          </div>
          {showHistory &&
            historyItems.map((item, index) => {
              const isActive = item.videoUrl === data.videoUrl;
              return (
                <div
                  className="tanva-video-history-item"
                  key={item.id}
                  style={{
                    borderRadius: 6,
                    border:
                      "1px solid " + (isActive ? "#c7d2fe" : "#e2e8f0"),
                    background: isActive ? "#eef2ff" : "#fff",
                    padding: "6px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 11,
                      color: "#475569",
                    }}
                  >
                    <span>
                      #{index + 1} · {formatHistoryTime(item.createdAt)}
                    </span>
                    {isActive && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "#1d4ed8",
                          fontWeight: 600,
                        }}
                      >
                        {lt("当前", "Current")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#0f172a" }}>
                    {truncatePrompt(item.prompt)}
                  </div>
                  <div
                    style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                  >
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => handleApplyHistory(item)}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: "1px solid #94a3b8",
                          background: "#fff",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        {lt("设为当前", "Set as current")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => copyVideoLink(item.videoUrl)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #94a3b8",
                        background: "#fff",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {lt("复制链接", "Copy link")}
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerDownload(item.videoUrl)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #94a3b8",
                        background: "#fff",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {lt("下载", "Download")}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {data.error && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 8px",
            background: "#fef2f2",
            border: "1px solid #fecdd3",
            borderRadius: 6,
            color: "#b91c1c",
            fontSize: 12,
          }}
        >
          {data.error}
        </div>
      )}
    </div>
  );
}

export default React.memo(HappyhorseR2VNodeInner);
