import React from "react";
import { Handle, Position } from "reactflow";
import { Video, Share2, Download, AlertTriangle } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { fetchWithAuth } from "@/services/authFetch";

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

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    videoUrl?: string;
    thumbnail?: string;
    error?: string;
    videoVersion?: number;
    onRun?: (id: string) => void;
    size?: string;
    duration?: number;
    shotType?: "single" | "multi";
    history?: VideoHistoryItem[];
  };
  selected?: boolean;
};

function Wan2R2VNodeInner({ id, data, selected }: Props) {
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadFeedback, setDownloadFeedback] = React.useState<{
    type: "progress" | "success" | "error";
    message: string;
  } | null>(null);
  const downloadFeedbackTimer = React.useRef<number | undefined>(undefined);
  const [sizeMenuOpen, setSizeMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const [shotMenuOpen, setShotMenuOpen] = React.useState(false);

  const historyItems = React.useMemo<VideoHistoryItem[]>(
    () => (Array.isArray(data.history) ? data.history : []),
    [data.history]
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
        new CustomEvent("flow:updateNodeData", { detail: { id, patch } })
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
      console.warn("无法重置视频播放器", error);
    }
  }, [sanitizedVideoUrl]);

  // 全屏时强制设置 object-fit: contain，确保视频按原比例显示
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleFullscreenChange = () => {
      const isFullscreen =
        document.fullscreenElement === video ||
        (document as any).webkitFullscreenElement === video ||
        (document as any).mozFullScreenElement === video ||
        (document as any).msFullscreenElement === video;

      if (isFullscreen) {
        video.style.objectFit = "contain";
        video.style.width = "100%";
        video.style.height = "100%";
        video.style.maxWidth = "100vw";
        video.style.maxHeight = "100vh";
        video.style.background = "#000";
      } else {
        video.style.objectFit = "cover";
        video.style.width = "100%";
        video.style.height = "100%";
        video.style.maxWidth = "";
        video.style.maxHeight = "";
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
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
        setDownloadFeedback({ type: "error", message: "没有可复制的视频链接" });
        scheduleFeedbackClear(2000);
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
          setDownloadFeedback({ type: "success", message: "已复制视频链接" });
          scheduleFeedbackClear(2000);
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
          setDownloadFeedback({ type: "success", message: "已复制视频链接" });
        } else {
          setDownloadFeedback({ type: "error", message: "复制失败" });
          prompt("请手动复制以下链接：", url);
        }
        scheduleFeedbackClear(2000);
      } catch {
        setDownloadFeedback({ type: "error", message: "复制失败" });
        prompt("请手动复制以下链接：", url);
        scheduleFeedbackClear(3000);
      }
    },
    [scheduleFeedbackClear]
  );

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
        const response = await fetchWithAuth(url, {
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
          setDownloadFeedback({ type: "success", message: "下载完成" });
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
        setDownloadFeedback({ type: "error", message: "下载失败，请稍后重试" });
        scheduleFeedbackClear(4000);
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, scheduleFeedbackClear]
  );

  const renderPreview = () => {
    const commonMediaStyle: React.CSSProperties = {
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
          style={commonMediaStyle}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`);
            }
          }}
        >
          <source src={sanitizedVideoUrl} type='video/mp4' />
          您的浏览器不支持 video 标签
        </video>
      );
    }
    if (sanitizedThumbnail) {
      return (
        <SmartImage
          src={sanitizedThumbnail}
          alt='video thumbnail'
          style={commonMediaStyle}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setPreviewAspect(`${img.naturalWidth}/${img.naturalHeight}`);
            }
          }}
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
        border: `1px solid ${selected ? "#2563eb" : "#e5e7eb"}`,
        borderRadius: 10,
        boxShadow: selected
          ? "0 0 0 2px rgba(37,99,235,0.12)"
          : "0 1px 2px rgba(0,0,0,0.04)",
        position: "relative",
      }}
    >
      <Handle
        type='target'
        position={Position.Left}
        id='text'
        style={{ top: "15%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='target'
        position={Position.Left}
        id='video-1'
        style={{ top: "35%" }}
        onMouseEnter={() => setHover("video1-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='target'
        position={Position.Left}
        id='video-2'
        style={{ top: "55%" }}
        onMouseEnter={() => setHover("video2-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='target'
        position={Position.Left}
        id='video-3'
        style={{ top: "75%" }}
        onMouseEnter={() => setHover("video3-in")}
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
        <div className="flow-tooltip" style={{ left: -8, top: "15%", transform: "translate(-100%, -50%)" }}>
          prompt
        </div>
      )}
      {hover === "video1-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "35%", transform: "translate(-100%, -50%)" }}>
          Video1
        </div>
      )}
      {hover === "video2-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "55%", transform: "translate(-100%, -50%)" }}>
          Video2
        </div>
      )}
      {hover === "video3-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "75%", transform: "translate(-100%, -50%)" }}>
          Video3
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
        <div
          style={{
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Video size={18} />
          <span>Wan2.6 R2V</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => data.onRun?.(id)}
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
            onClick={() => copyVideoLink((data as any)?.videoUrl)}
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
              cursor: (data as any)?.videoUrl ? "pointer" : "not-allowed",
              color: "#fff",
              opacity: (data as any)?.videoUrl ? 1 : 0.35,
            }}
            disabled={!(data as any)?.videoUrl}
          >
            <Share2 size={14} />
          </button>
          <button
            onClick={() => triggerDownload((data as any)?.videoUrl)}
            title='下载视频'
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
            border: `1px solid ${downloadFeedback.type === "error" ? "#fecaca" : downloadFeedback.type === "success" ? "#bbf7d0" : "#bfdbfe"}`,
            background: downloadFeedback.type === "error" ? "#fef2f2" : downloadFeedback.type === "success" ? "#ecfdf5" : "#eff6ff",
            color: downloadFeedback.type === "error" ? "#b91c1c" : downloadFeedback.type === "success" ? "#15803d" : "#1d4ed8",
          }}
        >
          {downloadFeedback.message}
        </div>
      )}

      <div className='sora2-dropdown' style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>尺寸</div>
        <button
          type='button'
          onClick={(event) => {
            event.stopPropagation();
            setDurationMenuOpen(false);
            setShotMenuOpen(false);
            setSizeMenuOpen((open) => !open);
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
          <span>{data.size || "16:9"}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{sizeMenuOpen ? "▴" : "▾"}</span>
        </button>
        {sizeMenuOpen && (
          <div
            className='sora2-dropdown-menu'
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
              {["16:9", "9:16", "1:1", "4:3", "3:4"].map((opt) => {
                const isActive = opt === data.size;
                return (
                  <button
                    key={opt}
                    type='button'
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch: { size: opt } } }));
                      setSizeMenuOpen(false);
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
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className='sora2-dropdown' style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>时间长度</div>
        <button
          type='button'
          onClick={(event) => {
            event.stopPropagation();
            setSizeMenuOpen(false);
            setShotMenuOpen(false);
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
          <span>{String(data.duration || 5) + "秒"}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{durationMenuOpen ? "▴" : "▾"}</span>
        </button>
        {durationMenuOpen && (
          <div
            className='sora2-dropdown-menu'
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
              {[5, 10].map((opt) => {
                const isActive = opt === data.duration;
                return (
                  <button
                    key={opt}
                    type='button'
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch: { duration: opt } } }));
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
                    {opt}秒
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className='sora2-dropdown' style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>拍摄类型</div>
        <button
          type='button'
          onClick={(event) => {
            event.stopPropagation();
            setSizeMenuOpen(false);
            setDurationMenuOpen(false);
            setShotMenuOpen((open) => !open);
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
          <span>{data.shotType === "multi" ? "multi（多镜头）" : "single（单镜头）"}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{shotMenuOpen ? "▴" : "▾"}</span>
        </button>
        {shotMenuOpen && (
          <div
            className='sora2-dropdown-menu'
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
              {[
                { label: "single（单镜头）", value: "single" },
                { label: "multi（多镜头）", value: "multi" },
              ].map((opt) => {
                const isActive = opt.value === data.shotType;
                return (
                  <button
                    key={opt.value}
                    type='button'
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch: { shotType: opt.value } } }));
                      setShotMenuOpen(false);
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
                    {opt.label}
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
                    <span style={{ fontSize: 10, color: "#1d4ed8", fontWeight: 600 }}>
                      当前
                    </span>
                  )}
                </div>
                {typeof item.elapsedSeconds === "number" && (
                  <div style={{ fontSize: 11, color: "#475569" }}>
                    耗时 {item.elapsedSeconds}s
                  </div>
                )}
                {item.quality && (
                  <div style={{ fontSize: 11, color: "#475569" }}>
                    {item.quality}
                    {typeof item.referenceCount === "number" && ` · ${item.referenceCount}个参考视频`}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#0f172a" }}>
                  {truncatePrompt(item.prompt)}
                </div>
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
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      设为当前
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
                    复制链接
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
          }}
        >
          {data.error}
        </div>
      )}
    </div>
  );
}

export default React.memo(Wan2R2VNodeInner);
