import React from "react";
import { Handle, Position, useStore } from "reactflow";
import { AlertTriangle, Video, Share2, Download, HelpCircle } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { useAuthStore } from "@/stores/authStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { useAIChatStore } from "@/stores/aiChatStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";
import RunCreditBadge from "./RunCreditBadge";
import { imageUploadService } from "@/services/imageUploadService";
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
    onSend?: (id: string) => void;
    creditsPerCall?: number;
    clipDuration?: number;
    aspectRatio?: string;
    mode?: "std" | "pro";
    history?: VideoHistoryItem[];
    fallbackMessage?: string;
    // 视频编辑参数
    hasVideoInput?: boolean;
    referenceVideoType?: "feature" | "base";
    keepOriginalSound?: "yes" | "no";
    vendorKey?: string;
    platformKey?: string;
    klingStoryboardMode?: "single" | "intelligence" | "customize";
    klingStoryboardScript?: string;
    klingStoryboardShots?: Array<{ index?: number; prompt?: string; duration?: number | string }>;
    uploadedStoryboardImages?: Array<
      | string
      | {
          url?: string;
          name?: string;
          size?: number;
          mimeType?: string;
        }
    >;
    uploadedStoryboardVideo?:
      | string
      | {
          url?: string;
          name?: string;
          size?: number;
          mimeType?: string;
          duration?: number;
        };
    imageType?: "frame" | "reference"; // 图片类型：首尾帧 or 图片/主体参考
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

type StoryboardShotForm = {
  prompt: string;
  duration: number;
};

type StoryboardUploadedMedia = {
  url: string;
  name?: string;
  size?: number;
  mimeType?: string;
  duration?: number;
};

const MAX_STORYBOARD_SHOTS = 6;
const TENCENT_STORYBOARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const TENCENT_STORYBOARD_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const TENCENT_STORYBOARD_ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
]);
const TENCENT_STORYBOARD_ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
]);

const clampStoryboardDuration = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(60, Math.round(value)));
};

const normalizeStoryboardShots = (raw: unknown): StoryboardShotForm[] => {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).multi_prompt)
    ? (raw as any).multi_prompt
    : [];

  return source
    .map((item: any) => {
      if (!item || typeof item !== "object") return null;
      return {
        prompt: String((item as any).prompt || ""),
        duration: clampStoryboardDuration(Number((item as any).duration)),
      };
    })
    .filter((item: StoryboardShotForm | null): item is StoryboardShotForm => Boolean(item))
    .slice(0, MAX_STORYBOARD_SHOTS);
};

const serializeStoryboardShots = (shots: StoryboardShotForm[]): string => {
  const payload = shots.slice(0, MAX_STORYBOARD_SHOTS).map((shot, index) => ({
    index: index + 1,
    prompt: String(shot.prompt || "").trim(),
    duration: clampStoryboardDuration(Number(shot.duration)),
  }));
  return JSON.stringify(payload);
};

const resolveKlingSoundEnabled = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "on" || normalized === "true" || normalized === "yes") return true;
    if (normalized === "off" || normalized === "false" || normalized === "no") return false;
  }
  return true;
};

