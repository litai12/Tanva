import React from "react";
import { Handle, Position, useStore } from "reactflow";
import { Video, Download, Share2, AlertTriangle, Music4, Image as ImageIcon, Clapperboard, HelpCircle } from "lucide-react";
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
    resolution?: "720P" | "1080P" | string;
    duration?: number;
    seed?: number | string;
    audioUrl?: string;
    history?: VideoHistoryItem[];
  };
  selected?: boolean;
};

const AUDIO_EXT = ["mp3", "wav"];
const AUDIO_ACCEPT = AUDIO_EXT.map((x) => `.${x}`).join(",");
const AUDIO_PATTERN = new RegExp(`\\.(${AUDIO_EXT.join("|")})$`, "i");
const DURATION_OPTIONS = Array.from({ length: 14 }, (_, i) => i + 2);

const zh = {
  promptOptional: "\u63d0\u793a\u8bcd\uff08\u53ef\u9009\uff09",
  firstFrame: "\u9996\u5e27\u56fe\uff08first_frame\uff09",
  lastFrame: "\u5c3e\u5e27\u56fe\uff08last_frame\uff0c\u53ef\u9009\uff09",
  firstClip: "\u9996\u6bb5\u89c6\u9891\uff08first_clip\uff09",
  drivingAudio: "\u9a71\u52a8\u97f3\u9891\uff08driving_audio\uff0c\u53ef\u9009\uff09",
  outputVideo: "\u751f\u6210\u89c6\u9891\u8f93\u51fa",
  resolution: "\u5206\u8fa8\u7387",
  duration: "\u65f6\u957f",
  seed: "Seed\uff08\u53ef\u9009\uff09",
  seedHint: "\u4f8b\u5982 123456\uff0c\u8303\u56f4 0-2147483647",
  guide: "\u73a9\u6cd5\u8bf4\u660e",
  guideTitle: "\u8fd9\u4e48\u73a9 Wan2.7",
  guide1: "1. \u9996\u5e27\u751f\u89c6\u9891\uff1aimage\uff08\u53ef\u52a0 audio\uff09",
  guide2: "2. \u9996\u5c3e\u5e27\u6a21\u5f0f\uff1aimage + image-2\uff08\u53ef\u52a0 audio\uff09",
  guide3: "3. \u89c6\u9891\u7eed\u5199\uff1avideo\uff0c\u53ef\u52a0 image-2 \u63a7\u5236\u7ed3\u5c3e",
  highlights: "\u4eae\u70b9",
  highlightsBody: "\u591a\u6a21\u6001\u8f93\u5165\uff0c2-15 \u79d2\uff0c\u652f\u6301 1080P\uff0cSeed \u53ef\u590d\u73b0",
  uploadAudio: "\u4e0a\u4f20\u97f3\u9891",
  replaceAudio: "\u91cd\u9009\u97f3\u9891",
  clear: "\u6e05\u9664",
  uploading: "\u4e0a\u4f20\u4e2d...",
  uploadOk: "\u4e0a\u4f20\u6210\u529f",
  uploadFailed: "\u4e0a\u4f20\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5",
  uploadErr: "\u4e0a\u4f20\u51fa\u9519\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5",
  badAudioFormat: "\u4e0d\u652f\u6301\u7684\u97f3\u9891\u683c\u5f0f\uff0c\u4ec5\u652f\u6301 mp3/wav",
  badAudioSize: "\u97f3\u9891\u6587\u4ef6\u5927\u5c0f\u4e0d\u80fd\u8d85\u8fc7 15MB",
  badAudioRead: "\u65e0\u6cd5\u8bfb\u53d6\u97f3\u9891\u6587\u4ef6",
  badAudioDuration: "\u97f3\u9891\u65f6\u957f\u9700\u5728 2 \u5230 30 \u79d2\u4e4b\u95f4",
  waiting: "\u7b49\u5f85\u751f\u6210...",
  history: "\u5386\u53f2\u8bb0\u5f55",
  setCurrent: "\u8bbe\u4e3a\u5f53\u524d",
  copyLink: "\u590d\u5236\u94fe\u63a5",
  download: "\u4e0b\u8f7d",
  copyManual: "\u8bf7\u624b\u52a8\u590d\u5236\u4ee5\u4e0b\u94fe\u63a5\uff1a",
  validationTitle: "\u53c2\u6570\u63d0\u793a",
  vRes: "\u5206\u8fa8\u7387\u4ec5\u652f\u6301 720P / 1080P",
  vDuration: "\u65f6\u957f\u4ec5\u652f\u6301 2-15 \u79d2\u6574\u6570",
  vSeed: "Seed \u9700\u4e3a 0 \u5230 2147483647 \u7684\u6574\u6570",
  vFirstFrameMax: "\u9996\u5e27\u53e5\u67c4\u6700\u591a\u8fde\u63a5 1 \u8def",
  vLastFrameMax: "\u5c3e\u5e27\u53e5\u67c4\u6700\u591a\u8fde\u63a5 1 \u8def",
  vFirstClipMax: "\u9996\u6bb5\u89c6\u9891\u53e5\u67c4\u6700\u591a\u8fde\u63a5 1 \u8def",
  vAudioMax: "\u9a71\u52a8\u97f3\u9891\u53e5\u67c4\u6700\u591a\u8fde\u63a5 1 \u8def",
  vNeedInput: "\u81f3\u5c11\u8fde\u63a5 image \u6216 video",
  vFrameVsClip: "first_frame \u548c first_clip \u4e0d\u80fd\u540c\u65f6\u4f7f\u7528",
  vAudioNeedFrame: "driving_audio \u4ec5\u652f\u6301\u4e0e first_frame \u7ec4\u5408",
  vClipNoAudio: "first_clip \u6a21\u5f0f\u4e0d\u652f\u6301 driving_audio",
  vLastAlone: "last_frame \u4e0d\u80fd\u5355\u72ec\u4f7f\u7528",
};

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
  },
});

