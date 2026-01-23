import React from "react";
import { Handle, Position } from "reactflow";
import { AlertTriangle, Video, Share2, Download } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { useAuthStore } from "@/stores/authStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { fetchWithAuth } from "@/services/authFetch";

export type VideoProvider = "kling" | "vidu" | "doubao";

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
    provider: VideoProvider;
    clipDuration?: number;
    aspectRatio?: string;
    history?: VideoHistoryItem[];
    fallbackMessage?: string;
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

const PROVIDER_CONFIG: Record<VideoProvider, { name: string; zh: string }> = {
  kling: { name: "Kling", zh: "Kling" },
  vidu: { name: "Vidu", zh: "Vidu" },
  doubao: { name: "Seedance", zh: "Seedance" },
};

function GenericVideoNodeInner({ id, data, selected }: Props) {
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const [aspectMenuOpen, setAspectMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadFeedback, setDownloadFeedback] =
    React.useState<DownloadFeedback | null>(null);
  const downloadFeedbackTimer = React.useRef<number | undefined>(undefined);
  const user = useAuthStore((state) => state.user);

  const provider = data.provider || "kling";
  const providerInfo = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG["kling"];

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
    // 如果是 presigned 链接（包含 X-Amz / X-Tos 等签名字段），不要添加 cache-bust 参数（会导致签名失效）
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
      console.warn("无法重置视频播放器", error);
    }
  }, [cacheBustedVideoUrl, sanitizedVideoUrl]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest?.(".video-dropdown")) {
        setAspectMenuOpen(false);
        setDurationMenuOpen(false);
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
  const onSend = React.useCallback(() => data.onSend?.(id), [data, id]);

  const clipDuration =
    typeof data.clipDuration === "number" ? data.clipDuration : undefined;
  const aspectRatioValue =
    typeof data.aspectRatio === "string" ? data.aspectRatio : "";

  // 根据供应商配置不同的选项
  const getAspectOptions = () => {
    if (provider === "kling") {
      return [
        { label: "自动", value: "" },
        { label: "横屏（16:9）", value: "16:9" },
        { label: "竖屏（9:16）", value: "9:16" },
        { label: "方形（1:1）", value: "1:1" },
      ];
    }
    return [
      { label: "自动", value: "" },
      { label: "横屏（16:9）", value: "16:9" },
      { label: "竖屏（9:16）", value: "9:16" },
    ];
  };

  const getDurationOptions = () => {
    if (provider === "kling") {
      return [
        { label: "5秒", value: 5 },
        { label: "10秒", value: 10 },
      ];
    }
    if (provider === "vidu") {
      return [
        { label: "1秒", value: 1 },
        { label: "2秒", value: 2 },
        { label: "3秒", value: 3 },
        { label: "4秒", value: 4 },
        { label: "5秒", value: 5 },
        { label: "6秒", value: 6 },
        { label: "7秒", value: 7 },
        { label: "8秒", value: 8 },
        { label: "9秒", value: 9 },
        { label: "10秒", value: 10 },
      ];
    }
    if (provider === "doubao") {
      return [
        { label: "3秒", value: 3 },
        { label: "4秒", value: 4 },
        { label: "5秒", value: 5 },
        { label: "6秒", value: 6 },
        { label: "8秒", value: 8 },
      ];
    }
    return [];
  };

  const aspectOptions = React.useMemo(() => getAspectOptions(), [provider]);
  const durationOptions = React.useMemo(() => getDurationOptions(), [provider]);

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

  const aspectLabel = React.useMemo(() => {
    const match = aspectOptions.find((opt) => opt.value === aspectRatioValue);
    return match ? match.label : "自动";
  }, [aspectOptions, aspectRatioValue]);

  const durationLabel = React.useMemo(() => {
    const match = durationOptions.find((opt) => opt.value === clipDuration);
    if (match) return match.label;
    if (clipDuration) return `${clipDuration}秒`;
    return "未设置";
  }, [clipDuration, durationOptions]);

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
      return {
        color: "#b91c1c",
        background: "#fef2f2",
        borderColor: "#fecaca",
      };
    }
    if (downloadFeedback.type === "success") {
      return {
        color: "#15803d",
        background: "#ecfdf5",
        borderColor: "#bbf7d0",
      };
    }
    return { color: "#1d4ed8", background: "#eff6ff", borderColor: "#bfdbfe" };
  }, [downloadFeedback]);

  const isDownloadDisabled = !data.videoUrl || isDownloading;
  const historyItems = React.useMemo<VideoHistoryItem[]>(
    () => (Array.isArray(data.history) ? data.history : []),
    [data.history]
  );

  const copyVideoLink = React.useCallback(async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      alert("已复制视频链接");
    } catch (error) {
      console.error("复制失败:", error);
      alert("复制失败，请手动复制链接");
    }
  }, []);

  const triggerDownload = React.useCallback(
    async (url?: string) => {
      if (!url || isDownloading) return;
      if (downloadFeedbackTimer.current) {
        window.clearTimeout(downloadFeedbackTimer.current);
        downloadFeedbackTimer.current = undefined;
      }
      setIsDownloading(true);
      setDownloadFeedback({
        type: "progress",
        message: "视频下载中，请稍等...",
      });
      try {
        // 检测是否为 Vidu 的 S3 URL（需要代理绕过 CORS）
        const isViduS3 = url.includes('amazonaws.com.cn') || url.includes('prod-ss-vidu');
        const proxiedUrl = proxifyRemoteAssetUrl(url, { forceProxy: isViduS3 });
        const response = await fetchWithAuth(proxiedUrl, {
          mode: "cors",
          credentials: "omit",
          auth: "omit",
          allowRefresh: false,
        });
        if (response.ok) {
          const blob = await response.blob();
          const downloadUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = downloadUrl;
          link.download = `video-${new Date().toISOString().split("T")[0]}.mp4`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(downloadUrl), 200);
          setDownloadFeedback({
            type: "success",
            message: "下载完成，稍后可再次下载",
          });
          scheduleFeedbackClear(2000);
        } else {
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setDownloadFeedback({
            type: "success",
            message: "已在新标签页打开视频链接",
          });
          scheduleFeedbackClear(3000);
        }
      } catch (error) {
        console.error("下载失败:", error);
        alert("下载失败，请尝试在浏览器中打开链接");
        setDownloadFeedback({ type: "error", message: "下载失败，请稍后重试" });
        scheduleFeedbackClear(4000);
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, scheduleFeedbackClear]
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

      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        })
      );
    },
    [id, data.videoVersion, data.status]
  );

  const formatHistoryTime = React.useCallback((iso: string) => {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }, []);

  const truncatePrompt = React.useCallback((text: string) => {
    if (!text) return "（无提示词）";
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }, []);

  const handleMediaPointerDown = (
    event: React.PointerEvent | React.MouseEvent
  ) => {
    event.stopPropagation();
    const nativeEvent = (event as any).nativeEvent;
    nativeEvent?.stopImmediatePropagation?.();
  };

  const handleMediaTouchStart = (event: React.TouchEvent) => {
    event.stopPropagation();
    const nativeEvent = event.nativeEvent;
    nativeEvent?.stopImmediatePropagation?.();
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
          <source src={videoSrc} type='video/mp4' />
          您的浏览器不支持 video 标签
        </video>
      );
    }
    if (sanitizedThumbnail) {
      return (
        <SmartImage
          src={proxifyRemoteAssetUrl(sanitizedThumbnail)}
          alt='video thumbnail'
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
        <div style={{ fontSize: 11 }}>等待生成...</div>
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
        type='target'
        position={Position.Left}
        id='text'
        style={{ top: "32%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='target'
        position={Position.Left}
        id='image'
        style={{ top: "60%" }}
        onMouseEnter={() => setHover("image-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='video'
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("video-out")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "text-in" && (
        <div
          className='flow-tooltip'
          style={{ left: -8, top: "32%", transform: "translate(-100%, -50%)" }}
        >
          prompt
        </div>
      )}
      {hover === "image-in" && (
        <div
          className='flow-tooltip'
          style={{ left: -8, top: "60%", transform: "translate(-100%, -50%)" }}
        >
          image
        </div>
      )}
      {hover === "video-out" && (
        <div
          className='flow-tooltip'
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
          <span>{providerInfo.zh}</span>
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
            title='复制链接'
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
            title='下载视频'
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
              <span style={{ fontSize: 10, fontWeight: 600, color: "#111827" }}>
                ···
              </span>
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

      <div
        className='video-dropdown'
        style={{ marginBottom: 8, position: "relative" }}
      >
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          尺寸
        </div>
        <button
          type='button'
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
          <span style={{ fontSize: 16, lineHeight: 1 }}>
            {aspectMenuOpen ? "▴" : "▾"}
          </span>
        </button>
        {aspectMenuOpen && (
          <div
            className='video-dropdown-menu'
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
                    type='button'
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

      <div
        className='video-dropdown'
        style={{ marginBottom: 8, position: "relative" }}
      >
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          时间长度
        </div>
        <button
          type='button'
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
          <span style={{ fontSize: 16, lineHeight: 1 }}>
            {durationMenuOpen ? "▴" : "▾"}
          </span>
        </button>
        {durationMenuOpen && (
          <div
            className='video-dropdown-menu'
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
              {durationOptions.map((option: any) => {
                const isActive = option.value === clipDuration;
                const isLocked = option.locked;
                return (
                  <button
                    key={option.value}
                    type='button'
                    title={isLocked ? "仅管理员可用" : undefined}
                    onClick={() => {
                      if (isLocked) return;
                      handleDurationChange(option.value);
                      setDurationMenuOpen(false);
                    }}
                    disabled={isLocked}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${isActive ? "#2563eb" : "#e5e7eb"}`,
                      background: isActive ? "#2563eb" : "#fff",
                      color: isActive
                        ? "#fff"
                        : isLocked
                        ? "#9ca3af"
                        : "#111827",
                      fontSize: 12,
                      cursor: isLocked ? "not-allowed" : "pointer",
                      opacity: isLocked ? 0.6 : 1,
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

      {/* Kling 专用参数：模式选择 */}
      {provider === "kling" && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            模式
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: "标准 (std)", value: "std" },
              { label: "专业 (pro)", value: "pro" },
            ].map((opt) => {
              const isActive = (data as any).mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type='button'
                  onClick={() => {
                    const current = (data as any).mode || "std";
                    if (current === opt.value) return;
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
      )}

      {/* Vidu 专用参数 */}
      {provider === "vidu" && (
        <>
          <div
            className='video-dropdown'
            style={{ marginBottom: 8, position: "relative" }}
          >
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              分辨率
            </div>
            <button
              type='button'
              onClick={(event) => {
                event.stopPropagation();
                const currentResolution = (data as any).resolution || "720p";
                window.dispatchEvent(
                  new CustomEvent("flow:updateNodeData", {
                    detail: {
                      id,
                      patch: {
                        resolution:
                          currentResolution === "720p"
                            ? "1080p"
                            : currentResolution === "1080p"
                            ? "540p"
                            : "720p",
                      },
                    },
                  })
                );
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
              <span>{(data as any).resolution || "720p"}</span>
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button
              type='button'
              onClick={() => {
                const currentStyle = (data as any).style || "general";
                window.dispatchEvent(
                  new CustomEvent("flow:updateNodeData", {
                    detail: {
                      id,
                      patch: {
                        style: currentStyle === "general" ? "anime" : "general",
                      },
                    },
                  })
                );
              }}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid #e5e7eb`,
                background:
                  (data as any).style === "anime" ? "#111827" : "#fff",
                color: (data as any).style === "anime" ? "#fff" : "#111827",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              风格: {(data as any).style === "anime" ? "动漫" : "通用"}
            </button>
            <button
              type='button'
              onClick={() => {
                const currentOffPeak = (data as any).offPeak || false;
                window.dispatchEvent(
                  new CustomEvent("flow:updateNodeData", {
                    detail: { id, patch: { offPeak: !currentOffPeak } },
                  })
                );
              }}
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid #e5e7eb`,
                background: (data as any).offPeak ? "#111827" : "#fff",
                color: (data as any).offPeak ? "#fff" : "#111827",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              错峰: {(data as any).offPeak ? "开启" : "关闭"}
            </button>
          </div>
        </>
      )}

      {/* 豆包专用参数 */}
      {provider === "doubao" && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button
            type='button'
            onClick={() => {
              const currentCamerafixed = (data as any).camerafixed ?? false;
              window.dispatchEvent(
                new CustomEvent("flow:updateNodeData", {
                  detail: { id, patch: { camerafixed: !currentCamerafixed } },
                })
              );
            }}
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid #e5e7eb`,
              background: (data as any).camerafixed ? "#111827" : "#fff",
              color: (data as any).camerafixed ? "#fff" : "#111827",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            镜头: {(data as any).camerafixed ? "固定" : "运动"}
          </button>
          <button
            type='button'
            onClick={() => {
              const currentWatermark = (data as any).watermark ?? false;
              window.dispatchEvent(
                new CustomEvent("flow:updateNodeData", {
                  detail: { id, patch: { watermark: !currentWatermark } },
                })
              );
            }}
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid #e5e7eb`,
              background: (data as any).watermark ? "#111827" : "#fff",
              color: (data as any).watermark ? "#fff" : "#111827",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            水印: {(data as any).watermark ? "开启" : "关闭"}
          </button>
        </div>
      )}

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
        progress={
          data.status === "running" ? 30 : data.status === "succeeded" ? 100 : 0
        }
      />

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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
              历史记录
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              {historyItems.length} 条
            </span>
          </div>
          {historyItems.map((item, index) => {
            const isActive = item.videoUrl === data.videoUrl;
            return (
              <div
                key={item.id}
                style={{
                  borderRadius: 6,
                  border: "1px solid " + (isActive ? "#c7d2fe" : "#e2e8f0"),
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
                      当前
                    </span>
                  )}
                </div>
                {typeof item.elapsedSeconds === "number" && (
                  <div style={{ fontSize: 11, color: "#475569" }}>
                    耗时 {item.elapsedSeconds}s
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#0f172a" }}>
                  {truncatePrompt(item.prompt)}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {!isActive && (
                    <button
                      type='button'
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
                      设为当前
                    </button>
                  )}
                  <button
                    type='button'
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
                    复制链接
                  </button>
                  <button
                    type='button'
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
                    下载
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

export default React.memo(GenericVideoNodeInner);
