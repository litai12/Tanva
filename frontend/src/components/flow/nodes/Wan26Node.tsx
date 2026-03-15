import React from "react";
import { Handle, Position, useReactFlow } from "reactflow";
import { Video, Download, Share2, AlertTriangle } from "lucide-react";
import GenerationProgressBar from "./GenerationProgressBar";
import { uploadAudioToOSS } from "@/stores/aiChatStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { fetchWithAuth } from "@/services/authFetch";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";

type VideoHistoryItem = {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  prompt: string;
  createdAt: string;
  elapsedSeconds?: number;
  quality?: string;
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
    size?: string; // T2V 参数：16:9、9:16、1:1、4:3、3:4
    resolution?: "720P" | "1080P"; // I2V 参数
    duration?: number; // 5、10、15
    shotType?: "single" | "multi";
    history?: VideoHistoryItem[];
    audioUrl?: string;
    inputImageUrl?: string; // 用于判断是 T2V 还是 I2V
  };
  selected?: boolean;
};

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

const SUPPORTED_AUDIO_ACCEPT = SUPPORTED_AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(",");

const isSupportedAudioFile = (file: File): boolean => {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("audio/")) {
    return true;
  }
  const name = (file.name || "").trim();
  return SUPPORTED_AUDIO_PATTERN.test(name);
};

