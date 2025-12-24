import React from "react";
import { Handle, Position, useReactFlow } from "reactflow";
import { Video, Download, Share2, AlertTriangle } from "lucide-react";
import GenerationProgressBar from "./GenerationProgressBar";
import { uploadAudioToOSS } from "@/stores/aiChatStore";
import { useProjectContentStore } from "@/stores/projectContentStore";

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
    history?: any[];
    audioUrl?: string;
    inputImageUrl?: string; // 用于判断是 T2V 还是 I2V
  };
  selected?: boolean;
};

function Wan26Node({ id, data, selected }: Props) {
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
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      alert("已复制视频链接");
    } catch {
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
      setDownloadFeedback({ type: "progress", message: "视频下载中，请稍等..." });
      try {
        const response = await fetch(url, { mode: "cors", credentials: "omit" });
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
          setDownloadFeedback({ type: "success", message: "已在新标签页打开视频链接" });
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
      const name = file.name || "";
      const ext = (name.split(".").pop() || "").toLowerCase();
      if (!["mp3", "wav"].includes(ext) && !file.type.startsWith("audio/")) {
        setMessage("仅支持 mp3/wav 音频");
        return;
      }
      if (file.size > maxSize) {
        setMessage("文件大小不能超过 15MB");
        return;
      }

      // 检查时长（3-30s）
      const objectUrl = URL.createObjectURL(file);
      const audio = document.createElement("audio");
      let durationOk = true;
      try {
        audio.src = objectUrl;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("无法读取音频时长")), 5000);
          audio.addEventListener("loadedmetadata", () => {
            clearTimeout(t);
            const d = audio.duration || 0;
            if (d < 3 || d > 30) durationOk = false;
            resolve();
          });
          audio.addEventListener("error", () => {
            clearTimeout(t);
            reject(new Error("音频加载失败"));
          });
        });
      } catch {
        setMessage("无法读取音频文件，请确认格式正确");
        URL.revokeObjectURL(objectUrl);
        return;
      }
      URL.revokeObjectURL(objectUrl);
      if (!durationOk) {
        setMessage("音频时长需在 3 到 30 秒之间");
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : null;
        if (!dataUrl) {
          setMessage("无法读取音频数据");
          return;
        }
        try {
          setUploading(true);
          setMessage("上传中...");
          const uploaded = await uploadAudioToOSS(dataUrl, projectId);
          if (!uploaded) {
            setMessage("上传失败，请重试");
            setUploading(false);
            return;
          }
          window.dispatchEvent(
            new CustomEvent("flow:updateNodeData", {
              detail: { id, patch: { audioUrl: uploaded } },
            })
          );
          setMessage("上传成功");
        } catch {
          setMessage("上传出错，请稍后重试");
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [id, projectId]
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
        style={{ top: "32%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "60%" }}
        onMouseEnter={() => setHover("image-in")}
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
          style={{ left: -8, top: "32%", transform: "translate(-100%, -50%)" }}
        >
          prompt
        </div>
      )}
      {hover === "image-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "60%", transform: "translate(-100%, -50%)" }}
        >
          image
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
            title="复制链接"
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
            title="下载视频"
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
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>尺寸比例</div>
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
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>分辨率</div>
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
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>时长</div>
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
          <span>{data.duration ? `${data.duration}秒` : "5秒"}</span>
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
                    {opt}秒
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Shot Type 参数（T2V 和 I2V 都有） */}
      <div className="wan26-dropdown" style={{ marginBottom: 8, position: "relative" }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>镜头类型</div>
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
          <span>{data.shotType === "multi" ? "multi（多镜头）" : "single（单镜头）"}</span>
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
                { label: "single（单镜头）", value: "single" },
                { label: "multi（多镜头）", value: "multi" },
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
              音频（可选）
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
            mp3/wav · 3-30s
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
            {uploading ? "上传中..." : data.audioUrl ? "重选" : "选择"}
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
              清除
            </button>
          )}
        </div>
        {message && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: message.includes("成功") ? "#15803d" : "#dc2626",
            }}
          >
            {message}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mp3,audio/wav,.mp3,.wav"
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
            您的浏览器不支持 video 标签
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
            <div style={{ fontSize: 11 }}>等待生成...</div>
          </div>
        )}
      </div>

      {/* 进度条 */}
      <GenerationProgressBar
        status={data.status || "idle"}
        progress={data.status === "running" ? 30 : data.status === "succeeded" ? 100 : 0}
      />

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