function KlingO1VideoNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useAIChatStore((state) => state.chatTheme === "black");
  const projectId = useProjectContentStore((state) => state.projectId);
  const klingSoundEnabled = React.useMemo(
    () => resolveKlingSoundEnabled((data as any).sound),
    [(data as any).sound]
  );
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";
  const previewRequestParams = React.useMemo(
    () => ({
      aiProvider: "kling-o3",
      managedModelKey: (data as any).managedModelKey,
      modelKey: (data as any).managedModelKey,
      vendorKey: data.vendorKey,
      platformKey: data.platformKey,
      providerChannel: data.platformKey || data.vendorKey,
      routedProvider: "kling-o3",
      klingModel: "kling-o3",
      mode: data.mode || "std",
      sound: klingSoundEnabled ? "on" : "off",
      duration:
        typeof data.clipDuration === "number" && Number.isFinite(data.clipDuration)
          ? Math.round(data.clipDuration)
          : 5,
      durationSec:
        typeof data.clipDuration === "number" && Number.isFinite(data.clipDuration)
          ? Math.round(data.clipDuration)
          : 5,
      aspectRatio: data.aspectRatio,
      inputType:
        data.hasVideoInput === true ? "video" : "text",
      hasVideoInput: data.hasVideoInput === true,
      referenceVideoCount: data.hasVideoInput === true ? 1 : 0,
      referenceImageCount: 0,
      audioInputCount: 0,
      referenceVideoType: data.referenceVideoType,
      resolution: "1080P",
    }),
    [
      data.aspectRatio,
      data.clipDuration,
      data.hasVideoInput,
      data.mode,
      data.platformKey,
      data.referenceVideoType,
      data.vendorKey,
      (data as any).managedModelKey,
      klingSoundEnabled,
    ]
  );
  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: "kling-o3-video",
    model: "kling-o3",
    requestParams: previewRequestParams,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;
  const hasRunCredits =
    typeof resolvedRunCredits === "number" && resolvedRunCredits > 0;
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const [aspectMenuOpen, setAspectMenuOpen] = React.useState(false);
  const [durationMenuOpen, setDurationMenuOpen] = React.useState(false);
  const [videoRefTypeMenuOpen, setVideoRefTypeMenuOpen] = React.useState(false);
  const [showStoryboardPanel, setShowStoryboardPanel] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [storyboardUploading, setStoryboardUploading] = React.useState<
    "image" | "video" | null
  >(null);
  const [storyboardUploadError, setStoryboardUploadError] = React.useState<
    string | null
  >(null);
  const storyboardImageInputRef = React.useRef<HTMLInputElement | null>(null);
  const storyboardVideoInputRef = React.useRef<HTMLInputElement | null>(null);
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
      if (
        !target.closest?.(".kling-storyboard-panel") &&
        !target.closest?.(".kling-storyboard-trigger")
      ) {
        setShowStoryboardPanel(false);
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
  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter(
      (edge) => edge.target === id && edge.targetHandle === "image"
    ).length;
  });
  const elementImgInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter(
      (edge) => edge.target === id && edge.targetHandle === "elementImg"
    ).length;
  });
  const hasEdgeVideoInput = useStore((state) => {
    const edges = state.edges || [];
    return edges.some(
      (edge) => edge.target === id && edge.targetHandle === "video"
    );
  });
  const referenceVideoType = data.referenceVideoType || "feature";
  const keepOriginalSound = data.keepOriginalSound || "no";
  const normalizedVendorKey = String(data.vendorKey || "")
    .trim()
    .toLowerCase();
  const normalizedPlatformKey = String(data.platformKey || "")
    .trim()
    .toLowerCase();
  const isTencentRoute =
    normalizedVendorKey === "tencent_vod" ||
    normalizedPlatformKey === "tencent_vod" ||
    (!normalizedVendorKey && !normalizedPlatformKey);
  const normalizeUploadedMedia = React.useCallback(
    (raw: unknown): StoryboardUploadedMedia | null => {
      if (typeof raw === "string") {
        const url = sanitizeMediaUrl(raw);
        return url ? { url } : null;
      }
      if (!raw || typeof raw !== "object") return null;
      const source = raw as Record<string, unknown>;
      const candidateUrl =
        sanitizeMediaUrl(
          typeof source.url === "string"
            ? source.url
            : typeof source.mediaUrl === "string"
            ? source.mediaUrl
            : undefined
        ) || "";
      if (!candidateUrl) return null;
      return {
        url: candidateUrl,
        name: typeof source.name === "string" ? source.name : undefined,
        size:
          typeof source.size === "number" && Number.isFinite(source.size)
            ? source.size
            : undefined,
        mimeType:
          typeof source.mimeType === "string" ? source.mimeType : undefined,
        duration:
          typeof source.duration === "number" && Number.isFinite(source.duration)
            ? source.duration
            : undefined,
      };
    },
    [sanitizeMediaUrl]
  );
  const uploadedStoryboardImages = React.useMemo(() => {
    if (!Array.isArray(data.uploadedStoryboardImages)) return [];
    const normalized = data.uploadedStoryboardImages
      .map((item) => normalizeUploadedMedia(item))
      .filter((item): item is StoryboardUploadedMedia => Boolean(item));
    const deduped = new Set<string>();
    return normalized.filter((item) => {
      if (deduped.has(item.url)) return false;
      deduped.add(item.url);
      return true;
    });
  }, [data.uploadedStoryboardImages, normalizeUploadedMedia]);
  const uploadedStoryboardVideo = React.useMemo(
    () => normalizeUploadedMedia(data.uploadedStoryboardVideo),
    [data.uploadedStoryboardVideo, normalizeUploadedMedia]
  );
  const hasVideoInput =
    hasEdgeVideoInput || (isTencentRoute && Boolean(uploadedStoryboardVideo?.url));
  const storyboardImageLimit = hasVideoInput ? 4 : 7;
  const klingStoryboardMode =
    data.klingStoryboardMode === "intelligence" || data.klingStoryboardMode === "customize"
      ? data.klingStoryboardMode
      : "single";
  const totalImageCount = imageInputCount + elementImgInputCount;
  const totalImageCountWithUploads = totalImageCount + uploadedStoryboardImages.length;

  React.useEffect(() => {
    if (!isTencentRoute || klingStoryboardMode !== "customize") {
      setShowStoryboardPanel(false);
    }
  }, [isTencentRoute, klingStoryboardMode]);

  // 自动判断图片类型（无需用户选择）
  const imageType = React.useMemo(() => {
    // 有elementImg连接 → 图片/主体参考
    if (elementImgInputCount > 0) return "reference";
    // image连接3张以上 → 图片/主体参考
    if (imageInputCount >= 3) return "reference";
    // image连接1-2张 → 首尾帧
    if (imageInputCount >= 1 && imageInputCount <= 2) return "frame";
    // 默认首尾帧
    return "frame";
  }, [elementImgInputCount, imageInputCount]);

  // 4种模态场景检测
  const isTextToVideo = !hasVideoInput && totalImageCountWithUploads === 0;
  const isImageToVideo =
    !hasVideoInput &&
    imageType === "frame" &&
    totalImageCountWithUploads >= 1 &&
    totalImageCountWithUploads <= 2;
  const isImageReference =
    !hasVideoInput &&
    (imageType === "reference" || totalImageCountWithUploads >= 3) &&
    totalImageCountWithUploads >= 1 &&
    totalImageCountWithUploads <= 7;
  const isVideoReference = hasVideoInput && referenceVideoType === "feature";
  const isVideoEdit = hasVideoInput && referenceVideoType === "base";

  // 参数显示控制
  const shouldShowAspectSelector = totalImageCountWithUploads === 0 && !hasVideoInput;
  const shouldShowDurationSelector = !isVideoEdit;

  // Kling O3 支持 3-10 秒
  const aspectOptions = [
    { label: lt("自动", "Auto"), value: "" },
    { label: lt("横屏（16:9）", "Landscape (16:9)"), value: "16:9" },
    { label: lt("竖屏（9:16）", "Portrait (9:16)"), value: "9:16" },
    { label: lt("方形（1:1）", "Square (1:1)"), value: "1:1" },
  ];

  // 根据场景动态生成时长选项
  const durationOptions = React.useMemo(() => {
    if (isTencentRoute) {
      const maxDuration = hasVideoInput ? 10 : 15;
      return Array.from({ length: maxDuration - 2 }, (_, index) => {
        const value = index + 3;
        return { label: lt(`${value}秒`, `${value}s`), value };
      });
    }
    // 文生视频、首帧图生视频：仅支持 5/10
    if (isTextToVideo || (isImageToVideo && imageInputCount === 1)) {
      return [
        { label: lt("5秒", "5s"), value: 5 },
        { label: lt("10秒", "10s"), value: 10 },
      ];
    }
    // 图片/主体参考或视频参考：支持 3~10
    return [
      { label: lt("3秒", "3s"), value: 3 },
      { label: lt("4秒", "4s"), value: 4 },
      { label: lt("5秒", "5s"), value: 5 },
      { label: lt("6秒", "6s"), value: 6 },
      { label: lt("7秒", "7s"), value: 7 },
      { label: lt("8秒", "8s"), value: 8 },
      { label: lt("9秒", "9s"), value: 9 },
      { label: lt("10秒", "10s"), value: 10 },
    ];
  }, [hasVideoInput, imageInputCount, isImageToVideo, isTencentRoute, isTextToVideo, lt]);

  const targetStoryboardDuration = React.useMemo(() => {
    if (typeof clipDuration === "number" && Number.isFinite(clipDuration)) {
      return Math.max(1, Math.round(clipDuration));
    }
    return 5;
  }, [clipDuration]);

  const parsedStoryboardShots = React.useMemo(() => {
    const fromNodeData = normalizeStoryboardShots(data.klingStoryboardShots);
    if (fromNodeData.length > 0) return fromNodeData;

    const rawScript =
      typeof data.klingStoryboardScript === "string" ? data.klingStoryboardScript.trim() : "";
    if (!rawScript) return [];
    try {
      return normalizeStoryboardShots(JSON.parse(rawScript));
    } catch {
      return [];
    }
  }, [data.klingStoryboardScript, data.klingStoryboardShots]);

  const storyboardShots = React.useMemo(() => {
    if (parsedStoryboardShots.length > 0) {
      return parsedStoryboardShots;
    }
    return [{ prompt: "", duration: targetStoryboardDuration }];
  }, [parsedStoryboardShots, targetStoryboardDuration]);

  const storyboardDurationTotal = React.useMemo(
    () => storyboardShots.reduce((sum, shot) => sum + clampStoryboardDuration(shot.duration), 0),
    [storyboardShots]
  );
  const isStoryboardDurationMatched = storyboardDurationTotal === targetStoryboardDuration;
  const storyboardPanelTheme = React.useMemo(
    () =>
      isFlowDark
        ? {
            modeLabel: "#9ca3af",
            modeBtnBorder: "#3f3f46",
            modeBtnBg: "#18181b",
            modeBtnText: "#e5e7eb",
            modeBtnActiveBg: "#0f766e",
            modeBtnActiveText: "#f0fdfa",
            summaryBorder: "#3f3f46",
            summaryBg: "#161616",
            summaryTriggerBorder: "#52525b",
            summaryTriggerBg: "#1f2937",
            summaryTriggerText: "#e5e7eb",
            panelBorder: "#3f3f46",
            panelBg: "#111111",
            panelTitle: "#f3f4f6",
            panelClose: "#9ca3af",
            panelMutedText: "#9ca3af",
            uploadWellBorder: "#475569",
            uploadWellBg: "#161616",
            uploadWellTitle: "#e5e7eb",
            uploadBtnBorder: "#52525b",
            uploadBtnBg: "#1f2937",
            uploadBtnText: "#e5e7eb",
            uploadBtnDisabledText: "#6b7280",
            uploadMetaText: "#94a3b8",
            uploadRowText: "#cbd5e1",
            uploadRowBg: "#1f2937",
            uploadRowBorder: "#374151",
            tokenText: "#2dd4bf",
            shotCardBorder: "#3f3f46",
            shotCardBg: "#18181b",
            shotCardTitle: "#f3f4f6",
            inputBorder: "#52525b",
            inputBg: "#111827",
            inputText: "#e5e7eb",
            durationLabel: "#d1d5db",
            durationUnit: "#9ca3af",
            addBtnBorder: "#52525b",
            addBtnBg: "#1f2937",
            addBtnText: "#e5e7eb",
            addBtnDisabledText: "#6b7280",
            matchedText: "#34d399",
            warningText: "#f59e0b",
            dangerText: "#f87171",
          }
        : {
            modeLabel: "#6b7280",
            modeBtnBorder: "#e5e7eb",
            modeBtnBg: "#fff",
            modeBtnText: "#111827",
            modeBtnActiveBg: "#0f766e",
            modeBtnActiveText: "#fff",
            summaryBorder: "#d1d5db",
            summaryBg: "#f9fafb",
            summaryTriggerBorder: "#d1d5db",
            summaryTriggerBg: "#fff",
            summaryTriggerText: "#111827",
            panelBorder: "#d1d5db",
            panelBg: "#ffffff",
            panelTitle: "#111827",
            panelClose: "#6b7280",
            panelMutedText: "#6b7280",
            uploadWellBorder: "#cbd5e1",
            uploadWellBg: "#f8fafc",
            uploadWellTitle: "#0f172a",
            uploadBtnBorder: "#d1d5db",
            uploadBtnBg: "#fff",
            uploadBtnText: "#111827",
            uploadBtnDisabledText: "#9ca3af",
            uploadMetaText: "#475569",
            uploadRowText: "#334155",
            uploadRowBg: "#fff",
            uploadRowBorder: "#e2e8f0",
            tokenText: "#0f766e",
            shotCardBorder: "#e5e7eb",
            shotCardBg: "#fff",
            shotCardTitle: "#111827",
            inputBorder: "#d1d5db",
            inputBg: "#fff",
            inputText: "#111827",
            durationLabel: "#374151",
            durationUnit: "#6b7280",
            addBtnBorder: "#d1d5db",
            addBtnBg: "#fff",
            addBtnText: "#111827",
            addBtnDisabledText: "#9ca3af",
            matchedText: "#047857",
            warningText: "#b45309",
            dangerText: "#dc2626",
          },
    [isFlowDark]
  );

  const videoRefTypeOptions = [
    { label: lt("视频参考", "Video reference"), value: "feature", desc: lt("保留风格/节奏/镜头感", "Keep style/rhythm/camera feel") },
    { label: lt("视频编辑", "Video edit"), value: "base", desc: lt("以输入视频为编辑基底", "Use input video as edit base") },
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
    (value: "feature" | "base") => {
      if (value === referenceVideoType) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { referenceVideoType: value } },
        })
      );
    },
    [referenceVideoType, id]
  );

  const handleKeepOriginalSoundChange = React.useCallback(
    (value: "yes" | "no") => {
      if (value === keepOriginalSound) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { keepOriginalSound: value } },
        })
      );
    },
    [keepOriginalSound, id]
  );

  const storyboardModeOptions = [
    { label: lt("单镜头", "Single shot"), value: "single" as const },
    { label: lt("智能分镜", "Intelligent"), value: "intelligence" as const },
    { label: lt("自定义分镜", "Custom"), value: "customize" as const },
  ];

  const patchNodeData = React.useCallback(
    (patch: Record<string, unknown>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  const handleKlingSoundToggle = React.useCallback(() => {
    patchNodeData({ sound: !klingSoundEnabled });
  }, [klingSoundEnabled, patchNodeData]);

  React.useEffect(() => {
    if ((data as any).sound !== undefined && (data as any).sound !== null) return;
    patchNodeData({ sound: true });
  }, [(data as any).sound, patchNodeData]);

  const readLocalVideoDuration = React.useCallback(
    (file: File): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const video = document.createElement("video");
        let settled = false;

        const finalize = (cb: () => void) => {
          if (settled) return;
          settled = true;
          try {
            video.removeAttribute("src");
            video.load();
          } catch {
            // ignore
          }
          URL.revokeObjectURL(objectUrl);
          cb();
        };

        video.preload = "metadata";
        video.onloadedmetadata = () => {
          finalize(() => {
            const duration = Number(video.duration || 0);
            if (Number.isFinite(duration) && duration > 0) {
              resolve(duration);
            } else {
              reject(new Error("invalid_video_duration"));
            }
          });
        };
        video.onerror = () => {
          finalize(() => reject(new Error("load_video_duration_failed")));
        };
        video.src = objectUrl;
      }),
    []
  );

  const handleStoryboardImageUpload = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      if (!files.length || storyboardUploading) return;

      setStoryboardUploadError(null);
      const maxUploadable = Math.max(0, storyboardImageLimit - uploadedStoryboardImages.length);
      if (maxUploadable <= 0) {
        setStoryboardUploadError(
          lt(
            `参考图最多 ${storyboardImageLimit} 张，请先删除后再上传`,
            `You can upload up to ${storyboardImageLimit} reference images`
          )
        );
        return;
      }

      const uploadQueue = files.slice(0, maxUploadable);
      const nextImages = [...uploadedStoryboardImages];
      setStoryboardUploading("image");
      try {
        for (const file of uploadQueue) {
          const mime = String(file.type || "").toLowerCase();
          const mimeAllowed = TENCENT_STORYBOARD_ALLOWED_IMAGE_MIME.has(mime);
          const extAllowed = /\.(png|jpe?g)$/i.test(file.name || "");
          if (!mimeAllowed && !extAllowed) {
            setStoryboardUploadError(
              lt(
                "仅支持 jpg/jpeg/png 图片格式",
                "Only jpg/jpeg/png images are supported"
              )
            );
            continue;
          }
          if (file.size > TENCENT_STORYBOARD_IMAGE_MAX_BYTES) {
            setStoryboardUploadError(
              lt(
                `图片 ${file.name} 超过 10MB，请压缩后再上传`,
                `Image ${file.name} exceeds 10MB, please compress and retry`
              )
            );
            continue;
          }

          const uploadResult = await imageUploadService.uploadImageFile(file, {
            dir: projectId ? `projects/${projectId}/flow/kling-storyboard/images/` : "flow/kling-storyboard/images/",
            projectId: null,
            fileName: file.name,
            contentType: file.type || "image/png",
            maxFileSize: TENCENT_STORYBOARD_IMAGE_MAX_BYTES,
            maxSize: TENCENT_STORYBOARD_IMAGE_MAX_BYTES,
          });

          if (!uploadResult.success || !uploadResult.asset?.url) {
            setStoryboardUploadError(
              uploadResult.error || lt("图片上传失败，请重试", "Image upload failed")
            );
            continue;
          }

          nextImages.push({
            url: uploadResult.asset.url,
            name: uploadResult.asset.fileName || file.name,
            size: file.size,
            mimeType: file.type || undefined,
          });
        }

        patchNodeData({ uploadedStoryboardImages: nextImages });
      } finally {
        setStoryboardUploading(null);
      }
    },
    [
      lt,
      patchNodeData,
      projectId,
      storyboardImageLimit,
      storyboardUploading,
      uploadedStoryboardImages,
    ]
  );

  const handleStoryboardVideoUpload = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || storyboardUploading) return;

      setStoryboardUploadError(null);
      const mime = String(file.type || "").toLowerCase();
      const mimeAllowed = TENCENT_STORYBOARD_ALLOWED_VIDEO_MIME.has(mime);
      const extAllowed = /\.(mp4|mov|avi)$/i.test(file.name || "");
      if (!mimeAllowed && !extAllowed) {
        setStoryboardUploadError(
          lt("仅支持 mp4/mov/avi 视频格式", "Only mp4/mov/avi videos are supported")
        );
        return;
      }
      if (file.size > TENCENT_STORYBOARD_VIDEO_MAX_BYTES) {
        setStoryboardUploadError(
          lt(
            "视频超过 100MB，请压缩后再上传",
            "Video exceeds 100MB, please compress and retry"
          )
        );
        return;
      }

      setStoryboardUploading("video");
      try {
        const duration = await readLocalVideoDuration(file);
        if (duration < 3 || duration > 10) {
          setStoryboardUploadError(
            lt(
              `参考视频时长需在 3-10 秒内，当前约 ${duration.toFixed(1)} 秒`,
              `Reference video must be 3-10s, current ${duration.toFixed(1)}s`
            )
          );
          return;
        }

        const { ossUploadService } = await import("@/services/ossUploadService");
        const uploadResult = await ossUploadService.uploadToOSS(file, {
          dir: projectId ? `projects/${projectId}/flow/kling-storyboard/videos/` : "flow/kling-storyboard/videos/",
          projectId: null,
          fileName: file.name || `kling-storyboard-${Date.now()}.mp4`,
          contentType: file.type || "video/mp4",
          maxSize: TENCENT_STORYBOARD_VIDEO_MAX_BYTES,
        });
        if (!uploadResult.success || !uploadResult.url) {
          setStoryboardUploadError(
            uploadResult.error || lt("视频上传失败，请重试", "Video upload failed")
          );
          return;
        }

        patchNodeData({
          uploadedStoryboardVideo: {
            url: uploadResult.url,
            name: file.name,
            size: file.size,
            mimeType: file.type || undefined,
            duration: Number(duration.toFixed(2)),
          },
        });
      } catch {
        setStoryboardUploadError(
          lt("无法读取视频时长，请更换文件重试", "Unable to read video duration")
        );
      } finally {
        setStoryboardUploading(null);
      }
    },
    [lt, patchNodeData, projectId, readLocalVideoDuration, storyboardUploading]
  );

  const handleRemoveUploadedStoryboardImage = React.useCallback(
    (index: number) => {
      if (index < 0 || index >= uploadedStoryboardImages.length) return;
      const nextImages = uploadedStoryboardImages.filter((_, itemIndex) => itemIndex !== index);
      patchNodeData({ uploadedStoryboardImages: nextImages });
    },
    [patchNodeData, uploadedStoryboardImages]
  );

  const handleClearUploadedStoryboardVideo = React.useCallback(() => {
    patchNodeData({ uploadedStoryboardVideo: undefined });
  }, [patchNodeData]);

  const applyStoryboardShots = React.useCallback(
    (shots: StoryboardShotForm[]) => {
      const normalized = shots.slice(0, MAX_STORYBOARD_SHOTS).map((shot, index) => ({
        index: index + 1,
        prompt: String(shot.prompt || ""),
        duration: clampStoryboardDuration(Number(shot.duration)),
      }));
      patchNodeData({
        klingStoryboardShots: normalized,
        klingStoryboardScript: serializeStoryboardShots(normalized),
      });
    },
    [patchNodeData]
  );

  const handleStoryboardModeChange = React.useCallback(
    (value: "single" | "intelligence" | "customize") => {
      if (value === klingStoryboardMode) return;
      const patch: Record<string, unknown> = { klingStoryboardMode: value };
      if (value === "customize") {
        const initialShots =
          storyboardShots.length > 0
            ? storyboardShots
            : [{ prompt: "", duration: targetStoryboardDuration }];
        const normalized = initialShots.slice(0, MAX_STORYBOARD_SHOTS).map((shot, index) => ({
          index: index + 1,
          prompt: String(shot.prompt || ""),
          duration: clampStoryboardDuration(Number(shot.duration)),
        }));
        patch.klingStoryboardShots = normalized;
        patch.klingStoryboardScript = serializeStoryboardShots(normalized);
      }
      patchNodeData(patch);
      setShowStoryboardPanel(value === "customize");
    },
    [klingStoryboardMode, patchNodeData, storyboardShots, targetStoryboardDuration]
  );

  const handleAddStoryboardShot = React.useCallback(() => {
    if (storyboardShots.length >= MAX_STORYBOARD_SHOTS) return;
    const remaining = targetStoryboardDuration - storyboardDurationTotal;
    const nextDuration = clampStoryboardDuration(remaining > 0 ? remaining : 1);
    applyStoryboardShots([...storyboardShots, { prompt: "", duration: nextDuration }]);
  }, [applyStoryboardShots, storyboardDurationTotal, storyboardShots, targetStoryboardDuration]);

  const handleRemoveStoryboardShot = React.useCallback(
    (index: number) => {
      if (storyboardShots.length <= 1) return;
      applyStoryboardShots(storyboardShots.filter((_, itemIndex) => itemIndex !== index));
    },
    [applyStoryboardShots, storyboardShots]
  );

  const handleStoryboardPromptChange = React.useCallback(
    (index: number, prompt: string) => {
      applyStoryboardShots(
        storyboardShots.map((shot, itemIndex) =>
          itemIndex === index ? { ...shot, prompt } : shot
        )
      );
    },
    [applyStoryboardShots, storyboardShots]
  );

  const handleStoryboardDurationChange = React.useCallback(
    (index: number, durationRaw: string) => {
      const parsed = Number(durationRaw);
      const nextDuration = clampStoryboardDuration(parsed);
      applyStoryboardShots(
        storyboardShots.map((shot, itemIndex) =>
          itemIndex === index ? { ...shot, duration: nextDuration } : shot
        )
      );
    },
    [applyStoryboardShots, storyboardShots]
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
          link.download = `kling-o3-${new Date().toISOString().split("T")[0]}.mp4`;
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
        style={{ top: "20%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      {!hasVideoInput && (
        <Handle
          type="target"
          position={Position.Left}
          id="elementImg"
          style={{ top: "40%" }}
          onMouseEnter={() => setHover("elementImg-in")}
          onMouseLeave={() => setHover(null)}
        />
      )}
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "60%" }}
        onMouseEnter={() => setHover("image-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: "80%" }}
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
        <div className="flow-tooltip" style={{ left: -8, top: "20%", transform: "translate(-100%, -50%)" }}>
          prompt
        </div>
      )}
      {hover === "elementImg-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "40%", transform: "translate(-100%, -50%)" }}>
          {lt("elementImg (图片/主体参考)", "elementImg (image/element reference)")}
        </div>
      )}
      {hover === "image-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "60%", transform: "translate(-100%, -50%)" }}>
          {lt("image (首尾帧/图片参考)", "image (frame/reference)")}
        </div>
      )}
      {hover === "video-in" && (
        <div className="flow-tooltip" style={{ left: -8, top: "80%", transform: "translate(-100%, -50%)" }}>
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
          <span>
            Kling O3
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className={`tanva-video-header-btn tanva-video-header-help ${showHelp ? "is-active" : "is-inactive"}`}
            onClick={() => setShowHelp(!showHelp)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              background: showHelp ? "#3b82f6" : "#f3f4f6",
              color: showHelp ? "#fff" : "#6b7280",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
            title={lt("玩法说明", "Help")}
          >
            <HelpCircle size={14} />
          </button>
          <button
            className="tanva-video-header-btn tanva-video-header-run run-btn-with-credit"
            onClick={onRun}
            onMouseDown={handleButtonMouseDown}
            disabled={data.status === "running"}
            style={{
              width: hasRunCredits ? "auto" : 36,
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
              gap: 0,
            }}
            >
            {data.status === "running" ? (
              <span className="run-text-trigger">Running...</span>
            ) : (
              <>
                <span className="run-text-trigger">Run</span>
                {hasRunCredits ? (
                  <RunCreditBadge credits={resolvedRunCredits} runButton />
                ) : null}
              </>
            )}
          </button>
          <button
            className="tanva-video-header-btn tanva-video-header-share"
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
            className="tanva-video-header-btn tanva-video-header-download"
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

      {/* 玩法说明 */}
      {showHelp && (
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
            🎬 {lt("可实现效果", "What You Can Do")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("纯文生视频", "Text to Video")}:</strong> {lt("只用文字描述生成视频", "Generate video from text only")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("一张图变动态", "Image to Video")}:</strong> {lt("让静态图片动起来", "Animate static image")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("首尾帧过渡", "Start-End Transition")}:</strong> {lt("两张图控制起止状态", "Control start and end with 2 images")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("多图参考", "Multi-Image Reference")}:</strong> {lt("3-7张图统一风格", "Unify style with 3-7 images")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("视频参考", "Video Reference")}:</strong> {lt("保留原视频风格/节奏", "Keep original style/rhythm")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("视频编辑", "Video Edit")}:</strong> {lt("改造现有视频内容", "Modify existing video")}
          </div>
          <div style={{ color: "#6b7280", fontSize: 10, marginTop: 4 }}>
            💡 {lt("提示：用<<<image_1>>>引用图片，<<<video_1>>>引用视频", "Tip: Use <<<image_1>>> for images, <<<video_1>>> for video")}
          </div>
        </div>
      )}

      {/* 场景限制警告 */}
      {!hasVideoInput && imageType === "frame" && totalImageCountWithUploads > 2 && (
        <div style={{
          fontSize: 11,
          color: "#b91c1c",
          background: "#fef2f2",
          padding: "6px 8px",
          borderRadius: 6,
          marginBottom: 8,
          border: "1px solid #fecaca",
        }}>
          ⚠️ {lt(
            `首尾帧模式最多2张图片，当前共 ${totalImageCountWithUploads} 张`,
            `Frame mode max 2 images, current ${totalImageCountWithUploads}`
          )}
        </div>
      )}

      {!hasVideoInput && imageType === "reference" && totalImageCountWithUploads < 1 && (
        <div style={{
          fontSize: 11,
          color: "#b91c1c",
          background: "#fef2f2",
          padding: "6px 8px",
          borderRadius: 6,
          marginBottom: 8,
          border: "1px solid #fecaca",
        }}>
          ⚠️ {lt("图片/主体参考需要至少1张图片", "Image/element reference needs at least 1 image")}
        </div>
      )}

      {!hasVideoInput && imageType === "reference" && totalImageCountWithUploads > 7 && (
        <div style={{
          fontSize: 11,
          color: "#b91c1c",
          background: "#fef2f2",
          padding: "6px 8px",
          borderRadius: 6,
          marginBottom: 8,
          border: "1px solid #fecaca",
        }}>
          ⚠️ {lt(
            `图片/主体参考最多7张，当前共 ${totalImageCountWithUploads} 张`,
            `Max 7 images for reference, current ${totalImageCountWithUploads}`
          )}
        </div>
      )}

      {hasVideoInput && totalImageCountWithUploads > 4 && (
        <div style={{
          fontSize: 11,
          color: "#b91c1c",
          background: "#fef2f2",
          padding: "6px 8px",
          borderRadius: 6,
          marginBottom: 8,
          border: "1px solid #fecaca",
        }}>
          ⚠️ {lt(
            `视频模式下图片最多4张，当前共 ${totalImageCountWithUploads} 张`,
            `Max 4 images with video, current ${totalImageCountWithUploads}`
          )}
        </div>
      )}

      {isVideoEdit && totalImageCountWithUploads === 2 && (
        <div style={{
          fontSize: 11,
          color: "#b91c1c",
          background: "#fef2f2",
          padding: "6px 8px",
          borderRadius: 6,
          marginBottom: 8,
          border: "1px solid #fecaca",
        }}>
          ⚠️ {lt("视频编辑模式不支持首尾帧（2张图）", "Video edit mode doesn't support start-end frames")}
        </div>
      )}

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
      {shouldShowAspectSelector && (
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
      )}

      {/* 时长选择 */}
      {shouldShowDurationSelector && (
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
      )}

      <div style={{ marginBottom: 8 }}>
        <button
          type="button"
          onClick={handleKlingSoundToggle}
          style={{
            width: "100%",
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            background: klingSoundEnabled ? "#111827" : "#fff",
            color: klingSoundEnabled ? "#fff" : "#111827",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {lt("音频", "Audio")}:{" "}
          {klingSoundEnabled ? lt("开启", "On") : lt("关闭", "Off")}
        </button>
      </div>

      {isTencentRoute && (
        <div style={{ marginBottom: 8, position: "relative" }}>
          <div style={{ fontSize: 12, color: storyboardPanelTheme.modeLabel, marginBottom: 4 }}>
            {lt("分镜模式", "Storyboard")}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {storyboardModeOptions.map((opt) => {
              const isActive = klingStoryboardMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleStoryboardModeChange(opt.value)}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: `1px solid ${storyboardPanelTheme.modeBtnBorder}`,
                    background: isActive
                      ? storyboardPanelTheme.modeBtnActiveBg
                      : storyboardPanelTheme.modeBtnBg,
                    color: isActive
                      ? storyboardPanelTheme.modeBtnActiveText
                      : storyboardPanelTheme.modeBtnText,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {klingStoryboardMode === "customize" && (
            <div
              style={{
                marginTop: 6,
                padding: "6px 8px",
                borderRadius: 8,
                border: `1px solid ${storyboardPanelTheme.summaryBorder}`,
                background: storyboardPanelTheme.summaryBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <button
                type="button"
                className="kling-storyboard-trigger nodrag nowheel"
                onClick={() => setShowStoryboardPanel((open) => !open)}
                onMouseDown={(event) => event.stopPropagation()}
                style={{
                  border: `1px solid ${storyboardPanelTheme.summaryTriggerBorder}`,
                  background: storyboardPanelTheme.summaryTriggerBg,
                  borderRadius: 8,
                  padding: "4px 10px",
                  fontSize: 12,
                  color: storyboardPanelTheme.summaryTriggerText,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {showStoryboardPanel
                  ? lt("收起分镜面板", "Hide storyboard panel")
                  : lt("配置自定义分镜", "Configure storyboard")}
              </button>
              <span
                style={{
                  fontSize: 11,
                  color: isStoryboardDurationMatched
                    ? storyboardPanelTheme.matchedText
                    : storyboardPanelTheme.dangerText,
                  fontWeight: 600,
                }}
              >
                {lt(
                  `总时长 ${storyboardDurationTotal}s / 目标 ${targetStoryboardDuration}s`,
                  `Total ${storyboardDurationTotal}s / Target ${targetStoryboardDuration}s`
                )}
              </span>
            </div>
          )}

          {klingStoryboardMode === "customize" && showStoryboardPanel && (
            <div
              className="kling-storyboard-panel nodrag nowheel"
              onMouseDown={(event) => event.stopPropagation()}
              style={{
                position: "absolute",
                left: "calc(100% + 12px)",
                top: 0,
                width: 360,
                zIndex: 60,
                border: `1px solid ${storyboardPanelTheme.panelBorder}`,
                borderRadius: 10,
                padding: 10,
                background: storyboardPanelTheme.panelBg,
                boxShadow: isFlowDark
                  ? "0 12px 26px rgba(0,0,0,0.5)"
                  : "0 12px 26px rgba(15,23,42,0.18)",
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
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: storyboardPanelTheme.panelTitle,
                  }}
                >
                  {lt("自定义分镜", "Custom Storyboard")}
                </div>
                <button
                  type="button"
                  onClick={() => setShowStoryboardPanel(false)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: storyboardPanelTheme.panelClose,
                    fontSize: 16,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                  title={lt("关闭", "Close")}
                >
                  ×
                </button>
              </div>
              <div
                style={{
                  marginBottom: 8,
                  fontSize: 11,
                  color: storyboardPanelTheme.panelMutedText,
                  lineHeight: 1.45,
                }}
              >
                {lt(
                  "输入限制：图片仅支持 jpg/jpeg/png 且不超过 10MB。参考视频仅支持 mp4/mov/avi，时长 3-10 秒且不超过 100MB。",
                  "Limits: image jpg/jpeg/png <=10MB; video mp4/mov/avi, 3-10s, <=100MB."
                )}
              </div>
              <div
                style={{
                  marginBottom: 10,
                  padding: 8,
                  border: `1px dashed ${storyboardPanelTheme.uploadWellBorder}`,
                  borderRadius: 8,
                  background: storyboardPanelTheme.uploadWellBg,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: storyboardPanelTheme.uploadWellTitle,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {lt("参考素材上传（可选）", "Reference uploads (optional)")}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                  <button
                    type="button"
                    onClick={() => storyboardImageInputRef.current?.click()}
                    onMouseDown={(event) => event.stopPropagation()}
                    disabled={storyboardUploading !== null}
                    style={{
                      border: `1px solid ${storyboardPanelTheme.uploadBtnBorder}`,
                      background: storyboardPanelTheme.uploadBtnBg,
                      borderRadius: 8,
                      padding: "4px 8px",
                      fontSize: 12,
                      color:
                        storyboardUploading !== null
                          ? storyboardPanelTheme.uploadBtnDisabledText
                          : storyboardPanelTheme.uploadBtnText,
                      cursor: storyboardUploading !== null ? "not-allowed" : "pointer",
                    }}
                  >
                    {storyboardUploading === "image"
                      ? lt("图片上传中...", "Uploading images...")
                      : lt("上传参考图片", "Upload images")}
                  </button>
                  <button
                    type="button"
                    onClick={() => storyboardVideoInputRef.current?.click()}
                    onMouseDown={(event) => event.stopPropagation()}
                    disabled={storyboardUploading !== null}
                    style={{
                      border: `1px solid ${storyboardPanelTheme.uploadBtnBorder}`,
                      background: storyboardPanelTheme.uploadBtnBg,
                      borderRadius: 8,
                      padding: "4px 8px",
                      fontSize: 12,
                      color:
                        storyboardUploading !== null
                          ? storyboardPanelTheme.uploadBtnDisabledText
                          : storyboardPanelTheme.uploadBtnText,
                      cursor: storyboardUploading !== null ? "not-allowed" : "pointer",
                    }}
                  >
                    {storyboardUploading === "video"
                      ? lt("视频上传中...", "Uploading video...")
                      : lt("上传参考视频", "Upload video")}
                  </button>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: storyboardPanelTheme.uploadMetaText,
                    marginBottom: 4,
                  }}
                >
                  {lt(
                    `已上传图片 ${uploadedStoryboardImages.length}/${storyboardImageLimit}`,
                    `Uploaded images ${uploadedStoryboardImages.length}/${storyboardImageLimit}`
                  )}
                </div>
                {uploadedStoryboardImages.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
                    {uploadedStoryboardImages.map((item, index) => (
                      <div
                        key={`${item.url}-${index}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          fontSize: 11,
                          color: storyboardPanelTheme.uploadRowText,
                          background: storyboardPanelTheme.uploadRowBg,
                          border: `1px solid ${storyboardPanelTheme.uploadRowBorder}`,
                          borderRadius: 6,
                          padding: "4px 6px",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(item.name || `image_${index + 1}`).slice(0, 40)}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <span style={{ color: storyboardPanelTheme.tokenText }}>
                            {`<<<image_${totalImageCount + index + 1}>>>`}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveUploadedStoryboardImage(index)}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: storyboardPanelTheme.dangerText,
                              cursor: "pointer",
                              fontSize: 12,
                              padding: 0,
                            }}
                          >
                            {lt("删除", "Remove")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {uploadedStoryboardVideo?.url && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      fontSize: 11,
                      color: storyboardPanelTheme.uploadRowText,
                      background: storyboardPanelTheme.uploadRowBg,
                      border: `1px solid ${storyboardPanelTheme.uploadRowBorder}`,
                      borderRadius: 6,
                      padding: "4px 6px",
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(uploadedStoryboardVideo.name || "video_1").slice(0, 36)}
                      {typeof uploadedStoryboardVideo.duration === "number"
                        ? ` · ${uploadedStoryboardVideo.duration.toFixed(1)}s`
                        : ""}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span style={{ color: storyboardPanelTheme.tokenText }}>{`<<<video_1>>>`}</span>
                      <button
                        type="button"
                        onClick={handleClearUploadedStoryboardVideo}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: storyboardPanelTheme.dangerText,
                          cursor: "pointer",
                          fontSize: 12,
                          padding: 0,
                        }}
                      >
                        {lt("删除", "Remove")}
                      </button>
                    </div>
                  </div>
                )}
                {hasEdgeVideoInput && uploadedStoryboardVideo?.url && (
                  <div
                    style={{
                      fontSize: 11,
                      color: storyboardPanelTheme.warningText,
                      lineHeight: 1.4,
                      marginBottom: 4,
                    }}
                  >
                    {lt(
                      "当前已连接 video 句柄，运行时优先使用连线视频。",
                      "Video handle is connected; edge video takes priority at runtime."
                    )}
                  </div>
                )}
                {storyboardUploadError && (
                  <div
                    style={{
                      fontSize: 11,
                      color: storyboardPanelTheme.dangerText,
                      lineHeight: 1.4,
                    }}
                  >
                    {storyboardUploadError}
                  </div>
                )}
                <input
                  ref={storyboardImageInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                  multiple
                  onChange={handleStoryboardImageUpload}
                  style={{ display: "none" }}
                />
                <input
                  ref={storyboardVideoInputRef}
                  type="file"
                  accept=".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo"
                  onChange={handleStoryboardVideoUpload}
                  style={{ display: "none" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {storyboardShots.map((shot, index) => (
                  <div
                    key={`storyboard-shot-${index}`}
                    style={{
                      border: `1px solid ${storyboardPanelTheme.shotCardBorder}`,
                      borderRadius: 8,
                      background: storyboardPanelTheme.shotCardBg,
                      padding: 8,
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
                      <span
                        style={{
                          fontSize: 12,
                          color: storyboardPanelTheme.shotCardTitle,
                          fontWeight: 600,
                        }}
                      >
                        {lt(`镜头 ${index + 1}`, `Shot ${index + 1}`)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveStoryboardShot(index)}
                        disabled={storyboardShots.length <= 1}
                        style={{
                          border: "none",
                          background: "transparent",
                          color:
                            storyboardShots.length <= 1
                              ? storyboardPanelTheme.addBtnDisabledText
                              : storyboardPanelTheme.dangerText,
                          fontSize: 12,
                          cursor: storyboardShots.length <= 1 ? "not-allowed" : "pointer",
                        }}
                      >
                        {lt("删除", "Delete")}
                      </button>
                    </div>
                    <textarea
                      value={shot.prompt}
                      onChange={(event) =>
                        handleStoryboardPromptChange(index, event.target.value)
                      }
                      placeholder={lt("描述这个镜头的画面内容", "Describe this shot")}
                      style={{
                        width: "100%",
                        minHeight: 56,
                        resize: "vertical",
                        border: `1px solid ${storyboardPanelTheme.inputBorder}`,
                        borderRadius: 8,
                        padding: "6px 8px",
                        fontSize: 12,
                        lineHeight: 1.4,
                        outline: "none",
                        background: storyboardPanelTheme.inputBg,
                        color: storyboardPanelTheme.inputText,
                      }}
                    />
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: storyboardPanelTheme.durationLabel }}>{lt("时长", "Duration")}</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        step={1}
                        value={shot.duration}
                        onChange={(event) =>
                          handleStoryboardDurationChange(index, event.target.value)
                        }
                        style={{
                          width: 80,
                          border: `1px solid ${storyboardPanelTheme.inputBorder}`,
                          borderRadius: 8,
                          padding: "4px 8px",
                          fontSize: 12,
                          outline: "none",
                          background: storyboardPanelTheme.inputBg,
                          color: storyboardPanelTheme.inputText,
                        }}
                      />
                      <span style={{ fontSize: 12, color: storyboardPanelTheme.durationUnit }}>{lt("秒", "s")}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={handleAddStoryboardShot}
                  disabled={storyboardShots.length >= MAX_STORYBOARD_SHOTS}
                  style={{
                    border: `1px solid ${storyboardPanelTheme.addBtnBorder}`,
                    background: storyboardPanelTheme.addBtnBg,
                    borderRadius: 8,
                    padding: "4px 8px",
                    fontSize: 12,
                    color:
                      storyboardShots.length >= MAX_STORYBOARD_SHOTS
                        ? storyboardPanelTheme.addBtnDisabledText
                        : storyboardPanelTheme.addBtnText,
                    cursor: storyboardShots.length >= MAX_STORYBOARD_SHOTS ? "not-allowed" : "pointer",
                  }}
                >
                  {lt("＋添加镜头", "+ Add shot")}
                </button>
                <span
                  style={{
                    fontSize: 11,
                    color: isStoryboardDurationMatched
                      ? storyboardPanelTheme.matchedText
                      : storyboardPanelTheme.dangerText,
                    fontWeight: 600,
                  }}
                >
                  {lt(
                    `总时长 ${storyboardDurationTotal}s / 目标 ${targetStoryboardDuration}s`,
                    `Total ${storyboardDurationTotal}s / Target ${targetStoryboardDuration}s`
                  )}
                </span>
              </div>
              {!isStoryboardDurationMatched && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: storyboardPanelTheme.dangerText,
                    lineHeight: 1.45,
                  }}
                >
                  {lt(
                    "分镜总时长必须等于当前节点时长，否则无法提交。",
                    "Total shot duration must match the node duration."
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 视频类型选择 - 仅在有视频输入时显示 */}
      {hasVideoInput && (
        <div className="video-dropdown" style={{ marginBottom: 8, position: "relative" }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{lt("视频类型", "Video type")}</div>
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
                        handleVideoRefTypeChange(option.value as "feature" | "base");
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

      {/* 保留原声选项 - 仅在有视频输入时显示 */}
      {hasVideoInput && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "flex", alignItems: "center", fontSize: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={keepOriginalSound === "yes"}
              onChange={(e) => handleKeepOriginalSoundChange(e.target.checked ? "yes" : "no")}
              style={{ marginRight: 6 }}
              onClick={(e) => e.stopPropagation()}
            />
            <span>{lt("保留原视频声音", "Keep original sound")}</span>
          </label>
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
        startedAt={data.progressStartedAt}
        runKey={id}
      />

      {/* 历史记录 */}
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
            return (
              <div
                className="tanva-video-history-item"
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