function Wan26Node({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const projectId = useProjectContentStore((s) => s.projectId);
  const rf = useReactFlow();
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected ? "0 0 0 2px rgba(37,99,235,0.12)" : "0 1px 2px rgba(0,0,0,0.04)";

  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  // 菜单状态
  const [sizeMenuOpen, setSizeMenuOpen] = React.useState(false);
  const [resolutionMenuOpen, setResolutionMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const [shotMenuOpen, setShotMenuOpen] = React.useState(false);

  // 音频上传
  const [uploading, setUploading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // 下载状态
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadFeedback, setDownloadFeedback] = React.useState<{
    type: "progress" | "success" | "error";
    message: string;
  } | null>(null);
  const downloadFeedbackTimer = React.useRef<number | undefined>(undefined);
  const [showHistory, setShowHistory] = React.useState(false);

  // 判断是 T2V 还是 I2V 模式：检查是否有连接到 image 接入点的边
  const [isI2VMode, setIsI2VMode] = React.useState(false);

  // 定期检查边的连接状态
  React.useEffect(() => {
    const checkImageConnection = () => {
      try {
        const edges = rf.getEdges();
        const hasImageConnection = edges.some(
          (edge) => edge.target === id && edge.targetHandle === "image"
        );
        setIsI2VMode(hasImageConnection);
      } catch {
        setIsI2VMode(false);
      }
    };

    // 初始检查
    checkImageConnection();

    // 定期检查（每100ms检查一次）
    const interval = setInterval(checkImageConnection, 100);

    return () => {
      clearInterval(interval);
    };
  }, [rf, id]);

  const nodeTitle = "Wan2.6";

  // 工具函数
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
        prompt(lt("请手动复制以下链接：", "Please manually copy this link:"), url);
      }
    } catch {
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
        // DashScope OSS 加速域名不支持 CORS，需要通过代理下载
        const isDashScopeOss = url.includes('dashscope') && url.includes('aliyuncs.com');
        // 检测是否为普通 OSS URL（阿里云 OSS 支持 CORS，可直接下载）
        const isOssUrl = url.includes('aliyuncs.com') && !isDashScopeOss;
        // DashScope OSS 或非 OSS URL 需要代理
        const downloadUrl = (isDashScopeOss || !isOssUrl) ? proxifyRemoteAssetUrl(url, { forceProxy: true }) : url;
        console.log(`[Wan2.6 download] raw URL: ${url}`);
        console.log(`[Wan2.6 download] URL: ${downloadUrl}, isOSS: ${isOssUrl}, isDashScope: ${isDashScopeOss}`);

        const response = await fetch(downloadUrl, {
          mode: "cors",
          credentials: "omit",
        });
        console.log(`[Wan2.6 download] response status: ${response.status}`);

        if (response.ok) {
          const blob = await response.blob();
          // 确保 blob 类型正确
          const videoBlob = blob.type.startsWith('video/')
            ? blob
            : new Blob([blob], { type: 'video/mp4' });
          const blobUrl = URL.createObjectURL(videoBlob);
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = `video-${new Date().toISOString().split("T")[0]}.mp4`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
          setDownloadFeedback({ type: "success", message: lt("下载完成", "Download complete") });
          scheduleFeedbackClear(2000);
        } else {
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setDownloadFeedback({ type: "success", message: lt("已在新标签页打开视频链接", "Opened video link in a new tab") });
          scheduleFeedbackClear(3000);
        }
      } catch (error) {
        console.error("Download failed:", error);
        setDownloadFeedback({ type: "error", message: lt("下载失败，请稍后重试", "Download failed, please try again later") });
        scheduleFeedbackClear(4000);
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, scheduleFeedbackClear, lt]
  );

  const handleButtonMouseDown = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  const onRun = React.useCallback(() => data.onRun?.(id), [data, id]);

  // 音频上传处理
  const handleChooseFile = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setMessage(null);
      const maxSize = 15 * 1024 * 1024;
      if (!isSupportedAudioFile(file)) {
        setMessage(
          lt(
            "不支持的音频格式，请上传常见音频文件",
            "Unsupported audio format, please upload a common audio file"
          )
        );
        return;
      }
      if (file.size > maxSize) {
        setMessage(lt("文件大小不能超过 15MB", "File size cannot exceed 15MB"));
        return;
      }

      // 检查时长（3-30s）
      const objectUrl = URL.createObjectURL(file);
      const audio = document.createElement("audio");
      let durationOk = true;
      try {
        audio.src = objectUrl;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(lt("无法读取音频时长", "Unable to read audio duration"))), 5000);
          audio.addEventListener("loadedmetadata", () => {
            clearTimeout(t);
            const d = audio.duration || 0;
            if (d < 3 || d > 30) durationOk = false;
            resolve();
          });
          audio.addEventListener("error", () => {
            clearTimeout(t);
            reject(new Error(lt("音频加载失败", "Audio load failed")));
          });
        });
      } catch {
        setMessage(lt("无法读取音频文件，请确认格式正确", "Unable to read audio file, please verify the format"));
        URL.revokeObjectURL(objectUrl);
        return;
      }
      URL.revokeObjectURL(objectUrl);
      if (!durationOk) {
        setMessage(lt("音频时长需在 3 到 30 秒之间", "Audio duration must be between 3 and 30 seconds"));
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : null;
        if (!dataUrl) {
          setMessage(lt("无法读取音频数据", "Unable to read audio data"));
          return;
        }
        try {
          setUploading(true);
          setMessage(lt("上传中...", "Uploading..."));
          const uploaded = await uploadAudioToOSS(dataUrl, projectId);
          if (!uploaded) {
            setMessage(lt("上传失败，请重试", "Upload failed, please retry"));
            setUploading(false);
            return;
          }
          window.dispatchEvent(
            new CustomEvent("flow:updateNodeData", {
              detail: { id, patch: { audioUrl: uploaded } },
            })
          );
          setMessage(lt("上传成功", "Upload successful"));
        } catch {
          setMessage(lt("上传出错，请稍后重试", "Upload error, please retry later"));
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [id, lt, projectId]
  );

  const handleClearAudio = React.useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { audioUrl: undefined } },
      })
    );
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [id]);

  // 关闭所有菜单
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest?.(".wan26-dropdown")) {
        setSizeMenuOpen(false);
        setResolutionMenuOpen(false);
        setDurationMenuOpen(false);
        setShotMenuOpen(false);
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
    if (!text) return lt("（无提示词）", "(No prompt)");
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }, [lt]);

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
        style={{ top: "26%" }}
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
        id="audio"
        style={{ top: "74%" }}
        onMouseEnter={() => setHover("audio-in")}
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

      {/* Tooltip */}
      {hover === "text-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "26%", transform: "translate(-100%, -50%)" }}
        >
          prompt
        </div>
      )}
      {hover === "image-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}
        >
          image
        </div>
      )}
      {hover === "audio-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "74%", transform: "translate(-100%, -50%)" }}
        >
          audio
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

      {/* 标题栏 */}
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
          <span>{nodeTitle}</span>
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
              background: !data.videoUrl || isDownloading ? "#e5e7eb" : "#111827",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: !data.videoUrl || isDownloading ? "not-allowed" : "pointer",
              color: "#fff",
              opacity: !data.videoUrl || isDownloading ? 0.35 : 1,
            }}
            disabled={!data.videoUrl || isDownloading}
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

      {/* 尺寸比例（仅 T2V 模式显示，即没有接入 image 时） */}
      {!isI2VMode && (
        <div className="wan26-dropdown" style={{ marginBottom: 8, position: "relative" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("尺寸比例", "Aspect ratio")}</div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setResolutionMenuOpen(false);
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
              className="wan26-dropdown-menu"
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
                {["16:9", "9:16", "1:1", "4:3", "3:4"].map((opt) => {
                  const isActive = opt === data.size;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("flow:updateNodeData", {
                            detail: { id, patch: { size: opt } },
                          })
                        );
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
      )}

      {/* 分辨率（T2V 和 I2V 都有） */}
      <div className="wan26-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("分辨率", "Resolution")}</div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSizeMenuOpen(false);
            setDurationMenuOpen(false);
            setShotMenuOpen(false);
            setResolutionMenuOpen((open) => !open);
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
          <span>{data.resolution || "720P"}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{resolutionMenuOpen ? "▴" : "▾"}</span>
        </button>
        {resolutionMenuOpen && (
          <div
            className="wan26-dropdown-menu"
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
              {["720P", "1080P"].map((opt) => {
                const isActive = opt === data.resolution;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("flow:updateNodeData", {
                          detail: { id, patch: { resolution: opt } },
                        })
                      );
                      setResolutionMenuOpen(false);
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

      {/* Duration 参数（T2V 和 I2V 都有） */}
      <div className="wan26-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("时长", "Duration")}</div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSizeMenuOpen(false);
            setResolutionMenuOpen(false);
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
          <span>{data.duration ? lt(`${data.duration}秒`, `${data.duration}s`) : lt("5秒", "5s")}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{durationMenuOpen ? "▴" : "▾"}</span>
        </button>
        {durationMenuOpen && (
          <div
            className="wan26-dropdown-menu"
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
              {[5, 10, 15].map((opt) => {
                const isActive = opt === data.duration;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("flow:updateNodeData", {
                          detail: { id, patch: { duration: opt } },
                        })
                      );
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
                    {lt(`${opt}秒`, `${opt}s`)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Shot Type 参数（T2V 和 I2V 都有） */}
      <div className="wan26-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("镜头类型", "Shot type")}</div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSizeMenuOpen(false);
            setResolutionMenuOpen(false);
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
          <span>{data.shotType === "multi" ? lt("multi（多镜头）", "multi (multi-shot)") : lt("single（单镜头）", "single (single-shot)")}</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{shotMenuOpen ? "▴" : "▾"}</span>
        </button>
        {shotMenuOpen && (
          <div
            className="wan26-dropdown-menu"
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
              {[
                { label: lt("single（单镜头）", "single (single-shot)"), value: "single" },
                { label: lt("multi（多镜头）", "multi (multi-shot)"), value: "multi" },
              ].map((opt) => {
                const isActive = opt.value === data.shotType;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("flow:updateNodeData", {
                          detail: { id, patch: { shotType: opt.value } },
                        })
                      );
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

      {/* 音频上传（可选）- 优化紧凑版 */}
      <div
        style={{
          marginTop: 8,
          marginBottom: 6,
          padding: "8px",
          borderRadius: 6,
          border: "1px solid #e2e8f0",
          background: "#f8fafc",
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
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#0f172a" }}>
              {lt("音频（可选）", "Audio (optional)")}
            </div>
            {data.audioUrl && (
              <div
                style={{
                  fontSize: 9,
                  padding: "1px 4px",
                  borderRadius: 3,
                  background: "#dcfce7",
                  color: "#15803d",
                  fontWeight: 600,
                }}
              >
                ✓
              </div>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {lt("常见音频格式 · 3-30s", "Common audio formats · 3-30s")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            onClick={handleChooseFile}
            disabled={uploading}
            style={{
              flex: 1,
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #cbd5e1",
              background: "#fff",
              fontSize: 11,
              cursor: uploading ? "not-allowed" : "pointer",
              color: "#0f172a",
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? lt("上传中...", "Uploading...") : data.audioUrl ? lt("重选", "Reselect") : lt("选择", "Choose")}
          </button>
          {data.audioUrl && (
            <button
              type="button"
              onClick={handleClearAudio}
              disabled={uploading}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid #fca5a5",
                background: "#fff",
                fontSize: 11,
                cursor: uploading ? "not-allowed" : "pointer",
                color: "#dc2626",
                opacity: uploading ? 0.6 : 1,
              }}
            >
              {lt("清除", "Clear")}
            </button>
          )}
        </div>
        {message && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: /成功|success/i.test(message) ? "#15803d" : "#dc2626",
            }}
          >
            {message}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_AUDIO_ACCEPT}
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      {/* 视频预览区域 */}
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
        {sanitizedVideoUrl ? (
          <video
            key={`${sanitizedVideoUrl}-${data.videoVersion || 0}`}
            ref={videoRef}
            controls
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: 6,
              background: "#000",
            }}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) {
                setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`);
              }
            }}
          >
            <source src={sanitizedVideoUrl} type="video/mp4" />
            {lt("您的浏览器不支持 video 标签", "Your browser does not support the video tag")}
          </video>
        ) : (
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
        )}
      </div>

      {/* 进度条 */}
      <GenerationProgressBar
        status={data.status || "idle"}
        progress={data.status === "running" ? 30 : data.status === "succeeded" ? 100 : 0}
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
              cursor: "pointer"
            }}
            onClick={() => setShowHistory(!showHistory)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
              {lt("历史记录", "History")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {historyItems.length} {lt("条", "items")}
              </span>
              <span style={{ fontSize: 14, color: "#64748b" }}>{showHistory ? "▴" : "▾"}</span>
            </div>
          </div>
          {showHistory && historyItems.map((item, index) => {
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
                      {lt("当前", "Current")}
                    </span>
                  )}
                </div>
                {typeof item.elapsedSeconds === "number" && (
                  <div style={{ fontSize: 11, color: "#475569" }}>
                    {lt("耗时", "Elapsed")} {item.elapsedSeconds}s
                  </div>
                )}
                {item.quality && (
                  <div style={{ fontSize: 11, color: "#475569" }}>
                    {item.quality === "I2V" ? lt("图生视频", "Image-to-video") : item.quality === "T2V" ? lt("文生视频", "Text-to-video") : item.quality}
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
                      {lt("设为当前", "Set as current")}
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
                    {lt("复制链接", "Copy link")}
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
                    {lt("下载", "Download")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 错误信息 */}
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
    </div>
  );
}

export default React.memo(Wan26Node);