function Wan27VideoNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const projectId = useProjectContentStore((s) => s.projectId);
  const styles = getStyles(selected);
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const [uploading, setUploading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [showGuide, setShowGuide] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const updateNodeData = React.useCallback((patch: Record<string, any>) => {
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

  const sanitizedVideoUrl = React.useMemo(() => sanitizeMediaUrl(data.videoUrl), [data.videoUrl, sanitizeMediaUrl]);
  const historyItems = React.useMemo(() => (Array.isArray(data.history) ? data.history : []), [data.history]);

  const resolutionRaw = typeof data.resolution === "string" ? data.resolution.trim().toUpperCase() : "1080P";
  const resolution = resolutionRaw === "720P" || resolutionRaw === "1080P" ? resolutionRaw : "1080P";
  const rawDuration = typeof data.duration === "number" && Number.isFinite(data.duration) ? Math.round(data.duration) : 5;
  const duration = rawDuration >= 2 && rawDuration <= 15 ? rawDuration : 5;
  const seedInput = data.seed === undefined || data.seed === null ? "" : String(data.seed).trim();
  const hasRunCredits = typeof data.creditsPerCall === "number" && data.creditsPerCall > 0;

  const mediaHandleStats = useStore((state: any) => {
    const edges = state.edges || [];
    const targetEdges = edges.filter((edge: any) => edge.target === id);
    const count = (h: string) => targetEdges.filter((edge: any) => edge.targetHandle === h).length;
    return { firstFrame: count("image"), lastFrame: count("image-2"), firstClip: count("video"), audio: count("audio") };
  });

  const validationMessages = React.useMemo(() => {
    const msgs: string[] = [];
    if (resolutionRaw !== "720P" && resolutionRaw !== "1080P") msgs.push(lt(zh.vRes, "Resolution only supports 720P / 1080P"));
    if (!Number.isInteger(rawDuration) || rawDuration < 2 || rawDuration > 15) msgs.push(lt(zh.vDuration, "Duration only supports integer 2-15"));
    if (seedInput) {
      const parsed = Number(seedInput);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2147483647) msgs.push(lt(zh.vSeed, "Seed must be integer 0-2147483647"));
    }

    if (mediaHandleStats.firstFrame > 1) msgs.push(lt(zh.vFirstFrameMax, "first_frame handle supports one connection"));
    if (mediaHandleStats.lastFrame > 1) msgs.push(lt(zh.vLastFrameMax, "last_frame handle supports one connection"));
    if (mediaHandleStats.firstClip > 1) msgs.push(lt(zh.vFirstClipMax, "first_clip handle supports one connection"));
    if (mediaHandleStats.audio > 1) msgs.push(lt(zh.vAudioMax, "audio handle supports one connection"));

    const hasFirstFrame = mediaHandleStats.firstFrame > 0;
    const hasLastFrame = mediaHandleStats.lastFrame > 0;
    const hasFirstClip = mediaHandleStats.firstClip > 0;
    const hasDrivingAudio = mediaHandleStats.audio > 0 || (typeof data.audioUrl === "string" && data.audioUrl.trim().length > 0);

    if (!hasFirstFrame && !hasFirstClip && !hasLastFrame && !hasDrivingAudio) msgs.push(lt(zh.vNeedInput, "Connect image or video input"));
    if (hasFirstFrame && hasFirstClip) msgs.push(lt(zh.vFrameVsClip, "first_frame and first_clip cannot be used together"));
    if (hasDrivingAudio && !hasFirstFrame) msgs.push(lt(zh.vAudioNeedFrame, "driving_audio requires first_frame"));
    if (hasFirstClip && hasDrivingAudio) msgs.push(lt(zh.vClipNoAudio, "driving_audio is not supported with first_clip"));
    if (hasLastFrame && !hasFirstFrame && !hasFirstClip) msgs.push(lt(zh.vLastAlone, "last_frame cannot be used alone"));

    return Array.from(new Set(msgs));
  }, [data.audioUrl, lt, mediaHandleStats.audio, mediaHandleStats.firstClip, mediaHandleStats.firstFrame, mediaHandleStats.lastFrame, rawDuration, resolutionRaw, seedInput]);

  const handleButtonMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => event.stopPropagation();

  const handleFileChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    if (!((file.type || "").toLowerCase().startsWith("audio/") || AUDIO_PATTERN.test((file.name || "").trim()))) {
      setMessage(lt(zh.badAudioFormat, "Unsupported audio format, only mp3/wav is allowed"));
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setMessage(lt(zh.badAudioSize, "Audio file size cannot exceed 15MB"));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let durationOk = true;
    try {
      audio.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 5000);
        audio.addEventListener("loadedmetadata", () => {
          clearTimeout(timer);
          const d = audio.duration || 0;
          if (d < 2 || d > 30) durationOk = false;
          resolve();
        });
        audio.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("error"));
        });
      });
    } catch {
      setMessage(lt(zh.badAudioRead, "Unable to read audio file"));
      URL.revokeObjectURL(objectUrl);
      return;
    }
    URL.revokeObjectURL(objectUrl);
    if (!durationOk) {
      setMessage(lt(zh.badAudioDuration, "Audio duration must be between 2 and 30 seconds"));
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) return;
      try {
        setUploading(true);
        setMessage(lt(zh.uploading, "Uploading..."));
        const uploaded = await uploadAudioToOSS(dataUrl, projectId);
        if (!uploaded) {
          setMessage(lt(zh.uploadFailed, "Upload failed"));
          return;
        }
        updateNodeData({ audioUrl: uploaded });
        setMessage(lt(zh.uploadOk, "Upload successful"));
      } catch {
        setMessage(lt(zh.uploadErr, "Upload error"));
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }, [lt, projectId, updateNodeData]);

  const copyVideoLink = React.useCallback(async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt(lt(zh.copyManual, "Please manually copy this link:"), url);
    }
  }, [lt]);

  const triggerDownload = React.useCallback(async (url?: string) => {
    if (!url || isDownloading) return;
    setIsDownloading(true);
    try {
      const isDashScopeOss = url.includes("dashscope") && url.includes("aliyuncs.com");
      const isOssUrl = url.includes("aliyuncs.com") && !isDashScopeOss;
      const downloadUrl = isDashScopeOss || !isOssUrl ? proxifyRemoteAssetUrl(url, { forceProxy: true }) : url;
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
    const patch: Record<string, any> = { videoUrl: item.videoUrl, thumbnail: item.thumbnail, videoVersion: Number(data.videoVersion || 0) + 1 };
    if (data.status !== "running") {
      patch.status = "succeeded";
      patch.error = undefined;
    }
    updateNodeData(patch);
  }, [data.status, data.videoVersion, updateNodeData]);

  const formatHistoryTime = React.useCallback((iso: string) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }, []);

  const clearAudio = () => {
    updateNodeData({ audioUrl: undefined });
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const tooltip = (key: string, top: string, text: string) => hover === key ? <div className="flow-tooltip" style={{ left: -8, top, transform: "translate(-100%, -50%)" }}>{text}</div> : null;

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left} id="text" style={{ top: "14%" }} onMouseEnter={() => setHover("text")} onMouseLeave={() => setHover(null)} />
      <Handle type="target" position={Position.Left} id="image" style={{ top: "30%" }} onMouseEnter={() => setHover("image")} onMouseLeave={() => setHover(null)} />
      <Handle type="target" position={Position.Left} id="image-2" style={{ top: "46%" }} onMouseEnter={() => setHover("image-2")} onMouseLeave={() => setHover(null)} />
      <Handle type="target" position={Position.Left} id="video" style={{ top: "62%" }} onMouseEnter={() => setHover("video")} onMouseLeave={() => setHover(null)} />
      <Handle type="target" position={Position.Left} id="audio" style={{ top: "78%" }} onMouseEnter={() => setHover("audio")} onMouseLeave={() => setHover(null)} />
      <Handle type="source" position={Position.Right} id="video" style={{ top: "50%" }} onMouseEnter={() => setHover("video-out")} onMouseLeave={() => setHover(null)} />

      {tooltip("text", "14%", lt(zh.promptOptional, "Prompt (optional)"))}
      {tooltip("image", "30%", lt(zh.firstFrame, "First frame (first_frame)"))}
      {tooltip("image-2", "46%", lt(zh.lastFrame, "Last frame (last_frame, optional)"))}
      {tooltip("video", "62%", lt(zh.firstClip, "First clip (first_clip)"))}
      {tooltip("audio", "78%", lt(zh.drivingAudio, "Driving audio (driving_audio, optional)"))}
      {hover === "video-out" && <div className="flow-tooltip" style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>{lt(zh.outputVideo, "Generated video output")}</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><Video size={18} /><span>Wan2.7</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className={`tanva-video-header-btn tanva-video-header-help ${showGuide ? "is-active" : "is-inactive"}`}
            onClick={() => setShowGuide(!showGuide)}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: showGuide ? "#3b82f6" : "#f3f4f6",
              color: showGuide ? "#fff" : "#6b7280",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            title={lt("玩法说明", "Help")}
          >
            <HelpCircle size={14} />
          </button>
          <button className="tanva-video-header-btn tanva-video-header-run run-btn-with-credit" onClick={() => data.onRun?.(id)} onMouseDown={handleButtonMouseDown} disabled={data.status === "running"} style={{ ...styles.iconBtn, background: data.status === "running" ? "#e5e7eb" : "#111827", opacity: data.status === "running" ? 0.6 : 1, cursor: data.status === "running" ? "not-allowed" : "pointer", fontSize: 12 }}>
            {hasRunCredits ? <><span className="run-text-trigger">Run</span><RunCreditBadge credits={data.creditsPerCall} runButton /></> : "Run"}
          </button>
          <button className="tanva-video-header-btn tanva-video-header-share" onClick={() => copyVideoLink(data.videoUrl)} onMouseDown={handleButtonMouseDown} disabled={!data.videoUrl} style={{ ...styles.iconBtn, opacity: data.videoUrl ? 1 : 0.35, cursor: data.videoUrl ? "pointer" : "not-allowed" }}><Share2 size={14} /></button>
          <button className="tanva-video-header-btn tanva-video-header-download" onClick={() => triggerDownload(data.videoUrl)} onMouseDown={handleButtonMouseDown} disabled={!data.videoUrl || isDownloading} style={{ ...styles.iconBtn, background: !data.videoUrl || isDownloading ? "#e5e7eb" : "#111827", opacity: !data.videoUrl || isDownloading ? 0.35 : 1, cursor: !data.videoUrl || isDownloading ? "not-allowed" : "pointer" }}>{isDownloading ? <span style={{ fontSize: 10, fontWeight: 600, color: "#111827" }}>...</span> : <Download size={14} />}</button>
        </div>
      </div>

      {/* 玩法说明 */}
      {showGuide && (
        <div style={{
          fontSize: 11,
          color: "#374151",
          background: "#f0f9ff",
          padding: "8px",
          borderRadius: 6,
          marginBottom: 8,
          border: "1px solid #bfdbfe",
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#1e40af" }}>
            🎬 {lt(zh.guideTitle, "How to play Wan2.7")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("首帧生视频", "First-frame mode")}:</strong> {lt("image（可加 audio）", "image (optional audio)")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("首尾帧模式", "Start-end mode")}:</strong> {lt("image + image-2（可加 audio）", "image + image-2 (optional audio)")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("视频续写", "Continuation mode")}:</strong> {lt("video（可加 image-2 控制结尾）", "video (optional image-2 to control ending)")}
          </div>
          <div style={{ color: "#6b7280", fontSize: 10, marginTop: 4 }}>
            💡 {lt("亮点：多模态输入，2-15秒，1080P，seed 可复现", "Highlights: multimodal input, 2-15s, 1080P, reproducible with seed")}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 12, color: "#475569" }}>
            <div style={{ marginBottom: 4 }}>{lt(zh.resolution, "Resolution")}</div>
            <NodeSelect value={resolution} options={[{ value: "720P", label: "720P" }, { value: "1080P", label: "1080P" }]} onChange={(value) => updateNodeData({ resolution: value })} menuLabel={lt(zh.resolution, "Resolution")} title={lt("\u9009\u62e9\u5206\u8fa8\u7387", "Select resolution")} />
          </label>
          <label style={{ fontSize: 12, color: "#475569" }}>
            <div style={{ marginBottom: 4 }}>{lt(zh.duration, "Duration")}</div>
            <select value={duration} onChange={(e) => updateNodeData({ duration: Number(e.target.value) })} style={styles.input}>{DURATION_OPTIONS.map((v) => <option key={v} value={v}>{v}s</option>)}</select>
          </label>
        </div>

        <label style={{ fontSize: 12, color: "#475569" }}>
          <div style={{ marginBottom: 4 }}>{lt(zh.seed, "Seed (optional)")}</div>
          <input type="text" inputMode="numeric" value={seedInput} placeholder={lt(zh.seedHint, "Example: 123456, range 0-2147483647")} onChange={(e) => {
            const value = e.target.value.trim();
            if (!value) { updateNodeData({ seed: undefined }); return; }
            if (/^-?\d+$/.test(value)) { updateNodeData({ seed: Number(value) }); return; }
            updateNodeData({ seed: value });
          }} style={styles.input} />
        </label>
      </div>

      <div style={{ marginTop: 8, marginBottom: 6, padding: "8px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 11, fontWeight: 600, color: "#0f172a", flexWrap: "wrap" }}><ImageIcon size={12} /><span>first_frame</span><ImageIcon size={12} /><span>last_frame</span><Clapperboard size={12} /><span>first_clip</span><Music4 size={12} /><span>driving_audio</span></div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} style={{ flex: 1, padding: "4px 8px", borderRadius: 4, border: "1px solid #cbd5e1", background: "#fff", fontSize: 11, opacity: uploading ? 0.6 : 1 }}>{uploading ? lt(zh.uploading, "Uploading...") : data.audioUrl ? lt(zh.replaceAudio, "Replace audio") : lt(zh.uploadAudio, "Upload audio")}</button>
          {data.audioUrl && <button type="button" onClick={clearAudio} disabled={uploading} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", fontSize: 11, color: "#dc2626" }}>{lt(zh.clear, "Clear")}</button>}
        </div>
        {message && <div style={{ marginTop: 4, fontSize: 10, color: /success|\u6210\u529f/i.test(message) ? "#15803d" : "#dc2626" }}>{message}</div>}
        <input ref={fileInputRef} type="file" accept={AUDIO_ACCEPT} style={{ display: "none" }} onChange={handleFileChange} />
      </div>

      <div style={{ width: "100%", aspectRatio: previewAspect, minHeight: 140, background: "#f8fafc", borderRadius: 6, border: "1px solid #eef0f2", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 8 }}>
        {sanitizedVideoUrl ? (
          <video key={`${sanitizedVideoUrl}-${data.videoVersion || 0}`} controls style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 6, background: "#000" }} onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`); }}><source src={sanitizedVideoUrl} type="video/mp4" /></video>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "#94a3b8" }}><Video size={24} strokeWidth={2} /><div style={{ fontSize: 11 }}>{lt(zh.waiting, "Waiting for generation...")}</div></div>
        )}
      </div>

      <GenerationProgressBar status={data.status || "idle"} progress={data.status === "running" ? 30 : data.status === "succeeded" ? 100 : 0} />

      {validationMessages.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid #fcd34d", background: "#fffbeb", color: "#92400e", fontSize: 11, display: "grid", gap: 4 }}>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}><AlertTriangle size={12} /><span>{lt(zh.validationTitle, "Validation hints")}</span></div>
          {validationMessages.map((msg, idx) => <div key={`wan27-validation-${idx}`}>{`${idx + 1}. ${msg}`}</div>)}
        </div>
      )}

      {historyItems.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setShowHistory((v) => !v)}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{lt(zh.history, "History")}</span>
            <span style={{ fontSize: 14, color: "#64748b" }}>{showHistory ? "v" : ">"}</span>
          </div>
          {showHistory && historyItems.map((item, index) => {
            const isActive = item.videoUrl === data.videoUrl;
            return (
              <div key={item.id} style={{ borderRadius: 6, border: `1px solid ${isActive ? "#c7d2fe" : "#e2e8f0"}`, background: isActive ? "#eef2ff" : "#fff", padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11, color: "#475569" }}>#{index + 1} | {formatHistoryTime(item.createdAt)}</div>
                <div style={{ fontSize: 11, color: "#0f172a" }}>{item.prompt.length > 80 ? `${item.prompt.slice(0, 80)}...` : item.prompt}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {!isActive && <button type="button" onClick={() => handleApplyHistory(item)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #94a3b8", background: "#fff", fontSize: 11 }}>{lt(zh.setCurrent, "Set as current")}</button>}
                  <button type="button" onClick={() => copyVideoLink(item.videoUrl)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #94a3b8", background: "#fff", fontSize: 11 }}>{lt(zh.copyLink, "Copy link")}</button>
                  <button type="button" onClick={() => triggerDownload(item.videoUrl)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #94a3b8", background: "#fff", fontSize: 11 }}>{lt(zh.download, "Download")}</button>
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
