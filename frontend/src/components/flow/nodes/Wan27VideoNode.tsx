import React from "react";
import { Handle, Position } from "reactflow";
import { Video, Download, Share2, AlertTriangle, Music4, Image as ImageIcon, Clapperboard } from "lucide-react";
import GenerationProgressBar from "./GenerationProgressBar";
import { uploadAudioToOSS } from "@/stores/aiChatStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";
import RunCreditBadge from "./RunCreditBadge";
import NodeSelect from "./NodeSelect";

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
    creditsPerCall?: number;
    resolution?: "720P" | "1080P";
    duration?: number;
    promptExtend?: boolean;
    watermark?: boolean;
    audioUrl?: string;
    history?: VideoHistoryItem[];
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
  if (mime.startsWith("audio/")) return true;
  return SUPPORTED_AUDIO_PATTERN.test((file.name || "").trim());
};

function Wan27VideoNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const projectId = useProjectContentStore((s) => s.projectId);
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected ? "0 0 0 2px rgba(37,99,235,0.12)" : "0 1px 2px rgba(0,0,0,0.04)";
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);

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

  const historyItems = React.useMemo<VideoHistoryItem[]>(
    () => (Array.isArray(data.history) ? data.history : []),
    [data.history]
  );

  const handleChooseFile = React.useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    const maxSize = 15 * 1024 * 1024;
    if (!isSupportedAudioFile(file)) {
      setMessage(lt("不支持的音频格式", "Unsupported audio format"));
      return;
    }
    if (file.size > maxSize) {
      setMessage(lt("文件大小不能超过 15MB", "File size cannot exceed 15MB"));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let durationOk = true;
    try {
      audio.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 5000);
        audio.addEventListener("loadedmetadata", () => {
          clearTimeout(t);
          const d = audio.duration || 0;
          if (d < 3 || d > 30) durationOk = false;
          resolve();
        });
        audio.addEventListener("error", () => {
          clearTimeout(t);
          reject(new Error("error"));
        });
      });
    } catch {
      setMessage(lt("无法读取音频文件", "Unable to read audio file"));
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
      if (!dataUrl) return;
      try {
        setUploading(true);
        setMessage(lt("上传中...", "Uploading..."));
        const uploaded = await uploadAudioToOSS(dataUrl, projectId);
        if (!uploaded) {
          setMessage(lt("上传失败，请重试", "Upload failed"));
          return;
        }
        window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch: { audioUrl: uploaded } } }));
        setMessage(lt("上传成功", "Upload successful"));
      } catch {
        setMessage(lt("上传出错，请稍后重试", "Upload error"));
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }, [id, lt, projectId]);

  const handleClearAudio = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch: { audioUrl: undefined } } }));
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [id]);

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
      const isDashScopeOss = url.includes("dashscope") && url.includes("aliyuncs.com");
      const isOssUrl = url.includes("aliyuncs.com") && !isDashScopeOss;
      const downloadUrl = (isDashScopeOss || !isOssUrl) ? proxifyRemoteAssetUrl(url, { forceProxy: true }) : url;
      const response = await fetch(downloadUrl, { mode: "cors", credentials: "omit" });
      if (response.ok) {
        const blob = await response.blob();
        const videoBlob = blob.type.startsWith("video/") ? blob : new Blob([blob], { type: "video/mp4" });
        const blobUrl = URL.createObjectURL(videoBlob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `wan27-${new Date().toISOString().split("T")[0]}.mp4`;
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

  const handleApplyHistory = React.useCallback((item: VideoHistoryItem) => {
    const patch: Record<string, any> = {
      videoUrl: item.videoUrl,
      thumbnail: item.thumbnail,
      videoVersion: Number(data.videoVersion || 0) + 1,
    };
    if (data.status !== "running") {
      patch.status = "succeeded";
      patch.error = undefined;
    }
    window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch } }));
  }, [id, data.videoVersion, data.status]);

  const formatHistoryTime = React.useCallback((iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }, []);

  const resolution = data.resolution || "720P";
  const duration = data.duration || 10;
  const promptExtend = data.promptExtend !== false;
  const watermark = data.watermark !== false;

  return (
    <div style={{ width: 300, padding: 10, background: "#fff", border: `1px solid ${borderColor}`, borderRadius: 10, boxShadow, position: "relative" }}>
      <Handle type="target" position={Position.Left} id="text" style={{ top: "14%" }} onMouseEnter={() => setHover("text")} onMouseLeave={() => setHover(null)} />
      <Handle type="target" position={Position.Left} id="image" style={{ top: "30%" }} onMouseEnter={() => setHover("image")} onMouseLeave={() => setHover(null)} />
      <Handle type="target" position={Position.Left} id="image-2" style={{ top: "46%" }} onMouseEnter={() => setHover("image-2")} onMouseLeave={() => setHover(null)} />
      <Handle type="target" position={Position.Left} id="video" style={{ top: "62%" }} onMouseEnter={() => setHover("video")} onMouseLeave={() => setHover(null)} />
      <Handle type="target" position={Position.Left} id="audio" style={{ top: "78%" }} onMouseEnter={() => setHover("audio")} onMouseLeave={() => setHover(null)} />
      <Handle type="source" position={Position.Right} id="video" style={{ top: "50%" }} onMouseEnter={() => setHover("video-out")} onMouseLeave={() => setHover(null)} />

      {hover === "text" && <div className="flow-tooltip" style={{ left: -8, top: "14%", transform: "translate(-100%, -50%)" }}>prompt</div>}
      {hover === "image" && <div className="flow-tooltip" style={{ left: -8, top: "30%", transform: "translate(-100%, -50%)" }}>first_frame</div>}
      {hover === "image-2" && <div className="flow-tooltip" style={{ left: -8, top: "46%", transform: "translate(-100%, -50%)" }}>last_frame</div>}
      {hover === "video" && <div className="flow-tooltip" style={{ left: -8, top: "62%", transform: "translate(-100%, -50%)" }}>first_clip</div>}
      {hover === "audio" && <div className="flow-tooltip" style={{ left: -8, top: "78%", transform: "translate(-100%, -50%)" }}>driving_audio</div>}
      {hover === "video-out" && <div className="flow-tooltip" style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>video</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          <Video size={18} />
          <span>
            Wan2.7 I2V
            <RunCreditBadge credits={data.creditsPerCall} inline />
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => data.onRun?.(id)} disabled={data.status === "running"} style={{ width: 36, height: 32, borderRadius: 8, border: "none", background: data.status === "running" ? "#e5e7eb" : "#111827", color: "#fff", opacity: data.status === "running" ? 0.6 : 1 }}>Run</button>
          <button onClick={() => copyVideoLink(data.videoUrl)} disabled={!data.videoUrl} style={{ width: 36, height: 32, borderRadius: 8, border: "none", background: "#111827", color: "#fff", opacity: data.videoUrl ? 1 : 0.35 }}><Share2 size={14} /></button>
          <button onClick={() => triggerDownload(data.videoUrl)} disabled={!data.videoUrl || isDownloading} style={{ width: 36, height: 32, borderRadius: 8, border: "none", background: !data.videoUrl || isDownloading ? "#e5e7eb" : "#111827", color: "#fff", opacity: !data.videoUrl || isDownloading ? 0.35 : 1 }}>{isDownloading ? <span style={{ fontSize: 10, fontWeight: 600, color: "#111827" }}>···</span> : <Download size={14} />}</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
	          <label style={{ fontSize: 12, color: "#475569" }}>
	            <div style={{ marginBottom: 4 }}>{lt("分辨率", "Resolution")}</div>
	            <NodeSelect
	              value={resolution}
	              options={[
	                { value: "720P", label: "720P" },
	                { value: "1080P", label: "1080P" },
	              ]}
	              onChange={(value) =>
	                window.dispatchEvent(
	                  new CustomEvent("flow:updateNodeData", { detail: { id, patch: { resolution: value } } })
	                )
	              }
	              menuLabel={lt("分辨率", "Resolution")}
	              title={lt("选择分辨率", "Select resolution")}
	            />
	          </label>
          <label style={{ fontSize: 12, color: "#475569" }}>
            <div style={{ marginBottom: 4 }}>{lt("时长", "Duration")}</div>
            <select value={duration} onChange={(e) => window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch: { duration: Number(e.target.value) } } }))} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff" }}>
              {[5, 10, 15].map((value) => <option key={value} value={value}>{value}s</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch: { promptExtend: !promptExtend } } }))} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, border: `1px solid ${promptExtend ? "#2563eb" : "#e5e7eb"}`, background: promptExtend ? "#eff6ff" : "#fff", fontSize: 12 }}>
            <span>{lt("Prompt Extend", "Prompt Extend")}</span>
            <span>{promptExtend ? "ON" : "OFF"}</span>
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("flow:updateNodeData", { detail: { id, patch: { watermark: !watermark } } }))} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, border: `1px solid ${watermark ? "#2563eb" : "#e5e7eb"}`, background: watermark ? "#eff6ff" : "#fff", fontSize: 12 }}>
            <span>{lt("水印", "Watermark")}</span>
            <span>{watermark ? "ON" : "OFF"}</span>
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, marginBottom: 6, padding: "8px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 11, fontWeight: 600, color: "#0f172a", flexWrap: "wrap" }}>
          <ImageIcon size={12} />
          <span>first_frame</span>
          <ImageIcon size={12} />
          <span>last_frame</span>
          <Clapperboard size={12} />
          <span>first_clip</span>
          <Music4 size={12} />
          <span>driving_audio</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" onClick={handleChooseFile} disabled={uploading} style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", background: "#fff", fontSize: 11, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? lt("上传中...", "Uploading...") : data.audioUrl ? lt("重选音频", "Replace audio") : lt("上传音频", "Upload audio")}
          </button>
          {data.audioUrl && <button type="button" onClick={handleClearAudio} disabled={uploading} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", fontSize: 11, color: "#dc2626" }}>{lt("清除", "Clear")}</button>}
        </div>
        {message && <div style={{ marginTop: 4, fontSize: 10, color: /成功|success/i.test(message) ? "#15803d" : "#dc2626" }}>{message}</div>}
        <input ref={fileInputRef} type="file" accept={SUPPORTED_AUDIO_ACCEPT} style={{ display: "none" }} onChange={handleFileChange} />
      </div>

      <div style={{ width: "100%", aspectRatio: previewAspect, minHeight: 140, background: "#f8fafc", borderRadius: 6, border: "1px solid #eef0f2", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 8 }}>
        {sanitizedVideoUrl ? (
          <video key={`${sanitizedVideoUrl}-${data.videoVersion || 0}`} ref={videoRef} controls style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6, background: "#000" }} onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`); }}>
            <source src={sanitizedVideoUrl} type="video/mp4" />
          </video>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "#94a3b8" }}>
            <Video size={24} strokeWidth={2} />
            <div style={{ fontSize: 11 }}>{lt("等待生成...", "Waiting for generation...")}</div>
          </div>
        )}
      </div>

      <GenerationProgressBar status={data.status || "idle"} progress={data.status === "running" ? 30 : data.status === "succeeded" ? 100 : 0} />

      {historyItems.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setShowHistory(!showHistory)}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{lt("历史记录", "History")}</span>
            <span style={{ fontSize: 14, color: "#64748b" }}>{showHistory ? "▴" : "▾"}</span>
          </div>
          {showHistory && historyItems.map((item, index) => {
            const isActive = item.videoUrl === data.videoUrl;
            return (
              <div key={item.id} style={{ borderRadius: 6, border: "1px solid " + (isActive ? "#c7d2fe" : "#e2e8f0"), background: isActive ? "#eef2ff" : "#fff", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11, color: "#475569" }}>#{index + 1} · {formatHistoryTime(item.createdAt)}</div>
                <div style={{ fontSize: 11, color: "#0f172a" }}>{item.prompt.length > 80 ? `${item.prompt.slice(0, 80)}…` : item.prompt}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {!isActive && <button type="button" onClick={() => handleApplyHistory(item)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #94a3b8", background: "#fff", fontSize: 11 }}>{lt("设为当前", "Set as current")}</button>}
                  <button type="button" onClick={() => copyVideoLink(item.videoUrl)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #94a3b8", background: "#fff", fontSize: 11 }}>{lt("复制链接", "Copy link")}</button>
                  <button type="button" onClick={() => triggerDownload(item.videoUrl)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #94a3b8", background: "#fff", fontSize: 11 }}>{lt("下载", "Download")}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.error && (
        <div style={{ marginTop: 6, padding: "6px 8px", background: "#fef2f2", border: "1px solid #fecdd3", borderRadius: 6, color: "#b91c1c", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertTriangle size={14} />
          <span>{data.error}</span>
        </div>
      )}
    </div>
  );
}

export default React.memo(Wan27VideoNode);
