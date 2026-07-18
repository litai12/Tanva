import React from "react";

// Module-level registry so the same (url, version) pair always gets the same _ts.
// Prevents remount of GenericVideoNode (or useMemo re-run) from producing a new
// cache-busting URL, which would change the <video key> and force a full reload.
const _videoTimestampRegistry = new Map<string, number>();
function getStableVideoTimestamp(url: string, version: number): number {
  const k = `${url}::${version}`;
  let ts = _videoTimestampRegistry.get(k);
  if (ts === undefined) {
    ts = Date.now();
    _videoTimestampRegistry.set(k, ts);
  }
  return ts;
}
import { Handle, Position, useReactFlow, useStore, useUpdateNodeInternals } from "reactflow";
import { AlertTriangle, Video, Share2, Download, HelpCircle, Square } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { useAuthStore } from "@/stores/authStore";
import { uploadAudioToOSS } from "@/stores/aiChatStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";
import RunCreditBadge from "./RunCreditBadge";
import NodeSelect from "./NodeSelect";
import { useBackendCreditsPreview } from "../hooks/useBackendCreditsPreview";
import {
  buildViduRequestSemantics,
  normalizeViduModelForApi,
  normalizeViduModelValue,
  type ViduModelValue,
} from "@/services/videoProviderParams";
import {
  getManagedRouteCredits,
  getManagedRouteOption,
  getManagedRoutesMetadata,
  resolveManagedRoutePricing,
  resolveSeedance20DiscountCredits,
  sanitizeVideoManagedRoutes,
  sanitizeVideoVendorKey,
} from "../managedRoutePricing";

export type VideoProvider = "kling" | "kling-2.6" | "kling-o3" | "vidu" | "viduq3-pro" | "doubao";
type ViduModel = ViduModelValue;
type SeedanceModel =
  | "seedance-1.5-pro"
  | "seedance-2.0"
  | "seedance-2.0-fast"
  | "seed-2.0-pro"
  | "seed-2.0-lite"
  | "seed-2.0-mini";
type Seedance20Mode = "reference_images" | "start_end" | "first_frame" | "smart_frames";
type Seedance15Mode = "text" | "image" | "start_end";
type SeedanceMode = Seedance20Mode | Seedance15Mode;
type SeedFamily = "seedance" | "seed2";
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
    progressStartedAt?: number | string | null;
    videoUrl?: string;
    thumbnail?: string;
    error?: string;
    videoVersion?: number;
    onRun?: (id: string) => void;
    onStop?: (id: string) => void;
    onSend?: (id: string) => void;
    creditsPerCall?: number;
    managedModelKey?: string;
    vendorKey?: string;
    platformKey?: string;
    channelTier?: "default" | "vip";
    channelSelectionExplicit?: boolean;
    provider: VideoProvider;
    clipDuration?: number;
    aspectRatio?: string;
    klingModel?: "kling-v2-1" | "kling-v2-6" | "kling-v3-0";
    viduModel?: ViduModel;
    seedanceModel?: SeedanceModel;
    seedFamily?: SeedFamily;
    seedanceMode?: SeedanceMode;
    mode?: "std" | "pro";
    sound?: boolean | string;
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
    seedance2AccessEnabled?: boolean;
    seedance2AccessResolved?: boolean;
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

type ConnectionStats = {
  hasImageInput: boolean;
  imageInputCount: number;
  hasImage2Input: boolean;
  hasVideoInput: boolean;
  audioInputCount: number;
};

const EMPTY_CONNECTION_STATS: ConnectionStats = {
  hasImageInput: false,
  imageInputCount: 0,
  hasImage2Input: false,
  hasVideoInput: false,
  audioInputCount: 0,
};

const areConnectionStatsEqual = (
  a: ConnectionStats,
  b: ConnectionStats
): boolean =>
  a.hasImageInput === b.hasImageInput &&
  a.imageInputCount === b.imageInputCount &&
  a.hasImage2Input === b.hasImage2Input &&
  a.hasVideoInput === b.hasVideoInput &&
  a.audioInputCount === b.audioInputCount;

const PROVIDER_CONFIG: Record<VideoProvider, { name: string; zh: string }> = {
  kling: { name: "Kling", zh: "Kling" },
  "kling-2.6": { name: "Kling 2.6", zh: "Kling 2.6" },
  "kling-o3": { name: "Kling O3", zh: "Kling O3" },
  vidu: { name: "Vidu", zh: "Vidu" },
  "viduq3-pro": { name: "Vidu Q3", zh: "Vidu Q3" },
  doubao: { name: "Seedance", zh: "Seedance" },
};

const resolveVideoServiceType = (
  provider: VideoProvider,
  data: Props["data"]
): string => {
  const klingModel = String(data.klingModel || "").trim().toLowerCase();
  if (
    (provider === "kling" || provider === "kling-2.6" || provider === "kling-o3") &&
    klingModel === "kling-v3-0"
  ) {
    return "kling-3.0-video";
  }
  if ((provider === "kling" || provider === "kling-2.6") && (!klingModel || klingModel === "kling-v2-6")) {
    return "kling-2.6-video";
  }
  return `${provider}-video`;
};

const resolvePreviewVideoBillingModel = (
  provider: VideoProvider,
  data: Props["data"],
  viduModelVariant?: ViduModel
): string => {
  if (provider === "vidu" || provider === "viduq3-pro") {
    return viduModelVariant || data.viduModel || provider;
  }
  if (provider === "doubao") {
    return data.seedanceModel || provider;
  }
  return data.klingModel || provider;
};

const stripVideoGenerationSuffix = (value: string): string =>
  value
    .replace(/\s*视频生成\s*/g, " ")
    .replace(/\s*瑙嗛鐢熸垚\s*/g, " ")
    .replace(/\s*video generation\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const isViduQ3FamilyModel = (value?: string): boolean =>
  normalizeViduModelForApi(value) === "q3";

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
const SEEDANCE20_DOC_RESOLUTIONS = ["480P", "720P", "1080P"] as const;
const SEEDANCE15_DOC_RESOLUTIONS = ["720P", "1080P"] as const;
// Only the base seedance-2.0 upstream exposes 4K; seed-2.0-pro stays on 480P/720P/1080P.
const SEEDANCE20_BASE_DOC_RESOLUTIONS = ["480P", "720P", "1080P", "4K"] as const;
const SEED20_LITE_DOC_RESOLUTIONS = ["480P", "720P"] as const;
const SEED20_MINI_DOC_RESOLUTIONS = ["480P", "720P"] as const;

const SEED20_MINI_SUPPORTED_MODES: Seedance20Mode[] = [
  "reference_images",
  "start_end",
  "first_frame",
];

const SEED2_INPUT_TIER_OPTIONS: Array<{
  value: "le32k" | "gt32k_le128k" | "gt128k_le256k";
  label: string;
}> = [
  { value: "le32k", label: "输入小于<=32K" },
  { value: "gt32k_le128k", label: "32K<输入<=128K" },
  { value: "gt128k_le256k", label: "128K<输入<=256K" },
];

const SEEDANCE20_MODE_VALUES: Seedance20Mode[] = [
  "reference_images",
  "start_end",
  "first_frame",
  "smart_frames",
];
const SEEDANCE15_MODE_VALUES: Seedance15Mode[] = ["text", "image", "start_end"];

const normalizeSeedanceModelValue = (value: unknown): SeedanceModel => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "seed-2.0-pro" ||
    normalized === "seedance-2.0-pro" ||
    normalized === "seed-2-0-pro" ||
    normalized === "2.0-pro"
  ) {
    return "seed-2.0-pro";
  }
  if (
    normalized === "seed-2.0-lite" ||
    normalized === "seedance-2.0-lite" ||
    normalized === "seed-2-0-lite" ||
    normalized === "2.0-lite"
  ) {
    return "seed-2.0-lite";
  }
  if (
    normalized === "seed-2.0-mini" ||
    normalized === "seedance-2.0-mini" ||
    normalized === "seed-2-0-mini" ||
    normalized === "2.0-mini"
  ) {
    return "seed-2.0-mini";
  }
  if (
    normalized === "seedance-2.0-fast" ||
    normalized === "seed-2.0-fast" ||
    normalized === "2.0-fast"
  ) {
    return "seedance-2.0-fast";
  }
  if (normalized === "seedance-2.0" || normalized === "2.0") {
    return "seedance-2.0";
  }
  return "seedance-1.5-pro";
};

