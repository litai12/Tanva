import React from "react";
import { Handle, Position } from "reactflow";
import { AlertTriangle, Video, Share2, Download } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { useAuthStore } from "@/stores/authStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    videoUrl?: string;
    thumbnail?: string;
    error?: string;
    videoVersion?: number;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
    clipDuration?: number;
    aspectRatio?: string;
    mode?: "std" | "pro";
    history?: VideoHistoryItem[];
    fallbackMessage?: string;
    // 视频编辑参数
    hasVideoInput?: boolean;
    referenceVideoType?: "feature" | "motion" | "expression";
  };
  selected?: boolean;
};

type VideoHistoryItem = {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  prompt: string;
  createdAt: string;
  elapsedSeconds?: number;
};

type DownloadFeedback = {
  type: "progress" | "success" | "error";
  message: string;
};

function KlingO1VideoNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const [aspectMenuOpen, setAspectMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const [videoRefTypeMenuOpen, setVideoRefTypeMenuOpen] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadFeedback, setDownloadFeedback] =
    React.useState<DownloadFeedback | null>(null);
  const downloadFeedbackTimer = React.useRef<number | undefined>(undefined);

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

  const sanitizedThumbnail = React.useMemo(
    () => sanitizeMediaUrl(data.thumbnail),
    [data.thumbnail, sanitizeMediaUrl]
  );

  const cacheBustedVideoUrl = React.useMemo(() => {
    if (!sanitizedVideoUrl) return undefined;
    const isPresigned =
      /[?&](?:X-Amz|X-Tos)[^=]*=/i.test(sanitizedVideoUrl) ||
      /x-amz-|x-tos-/i.test(sanitizedVideoUrl);
    if (isPresigned) return sanitizedVideoUrl;
    const version = Number(data.videoVersion || 0);
    const separator = sanitizedVideoUrl.includes("?") ? "&" : "?";
    return `${sanitizedVideoUrl}${separator}v=${version}&_ts=${Date.now()}`;
  }, [sanitizedVideoUrl, data.videoVersion]);

  const handleMediaError = React.useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { thumbnail: undefined, videoUrl: undefined } },
      })
    );
  }, [id]);

  React.useEffect(() => {
    if (!videoRef.current || !sanitizedVideoUrl) return;
    try {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      videoRef.current.load();
    } catch (error) {
      console.warn("Unable to reset video player", error);
    }
  }, [cacheBustedVideoUrl, sanitizedVideoUrl]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest?.(".video-dropdown")) {
        setAspectMenuOpen(false);
        setDurationMenuOpen(false);
        setVideoRefTypeMenuOpen(false);
      }
    };
    window.addEventListener("click", handleClickOutside);
    return () => {
      window.removeEventListener("click", handleClickOutside);
      if (downloadFeedbackTimer.current) {
        window.clearTimeout(downloadFeedbackTimer.current);
        downloadFeedbackTimer.current = undefined;
      }
    };
  }, []);

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

  const onRun = React.useCallback(() => data.onRun?.(id), [data, id]);

  const clipDuration =
    typeof data.clipDuration === "number" ? data.clipDuration : undefined;
  const aspectRatioValue =
    typeof data.aspectRatio === "string" ? data.aspectRatio : "";
  const hasVideoInput = !!data.hasVideoInput;
  const referenceVideoType = data.referenceVideoType || "feature";

  // Kling O1 支持 3-10 秒
  const aspectOptions = [
    { label: lt("自动", "Auto"), value: "" },
    { label: lt("横屏（16:9）", "Landscape (16:9)"), value: "16:9" },
    { label: lt("竖屏（9:16）", "Portrait (9:16)"), value: "9:16" },
    { label: lt("方形（1:1）", "Square (1:1)"), value: "1:1" },
  ];

  const durationOptions = [
    { label: lt("3秒", "3s"), value: 3 },
    { label: lt("4秒", "4s"), value: 4 },
    { label: lt("5秒", "5s"), value: 5 },
    { label: lt("6秒", "6s"), value: 6 },
    { label: lt("7秒", "7s"), value: 7 },
    { label: lt("8秒", "8s"), value: 8 },
    { label: lt("9秒", "9s"), value: 9 },
    { label: lt("10秒", "10s"), value: 10 },
  ];

  const videoRefTypeOptions = [
    { label: lt("特征参考", "Feature reference"), value: "feature", desc: lt("风格/色调/画面特征", "Style / tone / visual features") },
    { label: lt("动作参考", "Motion reference"), value: "motion", desc: lt("运动轨迹和动作", "Motion trajectory and actions") },
    { label: lt("表情参考", "Expression reference"), value: "expression", desc: lt("人物表情变化", "Facial expression changes") },
  ];

  const handleAspectChange = React.useCallback(
    (value: string) => {
      if (value === aspectRatioValue) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { aspectRatio: value || undefined } },
        })
      );
    },
    [aspectRatioValue, id]
  );

  const handleDurationChange = React.useCallback(
    (value: number) => {
      if (value === clipDuration) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { clipDuration: value } },
        })
      );
    },
    [clipDuration, id]
  );

  const handleVideoRefTypeChange = React.useCallback(
    (value: "feature" | "motion" | "expression") => {
      if (value === referenceVideoType) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { referenceVideoType: value } },
        })
      );
    },
    [referenceVideoType, id]
  );

  const aspectLabel = React.useMemo(() => {
    const match = aspectOptions.find((opt) => opt.value === aspectRatioValue);
    return match ? match.label : lt("自动", "Auto");
  }, [aspectOptions, aspectRatioValue, lt]);

  const durationLabel = React.useMemo(() => {
    const match = durationOptions.find((opt) => opt.value === clipDuration);
    if (match) return match.label;
    if (clipDuration) return lt(`${clipDuration}秒`, `${clipDuration}s`);
    return lt("5秒", "5s");
  }, [clipDuration, durationOptions, lt]);

  const videoRefTypeLabel = React.useMemo(() => {
    const match = videoRefTypeOptions.find((opt) => opt.value === referenceVideoType);
    return match ? match.label : lt("特征参考", "Feature reference");
  }, [lt, referenceVideoType, videoRefTypeOptions]);

  React.useEffect(() => {
    if (!aspectRatioValue) {
      setPreviewAspect("16/9");
      return;
    }
    const [w, h] = aspectRatioValue.split(":");
    if (w && h) {
      setPreviewAspect(`${w}/${h}`);
    }
  }, [aspectRatioValue]);

  const feedbackColors = React.useMemo(() => {
    if (!downloadFeedback) return null;
    if (downloadFeedback.type === "error") {
      return { color: "#b91c1c", background: "#fef2f2", borderColor: "#fecaca" };
    }
    if (downloadFeedback.type === "success") {
      return { color: "#15803d", background: "#ecfdf5", borderColor: "#bbf7d0" };
    }
    return { color: "#1d4ed8", background: "#eff6ff", borderColor: "#bfdbfe" };
  }, [downloadFeedback]);

  const isDownloadDisabled = !data.videoUrl || isDownloading;
  const historyItems = React.useMemo<VideoHistoryItem[]>(
    () => (Array.isArray(data.history) ? data.history : []),
    [data.history]
  );

  const formatHistoryTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
    } catch {
      return "";
    }
  };

  const truncatePrompt = (prompt: string, maxLen = 40) => {
    if (!prompt) return "";
    return prompt.length > maxLen ? prompt.slice(0, maxLen) + "..." : prompt;
  };

  const handleApplyHistory = React.useCallback(
    (item: VideoHistoryItem) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              videoUrl: item.videoUrl,
              thumbnail: item.thumbnail,
              videoVersion: (data.videoVersion || 0) + 1,
            },
          },
        })
      );
    },
    [id, data.videoVersion]
  );

  const copyVideoLink = React.useCallback(async (url?: string) => {
    if (!url) {
      alert(lt("没有可复制的视频链接", "No video link to copy"));
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        alert(lt("已复制视频链接", "Video link copied"));
        return;
      }
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (success) {
        alert(lt("已复制视频链接", "Video link copied"));
      } else {
        alert(lt("复制失败，请手动复制：\n", "Copy failed, please copy manually:\n") + url);
      }
    } catch (error) {
      console.error("Copy failed:", error);
      prompt(lt("复制失败，请手动复制以下链接：", "Copy failed, please manually copy this link:"), url);
    }
  }, [lt]);

  const triggerDownload = React.useCallback(
    async (url?: string) => {
      if (!url || isDownloading) return;
      if (downloadFeedbackTimer.current) {
        window.clearTimeout(downloadFeedbackTimer.current);
        downloadFeedbackTimer.current = undefined;
      }
      setIsDownloading(true);
      setDownloadFeedback({ type: "progress", message: lt("视频下载中，请稍等...", "Downloading video, please wait...") });
      try {
        const isOssUrl = url.includes("aliyuncs.com");
        const downloadUrl = isOssUrl ? url : proxifyRemoteAssetUrl(url, { forceProxy: true });
        const response = await fetch(downloadUrl, { mode: "cors", credentials: "omit" });
        if (response.ok) {
          const blob = await response.blob();
          const videoBlob = blob.type.startsWith("video/")
            ? blob
            : new Blob([blob], { type: "video/mp4" });
          const blobUrl = URL.createObjectURL(videoBlob);
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = `kling-o1-${new Date().toISOString().split("T")[0]}.mp4`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
          setDownloadFeedback({ type: "success", message: lt("下载完成", "Download complete") });
          scheduleFeedbackClear(2000);
        } else {
          window.open(url, "_blank");
          setDownloadFeedback({ type: "success", message: lt("已在新标签页打开", "Opened in a new tab") });
          scheduleFeedbackClear(3000);
        }
      } catch (error) {
        console.error("Download failed:", error);
        window.open(url, "_blank");
        setDownloadFeedback({ type: "error", message: lt("下载失败，已在新标签页打开", "Download failed, opened in a new tab") });
        scheduleFeedbackClear(4000);
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, lt, scheduleFeedbackClear]
  );

  const handleMediaPointerDown = (event: React.PointerEvent | React.MouseEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as any).nativeEvent;
    nativeEvent?.stopImmediatePropagation?.();
  };

  const handleMediaTouchStart = (event: React.TouchEvent) => {
    event.stopPropagation();
    event.nativeEvent?.stopImmediatePropagation?.();
  };

  const handleButtonMouseDown = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  const renderPreview = () => {
    const commonMediaStyle: React.CSSProperties = {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      borderRadius: 6,
      background: "#000",
    };

    if (sanitizedVideoUrl) {
      const rawSrc = cacheBustedVideoUrl || sanitizedVideoUrl;
      const videoSrc = proxifyRemoteAssetUrl(rawSrc);
      return (
        <video
          key={`${videoSrc}-${data.videoVersion || 0}`}
          ref={videoRef}
          controls
          poster={proxifyRemoteAssetUrl(sanitizedThumbnail || "")}
          style={commonMediaStyle}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`);
            }
          }}
          onPointerDownCapture={handleMediaPointerDown}
          onMouseDownCapture={handleMediaPointerDown}
          onTouchStartCapture={handleMediaTouchStart}
          onError={handleMediaError}
        >
          <source src={videoSrc} type="video/mp4" />
          {lt("您的浏览器不支持 video 标签", "Your browser does not support the video tag")}
        </video>
      );
    }
    if (sanitizedThumbnail) {
      return (
        <SmartImage
          src={proxifyRemoteAssetUrl(sanitizedThumbnail)}
          alt="video thumbnail"
          style={commonMediaStyle}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setPreviewAspect(`${img.naturalWidth}/${img.naturalHeight}`);
            }
          }}
          onPointerDownCapture={handleMediaPointerDown}
          onMouseDownCapture={handleMediaPointerDown}
          onTouchStartCapture={handleMediaTouchStart}
          onError={handleMediaError}
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
        <div style={{ fontSize: 11 }}>{lt("等待生成...", "Waiting for generation...")}</div>
      </div>
    );
  };

  return (
    <div
      style={{
        width: 280,
        padding: 10,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow,
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: "25%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("image-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: "75%" }}
        onMouseEnter={() => setHover("video-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="video-out"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("video-out")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "text-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "25%", transform: "translate(-100%, -50%)" }}>
          prompt
        </div>
      )}
      {hover === "image-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}>
          {lt("image (参考图/首尾帧)", "image (reference / first-last frame)")}
        </div>
      )}
      {hover === "video-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "75%", transform: "translate(-100%, -50%)" }}>
          {lt("video (参考视频)", "video (reference video)")}
        </div>
      )}
      {hover === "video-out" && (
        <div className="flow-tooltip" style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>
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
        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          <Video size={18} />
          <span>Kling O1</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onRun}
            onMouseDown={handleButtonMouseDown}
            disabled={data.status === "running"}
            style={{
              width: 36,
              height: 32,
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
            Run
          </button>
          <button
            onClick={() => copyVideoLink(data.videoUrl)}
            onMouseDown={handleButtonMouseDown}
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
              cursor: data.videoUrl ? "pointer" : "not-allowed",
              color: "#fff",
              opacity: data.videoUrl ? 1 : 0.35,
            }}
            disabled={!data.videoUrl}
          >
            <Share2 size={14} />
          </button>
          <button
            onClick={() => triggerDownload(data.videoUrl)}
            onMouseDown={handleButtonMouseDown}
            title={lt("下载视频", "Download video")}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: isDownloadDisabled ? "#e5e7eb" : "#111827",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: isDownloadDisabled ? "not-allowed" : "pointer",
              color: "#fff",
              opacity: isDownloadDisabled ? 0.35 : 1,
            }}
            disabled={isDownloadDisabled}
          >
            {isDownloading ? (
              <span style={{ fontSize: 10, fontWeight: 600, color: "#111827" }}>···</span>
            ) : (
              <Download size={14} />
            )}
          </button>
        </div>
      </div>

      {downloadFeedback && feedbackColors && (
        <div
          style={{
            margin: "2px 0",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 11,
            border: `1px solid ${feedbackColors.borderColor}`,
            background: feedbackColors.background,
            color: feedbackColors.color,
          }}
        >
          {downloadFeedback.message}
        </div>
      )}

      {/* 尺寸选择 */}
      <div className="video-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("尺寸", "Aspect")}</div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setDurationMenuOpen(false);
            setAspectMenuOpen((open) => !open);
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
          <span>{aspectLabel}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{aspectMenuOpen ? "▴" : "▾"}</span>
        </button>
        {aspectMenuOpen && (
          <div
            className="video-dropdown-menu"
            onClick={(event) => event.stopPropagation()}
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
              {aspectOptions.map((option) => {
                const isActive = option.value === aspectRatioValue;
                return (
                  <button
                    key={option.value || "auto"}
                    type="button"
                    onClick={() => {
                      handleAspectChange(option.value);
                      setAspectMenuOpen(false);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${isActive ? "#2563eb" : "#e5e7eb"}`,
                      background: isActive ? "#2563eb" : "#fff",
                      color: isActive ? "#fff" : "#111827",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 时长选择 */}
      <div className="video-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("时长", "Duration")}</div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setAspectMenuOpen(false);
            setDurationMenuOpen((open) => !open);
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
          <span>{durationLabel}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{durationMenuOpen ? "▴" : "▾"}</span>
        </button>
        {durationMenuOpen && (
          <div
            className="video-dropdown-menu"
            onClick={(event) => event.stopPropagation()}
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
              {durationOptions.map((option) => {
                const isActive = option.value === clipDuration;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      handleDurationChange(option.value);
                      setDurationMenuOpen(false);
                    }}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${isActive ? "#2563eb" : "#e5e7eb"}`,
                      background: isActive ? "#2563eb" : "#fff",
                      color: isActive ? "#fff" : "#111827",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 模式选择 */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("模式", "Mode")}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { label: lt("标准 (std)", "Standard (std)"), value: "std" },
            { label: lt("专业 (pro)", "Pro (pro)"), value: "pro" },
          ].map((opt) => {
            const isActive = (data.mode || "pro") === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  if ((data.mode || "pro") === opt.value) return;
                  window.dispatchEvent(
                    new CustomEvent("flow:updateNodeData", {
                      detail: { id, patch: { mode: opt.value } },
                    })
                  );
                }}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid #e5e7eb`,
                  background: isActive ? "#111827" : "#fff",
                  color: isActive ? "#fff" : "#111827",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 视频参考类型选择 - 仅在有视频输入时显示 */}
      {hasVideoInput && (
        <div className="video-dropdown" style={{ marginBottom: 8, position: "relative" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("视频参考类型", "Video reference type")}</div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setAspectMenuOpen(false);
              setDurationMenuOpen(false);
              setVideoRefTypeMenuOpen((open) => !open);
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
            <span>{videoRefTypeLabel}</span>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{videoRefTypeMenuOpen ? "▴" : "▾"}</span>
          </button>
          {videoRefTypeMenuOpen && (
            <div
              className="video-dropdown-menu"
              onClick={(event) => event.stopPropagation()}
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
                {videoRefTypeOptions.map((option) => {
                  const isActive = option.value === referenceVideoType;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        handleVideoRefTypeChange(option.value as "feature" | "motion" | "expression");
                        setVideoRefTypeMenuOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: `1px solid ${isActive ? "#2563eb" : "transparent"}`,
                        background: isActive ? "#eff6ff" : "#fff",
                        color: "#111827",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontWeight: isActive ? 600 : 400 }}>{option.label}</span>
                      <span style={{ fontSize: 10, color: "#6b7280" }}>{option.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 预览区域 */}
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
        }}
      >
        {renderPreview()}
      </div>

      <GenerationProgressBar
        status={data.status || "idle"}
        progress={data.status === "running" ? 30 : data.status === "succeeded" ? 100 : 0}
      />

      {/* 历史记录 */}
      {historyItems.length > 0 && (
        <div
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{lt("历史记录", "History")}</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{historyItems.length} {lt("条", "items")}</span>
          </div>
          {historyItems.map((item, index) => {
            const isActive = item.videoUrl === data.videoUrl;
            return (
              <div
                key={item.id}
                style={{
                  borderRadius: 6,
                  border: `1px solid ${isActive ? "#c7d2fe" : "#e2e8f0"}`,
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
                    <span style={{ fontSize: 10, color: "#1d4ed8", fontWeight: 600 }}>{lt("当前", "Current")}</span>
                  )}
                </div>
                {typeof item.elapsedSeconds === "number" && (
                  <div style={{ fontSize: 11, color: "#475569" }}>{lt("耗时", "Elapsed")} {item.elapsedSeconds}s</div>
                )}
                <div style={{ fontSize: 11, color: "#0f172a" }}>{truncatePrompt(item.prompt)}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => handleApplyHistory(item)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #94a3b8",
                        background: "#fff",
                        fontSize: 10,
                        color: "#475569",
                        cursor: "pointer",
                      }}
                    >
                      {lt("应用", "Apply")}
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
                      fontSize: 10,
                      color: "#475569",
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
                      fontSize: 10,
                      color: "#475569",
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

      {/* 提示信息 */}
      <div
        style={{
          marginTop: 6,
          padding: "6px 8px",
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: 6,
          fontSize: 11,
          color: "#166534",
        }}
      >
        {lt("支持：文生视频、图片参考、首尾帧、视频编辑", "Supports: text-to-video, image reference, first-last frame, video editing")}
      </div>

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
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <AlertTriangle size={14} />
          <span>{data.error}</span>
        </div>
      )}

      {data.fallbackMessage && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 8px",
            background: "#fefce8",
            border: "1px solid #fde047",
            borderRadius: 6,
            fontSize: 11,
            color: "#854d0e",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span>ℹ️</span>
          <span>{data.fallbackMessage}</span>
        </div>
      )}
    </div>
  );
}

export default React.memo(KlingO1VideoNode);
