import React from "react";
import { Handle, Position, useReactFlow, useStore } from "reactflow";
import { AlertTriangle, Video, Share2, Download, HelpCircle } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { useAuthStore } from "@/stores/authStore";
import { uploadAudioToOSS } from "@/stores/aiChatStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";
import RunCreditBadge from "./RunCreditBadge";
import NodeSelect from "./NodeSelect";
import {
  getManagedRouteCredits,
  getManagedRouteOption,
  getManagedRoutesMetadata,
} from "../managedRoutePricing";

export type VideoProvider = "kling" | "kling-2.6" | "kling-o3" | "vidu" | "viduq3-pro" | "doubao";
type ViduModel =
  | "q2"
  | "q2-pro"
  | "q2-turbo"
  | "q3"
  | "q3-pro"
  | "q3-turbo";
type SeedanceModel = "seedance-1.5-pro" | "seedance-2.0" | "seedance-2.0-fast";
type Seedance20Mode = "reference_images" | "start_end";
type Seedance15Mode = "text" | "image" | "start_end";
type SeedanceMode = Seedance20Mode | Seedance15Mode;
type VodCapabilityMetadata = {
  label?: string;
  modelName?: string;
  modelVersion?: string;
  outputConfig?: {
    aspectRatios?: string[];
    durations?: number[];
    resolutions?: string[];
    audioGeneration?: boolean;
  };
  inputModes?: string[];
  notes?: string[];
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
    onSend?: (id: string) => void;
    creditsPerCall?: number;
    managedModelKey?: string;
    vendorKey?: string;
    platformKey?: string;
    provider: VideoProvider;
    clipDuration?: number;
    aspectRatio?: string;
    klingModel?: "kling-v2-1" | "kling-v2-6" | "kling-v3-0";
    viduModel?: ViduModel;
    seedanceModel?: SeedanceModel;
    seedanceMode?: SeedanceMode;
    mode?: "std" | "pro";
    sound?: boolean;
    audioUrls?: string[];
    generateAudio?: boolean;
    history?: VideoHistoryItem[];
    fallbackMessage?: string;
    resolution?: string;
    style?: string;
    offPeak?: boolean;
    camerafixed?: boolean;
    watermark?: boolean;
    nodeConfigKey?: string;
    nodeConfigNameZh?: string;
    nodeConfigNameEn?: string;
    nodeConfigMetadata?: Record<string, any>;
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

const stripVideoGenerationSuffix = (value: string): string =>
  value
    .replace(/\s*视频生成\s*/g, " ")
    .replace(/\s*瑙嗛鐢熸垚\s*/g, " ")
    .replace(/\s*video generation\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const normalizeViduModelForApi = (value?: string): "q2" | "q3" =>
  normalizeViduModelValue(value).startsWith("q3") ? "q3" : "q2";

const isViduQ3FamilyModel = (value?: string): boolean =>
  normalizeViduModelForApi(value) === "q3";

const normalizeViduModelValue = (value?: string): ViduModel => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (normalized === "q2-pro" || normalized === "q2pro") return "q2-pro";
  if (normalized === "q2-turbo" || normalized === "q2turbo") return "q2-turbo";
  if (
    normalized === "q3-turbo" ||
    normalized === "q3turbo" ||
    normalized === "q3-mix" ||
    normalized === "q3mix"
  ) {
    return "q3-turbo";
  }
  if (normalized === "q3-pro" || normalized === "q3pro") return "q3-pro";
  if (normalized === "q3") return "q3";
  return "q2";
};

const isViduModelOptionSupported = (
  optionValue: ViduModel,
  supportedModels: string[]
): boolean => {
  if (supportedModels.length === 0) return true;
  const value = String(optionValue).trim().toLowerCase();
  if (supportedModels.includes(value)) return true;
  const family = normalizeViduModelForApi(optionValue);
  return supportedModels.includes(family);
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

const SEEDANCE20_DOC_ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const SEEDANCE20_DOC_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const SEEDANCE20_DOC_RESOLUTIONS = ["480P", "720P"] as const;

const SEEDANCE20_MODE_VALUES: Seedance20Mode[] = ["reference_images", "start_end"];
const SEEDANCE15_MODE_VALUES: Seedance15Mode[] = ["text", "image", "start_end"];

const isSeedance20ModeValue = (value: unknown): value is Seedance20Mode =>
  typeof value === "string" && SEEDANCE20_MODE_VALUES.includes(value as Seedance20Mode);
const isSeedance15ModeValue = (value: unknown): value is Seedance15Mode =>
  typeof value === "string" && SEEDANCE15_MODE_VALUES.includes(value as Seedance15Mode);

type SeedanceModeSpec = {
  visibleHandles: Array<"text" | "image" | "image-2" | "video" | "audio">;
  imageHandleMax: number;
  image2HandleMax: number;
  videoHandleMax: number;
  audioHandleMax: number;
};

const getSeedance20ModeSpec = (mode: Seedance20Mode): SeedanceModeSpec => {
  switch (mode) {
    case "start_end":
      return {
        visibleHandles: ["text", "image"],
        imageHandleMax: 2,
        image2HandleMax: 0,
        videoHandleMax: 0,
        audioHandleMax: 0,
      };
    case "reference_images":
      return {
        visibleHandles: ["text", "image", "video", "audio"],
        imageHandleMax: 9,
        image2HandleMax: 0,
        videoHandleMax: 3,
        audioHandleMax: 3,
      };
    default:
      return {
        visibleHandles: ["text"],
        imageHandleMax: 0,
        image2HandleMax: 0,
        videoHandleMax: 0,
        audioHandleMax: 0,
      };
  }
};

const getSeedance15ModeSpec = (mode: Seedance15Mode): SeedanceModeSpec => {
  switch (mode) {
    case "image":
      return {
        visibleHandles: ["text", "image"],
        imageHandleMax: 1,
        image2HandleMax: 0,
        videoHandleMax: 0,
        audioHandleMax: 0,
      };
    case "start_end":
      return {
        visibleHandles: ["text", "image", "image-2"],
        imageHandleMax: 1,
        image2HandleMax: 1,
        videoHandleMax: 0,
        audioHandleMax: 0,
      };
    case "text":
    default:
      return {
        visibleHandles: ["text", "image"],
        imageHandleMax: 1,
        image2HandleMax: 0,
        videoHandleMax: 0,
        audioHandleMax: 0,
      };
  }
};

const getSeedanceHandleTopMap = (
  handles: Array<"text" | "image" | "image-2" | "video" | "audio">
): Record<string, string> => {
  const positionsByCount: Record<number, string[]> = {
    1: ["50%"],
    2: ["35%", "65%"],
    3: ["24%", "50%", "76%"],
    4: ["18%", "40%", "62%", "84%"],
  };
  const positions = positionsByCount[handles.length] || positionsByCount[4];
  return handles.reduce<Record<string, string>>((acc, handle, index) => {
    acc[handle] = positions[Math.min(index, positions.length - 1)];
    return acc;
  }, {});
};

const isSupportedAudioFile = (file: File): boolean => {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  const name = (file.name || "").trim();
  return SUPPORTED_AUDIO_PATTERN.test(name);
};

function GenericVideoNodeInner({ id, data, selected }: Props) {
  const { lt, isZh } = useLocaleText();
  const { setEdges } = useReactFlow();
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>("16/9");
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const [channelMenuOpen, setChannelMenuOpen] = React.useState(false);
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
  const [showHelp, setShowHelp] = React.useState(false);

  // 妫€娴嬫槸鍚︽湁鍥剧墖杈撳叆杩炴帴
  const hasImageInput = useStore((state) => {
    const edges = state.edges || [];
    return edges.some(
      (edge) => edge.target === id && (edge.targetHandle === "image" || edge.targetHandle === "image-2")
    );
  });

  // 妫€娴嬪浘鐗囪緭鍏ユ暟閲忥紙鍚?image 鍜?image-2锛?
  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter(
      (edge) => edge.target === id && (edge.targetHandle === "image" || edge.targetHandle === "image-2")
    ).length;
  });
  const hasImage2Input = useStore((state) => {
    const edges = state.edges || [];
    return edges.some((edge) => edge.target === id && edge.targetHandle === "image-2");
  });
  const provider = data.provider || "kling";
  const nodeConfigMetadata =
    data.nodeConfigMetadata && typeof data.nodeConfigMetadata === "object"
      ? (data.nodeConfigMetadata as Record<string, any>)
      : {};
  const managedRoutesMetadata = React.useMemo(
    () => getManagedRoutesMetadata(nodeConfigMetadata),
    [nodeConfigMetadata]
  );
  const selectedManagedRoute = React.useMemo(
    () => getManagedRouteOption(nodeConfigMetadata, data.vendorKey),
    [data.vendorKey, nodeConfigMetadata]
  );
  const vodConfig =
    nodeConfigMetadata.vod && typeof nodeConfigMetadata.vod === "object"
      ? (nodeConfigMetadata.vod as VodCapabilityMetadata)
      : undefined;
  const isVodManagedNode = Boolean(vodConfig);
  const viduModel: ViduModel = normalizeViduModelValue(
    data.viduModel || (provider === "viduq3-pro" ? "q3" : "q2")
  );
  const seedanceModel: SeedanceModel =
    data.seedanceModel === "seedance-2.0-fast"
      ? "seedance-2.0-fast"
      : data.seedanceModel === "seedance-2.0"
      ? "seedance-2.0"
      : "seedance-1.5-pro";
  const isSeedanceModel = provider === "doubao";
  const isSeedance20Model =
    isSeedanceModel &&
    (seedanceModel === "seedance-2.0" || seedanceModel === "seedance-2.0-fast");
  const inferredSeedanceMode = React.useMemo<SeedanceMode>(() => {
    if (!isSeedanceModel) return "text";
    if (isSeedance20Model) {
      if (isSeedance20ModeValue(data.seedanceMode)) return data.seedanceMode;
      const legacyMode = String(data.seedanceMode || "").trim().toLowerCase();
      if (legacyMode === "start_end" || legacyMode === "first_frame") return "start_end";
      return "reference_images";
    }
    const explicitMode = isSeedance15ModeValue(data.seedanceMode)
      ? data.seedanceMode
      : undefined;
    if (explicitMode === "start_end") return "start_end";
    const legacyMode = String(data.seedanceMode || "").trim().toLowerCase();
    if (legacyMode === "start_end" || legacyMode === "first_frame") return "start_end";
    if (legacyMode === "reference_images") return "image";
    if (hasImage2Input) return "start_end";
    if (imageInputCount >= 2) return "start_end";
    if (imageInputCount === 1) return "image";
    if (explicitMode === "image") return "image";
    return "text";
  }, [
    data.seedanceMode,
    hasImage2Input,
    imageInputCount,
    isSeedanceModel,
    isSeedance20Model,
  ]);
  const seedanceMode: SeedanceMode = inferredSeedanceMode;
  const seedanceModeSpec = React.useMemo(
    () =>
      !isSeedanceModel
        ? null
        : isSeedance20Model
        ? getSeedance20ModeSpec(seedanceMode as Seedance20Mode)
        : getSeedance15ModeSpec(seedanceMode as Seedance15Mode),
    [isSeedance20Model, isSeedanceModel, seedanceMode]
  );
  const seedanceHandleTopMap = React.useMemo(
    () => (seedanceModeSpec ? getSeedanceHandleTopMap(seedanceModeSpec.visibleHandles) : {}),
    [seedanceModeSpec]
  );
  const klingModel =
    data.klingModel ||
    (provider === "kling-2.6" ? "kling-v2-6" : "kling-v2-6");
  const isUnifiedKlingNode = provider === "kling" || provider === "kling-2.6";
  const isKling26Model = isUnifiedKlingNode && (klingModel === "kling-v2-6" || klingModel === "kling-v3-0");
  const isViduNode = provider === "vidu" || provider === "viduq3-pro";
  const isProMode = ((data as any).mode || "std") === "pro";
  const providerInfo = isUnifiedKlingNode
    ? PROVIDER_CONFIG.kling
    : PROVIDER_CONFIG[provider] || PROVIDER_CONFIG["kling"];
  const displayTitle = React.useMemo(() => {
    const zhTitle = typeof data.nodeConfigNameZh === "string" && data.nodeConfigNameZh.trim()
      ? data.nodeConfigNameZh.trim()
      : providerInfo.zh;
    const enTitle = typeof data.nodeConfigNameEn === "string" && data.nodeConfigNameEn.trim()
      ? data.nodeConfigNameEn.trim()
      : providerInfo.name;
    const normalizedZhTitle = stripVideoGenerationSuffix(zhTitle) || providerInfo.zh;
    const normalizedEnTitle = stripVideoGenerationSuffix(enTitle) || providerInfo.name;
    return isZh ? normalizedZhTitle : normalizedEnTitle;
  }, [data.nodeConfigNameEn, data.nodeConfigNameZh, isZh, providerInfo.name, providerInfo.zh]);
  const supportedModels = React.useMemo(
    () =>
      Array.isArray(nodeConfigMetadata.supportedModels)
        ? Array.from(
            new Set(
              nodeConfigMetadata.supportedModels.map((item: unknown) =>
                provider === "vidu" || provider === "viduq3-pro"
                  ? normalizeViduModelValue(String(item))
                  : String(item).trim()
              )
            )
          )
        : [],
    [nodeConfigMetadata.supportedModels, provider]
  );
  const selectedCredits =
    typeof data.creditsPerCall === "number"
      ? data.creditsPerCall
      : getManagedRouteCredits(nodeConfigMetadata, data.vendorKey);
  const vodAspectOptions = React.useMemo(() => {
    if (!Array.isArray(vodConfig?.outputConfig?.aspectRatios)) return [];
    return [
      { label: lt("自动", "Auto"), value: "" },
      ...vodConfig.outputConfig.aspectRatios.map((value) => ({
        label: value,
        value,
      })),
    ];
  }, [lt, vodConfig]);
  const vodDurationOptions = React.useMemo(() => {
    if (!Array.isArray(vodConfig?.outputConfig?.durations)) return [];
    return vodConfig.outputConfig.durations.map((value) => ({
      label: lt(`${value}秒`, `${value}s`),
      value,
    }));
  }, [lt, vodConfig]);
  const vodResolutionOptions = React.useMemo(() => {
    if (!Array.isArray(vodConfig?.outputConfig?.resolutions)) return [];
    return vodConfig.outputConfig.resolutions.map((value) => value.toUpperCase());
  }, [vodConfig]);
  const vodInputModeLabel = React.useMemo(() => {
    if (!Array.isArray(vodConfig?.inputModes) || vodConfig.inputModes.length === 0) return "";
    const labels = vodConfig.inputModes.map((mode) => {
      switch (mode) {
        case "text":
          return lt("鏂囩敓瑙嗛", "Text to video");
        case "image":
          return lt("鍥剧敓瑙嗛", "Image to video");
        case "first_frame":
          return lt("鍥剧敓瑙嗛-棣栧抚", "Image to video - first frame");
        case "start_end":
          return lt("首尾帧", "Start-end");
        case "reference":
          return lt("参考模式", "Reference");
        case "reference_images":
          return lt("多图参考", "Multi-image reference");
        case "smart_frames":
          return lt("鏅鸿兘澶氬抚", "Smart frames");
        case "reference_video":
          return lt("视频参考", "Video reference");
        case "image_audio":
          return lt("鍥剧墖 + 闊抽", "Image + audio");
        case "image_video":
          return lt("鍥剧墖 + 瑙嗛", "Image + video");
        case "video_audio":
          return lt("瑙嗛 + 闊抽", "Video + audio");
        case "image_video_audio":
          return lt("鍥剧墖 + 瑙嗛 + 闊抽", "Image + video + audio");
        default:
          return mode;
      }
    });
    return labels.join(" / ");
  }, [lt, vodConfig]);

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
    // 濡傛灉鏄?presigned 閾炬帴锛堝寘鍚?X-Amz / X-Tos 绛夌鍚嶅瓧娈碉級锛屼笉瑕佹坊鍔?cache-bust 鍙傛暟锛堜細瀵艰嚧绛惧悕澶辨晥锛?
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

  // 鍏ㄥ睆鏃跺己鍒惰缃?object-fit: contain锛岀‘淇濊棰戞寜鍘熸瘮渚嬫樉绀?
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
        setChannelMenuOpen(false);
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

  // 鏍规嵁渚涘簲鍟嗛厤缃笉鍚岀殑閫夐」
  const getAspectOptions = () => {
    if (provider === "kling" || provider === "kling-2.6") {
      return [
        { label: lt("自动", "Auto"), value: "" },
        { label: lt("横屏 (16:9)", "Landscape (16:9)"), value: "16:9" },
        { label: lt("竖屏 (9:16)", "Portrait (9:16)"), value: "9:16" },
        { label: lt("方形 (1:1)", "Square (1:1)"), value: "1:1" },
      ];
    }
    return [
      { label: lt("自动", "Auto"), value: "" },
      { label: lt("横屏 (16:9)", "Landscape (16:9)"), value: "16:9" },
      { label: lt("竖屏 (9:16)", "Portrait (9:16)"), value: "9:16" },
    ];
  };

  const getDurationOptions = () => {
    if (provider === "kling" || provider === "kling-2.6") {
      return [
        { label: lt("5秒", "5s"), value: 5 },
        { label: lt("10秒", "10s"), value: 10 },
      ];
    }
    if (provider === "vidu" && !isViduQ3FamilyModel(viduModel)) {
      return [
        { label: lt("1秒", "1s"), value: 1 },
        { label: lt("2秒", "2s"), value: 2 },
        { label: lt("3秒", "3s"), value: 3 },
        { label: lt("4秒", "4s"), value: 4 },
        { label: lt("5秒", "5s"), value: 5 },
        { label: lt("6秒", "6s"), value: 6 },
        { label: lt("7秒", "7s"), value: 7 },
        { label: lt("8秒", "8s"), value: 8 },
      ];
    }
    if (provider === "viduq3-pro" || isViduQ3FamilyModel(viduModel)) {
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
        { label: lt("11秒", "11s"), value: 11 },
        { label: lt("12秒", "12s"), value: 12 },
        { label: lt("13秒", "13s"), value: 13 },
        { label: lt("14秒", "14s"), value: 14 },
        { label: lt("15秒", "15s"), value: 15 },
        { label: lt("16秒", "16s"), value: 16 },
      ];
    }
    if (provider === "doubao") {
      const values = isSeedance20Model
        ? [...SEEDANCE20_DOC_DURATIONS]
        : [3, 4, 5, 6, 7, 8, 9, 10];
      return values.map((value) => ({ label: lt(`${value}秒`, `${value}s`), value }));
    }
    return [];
  };

  const aspectOptions = React.useMemo(() => {
    if (provider === "doubao" && isSeedance20Model) {
      return [...SEEDANCE20_DOC_ASPECT_RATIOS].map((value) => ({ label: value, value }));
    }
    if (vodAspectOptions.length > 0) {
      return vodAspectOptions;
    }
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
    if (provider === "doubao") {
      const ratios = isSeedance20Model
        ? [...SEEDANCE20_DOC_ASPECT_RATIOS]
        : ["16:9", "9:16", "1:1"];
      return ratios.map((value) => ({ label: value, value }));
    }
    return getAspectOptions();
  }, [getAspectOptions, isSeedance20Model, lt, provider, vodAspectOptions]);
  const klingModelOptions = React.useMemo(
    () => [
      { label: "Kling 2.6", value: "kling-v2-6" as const },
      { label: "Kling 3.0", value: "kling-v3-0" as const },
    ],
    []
  );
  const viduModelOptions = React.useMemo(
    () => [
      { label: "Vidu Q2", value: "q2" as const },
      { label: "Vidu Q3", value: "q3" as const },
      { label: "Vidu Q3-Turbo", value: "q3-turbo" as const },
    ],
    []
  );
  const seedanceModelOptions = React.useMemo(
    () => [
      { label: "Seedance 1.5-Pro", value: "seedance-1.5-pro" as const },
      { label: "Seedance 2.0", value: "seedance-2.0" as const },
      { label: "Seedance 2.0 Fast", value: "seedance-2.0-fast" as const },
    ],
    []
  );
  const filteredKlingModelOptions = React.useMemo(
    () =>
      supportedModels.length > 0
        ? klingModelOptions.filter((opt) => supportedModels.includes(opt.value))
        : klingModelOptions,
    [klingModelOptions, supportedModels]
  );
  const filteredViduModelOptions = React.useMemo(
    () =>
      supportedModels.length > 0
        ? viduModelOptions.filter((opt) =>
            isViduModelOptionSupported(opt.value, supportedModels)
          )
        : viduModelOptions,
    [supportedModels, viduModelOptions]
  );
  const filteredSeedanceModelOptions = React.useMemo(
    () => {
      if (supportedModels.length === 0) return seedanceModelOptions;
      const normalized = new Set(
        supportedModels.map((item) => String(item).trim().toLowerCase())
      );
      // 2.0 与 2.0 Fast 属于同一模型族，任一可用时都展示，方便切换。
      if (normalized.has("seedance-2.0") || normalized.has("seedance-2.0-fast")) {
        normalized.add("seedance-2.0");
        normalized.add("seedance-2.0-fast");
      }
      const filtered = seedanceModelOptions.filter((opt) => normalized.has(opt.value));
      return filtered.length > 0 ? filtered : seedanceModelOptions;
    },
    [seedanceModelOptions, supportedModels]
  );
  const durationOptions = React.useMemo(() => {
    if (provider === "doubao" && isSeedance20Model) {
      return [...SEEDANCE20_DOC_DURATIONS].map((value) => ({
        label: lt(`${value}秒`, `${value}s`),
        value,
      }));
    }
    return vodDurationOptions.length > 0 ? vodDurationOptions : getDurationOptions();
  }, [getDurationOptions, isSeedance20Model, lt, provider, vodDurationOptions]);
  const shouldShowAspectSelector =
    isSeedanceModel
      ? true
      : provider === "viduq3-pro"
      ? !hasImageInput
      : provider === "vidu"
      ? true
      : !hasImageInput;
  const legacySeedanceResolutionOptions = React.useMemo(() => {
    if (provider !== "doubao" || isVodManagedNode) return [];
    return isSeedance20Model ? [...SEEDANCE20_DOC_RESOLUTIONS] : ["720P"];
  }, [isSeedance20Model, isVodManagedNode, provider]);
  const resolutionOptions = React.useMemo(
    () => {
      if (provider === "doubao" && isSeedance20Model) {
        return [...SEEDANCE20_DOC_RESOLUTIONS];
      }
      return vodResolutionOptions.length > 0
        ? vodResolutionOptions
        : legacySeedanceResolutionOptions;
    },
    [isSeedance20Model, legacySeedanceResolutionOptions, provider, vodResolutionOptions]
  );
  const viduModelFamily = normalizeViduModelForApi(viduModel);
  const isViduQ2FamilyModel = viduModelFamily === "q2";
  const isViduQ2ProMode = viduModel === "q2-pro";
  const isCurrentViduQ3FamilyModel = viduModelFamily === "q3";
  const isViduQ3ProMode = viduModel === "q3-pro";
  const isViduQ3TurboModel = viduModel === "q3-turbo";
  const viduModelSelectionValue: "q2" | "q3" | "q3-turbo" =
    viduModel === "q2-pro"
      ? "q2"
      : viduModel === "q3-pro"
      ? "q3"
      : (viduModel as "q2" | "q3" | "q3-turbo");
  const shouldShowResolutionSelector = resolutionOptions.length > 0;
  const shouldShowLegacyViduOptions =
    (provider === "vidu" || provider === "viduq3-pro") && !isVodManagedNode;
  const shouldShowLegacySeedanceOptions =
    provider === "doubao" && !isVodManagedNode && !isSeedance20Model;
  const shouldShowSeedanceGenerateAudio =
    isSeedance20Model &&
    ((typeof vodConfig?.outputConfig?.audioGeneration === "boolean" &&
      vodConfig.outputConfig.audioGeneration) ||
      !isVodManagedNode);
  const seedanceConstraintTips = React.useMemo(() => {
    if (!isSeedanceModel) return [] as string[];
    if (isSeedance20Model) {
      return [
        lt("图片大小：单图建议不超过 30MB", "Image size: each image should be <= 30MB"),
        lt("生成时长：4-15 秒", "Output duration: 4-15s"),
        lt(
          "分辨率/尺寸：480P、720P；21:9、16:9、4:3、1:1、3:4、9:16",
          "Resolution/ratio: 480P, 720P; 21:9, 16:9, 4:3, 1:1, 3:4, 9:16"
        ),
        lt("参考视频最多 3 条；音频最多 3 条且每条≤5秒", "Video refs <=3; audio refs <=3 and <=5s each"),
      ];
    }
    return [
      lt("图片大小：单图建议不超过 30MB", "Image size: each image should be <= 30MB"),
      lt("生成时长：3-10 秒", "Output duration: 3-10s"),
      lt("分辨率/尺寸：720P；16:9、9:16、1:1", "Resolution/ratio: 720P; 16:9, 9:16, 1:1"),
    ];
  }, [isSeedance20Model, isSeedanceModel, lt]);
  const seedanceModeOptions = React.useMemo(
    () =>
      isSeedance20Model
        ? [
            {
              value: "reference_images",
              label: lt("全能参考", "Omni reference"),
              description: lt(
                "文不限，图≤9，视频≤3，音频≤3（每条≤5秒）",
                "Text unlimited, image<=9, video<=3, audio<=3 (<=5s each)"
              ),
            },
            {
              value: "start_end",
              label: lt("首/尾帧（1-2图）", "Frame mode (1-2 images)"),
              description: lt(
                "支持首帧、尾帧、首尾帧（总共1-2张图）",
                "Supports first/last/start-end frames (1-2 images total)"
              ),
            },
          ]
        : [
            {
              value: "text",
              label: lt("文生视频", "Text to video"),
              description: lt("支持文本/单图/文+图（最多1张图）", "Text / image / text+image (max 1 image)"),
            },
            {
              value: "image",
              label: lt("图生视频", "Image to video"),
              description: lt("单图输入", "Single image input"),
            },
            {
              value: "start_end",
              label: lt("首尾帧（1~2图）", "Start-end frames (1-2 images)"),
              description: lt("首帧(image) + 尾帧(image-2)，总共 1-2 张图", "Start frame (image) + end frame (image-2), 1-2 images total"),
            },
          ],
    [isSeedance20Model, lt]
  );

  React.useEffect(() => {
    if (!shouldShowAspectSelector) {
      setAspectMenuOpen(false);
    }
  }, [shouldShowAspectSelector]);

  React.useEffect(() => {
    if (!managedRoutesMetadata || managedRoutesMetadata.vendors.length === 0) return;
    if (selectedManagedRoute) return;
    const fallbackVendor =
      managedRoutesMetadata.vendors.find(
        (item) => item.vendorKey === managedRoutesMetadata.defaultVendor
      ) || managedRoutesMetadata.vendors[0];
    if (!fallbackVendor) return;

    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            managedModelKey: managedRoutesMetadata.modelKey,
            vendorKey: fallbackVendor.vendorKey,
            platformKey: fallbackVendor.platformKey || fallbackVendor.vendorKey,
            creditsPerCall:
              typeof fallbackVendor.creditsPerCall === "number"
                ? fallbackVendor.creditsPerCall
                : undefined,
          },
        },
      })
    );
  }, [id, managedRoutesMetadata, selectedManagedRoute]);

  React.useEffect(() => {
    if (!(provider === "vidu" || provider === "viduq3-pro")) return;
    if (filteredViduModelOptions.length === 0) return;
    if (
      filteredViduModelOptions.some((opt) =>
        isViduModelOptionSupported(viduModel, [String(opt.value)])
      )
    ) {
      return;
    }

    const fallbackModel = filteredViduModelOptions[0]?.value;
    if (!fallbackModel) return;

    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            viduModel: fallbackModel,
            provider:
              normalizeViduModelForApi(fallbackModel) === "q3"
                ? "viduq3-pro"
                : "vidu",
            clipDuration: undefined,
          },
        },
      })
    );
  }, [filteredViduModelOptions, id, provider, viduModel]);

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
    (value: "kling-v2-6" | "kling-v3-0") => {
      if (value === klingModel) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              klingModel: value,
              sound: true,
            },
          },
        })
      );
    },
    [id, klingModel]
  );

  const handleViduModelChange = React.useCallback(
    (value: ViduModel) => {
      if (value === viduModel) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              viduModel: value,
              provider:
                normalizeViduModelForApi(value) === "q3"
                  ? "viduq3-pro"
                  : "vidu",
              clipDuration: undefined,
            },
          },
        })
      );
    },
    [id, viduModel]
  );

  const handleViduQ2ModeChange = React.useCallback(
    (value: "std" | "pro") => {
      const nextModel: ViduModel = value === "pro" ? "q2-pro" : "q2";
      if (nextModel === viduModel) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              viduModel: nextModel,
              provider: "vidu",
              clipDuration: undefined,
            },
          },
        })
      );
    },
    [id, viduModel]
  );

  const handleViduQ3ModeChange = React.useCallback(
    (value: "std" | "pro") => {
      const nextModel: ViduModel = value === "pro" ? "q3-pro" : "q3";
      if (nextModel === viduModel) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              viduModel: nextModel,
              provider: "viduq3-pro",
              clipDuration: undefined,
            },
          },
        })
      );
    },
    [id, viduModel]
  );

  const handleSeedanceModelChange = React.useCallback(
    (value: SeedanceModel) => {
      if (value === seedanceModel) return;
      const nextMode: SeedanceMode =
        value === "seedance-2.0" || value === "seedance-2.0-fast"
          ? "reference_images"
          : "text";
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              seedanceModel: value,
              seedanceMode: nextMode,
            },
          },
        })
      );
    },
    [id, seedanceModel]
  );

  const handleSeedanceModeChange = React.useCallback(
    (value: SeedanceMode) => {
      if (!isSeedanceModel || value === seedanceMode) return;
      const spec = isSeedance20Model
        ? getSeedance20ModeSpec(value as Seedance20Mode)
        : getSeedance15ModeSpec(value as Seedance15Mode);

      setEdges((edges) => {
        const targetEdges = edges.filter((edge) => edge.target === id);
        const otherEdges = edges.filter((edge) => edge.target !== id);
        let imageCount = 0;
        let image2Count = 0;
        let videoCount = 0;
        let audioCount = 0;

        const filteredTargetEdges = targetEdges.filter((edge) => {
          switch (edge.targetHandle) {
            case "text":
              return spec.visibleHandles.includes("text");
            case "image":
              if (!spec.visibleHandles.includes("image") || imageCount >= spec.imageHandleMax) {
                return false;
              }
              imageCount += 1;
              return true;
            case "image-2":
              if (!spec.visibleHandles.includes("image-2") || image2Count >= spec.image2HandleMax) {
                return false;
              }
              image2Count += 1;
              return true;
            case "video":
              if (!spec.visibleHandles.includes("video") || videoCount >= spec.videoHandleMax) {
                return false;
              }
              videoCount += 1;
              return true;
            case "audio":
              if (!spec.visibleHandles.includes("audio") || audioCount >= spec.audioHandleMax) {
                return false;
              }
              audioCount += 1;
              return true;
            default:
              return true;
          }
        });

        return [...otherEdges, ...filteredTargetEdges];
      });

      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { seedanceMode: value } },
        })
      );
    },
    [id, isSeedance20Model, isSeedanceModel, seedanceMode, setEdges]
  );

  const handleManagedRouteChange = React.useCallback(
    (vendorKey: string) => {
      const target = getManagedRouteOption(nodeConfigMetadata, vendorKey);
      if (!target) return;
      if (target.vendorKey === (data.vendorKey || "").trim()) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              managedModelKey: managedRoutesMetadata?.modelKey,
              vendorKey: target.vendorKey,
              platformKey: target.platformKey || target.vendorKey,
              creditsPerCall:
                typeof target.creditsPerCall === "number"
                  ? target.creditsPerCall
                  : undefined,
            },
          },
        })
      );
    },
    [data.vendorKey, id, managedRoutesMetadata?.modelKey, nodeConfigMetadata]
  );

  React.useEffect(() => {
    if (!isUnifiedKlingNode) return;
    if (klingModel !== "kling-v2-1") return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { klingModel: "kling-v2-6" } },
      })
    );
  }, [id, isUnifiedKlingNode, klingModel]);

  React.useEffect(() => {
    if (!isKling26Model || data.sound === true) return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { sound: true } },
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
        setAudioMessage(lt("闊抽涓婁紶涓?..", "Uploading audio..."));
        const uploadedUrls: string[] = [];

        for (const file of incomingFiles) {
          if (!isSupportedAudioFile(file)) {
            throw new Error(
              lt(
                "涓嶆敮鎸佺殑闊抽鏍煎紡锛岃涓婁紶甯歌闊抽鏂囦欢",
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
                    lt("鏃犳硶璇诲彇闊抽鏃堕暱", "Unable to read audio duration")
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
                    lt("鏃犳硶璇诲彇闊抽鏂囦欢锛岃纭鏍煎紡姝ｇ‘", "Unable to read audio file, please verify the format")
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
              else reject(new Error(lt("鏃犳硶璇诲彇闊抽鏁版嵁", "Unable to read audio data")));
            };
            reader.onerror = () =>
              reject(new Error(lt("鏃犳硶璇诲彇闊抽鏂囦欢", "Unable to read audio file")));
            reader.readAsDataURL(file);
          });

          const uploaded = await uploadAudioToOSS(dataUrl, projectId);
          if (!uploaded) {
            throw new Error(lt("闊抽涓婁紶澶辫触锛岃閲嶈瘯", "Audio upload failed, please retry"));
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
            "宸蹭笂浼犻煶棰戯紝sound 灏嗚嚜鍔ㄦ寜 no 鎻愪氦",
            "Audio uploaded, sound will be submitted as no automatically"
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : lt("闊抽涓婁紶澶辫触锛岃绋嶅悗閲嶈瘯", "Audio upload failed, please retry later");
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
    const match = filteredKlingModelOptions.find((opt) => opt.value === klingModel);
    return match?.label || "Kling 2.6";
  }, [filteredKlingModelOptions, klingModel]);

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
      alert(lt("娌℃湁鍙鍒剁殑瑙嗛閾炬帴", "No video link to copy"));
      return;
    }
    try {
      // 浼樺厛浣跨敤 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        alert(lt("已复制视频链接", "Video link copied"));
        return;
      }
      // 澶囩敤鏂规锛氫娇鐢?execCommand
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
        alert(lt("澶嶅埗澶辫触锛岃鎵嬪姩澶嶅埗锛歕n", "Copy failed. Please copy manually:\n") + url);
      }
    } catch (error) {
      console.error(lt("澶嶅埗澶辫触:", "Copy failed:"), error);
      // 鏈€鍚庣殑澶囩敤鏂规锛氭樉绀洪摼鎺ヨ鐢ㄦ埛鎵嬪姩澶嶅埗
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
        message: lt("瑙嗛涓嬭浇涓紝璇风◢绛?..", "Downloading video..."),
      });
      try {
        // 妫€娴嬫槸鍚︿负 OSS URL锛堥樋閲屼簯 OSS 鏀寔 CORS锛屽彲鐩存帴涓嬭浇锛?
        const isOssUrl = url.includes('aliyuncs.com');
        // 闈?OSS URL 闇€瑕佷唬鐞?
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
          // 纭繚 blob 绫诲瀷姝ｇ‘
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
            message: lt("涓嬭浇瀹屾垚锛岀◢鍚庡彲鍐嶆涓嬭浇", "Download completed"),
          });
          scheduleFeedbackClear(2000);
        } else {
          // 涓嬭浇澶辫触锛屽皾璇曞湪鏂版爣绛鹃〉鎵撳紑
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setDownloadFeedback({
            type: "success",
            message: lt("宸插湪鏂版爣绛鹃〉鎵撳紑瑙嗛閾炬帴", "Opened video link in new tab"),
          });
          scheduleFeedbackClear(3000);
        }
      } catch (error) {
        console.error(lt("涓嬭浇澶辫触:", "Download failed:"), error);
        // 涓嬭浇澶辫触鏃讹紝灏濊瘯鐩存帴鎵撳紑閾炬帴
        window.open(url, "_blank");
        setDownloadFeedback({
          type: "error",
          message: lt("涓嬭浇澶辫触锛屽凡鍦ㄦ柊鏍囩椤垫墦寮€", "Download failed, opened in new tab"),
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
    return text.length > 80 ? `${text.slice(0, 80)}...` : text;
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
        style={{ top: isSeedanceModel ? seedanceHandleTopMap.text || "32%" : "32%" }}
        onMouseEnter={() => setHover("text-in")}
        onMouseLeave={() => setHover(null)}
      />
      {(isSeedanceModel
        ? seedanceModeSpec?.visibleHandles.includes("image")
        : true) && (
        <Handle
          type='target'
          position={Position.Left}
          id='image'
          style={{ top: isSeedanceModel ? seedanceHandleTopMap.image || "60%" : "60%" }}
          onMouseEnter={() => setHover("image-in")}
          onMouseLeave={() => setHover(null)}
        />
      )}
      {/* image-2 灏惧抚: 浠?Kling 2.6/3.0 pro 妯″紡娓叉煋 */}
      {((isSeedanceModel && seedanceModeSpec?.visibleHandles.includes("image-2")) ||
        (isKling26Model && isProMode) ||
        isViduNode) && (
        <Handle
          type='target'
          position={Position.Left}
          id='image-2'
          style={{ top: isSeedanceModel ? seedanceHandleTopMap["image-2"] || "78%" : "78%" }}
          onMouseEnter={() => setHover("image-2-in")}
          onMouseLeave={() => setHover(null)}
        />
      )}
      {(isSeedanceModel && seedanceModeSpec?.visibleHandles.includes("video")) && (
        <Handle
          type='target'
          position={Position.Left}
          id='video'
          style={{ top: seedanceHandleTopMap.video || "78%" }}
          onMouseEnter={() => setHover("video-in")}
          onMouseLeave={() => setHover(null)}
        />
      )}
      {((isSeedanceModel && seedanceModeSpec?.visibleHandles.includes("audio")) ||
        (isUnifiedKlingNode && klingModel !== "kling-v2-6" && klingModel !== "kling-v3-0")) && (
        <Handle
          type='target'
          position={Position.Left}
          id='audio'
          style={{ top: isSeedanceModel ? seedanceHandleTopMap.audio || "78%" : "78%" }}
          onMouseEnter={() => setHover("audio-in")}
          onMouseLeave={() => setHover(null)}
        />
      )}
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
          style={{
            left: -8,
            top: isSeedanceModel ? seedanceHandleTopMap.text || "32%" : "32%",
            transform: "translate(-100%, -50%)",
          }}
        >
          prompt
        </div>
      )}
      {hover === "image-in" && (
        <div
          className='flow-tooltip'
          style={{
            left: -8,
            top: isSeedanceModel ? seedanceHandleTopMap.image || "60%" : "60%",
            transform: "translate(-100%, -50%)",
          }}
        >
          {isSeedanceModel
            ? isSeedance20Model
              ? seedanceMode === "reference_images"
                ? "image (1-9)"
                : "image (1-2)"
              : seedanceMode === "start_end"
              ? "image (1-2)"
              : "image"
            : isKling26Model
            ? isProMode
              ? "image (棣栧抚)"
              : "image (浠?寮?"
            : "image"}
        </div>
      )}
      {hover === "image-2-in" && (
        <div
          className='flow-tooltip'
          style={{
            left: -8,
            top: isSeedanceModel ? seedanceHandleTopMap["image-2"] || "78%" : "78%",
            transform: "translate(-100%, -50%)",
          }}
        >
          image-2 (灏惧抚)
        </div>
      )}
      {hover === "video-in" && (
        <div
          className='flow-tooltip'
          style={{
            left: -8,
            top: seedanceHandleTopMap.video || "78%",
            transform: "translate(-100%, -50%)",
          }}
        >
          {isSeedanceModel ? "video (1-3)" : "video"}
        </div>
      )}
      {hover === "audio-in" && (
        <div
          className='flow-tooltip'
          style={{
            left: -8,
            top: isSeedanceModel ? seedanceHandleTopMap.audio || "78%" : "78%",
            transform: "translate(-100%, -50%)",
          }}
        >
          {isSeedanceModel ? "audio (1-3, <=5s)" : "audio"}
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
          <span>
            {displayTitle}
            <RunCreditBadge credits={selectedCredits} inline />
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {/* 鐜╂硶璇存槑鎸夐挳: 浠?Kling 2.6/3.0 鑺傜偣鏄剧ず */}
          {isKling26Model && (
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
              title={lt("鐜╂硶璇存槑", "Help")}
            >
              <HelpCircle size={14} />
            </button>
          )}
          <button
            className="tanva-video-header-btn tanva-video-header-run"
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
              <span style={{ fontSize: 10, fontWeight: 600, color: "#111827" }}>
                下载中
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

      {/* 使用说明 */}
      {isKling26Model && showHelp && (
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
            {lt("玩法说明", "Usage Guide")} {klingModel === "kling-v2-6" ? "(Kling 2.6)" : klingModel === "kling-v3-0" ? "(Kling 3.0)" : ""}
          </div>
          {klingModel === "kling-v2-6" ? (
            <>
              <div style={{ marginBottom: 3 }}>
                <strong>{lt("标准模式（Std）", "Standard (Std)")}:</strong>{" "}
                {lt("1 张图生成视频（无音效）", "1 image -> video (no sound)")}
              </div>
              <div style={{ marginBottom: 3 }}>
                <strong>{lt("专业模式（Pro）", "Professional (Pro)")}:</strong>{" "}
                {lt("1 张图生成视频（有音效）", "1 image -> video (with sound)")}
              </div>
              <div style={{ marginBottom: 3 }}>
                <strong>{lt("首尾帧（Pro）", "Start-End (Pro)")}:</strong>{" "}
                {lt("2 张图（首帧+尾帧）生成视频（有音效）", "2 images (start+end) -> video (with sound)")}
              </div>
              <div style={{ color: "#6b7280", fontSize: 10, marginTop: 4 }}>
                提示：{lt("Std 仅支持 1 张图，Pro 支持 1-2 张图（首尾帧）", "Tip: Std mode = 1 image, Pro mode = 1 or 2 images (start-end)")}
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 3 }}>
                <strong>{lt("标准模式（Std）", "Standard (Std)")}:</strong>{" "}
                {lt("1 张图生成视频", "1 image -> video")}
              </div>
              <div style={{ marginBottom: 3 }}>
                <strong>{lt("专业模式（Pro）", "Professional (Pro)")}:</strong>{" "}
                {lt("1 张图生成视频（有音效），2 张图支持首尾帧", "1 image -> video (with sound), 2 images -> start-end")}
              </div>
              <div style={{ color: "#6b7280", fontSize: 10, marginTop: 4 }}>
                提示：{lt("Kling 3.0 已全面升级，推荐优先使用", "Kling 3.0 is fully upgraded, recommended")}{" "}
                <span style={{ color: "#059669", fontWeight: 600 }}>{lt("★ Pro 模式效果更佳", "★ Pro mode recommended")}</span>
              </div>
            </>
          )}
        </div>
      )}

      {isVodManagedNode && (
        <div
          style={{
            display: "none",
            marginBottom: 8,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #dbeafe",
            background: "#f8fbff",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1d4ed8" }}>
            {vodConfig?.label || lt("VOD 视频生成节点", "VOD video generation node")}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
            {Array.isArray(vodConfig?.outputConfig?.resolutions) && vodConfig.outputConfig.resolutions.length > 0 ? `Resolution: ${vodConfig.outputConfig.resolutions.join("/")}` : null}
            {Array.isArray(vodConfig?.outputConfig?.durations) && vodConfig.outputConfig.durations.length > 0 ? `  |  Duration: ${Math.min(...vodConfig.outputConfig.durations)}-${Math.max(...vodConfig.outputConfig.durations)}s` : null}
          </div>
          {vodInputModeLabel ? (
            <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
              {lt("支持输入", "Supported input")}: {vodInputModeLabel}
            </div>
          ) : null}
          {Array.isArray(vodConfig?.notes) && vodConfig.notes.length > 0 ? (
            <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
              {vodConfig.notes[0]}
            </div>
          ) : null}
        </div>
      )}

      {/* 妯″瀷閫夋嫨 */}
      {(isUnifiedKlingNode || provider === "vidu" || provider === "viduq3-pro" || provider === "doubao") && (
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
            <span>
              {isUnifiedKlingNode
                ? klingModelLabel
                : provider === "doubao"
                ? filteredSeedanceModelOptions.find((opt) => opt.value === seedanceModel)?.label || "Seedance 1.5-Pro"
                : filteredViduModelOptions.find((opt) => opt.value === viduModelSelectionValue)?.label ||
                  "Vidu Q2"}
            </span>
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
                {(isUnifiedKlingNode
                  ? filteredKlingModelOptions
                  : provider === "doubao"
                  ? filteredSeedanceModelOptions
                  : filteredViduModelOptions).map((opt) => {
                  return (
                    <button
                      key={opt.value}
                      type='button'
                      onClick={() => {
                        if (isUnifiedKlingNode) {
                          handleKlingModelChange(opt.value as "kling-v2-6" | "kling-v3-0");
                        } else if (provider === "doubao") {
                          handleSeedanceModelChange(opt.value as SeedanceModel);
                        } else {
                          handleViduModelChange(opt.value as ViduModel);
                        }
                        setModelMenuOpen(false);
                      }}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${
                          (isUnifiedKlingNode
                            ? klingModel
                            : provider === "doubao"
                            ? seedanceModel
                            : viduModelSelectionValue) === opt.value
                            ? "#2563eb"
                            : "#e5e7eb"
                        }`,
                        background:
                          (isUnifiedKlingNode
                            ? klingModel
                            : provider === "doubao"
                            ? seedanceModel
                            : viduModelSelectionValue) === opt.value
                            ? "#eff6ff"
                            : "#fff",
                        color:
                          (isUnifiedKlingNode
                            ? klingModel
                            : provider === "doubao"
                            ? seedanceModel
                            : viduModelSelectionValue) === opt.value
                            ? "#1d4ed8"
                            : "#111827",
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

      {isSeedanceModel && (
        <div
          className='video-dropdown'
          style={{ marginBottom: 8, position: "relative" }}
        >
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("模式", "Mode")}
          </div>
          <NodeSelect
            value={seedanceMode}
            options={seedanceModeOptions}
            onChange={(value) => handleSeedanceModeChange(value as SeedanceMode)}
            menuLabel={
              isSeedance20Model
                ? lt("Seedance 2.0 模式", "Seedance 2.0 modes")
                : lt("Seedance 1.5 模式", "Seedance 1.5 modes")
            }
            title={
              isSeedance20Model
                ? lt("选择 Seedance 2.0 模式", "Select Seedance 2.0 mode")
                : lt("选择 Seedance 1.5 模式", "Select Seedance 1.5 mode")
            }
          />
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
          {lt("时长", "Duration")}
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

      {shouldShowSeedanceGenerateAudio && (
        <div style={{ marginBottom: 8 }}>
          <button
            type='button'
            onClick={() => {
              const currentGenerateAudio = Boolean((data as any).generateAudio);
              window.dispatchEvent(
                new CustomEvent("flow:updateNodeData", {
                  detail: { id, patch: { generateAudio: !currentGenerateAudio } },
                })
              );
            }}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: (data as any).generateAudio ? "#111827" : "#fff",
              color: (data as any).generateAudio ? "#fff" : "#111827",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {lt("关闭", "Off")}
          </button>
        </div>
      )}

      {/* Kling 涓撶敤鍙傛暟锛氭ā寮忛€夋嫨 */}
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

      {(provider === "vidu" || provider === "viduq3-pro") && isViduQ2FamilyModel && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("模式", "Mode")}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: lt("标准", "Standard"), value: "std" as const },
              { label: lt("专业", "Pro"), value: "pro" as const },
            ].map((opt) => {
              const isActive = (isViduQ2ProMode ? "pro" : "std") === opt.value;
              return (
                <button
                  key={opt.value}
                  type='button'
                  onClick={() => handleViduQ2ModeChange(opt.value)}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
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

      {(provider === "vidu" || provider === "viduq3-pro") &&
        isCurrentViduQ3FamilyModel &&
        !isViduQ3TurboModel && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              {lt("模式", "Mode")}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { label: lt("标准", "Standard"), value: "std" as const },
                { label: lt("专业", "Pro"), value: "pro" as const },
              ].map((opt) => {
                const isActive = (isViduQ3ProMode ? "pro" : "std") === opt.value;
                return (
                  <button
                    key={opt.value}
                    type='button'
                    onClick={() => handleViduQ3ModeChange(opt.value)}
                    style={{
                      flex: 1,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
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

      {false && isKling26Model && (
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
              <span>{lt("闊抽鏂囦欢锛堟渶澶?2 涓級", "Audio files (max 2)")}</span>
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
                ? lt("涓婁紶涓?..", "Uploading...")
                : audioUrls.length > 0
                ? lt("缁х画涓婁紶", "Upload more")
                : lt("涓婁紶闊抽", "Upload audio")}
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
                      {lt("闊抽", "Audio")} {index + 1}
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
                      {lt("绉婚櫎", "Remove")}
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

      {shouldShowResolutionSelector && (
        <div
          className='video-dropdown'
          style={{ marginBottom: 8, position: "relative" }}
        >
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("分辨率", "Resolution")}
          </div>
          <NodeSelect
            value={String(data.resolution || resolutionOptions[0] || "720P").toUpperCase()}
            options={resolutionOptions.map((option) => {
              const normalizedOption = String(option).toUpperCase();
              return {
                value: normalizedOption,
                label: normalizedOption,
              };
            })}
            onChange={(value) =>
              window.dispatchEvent(
                new CustomEvent("flow:updateNodeData", {
                  detail: { id, patch: { resolution: value } },
                })
              )
            }
            menuLabel={lt("分辨率", "Resolution")}
            title={lt("选择分辨率", "Select resolution")}
          />
        </div>
      )}

      {/* Vidu 鏃ч摼璺笓鐢ㄥ弬鏁?*/}
      {shouldShowLegacyViduOptions && (
        <>
          <div
            className='video-dropdown'
            style={{ marginBottom: 8, position: "relative" }}
          >
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              {lt("分辨率", "Resolution")}
            </div>
            <NodeSelect
              value={(data as any).resolution || "720p"}
              options={["540p", "720p", "1080p"].map((option) => ({
                value: option,
                label: option,
              }))}
              onChange={(value) =>
                window.dispatchEvent(
                  new CustomEvent("flow:updateNodeData", {
                    detail: {
                      id,
                      patch: { resolution: value },
                    },
                  })
                )
              }
              menuLabel={lt("分辨率", "Resolution")}
              title={lt("选择分辨率", "Select resolution")}
            />
          </div>
          {isViduQ2FamilyModel && !isViduQ2ProMode && (
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
              {lt("椋庢牸", "Style")}: {(data as any).style === "anime" ? lt("鍔ㄦ极", "Anime") : lt("閫氱敤", "General")}
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
              {lt("关闭", "Off")}
            </button>
            </div>
          )}
        </>
      )}

      {/* Seedance 鏃ч摼璺笓鐢ㄥ弬鏁?*/}
      {shouldShowLegacySeedanceOptions && (
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
            {lt("闀滃ご", "Camera")}: {(data as any).camerafixed ? lt("鍥哄畾", "Fixed") : lt("杩愬姩", "Dynamic")}
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
            {lt("关闭", "Off")}
          </button>
        </div>
      )}

      {isSeedanceModel && seedanceConstraintTips.length > 0 && (
        <div
          style={{
            marginBottom: 8,
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
            color: "#475569",
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          {seedanceConstraintTips.map((tip, index) => (
            <div key={`${tip}-${index}`}>• {tip}</div>
          ))}
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
            // 浣跨敤缁勫悎 key 纭繚鍞竴鎬э細id + index
            const uniqueKey = `${item.id}-${index}`;

            // 浠?URL 涓彁鍙栬棰?ID 浣滀负鍞竴鏍囪瘑
            const videoId = item.videoUrl?.split('/').pop()?.split('?')[0]?.slice(-12) || '';

            return (
              <div
                className="tanva-video-history-item"
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
                    #{index + 1} 路 {formatHistoryTime(item.createdAt)}
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
                    {lt("涓嬭浇", "Download")}
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
          <span>鈩癸笍</span>
          <span>{data.fallbackMessage}</span>
        </div>
      )}
    </div>
  );
}

export default React.memo(GenericVideoNodeInner);