const isSeedance20ModelValue = (value: unknown): boolean => {
  const normalized = normalizeSeedanceModelValue(value);
  return normalized !== "seedance-1.5-pro";
};

const isSeedance20ModeValue = (value: unknown): value is Seedance20Mode =>
  typeof value === "string" && SEEDANCE20_MODE_VALUES.includes(value as Seedance20Mode);
const isSeedance15ModeValue = (value: unknown): value is Seedance15Mode =>
  typeof value === "string" && SEEDANCE15_MODE_VALUES.includes(value as Seedance15Mode);

const getSeedance20SupportedModes = (model: SeedanceModel): Seedance20Mode[] =>
  model === "seed-2.0-mini" ? SEED20_MINI_SUPPORTED_MODES : SEEDANCE20_MODE_VALUES;

const getSeedance20ResolutionList = (model: SeedanceModel): string[] => {
  if (model === "seed-2.0-lite") return [...SEED20_LITE_DOC_RESOLUTIONS];
  if (model === "seed-2.0-mini") return [...SEED20_MINI_DOC_RESOLUTIONS];
  // Seedance 2.0 Fast shares the doubao-seedance-2-0-fast upstream (480P/720P,
  // no 1080P) — same as Lite/Mini.
  if (model === "seedance-2.0-fast") return [...SEED20_LITE_DOC_RESOLUTIONS];
  if (model === "seedance-2.0") return [...SEEDANCE20_BASE_DOC_RESOLUTIONS];
  return [...SEEDANCE20_DOC_RESOLUTIONS];
};

type SeedanceModeSpec = {
  visibleHandles: Array<"text" | "image" | "image-2" | "video" | "audio">;
  imageHandleMax: number;
  image2HandleMax: number;
  videoHandleMax: number;
  audioHandleMax: number;
};

