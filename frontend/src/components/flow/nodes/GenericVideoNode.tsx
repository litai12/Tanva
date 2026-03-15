import React from "react";
import { Handle, Position, useReactFlow, useStore } from "reactflow";
import { AlertTriangle, Video, Share2, Download } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { useAuthStore } from "@/stores/authStore";
import { uploadAudioToOSS } from "@/stores/aiChatStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";

export type VideoProvider = "kling" | "kling-2.6" | "kling-o3" | "vidu" | "viduq3-pro" | "doubao";

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
    klingModel?: "kling-v2-1" | "kling-v2-6" | "kling-v3-0";
    mode?: "std" | "pro";
    sound?: boolean;
    audioUrls?: string[];
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
  "kling-2.6": { name: "Kling 2.6", zh: "Kling 2.6" },
  "kling-o3": { name: "Kling O3", zh: "Kling O3" },
  vidu: { name: "Vidu", zh: "Vidu" },
  "viduq3-pro": { name: "Vidu Q3", zh: "Vidu Q3" },
  doubao: { name: "Seedance", zh: "Seedance" },
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
  const name = (file.name || "").trim();
  return SUPPORTED_AUDIO_PATTERN.test(name);
};

function GenericVideoNodeInner({ id, data, selected }: Props) {
  const { lt, isZh } = useLocaleText();
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const audioInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadFeedback, setDownloadFeedback] =
    React.useState<DownloadFeedback | null>(null);
  const [audioUploading, setAudioUploading] = React.useState(false);
  const [audioMessage, setAudioMessage] = React.useState<string | null>(null);
  const downloadFeedbackTimer = React.useRef<number | undefined>(undefined);
  const user = useAuthStore((state) => state.user);
  const projectId = useProjectContentStore((state) => state.projectId);
  const [showHistory, setShowHistory] = React.useState(false);

  // 检测是否有图片输入连接
  const hasImageInput = useStore((state) => {
    const edges = state.edges || [];
    return edges.some(
      (edge) => edge.target === id && edge.targetHandle === "image"
    );
  });

  // 检测图片输入数量
  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter(
      (edge) => edge.target === id && edge.targetHandle === "image"
    ).length;
  });

  const provider = data.provider || "kling";
  const klingModel =
    data.klingModel ||
    (provider === "kling-2.6" ? "kling-v2-6" : "kling-v2-1");
  const isUnifiedKlingNode = provider === "kling" || provider === "kling-2.6";
  const isKling26Model = isUnifiedKlingNode && (klingModel === "kling-v2-6" || klingModel === "kling-v3-0");
  const providerInfo = isUnifiedKlingNode
    ? PROVIDER_CONFIG.kling
    : PROVIDER_CONFIG[provider] || PROVIDER_CONFIG["kling"];

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
      console.warn(lt("无法重置视频播放器", "Failed to reset video player"), error);
    }
  }, [cacheBustedVideoUrl, lt, sanitizedVideoUrl]);

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
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest?.(".video-dropdown")) {
        setModelMenuOpen(false);
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
  const audioUrls = React.useMemo(
    () => (Array.isArray(data.audioUrls) ? data.audioUrls.filter(Boolean) : []),
    [data.audioUrls]
  );

  // 根据供应商配置不同的选项
  const getAspectOptions = () => {
    if (provider === "kling" || provider === "kling-2.6") {
      return [
        { label: lt("自动", "Auto"), value: "" },
        { label: lt("横屏（16:9）", "Landscape (16:9)"), value: "16:9" },
        { label: lt("竖屏（9:16）", "Portrait (9:16)"), value: "9:16" },
        { label: lt("方形（1:1）", "Square (1:1)"), value: "1:1" },
      ];
    }
    return [
      { label: lt("自动", "Auto"), value: "" },
      { label: lt("横屏（16:9）", "Landscape (16:9)"), value: "16:9" },
      { label: lt("竖屏（9:16）", "Portrait (9:16)"), value: "9:16" },
    ];
  };

  const getDurationOptions = () => {
    if (provider === "kling" || provider === "kling-2.6") {
      return [
        { label: lt("5秒", "5s"), value: 5 },
        { label: lt("10秒", "10s"), value: 10 },
      ];
    }
    if (provider === "vidu" || provider === "viduq3-pro") {
      return [
        { label: lt("1秒", "1s"), value: 1 },
        { label: lt("2秒", "2s"), value: 2 },
        { label: lt("3秒", "3s"), value: 3 },
        { label: lt("4秒", "4s"), value: 4 },
        { label: lt("5秒", "5s"), value: 5 },
        { label: lt("6秒", "6s"), value: 6 },
        { label: lt("7秒", "7s"), value: 7 },
        { label: lt("8秒", "8s"), value: 8 },
        { label: lt("9秒", "9s"), value: 9 },
        { label: lt("10秒", "10s"), value: 10 },
      ];
    }
    if (provider === "doubao") {
      return [
        { label: lt("3秒", "3s"), value: 3 },
        { label: lt("4秒", "4s"), value: 4 },
        { label: lt("5秒", "5s"), value: 5 },
        { label: lt("6秒", "6s"), value: 6 },
        { label: lt("8秒", "8s"), value: 8 },
      ];
    }
    return [];
  };

  const aspectOptions = React.useMemo(() => {
    if (provider === "vidu" || provider === "viduq3-pro") {
      return [
        { label: lt("自动", "Auto"), value: "" },
        { label: lt("横屏 (16:9)", "Landscape (16:9)"), value: "16:9" },
        { label: lt("竖屏 (9:16)", "Portrait (9:16)"), value: "9:16" },
        { label: lt("竖版 (3:4)", "Vertical (3:4)"), value: "3:4" },
        { label: lt("横版 (4:3)", "Horizontal (4:3)"), value: "4:3" },
        { label: lt("方形 (1:1)", "Square (1:1)"), value: "1:1" },
      ];
    }
    return getAspectOptions();
  }, [getAspectOptions, lt, provider]);
  const klingModelOptions = React.useMemo(
    () => [
      { label: "Kling 2.1", value: "kling-v2-1" as const },
      { label: "Kling 2.6", value: "kling-v2-6" as const },
      { label: "Kling 3.0", value: "kling-v3-0" as const },
    ],
    []
  );
  const durationOptions = React.useMemo(() => getDurationOptions(), [provider, lt]);
  const shouldShowAspectSelector = !hasImageInput;

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

  const handleKlingModelChange = React.useCallback(
    (value: "kling-v2-1" | "kling-v2-6" | "kling-v3-0") => {
      if (value === klingModel) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              klingModel: value,
              sound: value === "kling-v2-6" ? false : undefined,
            },
          },
        })
      );
    },
    [id, klingModel]
  );

  React.useEffect(() => {
    if (!isKling26Model || data.sound === false) return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { sound: false } },
      })
    );
  }, [data.sound, id, isKling26Model]);

  const handleRemoveAudioAt = React.useCallback(
    (index: number) => {
      const nextAudioUrls = audioUrls.filter((_, itemIndex) => itemIndex !== index);
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { audioUrls: nextAudioUrls } },
        })
      );
      setAudioMessage(null);
      if (audioInputRef.current && nextAudioUrls.length === 0) {
        audioInputRef.current.value = "";
      }
    },
    [audioUrls, id]
  );

  const handleAudioInputChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const incomingFiles = Array.from(fileList);
      if (incomingFiles.length + audioUrls.length > 2) {
        const message = lt("最多只能上传 2 个音频文件", "You can upload up to 2 audio files");
        setAudioMessage(message);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message, type: "warning" },
          })
        );
        event.target.value = "";
        return;
      }

      try {
        setAudioUploading(true);
        setAudioMessage(lt("音频上传中...", "Uploading audio..."));
        const uploadedUrls: string[] = [];

        for (const file of incomingFiles) {
          if (!isSupportedAudioFile(file)) {
            throw new Error(
              lt(
                "不支持的音频格式，请上传常见音频文件",
                "Unsupported audio format, please upload a common audio file"
              )
            );
          }

          const objectUrl = URL.createObjectURL(file);
          try {
            const duration = await new Promise<number>((resolve, reject) => {
              const audio = document.createElement("audio");
              const timeoutId = window.setTimeout(() => {
                reject(
                  new Error(
                    lt("无法读取音频时长", "Unable to read audio duration")
                  )
                );
              }, 5000);

              audio.preload = "metadata";
              audio.src = objectUrl;
              audio.addEventListener("loadedmetadata", () => {
                window.clearTimeout(timeoutId);
                resolve(audio.duration || 0);
              });
              audio.addEventListener("error", () => {
                window.clearTimeout(timeoutId);
                reject(
                  new Error(
                    lt("无法读取音频文件，请确认格式正确", "Unable to read audio file, please verify the format")
                  )
                );
              });
            });

            if (duration < 5 || duration > 30) {
              throw new Error(
                lt("每个音频文件时长需在 5 到 30 秒之间", "Each audio file must be between 5 and 30 seconds")
              );
            }
          } finally {
            URL.revokeObjectURL(objectUrl);
          }

          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") resolve(reader.result);
              else reject(new Error(lt("无法读取音频数据", "Unable to read audio data")));
            };
            reader.onerror = () =>
              reject(new Error(lt("无法读取音频文件", "Unable to read audio file")));
            reader.readAsDataURL(file);
          });

          const uploaded = await uploadAudioToOSS(dataUrl, projectId);
          if (!uploaded) {
            throw new Error(lt("音频上传失败，请重试", "Audio upload failed, please retry"));
          }
          uploadedUrls.push(uploaded);
        }

        const nextAudioUrls = [...audioUrls, ...uploadedUrls].slice(0, 2);
        window.dispatchEvent(
          new CustomEvent("flow:updateNodeData", {
            detail: {
              id,
              patch: {
                audioUrls: nextAudioUrls,
                sound: false,
              },
            },
          })
        );
        setAudioMessage(
          lt(
            "已上传音频，sound 将自动按 no 提交",
            "Audio uploaded, sound will be submitted as no automatically"
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : lt("音频上传失败，请稍后重试", "Audio upload failed, please retry later");
        setAudioMessage(message);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message, type: "error" },
          })
        );
      } finally {
        setAudioUploading(false);
        event.target.value = "";
      }
    },
    [audioUrls, id, lt, projectId]
  );

  const aspectLabel = React.useMemo(() => {
    const match = aspectOptions.find((opt) => opt.value === aspectRatioValue);
    return match ? match.label : lt("自动", "Auto");
  }, [aspectOptions, aspectRatioValue, lt]);

  const durationLabel = React.useMemo(() => {
    const match = durationOptions.find((opt) => opt.value === clipDuration);
    if (match) return match.label;
    if (clipDuration) return lt(`${clipDuration}秒`, `${clipDuration}s`);
    return lt("未设置", "Not set");
  }, [clipDuration, durationOptions, lt]);
  const klingModelLabel = React.useMemo(() => {
    const match = klingModelOptions.find((opt) => opt.value === klingModel);
    return match?.label || "Kling 2.1";
  }, [klingModel, klingModelOptions]);

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
    if (!url) {
      alert(lt("没有可复制的视频链接", "No video link to copy"));
      return;
    }
    try {
      // 优先使用 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        alert(lt("已复制视频链接", "Video link copied"));
        return;
      }
      // 备用方案：使用 execCommand
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
        alert(lt("复制失败，请手动复制：\n", "Copy failed. Please copy manually:\n") + url);
      }
    } catch (error) {
      console.error(lt("复制失败:", "Copy failed:"), error);
      // 最后的备用方案：显示链接让用户手动复制
      prompt(lt("复制失败，请手动复制以下链接：", "Copy failed. Please copy this link manually:"), url);
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
      setDownloadFeedback({
        type: "progress",
        message: lt("视频下载中，请稍等...", "Downloading video..."),
      });
      try {
        // 检测是否为 OSS URL（阿里云 OSS 支持 CORS，可直接下载）
        const isOssUrl = url.includes('aliyuncs.com');
        // 非 OSS URL 需要代理
        const downloadUrl = isOssUrl ? url : proxifyRemoteAssetUrl(url, { forceProxy: true });
        console.log(`[Video Download] Source URL: ${url}`);
        console.log(`[Video Download] Download URL: ${downloadUrl}, isOSS: ${isOssUrl}`);

        const response = await fetch(downloadUrl, {
          mode: "cors",
          credentials: "omit",
        });
        console.log(`[Video Download] Response: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);

        if (response.ok) {
          const blob = await response.blob();
          console.log(`[Video Download] Blob type: ${blob.type}, size: ${blob.size}`);
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
          setDownloadFeedback({
            type: "success",
            message: lt("下载完成，稍后可再次下载", "Download completed"),
          });
          scheduleFeedbackClear(2000);
        } else {
          // 下载失败，尝试在新标签页打开
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setDownloadFeedback({
            type: "success",
            message: lt("已在新标签页打开视频链接", "Opened video link in new tab"),
          });
          scheduleFeedbackClear(3000);
        }
      } catch (error) {
        console.error(lt("下载失败:", "Download failed:"), error);
        // 下载失败时，尝试直接打开链接
        window.open(url, "_blank");
        setDownloadFeedback({
          type: "error",
          message: lt("下载失败，已在新标签页打开", "Download failed, opened in new tab"),
        });
        scheduleFeedbackClear(4000);
      } finally {
        setIsDownloading(false);
      }
    },
    [isDownloading, lt, scheduleFeedbackClear]
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
          {lt("您的浏览器不支持 video 标签", "Your browser does not support video tag")}
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
        <div style={{ fontSize: 11 }}>{lt("等待生成...", "Waiting...")}</div>
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
          <span>{isZh ? providerInfo.zh : providerInfo.name}</span>
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

      {/* 尺寸选择：接入图片后隐藏，未接图时显示 */}
      {isUnifiedKlingNode && (
        <div
          className='video-dropdown'
          style={{ marginBottom: 8, position: "relative" }}
        >
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("模型", "Model")}
          </div>
          <button
            type='button'
            onClick={(event) => {
              event.stopPropagation();
              setAspectMenuOpen(false);
              setDurationMenuOpen(false);
              setModelMenuOpen((open) => !open);
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
            <span>{klingModelLabel}</span>
            <span style={{ fontSize: 16, lineHeight: 1 }}>
              {modelMenuOpen ? "▴" : "▾"}
            </span>
          </button>
          {modelMenuOpen && (
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
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {klingModelOptions.map((opt) => {
                  const isActive = klingModel === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type='button'
                      onClick={() => {
                        handleKlingModelChange(opt.value);
                        setModelMenuOpen(false);
                      }}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${isActive ? "#2563eb" : "#e5e7eb"}`,
                        background: isActive ? "#eff6ff" : "#fff",
                        color: isActive ? "#1d4ed8" : "#111827",
                        fontSize: 12,
                        textAlign: "left",
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
      )}

      {shouldShowAspectSelector && (
        <div
          className='video-dropdown'
          style={{ marginBottom: 8, position: "relative" }}
        >
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("尺寸", "Size")}
          </div>
          <button
            type='button'
            onClick={(event) => {
              event.stopPropagation();
              setModelMenuOpen(false);
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
      )}

      <div
        className='video-dropdown'
        style={{ marginBottom: 8, position: "relative" }}
      >
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          {lt("时间长度", "Duration")}
        </div>
        <button
          type='button'
          onClick={(event) => {
            event.stopPropagation();
            setModelMenuOpen(false);
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
                    title={isLocked ? lt("仅管理员可用", "Admin only") : undefined}
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
      {isUnifiedKlingNode && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("模式", "Mode")}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: lt("标准", "Standard"), value: "std" },
              { label: lt("专业", "Pro"), value: "pro" },
            ].map((opt) => {
              const isActive = (((data as any).mode || "std") === opt.value);
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

      {isKling26Model && (
        <div style={{ marginBottom: 8 }}>
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              <span>{lt("音频文件（最多 2 个）", "Audio files (max 2)")}</span>
              <span>{audioUrls.length}/2</span>
            </div>
            <input
              ref={audioInputRef}
              type='file'
              accept={SUPPORTED_AUDIO_ACCEPT}
              multiple
              onChange={handleAudioInputChange}
              style={{ display: "none" }}
            />
            <button
              type='button'
              onClick={() => audioInputRef.current?.click()}
              disabled={audioUploading || audioUrls.length >= 2}
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                background: "#fff",
                color: "#111827",
                fontSize: 12,
                cursor:
                  audioUploading || audioUrls.length >= 2 ? "not-allowed" : "pointer",
                opacity: audioUploading || audioUrls.length >= 2 ? 0.6 : 1,
              }}
            >
              {audioUploading
                ? lt("上传中...", "Uploading...")
                : audioUrls.length > 0
                ? lt("继续上传", "Upload more")
                : lt("上传音频", "Upload audio")}
            </button>
            {audioUrls.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {audioUrls.map((url, index) => (
                  <div
                    key={`${url}-${index}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      background: "#f8fafc",
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: "#334155" }}>
                      {lt("音频", "Audio")} {index + 1}
                    </span>
                    <button
                      type='button'
                      onClick={() => handleRemoveAudioAt(index)}
                      style={{
                        padding: "2px 6px",
                        borderRadius: 6,
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {lt("移除", "Remove")}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {audioMessage && (
              <div
                style={{
                  marginTop: 6,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 11,
                }}
              >
                {audioMessage}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Vidu 专用参数 */}
      {(provider === "vidu" || provider === "viduq3-pro") && (
        <>
          <div
            className='video-dropdown'
            style={{ marginBottom: 8, position: "relative" }}
          >
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              {lt("分辨率", "Resolution")}
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
              {lt("风格", "Style")}: {(data as any).style === "anime" ? lt("动漫", "Anime") : lt("通用", "General")}
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
              {lt("错峰", "Off-peak")}: {(data as any).offPeak ? lt("开启", "On") : lt("关闭", "Off")}
            </button>
          </div>
        </>
      )}

      {/* Seedance 1.5 Pro专用参数 */}
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
            {lt("镜头", "Camera")}: {(data as any).camerafixed ? lt("固定", "Fixed") : lt("运动", "Dynamic")}
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
            {lt("水印", "Watermark")}: {(data as any).watermark ? lt("开启", "On") : lt("关闭", "Off")}
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
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
            onClick={() => setShowHistory(!showHistory)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{lt("历史记录", "History")}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{historyItems.length} {lt("条", "items")}</span>
              <span style={{ fontSize: 14, color: "#64748b" }}>{showHistory ? "▴" : "▾"}</span>
            </div>
          </div>
          {showHistory && historyItems.map((item, index) => {
            const isActive = item.videoUrl === data.videoUrl;
            // 使用组合 key 确保唯一性：id + index
            const uniqueKey = `${item.id}-${index}`;

            // 从 URL 中提取视频 ID 作为唯一标识
            const videoId = item.videoUrl?.split('/').pop()?.split('?')[0]?.slice(-12) || '';

            return (
              <div
                key={uniqueKey}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {videoId && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "#94a3b8",
                          fontFamily: "monospace",
                        }}
                        title={`${lt("视频ID", "Video ID")}: ${videoId}`}
                      >
                        {videoId}
                      </span>
                    )}
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
                </div>
                {typeof item.elapsedSeconds === "number" && (
                  <div style={{ fontSize: 11, color: "#475569" }}>
                    {lt("耗时", "Elapsed")} {item.elapsedSeconds}s
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
                      {lt("设为当前", "Set current")}
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