const getSeedance20ModeSpec = (mode: Seedance20Mode): SeedanceModeSpec => {
  switch (mode) {
    case "first_frame":
      return {
        visibleHandles: ["text", "image"],
        imageHandleMax: 1,
        image2HandleMax: 0,
        videoHandleMax: 0,
        audioHandleMax: 0,
      };
    case "start_end":
      return {
        visibleHandles: ["text", "image"],
        imageHandleMax: 2,
        image2HandleMax: 0,
        videoHandleMax: 0,
        audioHandleMax: 0,
      };
    case "smart_frames":
      return {
        visibleHandles: ["text", "image"],
        imageHandleMax: 10,
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

  const {
    hasImageInput,
    imageInputCount,
    hasImage2Input,
    hasVideoInput,
    audioInputCount,
  } = useStore(
    React.useCallback((state): ConnectionStats => {
      const edges = Array.isArray(state?.edges) ? state.edges : [];
      if (edges.length === 0) return EMPTY_CONNECTION_STATS;

      let nextImageInputCount = 0;
      let nextHasImage2Input = false;
      let nextHasVideoInput = false;
      let nextAudioInputCount = 0;

      for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i];
        if (edge.target !== id) continue;
        const targetHandle = edge.targetHandle;
        if (targetHandle === "image" || targetHandle === "image-2") {
          nextImageInputCount += 1;
          if (targetHandle === "image-2") nextHasImage2Input = true;
          continue;
        }
        if (targetHandle === "video") {
          nextHasVideoInput = true;
          continue;
        }
        if (targetHandle === "audio") {
          nextAudioInputCount += 1;
        }
      }

      if (
        nextImageInputCount === 0 &&
        !nextHasImage2Input &&
        !nextHasVideoInput &&
        nextAudioInputCount === 0
      ) {
        return EMPTY_CONNECTION_STATS;
      }

      return {
        hasImageInput: nextImageInputCount > 0,
        imageInputCount: nextImageInputCount,
        hasImage2Input: nextHasImage2Input,
        hasVideoInput: nextHasVideoInput,
        audioInputCount: nextAudioInputCount,
      };
    }, [id]),
    areConnectionStatsEqual
  );
  const provider = data.provider || "kling";
  const rawNodeConfigMetadata =
    data.nodeConfigMetadata && typeof data.nodeConfigMetadata === "object"
      ? (data.nodeConfigMetadata as Record<string, any>)
      : {};
  // 保留用户选择的普通/尊享通道；后端据此选择对应的 new-api 令牌。
  const nodeConfigMetadata = React.useMemo(
    () => sanitizeVideoManagedRoutes(rawNodeConfigMetadata),
    [rawNodeConfigMetadata]
  );
  const sanitizedVendorKey = React.useMemo(
    () =>
      data.channelSelectionExplicit === true &&
      (data.channelTier === "vip" || data.channelTier === "default")
        ? sanitizeVideoVendorKey(data.vendorKey)
        : undefined,
    [data.channelSelectionExplicit, data.channelTier, data.vendorKey]
  );
  const managedRoutesMetadata = React.useMemo(
    () => getManagedRoutesMetadata(nodeConfigMetadata),
    [nodeConfigMetadata]
  );
  const selectedManagedRoute = React.useMemo(
    () => getManagedRouteOption(nodeConfigMetadata, sanitizedVendorKey),
    [sanitizedVendorKey, nodeConfigMetadata]
  );
  const vodConfig =
    nodeConfigMetadata.vod && typeof nodeConfigMetadata.vod === "object"
      ? (nodeConfigMetadata.vod as VodCapabilityMetadata)
      : undefined;
  const isVodManagedNode = Boolean(vodConfig);
  const viduModel: ViduModel = normalizeViduModelValue(
    data.viduModel || (provider === "viduq3-pro" ? "q3" : "q2")
  );
  const seedanceModel: SeedanceModel = normalizeSeedanceModelValue(data.seedanceModel);
  const isSeedanceModel = provider === "doubao";
  const seedFamily: SeedFamily =
    (typeof data.seedFamily === "string" && data.seedFamily.trim().toLowerCase() === "seed2") ||
    data.nodeConfigKey === "seedVideo"
      ? "seed2"
      : "seedance";
  const isSeed2FamilyNode = isSeedanceModel && seedFamily === "seed2";
  const seedance2AccessEnabled = data.seedance2AccessEnabled === true;
  const seedance2AccessResolved = data.seedance2AccessResolved === true;
  const seedance20AvailableForCurrentUser =
    isSeedanceModel && seedance2AccessResolved && seedance2AccessEnabled;
  const seedance20RestrictedForCurrentUser =
    isSeedanceModel && seedance2AccessResolved && !seedance2AccessEnabled;
  const isSeedance20LockedOption = React.useCallback(
    (value: SeedanceModel): boolean =>
      seedance20RestrictedForCurrentUser && isSeedance20ModelValue(value),
    [seedance20RestrictedForCurrentUser]
  );
  const isSeedance20Model = isSeedanceModel && isSeedance20ModelValue(seedanceModel);
  const seedance20SupportedModes = React.useMemo(
    () => getSeedance20SupportedModes(seedanceModel),
    [seedanceModel]
  );
  const seedanceGenerateAudio =
    isSeedance20Model && typeof data.generateAudio === "boolean"
      ? data.generateAudio
      : isSeedance20Model;
  const inferredSeedanceMode = React.useMemo<SeedanceMode>(() => {
    if (!isSeedanceModel) return "text";
    if (isSeedance20Model) {
      if (
        isSeedance20ModeValue(data.seedanceMode) &&
        seedance20SupportedModes.includes(data.seedanceMode)
      ) {
        return data.seedanceMode;
      }
      const legacyMode = String(data.seedanceMode || "").trim().toLowerCase();
      if (legacyMode === "start_end") return "start_end";
      if (legacyMode === "first_frame") return "first_frame";
      if (legacyMode === "smart_frames" && seedance20SupportedModes.includes("smart_frames")) {
        return "smart_frames";
      }
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
    seedance20SupportedModes,
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
    (provider === "kling-o3" ? "kling-v3-0" : "kling-v2-6");
  const isKlingModel26Or30 =
    klingModel === "kling-v2-6" || klingModel === "kling-v3-0";
  const isUnifiedKlingNode =
    provider === "kling" ||
    provider === "kling-2.6" ||
    (provider === "kling-o3" && isKlingModel26Or30);
  const isKling26Model = isUnifiedKlingNode && isKlingModel26Or30;
  const klingSoundEnabled = React.useMemo(() => {
    if (typeof data.sound === "boolean") return data.sound;
    if (typeof data.sound === "string") {
      const normalized = data.sound.trim().toLowerCase();
      if (normalized === "on" || normalized === "true" || normalized === "yes") return true;
      if (normalized === "off" || normalized === "false" || normalized === "no") return false;
    }
    return true;
  }, [data.sound]);
  const isViduNode = provider === "vidu" || provider === "viduq3-pro";
  const viduRequestSemantics = isViduNode
    ? buildViduRequestSemantics({
        rawViduModel: viduModel,
        hasImage2Input,
        imageCount: imageInputCount,
        hasPrompt: false,
      })
    : null;
  const normalizedViduModelVariant = viduRequestSemantics?.viduModelVariant;
  const viduModelForPreview = viduRequestSemantics?.viduModel;
  const isProMode = ((data as any).mode || "std") === "pro";
  // 第二张图(首尾帧/尾帧)句柄：
  //  - Kling v2-6：APIMart 仅在 pro 模式支持首+尾两张图，故沿用 pro-only。
  //  - Kling v3 / O3(omni)：APIMart 的 image_urls / image_with_roles 不限模式，
  //    std 也支持首尾帧，故放开 image-2 句柄。
  const canUseKlingImage2Input =
    isUnifiedKlingNode && (klingModel === "kling-v2-6" ? isProMode : true);

  // 动态显隐句柄(如切到 pro 才出现的 image-2)后，必须通知 React Flow 重算句柄坐标，
  // 否则连到新句柄的连线会画到旧/零坐标——在 Edge 上表现为“专业模式 image-2 连线不显示”
  // (Chrome 靠偶发重绘侥幸正常)。signature 变化即触发 updateNodeInternals。
  const updateNodeInternals = useUpdateNodeInternals();
  const visibleHandleSignature = React.useMemo(
    () =>
      [
        canUseKlingImage2Input ? "k2" : "",
        isViduNode ? "vidu" : "",
        isSeedanceModel ? (seedanceModeSpec?.visibleHandles || []).join(",") : "",
        isUnifiedKlingNode &&
        klingModel !== "kling-v2-6" &&
        klingModel !== "kling-v3-0"
          ? "audio"
          : "",
      ].join("|"),
    [
      canUseKlingImage2Input,
      isViduNode,
      isSeedanceModel,
      seedanceModeSpec,
      isUnifiedKlingNode,
      klingModel,
    ]
  );
  React.useEffect(() => {
    updateNodeInternals(id);
  }, [id, visibleHandleSignature, updateNodeInternals]);
  const previewVideoMode = isViduNode
    ? viduRequestSemantics?.videoMode
    : isSeedanceModel
    ? seedanceMode
    : undefined;
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
  const pricingContext = React.useMemo(() => {
    const context: Record<string, any> = {};
    const duration =
      typeof data.clipDuration === "number" && Number.isFinite(data.clipDuration)
        ? Math.round(data.clipDuration)
        : 5;
    context.duration = duration;
    context.durationSec = duration;

    if (typeof data.resolution === "string" && data.resolution.trim()) {
      context.resolution = data.resolution.trim().toUpperCase();
    } else if (provider === "vidu" || provider === "viduq3-pro" || provider === "doubao") {
      context.resolution = "720P";
    }

    if (typeof data.aspectRatio === "string" && data.aspectRatio.trim()) {
      context.aspectRatio = data.aspectRatio.trim();
    } else if (provider === "vidu" || provider === "viduq3-pro") {
      context.aspectRatio = "16:9";
    }

    if (typeof (data as any).mode === "string" && String((data as any).mode).trim()) {
      context.mode = String((data as any).mode).trim().toLowerCase();
    } else if (isUnifiedKlingNode) {
      context.mode = "std";
    }

    if (isUnifiedKlingNode || typeof data.sound !== "undefined") {
      context.sound = klingSoundEnabled;
    }
    if (typeof data.generateAudio !== "undefined") {
      context.generateAudio = Boolean(data.generateAudio);
    }
    if (typeof data.watermark !== "undefined") {
      context.watermark = Boolean(data.watermark);
    }
    if (typeof data.seedanceModel === "string" && data.seedanceModel.trim()) {
      context.seedanceModel = data.seedanceModel.trim().toLowerCase();
    }
    const seed2InputTierRaw =
      typeof (data as any).seed2InputTier === "string"
        ? String((data as any).seed2InputTier).trim().toLowerCase()
        : "";
    if (
      seed2InputTierRaw === "le32k" ||
      seed2InputTierRaw === "gt32k_le128k" ||
      seed2InputTierRaw === "gt128k_le256k"
    ) {
      context.seed2InputTier = seed2InputTierRaw;
    }
    if (viduModelForPreview) {
      context.viduModel = viduModelForPreview;
    }
    if (normalizedViduModelVariant) {
      context.viduModelVariant = normalizedViduModelVariant;
    }
    if (typeof data.klingModel === "string" && data.klingModel.trim()) {
      context.klingModel = data.klingModel.trim().toLowerCase();
    }
    if (typeof (data as any).offPeak === "boolean") {
      context.offPeak = Boolean((data as any).offPeak);
    }
    context.referenceVideo = hasVideoInput;
    context.hasVideoInput = hasVideoInput;
    if (
      typeof (data as any).referenceVideoType === "string" &&
      String((data as any).referenceVideoType).trim()
    ) {
      context.referenceVideoType = String((data as any).referenceVideoType)
        .trim()
        .toLowerCase();
    }
    if (previewVideoMode) {
      context.videoMode = previewVideoMode;
      context.generationMode = previewVideoMode;
    }
    if (typeof data.seedanceMode === "string" && data.seedanceMode.trim()) {
      context.seedanceMode = data.seedanceMode.trim().toLowerCase();
    } else if (isSeedanceModel) {
      context.seedanceMode = seedanceMode;
    }
    if (isViduNode || isSeedanceModel || provider === "kling-o3") {
      context.inputType = hasVideoInput
        ? "video"
        : imageInputCount > 0
        ? audioInputCount > 0 && isSeedanceModel
          ? "image_audio"
          : "image"
        : "text";
    }
    return context;
  }, [
    audioInputCount,
    data.aspectRatio,
    data.clipDuration,
    data.generateAudio,
    hasImage2Input,
    data.klingModel,
    (data as any).offPeak,
    (data as any).referenceVideoType,
    data.resolution,
    data.seedanceMode,
    data.seedanceModel,
    data.sound,
    data.viduModel,
    data.watermark,
    hasVideoInput,
    imageInputCount,
    isSeedanceModel,
    isViduNode,
    normalizedViduModelVariant,
    previewVideoMode,
    seedanceMode,
    provider,
    viduModelForPreview,
    isUnifiedKlingNode,
    klingSoundEnabled,
    (data as any).mode,
  ]);
  const resolvedManagedPricing = React.useMemo(
    () => resolveManagedRoutePricing(nodeConfigMetadata, sanitizedVendorKey, pricingContext),
    [sanitizedVendorKey, nodeConfigMetadata, pricingContext]
  );
  const seedance20DiscountCredits = React.useMemo(
    () => resolveSeedance20DiscountCredits(pricingContext),
    [pricingContext]
  );
  const previewRequestParams = React.useMemo(
    () => ({
      ...pricingContext,
      aiProvider: data.provider,
      managedModelKey: data.managedModelKey,
      modelKey: data.managedModelKey,
      // Resolved route is already Tencent-free (sanitized) — never preview/send tencent_vod.
      vendorKey: selectedManagedRoute?.vendorKey ?? sanitizedVendorKey,
      platformKey: selectedManagedRoute?.platformKey ?? selectedManagedRoute?.vendorKey,
      route: selectedManagedRoute?.route,
      providerChannel:
        selectedManagedRoute?.platformKey ?? selectedManagedRoute?.vendorKey,
      routedProvider: selectedManagedRoute?.provider || data.provider,
      klingModel: data.klingModel,
      viduModel: viduModelForPreview,
      viduModelVariant: normalizedViduModelVariant,
      seedanceModel: data.seedanceModel,
      seed2InputTier: (data as any).seed2InputTier,
      // duration/durationSec 由 pricingContext 提供（clipDuration 未设置时默认 5s），
      // 不再用 undefined 覆盖，确保 Kling 等节点能正确进行按秒动态定价
      ...(typeof data.clipDuration === "number" && Number.isFinite(data.clipDuration)
        ? {
            duration: Math.round(data.clipDuration),
            durationSec: Math.round(data.clipDuration),
          }
        : {}),
      resolution:
        typeof data.resolution === "string" && data.resolution.trim()
          ? data.resolution.trim().toUpperCase()
          : undefined,
      aspectRatio: data.aspectRatio,
      videoMode: previewVideoMode,
      generationMode: previewVideoMode,
      generateAudio: data.generateAudio,
      watermark: data.watermark,
      offPeak: data.offPeak,
      referenceImageCount: imageInputCount,
      referenceVideoCount: hasVideoInput ? 1 : 0,
      audioInputCount,
      referenceVideoType: (data as any).referenceVideoType,
    }),
    [
      audioInputCount,
      data.aspectRatio,
      data.clipDuration,
      data.generateAudio,
      data.klingModel,
      data.managedModelKey,
      data.offPeak,
      data.provider,
      data.resolution,
    data.seedanceModel,
    (data as any).seed2InputTier,
      sanitizedVendorKey,
      data.watermark,
      hasVideoInput,
      imageInputCount,
      normalizedViduModelVariant,
      pricingContext,
      previewVideoMode,
      selectedManagedRoute?.vendorKey,
      selectedManagedRoute?.platformKey,
      selectedManagedRoute?.provider,
      selectedManagedRoute?.route,
      viduModelForPreview,
    ]
  );
  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: resolveVideoServiceType(data.provider, data),
    model: resolvePreviewVideoBillingModel(provider, data, normalizedViduModelVariant),
    requestParams: previewRequestParams,
    enabled: true,
  });
  const selectedCredits =
    typeof seedance20DiscountCredits === "number"
      ? seedance20DiscountCredits
      : typeof backendCredits === "number"
      ? backendCredits
      : typeof resolvedManagedPricing?.credits === "number"
      ? resolvedManagedPricing.credits
      : typeof data.creditsPerCall === "number" && !managedRoutesMetadata
      ? data.creditsPerCall
      : getManagedRouteCredits(nodeConfigMetadata, sanitizedVendorKey);
  const hasRunCredits = typeof selectedCredits === "number" && selectedCredits > 0;
  const showRunCredits = hasRunCredits && !isSeed2FamilyNode;
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
    // presigned 链接（含 X-Amz / X-Tos 签名字段）不加 cache-bust，否则签名失效
    const isPresigned =
      /[?&](?:X-Amz|X-Tos)[^=]*=/i.test(sanitizedVideoUrl) ||
      /x-amz-|x-tos-/i.test(sanitizedVideoUrl);
    if (isPresigned) return sanitizedVideoUrl;
    const version = Number(data.videoVersion || 0);
    const separator = sanitizedVideoUrl.includes("?") ? "&" : "?";
    // Stable timestamp: same url+version always gets the same _ts across re-renders
    // and re-mounts, keeping <video key> stable and preventing unnecessary reloads.
    const ts = getStableVideoTimestamp(sanitizedVideoUrl, version);
    return `${sanitizedVideoUrl}${separator}v=${version}&_ts=${ts}`;
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

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !sanitizedVideoUrl) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!videoRef.current) return;
        if (entry.isIntersecting) {
          // came back into view — nothing to force-play, let user control
        } else {
          // left viewport — pause to free decoder resources
          if (!videoRef.current.paused) {
            videoRef.current.pause();
          }
        }
      },
      { threshold: 0.01 }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, [sanitizedVideoUrl]);

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
  const onStop = React.useCallback(() => data.onStop?.(id), [data, id]);
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
    if (provider === "kling" || provider === "kling-2.6" || provider === "kling-o3") {
      // Kling 3.0 (kling-v3-0)：APIMart 全场景 3–15s；Kling 2.6 仍为 5/10。
      if (klingModel === "kling-v3-0") {
        return Array.from({ length: 13 }, (_, i) => {
          const value = i + 3;
          return { label: lt(`${value}秒`, `${value}s`), value };
        });
      }
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
      // viduq3 upstream min is 3s (only viduq3-mix allows 1–2s).
      return [
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
        // Seedance 1.5-pro: 4–12s per VolcEngine / apimart spec.
        : [4, 5, 6, 7, 8, 9, 10, 11, 12];
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
      // Seedance 1.5-pro supports the same 6 ratios as 2.0 (incl 21:9/4:3/3:4).
      const ratios = [...SEEDANCE20_DOC_ASPECT_RATIOS];
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
  const seed2ModelOptions = React.useMemo(
    () => [
      { label: "Seed 2.0 Pro", value: "seed-2.0-pro" as const },
      { label: "Seed 2.0 Lite", value: "seed-2.0-lite" as const },
      { label: "Seed 2.0 Mini", value: "seed-2.0-mini" as const },
    ],
    []
  );
  const availableSeedModelOptions = React.useMemo(
    () => (isSeed2FamilyNode ? seed2ModelOptions : seedanceModelOptions),
    [isSeed2FamilyNode, seed2ModelOptions, seedanceModelOptions]
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
      if (seedance20AvailableForCurrentUser || seedance20RestrictedForCurrentUser) {
        return availableSeedModelOptions;
      }
      if (supportedModels.length === 0) return availableSeedModelOptions;
      const normalized = new Set(
        supportedModels.map((item) => String(item).trim().toLowerCase())
      );
      // 2.0 与 Seed 2.0 系列属于同一模型族，任一可用时都展示，方便切换。
      if (
        normalized.has("seedance-2.0") ||
        normalized.has("seed-2.0-pro") ||
        normalized.has("seedance-2.0-pro") ||
        normalized.has("seed-2.0-lite") ||
        normalized.has("seed-2.0-mini") ||
        normalized.has("seedance-2.0-mini") ||
        normalized.has("seedance-2.0-fast")
      ) {
        normalized.add("seedance-2.0");
        normalized.add("seedance-2.0-fast");
        normalized.add("seed-2.0-pro");
        normalized.add("seed-2.0-lite");
        normalized.add("seed-2.0-mini");
      }
      const filtered = availableSeedModelOptions.filter((opt) => normalized.has(opt.value));
      return filtered.length > 0 ? filtered : availableSeedModelOptions;
    },
    [
      seedance20AvailableForCurrentUser,
      seedance20RestrictedForCurrentUser,
      availableSeedModelOptions,
      supportedModels,
    ]
  );
  React.useEffect(() => {
    if (!isSeedanceModel) return;
    if (filteredSeedanceModelOptions.some((opt) => opt.value === seedanceModel)) return;
    const fallbackModel = filteredSeedanceModelOptions[0]?.value;
    if (!fallbackModel) return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            seedanceModel: fallbackModel,
            seedanceMode: isSeedance20ModelValue(fallbackModel)
              ? "reference_images"
              : "text",
            resolution: isSeedance20ModelValue(fallbackModel)
              ? getSeedance20ResolutionList(fallbackModel).includes(
                  String(data.resolution || "").trim().toUpperCase()
                )
                ? data.resolution
                : "720P"
              : "720P",
          },
        },
      })
    );
  }, [data.resolution, filteredSeedanceModelOptions, id, isSeedanceModel, seedanceModel]);
  React.useEffect(() => {
    if (!seedance20RestrictedForCurrentUser || !isSeedance20Model) return;
    // Forced fallback to Seedance 1.5-pro: clamp to its 4–12s range.
    const nextDuration =
      clipDuration && clipDuration >= 4 && clipDuration <= 12 ? clipDuration : 5;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            seedanceModel: "seedance-1.5-pro",
            seedanceMode: "text",
            clipDuration: nextDuration,
          },
        },
      })
    );
  }, [clipDuration, id, isSeedance20Model, seedance20RestrictedForCurrentUser]);
  const durationOptions = React.useMemo(() => {
    if (provider === "doubao" && isSeedance20Model) {
      const durationList =
        seedanceModel === "seed-2.0-mini"
          ? SEEDANCE20_DOC_DURATIONS.filter((value) => value <= 10)
          : [...SEEDANCE20_DOC_DURATIONS];
      return durationList.map((value) => ({
        label: lt(`${value}秒`, `${value}s`),
        value,
      }));
    }
    // Vidu Q2/Q3 share one VOD node, but their valid durations differ (Q2: 1–8s,
    // Q3: 3–16s). A single shared vodConfig list can't express both, so use the
    // model-aware getDurationOptions() instead — otherwise a stale DB config (e.g.
    // [1..16]) would offer 1s/2s which viduq3 upstream rejects.
    if (isViduNode) {
      return getDurationOptions();
    }
    // Kling 2.6/3.0 共用一个节点但时长不同（2.6:5/10、3.0:3–15）。与 Vidu 同理，
    // 单一 vodConfig 无法表达两套，改用 model-aware getDurationOptions()，否则切到
    // 3.0 仍会被 vodConfig 的旧 [5,10] 覆盖。
    if (provider === "kling" || provider === "kling-2.6" || provider === "kling-o3") {
      return getDurationOptions();
    }
    return vodDurationOptions.length > 0 ? vodDurationOptions : getDurationOptions();
  }, [getDurationOptions, isSeedance20Model, isViduNode, lt, provider, seedanceModel, vodDurationOptions]);
  const durationOptionValues = React.useMemo(
    () => durationOptions.map((option) => option.value),
    [durationOptions]
  );
  // 时长用进度条（滑块）呈现：当可选值是一段连续整数区间（如 Seedance 4~12 秒）
  // 时，用滑块替代下拉，更直观；离散区间（如 Kling 仅 5/10 秒）仍用下拉。
  const durationSliderRange = React.useMemo(() => {
    const values = durationOptionValues
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    if (values.length < 3) return null;
    const min = values[0];
    const max = values[values.length - 1];
    const isContiguous =
      max - min + 1 === values.length &&
      values.every((value, index) => value === min + index);
    return isContiguous ? { min, max } : null;
  }, [durationOptionValues]);
  const shouldShowAspectSelector =
    isSeedanceModel
      ? true
      : provider === "viduq3-pro"
      ? !hasImageInput
      : provider === "vidu"
      ? true
      // kling 全系(apimart kling-v2-6/v3/v3-omni)各模式均接受 aspect_ratio，
      // 始终展示可选（图生/首尾帧时上游可能用图片实际比例覆盖，属合法行为）。
      : provider === "kling" || provider === "kling-2.6" || provider === "kling-o3"
      ? true
      : !hasImageInput;
  const seedance20ResolutionList = React.useMemo<string[]>(
    () => getSeedance20ResolutionList(seedanceModel),
    [seedanceModel]
  );
  const legacySeedanceResolutionOptions = React.useMemo(() => {
    if (provider !== "doubao" || isVodManagedNode) return [];
    return isSeedance20Model ? seedance20ResolutionList : [...SEEDANCE15_DOC_RESOLUTIONS];
  }, [isSeedance20Model, isVodManagedNode, provider, seedance20ResolutionList]);
  const resolutionOptions = React.useMemo(
    () => {
      if (provider === "doubao" && isSeedance20Model) {
        if (vodResolutionOptions.length === 0) return seedance20ResolutionList;
        const allowed = new Set(seedance20ResolutionList);
        const filtered = vodResolutionOptions.filter((value) => allowed.has(value));
        return filtered.length > 0 ? filtered : seedance20ResolutionList;
      }
      if (provider === "doubao" && isSeedanceModel) {
        const allowed = new Set<string>(SEEDANCE15_DOC_RESOLUTIONS);
        const filtered = vodResolutionOptions.filter((value) => allowed.has(value));
        return filtered.length > 0 ? filtered : [...SEEDANCE15_DOC_RESOLUTIONS];
      }
      return vodResolutionOptions.length > 0
        ? vodResolutionOptions
        : legacySeedanceResolutionOptions;
    },
    [
      isSeedance20Model,
      isSeedanceModel,
      legacySeedanceResolutionOptions,
      provider,
      seedance20ResolutionList,
      vodResolutionOptions,
    ]
  );
  const viduModelFamily = normalizeViduModelForApi(viduModel);
  const effectiveManagedModelKey =
    provider === "vidu" || provider === "viduq3-pro"
      ? viduModelFamily === "q3"
        ? "vidu-q3"
        : "vidu-q2"
      : managedRoutesMetadata?.modelKey;
  const isViduQ2FamilyModel = viduModelFamily === "q2";
  const isViduQ2ProMode = viduModel === "q2-pro";
  const isCurrentViduQ3FamilyModel = viduModelFamily === "q3";
  const isViduQ3ProMode = viduModel === "q3-pro";
  const isViduQ3TurboModel = viduModel === "q3-turbo";
  // 下拉只有 q2 / q3 两个选项，所以把所有变体(q2-pro / q3-pro / q3-turbo / q3-mix /
  // q2-turbo 等)统一折叠到家族值，否则像 q3-turbo 这种值在选项里找不到，按钮标签会
  // 回退成默认的 "Vidu Q2"——一个 Q3 节点被错显成 Q2，菜单也无高亮项。
  const viduModelSelectionValue: "q2" | "q3" = viduModelFamily;
  const shouldShowResolutionSelector = resolutionOptions.length > 0;
  React.useEffect(() => {
    if (provider !== "doubao" || !isSeedanceModel || isSeedance20Model) return;
    const currentResolution =
      typeof data.resolution === "string" ? data.resolution.trim().toUpperCase() : "";
    if (!currentResolution || resolutionOptions.includes(currentResolution)) return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { resolution: resolutionOptions[0] || "720P" } },
      })
    );
  }, [
    data.resolution,
    id,
    isSeedance20Model,
    isSeedanceModel,
    provider,
    resolutionOptions,
  ]);
  const shouldShowLegacyViduOptions =
    (provider === "vidu" || provider === "viduq3-pro") && !isVodManagedNode;
  const shouldShowLegacySeedanceOptions =
    provider === "doubao" && !isVodManagedNode && !isSeedance20Model;
  const seedanceConstraintTips = React.useMemo(() => {
    if (!isSeedanceModel) return [] as string[];
    if (isSeedance20Model) {
      const resolutionTip =
        seedanceModel === "seed-2.0-lite" || seedanceModel === "seed-2.0-mini"
          ? lt(
              "分辨率/尺寸：480P、720P；21:9、16:9、4:3、1:1、3:4、9:16",
              "Resolution/ratio: 480P, 720P; 21:9, 16:9, 4:3, 1:1, 3:4, 9:16"
            )
          : lt(
              "分辨率/尺寸：480P、720P、1080P；21:9、16:9、4:3、1:1、3:4、9:16",
              "Resolution/ratio: 480P, 720P, 1080P; 21:9, 16:9, 4:3, 1:1, 3:4, 9:16"
            );
      return [
        lt("图片大小：单图建议不超过 30MB", "Image size: each image should be <= 30MB"),
        seedanceModel === "seed-2.0-mini"
          ? lt("生成时长：4-10 秒", "Output duration: 4-10s")
          : lt("生成时长：4-15 秒", "Output duration: 4-15s"),
        resolutionTip,
        lt("参考视频最多 3 条；音频最多 3 条且每条≤5秒", "Video refs <=3; audio refs <=3 and <=5s each"),
        ...(seedanceModel === "seed-2.0-mini"
          ? [lt("Mini 暂不支持 Smart Frames 模式", "Mini does not support Smart Frames mode yet")]
          : []),
        lt("在线限流：企业 600 RPM / 个人 80 RPM", "Online RPM: enterprise 600 / individual 80"),
        lt("在线最大并发：企业 10", "Online max concurrency: enterprise 10"),
      ];
    }
    return [
      lt("图片大小：单图建议不超过 30MB", "Image size: each image should be <= 30MB"),
      lt("生成时长：3-10 秒", "Output duration: 3-10s"),
      lt("分辨率/尺寸：720P；16:9、9:16、1:1", "Resolution/ratio: 720P; 16:9, 9:16, 1:1"),
    ];
  }, [isSeedance20Model, isSeedanceModel, lt, seedanceModel]);
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
              value: "first_frame",
              label: lt("首帧（1图）", "First frame (1 image)"),
              description: lt("仅首帧图 + 提示词", "Single first-frame image with prompt"),
            },
            {
              value: "start_end",
              label: lt("首/尾帧（1-2图）", "Frame mode (1-2 images)"),
              description: lt(
                "支持首帧、尾帧、首尾帧（总共1-2张图）",
                "Supports first/last/start-end frames (1-2 images total)"
              ),
            },
            {
              value: "smart_frames",
              label: lt("智能多帧（2-10图）", "Smart frames (2-10)"),
              description: lt("2-10 张图片序列智能衔接", "2-10 image sequence transition"),
            },
          ].filter((option) =>
            seedance20SupportedModes.includes(option.value as Seedance20Mode)
          )
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
    [isSeedance20Model, lt, seedance20SupportedModes]
  );

  React.useEffect(() => {
    if (!shouldShowAspectSelector) {
      setAspectMenuOpen(false);
    }
  }, [shouldShowAspectSelector]);

  // 将解析后的通道同步到节点，保证预估、保存和实际请求使用同一通道。
  React.useEffect(() => {
    if (!managedRoutesMetadata || managedRoutesMetadata.vendors.length === 0) return;
    if (!selectedManagedRoute) return;
    const desiredVendor = selectedManagedRoute.vendorKey;
    const desiredPlatform =
      selectedManagedRoute.platformKey || selectedManagedRoute.vendorKey;
    const desiredChannelTier: "default" | "vip" =
      desiredVendor === "tencent_vod" || desiredVendor === "tengxun"
        ? "vip"
        : "default";
    if (
      data.vendorKey === desiredVendor &&
      data.platformKey === desiredPlatform &&
      data.managedModelKey === effectiveManagedModelKey &&
      data.channelTier === desiredChannelTier &&
      typeof data.channelSelectionExplicit === "boolean"
    ) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: {
          id,
          patch: {
            managedModelKey: effectiveManagedModelKey,
            vendorKey: desiredVendor,
            platformKey: desiredPlatform,
            channelTier: desiredChannelTier,
            channelSelectionExplicit: data.channelSelectionExplicit === true,
            creditsPerCall:
              typeof selectedManagedRoute.creditsPerCall === "number"
                ? selectedManagedRoute.creditsPerCall
                : undefined,
          },
        },
      })
    );
  }, [
    id,
    managedRoutesMetadata,
    selectedManagedRoute,
    data.vendorKey,
    data.platformKey,
    data.managedModelKey,
    data.channelTier,
    data.channelSelectionExplicit,
    effectiveManagedModelKey,
  ]);

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

  React.useEffect(() => {
    if (durationOptionValues.length === 0) return;

    const resolveNearestDuration = (target: number) => {
      return durationOptionValues.reduce((best, current) => {
        const currentDelta = Math.abs(current - target);
        const bestDelta = Math.abs(best - target);
        if (currentDelta !== bestDelta) {
          return currentDelta < bestDelta ? current : best;
        }
        return current < best ? current : best;
      }, durationOptionValues[0]);
    };

    const nextDuration =
      typeof clipDuration === "number" && Number.isFinite(clipDuration)
        ? durationOptionValues.includes(clipDuration)
          ? clipDuration
          : resolveNearestDuration(clipDuration)
        : provider === "doubao"
        ? 5
        : undefined;

    if (typeof nextDuration !== "number" || nextDuration === clipDuration) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { clipDuration: nextDuration } },
      })
    );
  }, [clipDuration, durationOptionValues, id, provider]);

  const handleKlingModelChange = React.useCallback(
    (value: "kling-v2-6" | "kling-v3-0") => {
      if (value === klingModel) return;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              klingModel: value,
            },
          },
        })
      );
    },
    [id, klingModel]
  );

  const handleKlingSoundToggle = React.useCallback(() => {
    if (!isKling26Model) return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { sound: !klingSoundEnabled } },
      })
    );
  }, [id, isKling26Model, klingSoundEnabled]);

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
      if (isSeedance20LockedOption(value)) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              type: "info",
              message: lt(
                "Seedance 2.0 / Seed 2.0 系列需开通 VIP 权益或进入水印白名单后才可选择",
                "Seedance 2.0 / Seed 2.0 series requires VIP access or watermark whitelist access",
              ),
            },
          })
        );
        return;
      }
      const supportedModes = getSeedance20SupportedModes(value);
      const nextMode: SeedanceMode = isSeedance20ModelValue(value)
        ? supportedModes.includes(seedanceMode as Seedance20Mode)
          ? (seedanceMode as Seedance20Mode)
          : "reference_images"
        : "text";
      const nextDuration =
        isSeedance20ModelValue(value)
          ? clipDuration === 3
            ? 4
            : clipDuration &&
              clipDuration >= 4 &&
              clipDuration <= (value === "seed-2.0-mini" ? 10 : 15)
            ? clipDuration
            : 5
          : // Seedance 1.5-pro: 4–12s.
          clipDuration && clipDuration >= 4 && clipDuration <= 12
          ? clipDuration
          : 5;
      const currentResolution =
        typeof data.resolution === "string" ? data.resolution.trim().toUpperCase() : "";
      // Fast/Lite/Mini share the doubao-seedance-2-0-fast upstream (no 1080P).
      const nextResolution =
        (value === "seed-2.0-lite" ||
          value === "seed-2.0-mini" ||
          value === "seedance-2.0-fast") &&
        currentResolution === "1080P"
          ? "720P"
          : undefined;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              seedanceModel: value,
              seedanceMode: nextMode,
              clipDuration: nextDuration,
              generateAudio:
                isSeedance20ModelValue(value)
                  ? typeof data.generateAudio === "boolean"
                    ? data.generateAudio
                    : true
                  : undefined,
              ...(nextResolution ? { resolution: nextResolution } : {}),
            },
          },
        })
      );
    },
    [
      clipDuration,
      data.generateAudio,
      data.resolution,
      id,
      isSeedance20LockedOption,
      lt,
      seedanceMode,
      seedanceModel,
    ]
  );

  const handleSeedanceAudioToggle = React.useCallback(() => {
    if (!isSeedance20Model) return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { generateAudio: !seedanceGenerateAudio } },
      })
    );
  }, [id, isSeedance20Model, seedanceGenerateAudio]);

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
      const targetPlatform = target.platformKey || target.vendorKey;
      const targetTier: "default" | "vip" =
        target.vendorKey === "tencent_vod" || target.vendorKey === "tengxun"
          ? "vip"
          : "default";
      if (
        target.vendorKey === (data.vendorKey || "").trim() &&
        targetPlatform === (data.platformKey || "").trim() &&
        targetTier === data.channelTier &&
        effectiveManagedModelKey === data.managedModelKey
      ) {
        return;
      }
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              managedModelKey: effectiveManagedModelKey,
              vendorKey: target.vendorKey,
              platformKey: targetPlatform,
              channelTier: targetTier,
              channelSelectionExplicit: true,
              creditsPerCall:
                typeof target.creditsPerCall === "number"
                  ? target.creditsPerCall
                  : undefined,
            },
          },
        })
      );
    },
    [
      data.channelTier,
      data.channelSelectionExplicit,
      data.managedModelKey,
      data.platformKey,
      data.vendorKey,
      effectiveManagedModelKey,
      id,
      nodeConfigMetadata,
    ]
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
    if (!isKling26Model) return;
    if (typeof data.sound !== "undefined" && data.sound !== null) return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { sound: true } },
      })
    );
  }, [data.sound, id, isKling26Model]);

  React.useEffect(() => {
    if (!isSeedance20Model || typeof data.generateAudio === "boolean") return;
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { generateAudio: true } },
      })
    );
  }, [data.generateAudio, id, isSeedance20Model]);

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
      alert(lt("\u6ca1\u6709\u53ef\u590d\u5236\u7684\u89c6\u9891\u94fe\u63a5", "No video link to copy"));
      return;
    }
    try {
      // 浼樺厛浣跨敤 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        alert(lt("\u89c6\u9891\u94fe\u63a5\u5df2\u590d\u5236", "Video link copied"));
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
        alert(lt("\u89c6\u9891\u94fe\u63a5\u5df2\u590d\u5236", "Video link copied"));
      } else {
        alert(lt("\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u590d\u5236\uff1a\n", "Copy failed. Please copy manually:\n") + url);
      }
    } catch (error) {
      console.error(lt("\u590d\u5236\u5931\u8d25:", "Copy failed:"), error);
      // 鏈€鍚庣殑澶囩敤鏂规锛氭樉绀洪摼鎺ヨ鐢ㄦ埛鎵嬪姩澶嶅埗
      prompt(lt("\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u590d\u5236\u4ee5\u4e0b\u94fe\u63a5\uff1a", "Copy failed. Please copy this link manually:"), url);
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
        message: lt("\u89c6\u9891\u4e0b\u8f7d\u4e2d\uff0c\u8bf7\u7a0d\u7b49...", "Downloading video..."),
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
            message: lt("\u4e0b\u8f7d\u5b8c\u6210", "Download completed"),
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
            message: lt("\u5df2\u5728\u65b0\u6807\u7b7e\u9875\u6253\u5f00\u89c6\u9891\u94fe\u63a5", "Opened video link in new tab"),
          });
          scheduleFeedbackClear(3000);
        }
      } catch (error) {
        console.error(lt("\u4e0b\u8f7d\u5931\u8d25:", "Download failed:"), error);
        // 涓嬭浇澶辫触鏃讹紝灏濊瘯鐩存帴鎵撳紑閾炬帴
        window.open(url, "_blank");
        setDownloadFeedback({
          type: "error",
          message: lt("\u4e0b\u8f7d\u5931\u8d25\uff0c\u5df2\u5728\u65b0\u6807\u7b7e\u9875\u6253\u5f00", "Download failed, opened in new tab"),
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
  };

  const handleMediaTouchStart = (event: React.TouchEvent) => {
    event.stopPropagation();
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
          preload="auto"
          {...(sanitizedThumbnail ? { poster: proxifyRemoteAssetUrl(sanitizedThumbnail) } : {})}
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
      {/* image-2 句柄: Seedance/Vidu 与 Kling(2.6或Pro模式)可见 */}
      {((isSeedanceModel && seedanceModeSpec?.visibleHandles.includes("image-2")) ||
        canUseKlingImage2Input ||
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
                : seedanceMode === "first_frame"
                ? "image (1)"
                : seedanceMode === "smart_frames"
                ? "image (2-10)"
                : "image (1-2)"
              : seedanceMode === "start_end"
              ? "image (1-2)"
              : "image"
            : isKling26Model
            ? "image (图1)"
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
          image-2 (图2)
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
              title={lt("玩法说明", "Help")}
            >
              <HelpCircle size={14} />
            </button>
          )}
          {data.status === "running" ? (
            <button
              className="tanva-video-header-btn tanva-video-header-stop"
              onClick={onStop}
              onMouseDown={handleButtonMouseDown}
              title={lt("停止并重置，可重新生成", "Stop and reset to regenerate")}
              style={{
                width: 64,
                minWidth: 64,
                padding: "0 10px",
                height: 32,
                borderRadius: 8,
                border: "none",
                background: "#111827",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 12,
                gap: 0,
              }}
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              className="tanva-video-header-btn tanva-video-header-run run-btn-with-credit"
              onClick={onRun}
              onMouseDown={handleButtonMouseDown}
              style={{
                width: showRunCredits ? "auto" : 36,
                minWidth: showRunCredits ? 64 : 36,
                padding: showRunCredits ? "0 10px" : undefined,
                height: 32,
                borderRadius: 8,
                border: "none",
                background: "#111827",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: 12,
                gap: 0,
              }}
            >
              <span className="run-text-trigger">Run</span>
              {showRunCredits ? (
                <RunCreditBadge credits={selectedCredits} runButton />
              ) : null}
            </button>
          )}
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
                下载中...
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
                提示：
                {lt("Std 仅支持 1 张图，Pro 支持 1-2 张图（首尾帧）", "Tip: Std mode = 1 image, Pro mode = 1 or 2 images (start-end)")}
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

      {managedRoutesMetadata && managedRoutesMetadata.vendors.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("通道", "Channel")}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${managedRoutesMetadata.vendors.length}, minmax(0, 1fr))`,
              gap: 6,
            }}
          >
            {managedRoutesMetadata.vendors.map((routeOption) => {
              const active = selectedManagedRoute?.vendorKey === routeOption.vendorKey;
              const premium =
                routeOption.vendorKey === "tencent_vod" ||
                routeOption.vendorKey === "tengxun";
              return (
                <button
                  key={routeOption.vendorKey}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleManagedRouteChange(routeOption.vendorKey);
                  }}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: active ? "1px solid #2563eb" : "1px solid #e5e7eb",
                    background: active ? "#eff6ff" : "#fff",
                    color: active ? "#1d4ed8" : "#4b5563",
                    fontSize: 11,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                  }}
                >
                  {premium
                    ? lt("尊享", "Premium")
                    : lt("普通（Default）", "Default")}
                </button>
              );
            })}
          </div>
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
                  const selectedValue = isUnifiedKlingNode
                    ? klingModel
                    : provider === "doubao"
                    ? seedanceModel
                    : viduModelSelectionValue;
                  const isActive = selectedValue === opt.value;
                  const isSeedanceLocked =
                    provider === "doubao" &&
                    isSeedance20LockedOption(opt.value as SeedanceModel);
                  return (
                    <button
                      key={opt.value}
                      type='button'
                      title={
                        isSeedanceLocked
                          ? lt(
                              "需开通 VIP 权益或进入水印白名单后才能选择",
                              "Requires VIP access or watermark whitelist access",
                            )
                          : undefined
                      }
                      onClick={() => {
                        if (isSeedanceLocked) return;
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
                        border: `1px solid ${isActive ? "#2563eb" : "#e5e7eb"}`,
                        background: isActive ? "#eff6ff" : "#fff",
                        color: isSeedanceLocked
                          ? "#9ca3af"
                          : isActive
                          ? "#1d4ed8"
                          : "#111827",
                        fontSize: 12,
                        textAlign: "left",
                        cursor: isSeedanceLocked ? "not-allowed" : "pointer",
                        opacity: isSeedanceLocked ? 0.55 : 1,
                      }}
                      disabled={isSeedanceLocked}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {provider === "doubao" && seedance20RestrictedForCurrentUser ? (
                <div
                  style={{
                    marginTop: 6,
                    paddingTop: 6,
                    borderTop: "1px dashed #e5e7eb",
                    fontSize: 11,
                    color: "#6b7280",
                    lineHeight: 1.45,
                  }}
                >
                  {lt(
                    "提示：Seedance 2.0 / Seed 2.0 系列需开通 VIP 权益",
                    "Tip: Seedance 2.0 / Seed 2.0 series requires VIP access",
                  )}
                </div>
              ) : null}
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
        <div
          style={{
            fontSize: 12,
            color: "#6b7280",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{lt("时长", "Duration")}</span>
          {durationSliderRange && (
            <span style={{ color: "#111827", fontWeight: 600 }}>
              {durationLabel}
            </span>
          )}
        </div>
        {durationSliderRange ? (
          <div style={{ padding: "2px 2px 0" }}>
            <input
              className='nodrag nopan'
              type='range'
              min={durationSliderRange.min}
              max={durationSliderRange.max}
              step={1}
              value={
                typeof clipDuration === "number" &&
                clipDuration >= durationSliderRange.min &&
                clipDuration <= durationSliderRange.max
                  ? clipDuration
                  : durationSliderRange.min
              }
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) =>
                handleDurationChange(Number(event.target.value))
              }
              style={{
                width: "100%",
                accentColor: "#2563eb",
                cursor: "pointer",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: "#9ca3af",
                marginTop: 2,
              }}
            >
              <span>{lt(`${durationSliderRange.min}秒`, `${durationSliderRange.min}s`)}</span>
              <span>{lt(`${durationSliderRange.max}秒`, `${durationSliderRange.max}s`)}</span>
            </div>
          </div>
        ) : (
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
        )}
        {!durationSliderRange && durationMenuOpen && (
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

      {/* Kling 涓撶敤鍙傛暟锛氭ā寮忛€夋嫨 */}
      {isUnifiedKlingNode && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            {lt("模式 / 分辨率", "Mode / Resolution")}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {/* APIMart Kling 无独立分辨率字段，画质由 mode 决定：标准=720P、专业=1080P。
                故模式选择即分辨率选择，按钮标注对应分辨率。 */}
            {[
              { label: lt("标准 720P", "Std 720P"), value: "std" },
              { label: lt("专业 1080P", "Pro 1080P"), value: "pro" },
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
          <button
            type='button'
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

      {isSeedance20Model && (
        <div style={{ marginBottom: 8 }}>
          <button
            type='button'
            onClick={handleSeedanceAudioToggle}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: seedanceGenerateAudio ? "#111827" : "#fff",
              color: seedanceGenerateAudio ? "#fff" : "#111827",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {lt("音频", "Audio")}:{" "}
            {seedanceGenerateAudio ? lt("开启", "On") : lt("关闭", "Off")}
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
        startedAt={data.progressStartedAt}
        runKey={id}
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
                    {lt("\u4e0b\u8f7d", "Download")}
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
