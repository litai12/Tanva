/**
 * AI聊天对话框状态管理
 * 管理对话框显示、输入内容和生成状态
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import paper from "paper";
import { aiImageService } from "@/services/aiImageService";
import { paperSandboxService } from "@/services/paperSandboxService";
import {
  generateImageViaAPI,
  editImageViaAPI,
  blendImagesViaAPI,
  analyzeImageViaAPI,
  generateTextResponseViaAPI,
  midjourneyActionViaAPI,
  generateVideoViaAPI,
} from "@/services/aiBackendAPI";
import { useUIStore } from "@/stores/uiStore";
import { contextManager } from "@/services/contextManager";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { ossUploadService, dataURLToBlob, dataURLToBlobAsync } from "@/services/ossUploadService";
import { createSafeStorage } from "@/stores/storageUtils";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import { useImageHistoryStore } from "@/stores/imageHistoryStore";
import { createImagePreviewDataUrl } from "@/utils/imagePreview";
import { logger } from "@/utils/logger";
import { createAsyncLimiter, mapWithLimit } from "@/utils/asyncLimit";
import { resolveImageToBlob, resolveImageToDataUrl, toRenderableImageSrc } from "@/utils/imageSource";
import { blobToDataUrl as blobToDataUrlLimited, canvasToDataUrl, responseToBlob } from "@/utils/imageConcurrency";
import {
  STORE_NAMES,
  idbGet,
  idbPut,
  isMigrationDone,
  markMigrationDone,
  isIndexedDBAvailable,
} from "@/services/indexedDBService";
import type { StoredImageAsset } from "@/types/canvas";
import type {
  AIImageResult,
  RunningHubGenerateOptions,
  AIProviderOptions,
  SupportedAIProvider,
  MidjourneyMetadata,
  AIError,
  AIImageEditRequest,
} from "@/types/ai";
import type {
  ConversationContext,
  OperationHistory,
  SerializedConversationContext,
  SerializedChatMessage,
} from "@/types/context";

// 本地存储会话的读取工具（用于无项目或早期回退场景）
const LOCAL_SESSIONS_KEY = "tanva_aiChat_sessions";
const LOCAL_ACTIVE_KEY = "tanva_aiChat_activeSessionId";
const IDB_SESSIONS_KEY = "local_sessions";
const AI_CHAT_STORE_NAME = STORE_NAMES.AI_CHAT_SESSIONS;

// 🔥 全局待生成图片计数器（防止连续快速生成时重叠）
let generatingImageCount = 0;

const placeholderLogger = logger.scope("placeholder");

// 限制图片上传并发，避免同时 atob/encode/上传导致内存峰值
const aiChatUploadLimiter = createAsyncLimiter(2);
// 限制 AI 对话图片历史/缩略图处理并发，避免多图同时转码导致瞬时内存峰值
const aiChatHistoryLimiter = createAsyncLimiter(1);

// IndexedDB 存储的会话数据结构
interface IDBSessionsData {
  id: string;
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
  updatedAt: number;
}

// 内存优化常量 (P0 修复)
const MAX_MESSAGES_PER_SESSION = 100;
const MAX_IMAGE_BASE64_SIZE = 500 * 1024; // 500KB 以上的 Base64 考虑清理

// 内存优化：清理消息中的大型 Base64 (P0 修复)
const optimizeMessagesMemory = (messages: ChatMessage[]): ChatMessage[] => {
  return messages.map((msg, index) => {
    // 只清理旧消息（保留最近3条以便快速交互）
    const isOldMessage = index < messages.length - 3;
    if (!isOldMessage) return msg;

    const hasRemoteUrl = !!(msg.imageRemoteUrl && msg.imageRemoteUrl.startsWith("http"));
    const hasBlobSource =
      (typeof msg.sourceImageData === "string" && msg.sourceImageData.startsWith("blob:")) ||
      (Array.isArray(msg.sourceImagesData) &&
        msg.sourceImagesData.some(
          (v) => typeof v === "string" && v.startsWith("blob:")
        )) ||
      (typeof msg.thumbnail === "string" && msg.thumbnail.startsWith("blob:"));

    // 只有在有远程URL（可回放）或 blob URL（不可持久化且容易泄漏）时才清理
    if (!hasRemoteUrl && !hasBlobSource) return msg;

    const nextMsg = { ...msg };
    let changed = false;

    // 有远程URL时，直接清理 imageData（完整 base64）
    if (hasRemoteUrl && msg.imageData) {
      nextMsg.imageData = undefined;
      changed = true;
    }

    // 清理 sourceImageData
    if (
      msg.sourceImageData &&
      (hasRemoteUrl || msg.sourceImageData.startsWith("blob:"))
    ) {
      nextMsg.sourceImageData = undefined;
      changed = true;
    }

    // 清理 sourceImagesData 数组
    if (Array.isArray(msg.sourceImagesData) && msg.sourceImagesData.length > 0) {
      if (hasRemoteUrl) {
        nextMsg.sourceImagesData = [];
        changed = true;
      } else {
        const filtered = msg.sourceImagesData.filter(
          (v) => !(typeof v === "string" && v.startsWith("blob:"))
        );
        if (filtered.length !== msg.sourceImagesData.length) {
          nextMsg.sourceImagesData = filtered;
          changed = true;
        }
      }
    }

    // blob thumbnail 无法跨刷新复用，且会占用内存
    if (typeof msg.thumbnail === "string" && msg.thumbnail.startsWith("blob:")) {
      nextMsg.thumbnail = undefined;
      changed = true;
    }

    return changed ? nextMsg : msg;
  });
};

// 从 localStorage 读取（兼容旧数据）
function readSessionsFromLocalStorage(): {
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
} | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LOCAL_SESSIONS_KEY);
    if (!raw) return null;
    const sessions = JSON.parse(raw) as SerializedConversationContext[];
    const activeSessionId = localStorage.getItem(LOCAL_ACTIVE_KEY) || null;
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    return { sessions, activeSessionId };
  } catch {
    return null;
  }
}

// 从 IndexedDB 读取会话
async function readSessionsFromIDB(): Promise<{
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
} | null> {
  try {
    const data = await idbGet<IDBSessionsData>(
      AI_CHAT_STORE_NAME,
      IDB_SESSIONS_KEY
    );
    if (!data || !Array.isArray(data.sessions) || data.sessions.length === 0) {
      return null;
    }
    return { sessions: data.sessions, activeSessionId: data.activeSessionId };
  } catch {
    return null;
  }
}

// 写入会话到 IndexedDB
async function writeSessionsToIDB(
  sessions: SerializedConversationContext[],
  activeSessionId: string | null
): Promise<void> {
  try {
    const data: IDBSessionsData = {
      id: IDB_SESSIONS_KEY,
      sessions,
      activeSessionId,
      updatedAt: Date.now(),
    };
    await idbPut(AI_CHAT_STORE_NAME, data);
  } catch (err) {
    console.warn("[AIChat] 写入 IndexedDB 失败:", err);
  }
}

// 从 IndexedDB 或 localStorage 加载会话（含迁移逻辑）
async function loadLocalSessions(): Promise<{
  sessions: SerializedConversationContext[];
  activeSessionId: string | null;
} | null> {
  // 优先从 IndexedDB 读取
  const idbData = await readSessionsFromIDB();
  if (idbData) {
    return idbData;
  }

  // 检查是否需要从 localStorage 迁移
  if (!isMigrationDone(AI_CHAT_STORE_NAME) && isIndexedDBAvailable()) {
    const legacyData = readSessionsFromLocalStorage();
    if (legacyData && legacyData.sessions.length > 0) {
      console.log(
        `[AIChat] 从 localStorage 迁移 ${legacyData.sessions.length} 个会话`
      );
      await writeSessionsToIDB(legacyData.sessions, legacyData.activeSessionId);
      markMigrationDone(AI_CHAT_STORE_NAME);
      // 清理 localStorage
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(LOCAL_SESSIONS_KEY);
        localStorage.removeItem(LOCAL_ACTIVE_KEY);
      }
      return legacyData;
    }
    markMigrationDone(AI_CHAT_STORE_NAME);
  }

  // 兜底：尝试从 localStorage 读取
  return readSessionsFromLocalStorage();
}

export interface ChatMessage {
  id: string;
  type: "user" | "ai" | "error";
  content: string;
  timestamp: Date;
  /**
   * 是否预计会返回图像结果（用于控制 UI 的图像占位符）
   */
  expectsImageOutput?: boolean;
  /**
   * 是否预计会返回视频结果（用于控制 UI 的视频占位符）
   */
  expectsVideoOutput?: boolean;
  imageData?: string;
  imageRemoteUrl?: string;
  thumbnail?: string;
  // 视频相关字段
  videoUrl?: string;
  videoThumbnail?: string;
  videoDuration?: number;
  videoReferencedUrls?: string[];
  videoTaskId?: string | null;
  videoStatus?: string | null;
  videoSourceUrl?: string;
  videoMetadata?: Record<string, any>;
  sourceImageData?: string;
  sourceImagesData?: string[];
  webSearchResult?: unknown;
  provider?: AIProviderType;
  metadata?: Record<string, any>;
  // 🔥 每条消息的独立生成状态
  generationStatus?: {
    isGenerating: boolean;
    progress: number;
    error: string | null;
    stage?: string;
  };
  // 🔥 并行生成分组
  groupId?: string; // 所属批量生成组ID
  groupIndex?: number; // 在组内的位置 (0-based)
  groupTotal?: number; // 组内总数量
}

const formatMessageContentForLog = (content: string): string => {
  if (!content) return "";
  const trimmed = content.trim();
  const maxLength = 200;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}...`
    : trimmed;
};

const logChatConversationSnapshot = (messages: ChatMessage[]): void => {
  try {
    const _tail = messages.slice(-8).map((msg) => ({
      id: msg.id,
      type: msg.type,
      provider: msg.provider,
      content: formatMessageContentForLog(msg.content),
      expectsImageOutput: msg.expectsImageOutput,
      stage: msg.generationStatus?.stage,
      hasImage: Boolean(msg.imageData || msg.imageRemoteUrl || msg.thumbnail),
      timestamp: toISOString(msg.timestamp),
    }));
    // 对话快照已记录
  } catch (error) {
    console.warn("⚠️ 无法打印AI对话内容:", error);
  }
};

type MessageOverride = {
  userMessageId: string;
  aiMessageId: string;
};

export interface GenerationStatus {
  isGenerating: boolean;
  progress: number;
  error: string | null;
  stage?: string;
}

export interface ChatSessionSummary {
  sessionId: string;
  name: string;
  lastActivity: Date;
  messageCount: number;
  preview?: string;
}

let hasHydratedSessions = false;
let isHydratingNow = false;
let refreshSessionsTimeout: NodeJS.Timeout | null = null;
let legacyMigrationInProgress = false;

type AutoModeMultiplier = 1 | 2 | 4 | 8;
export type SendShortcut = "enter" | "mod-enter";

const toISOString = (
  value: Date | string | number | null | undefined
): string => {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
};

const cloneSafely = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value ?? null)) ?? (value as T);

export type ManualAIMode =
  | "auto"
  | "text"
  | "generate"
  | "edit"
  | "blend"
  | "analyze"
  | "video"
  | "vector";
type AvailableTool =
  | "generateImage"
  | "editImage"
  | "blendImages"
  | "analyzeImage"
  | "analyzePdf"
  | "chatResponse"
  | "generateVideo"
  | "generatePaperJS";

type AIProviderType = SupportedAIProvider;

const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview";
const GEMINI_PRO_IMAGE_MODEL = "gemini-3-pro-image-preview";
const GEMINI_FLASH_IMAGE_MODEL = "gemini-2.5-flash-image-preview";
const DEFAULT_TEXT_MODEL = "gemini-3-flash-preview";
const GEMINI_PRO_TEXT_MODEL = "gemini-3-flash-preview";
const BANANA_TEXT_MODEL = "gemini-3-flash-preview";
const BANANA_25_IMAGE_MODEL = "gemini-2.5-flash-image";
const BANANA_25_TEXT_MODEL = "gemini-3-flash-preview";
export const SORA2_VIDEO_MODELS = {
  hd: "sora-2-pro-reverse",
  sd: "sora-2-reverse",
} as const;
export type Sora2VideoQuality = keyof typeof SORA2_VIDEO_MODELS;
export const DEFAULT_SORA2_VIDEO_QUALITY: Sora2VideoQuality = "sd";
const RUNNINGHUB_IMAGE_MODEL = "runninghub-su-effect";
const MIDJOURNEY_IMAGE_MODEL = "midjourney-fast";
const RUNNINGHUB_PRIMARY_NODE_ID =
  import.meta.env?.VITE_RUNNINGHUB_PRIMARY_NODE_ID ?? "112";
const RUNNINGHUB_REFERENCE_NODE_ID =
  import.meta.env?.VITE_RUNNINGHUB_REFERENCE_NODE_ID ?? "158";
const RUNNINGHUB_WEBAPP_ID = import.meta.env?.VITE_RUNNINGHUB_WEBAPP_ID;
const RUNNINGHUB_WEBHOOK_URL = import.meta.env?.VITE_RUNNINGHUB_WEBHOOK_URL;
const ENABLE_VIDEO_CANVAS_PLACEMENT = false;
const VIDEO_FETCH_TIMEOUT_MS = 60000;
const DEFAULT_PLACEHOLDER_EDGE = 512;
const MIN_PLACEHOLDER_EDGE = 96;
const INLINE_MEDIA_LIMIT = 150_000; // ~150KB string; guard against oversized base64 persisting in memory/localStorage

type PlaceholderSpec = {
  placeholderId: string;
  center?: { x: number; y: number } | null;
  width: number;
  height: number;
  operationType?: string;
  /**
   * 使用画布的智能排版逻辑（无 center 时会自动计算）
   */
  preferSmartLayout?: boolean;
  /**
   * 智能排版参考的源图（编辑）
   */
  sourceImageId?: string;
  /**
   * 智能排版参考的源图列表（融合）
   */
  sourceImages?: string[];
  /**
   * 预计算的智能位置（如果已算好，可直接用）
   */
  smartPosition?: { x: number; y: number };
  /**
   * 并行分组信息，用于在画布上横向排版
   */
  groupId?: string;
  groupIndex?: number;
  groupTotal?: number;
  /**
   * 是否优先横向排版（X4 等并行模式）
   */
  preferHorizontal?: boolean;
  /**
   * 分组级别的锚点（用于整行对齐）
   */
  groupAnchor?: { x: number; y: number } | null;
};

const parseAspectRatioValue = (ratio?: string | null): number | null => {
  if (!ratio) return null;
  const parts = ratio.split(":").map((v) => Number(v));
  if (
    parts.length !== 2 ||
    !Number.isFinite(parts[0]) ||
    !Number.isFinite(parts[1]) ||
    parts[0] <= 0 ||
    parts[1] <= 0
  ) {
    return null;
  }
  return parts[0] / parts[1];
};

const estimatePlaceholderSize = (params: {
  aspectRatio?: string | null;
  imageSize?: "1K" | "2K" | "4K" | null;
  fallbackBounds?: { width: number; height: number } | null;
}): { width: number; height: number } => {
  if (
    params.fallbackBounds &&
    params.fallbackBounds.width > 0 &&
    params.fallbackBounds.height > 0
  ) {
    return {
      width: params.fallbackBounds.width,
      height: params.fallbackBounds.height,
    };
  }

  const ratio = parseAspectRatioValue(params.aspectRatio) || 1;
  let baseEdge = DEFAULT_PLACEHOLDER_EDGE;

  if (params.imageSize === "2K") {
    baseEdge = DEFAULT_PLACEHOLDER_EDGE * 1.1;
  } else if (params.imageSize === "4K") {
    baseEdge = DEFAULT_PLACEHOLDER_EDGE * 1.25;
  }

  if (ratio >= 1) {
    return {
      width: baseEdge,
      height: Math.max(MIN_PLACEHOLDER_EDGE, baseEdge / ratio),
    };
  }

  return {
    width: Math.max(MIN_PLACEHOLDER_EDGE, baseEdge * ratio),
    height: baseEdge,
  };
};

const getViewCenter = (): { x: number; y: number } | null => {
  try {
    const paperView =
      paper?.view ||
      (typeof window !== "undefined" ? (window as any)?.paper?.view : null);
    if (paperView?.center) {
      return { x: paperView.center.x, y: paperView.center.y };
    }
  } catch {}
  return null;
};

const dispatchPlaceholderEvent = (
  placeholder: PlaceholderSpec,
  action: "add" | "remove" = "add"
) => {
  if (typeof window === "undefined") return;
  try {
    placeholderLogger.debug("[占位符事件] 派发事件:", { action, placeholder });
    window.dispatchEvent(
      new CustomEvent("predictImagePlaceholder", {
        detail:
          action === "add"
            ? { ...placeholder, action }
            : { placeholderId: placeholder.placeholderId, action },
      })
    );
  } catch (error) {
    placeholderLogger.warn("派发占位符事件失败", error);
  }
};

type VideoPosterBuildResult = {
  dataUrl: string;
  origin: "thumbnail" | "videoFrame" | "placeholder";
  sourceImageUrl?: string;
};

const GEMINI_FALLBACK_PROVIDERS: AIProviderType[] = ["gemini", "gemini-pro"];

const isQuotaOrRateLimitError = (error?: AIError | null): boolean => {
  if (!error) return false;
  const code = (error.code || "").toLowerCase();
  const message = (error.message || "").toLowerCase();
  if (code.includes("429") || code.includes("rate") || code.includes("quota")) {
    return true;
  }
  return (
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("resource_exhausted") ||
    message.includes("429")
  );
};

const shouldFallbackToGeminiFlash = (
  provider: AIProviderType,
  model: string,
  error?: AIError | null
): boolean => {
  if (!GEMINI_FALLBACK_PROVIDERS.includes(provider)) return false;
  if (model !== GEMINI_PRO_IMAGE_MODEL) return false;
  return isQuotaOrRateLimitError(error);
};

export const getImageModelForProvider = (provider: AIProviderType): string => {
  if (provider === "gemini-pro") {
    return GEMINI_PRO_IMAGE_MODEL;
  }
  if (provider === "runninghub") {
    return RUNNINGHUB_IMAGE_MODEL;
  }
  if (provider === "midjourney") {
    return MIDJOURNEY_IMAGE_MODEL;
  }
  if (provider === "banana-2.5") {
    return BANANA_25_IMAGE_MODEL;
  }
  return DEFAULT_IMAGE_MODEL;
};

const TEXT_MODEL_BY_PROVIDER: Record<AIProviderType, string> = {
  gemini: DEFAULT_TEXT_MODEL,
  "gemini-pro": GEMINI_PRO_TEXT_MODEL,
  banana: BANANA_TEXT_MODEL,
  "banana-2.5": BANANA_25_TEXT_MODEL,
  runninghub: DEFAULT_TEXT_MODEL,
  midjourney: DEFAULT_TEXT_MODEL,
};

export const getTextModelForProvider = (provider: AIProviderType): string => {
  return TEXT_MODEL_BY_PROVIDER[provider] || DEFAULT_TEXT_MODEL;
};

type RunningHubStageUpdater = (stage: string, progress?: number) => void;

type ProcessMetrics = {
  startTime: number;
  lastStepTime: number;
  traceId: string;
  messageId?: string;
};

type MidjourneyActionOptions = {
  parentMessageId: string;
  taskId: string;
  customId: string;
  buttonLabel?: string;
  displayPrompt?: string;
};

const getTimestamp = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const createProcessMetrics = (): ProcessMetrics => {
  const now = getTimestamp();
  return {
    startTime: now,
    lastStepTime: now,
    traceId: `flow-${now.toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`,
  };
};

const getResultImageRemoteUrl = (
  result?: AIImageResult | null
): string | undefined => {
  if (!result?.metadata) return undefined;
  const midMeta = result.metadata.midjourney as MidjourneyMetadata | undefined;
  if (midMeta?.imageUrl) return midMeta.imageUrl;
  if (typeof result.metadata.imageUrl === "string")
    return result.metadata.imageUrl;
  return undefined;
};

const logProcessStep = (
  metrics: ProcessMetrics | undefined,
  _label: string
) => {
  if (!metrics) return;
  const now = getTimestamp();
  metrics.lastStepTime = now;
  // 性能指标已记录
};

const ensureDataUrl = (imageData: string): string =>
  imageData.startsWith("data:image")
    ? imageData
    : `data:image/png;base64,${imageData}`;

const MAX_IMAGE_PREVIEW_SIZE = 512;
const buildImagePreviewSafely = async (
  dataUrl: string
): Promise<string | null> => {
  if (!dataUrl) return null;
  try {
    return await createImagePreviewDataUrl(dataUrl, {
      maxSize: MAX_IMAGE_PREVIEW_SIZE,
      mimeType: "image/webp",
      quality: 0.82,
    });
  } catch (error) {
    console.warn("⚠️ 生成图像缩略图失败:", error);
    return null;
  }
};

const cacheGeneratedImageResult = ({
  messageId,
  prompt,
  result,
  assets,
  inlineImageData,
}: {
  messageId: string;
  prompt: string;
  result: AIImageResult;
  assets?: { remoteUrl?: string; thumbnail?: string };
  inlineImageData?: string | null;
}) => {
  const resolvedImageId = result.id || messageId;
  const preview =
    assets?.thumbnail ||
    (inlineImageData ? ensureDataUrl(inlineImageData) : undefined);
  const remoteUrl = assets?.remoteUrl ?? getResultImageRemoteUrl(result);

  if (!preview && !remoteUrl) {
    return;
  }

  try {
    contextManager.cacheLatestImage(preview ?? null, resolvedImageId, prompt, {
      remoteUrl: remoteUrl ?? null,
    });
  } catch (error) {
    console.warn("⚠️ 缓存最新生成图像失败:", error);
  }
};

const LEGACY_INLINE_IMAGE_THRESHOLD = 350_000;
const isRemoteUrl = (value?: string | null): boolean =>
  typeof value === "string" && /^https?:\/\//i.test(value);
const normalizeInlineImageData = (value?: string | null): string | null => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) {
    // 处理重复 data URL 前缀的情况：
    // 例如 "data:image/png;base64,data:image/png;base64,AAAA..."
    const parts = trimmed.split(",");
    if (parts.length >= 3 && parts[1].startsWith("data:")) {
      const meta = parts[0];
      const last = parts[parts.length - 1];
      return `${meta},${last}`;
    }
    return trimmed;
  }
  const compact = trimmed.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 120) {
    return `data:image/png;base64,${compact}`;
  }
  return null;
};

const readBlobAsDataUrl = async (blob: Blob): Promise<string | null> => {
  try {
    return await blobToDataUrlLimited(blob);
  } catch {
    return null;
  }
};

const fetchImageAsDataUrl = async (url: string): Promise<string | null> => {
  try {
    const init: RequestInit = /^blob:/i.test(url)
      ? {}
      : { mode: "cors", credentials: "omit" };
    const response = await fetch(url, init);
    if (!response.ok) return null;
    const blob = await responseToBlob(response);
    return await readBlobAsDataUrl(blob);
  } catch (error) {
    console.warn("⚠️ 获取图片并转换为 DataURL 失败:", error);
    return null;
  }
};

const resolveImageInputToDataUrl = async (
  value?: string | null
): Promise<string | null> => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalizedInline = normalizeInlineImageData(trimmed);
  if (normalizedInline) return normalizedInline;

  if (/^blob:/i.test(trimmed) || isRemoteUrl(trimmed)) {
    return await fetchImageAsDataUrl(trimmed);
  }

  return null;
};

type CachedImagePayload = NonNullable<
  ReturnType<(typeof contextManager)["getCachedImage"]>
>;

const resolveCachedImageForImageTools = async (
  cached: CachedImagePayload
): Promise<string | null> => {
  return (
    (await resolveImageInputToDataUrl(cached.imageData)) ||
    (await resolveImageInputToDataUrl(cached.remoteUrl ?? null))
  );
};
const shouldUploadLegacyInline = (
  inline: string | null,
  remote?: string | null
) =>
  Boolean(
    inline &&
      !isRemoteUrl(remote) &&
      inline.length > LEGACY_INLINE_IMAGE_THRESHOLD
  );

const dropLargeInline = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // blob URL 仅在当前页面会话有效，不能持久化（刷新后会失效）
  if (/^blob:/i.test(trimmed)) return undefined;
  // remove whitespace to measure real length
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length > INLINE_MEDIA_LIMIT) return undefined;
  return compact;
};

type PlacementAssets = {
  remoteUrl?: string;
  thumbnail?: string;
};

const resolveImageForPlacement = ({
  inlineData,
  result,
  uploadedAssets,
  fallbackRemote,
}: {
  inlineData?: string | null;
  result?: AIImageResult | null;
  uploadedAssets?: PlacementAssets;
  fallbackRemote?: string | null;
}): string | null => {
  const inlineCandidate =
    normalizeInlineImageData(inlineData) ??
    normalizeInlineImageData(result?.imageData) ??
    normalizeInlineImageData(uploadedAssets?.thumbnail);

  if (inlineCandidate) {
    return ensureDataUrl(inlineCandidate);
  }

  const remoteCandidate =
    fallbackRemote ||
    uploadedAssets?.remoteUrl ||
    getResultImageRemoteUrl(result);

  return remoteCandidate || null;
};

const buildImagePayloadForUpload = (
  imageSrc: string,
  fileName: string
): string | StoredImageAsset => {
  if (!imageSrc) return imageSrc;
  let trimmed = imageSrc.trim();

  // 直接传递可用的 Blob URL
  if (/^blob:/i.test(trimmed)) {
    return trimmed;
  }

  // 规范化 Data URL，修复可能存在的重复前缀
  if (/^data:image\//i.test(trimmed)) {
    const normalized = normalizeInlineImageData(trimmed);
    return normalized ?? trimmed;
  }

  // 远程 URL：包装为资源对象，避免当作 Data URL 处理失败
  return {
    id: `remote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url: trimmed,
    src: trimmed,
    fileName,
    contentType: "image/png",
  };
};

const migrateMessageImagePayload = async (
  message: ChatMessage,
  projectId: string | null
): Promise<boolean> => {
  const inlineCandidate =
    normalizeInlineImageData(message.imageData) ??
    normalizeInlineImageData(message.thumbnail);
  if (!inlineCandidate) {
    return false;
  }
  let mutated = false;
  const preview = await buildImagePreviewSafely(inlineCandidate);
  if (preview && message.thumbnail !== preview) {
    message.thumbnail = preview;
    mutated = true;
  }
  if (
    preview &&
    typeof message.imageData === "string" &&
    message.imageData.startsWith("data:image") &&
    message.imageData !== preview
  ) {
    message.imageData = preview;
    mutated = true;
  }
  if (shouldUploadLegacyInline(inlineCandidate, message.imageRemoteUrl)) {
    const remoteUrl = await uploadImageToOSS(
      preview ?? inlineCandidate,
      projectId
    );
    if (remoteUrl) {
      message.imageRemoteUrl = remoteUrl;
      message.imageData = preview ?? message.imageData;
      mutated = true;
    }
  }
  return mutated;
};

const migrateCachedImagePayload = async (
  context: ConversationContext,
  projectId: string | null
): Promise<boolean> => {
  if (!context.cachedImages) {
    return false;
  }

  const inlineCandidate = normalizeInlineImageData(
    context.cachedImages.latest ?? null
  );
  if (!inlineCandidate) {
    return false;
  }
  let mutated = false;
  const preview = await buildImagePreviewSafely(inlineCandidate);
  if (preview && context.cachedImages.latest !== preview) {
    context.cachedImages.latest = preview;
    mutated = true;
  }
  if (
    shouldUploadLegacyInline(
      inlineCandidate,
      context.cachedImages.latestRemoteUrl
    )
  ) {
    const remoteUrl = await uploadImageToOSS(
      preview ?? inlineCandidate,
      projectId
    );
    if (remoteUrl) {
      context.cachedImages.latestRemoteUrl = remoteUrl;
      context.cachedImages.latest = preview ?? null;
      mutated = true;
    }
  }
  return mutated;
};

const migrateContextImageHistory = async (
  context: ConversationContext,
  projectId: string | null
): Promise<boolean> => {
  const store = useImageHistoryStore.getState();
  let mutated = false;
  const history = context.contextInfo?.imageHistory ?? [];

  for (const entry of history) {
    const inlineCandidate =
      normalizeInlineImageData(entry.imageData ?? null) ??
      normalizeInlineImageData(entry.thumbnail ?? null);
    let preview: string | null = null;

    if (inlineCandidate) {
      preview = await buildImagePreviewSafely(inlineCandidate);
      if (preview && entry.imageData !== preview) {
        entry.imageData = preview;
        mutated = true;
      }
      if (preview && entry.thumbnail !== preview) {
        entry.thumbnail = preview;
        mutated = true;
      }
    }

    if (
      inlineCandidate &&
      shouldUploadLegacyInline(inlineCandidate, entry.imageRemoteUrl)
    ) {
      const remoteUrl = await uploadImageToOSS(
        preview ?? inlineCandidate,
        projectId
      );
      if (remoteUrl) {
        entry.imageRemoteUrl = remoteUrl;
        entry.imageData = preview ?? entry.imageData;
        mutated = true;
      }
    }

    try {
      store.updateImage(entry.id, {
        remoteUrl: entry.imageRemoteUrl ?? undefined,
        thumbnail: entry.thumbnail ?? undefined,
        src:
          entry.imageRemoteUrl ||
          entry.thumbnail ||
          entry.imageData ||
          undefined,
      });
    } catch {
      // ignore history update failure
    }
  }

  return mutated;
};

const migrateLegacySessions = async (
  contexts: ConversationContext[],
  projectId: string | null
): Promise<boolean> => {
  let mutated = false;
  for (const context of contexts) {
    for (const message of context.messages) {
      if (await migrateMessageImagePayload(message, projectId)) {
        mutated = true;
      }
    }
    if (await migrateCachedImagePayload(context, projectId)) {
      mutated = true;
    }
    if (await migrateContextImageHistory(context, projectId)) {
      mutated = true;
    }
  }
  return mutated;
};

// ==================== Sora2 视频生成相关函数 ====================

export type Sora2VideoGenerationOptions = {
  onProgress?: (stage: string, progress: number) => void;
  quality?: Sora2VideoQuality;
  /** 画面比例，仅极速 Sora2 支持。例如 '16:9' | '9:16' */
  aspectRatio?: "16:9" | "9:16";
  /** 时长（秒），仅极速 Sora2 支持。例如 10 / 15 / 25 */
  durationSeconds?: 10 | 15 | 25;
};

export async function requestSora2VideoGeneration(
  prompt: string,
  referenceImageUrls?: string | string[] | null,
  options?: Sora2VideoGenerationOptions
) {
  options?.onProgress?.("提交视频生成请求", 35);

  const normalizedImages = Array.isArray(referenceImageUrls)
    ? referenceImageUrls
    : referenceImageUrls
    ? [referenceImageUrls]
    : [];

  const cleanedImageUrls = normalizedImages
    .filter(
      (url): url is string => typeof url === "string" && url.trim().length > 0
    )
    .map((url) => url.trim());

  // 将时长从 number 转为后端期望的字符串枚举
  const duration: "10" | "15" | "25" | undefined =
    options?.durationSeconds === 10 ||
    options?.durationSeconds === 15 ||
    options?.durationSeconds === 25
      ? (String(options.durationSeconds) as "10" | "15" | "25")
      : undefined;

  const response = await generateVideoViaAPI({
    prompt,
    referenceImageUrls: cleanedImageUrls.length ? cleanedImageUrls : undefined,
    quality: options?.quality,
    aspectRatio: options?.aspectRatio,
    duration,
  });

  if (!response.success || !response.data) {
    throw new Error(response.error?.message || "视频生成失败");
  }

  options?.onProgress?.("解析视频响应", 85);
  return response.data;
}
const downloadUrlAsDataUrl = async (url: string): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIDEO_FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      mode: "cors",
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn("⚠️ 下载缩略图失败:", url, response.status);
      return null;
    }
    const blob = await responseToBlob(response);
    return await blobToDataUrlLimited(blob);
  } catch (error) {
    console.warn("⚠️ 无法下载缩略图:", url, error);
    return null;
  }
};

const fetchVideoBlob = async (url: string): Promise<Blob | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(VIDEO_FETCH_TIMEOUT_MS, 12000)
    );
    const response = await fetch(url, {
      signal: controller.signal,
      mode: "cors",
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn("⚠️ 下载视频失败:", url, response.status);
      return null;
    }
    return await response.blob();
  } catch (error) {
    console.warn("⚠️ 无法下载视频:", url, error);
    return null;
  }
};

const captureVideoPosterFromBlob = async (
  blob: Blob
): Promise<string | null> => {
  if (typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(blob);
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      URL.revokeObjectURL(objectUrl);
    };

    const fail = () => {
      cleanup();
      resolve(null);
    };

    video.addEventListener("error", fail);
    video.addEventListener(
      "loadeddata",
      () => {
        try {
          const seekTime = Math.min(0.2, (video.duration || 1) * 0.1);
          const handleSeeked = () => {
            void (async () => {
              const canvas = document.createElement("canvas");
              canvas.width = video.videoWidth || 960;
              canvas.height = video.videoHeight || 540;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                fail();
                return;
              }
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const dataUrl = await canvasToDataUrl(canvas, "image/png");
              cleanup();
              resolve(dataUrl);
            })().catch((error) => {
              console.warn("⚠️ 无法捕获视频帧:", error);
              fail();
            });
          };
          if (seekTime > 0) {
            video.currentTime = seekTime;
            video.addEventListener("seeked", handleSeeked, { once: true });
          } else {
            handleSeeked();
          }
        } catch (error) {
          console.warn("⚠️ 设置视频截帧失败:", error);
          fail();
        }
      },
      { once: true }
    );

    video.src = objectUrl;
  });
};

const buildPlaceholderPoster = (
  prompt: string,
  videoUrl: string
): string | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(1, "#1e293b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(40, 40, canvas.width - 80, canvas.height - 80);

  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 48px "Inter", sans-serif';
  ctx.fillText("🎬 视频占位", 80, 120);

  ctx.font = '24px "Inter", sans-serif';
  const maxWidth = canvas.width - 160;
  const words = `${prompt}\n${videoUrl}`.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  if (currentLine) lines.push(currentLine);

  ctx.font = '24px "Inter", sans-serif';
  lines.slice(0, 5).forEach((line, index) => {
    ctx.fillText(line, 80, 180 + index * 36);
  });

  return canvas.toDataURL("image/png");
};

const buildVideoPoster = async (params: {
  prompt: string;
  videoUrl: string;
  thumbnailUrl?: string;
}): Promise<VideoPosterBuildResult | null> => {
  if (params.thumbnailUrl) {
    const downloaded = await downloadUrlAsDataUrl(params.thumbnailUrl);
    if (downloaded) {
      return {
        dataUrl: downloaded,
        origin: "thumbnail",
        sourceImageUrl: params.thumbnailUrl,
      };
    }
  }

  const blob = await fetchVideoBlob(params.videoUrl);
  if (blob) {
    const captured = await captureVideoPosterFromBlob(blob);
    if (captured) {
      return {
        dataUrl: captured,
        origin: "videoFrame",
        sourceImageUrl: params.videoUrl,
      };
    }
  }

  const placeholder = buildPlaceholderPoster(params.prompt, params.videoUrl);
  if (!placeholder) return null;
  return { dataUrl: placeholder, origin: "placeholder" };
};

const computeVideoSmartPosition = (): { x: number; y: number } | undefined => {
  try {
    const cached = contextManager.getCachedImage();
    if (cached?.bounds) {
      const offsetVertical =
        useUIStore.getState().smartPlacementOffsetVertical || 552;
      return {
        x: cached.bounds.x + cached.bounds.width / 2,
        y: cached.bounds.y + cached.bounds.height / 2 + offsetVertical,
      };
    }
  } catch (error) {
    console.warn("⚠️ 计算视频智能位置失败:", error);
  }
  return undefined;
};

const autoPlaceVideoOnCanvas = async (params: {
  prompt: string;
  videoUrl: string;
  thumbnailUrl?: string;
}) => {
  if (typeof window === "undefined") return null;
  try {
    const poster = await buildVideoPoster(params);
    if (!poster) return null;
    const smartPosition = computeVideoSmartPosition();
    window.dispatchEvent(
      new CustomEvent("triggerQuickImageUpload", {
        detail: {
          imageData: poster.dataUrl,
          fileName: `sora-video-${Date.now()}.png`,
          operationType: "video",
          smartPosition,
          videoInfo: {
            videoUrl: params.videoUrl,
            sourceUrl: params.videoUrl,
            thumbnailUrl: poster.sourceImageUrl ?? params.thumbnailUrl,
            prompt: params.prompt,
          },
        },
      })
    );
    return poster.dataUrl;
  } catch (error) {
    console.warn("⚠️ 自动投放视频缩略图失败:", error);
    return null;
  }
};

// ============================================================

async function buildRunningHubProviderOptions(params: {
  primaryImage: string;
  referenceImage?: string | null;
  projectId?: string | null;
  onStageUpdate?: RunningHubStageUpdater;
}): Promise<AIProviderOptions> {
  const { primaryImage, referenceImage, projectId, onStageUpdate } = params;

  onStageUpdate?.("上传SU截图", 25);
  const primaryDataUrl = await resolveImageToDataUrl(primaryImage);
  if (!primaryDataUrl) {
    throw new Error("SU 截图读取失败，请重新选择图片。");
  }
  const primaryUrl = await uploadImageToOSS(primaryDataUrl, projectId);
  if (!primaryUrl) {
    throw new Error("SU 截图上传失败，请稍后重试。");
  }

  const nodeInfoList: RunningHubGenerateOptions["nodeInfoList"] = [
    {
      nodeId: RUNNINGHUB_PRIMARY_NODE_ID,
      fieldName: "image",
      fieldValue: primaryUrl,
      description: "SU截图",
    },
  ];

  if (referenceImage) {
    onStageUpdate?.("上传参考图", 30);
    const referenceDataUrl = await resolveImageToDataUrl(referenceImage);
    if (!referenceDataUrl) {
      throw new Error("参考图读取失败，请重新选择图片。");
    }
    const referenceUrl = await uploadImageToOSS(referenceDataUrl, projectId);
    if (!referenceUrl) {
      throw new Error("参考图上传失败，请稍后重试。");
    }
    nodeInfoList.push({
      nodeId: RUNNINGHUB_REFERENCE_NODE_ID,
      fieldName: "image",
      fieldValue: referenceUrl,
      description: "参考图",
    });
  }

  const runningHubOptions: RunningHubGenerateOptions = {
    nodeInfoList,
  };

  if (RUNNINGHUB_WEBAPP_ID) {
    runningHubOptions.webappId = RUNNINGHUB_WEBAPP_ID;
  }

  if (RUNNINGHUB_WEBHOOK_URL) {
    runningHubOptions.webhookUrl = RUNNINGHUB_WEBHOOK_URL;
  }

  return {
    runningHub: runningHubOptions,
  };
}

// 🔥 图片上传到 OSS 的辅助函数
export async function uploadImageToOSS(
  imageData: string,
  projectId?: string | null
): Promise<string | null> {
  return aiChatUploadLimiter.run(async () => {
    try {
      if (!imageData || typeof imageData !== "string") {
        console.warn("⚠️ 无效的图片数据，跳过上传");
        return null;
      }

      // 优先用 fetch(dataURL/blobURL) -> blob，避免 atob+大数组导致 JS 堆峰值
      const blob =
        (await resolveImageToBlob(imageData, { preferProxy: true })) ||
        (imageData.includes("base64,") ? await dataURLToBlobAsync(imageData) : null);

      if (!blob) {
        console.warn("⚠️ 图片转换 Blob 失败，跳过上传");
        return null;
      }

      const result = await ossUploadService.uploadToOSS(blob, {
        dir: "ai-chat-images/",
        projectId,
        fileName: `ai-chat-${Date.now()}.png`,
        contentType: blob.type || "image/png",
        maxSize: 10 * 1024 * 1024, // 10MB
      });

      if (result.success && result.url) {
        return result.url;
      }
      console.error("❌ 图片上传失败:", result.error);
      return null;
    } catch (error) {
      console.error("❌ 图片上传异常:", error);
      return null;
    }
  });
}

const serializeConversation = async (
  context: ConversationContext
): Promise<SerializedConversationContext> => {
  const projectId = useProjectContentStore.getState().projectId;

  const isRemoteUrl = (value: string | undefined): boolean =>
    !!value && /^https?:\/\//.test(value);

  const messagesNeedingUpload = context.messages.filter(
    (msg) =>
      !!msg.imageData &&
      !isRemoteUrl(msg.imageData) &&
      !isRemoteUrl(msg.imageRemoteUrl) &&
      msg.imageData.trim().length > 0
  );

  // ⚠️ 用并发限制替换 Promise.all，避免一次性上传多张大图导致内存峰值
  const uploadResults = await mapWithLimit(
    messagesNeedingUpload,
    1,
    async (msg) => {
      try {
        const uploadInput = toRenderableImageSrc(msg.imageData) ?? msg.imageData!;
        const ossUrl = await uploadImageToOSS(uploadInput, projectId);
        return { messageId: msg.id, ossUrl };
      } catch (error) {
        console.warn("⚠️ 上传消息图片失败，使用本地数据回退:", error);
        return { messageId: msg.id, ossUrl: null };
      }
    }
  );
  

  const imageUrlMap = new Map<string, string | null>();
  uploadResults.forEach(({ messageId, ossUrl }) => {
    if (ossUrl) {
      imageUrlMap.set(messageId, ossUrl);
      const target = context.messages.find((m) => m.id === messageId);
      if (target) {
        target.imageRemoteUrl = ossUrl;
      }
    }
  });

  return {
    sessionId: context.sessionId,
    name: context.name,
    startTime: toISOString(context.startTime),
    lastActivity: toISOString(context.lastActivity),
    currentMode: context.currentMode,
    activeImageId: context.activeImageId ?? undefined,
    messages: context.messages.map((message) => {
      const remoteUrl =
        imageUrlMap.get(message.id) ||
        (isRemoteUrl(message.imageRemoteUrl)
          ? message.imageRemoteUrl
          : undefined) ||
        (isRemoteUrl(message.imageData) ? message.imageData : undefined);

      const fallbackThumbnail = dropLargeInline(
        message.thumbnail ??
          (!remoteUrl && message.imageData
            ? toRenderableImageSrc(message.imageData) ?? message.imageData
            : undefined)
      );

      const safeImageData = dropLargeInline(
        remoteUrl ? undefined : message.imageData
      );
      const safeSourceImageData = dropLargeInline(message.sourceImageData);
      const safeSourceImagesData = Array.isArray(message.sourceImagesData)
        ? message.sourceImagesData
            .map((v) => dropLargeInline(v))
            .filter((v): v is string => Boolean(v))
        : undefined;

      const serialized: SerializedChatMessage = {
        id: message.id,
        type: message.type,
        content: message.content,
        timestamp: toISOString(message.timestamp),
        webSearchResult: cloneSafely(message.webSearchResult),
        imageRemoteUrl: remoteUrl || undefined,
        imageUrl: remoteUrl || undefined,
        imageData: safeImageData,
        thumbnail: fallbackThumbnail,
        expectsImageOutput: message.expectsImageOutput,
        sourceImageData: safeSourceImageData,
        sourceImagesData: safeSourceImagesData,
        provider: message.provider,
        metadata: message.metadata ? cloneSafely(message.metadata) : undefined,
        generationStatus: message.generationStatus
          ? {
              isGenerating: !!message.generationStatus.isGenerating,
              progress: message.generationStatus.progress ?? 0,
              error: message.generationStatus.error ?? null,
              stage: message.generationStatus.stage,
            }
          : undefined,
        videoUrl: message.videoUrl,
        videoSourceUrl: message.videoSourceUrl,
        videoThumbnail: message.videoThumbnail,
        videoDuration: message.videoDuration,
        videoReferencedUrls: message.videoReferencedUrls,
        videoTaskId: message.videoTaskId ?? undefined,
        videoStatus: message.videoStatus ?? undefined,
        // 保留并行分组信息，确保刷新/持久化后仍能恢复为同一组
        groupId: message.groupId ?? undefined,
        groupIndex: message.groupIndex ?? undefined,
        groupTotal: message.groupTotal ?? undefined,
      };

      return serialized;
    }),
    operations: context.operations.map((operation) => ({
      id: operation.id,
      type: operation.type,
      timestamp: toISOString(operation.timestamp),
      input: operation.input,
      output: operation.output,
      success: operation.success,
      metadata: operation.metadata ? cloneSafely(operation.metadata) : null,
    })),
    cachedImages: {
      latest: dropLargeInline(context.cachedImages.latest) ?? null,
      latestId: context.cachedImages.latestId ?? null,
      latestPrompt: context.cachedImages.latestPrompt ?? null,
      timestamp: context.cachedImages.timestamp
        ? toISOString(context.cachedImages.timestamp)
        : null,
      latestBounds: context.cachedImages.latestBounds ?? null,
      latestLayerId: context.cachedImages.latestLayerId ?? null,
      latestRemoteUrl: context.cachedImages.latestRemoteUrl ?? null,
    },
    contextInfo: {
      userPreferences: cloneSafely(context.contextInfo.userPreferences ?? {}),
      recentPrompts: [...context.contextInfo.recentPrompts],
      imageHistory: context.contextInfo.imageHistory.map((item) => ({
        id: item.id,
        prompt: item.prompt,
        timestamp: toISOString(item.timestamp),
        operationType: item.operationType,
        parentImageId: item.parentImageId ?? null,
        thumbnail: dropLargeInline(item.thumbnail) ?? null,
        imageRemoteUrl: item.imageRemoteUrl ?? null,
        imageData: dropLargeInline(item.imageData) ?? null,
      })),
      iterationCount: context.contextInfo.iterationCount,
      lastOperationType: context.contextInfo.lastOperationType,
    },
  };
};

const hasRenderableMedia = (message: {
  imageData?: string | null;
  imageRemoteUrl?: string | null;
  imageUrl?: string | null;
  thumbnail?: string | null;
  videoUrl?: string | null;
  videoThumbnail?: string | null;
}): boolean =>
  Boolean(
    message.imageData ||
      message.imageRemoteUrl ||
      message.imageUrl ||
      message.thumbnail ||
      message.videoUrl ||
      message.videoThumbnail
  );

const shouldDropMessageOnHydrate = (
  message: SerializedChatMessage
): boolean => {
  const hasMedia = hasRenderableMedia(message);
  if (message.type === "error") {
    return true;
  }
  if (message.type === "ai" && message.generationStatus?.error && !hasMedia) {
    return true;
  }
  return false;
};

const hydrateMessageGenerationState = (message: ChatMessage): ChatMessage => {
  if (message.type !== "ai") return message;
  const status = message.generationStatus;
  if (!status) return message;

  const wasInFlight = !!status.isGenerating;
  const hadError =
    typeof status.error === "string" && status.error.trim().length > 0;
  if (!wasInFlight && !hadError) return message;

  const normalizeContent =
    wasInFlight && (message.content?.trim() || "") === "正在准备处理您的请求..."
      ? "上次请求在刷新后已终止，请重新发送。"
      : message.content;
  const hasMedia = hasRenderableMedia(message);

  return {
    ...message,
    content: normalizeContent,
    generationStatus: hasMedia
      ? {
          ...status,
          isGenerating: false,
          progress: status.progress ?? (hadError ? 0 : 100),
          error: null,
          stage: undefined,
        }
      : undefined,
    expectsImageOutput: hasMedia ? message.expectsImageOutput : false,
    expectsVideoOutput: hasMedia ? message.expectsVideoOutput : false,
  };
};

const deserializeConversation = (
  data: SerializedConversationContext
): ConversationContext => {
  const messages: ChatMessage[] = data.messages
    .filter((message) => !shouldDropMessageOnHydrate(message))
    .map((message) => {
      const remoteUrl =
        (message as any).imageRemoteUrl || (message as any).imageUrl;
      const baseImage = message.imageData;
      const thumbnail = message.thumbnail;
      return hydrateMessageGenerationState({
        id: message.id,
        type: message.type,
        content: message.content,
        timestamp: new Date(message.timestamp),
        webSearchResult: message.webSearchResult,
        imageData: baseImage,
        imageRemoteUrl: remoteUrl,
        thumbnail,
        // 恢复并行分组信息，保证刷新后同组消息仍能被识别并一起渲染
        groupId: (message as any).groupId ?? undefined,
        groupIndex: (message as any).groupIndex ?? undefined,
        groupTotal: (message as any).groupTotal ?? undefined,
        expectsImageOutput: message.expectsImageOutput,
        sourceImageData: message.sourceImageData,
        sourceImagesData: message.sourceImagesData,
        provider: message.provider as AIProviderType | undefined,
        metadata: message.metadata ? { ...message.metadata } : undefined,
        generationStatus: message.generationStatus
          ? {
              isGenerating: !!message.generationStatus.isGenerating,
              progress: message.generationStatus.progress ?? 0,
              error: message.generationStatus.error ?? null,
              stage: message.generationStatus.stage,
            }
          : undefined,
        videoUrl: message.videoUrl,
        videoSourceUrl: message.videoSourceUrl,
        videoThumbnail: message.videoThumbnail,
        videoDuration: message.videoDuration,
        videoReferencedUrls: message.videoReferencedUrls,
        videoTaskId: message.videoTaskId ?? null,
        videoStatus: message.videoStatus ?? null,
      });
    });

  const operations: OperationHistory[] = data.operations.map((operation) => ({
    id: operation.id,
    type: operation.type,
    timestamp: new Date(operation.timestamp),
    input: operation.input,
    output: operation.output,
    success: operation.success,
    metadata: operation.metadata ?? undefined,
  }));

  return {
    sessionId: data.sessionId,
    name: data.name,
    startTime: new Date(data.startTime),
    lastActivity: new Date(data.lastActivity),
    messages,
    operations,
    currentMode: data.currentMode,
    activeImageId: data.activeImageId ?? undefined,
    cachedImages: {
      latest: null,
      latestId: data.cachedImages.latestId ?? null,
      latestPrompt: data.cachedImages.latestPrompt ?? null,
      timestamp: data.cachedImages.timestamp
        ? new Date(data.cachedImages.timestamp)
        : null,
      latestBounds: data.cachedImages.latestBounds ?? null,
      latestLayerId: data.cachedImages.latestLayerId ?? null,
      latestRemoteUrl: data.cachedImages.latestRemoteUrl ?? null,
    },
    contextInfo: {
      userPreferences: cloneSafely(data.contextInfo.userPreferences ?? {}),
      recentPrompts: [...data.contextInfo.recentPrompts],
      imageHistory: data.contextInfo.imageHistory.map((item) => ({
        id: item.id,
        imageData:
          item.imageRemoteUrl || item.imageData || item.thumbnail || "",
        imageRemoteUrl: item.imageRemoteUrl || undefined,
        prompt: item.prompt,
        timestamp: new Date(item.timestamp),
        operationType: item.operationType,
        parentImageId: item.parentImageId ?? undefined,
        thumbnail: item.thumbnail ?? undefined,
      })),
      iterationCount: data.contextInfo.iterationCount,
      lastOperationType: data.contextInfo.lastOperationType,
    },
  };
};

const sessionsEqual = (
  a: SerializedConversationContext[] | undefined,
  b: SerializedConversationContext[]
): boolean => JSON.stringify(a ?? []) === JSON.stringify(b);

interface AIChatState {
  // 对话框状态
  isVisible: boolean;
  isMaximized: boolean; // 对话框是否最大化

  // 输入状态
  currentInput: string;

  // 会话管理
  currentSessionId: string | null;
  sessions: ChatSessionSummary[];

  // 生成状态
  generationStatus: GenerationStatus;

  // 消息历史
  messages: ChatMessage[];

  // 最近生成的图像
  lastGeneratedImage: AIImageResult | null;

  // 图生图状态
  sourceImageForEditing: string | null; // 当前用于编辑的源图像

  // 多图融合状态
  sourceImagesForBlending: string[]; // 当前用于融合的多张图像

  // 图像分析状态
  sourceImageForAnalysis: string | null; // 当前用于分析的源图像

  // PDF 分析状态
  sourcePdfForAnalysis: string | null; // 当前用于分析的 PDF 文件 (base64)
  sourcePdfFileName: string | null; // 当前上传的 PDF 文件名（用于 UI 提示）

  // 配置选项
  autoDownload: boolean; // 是否自动下载生成的图片
  enableWebSearch: boolean; // 是否启用联网搜索
  imageOnly: boolean; // 仅返回图像，不返回文本（适用于图像生成/编辑/融合）
  aspectRatio:
    | "1:1"
    | "2:3"
    | "3:2"
    | "3:4"
    | "4:3"
    | "4:5"
    | "5:4"
    | "9:16"
    | "16:9"
    | "21:9"
    | null; // 图像长宽比
  imageSize: "1K" | "2K" | "4K" | null; // 图像尺寸（高清设置，仅 Gemini 3）
  thinkingLevel: "high" | "low" | null; // 思考级别（仅 Gemini 3）
  manualAIMode: ManualAIMode;
  aiProvider: AIProviderType; // AI提供商选择 (gemini: Google Gemini, banana: 147 API, runninghub: SU截图转效果, midjourney: 147 Midjourney)
  autoModeMultiplier: AutoModeMultiplier;
  sendShortcut: SendShortcut;
  expandedPanelStyle: "transparent" | "solid"; // 展开/最大化模式的面板样式

  // 操作方法
  showDialog: () => void;
  hideDialog: () => void;
  toggleDialog: () => void;
  setIsMaximized: (value: boolean) => void; // 设置最大化状态

  // 输入管理
  setCurrentInput: (input: string) => void;
  clearInput: () => void;

  // 消息管理
  addMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => ChatMessage;
  clearMessages: () => void;
  updateMessageStatus: (
    messageId: string,
    status: Partial<ChatMessage["generationStatus"]>
  ) => void;
  updateMessage: (
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage
  ) => void;
  refreshSessions: (options?: {
    persistToLocal?: boolean;
    markProjectDirty?: boolean;
  }) => Promise<void>;
  createSession: (name?: string) => Promise<string>;
  switchSession: (sessionId: string) => Promise<void>;
  renameCurrentSession: (name: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  hydratePersistedSessions: (
    sessions: SerializedConversationContext[],
    activeSessionId?: string | null,
    options?: { markProjectDirty?: boolean }
  ) => void;
  resetSessions: () => void;

  // 图像生成
  generateImage: (
    prompt: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // 图生图功能
  editImage: (
    prompt: string,
    sourceImage: string,
    showImagePlaceholder?: boolean,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;
  setSourceImageForEditing: (imageData: string | null) => void;

  // 画布选中图片同步到AI对话框
  setSourceImagesFromCanvas: (images: string[]) => void;

  // 多图融合功能
  blendImages: (
    prompt: string,
    sourceImages: string[],
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;
  addImageForBlending: (imageData: string) => void;
  removeImageFromBlending: (index: number) => void;
  clearImagesForBlending: () => void;
  executeMidjourneyAction: (options: MidjourneyActionOptions) => Promise<void>;

  // 图像分析功能
  analyzeImage: (
    prompt: string,
    sourceImage: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;
  setSourceImageForAnalysis: (imageData: string | null) => void;

  // PDF 分析功能
  analyzePdf: (
    prompt: string,
    sourcePdf: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;
  setSourcePdfForAnalysis: (
    pdfData: string | null,
    fileName?: string | null
  ) => void;

  // 文本对话功能
  generateTextResponse: (
    prompt: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // 视频生成功能
  generateVideo: (
    prompt: string,
    referenceImage?: string | null,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // Paper.js 向量图形生成功能
  generatePaperJSCode: (
    prompt: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // 图像转矢量功能
  img2Vector: (
    prompt: string,
    sourceImage: string,
    style?: "simple" | "detailed" | "artistic",
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => Promise<void>;

  // 智能工具选择功能
  processUserInput: (input: string) => Promise<void>;

  // 核心处理流程
  executeProcessFlow: (
    input: string,
    isRetry?: boolean,
    groupInfo?: { groupId: string; groupIndex: number; groupTotal: number }
  ) => Promise<void>;

  // 🔥 并行图片生成（使用预创建的消息）
  executeParallelImageGeneration: (
    input: string,
    options: {
      groupId: string;
      groupIndex: number;
      groupTotal: number;
      userMessageId: string;
      aiMessageId: string;
    }
  ) => Promise<void>;

  // 智能模式检测
  getAIMode: () =>
    | "generate"
    | "edit"
    | "blend"
    | "analyze"
    | "analyzePdf"
    | "text"
    | "video"
    | "vector";

  // 配置管理
  toggleAutoDownload: () => void;
  setAutoDownload: (value: boolean) => void;
  toggleWebSearch: () => void;
  setWebSearch: (value: boolean) => void;
  toggleImageOnly: () => void; // 切换仅图像模式
  setImageOnly: (value: boolean) => void;
  setAspectRatio: (
    ratio:
      | "1:1"
      | "2:3"
      | "3:2"
      | "3:4"
      | "4:3"
      | "4:5"
      | "5:4"
      | "9:16"
      | "16:9"
      | "21:9"
      | null
  ) => void; // 设置长宽比
  setImageSize: (size: "1K" | "2K" | "4K" | null) => void; // 设置图像尺寸
  setThinkingLevel: (level: "high" | "low" | null) => void; // 设置思考级别
  setManualAIMode: (mode: ManualAIMode) => void;
  setAIProvider: (provider: AIProviderType) => void; // 设置AI提供商
  setAutoModeMultiplier: (multiplier: AutoModeMultiplier) => void;
  setSendShortcut: (shortcut: SendShortcut) => void;
  setExpandedPanelStyle: (style: "transparent" | "solid") => void; // 设置展开模式面板样式

  // 重置状态
  resetState: () => void;

  // 🧠 上下文管理方法
  initializeContext: () => void;
  getContextSummary: () => string;
  isIterativeMode: () => boolean;
  enableIterativeMode: () => void;
  disableIterativeMode: () => void;
}

export const useAIChatStore = create<AIChatState>()(
  persist(
    (set, get) => {
      const registerMessageImageHistory = async ({
        aiMessageId,
        prompt,
        result,
        operationType,
        skipPreview,
      }: {
        aiMessageId: string;
        prompt: string;
        result: AIImageResult;
        operationType: "generate" | "edit" | "blend";
        skipPreview?: boolean;
      }): Promise<{ remoteUrl?: string; thumbnail?: string }> => {
        if (!result.imageData) {
          return {};
        }
        const inlineImageData = result.imageData;

        return aiChatHistoryLimiter.run(async () => {
          const dataUrl = ensureDataUrl(inlineImageData);
          const previewDataUrl = skipPreview
            ? null
            : await buildImagePreviewSafely(dataUrl);
          const projectId = useProjectContentStore.getState().projectId;
          let remoteUrl: string | undefined;
          try {
            const historyRecord = await recordImageHistoryEntry({
              dataUrl,
              title: prompt,
              nodeId: aiMessageId,
              nodeType: "generate",
              projectId,
              dir: "ai-chat-history/",
              keepThumbnail: Boolean(previewDataUrl),
              thumbnailDataUrl: previewDataUrl ?? undefined,
            });
            remoteUrl = historyRecord.remoteUrl;
          } catch (error) {
            console.warn("⚠️ 记录AI图像历史失败:", error);
          }

          // 缩略图优先：previewDataUrl（小）-> remoteUrl（小）-> dataUrl（大，仅兜底）
          const thumbnail = previewDataUrl ?? remoteUrl ?? dataUrl;

          const historyEntry = {
            prompt,
            operationType,
            imageData: previewDataUrl ?? (remoteUrl ? undefined : dataUrl),
            parentImageId: undefined,
            thumbnail,
            imageRemoteUrl: remoteUrl,
          };

          const storedHistory = contextManager.addImageHistory(historyEntry);

          try {
            useImageHistoryStore.getState().addImage({
              id: storedHistory.id,
              src: remoteUrl || dataUrl,
              remoteUrl: remoteUrl ?? undefined,
              thumbnail,
              title: prompt,
              nodeId: aiMessageId,
              nodeType: "generate",
              projectId,
              timestamp: storedHistory.timestamp.getTime(),
            });
          } catch (error) {
            console.warn("⚠️ 更新图片历史Store失败:", error);
          }

          const assets = {
            remoteUrl: remoteUrl ?? undefined,
            thumbnail,
          };

          // 🔥 若图片已落到画布（placeholderId 对应画布 imageId），尽早把画布图片升级为远程 URL，并释放 base64/blob 内存
          if (assets.remoteUrl && typeof window !== "undefined") {
            try {
              const placeholderId = `ai-placeholder-${aiMessageId}`;
              window.dispatchEvent(
                new CustomEvent("tanva:upgradeImageSource", {
                  detail: {
                    placeholderId,
                    remoteUrl: assets.remoteUrl,
                    aiMessageId,
                  },
                })
              );
            } catch {
              // ignore
            }
          }

          if (assets.remoteUrl || assets.thumbnail) {
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              imageRemoteUrl: assets.remoteUrl || msg.imageRemoteUrl,
              thumbnail: assets.thumbnail ?? msg.thumbnail,
              // 🔥 不在此处强制清空 imageData：对话框/画布仍可能短时间依赖 base64；
              // 统一由外层（generate/edit/blend）在上传成功后延迟清理，避免闪烁/失败回退问题。
            }));

            const context = contextManager.getCurrentContext();
            if (context) {
              const target = context.messages.find((m) => m.id === aiMessageId);
              if (target) {
                target.imageRemoteUrl = assets.remoteUrl || target.imageRemoteUrl;
                target.thumbnail = assets.thumbnail ?? target.thumbnail;
              }
            }
          }

          return assets;
        });
      };

      const triggerLegacyMigration = (
        reason: string,
        markProjectDirty: boolean
      ) => {
        if (legacyMigrationInProgress) {
          return;
        }
        legacyMigrationInProgress = true;
        void (async () => {
          try {
            const contexts = contextManager.getAllSessions();
            const projectId =
              useProjectContentStore.getState().projectId ?? null;
            const migrated = await migrateLegacySessions(contexts, projectId);
            if (!migrated) {
              return;
            }

            const activeSessionId =
              get().currentSessionId ?? contextManager.getCurrentSessionId();
            if (activeSessionId) {
              const updatedContext = contextManager.getSession(activeSessionId);
              if (updatedContext) {
                set({ messages: [...updatedContext.messages] });
              }
            }

            await get().refreshSessions({ markProjectDirty });
          } catch (error) {
            console.error(`❌ ${reason} 会话迁移失败:`, error);
          } finally {
            legacyMigrationInProgress = false;
          }
        })();
      };

      const ensureActiveSession = (): string | null => {
        let sessionId =
          get().currentSessionId || contextManager.getCurrentSessionId();
        if (!sessionId) {
          sessionId = contextManager.createSession();
          set({ currentSessionId: sessionId });
        } else if (contextManager.getCurrentSessionId() !== sessionId) {
          contextManager.switchSession(sessionId);
        }
        return sessionId;
      };

      const sanitizeImageInput = (value?: string | null): string | null => {
        if (!value) return null;
        const normalized = normalizeInlineImageData(value);
        if (normalized) return normalized;
        const trimmed = typeof value === "string" ? value.trim() : "";
        return trimmed ? trimmed : null;
      };

      return {
        // 初始状态
        isVisible: true,
        isMaximized: false, // 默认不最大化
        currentInput: "",
        currentSessionId: null,
        sessions: [],
        generationStatus: {
          isGenerating: false,
          progress: 0,
          error: null,
        },
        messages: [],
        lastGeneratedImage: null,
        sourceImageForEditing: null, // 图生图源图像
        sourceImagesForBlending: [], // 多图融合源图像数组
        sourceImageForAnalysis: null, // 图像分析源图像
        sourcePdfForAnalysis: null, // PDF 分析源文件
        sourcePdfFileName: null,
        autoDownload: false, // 默认不自动下载
        enableWebSearch: false, // 默认关闭联网搜索
        imageOnly: false, // 默认允许返回文本
        aspectRatio: null, // 默认不指定长宽比
        imageSize: null, // 默认图像尺寸为自动（自动模式下优先使用1K）
        thinkingLevel: null, // 默认不指定思考级别
        manualAIMode: "auto",
        aiProvider: "banana-2.5", // 默认国内极速版
        autoModeMultiplier: 1,
        sendShortcut: "enter",
        expandedPanelStyle: "transparent", // 默认透明样式

        // 对话框控制
        showDialog: () => {
          ensureActiveSession();
          set({ isVisible: true });
        },
        hideDialog: () => set({ isVisible: false }),
        toggleDialog: () => set((state) => ({ isVisible: !state.isVisible })),
        setIsMaximized: (value) => set({ isMaximized: value }),

        // 输入管理
        setCurrentInput: (input) => set({ currentInput: input }),
        clearInput: () => set({ currentInput: "" }),

        // 消息管理
        addMessage: (message) => {
          let sessionId = get().currentSessionId;

          if (!sessionId) {
            sessionId =
              contextManager.getCurrentSessionId() ||
              contextManager.createSession();
            set({ currentSessionId: sessionId });
          } else if (contextManager.getCurrentSessionId() !== sessionId) {
            contextManager.switchSession(sessionId);
          }

          let storedMessage: ChatMessage | null = null;
          const context = contextManager.getCurrentContext();
          const lastMessage = context?.messages[context.messages.length - 1];

          if (
            lastMessage &&
            lastMessage.type === message.type &&
            lastMessage.content === message.content
          ) {
            storedMessage = lastMessage;
          }

          if (!storedMessage) {
            storedMessage = contextManager.addMessage(message);
          }

          set((state) => {
            let nextMessages = state.messages.some(
              (msg) => msg.id === storedMessage!.id
            )
              ? state.messages
              : [...state.messages, storedMessage!];

            // 🛑 硬性限制消息数量 (P0 修复)
            if (nextMessages.length > MAX_MESSAGES_PER_SESSION) {
              nextMessages = nextMessages.slice(-MAX_MESSAGES_PER_SESSION);
            }

            // 🧹 内存优化：清理旧消息中的大型 Base64 (P0 修复)
            nextMessages = optimizeMessagesMemory(nextMessages);

            return { messages: nextMessages };
          });
          return storedMessage!;
        },

        clearMessages: () => {
          const state = get();
          const sessionId =
            state.currentSessionId || contextManager.getCurrentSessionId();
          if (sessionId) {
            const context = contextManager.getSession(sessionId);
            if (context) {
              context.messages = [];
              context.lastActivity = new Date();
            }
          }
          set({ messages: [] });
        },

        updateMessageStatus: (messageId, status) => {
          set((state) => ({
            messages: optimizeMessagesMemory(
              state.messages.map((msg) =>
                msg.id === messageId
                  ? {
                      ...msg,
                      generationStatus: {
                        ...msg.generationStatus,
                        ...status,
                      } as any,
                    }
                  : msg
              )
            ),
          }));

          // 同步更新到 contextManager
          const context = contextManager.getCurrentContext();
          if (context) {
            const message = context.messages.find((m) => m.id === messageId);
            if (message) {
              message.generationStatus = {
                ...message.generationStatus,
                ...status,
              } as any;
            }
          }

          // 派发占位符进度更新事件
          if (
            status &&
            typeof status.progress === "number" &&
            typeof window !== "undefined"
          ) {
            const placeholderId = `ai-placeholder-${messageId}`;
            try {
              window.dispatchEvent(
                new CustomEvent("updatePlaceholderProgress", {
                  detail: {
                    placeholderId,
                    progress: status.progress,
                  },
                })
              );
              // 占位框的清理交由生成/上传流程完成，避免在 100% 时提前移除导致落位信息丢失
            } catch (error) {
              placeholderLogger.warn("派发占位符进度更新事件失败", error);
            }
          }
        },

        updateMessage: (messageId, updater) => {
          set((state) => {
            const nextMessages = state.messages.map((msg) =>
              msg.id === messageId ? updater({ ...msg }) : msg
            );
            return {
              messages: optimizeMessagesMemory(nextMessages),
            };
          });

          const context = contextManager.getCurrentContext();
          if (context) {
            const index = context.messages.findIndex(
              (msg) => msg.id === messageId
            );
            if (index >= 0) {
              context.messages[index] = updater({ ...context.messages[index] });
            }
          }
        },

        refreshSessions: async (options) => {
          // 🔥 防止在水合过程中调用
          if (isHydratingNow) {
            return;
          }

          // 🔥 实现防抖：清除之前的定时器，300ms后执行
          if (refreshSessionsTimeout) {
            clearTimeout(refreshSessionsTimeout);
          }

          return new Promise<void>((resolve) => {
            refreshSessionsTimeout = setTimeout(async () => {
              try {
                const { markProjectDirty = true } = options ?? {};
                const listedSessions = contextManager.listSessions();
                const sessionSummaries = listedSessions.map((session) => ({
                  sessionId: session.sessionId,
                  name: session.name,
                  lastActivity: session.lastActivity,
                  messageCount: session.messageCount,
                  preview: session.preview,
                }));

                // 🔥 异步序列化会话（上传图片到 OSS）
                const serializedSessionsPromises = listedSessions
                  .map((session) =>
                    contextManager.getSession(session.sessionId)
                  )
                  .filter(
                    (context): context is ConversationContext => !!context
                  )
                  .map((context) => serializeConversation(context));

                const serializedSessions = await Promise.all(
                  serializedSessionsPromises
                );

                set({ sessions: sessionSummaries });

                const activeSessionId =
                  get().currentSessionId ??
                  contextManager.getCurrentSessionId() ??
                  null;

                if (markProjectDirty) {
                  const projectStore = useProjectContentStore.getState();
                  if (projectStore.projectId && projectStore.hydrated) {
                    const previousSessions =
                      projectStore.content?.aiChatSessions ?? [];
                    const previousActive =
                      projectStore.content?.aiChatActiveSessionId ?? null;
                    if (
                      !sessionsEqual(previousSessions, serializedSessions) ||
                      (previousActive ?? null) !== (activeSessionId ?? null)
                    ) {
                      projectStore.updatePartial(
                        {
                          aiChatSessions: serializedSessions,
                          aiChatActiveSessionId: activeSessionId ?? null,
                        },
                        { markDirty: true }
                      );
                    }
                  } else {
                    // 无项目场景：把会话持久化到 IndexedDB
                    writeSessionsToIDB(serializedSessions, activeSessionId);
                  }
                }
              } finally {
                refreshSessionsTimeout = null;
                resolve();
              }
            }, 300);
          });
        },

        createSession: async (name) => {
          const sessionId = contextManager.createSession(name);
          const context = contextManager.getCurrentContext();
          set({
            currentSessionId: sessionId,
            messages: context ? [...context.messages] : [],
          });
          get().refreshSessions();
          return sessionId;
        },

        switchSession: async (sessionId) => {
          const switched = contextManager.switchSession(sessionId);
          if (!switched) return;
          const context = contextManager.getSession(sessionId);
          set({
            currentSessionId: sessionId,
            messages: context ? [...context.messages] : [],
          });
          get().refreshSessions();
        },

        renameCurrentSession: async (name) => {
          const sessionId = get().currentSessionId;
          if (!sessionId) return;
          if (contextManager.renameSession(sessionId, name)) {
            get().refreshSessions();
          }
        },

        deleteSession: async (sessionId) => {
          const removed = contextManager.deleteSession(sessionId);
          if (!removed) return;

          const activeId = contextManager.getCurrentSessionId();
          let nextMessages: ChatMessage[] = [];
          if (activeId) {
            const context = contextManager.getSession(activeId);
            if (context) {
              nextMessages = [...context.messages];
            }
          }

          set({
            currentSessionId: activeId || null,
            messages: nextMessages,
          });
          get().refreshSessions();
        },

        hydratePersistedSessions: (
          sessions,
          activeSessionId = null,
          options
        ) => {
          const markProjectDirty = options?.markProjectDirty ?? false;

          // 🔥 设置hydrating标记，防止refreshSessions被调用
          isHydratingNow = true;

          try {
            hasHydratedSessions = true;

            contextManager.resetSessions();
            try {
              useImageHistoryStore.getState().clearHistory();
            } catch (error) {
              console.warn("⚠️ 清空图片历史失败:", error);
            }

            sessions.forEach((session) => {
              try {
                const context = deserializeConversation(session);
                contextManager.importSessionData(context);
              } catch (error) {
                console.error("❌ 导入会话失败:", error);
              }
            });

            try {
              const imageHistoryStore = useImageHistoryStore.getState();
              const projectId = useProjectContentStore.getState().projectId;
              const contexts = contextManager.getAllSessions();
              contexts.forEach((context) => {
                context.contextInfo.imageHistory.forEach((item) => {
                  const src =
                    item.imageRemoteUrl || item.imageData || item.thumbnail;
                  if (!src) return;
                  imageHistoryStore.addImage({
                    id: item.id,
                    src,
                    remoteUrl: item.imageRemoteUrl ?? undefined,
                    thumbnail: item.thumbnail ?? undefined,
                    title: item.prompt || "图片",
                    nodeId: item.parentImageId || item.id,
                    nodeType: "generate",
                    projectId,
                    timestamp: item.timestamp.getTime(),
                  });
                });
              });
            } catch (error) {
              console.warn("⚠️ 回填图片历史失败:", error);
            }

            const availableSessions = contextManager.listSessions();
            const candidateIds = new Set(
              availableSessions.map((session) => session.sessionId)
            );

            let targetSessionId: string | null = null;
            if (activeSessionId && candidateIds.has(activeSessionId)) {
              contextManager.switchSession(activeSessionId);
              targetSessionId = activeSessionId;
            } else if (availableSessions.length > 0) {
              const fallbackId = availableSessions[0].sessionId;
              contextManager.switchSession(fallbackId);
              targetSessionId = fallbackId;
            }

            if (!targetSessionId) {
              targetSessionId = contextManager.createSession();
            }

            const context = targetSessionId
              ? contextManager.getSession(targetSessionId)
              : null;
            set({
              currentSessionId: targetSessionId,
              messages: context ? [...context.messages] : [],
            });

            triggerLegacyMigration(
              "hydratePersistedSessions",
              markProjectDirty
            );
          } finally {
            // 🔥 清除hydrating标记，允许refreshSessions执行
            isHydratingNow = false;

            // 🔥 水合完成后，执行一次refreshSessions
            get().refreshSessions({ markProjectDirty });
          }
        },

        resetSessions: () => {
          // 🔥 防止在hydration期间重置
          if (isHydratingNow) {
            return;
          }

          contextManager.resetSessions();

          const sessionId = contextManager.createSession();
          const context = contextManager.getSession(sessionId);
          set({
            currentSessionId: sessionId,
            messages: context ? [...context.messages] : [],
          });
          hasHydratedSessions = true;
          get().refreshSessions({ markProjectDirty: false });
        },

        // 图像生成主函数（支持并行）
        generateImage: async (
          prompt: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "generateImage entered");

          // 🔥 并行模式：不检查全局状态，每个请求独立
          // 🔥 立即增加正在生成的图片计数
          generatingImageCount++;

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.aiMessageId, (msg) => ({
              ...msg,
              content: "正在生成图像...",
              expectsImageOutput: true,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            // 添加用户消息
            state.addMessage({
              type: "user",
              content: prompt,
            });

            // 🔥 创建占位 AI 消息，带有初始生成状态
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在生成图像...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              expectsImageOutput: true,
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }

          const placeholderId = `ai-placeholder-${aiMessageId}`;
          const removePredictivePlaceholder = () => {
            dispatchPlaceholderEvent(
              {
                placeholderId,
                center: { x: 0, y: 0 },
                width: 0,
                height: 0,
                operationType: "generate",
              },
              "remove"
            );
          };

          try {
            const cached = contextManager.getCachedImage();
            const offsetHorizontal =
              useUIStore.getState().smartPlacementOffsetHorizontal || 522;
            const offsetVertical =
              useUIStore.getState().smartPlacementOffsetVertical || 552;
            let center: { x: number; y: number } | null = null;

            // 🔥 检查是否是并行生成的一部分
            const currentMsg = get().messages.find((m) => m.id === aiMessageId);
            const groupId = currentMsg?.groupId;
            const groupIndex = currentMsg?.groupIndex ?? 0;
            const groupTotal = currentMsg?.groupTotal ?? 1;
            const isParallelGeneration = groupTotal > 1;
            let layoutAnchor: { x: number; y: number } | null = null;

            placeholderLogger.debug(
              "🎯 [generateImage] 准备显示占位符, cached:",
              cached,
              "groupIndex:",
              groupIndex,
              "groupTotal:",
              groupTotal
            );

            if (isParallelGeneration) {
              // 🔥 并行生成：根据 groupIndex 计算不同的位置，避免重叠
              // X4模式：4张图片横向排列成一行
              // 基准位置：缓存图片下方或视口中心
              let baseX: number;
              let baseY: number;

              if (cached?.bounds) {
                // 基于缓存图片位置，在其下方开始新的一行
                baseX = cached.bounds.x + cached.bounds.width / 2;
                baseY =
                  cached.bounds.y + cached.bounds.height / 2 + offsetVertical;
              } else {
                const viewCenter = getViewCenter();
                baseX = viewCenter?.x ?? 0;
                baseY = viewCenter?.y ?? 0;
              }

              layoutAnchor = { x: baseX, y: baseY };

              // 横向排列：每张图片向右偏移 offsetHorizontal
              // groupIndex: 0, 1, 2, 3 -> 横向排列
              center = {
                x: baseX + groupIndex * offsetHorizontal,
                y: baseY,
              };
              placeholderLogger.debug(
                `🎯 [generateImage] 并行生成第${
                  groupIndex + 1
                }/${groupTotal}张，横向排列位置:`,
                center
              );
            } else {
              // 单张生成：使用原有逻辑
              if (cached?.bounds) {
                center = {
                  x:
                    cached.bounds.x +
                    cached.bounds.width / 2 +
                    offsetHorizontal,
                  y: cached.bounds.y + cached.bounds.height / 2,
                };
                layoutAnchor = { ...center };
                placeholderLogger.debug(
                  "🎯 [generateImage] 使用缓存图片位置:",
                  center
                );
              } else {
                center = getViewCenter();
                layoutAnchor = center ? { ...center } : null;
                placeholderLogger.debug(
                  "🎯 [generateImage] 使用视口中心:",
                  center
                );
              }
            }

            // 如果 center 仍然为 null，使用默认位置 (0, 0)
            if (!center) {
              center = { x: 0, y: 0 };
              placeholderLogger.debug("🎯 [generateImage] 使用默认位置 (0, 0)");
            }

            const size = estimatePlaceholderSize({
              aspectRatio: state.aspectRatio,
              imageSize: state.imageSize,
              fallbackBounds: cached?.bounds ?? null,
            });
            placeholderLogger.debug("🎯 [generateImage] 占位符尺寸:", size);

            const smartPosition = center ? { ...center } : undefined;

            dispatchPlaceholderEvent({
              placeholderId,
              center,
              width: size.width,
              height: size.height,
              operationType: "generate",
              preferSmartLayout: true,
              smartPosition,
              groupId,
              groupIndex,
              groupTotal,
              preferHorizontal: isParallelGeneration,
              groupAnchor: layoutAnchor || undefined,
            });
          } catch (error) {
            placeholderLogger.warn("预测占位符生成失败", error);
          }

          let progressInterval: ReturnType<typeof setInterval> | null = null;
          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在生成",
            });

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "generateImage progress interval start");
            const PROGRESS_MAX = 95;
            const PROGRESS_INCREMENT = PROGRESS_MAX / 120; // 约0.79%每秒
            progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX) {
                if (progressInterval) clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX,
                currentProgress + PROGRESS_INCREMENT
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            // 调用后端API生成图像
            const modelToUse = getImageModelForProvider(state.aiProvider);
            logProcessStep(
              metrics,
              `generateImage calling API (${modelToUse})`
            );

            let providerOptions: AIProviderOptions | undefined;

            if (state.aiProvider === "runninghub") {
              const suSource = state.sourceImageForEditing;
              if (!suSource) {
                throw new Error(
                  "运行 RunningHub 转换前请先提供一张 SU 截图作为源图像。"
                );
              }

              const projectId = useProjectContentStore.getState().projectId;
              const stageUpdater: RunningHubStageUpdater = (
                stage,
                progress
              ) => {
                const statusUpdate: Partial<ChatMessage["generationStatus"]> = {
                  isGenerating: true,
                  error: null,
                  stage,
                };
                if (typeof progress === "number") {
                  statusUpdate.progress = progress;
                }
                get().updateMessageStatus(aiMessageId!, statusUpdate);
              };

              providerOptions = await buildRunningHubProviderOptions({
                primaryImage: suSource,
                referenceImage: state.sourceImagesForBlending?.[0],
                projectId,
                onStageUpdate: stageUpdater,
              });
            }

            // 🔍 调试日志：打印实际发送的参数
            console.log("🎨 [Generate Image] 请求参数:", {
              aiProvider: state.aiProvider,
              model: modelToUse,
              imageSize: state.imageSize ?? "1K",
              aspectRatio: state.aspectRatio || "auto",
              thinkingLevel: state.thinkingLevel || "auto",
              imageOnly: state.imageOnly,
              prompt: prompt.substring(0, 50) + "...",
            });

            const result = await generateImageViaAPI({
              prompt,
              model: modelToUse,
              aiProvider: state.aiProvider,
              providerOptions,
              outputFormat: "png",
              aspectRatio: state.aspectRatio || undefined,
              imageSize: state.imageSize ?? "1K", // 自动模式下优先使用1K
              thinkingLevel: state.thinkingLevel || undefined,
              imageOnly: state.imageOnly,
            });
            logProcessStep(metrics, "generateImage API response received");

            if (progressInterval) clearInterval(progressInterval);

            if (result.success && result.data) {
              // 生成成功 - 更新消息内容和状态
              const messageContent =
                result.data.textResponse ||
                (result.data.hasImage
                  ? `已生成图像: ${prompt}`
                  : `无法生成图像: ${prompt}`);

              const imageRemoteUrl = getResultImageRemoteUrl(result.data);
              const inlineImageData = result.data.imageData;

              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: messageContent,
                          imageData: imageRemoteUrl ? undefined : inlineImageData,
                          // 避免把完整 base64 同时存两份（imageData + thumbnail），缩略图由后续异步流程生成/回填
                          thumbnail: imageRemoteUrl ? imageRemoteUrl : msg.thumbnail,
                          imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                          metadata: result.data?.metadata,
                          provider: state.aiProvider,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));
              logProcessStep(metrics, "editImage message updated");
              logProcessStep(metrics, "generateImage message updated");

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = messageContent;
                  message.imageData = inlineImageData;
                  // thumbnail 由后续异步流程生成/回填，避免重复持有大字符串
                  message.imageRemoteUrl =
                    imageRemoteUrl || message.imageRemoteUrl;
                  message.metadata = result.data?.metadata;
                  message.provider = state.aiProvider;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              // ========== 🔥 清晰的异步流程设计 ==========
              // 步骤1：立即更新对话框显示（使用 base64，不等待上传）- 已在上面完成
              // 步骤2：立即计算 placementImageData（使用 base64）
              // 步骤3：立即发送到画布（使用 base64）
              // 步骤4：异步上传到OSS（后台进行，不阻塞显示）
              // 注意：消息状态已在步骤1中更新（generationStatus: { isGenerating: false, progress: 100 }），无需重复更新

              // 步骤2：立即计算 placementImageData（使用 base64，不等待上传）
              // Prefer remote URL for canvas placement to avoid base64 memory usage.
              let placementImageData: string | null = null;
              try {
                const remoteCandidate =
                  imageRemoteUrl ??
                  getResultImageRemoteUrl(result.data) ??
                  null;
                if (remoteCandidate) {
                  placementImageData = remoteCandidate;
                } else {
                  const inlineCandidate =
                    normalizeInlineImageData(inlineImageData) ??
                    normalizeInlineImageData(result.data?.imageData) ??
                    normalizeInlineImageData(undefined);
                  if (inlineCandidate) {
                    placementImageData = ensureDataUrl(inlineCandidate);
                  }
                }
              } catch (err) {
                console.warn("⚠️ resolve placement image failed:", err);
                placementImageData = null;
              }

              // 如果没有可用的图像源，记录原因并返回
              if (!placementImageData) {
                console.warn(
                  "⚠️ [generateImage] 没有可用的图像源，无法显示到画布"
                );
                removePredictivePlaceholder();
                return;
              }

              console.log(
                "✅ [generateImage] 步骤1-2完成：对话框已更新，placementImageData已计算"
              );

              // 步骤3：立即发送到画布（使用 base64，不等待上传）
              set({ lastGeneratedImage: result.data });

              // 自动添加到画布中央 - 使用快速上传工具的逻辑
              const addImageToCanvas = (
                aiResult: AIImageResult,
                imageSrc: string,
                isParallel: boolean = false,
                parallelGroupInfo?: {
                  groupId: string;
                  groupIndex: number;
                  groupTotal: number;
                }
              ) => {
                const fileName = `${prompt.substring(0, 20)}.${
                  aiResult.metadata?.outputFormat || "png"
                }`;
                const imagePayload = buildImagePayloadForUpload(
                  imageSrc,
                  fileName
                );

                // 优先使用占位框位置；让 quick upload 根据 placeholderId 查找并自适应
                let smartPosition: { x: number; y: number } | undefined =
                  undefined;

                // 直接触发快速上传事件，复用现有的上传逻辑，添加智能排版信息
                window.dispatchEvent(
                  new CustomEvent("triggerQuickImageUpload", {
                    detail: {
                      imageData: imagePayload,
                      fileName: fileName,
                      operationType: "generate",
                      smartPosition,
                      sourceImageId: undefined,
                      sourceImages: undefined,
                      placeholderId,
                      preferHorizontal: isParallel, // 🔥 并行生成时使用横向排列
                      // 🔥 传递并行生成分组信息，用于自动打组
                      parallelGroupId: parallelGroupInfo?.groupId,
                      parallelGroupIndex: parallelGroupInfo?.groupIndex,
                      parallelGroupTotal: parallelGroupInfo?.groupTotal,
                    },
                  })
                );
              };

              // 🔥 从消息中获取 groupIndex，为并行生成的图片添加递增延迟，避免并发冲突
              const currentMsg = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const groupId = currentMsg?.groupId;
              const groupIndex = currentMsg?.groupIndex ?? 0;
              const groupTotal = currentMsg?.groupTotal ?? 1;
              const isParallel = groupTotal > 1; // 🔥 判断是否是并行生成
              const baseDelay = 100;
              const perImageDelay = 300; // 每张图片额外延迟 300ms
              const totalDelay = baseDelay + groupIndex * perImageDelay;

              setTimeout(() => {
                if (result.data) {
                  console.log(
                    `✅ [generateImage] 步骤3执行：发送图片到画布 (延迟${totalDelay}ms, 并行模式: ${isParallel})`
                  );
                  // 🔥 传递并行生成分组信息，用于 X4/X8 自动打组
                  const parallelGroupInfo =
                    isParallel && groupId
                      ? {
                          groupId,
                          groupIndex,
                          groupTotal,
                        }
                      : undefined;
                  addImageToCanvas(
                    result.data,
                    placementImageData,
                    isParallel,
                    parallelGroupInfo
                  );
                }
              }, totalDelay); // 递增延迟，避免并行图片同时添加到画布

              // 步骤4：异步上传历史记录（后台进行，不阻塞显示）
              if (inlineImageData) {
                const resultForCache: AIImageResult = {
                  ...result.data,
                  imageData: undefined,
                };
                // 不等待上传完成，立即继续
                registerMessageImageHistory({
                  aiMessageId,
                  prompt,
                  result: result.data,
                  operationType: "generate",
                  skipPreview: isParallel || state.imageSize === "4K",
                })
                  .then((assets) => {
                    console.log(
                      "✅ [generateImage] 步骤4完成：图片已上传到OSS，remoteUrl:",
                      assets?.remoteUrl?.substring(0, 50)
                    );
                    // 上传完成后更新缓存，但不影响已显示的图片
                    if (assets?.remoteUrl) {
                      cacheGeneratedImageResult({
                        messageId: aiMessageId,
                        prompt,
                        result: resultForCache,
                        assets,
                      });
                    }

                    // 🔥 内存优化：在图片成功上传后，延迟清空 imageData，只保留 thumbnail
                    // 等待画布显示完成（延迟时间 = 画布延迟 + 图片加载时间 + 缓冲）
                    const canvasDisplayDelay = totalDelay + 1000; // 画布延迟 + 1秒缓冲
                    const memoryOptimizationDelay = canvasDisplayDelay + 2000; // 再延迟2秒确保画布已显示

                    setTimeout(() => {
                      const currentState = get();
                      const message = currentState.messages.find(
                        (m) => m.id === aiMessageId
                      );
                      if (!message) return;

                      // 只有在有 thumbnail 和 remoteUrl 的情况下才清空 imageData
                      const hasThumbnail =
                        message.thumbnail && message.thumbnail.length > 0;
                      const hasRemoteUrl =
                        message.imageRemoteUrl &&
                        message.imageRemoteUrl.startsWith("http");
                      const imageDataSize = message.imageData?.length || 0;
                      const thumbnailSize = message.thumbnail?.length || 0;

                      // 如果满足条件：有thumbnail和remoteUrl，且imageData明显大于thumbnail
                      if (
                        hasThumbnail &&
                        hasRemoteUrl &&
                        imageDataSize > thumbnailSize * 2
                      ) {
                        const savedKB = (
                          (imageDataSize - thumbnailSize) /
                          1024
                        ).toFixed(2);
                        console.log(
                          `🧹 [内存优化] 清空消息 ${aiMessageId} 的 imageData，保留 thumbnail 和 remoteUrl`,
                          {
                            imageDataSize:
                              (imageDataSize / 1024).toFixed(2) + "KB",
                            thumbnailSize:
                              (thumbnailSize / 1024).toFixed(2) + "KB",
                            saved: savedKB + "KB",
                          }
                        );

                        get().updateMessage(aiMessageId, (msg) => ({
                          ...msg,
                          imageData: undefined, // 清空完整的 base64，只保留 thumbnail
                        }));

                        const context = contextManager.getCurrentContext();
                        if (context) {
                          const target = context.messages.find(
                            (m) => m.id === aiMessageId
                          );
                          if (target) {
                            target.imageData = undefined;
                          }
                        }
                      }
                    }, memoryOptimizationDelay);
                  })
                  .catch((error) => {
                    console.warn(
                      "⚠️ [generateImage] 步骤4失败：上传图片历史记录失败:",
                      error
                    );
                  });
              } else {
                // 如果没有 inlineImageData，直接缓存
                cacheGeneratedImageResult({
                  messageId: aiMessageId,
                  prompt,
                  result: result.data,
                  assets: undefined,
                  inlineImageData,
                });
              }

              await get().refreshSessions();
              logProcessStep(metrics, "generateImage completed");

              // 可选：自动下载图片到用户的默认下载文件夹
              const downloadImageData = (
                imageData: string,
                prompt: string,
                autoDownload: boolean = false
              ) => {
                if (!autoDownload) {
                  return;
                }

                try {
                  const mimeType = `image/${
                    result.data?.metadata?.outputFormat || "png"
                  }`;
                  const imageDataUrl = `data:${mimeType};base64,${imageData}`;

                  const link = document.createElement("a");
                  link.href = imageDataUrl;

                  // 生成文件名
                  const timestamp = new Date()
                    .toISOString()
                    .replace(/[:.]/g, "-");
                  const promptSafeString = prompt
                    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
                    .substring(0, 30);
                  const extension =
                    result.data?.metadata?.outputFormat || "png";

                  link.download = `ai_generated_${promptSafeString}_${timestamp}.${extension}`;

                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                } catch (error) {
                  console.error("❌ 下载图像失败:", error);
                }
              };

              // 根据配置决定是否自动下载（仅当有图像时）
              const currentState = get();
              if (inlineImageData) {
                downloadImageData(
                  inlineImageData,
                  prompt,
                  currentState.autoDownload
                );
              }

              // 取消自动关闭对话框 - 保持对话框打开状态
              // setTimeout(() => {
              //   get().hideDialog();
              //
              // }, 100); // 延迟0.1秒关闭，让用户看到生成完成的消息
            } else {
              // 生成失败 - 更新消息状态为错误
              const errorMessage = result.error?.message || "图像生成失败";

              get().updateMessageStatus(aiMessageId, {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
              });

              console.error("❌ 图像生成失败:", errorMessage);
              removePredictivePlaceholder();
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            // 🔥 更新消息状态为错误
            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 图像生成异常:", error);
            removePredictivePlaceholder();
          } finally {
            if (progressInterval) clearInterval(progressInterval);
            // 🔥 无论成功失败，都减少正在生成的图片计数
            generatingImageCount--;
            logProcessStep(metrics, "generateImage finished (finally)");
          }
        },

        // 图生图功能（支持并行）
        editImage: async (
          prompt: string,
          sourceImage: string,
          showImagePlaceholder: boolean = true,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "editImage entered");

          // 🔥 并行模式：不检查全局状态
          const displaySourceImage = showImagePlaceholder
            ? toRenderableImageSrc(sourceImage)
            : null;

          const override = options?.override;
          let aiMessageId: string | undefined;
          const currentMsg = override
            ? get().messages.find((m) => m.id === override.aiMessageId)
            : null;
          const groupId = currentMsg?.groupId;
          const groupIndex = currentMsg?.groupIndex ?? 0;
          const groupTotal = currentMsg?.groupTotal ?? 1;
          const isParallelEdit = groupTotal > 1;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.userMessageId, (msg) => ({
              ...msg,
              content: `编辑图像: ${prompt}`,
              sourceImageData: showImagePlaceholder
                ? displaySourceImage ?? msg.sourceImageData
                : msg.sourceImageData,
            }));
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在编辑图像...",
              expectsImageOutput: true,
              sourceImageData: showImagePlaceholder
                ? displaySourceImage ?? msg.sourceImageData
                : msg.sourceImageData,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            // 添加用户消息
            const messageData: any = {
              type: "user",
              content: `编辑图像: ${prompt}`,
            };

            if (showImagePlaceholder) {
              messageData.sourceImageData = displaySourceImage ?? undefined;
            }

            state.addMessage(messageData);

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在编辑图像...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              expectsImageOutput: true,
              sourceImageData: showImagePlaceholder
                ? displaySourceImage ?? undefined
                : undefined,
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }

          const placeholderId = `ai-placeholder-${aiMessageId}`;
          const removePredictivePlaceholder = () => {
            dispatchPlaceholderEvent(
              {
                placeholderId,
                center: { x: 0, y: 0 },
                width: 0,
                height: 0,
                operationType: "edit",
              },
              "remove"
            );
          };

          try {
            let selectedImageBounds: {
              x: number;
              y: number;
              width: number;
              height: number;
            } | null = null;
            try {
              if ((window as any).tanvaImageInstances) {
                const selectedImage = (window as any).tanvaImageInstances.find(
                  (img: any) => img.isSelected
                );
                if (selectedImage?.bounds) {
                  selectedImageBounds = selectedImage.bounds;
                }
              }
            } catch {}

            const cached = contextManager.getCachedImage();
            const offsetHorizontal =
              useUIStore.getState().smartPlacementOffsetHorizontal || 522;
            let center: { x: number; y: number } | null = null;

            if (cached?.bounds) {
              center = {
                x: cached.bounds.x + cached.bounds.width / 2 + offsetHorizontal,
                y: cached.bounds.y + cached.bounds.height / 2,
              };
            } else if (selectedImageBounds) {
              center = {
                x:
                  selectedImageBounds.x +
                  selectedImageBounds.width / 2 +
                  offsetHorizontal,
                y: selectedImageBounds.y + selectedImageBounds.height / 2,
              };
            } else {
              center = getViewCenter();
            }

            if (center) {
              const size = estimatePlaceholderSize({
                aspectRatio: state.aspectRatio,
                imageSize: state.imageSize,
                fallbackBounds: selectedImageBounds ?? cached?.bounds ?? null,
              });

              dispatchPlaceholderEvent({
                placeholderId,
                center,
                width: size.width,
                height: size.height,
                operationType: "edit",
                preferSmartLayout: true,
                sourceImageId: cached?.imageId,
                smartPosition: center ? { ...center } : undefined,
                groupId,
                groupIndex,
                groupTotal,
                preferHorizontal: isParallelEdit,
                groupAnchor: center ? { ...center } : undefined,
              });
            }
          } catch (error) {
            placeholderLogger.warn("预测编辑占位符生成失败", error);
          }

          logProcessStep(metrics, "editImage message prepared");

          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在编辑",
            });

            // ✅ 统一把源图解析为 dataURL（支持 dataURL/base64/blob/remote），避免把 blob/remote 当作 base64 拼接
            const normalizedSourceImage = await resolveImageToDataUrl(sourceImage);
            if (!normalizedSourceImage) {
              throw new Error("源图像读取失败，请重新选择图片。");
            }

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "editImage progress interval start");
            const PROGRESS_MAX_EDIT = 95;
            const PROGRESS_INCREMENT_EDIT = PROGRESS_MAX_EDIT / 120; // 约0.79%每秒
            const progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX_EDIT) {
                clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX_EDIT,
                currentProgress + PROGRESS_INCREMENT_EDIT
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            // 调用后端API编辑图像
            const modelToUse = getImageModelForProvider(state.aiProvider);
            logProcessStep(metrics, `editImage calling API (${modelToUse})`);

            let providerOptions: AIProviderOptions | undefined;

            if (state.aiProvider === "runninghub") {
              const projectId = useProjectContentStore.getState().projectId;
              const stageUpdater: RunningHubStageUpdater = (
                stage,
                progress
              ) => {
                const statusUpdate: Partial<ChatMessage["generationStatus"]> = {
                  isGenerating: true,
                  error: null,
                  stage,
                };
                if (typeof progress === "number") {
                  statusUpdate.progress = progress;
                }
                get().updateMessageStatus(aiMessageId!, statusUpdate);
              };

              providerOptions = await buildRunningHubProviderOptions({
                primaryImage: normalizedSourceImage,
                referenceImage: state.sourceImagesForBlending?.[0],
                projectId,
                onStageUpdate: stageUpdater,
              });
            }

            const buildEditRequest = (model: string): AIImageEditRequest => ({
              prompt,
              sourceImage: normalizedSourceImage,
              model,
              aiProvider: state.aiProvider,
              providerOptions,
              outputFormat: "png",
              aspectRatio: state.aspectRatio || undefined,
              imageSize: state.imageSize ?? "1K", // 自动模式下优先使用1K
              thinkingLevel: state.thinkingLevel || undefined,
              imageOnly: state.imageOnly,
            });

            // 🔍 调试日志：打印实际发送的参数
            console.log("✏️ [Edit Image] 请求参数:", {
              aiProvider: state.aiProvider,
              model: modelToUse,
              imageSize: state.imageSize ?? "1K",
              aspectRatio: state.aspectRatio || "auto",
              thinkingLevel: state.thinkingLevel || "auto",
              imageOnly: state.imageOnly,
              prompt: prompt.substring(0, 50) + "...",
            });

            let result = await editImageViaAPI(buildEditRequest(modelToUse));

            clearInterval(progressInterval);

            logProcessStep(metrics, "editImage API response received");

            if (
              !result.success &&
              shouldFallbackToGeminiFlash(
                state.aiProvider,
                modelToUse,
                result.error
              )
            ) {
              console.warn(
                "⚠️ Gemini Pro 编辑失败，准备自动降级到 Gemini 2.5 Flash 模型",
                {
                  errorCode: result.error?.code,
                  errorMessage: result.error?.message,
                }
              );
              logProcessStep(metrics, "editImage fallback triggered");

              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 35;
              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: Math.max(currentProgress, 35),
                error: null,
                stage: "降级 Gemini 2.5 Flash",
              });

              result = await editImageViaAPI(
                buildEditRequest(GEMINI_FLASH_IMAGE_MODEL)
              );
              logProcessStep(metrics, "editImage fallback response received");

              if (result.success) {
              } else {
                console.error(
                  "❌ Gemini 2.5 Flash 降级编辑仍然失败:",
                  result.error
                );
              }
            }

            if (result.success && result.data) {
              const imageRemoteUrl = getResultImageRemoteUrl(result.data);
              const inlineImageData = result.data.imageData;
              // 编辑成功 - 更新消息内容和状态
              const messageContent =
                result.data.textResponse ||
                (result.data.hasImage
                  ? `已编辑图像: ${prompt}`
                  : `无法编辑图像: ${prompt}`);

              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: messageContent,
                          imageData: imageRemoteUrl ? undefined : inlineImageData,
                          thumbnail: imageRemoteUrl ? imageRemoteUrl : msg.thumbnail,
                          imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                          metadata: result.data?.metadata,
                          provider: state.aiProvider,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = messageContent;
                  message.imageData = inlineImageData;
                  // thumbnail 由后续异步流程生成/回填，避免重复持有大字符串
                  message.imageRemoteUrl =
                    imageRemoteUrl || message.imageRemoteUrl;
                  message.metadata = result.data?.metadata;
                  message.provider = state.aiProvider;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              // Prefer remote URL for canvas placement to avoid base64 memory usage.
              let placementImageData: string | null = null;
              try {
                const remoteCandidate =
                  imageRemoteUrl ??
                  getResultImageRemoteUrl(result.data) ??
                  null;
                if (remoteCandidate) {
                  placementImageData = remoteCandidate;
                } else {
                  const inlineCandidate =
                    normalizeInlineImageData(inlineImageData) ??
                    normalizeInlineImageData(result.data?.imageData) ??
                    normalizeInlineImageData(undefined);
                  if (inlineCandidate) {
                    placementImageData = ensureDataUrl(inlineCandidate);
                  }
                }
              } catch (err) {
                console.warn("⚠️ resolve placement image failed:", err);
                placementImageData = null;
              }

              if (!placementImageData) {
                console.warn("⚠️ [editImage] 没有可用的图像源，无法显示到画布");
                removePredictivePlaceholder();
                return;
              }

              console.log(
                "✅ [editImage] 步骤1-2完成：对话框已更新，placementImageData已计算"
              );

              // 先更新 lastGeneratedImage，不等待上传/历史记录
              set({ lastGeneratedImage: result.data });

              // 自动添加到画布
              const addImageToCanvas = (
                aiResult: AIImageResult,
                imageSrc: string,
                isParallel: boolean = false,
                parallelGroupInfo?: {
                  groupId: string;
                  groupIndex: number;
                  groupTotal: number;
                }
              ) => {
                const fileName = `${prompt.substring(0, 20)}.${
                  aiResult.metadata?.outputFormat || "png"
                }`;
                const imagePayload = buildImagePayloadForUpload(
                  imageSrc,
                  fileName
                );

                // 🎯 获取当前选中图片的ID和边界信息用于智能排版
                let selectedImageBounds = null;
                let sourceImageId = null;
                try {
                  if ((window as any).tanvaImageInstances) {
                    const selectedImage = (
                      window as any
                    ).tanvaImageInstances.find((img: any) => img.isSelected);
                    if (selectedImage) {
                      selectedImageBounds = selectedImage.bounds;
                      sourceImageId = selectedImage.id;
                    }
                  }
                } catch (error) {
                  console.warn("获取选中图片信息失败:", error);
                }

                // 让 quick upload 根据 placeholderId/选中图自动定位，避免硬编码向右偏移导致跳位
                let smartPosition: { x: number; y: number } | undefined =
                  undefined;

                window.dispatchEvent(
                  new CustomEvent("triggerQuickImageUpload", {
                    detail: {
                      imageData: imagePayload,
                      fileName: fileName,
                      selectedImageBounds: selectedImageBounds, // 保持兼容性
                      operationType: "edit",
                      smartPosition,
                      sourceImageId: sourceImageId,
                      sourceImages: undefined,
                      placeholderId,
                      preferHorizontal: isParallelEdit,
                      // 🔥 传递并行生成分组信息，用于自动打组
                      parallelGroupId: parallelGroupInfo?.groupId,
                      parallelGroupIndex: parallelGroupInfo?.groupIndex,
                      parallelGroupTotal: parallelGroupInfo?.groupTotal,
                    },
                  })
                );
              };

              // 🔥 传递并行编辑分组信息，用于自动打组
              const editParallelGroupInfo =
                isParallelEdit && groupId
                  ? {
                      groupId,
                      groupIndex,
                      groupTotal,
                    }
                  : undefined;

              // 并行编辑：为每张图加递增延迟，避免同时上画布导致冲突
              const baseDelay = 100;
              const perImageDelay = 300;
              const totalDelay = baseDelay + groupIndex * perImageDelay;

              setTimeout(() => {
                if (result.data) {
                  console.log(
                    `✅ [editImage] 步骤3执行：发送图片到画布 (延迟${totalDelay}ms, 并行模式: ${isParallelEdit})`
                  );
                  addImageToCanvas(
                    result.data,
                    placementImageData,
                    isParallelEdit,
                    editParallelGroupInfo
                  );
                }
              }, totalDelay);

              // 步骤4：异步上传历史记录（后台进行，不阻塞上画布）
              if (inlineImageData) {
                const resultForCache: AIImageResult = {
                  ...result.data!,
                  imageData: undefined,
                };
                registerMessageImageHistory({
                  aiMessageId,
                  prompt,
                  result: result.data,
                  operationType: "edit",
                  skipPreview: isParallelEdit || state.imageSize === "4K",
                })
                  .then((assets) => {
                    console.log(
                      "✅ [editImage] 步骤4完成：图片已上传到OSS，remoteUrl:",
                      assets?.remoteUrl?.substring(0, 50)
                    );
                    cacheGeneratedImageResult({
                      messageId: aiMessageId,
                      prompt,
                      result: resultForCache,
                      assets,
                    });

                    // 🔥 内存优化：在图片成功上传后，延迟清空 imageData，只保留 thumbnail
                    const canvasDisplayDelay = totalDelay + 1000;
                    const memoryOptimizationDelay = canvasDisplayDelay + 2000;

                    setTimeout(() => {
                      const currentState = get();
                      const message = currentState.messages.find(
                        (m) => m.id === aiMessageId
                      );
                      if (!message) return;

                      const hasThumbnail =
                        message.thumbnail && message.thumbnail.length > 0;
                      const hasRemoteUrl =
                        message.imageRemoteUrl &&
                        message.imageRemoteUrl.startsWith("http");
                      const imageDataSize = message.imageData?.length || 0;
                      const thumbnailSize = message.thumbnail?.length || 0;

                      if (
                        hasThumbnail &&
                        hasRemoteUrl &&
                        imageDataSize > thumbnailSize * 2
                      ) {
                        get().updateMessage(aiMessageId, (msg) => ({
                          ...msg,
                          imageData: undefined,
                        }));

                        const context = contextManager.getCurrentContext();
                        if (context) {
                          const target = context.messages.find(
                            (m) => m.id === aiMessageId
                          );
                          if (target) {
                            target.imageData = undefined;
                          }
                        }
                      }
                    }, memoryOptimizationDelay);
                  })
                  .catch((error) => {
                    console.warn("⚠️ [editImage] 上传图片历史记录失败:", error);
                  });
              } else {
                cacheGeneratedImageResult({
                  messageId: aiMessageId,
                  prompt,
                  result: result.data,
                  assets: undefined,
                  inlineImageData,
                });
              }

              await get().refreshSessions();
              logProcessStep(metrics, "editImage completed");

              // 取消自动关闭对话框 - 保持对话框打开状态
              // setTimeout(() => {
              //   get().hideDialog();
              //
              // }, 100); // 延迟0.1秒关闭，让用户看到编辑完成的消息
            } else {
              // 编辑失败 - 更新消息状态为错误
              const errorMessage = result.error?.message || "图像编辑失败";

              get().updateMessageStatus(aiMessageId, {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
              });

              console.error("❌ 图像编辑失败:", errorMessage);
              removePredictivePlaceholder();
            }
          } catch (error) {
            let errorMessage =
              error instanceof Error ? error.message : "未知错误";

            // 🔒 安全检查：防止Base64图像数据被当作错误消息
            if (
              errorMessage &&
              errorMessage.length > 1000 &&
              errorMessage.includes("iVBORw0KGgo")
            ) {
              console.warn(
                "⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息"
              );
              errorMessage = "图像编辑失败，请重试";
            }

            // 🔥 更新消息状态为错误
            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 图像编辑异常:", error);
            logProcessStep(metrics, "editImage failed");
            removePredictivePlaceholder();
          }
        },

        setSourceImageForEditing: (imageData: string | null) => {
          if (!imageData) {
            set({ sourceImageForEditing: null });
            return;
          }

          const normalizedImage = sanitizeImageInput(imageData);
          if (!normalizedImage) {
            set({ sourceImageForEditing: null });
            return;
          }

          ensureActiveSession();
          set({ sourceImageForEditing: normalizedImage });

          // 🔥 立即缓存用户上传的图片
          const imageId = `user_upload_${Date.now()}`;
          contextManager.cacheLatestImage(
            normalizedImage,
            imageId,
            "用户上传的图片"
          );
        },

        // 画布选中图片同步到AI对话框
        setSourceImagesFromCanvas: (images: string[]) => {
          const normalizedImages = images
            .map((img) => sanitizeImageInput(img))
            .filter((img): img is string => Boolean(img));

          if (normalizedImages.length === 0) {
            // 清空所有源图片
            set({
              sourceImageForEditing: null,
              sourceImagesForBlending: [],
            });
            return;
          }

          ensureActiveSession();

          if (normalizedImages.length === 1) {
            // 单张图片：设置为编辑源图
            const singleImage = normalizedImages[0];
            set({
              sourceImageForEditing: singleImage,
              sourceImagesForBlending: [],
            });
            // 🔥 不再调用 cacheLatestImage，避免覆盖 DrawingController 设置的带 bounds 的缓存
          } else {
            // 多张图片：设置为融合源图
            set({
              sourceImageForEditing: null,
              sourceImagesForBlending: normalizedImages,
            });
            // 🔥 不再调用 cacheLatestImage，避免覆盖 DrawingController 设置的带 bounds 的缓存
          }
        },

        // 多图融合功能（支持并行）
        blendImages: async (
          prompt: string,
          sourceImages: string[],
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "blendImages entered");

          // 🔥 并行模式：不检查全局状态

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.userMessageId, (msg) => ({
              ...msg,
              content: `融合图像: ${prompt}`,
              sourceImagesData: sourceImages,
            }));
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在融合图像...",
              expectsImageOutput: true,
              sourceImagesData: sourceImages,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            state.addMessage({
              type: "user",
              content: `融合图像: ${prompt}`,
              sourceImagesData: sourceImages,
            });

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在融合图像...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              expectsImageOutput: true,
              sourceImagesData: sourceImages,
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "blendImages message prepared");

          // 🔥 获取并行融合的分组信息
          const currentMsg = override
            ? get().messages.find((m) => m.id === override.aiMessageId)
            : null;
          const groupId = currentMsg?.groupId;
          const groupIndex = currentMsg?.groupIndex ?? 0;
          const groupTotal = currentMsg?.groupTotal ?? 1;
          const isParallelBlend = groupTotal > 1;

          const placeholderId = `ai-placeholder-${aiMessageId}`;
          const removePredictivePlaceholder = () => {
            dispatchPlaceholderEvent(
              {
                placeholderId,
                center: { x: 0, y: 0 },
                width: 0,
                height: 0,
                operationType: "blend",
              },
              "remove"
            );
          };

          try {
            const cached = contextManager.getCachedImage();
            const offsetHorizontal =
              useUIStore.getState().smartPlacementOffsetHorizontal || 522;
            const offsetVertical =
              useUIStore.getState().smartPlacementOffsetVertical || 552;
            let center: { x: number; y: number } | null = null;
            let layoutAnchor: { x: number; y: number } | null = null;

            // 🔥 统一并行模式的位置计算逻辑
            if (isParallelBlend) {
              // 并行融合：根据 groupIndex 计算不同的位置，避免重叠
              let baseX: number;
              let baseY: number;

              if (cached?.bounds) {
                baseX = cached.bounds.x + cached.bounds.width / 2;
                baseY =
                  cached.bounds.y + cached.bounds.height / 2 + offsetVertical;
              } else {
                const viewCenter = getViewCenter();
                baseX = viewCenter?.x ?? 0;
                baseY = viewCenter?.y ?? 0;
              }

              layoutAnchor = { x: baseX, y: baseY };
              center = {
                x: baseX + groupIndex * offsetHorizontal,
                y: baseY,
              };
            } else {
              // 单张融合：使用原有逻辑
              if (cached?.bounds) {
                center = {
                  x:
                    cached.bounds.x +
                    cached.bounds.width / 2 +
                    offsetHorizontal,
                  y: cached.bounds.y + cached.bounds.height / 2,
                };
                layoutAnchor = { ...center };
              } else {
                center = getViewCenter();
                layoutAnchor = center ? { ...center } : null;
              }
            }

            if (center) {
              const size = estimatePlaceholderSize({
                aspectRatio: state.aspectRatio,
                imageSize: state.imageSize,
                fallbackBounds: cached?.bounds ?? null,
              });

              dispatchPlaceholderEvent({
                placeholderId,
                center,
                width: size.width,
                height: size.height,
                operationType: "blend",
                preferSmartLayout: true,
                sourceImages,
                smartPosition: center ? { ...center } : undefined,
                groupId,
                groupIndex,
                groupTotal,
                preferHorizontal: isParallelBlend,
                groupAnchor: layoutAnchor || undefined,
              });
            }
          } catch (error) {
            placeholderLogger.warn("预测融合占位符生成失败", error);
          }

          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在融合",
            });

            // ✅ 统一把融合源图解析为 dataURL（支持 dataURL/base64/blob/remote），避免直接把 blob/remote 传给后端
            const normalizedSourceImages = await mapWithLimit(
              sourceImages,
              2,
              async (img) => {
                const resolved = await resolveImageToDataUrl(img);
                if (!resolved) {
                  throw new Error("融合图片读取失败，请重新选择图片。");
                }
                return resolved;
              }
            );

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "blendImages progress interval start");
            const PROGRESS_MAX_BLEND = 95;
            const PROGRESS_INCREMENT_BLEND = PROGRESS_MAX_BLEND / 120; // 约0.79%每秒
            const progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX_BLEND) {
                clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX_BLEND,
                currentProgress + PROGRESS_INCREMENT_BLEND
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            const modelToUse = getImageModelForProvider(state.aiProvider);

            const result = await blendImagesViaAPI({
              prompt,
              sourceImages: normalizedSourceImages,
              model: modelToUse,
              aiProvider: state.aiProvider,
              outputFormat: "png",
              aspectRatio: state.aspectRatio || undefined,
              imageSize: state.imageSize ?? "1K", // 自动模式下优先使用1K
              thinkingLevel: state.thinkingLevel || undefined,
              imageOnly: state.imageOnly,
            });
            logProcessStep(metrics, "blendImages API response received");

            clearInterval(progressInterval);

            if (result.success && result.data) {
              const imageRemoteUrl = getResultImageRemoteUrl(result.data);
              const inlineImageData = result.data.imageData;
              const messageContent =
                result.data.textResponse ||
                (result.data.hasImage
                  ? `已融合图像: ${prompt}`
                  : `无法融合图像: ${prompt}`);

              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: messageContent,
                          imageData: imageRemoteUrl ? undefined : inlineImageData,
                          thumbnail: imageRemoteUrl ? imageRemoteUrl : msg.thumbnail,
                          imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                          metadata: result.data?.metadata,
                          provider: state.aiProvider,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));
              logProcessStep(metrics, "blendImages message updated");

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = messageContent;
                  message.imageData = inlineImageData;
                  // thumbnail 由后续异步流程生成/回填，避免重复持有大字符串
                  message.imageRemoteUrl =
                    imageRemoteUrl || message.imageRemoteUrl;
                  message.metadata = result.data?.metadata;
                  message.provider = state.aiProvider;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              // Prefer remote URL for canvas placement to avoid base64 memory usage.
              let placementImageData: string | null = null;
              try {
                const remoteCandidate =
                  imageRemoteUrl ??
                  undefined ??
                  getResultImageRemoteUrl(result.data) ??
                  null;
                if (remoteCandidate) {
                  placementImageData = remoteCandidate;
                } else {
                  const inlineCandidate =
                    normalizeInlineImageData(inlineImageData) ??
                    normalizeInlineImageData(result.data?.imageData) ??
                    normalizeInlineImageData(undefined);
                  if (inlineCandidate) {
                    placementImageData = ensureDataUrl(inlineCandidate);
                  }
                }
              } catch (err) {
                console.warn("⚠️ resolve placement image failed:", err);
                placementImageData = null;
              }

              if (!placementImageData) {
                console.warn(
                  "⚠️ [blendImages] 没有可用的图像源，无法显示到画布"
                );
                removePredictivePlaceholder();
                return;
              }

              console.log(
                "✅ [blendImages] 步骤1-2完成：对话框已更新，placementImageData已计算"
              );

              // 先更新 lastGeneratedImage，不等待上传/历史记录
              set({ lastGeneratedImage: result.data });

              const addImageToCanvas = (
                aiResult: AIImageResult,
                imageSrc: string,
                isParallel: boolean = false,
                parallelGroupInfo?: {
                  groupId: string;
                  groupIndex: number;
                  groupTotal: number;
                }
              ) => {
                const fileName = `${prompt.substring(0, 20)}.${
                  aiResult.metadata?.outputFormat || "png"
                }`;
                const imagePayload = buildImagePayloadForUpload(
                  imageSrc,
                  fileName
                );

                // 🎯 获取源图像ID列表用于智能排版
                let sourceImageIds: string[] = [];
                try {
                  if ((window as any).tanvaImageInstances) {
                    const selectedImages = (
                      window as any
                    ).tanvaImageInstances.filter((img: any) => img.isSelected);
                    sourceImageIds = selectedImages.map((img: any) => img.id);
                  }
                } catch (error) {
                  console.warn("获取源图像IDs失败:", error);
                }

                window.dispatchEvent(
                  new CustomEvent("triggerQuickImageUpload", {
                    detail: {
                      imageData: imagePayload,
                      fileName: fileName,
                      operationType: "blend",
                      // 让 quick upload 根据 placeholderId/源图自动定位，避免跳到缓存链条位置
                      smartPosition: undefined,
                      sourceImageId: undefined,
                      sourceImages:
                        sourceImageIds.length > 0 ? sourceImageIds : undefined,
                      placeholderId,
                      preferHorizontal: isParallelBlend,
                      // 🔥 传递并行生成分组信息，用于自动打组
                      parallelGroupId: parallelGroupInfo?.groupId,
                      parallelGroupIndex: parallelGroupInfo?.groupIndex,
                      parallelGroupTotal: parallelGroupInfo?.groupTotal,
                    },
                  })
                );
              };

              // 🔥 传递并行融合分组信息，用于自动打组
              const blendParallelGroupInfo =
                isParallelBlend && groupId
                  ? {
                      groupId,
                      groupIndex,
                      groupTotal,
                    }
                  : undefined;

              // 并行融合：为每张图加递增延迟，避免同时上画布导致冲突
              const baseDelay = 100;
              const perImageDelay = 300;
              const totalDelay = baseDelay + groupIndex * perImageDelay;

              setTimeout(() => {
                if (result.data) {
                  console.log(
                    `✅ [blendImages] 步骤3执行：发送图片到画布 (延迟${totalDelay}ms, 并行模式: ${isParallelBlend})`
                  );
                  addImageToCanvas(
                    result.data,
                    placementImageData,
                    isParallelBlend,
                    blendParallelGroupInfo
                  );
                }
              }, totalDelay);

              // 步骤4：异步上传历史记录（后台进行，不阻塞上画布）
              if (inlineImageData) {
                const resultForCache: AIImageResult = {
                  ...result.data!,
                  imageData: undefined,
                };
                registerMessageImageHistory({
                  aiMessageId,
                  prompt,
                  result: result.data,
                  operationType: "blend",
                  skipPreview: isParallelBlend || state.imageSize === "4K",
                })
                  .then((assets) => {
                    console.log(
                      "✅ [blendImages] 步骤4完成：图片已上传到OSS，remoteUrl:",
                      assets?.remoteUrl?.substring(0, 50)
                    );
                    cacheGeneratedImageResult({
                      messageId: aiMessageId,
                      prompt,
                      result: resultForCache,
                      assets,
                    });

                    // 🔥 内存优化：在图片成功上传后，延迟清空 imageData，只保留 thumbnail
                    const canvasDisplayDelay = totalDelay + 1000;
                    const memoryOptimizationDelay = canvasDisplayDelay + 2000;

                    setTimeout(() => {
                      const currentState = get();
                      const message = currentState.messages.find(
                        (m) => m.id === aiMessageId
                      );
                      if (!message) return;

                      const hasThumbnail =
                        message.thumbnail && message.thumbnail.length > 0;
                      const hasRemoteUrl =
                        message.imageRemoteUrl &&
                        message.imageRemoteUrl.startsWith("http");
                      const imageDataSize = message.imageData?.length || 0;
                      const thumbnailSize = message.thumbnail?.length || 0;

                      if (
                        hasThumbnail &&
                        hasRemoteUrl &&
                        imageDataSize > thumbnailSize * 2
                      ) {
                        get().updateMessage(aiMessageId, (msg) => ({
                          ...msg,
                          imageData: undefined,
                        }));

                        const context = contextManager.getCurrentContext();
                        if (context) {
                          const target = context.messages.find(
                            (m) => m.id === aiMessageId
                          );
                          if (target) {
                            target.imageData = undefined;
                          }
                        }
                      }
                    }, memoryOptimizationDelay);
                  })
                  .catch((error) => {
                    console.warn(
                      "⚠️ [blendImages] 上传图片历史记录失败:",
                      error
                    );
                  });
              } else {
                cacheGeneratedImageResult({
                  messageId: aiMessageId,
                  prompt,
                  result: result.data,
                  assets: undefined,
                  inlineImageData,
                });
              }

              await get().refreshSessions();
              logProcessStep(metrics, "blendImages completed");

              // 取消自动关闭对话框 - 保持对话框打开状态
              // setTimeout(() => {
              //   get().hideDialog();
              //
              // }, 100); // 延迟0.1秒关闭，让用户看到融合完成的消息
            } else {
              const errorMessage = result.error?.message || "图像融合失败";

              get().updateMessageStatus(aiMessageId, {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
              });

              console.error("❌ 图像融合失败:", errorMessage);
              removePredictivePlaceholder();
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 图像融合异常:", error);
            logProcessStep(metrics, "blendImages failed");
            removePredictivePlaceholder();
          }
        },

        addImageForBlending: (imageData: string) => {
          const normalizedImage = sanitizeImageInput(imageData);
          if (!normalizedImage) {
            console.warn("⚠️ 跳过无效的融合图片数据");
            return;
          }

          ensureActiveSession();
          set((state) => ({
            sourceImagesForBlending: [
              ...state.sourceImagesForBlending,
              normalizedImage,
            ],
          }));

          // 🔥 立即缓存用户上传的融合图片（缓存最后一张）
          const imageId = `user_blend_upload_${Date.now()}`;
          contextManager.cacheLatestImage(
            normalizedImage,
            imageId,
            "用户上传的融合图片"
          );
        },

        removeImageFromBlending: (index: number) => {
          set((state) => ({
            sourceImagesForBlending: state.sourceImagesForBlending.filter(
              (_, i) => i !== index
            ),
          }));
        },

        clearImagesForBlending: () => {
          set({ sourceImagesForBlending: [] });
        },

        executeMidjourneyAction: async ({
          parentMessageId,
          taskId,
          customId,
          buttonLabel,
          displayPrompt,
        }: MidjourneyActionOptions) => {
          const state = get();
          const actionLabel = buttonLabel || "Midjourney 操作";
          const parentMessage = state.messages.find(
            (msg) => msg.id === parentMessageId
          );
          const prompt =
            displayPrompt ||
            (parentMessage?.metadata?.midjourney?.prompt as
              | string
              | undefined) ||
            parentMessage?.content ||
            actionLabel;

          const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
            type: "ai",
            content: `正在执行 ${actionLabel}...`,
            generationStatus: {
              isGenerating: true,
              progress: 0,
              error: null,
              stage: "准备中",
            },
            expectsImageOutput: true,
            provider: "midjourney",
          };

          const aiMessage = state.addMessage(placeholderMessage);
          generatingImageCount += 1;

          try {
            const result = await midjourneyActionViaAPI({
              taskId,
              customId,
              actionLabel,
              displayPrompt: prompt,
            });

            if (result.success && result.data) {
              const imageRemoteUrl = getResultImageRemoteUrl(result.data);
              const inlineImageData = result.data.imageData;
              const messageContent =
                result.data.textResponse ||
                (result.data.hasImage
                  ? `已生成图像: ${prompt}`
                  : `无法生成图像: ${prompt}`);

              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessage.id
                      ? {
                          ...msg,
                          content: messageContent,
                          imageData: imageRemoteUrl ? undefined : inlineImageData,
                          thumbnail: imageRemoteUrl ? imageRemoteUrl : msg.thumbnail,
                          imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                          metadata: result.data?.metadata,
                          provider: "midjourney",
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));

              const context = contextManager.getCurrentContext();
              if (context) {
                const messageRef = context.messages.find(
                  (m) => m.id === aiMessage.id
                );
                if (messageRef) {
                  messageRef.content = messageContent;
                  messageRef.imageData = imageRemoteUrl
                    ? undefined
                    : inlineImageData;
                  // thumbnail 由后续异步流程生成/回填，避免重复持有大字符串
                  if (imageRemoteUrl) {
                    messageRef.thumbnail = imageRemoteUrl;
                  }
                  messageRef.imageRemoteUrl =
                    imageRemoteUrl || messageRef.imageRemoteUrl;
                  messageRef.metadata = result.data?.metadata;
                  messageRef.provider = "midjourney";
                  messageRef.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              let uploadedAssets:
                | { remoteUrl?: string; thumbnail?: string }
                | undefined;
              if (inlineImageData) {
                uploadedAssets = await registerMessageImageHistory({
                  aiMessageId: aiMessage.id,
                  prompt,
                  result: result.data,
                  operationType: "generate",
                  skipPreview: true,
                });
              }

              if (uploadedAssets?.remoteUrl) {
                result.data.metadata = {
                  ...result.data.metadata,
                  imageUrl: uploadedAssets.remoteUrl,
                };
                result.data.imageData = undefined;
              }

              set({ lastGeneratedImage: result.data });

              await get().refreshSessions();
            } else {
              const errorMessage =
                result.error?.message || "Midjourney 操作失败";
              get().updateMessageStatus(aiMessage.id, {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
              });
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Midjourney 操作失败";
            get().updateMessageStatus(aiMessage.id, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });
            console.error("❌ Midjourney action异常:", error);
          } finally {
            generatingImageCount = Math.max(0, generatingImageCount - 1);
          }
        },

        // 图像分析功能（支持并行）
        analyzeImage: async (
          prompt: string,
          sourceImage: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "analyzeImage entered");

          // 🔥 并行模式：不检查全局状态

          const displaySourceImage = toRenderableImageSrc(sourceImage);
          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.userMessageId, (msg) => ({
              ...msg,
              content: prompt ? `分析图片: ${prompt}` : "分析这张图片",
              sourceImageData: displaySourceImage ?? msg.sourceImageData,
            }));
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在分析图片...",
              sourceImageData: displaySourceImage ?? msg.sourceImageData,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            state.addMessage({
              type: "user",
              content: prompt ? `分析图片: ${prompt}` : "分析这张图片",
              sourceImageData: displaySourceImage ?? undefined,
            });

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在分析图片...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              sourceImageData: displaySourceImage ?? undefined,
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "analyzeImage message prepared");

          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在分析",
            });

            // ✅ 统一把源图解析为 dataURL（支持 dataURL/base64/blob/remote）
            const formattedImageData = await resolveImageToDataUrl(sourceImage);
            if (!formattedImageData) {
              throw new Error("源图像读取失败，请重新选择图片。");
            }

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "analyzeImage progress interval start");
            const PROGRESS_MAX_ANALYZE = 95;
            const PROGRESS_INCREMENT_ANALYZE = PROGRESS_MAX_ANALYZE / 120; // 约0.79%每秒
            const progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX_ANALYZE) {
                clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX_ANALYZE,
                currentProgress + PROGRESS_INCREMENT_ANALYZE
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            // 调用后端API分析图像
            const modelToUse = getImageModelForProvider(state.aiProvider);

            const result = await analyzeImageViaAPI({
              prompt: prompt || "请详细分析这张图片的内容",
              sourceImage: formattedImageData,
              model: modelToUse,
              aiProvider: state.aiProvider,
            });

            clearInterval(progressInterval);
            logProcessStep(metrics, "analyzeImage API response received");

            if (result.success && result.data) {
              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: result.data!.analysis,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = result.data!.analysis;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }
              logProcessStep(metrics, "analyzeImage completed");
            } else {
              throw new Error(result.error?.message || "图片分析失败");
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 图片分析异常:", error);
            logProcessStep(metrics, "analyzeImage failed");
          }
        },

        setSourceImageForAnalysis: (imageData: string | null) => {
          if (!imageData) {
            set({ sourceImageForAnalysis: null });
            return;
          }

          const normalizedImage = sanitizeImageInput(imageData);
          if (!normalizedImage) {
            set({ sourceImageForAnalysis: null });
            return;
          }

          ensureActiveSession();
          set({ sourceImageForAnalysis: normalizedImage });

          // 🔥 立即缓存用户上传的分析图片
          const imageId = `user_analysis_upload_${Date.now()}`;
          contextManager.cacheLatestImage(
            normalizedImage,
            imageId,
            "用户上传的分析图片"
          );
        },

        // PDF 分析状态设置
        setSourcePdfForAnalysis: (
          pdfData: string | null,
          fileName?: string | null
        ) => {
          set({
            sourcePdfForAnalysis: pdfData,
            sourcePdfFileName: pdfData ? fileName ?? null : null,
          });
          if (pdfData) {
          }
        },

        // PDF 分析功能
        analyzePdf: async (
          prompt: string,
          sourcePdf: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "analyzePdf entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          // 格式化 PDF 数据
          const formattedPdfData = sourcePdf.startsWith("data:application/pdf")
            ? sourcePdf
            : `data:application/pdf;base64,${sourcePdf}`;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(override.userMessageId, (msg) => ({
              ...msg,
              content: prompt ? `分析 PDF: ${prompt}` : "分析这个 PDF 文件",
            }));
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在分析 PDF 文件...",
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            state.addMessage({
              type: "user",
              content: prompt ? `分析 PDF: ${prompt}` : "分析这个 PDF 文件",
            });

            // 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在分析 PDF 文件...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              provider: state.aiProvider,
            };

            const storedPlaceholder = state.addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "analyzePdf message prepared");

          try {
            // 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 15,
              error: null,
              stage: "正在分析",
            });

            // 模拟进度更新 - 2分钟（120秒）内从0%到95%
            // 每秒更新一次，每次增加约0.79%
            logProcessStep(metrics, "analyzePdf progress interval start");
            const PROGRESS_MAX_PDF = 95;
            const PROGRESS_INCREMENT_PDF = PROGRESS_MAX_PDF / 120; // 约0.79%每秒
            const progressInterval = setInterval(() => {
              const currentMessage = get().messages.find(
                (m) => m.id === aiMessageId
              );
              const currentProgress =
                currentMessage?.generationStatus?.progress ?? 0;

              if (currentProgress >= PROGRESS_MAX_PDF) {
                clearInterval(progressInterval);
                return;
              }

              const nextProgress = Math.min(
                PROGRESS_MAX_PDF,
                currentProgress + PROGRESS_INCREMENT_PDF
              );

              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: nextProgress,
                error: null,
              });
            }, 1000);

            // 调用后端API分析 PDF（复用 analyzeImage 接口）
            const modelToUse = getImageModelForProvider(state.aiProvider);

            const result = await analyzeImageViaAPI({
              prompt: prompt || "请详细分析这个 PDF 文件的内容",
              sourceImage: formattedPdfData,
              model: modelToUse,
              aiProvider: state.aiProvider,
            });

            clearInterval(progressInterval);
            logProcessStep(metrics, "analyzePdf API response received");

            if (result.success && result.data) {
              // 更新消息内容和完成状态
              set((curState) => ({
                messages: curState.messages.map((msg) =>
                  msg.id === aiMessageId
                    ? {
                        ...msg,
                        content: result.data!.analysis,
                        generationStatus: {
                          isGenerating: false,
                          progress: 100,
                          error: null,
                        },
                      }
                    : msg
                ),
              }));

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = result.data!.analysis;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              // 清除 PDF 状态
              set({ sourcePdfForAnalysis: null, sourcePdfFileName: null });
              logProcessStep(metrics, "analyzePdf completed");
            } else {
              throw new Error(result.error?.message || "PDF 分析失败");
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ PDF 分析异常:", error);
            logProcessStep(metrics, "analyzePdf failed");
          }
        },

        // 文本对话功能（支持并行）
        generateTextResponse: async (
          prompt: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          // 🔥 并行模式：不检查全局状态

          const metrics = options?.metrics;
          logProcessStep(metrics, "generateTextResponse entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在生成文本回复...",
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备中",
              },
            }));
          } else {
            // 添加用户消息
            get().addMessage({
              type: "user",
              content: prompt,
            });

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在生成文本回复...",
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备中",
              },
              provider: get().aiProvider,
            };

            const storedPlaceholder = get().addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "generateTextResponse message prepared");

          try {
            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 50,
              error: null,
              stage: "正在生成文本回复...",
            });

            // 调用后端API生成文本
            const state = get();
            const modelToUse = getTextModelForProvider(state.aiProvider);
            const contextPrompt = contextManager.buildContextPrompt(prompt);

            logProcessStep(
              metrics,
              `generateTextResponse calling API (${modelToUse})`
            );
            const result = await generateTextResponseViaAPI({
              prompt: contextPrompt,
              model: modelToUse,
              aiProvider: state.aiProvider,
              enableWebSearch: state.enableWebSearch,
              thinkingLevel: state.thinkingLevel || undefined,
            });
            logProcessStep(
              metrics,
              "generateTextResponse API response received"
            );

            if (result.success && result.data) {
              // 🔥 更新消息内容和完成状态
              set((state) => ({
                messages: optimizeMessagesMemory(
                  state.messages.map((msg) =>
                    msg.id === aiMessageId
                      ? {
                          ...msg,
                          content: result.data!.text,
                          webSearchResult: result.data!.webSearchResult,
                          generationStatus: {
                            isGenerating: false,
                            progress: 100,
                            error: null,
                          },
                        }
                      : msg
                  )
                ),
              }));

              // 同步到 contextManager
              const context = contextManager.getCurrentContext();
              if (context) {
                const message = context.messages.find(
                  (m) => m.id === aiMessageId
                );
                if (message) {
                  message.content = result.data!.text;
                  message.webSearchResult = result.data!.webSearchResult;
                  message.generationStatus = {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  };
                }
              }

              await get().refreshSessions();
              logProcessStep(metrics, "generateTextResponse completed");
            } else {
              throw new Error(result.error?.message || "文本生成失败");
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "未知错误";

            get().updateMessageStatus(aiMessageId, {
              isGenerating: false,
              progress: 0,
              error: errorMessage,
            });

            console.error("❌ 文本生成失败:", errorMessage);
            logProcessStep(metrics, "generateTextResponse failed");
          }
        },

        // 🎬 视频生成方法
        generateVideo: async (
          prompt: string,
          referenceImages?: string | string[] | null,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const metrics = options?.metrics;
          logProcessStep(metrics, "generateVideo entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在生成视频...",
              expectsVideoOutput: true,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备视频生成",
              },
            }));
          } else {
            // 添加用户消息
            get().addMessage({
              type: "user",
              content: prompt,
            });

            // 🔥 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在生成视频...",
              expectsVideoOutput: true,
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备视频生成",
              },
              provider: get().aiProvider,
            };

            const storedPlaceholder = get().addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "generateVideo message prepared");

          try {
            // 处理参考图像上传（如果有）
            const referenceImageList = Array.isArray(referenceImages)
              ? referenceImages
              : referenceImages
              ? [referenceImages]
              : [];
            const referenceImageUrls: string[] = [];

            if (referenceImageList.length) {
              get().updateMessageStatus(aiMessageId, {
                isGenerating: true,
                progress: 15,
                error: null,
                stage: "上传参考图像",
              });

              const projectId = useProjectContentStore.getState().projectId;
              for (const img of referenceImageList) {
                if (!img) continue;
                try {
                  const uploadInput = toRenderableImageSrc(img) ?? img;
                  const uploadedUrl = await uploadImageToOSS(uploadInput, projectId);
                  if (uploadedUrl) {
                    referenceImageUrls.push(uploadedUrl);
                  } else {
                    console.warn("⚠️ 参考图像上传失败，继续生成视频");
                  }
                } catch (error) {
                  console.warn("⚠️ 参考图像上传失败，继续生成视频", error);
                }
              }
            }

            // 🔥 使用消息级别的进度更新
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 30,
              error: null,
              stage: "发送请求到视频服务",
            });

            // 调用视频生成函数
            logProcessStep(metrics, "generateVideo calling backend video API");
            const videoResult = await requestSora2VideoGeneration(
              prompt,
              referenceImageUrls,
              {
                quality: DEFAULT_SORA2_VIDEO_QUALITY,
                onProgress: (stage, progress) => {
                  get().updateMessageStatus(aiMessageId!, {
                    isGenerating: true,
                    progress: Math.min(95, progress),
                    error: null,
                    stage,
                  });
                },
              }
            );

            logProcessStep(metrics, "generateVideo API response received");

            // 更新消息，包含视频信息
            const contentWithFallback = (videoResult as any).fallbackMessage
              ? `${videoResult.content}\n\nℹ️ ${
                  (videoResult as any).fallbackMessage
                }`
              : videoResult.content;

            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              type: "ai",
              content: contentWithFallback,
              videoUrl: videoResult.videoUrl,
              videoSourceUrl: videoResult.videoUrl,
              videoReferencedUrls: videoResult.referencedUrls,
              videoTaskId: videoResult.taskId ?? null,
              videoStatus: videoResult.status ?? null,
              videoThumbnail: msg.videoThumbnail || videoResult.thumbnailUrl,
              videoMetadata: {
                ...(msg.videoMetadata || {}),
                taskInfo: videoResult.taskInfo,
                referencedUrls: videoResult.referencedUrls,
                fallbackMessage: (videoResult as any).fallbackMessage,
              },
              expectsVideoOutput: false,
              generationStatus: {
                isGenerating: false,
                progress: 100,
                error: null,
                stage: "完成",
              },
            }));
            logProcessStep(metrics, "generateVideo finished");

            if (ENABLE_VIDEO_CANVAS_PLACEMENT) {
              void (async () => {
                const placedPoster = await autoPlaceVideoOnCanvas({
                  prompt,
                  videoUrl: videoResult.videoUrl,
                  thumbnailUrl: videoResult.thumbnailUrl,
                });
                if (placedPoster && aiMessageId) {
                  get().updateMessage(aiMessageId, (msg) => ({
                    ...msg,
                    videoThumbnail: msg.videoThumbnail || placedPoster,
                  }));
                }
              })();
            }

            // 🧠 记录到上下文
            contextManager.recordOperation({
              type: "generateVideo",
              input: prompt,
              output: videoResult.videoUrl,
              success: true,
              metadata: {
                referencedUrls: videoResult.referencedUrls,
                taskId: videoResult.taskId,
                status: videoResult.status,
              },
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "视频生成失败";
            console.error("❌ 视频生成异常:", error);

            // 更新消息状态为错误
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: `视频生成失败: ${errorMessage}`,
              expectsVideoOutput: false,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: false,
                progress: 0,
                error: errorMessage,
                stage: "已终止",
              },
            }));

            // 🧠 记录失败
            contextManager.recordOperation({
              type: "generateVideo",
              input: prompt,
              output: undefined,
              success: false,
            });

            logProcessStep(metrics, "generateVideo failed");
          }
        },

        /**
         * 生成 Paper.js 代码并执行
         */
        generatePaperJSCode: async (
          prompt: string,
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "generatePaperJSCode entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在生成 Paper.js 代码...",
              expectsImageOutput: false,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "准备代码生成",
              },
            }));
          } else {
            // 添加用户消息
            get().addMessage({
              type: "user",
              content: prompt,
            });

            // 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在生成 Paper.js 代码...",
              expectsImageOutput: false,
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "准备代码生成",
              },
              provider: state.aiProvider,
            };

            const storedPlaceholder = get().addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "generatePaperJSCode message prepared");

          // 显示占位标记
          if (paperSandboxService.isReady()) {
            paperSandboxService.showVectorPlaceholder();
          }

          try {
            // 更新进度
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 20,
              error: null,
              stage: "生成代码中",
            });

            // 调用 AI 生成 Paper.js 代码
            const result = await aiImageService.generatePaperJSCode({
              prompt,
              aiProvider: state.aiProvider,
              // 根据 provider 选择正确的模型
              model: getTextModelForProvider(state.aiProvider),
              thinkingLevel: state.thinkingLevel ?? undefined,
              canvasWidth: 1920,
              canvasHeight: 1080,
            });

            logProcessStep(metrics, "generatePaperJSCode API call completed");

            if (!result.success || !result.data) {
              throw new Error(result.error?.message || "Paper.js 代码生成失败");
            }

            const { code, explanation } = result.data;

            // 更新进度
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 60,
              error: null,
              stage: "执行代码中",
            });

            // 检查 Paper.js 是否就绪
            if (!paperSandboxService.isReady()) {
              throw new Error("Paper.js 画布尚未就绪，请稍后再试");
            }

            // 执行 Paper.js 代码
            const executionResult = paperSandboxService.executeCode(code);

            if (!executionResult.success) {
              throw new Error(executionResult.error || "代码执行失败");
            }

            // 更新进度
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 85,
              error: null,
              stage: "应用到画布",
            });

            // 隐藏占位标记
            paperSandboxService.hideVectorPlaceholder();

            // 自动应用到当前图层
            const applyResult = paperSandboxService.applyOutputToActiveLayer();

            if (!applyResult.success) {
              console.warn("⚠️ 应用到画布失败:", applyResult.error);
              // 不抛出错误，因为代码已经执行成功
            }

            // 更新消息为成功
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: `✅ Paper.js 矢量图形已生成到画布中央！\n\n${
                explanation || "代码已成功执行并应用到画布。"
              }`,
              generationStatus: {
                isGenerating: false,
                progress: 100,
                error: null,
                stage: "完成",
              },
            }));

            // 记录操作历史（已注释，contextManager 不支持此方法）
            // contextManager.addOperation({
            //   type: 'generatePaperJS',
            //   input: prompt,
            //   output: { code, explanation },
            //   success: true
            // });

            logProcessStep(
              metrics,
              "generatePaperJSCode completed successfully"
            );
          } catch (error) {
            // 隐藏占位标记
            paperSandboxService.hideVectorPlaceholder();

            const errorMessage =
              error instanceof Error ? error.message : "Paper.js 代码生成失败";
            console.error("❌ Paper.js 代码生成失败:", errorMessage);

            // 更新消息为错误状态
            get().updateMessage(aiMessageId!, (msg) => ({
              ...msg,
              content: `❌ Paper.js 代码生成失败: ${errorMessage}`,
              generationStatus: {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
                stage: "已终止",
              },
            }));

            // 记录操作历史（已注释，contextManager 不支持此方法）
            // contextManager.addOperation({
            //   type: 'generatePaperJS',
            //   input: prompt,
            //   output: undefined,
            //   success: false
            // });

            logProcessStep(metrics, "generatePaperJSCode failed");
            throw error;
          }
        },

        // 图像转矢量 - 分析图像并生成 Paper.js 矢量代码
        img2Vector: async (
          prompt: string,
          sourceImage: string,
          style: "simple" | "detailed" | "artistic" = "detailed",
          options?: { override?: MessageOverride; metrics?: ProcessMetrics }
        ) => {
          const state = get();
          const metrics = options?.metrics;
          logProcessStep(metrics, "img2Vector entered");

          const override = options?.override;
          let aiMessageId: string | undefined;

          if (override) {
            aiMessageId = override.aiMessageId;
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: "正在分析图像并生成矢量图...",
              expectsImageOutput: false,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: true,
                error: null,
                stage: "分析图像中",
              },
            }));
          } else {
            // 添加用户消息
            get().addMessage({
              type: "user",
              content: prompt,
            });

            // 创建占位 AI 消息
            const placeholderMessage: Omit<ChatMessage, "id" | "timestamp"> = {
              type: "ai",
              content: "正在分析图像并生成矢量图...",
              expectsImageOutput: false,
              generationStatus: {
                isGenerating: true,
                progress: 0,
                error: null,
                stage: "分析图像中",
              },
              provider: state.aiProvider,
            };

            const storedPlaceholder = get().addMessage(placeholderMessage);
            aiMessageId = storedPlaceholder.id;
          }

          if (!aiMessageId) {
            console.error("❌ 无法获取AI消息ID");
            return;
          }
          logProcessStep(metrics, "img2Vector message prepared");

          // 显示占位标记
          if (paperSandboxService.isReady()) {
            paperSandboxService.showVectorPlaceholder();
          }

          try {
            // 更新进度 - 分析图像
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 20,
              error: null,
              stage: "分析图像中",
            });

            // 调用 AI 进行图像转矢量
            const result = await aiImageService.img2Vector({
              sourceImage,
              prompt,
              aiProvider: state.aiProvider,
              model: getTextModelForProvider(state.aiProvider),
              thinkingLevel: state.thinkingLevel ?? undefined,
              canvasWidth: 1920,
              canvasHeight: 1080,
              style,
            });

            logProcessStep(metrics, "img2Vector API call completed");

            if (!result.success || !result.data) {
              throw new Error(result.error?.message || "图像转矢量失败");
            }

            const { code, imageAnalysis, explanation } = result.data;

            // 更新进度 - 生成代码
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 50,
              error: null,
              stage: "生成代码中",
            });

            // 更新进度 - 执行代码
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 60,
              error: null,
              stage: "执行代码中",
            });

            // 检查 Paper.js 是否就绪
            if (!paperSandboxService.isReady()) {
              throw new Error("Paper.js 画布尚未就绪，请稍后再试");
            }

            // 执行 Paper.js 代码
            const executionResult = paperSandboxService.executeCode(code);

            if (!executionResult.success) {
              throw new Error(executionResult.error || "代码执行失败");
            }

            // 更新进度 - 应用到画布
            get().updateMessageStatus(aiMessageId, {
              isGenerating: true,
              progress: 85,
              error: null,
              stage: "应用到画布",
            });

            // 隐藏占位标记
            paperSandboxService.hideVectorPlaceholder();

            // 自动应用到当前图层
            const applyResult = paperSandboxService.applyOutputToActiveLayer();

            if (!applyResult.success) {
              console.warn("⚠️ 应用到画布失败:", applyResult.error);
            }

            // 更新消息为成功
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              content: `✅ 图像已转换为矢量图形！\n\n📊 图像分析:\n${imageAnalysis}\n\n${
                explanation || "矢量图已成功生成并应用到画布。"
              }`,
              generationStatus: {
                isGenerating: false,
                progress: 100,
                error: null,
                stage: "完成",
              },
            }));

            logProcessStep(metrics, "img2Vector completed successfully");
          } catch (error) {
            // 隐藏占位标记
            paperSandboxService.hideVectorPlaceholder();

            const errorMessage =
              error instanceof Error ? error.message : "图像转矢量失败";
            console.error("❌ 图像转矢量失败:", errorMessage);

            // 更新消息为错误状态
            get().updateMessage(aiMessageId!, (msg) => ({
              ...msg,
              content: `❌ 图像转矢量失败: ${errorMessage}`,
              generationStatus: {
                isGenerating: false,
                progress: 0,
                error: errorMessage,
                stage: "已终止",
              },
            }));

            logProcessStep(metrics, "img2Vector failed");
            throw error;
          }
        },

        // 🔄 核心处理流程 - 可重试的执行逻辑
        executeProcessFlow: async (
          input: string,
          isRetry: boolean = false,
          groupInfo?: {
            groupId: string;
            groupIndex: number;
            groupTotal: number;
          }
        ) => {
          const state = get();
          const metrics = createProcessMetrics();
          logProcessStep(metrics, "executeProcessFlow start");

          // 检测迭代意图
          const isIterative = contextManager.detectIterativeIntent(input);
          if (isIterative && !isRetry) {
            contextManager.incrementIteration();
          }

          // 🔥 并行生成时，只有第一个任务创建用户消息
          const isParallelMode = !!groupInfo;
          const isFirstInGroup = groupInfo?.groupIndex === 0;

          // 预先创建用户消息与占位AI消息，提供即时反馈
          let pendingUserMessage: ChatMessage;
          if (isParallelMode && !isFirstInGroup) {
            // 并行模式下，非第一个任务复用第一个任务的用户消息（不重复创建）
            const existingUserMsg = get().messages.find(
              (m) =>
                m.type === "user" &&
                m.content === input &&
                m.groupId === groupInfo.groupId
            );
            pendingUserMessage =
              existingUserMsg ||
              get().addMessage({
                type: "user",
                content: input,
                groupId: groupInfo.groupId,
                groupIndex: 0,
                groupTotal: groupInfo.groupTotal,
              });
          } else {
            pendingUserMessage = get().addMessage({
              type: "user",
              content: input,
              ...(groupInfo && {
                groupId: groupInfo.groupId,
                groupIndex: 0,
                groupTotal: groupInfo.groupTotal,
              }),
            });
          }

          const pendingAiMessage = get().addMessage({
            type: "ai",
            content: isParallelMode
              ? `正在生成第 ${(groupInfo?.groupIndex ?? 0) + 1}/${
                  groupInfo?.groupTotal ?? 1
                } 张...`
              : "正在准备处理您的请求...",
            generationStatus: {
              isGenerating: true,
              progress: 5,
              error: null,
              stage: "准备中",
            },
            ...(groupInfo && {
              groupId: groupInfo.groupId,
              groupIndex: groupInfo.groupIndex,
              groupTotal: groupInfo.groupTotal,
            }),
          });

          const messageOverride: MessageOverride = {
            userMessageId: pendingUserMessage.id,
            aiMessageId: pendingAiMessage.id,
          };

          metrics.messageId = messageOverride.aiMessageId;
          logProcessStep(metrics, "messages prepared");

          // 准备工具选择请求
          const cachedImage = contextManager.getCachedImage();

          // 计算显式图片数量（不包含缓存图片）
          let explicitImageCount = 0;

          // 计算融合模式的图片数量
          if (state.sourceImagesForBlending.length > 0) {
            explicitImageCount += state.sourceImagesForBlending.length;
          }

          // 如果有编辑图片，计入总数
          if (state.sourceImageForEditing) {
            explicitImageCount += 1;
          }

          // 如果有分析图片，计入总数
          if (state.sourceImageForAnalysis) {
            explicitImageCount += 1;
          }

          // 总图像数量 = 显式图片 + 缓存图片（如果存在）
          const totalImageCount = explicitImageCount + (cachedImage ? 1 : 0);

          const toolSelectionContext = contextManager.buildContextPrompt(input);

          const toolSelectionRequest = {
            userInput: input,
            hasImages: totalImageCount > 0,
            imageCount: explicitImageCount, // 传递显式图片数量，不包含缓存
            hasCachedImage: !!cachedImage, // 单独标记是否有缓存图片
            availableTools: [
              "generateImage",
              "editImage",
              "blendImages",
              "analyzeImage",
              "chatResponse",
              "generateVideo",
              "generatePaperJS",
            ],
            aiProvider: state.aiProvider,
            context: toolSelectionContext,
          };

          // 根据手动模式或AI选择工具
          const manualMode = state.manualAIMode;
          const manualToolMap: Record<ManualAIMode, AvailableTool | null> = {
            auto: null,
            text: "chatResponse",
            generate: "generateImage",
            edit: "editImage",
            blend: "blendImages",
            analyze: "analyzeImage",
            video: "generateVideo",
            vector: "generatePaperJS",
          };

          let selectedTool: AvailableTool | null = null;
          let parameters: { prompt: string } = { prompt: input };

          if (manualMode !== "auto") {
            selectedTool = manualToolMap[manualMode];
          } else {
            // 📄 检测是否有 PDF 文件需要分析
            if (state.sourcePdfForAnalysis) {
              selectedTool = "analyzePdf";
            } else if (state.sourceImagesForBlending.length >= 2) {
              // 🖼️ 多图强制使用融合模式，避免 AI 误选 editImage
              selectedTool = "blendImages";
              logProcessStep(
                metrics,
                "multi-image detected, using blendImages"
              );
            } else {
              // 完全靠 AI 来判断工具选择，包括矢量图生成
              logProcessStep(metrics, "tool selection start");
              const toolSelectionResult = await aiImageService.selectTool(
                toolSelectionRequest
              );
              logProcessStep(metrics, "tool selection completed");

              if (!toolSelectionResult.success || !toolSelectionResult.data) {
                const errorMsg =
                  toolSelectionResult.error?.message || "工具选择失败";
                console.error("❌ 工具选择失败:", errorMsg);
                throw new Error(errorMsg);
              }

              selectedTool = toolSelectionResult.data
                .selectedTool as AvailableTool | null;
              parameters = {
                prompt: toolSelectionResult.data.parameters?.prompt || input,
              };
              logProcessStep(
                metrics,
                `tool decided: ${selectedTool ?? "none"}`
              );
            }
          }

          if (!selectedTool) {
            throw new Error("未选择执行工具");
          }

          // 根据选择的工具执行相应操作
          // 获取最新的 store 实例来调用方法
          const store = get();

          try {
            switch (selectedTool) {
              case "generateImage":
                logProcessStep(metrics, "invoking generateImage");
                await store.generateImage(parameters.prompt, {
                  override: messageOverride,
                  metrics,
                });
                logProcessStep(metrics, "generateImage finished");
                break;

              case "editImage":
                if (state.sourceImageForEditing) {
                  logProcessStep(
                    metrics,
                    "invoking editImage with explicit image"
                  );
                  await store.editImage(
                    parameters.prompt,
                    state.sourceImageForEditing,
                    true,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "editImage finished");

                  // 🧠 检测是否需要保持编辑状态
                  if (!isIterative) {
                    store.setSourceImageForEditing(null);
                    contextManager.resetIteration();
                  }
                } else {
                  // 🖼️ 检查是否有缓存的图像可以编辑
                  const cachedImage = contextManager.getCachedImage();

                  const cachedSource = cachedImage
                    ? await resolveCachedImageForImageTools(cachedImage)
                    : null;

                  if (cachedImage && cachedSource) {
                    logProcessStep(
                      metrics,
                      "invoking editImage with cached image"
                    );
                    await store.editImage(
                      parameters.prompt,
                      cachedSource,
                      false,
                      { override: messageOverride, metrics }
                    ); // 不显示图片占位框
                    logProcessStep(metrics, "editImage finished");
                  } else {
                    console.error("❌ 无法编辑图像的原因:", {
                      cachedImage: cachedImage ? "exists" : "null",
                      hasRemoteUrl: !!cachedImage?.remoteUrl,
                      hasImageData: !!cachedImage?.imageData,
                      input: input,
                    });
                    throw new Error("没有可编辑的图像");
                  }
                }
                break;

              case "blendImages":
                if (state.sourceImagesForBlending.length >= 2) {
                  logProcessStep(metrics, "invoking blendImages");
                  await store.blendImages(
                    parameters.prompt,
                    state.sourceImagesForBlending,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "blendImages finished");
                  store.clearImagesForBlending();
                } else {
                  throw new Error("需要至少2张图像进行融合");
                }
                break;

              case "analyzeImage":
                if (state.sourceImageForAnalysis) {
                  logProcessStep(
                    metrics,
                    "invoking analyzeImage (analysis source)"
                  );
                  await store.analyzeImage(
                    parameters.prompt || input,
                    state.sourceImageForAnalysis,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "analyzeImage finished");
                  store.setSourceImageForAnalysis(null);
                } else if (state.sourceImageForEditing) {
                  logProcessStep(
                    metrics,
                    "invoking analyzeImage (editing source)"
                  );
                  await store.analyzeImage(
                    parameters.prompt || input,
                    state.sourceImageForEditing,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "analyzeImage finished");
                  // 分析后不清除图像，用户可能还想编辑
                } else {
                  // 🖼️ 检查是否有缓存的图像可以分析
                  const cachedImage = contextManager.getCachedImage();
                  const cachedSource = cachedImage
                    ? await resolveCachedImageForImageTools(cachedImage)
                    : null;
                  if (cachedImage && cachedSource) {
                    logProcessStep(
                      metrics,
                      "invoking analyzeImage (cached image)"
                    );
                    await store.analyzeImage(
                      parameters.prompt || input,
                      cachedSource,
                      { override: messageOverride, metrics }
                    );
                    logProcessStep(metrics, "analyzeImage finished");
                  } else {
                    throw new Error("没有可分析的图像");
                  }
                }
                break;

              case "analyzePdf":
                if (state.sourcePdfForAnalysis) {
                  logProcessStep(metrics, "invoking analyzePdf");
                  await store.analyzePdf(
                    parameters.prompt || input,
                    state.sourcePdfForAnalysis,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "analyzePdf finished");
                  // analyzePdf 方法内部会清除 sourcePdfForAnalysis
                } else {
                  throw new Error("没有可分析的 PDF 文件");
                }
                break;

              case "chatResponse":
                try {
                  logProcessStep(metrics, "invoking generateTextResponse");
                  await store.generateTextResponse(parameters.prompt, {
                    override: messageOverride,
                    metrics,
                  });
                  logProcessStep(metrics, "generateTextResponse finished");
                } catch (error) {
                  console.error("❌ generateTextResponse 执行失败:", error);
                  if (error instanceof Error) {
                    console.error("❌ 错误堆栈:", error.stack);
                  }
                  throw error;
                }
                break;

              case "generateVideo":
                try {
                  logProcessStep(metrics, "invoking generateVideo");
                  await store.generateVideo(
                    parameters.prompt,
                    state.sourceImageForEditing,
                    { override: messageOverride, metrics }
                  );
                  logProcessStep(metrics, "generateVideo finished");
                  // 清理源图像
                  if (state.sourceImageForEditing) {
                    store.setSourceImageForEditing(null);
                  }
                } catch (error) {
                  console.error("❌ generateVideo 执行失败:", error);
                  if (error instanceof Error) {
                    console.error("❌ 错误堆栈:", error.stack);
                  }
                  throw error;
                }
                break;

              case "generatePaperJS":
                try {
                  logProcessStep(metrics, "invoking generatePaperJS");
                  // 检查是否有上传的参考图像用于 img2vector
                  if (state.sourceImageForEditing) {
                    // 使用 img2vector 功能
                    const vectorStyle =
                      (state as any).vectorStyle || "detailed";
                    await store.img2Vector(
                      parameters.prompt,
                      state.sourceImageForEditing,
                      vectorStyle,
                      { override: messageOverride, metrics }
                    );
                    logProcessStep(metrics, "img2Vector finished");
                    // 清理源图像
                    store.setSourceImageForEditing(null);
                  } else {
                    // 使用普通的 generatePaperJS
                    await store.generatePaperJSCode(parameters.prompt, {
                      override: messageOverride,
                      metrics,
                    });
                    logProcessStep(metrics, "generatePaperJS finished");
                  }
                } catch (error) {
                  console.error("❌ Paper.js 代码生成失败:", error);
                  if (error instanceof Error) {
                    console.error("❌ 错误堆栈:", error.stack);
                  }
                  throw error;
                }
                break;

              default:
                throw new Error(`未知工具: ${selectedTool}`);
            }
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : "处理失败";
            get().updateMessage(messageOverride.aiMessageId, (msg) => ({
              ...msg,
              content: `处理失败: ${errorMessage}`,
              generationStatus: {
                ...(msg.generationStatus || {
                  isGenerating: true,
                  progress: 0,
                  error: null,
                }),
                isGenerating: false,
                progress: 0,
                error: errorMessage,
                stage: "已终止",
              },
            }));
            logProcessStep(metrics, "executeProcessFlow encountered error");
            throw err;
          }
          logProcessStep(metrics, "executeProcessFlow done");
        },

        // 智能工具选择功能 - 统一入口（支持并行生成）
        processUserInput: async (input: string) => {
          const state = get();

          // 🧠 确保有活跃的会话并同步状态
          let sessionId =
            state.currentSessionId || contextManager.getCurrentSessionId();
          if (!sessionId) {
            sessionId = contextManager.createSession();
          } else if (contextManager.getCurrentSessionId() !== sessionId) {
            contextManager.switchSession(sessionId);
          }

          if (sessionId !== state.currentSessionId) {
            const context = contextManager.getSession(sessionId);
            set({
              currentSessionId: sessionId,
              messages: context ? [...context.messages] : [],
            });
          }

          get().refreshSessions();

          // 🔥 第一步：先进行工具选择，判断用户意图
          // 只有确定是图片相关操作后，才应用 multiplier
          const manualMode = state.manualAIMode;
          const manualToolMap: Record<ManualAIMode, AvailableTool | null> = {
            auto: null,
            text: "chatResponse",
            generate: "generateImage",
            edit: "editImage",
            blend: "blendImages",
            analyze: "analyzeImage",
            video: "generateVideo",
            vector: "generatePaperJS",
          };

          let selectedTool: AvailableTool | null = null;

          // 如果是手动模式，直接使用对应工具
          if (manualMode !== "auto") {
            selectedTool = manualToolMap[manualMode];
          } else {
            // Auto 模式：先检查 PDF，再调用 AI 判断
            if (state.sourcePdfForAnalysis) {
              selectedTool = "analyzePdf";
            } else if (state.sourceImagesForBlending.length >= 2) {
              // 🖼️ 多图强制使用融合模式，避免 AI 误选 editImage
              selectedTool = "blendImages";
              console.log("🎯 [工具选择] 检测到多图输入，强制使用融合模式");
            } else {
              // 调用 AI 进行工具选择
              const cachedImage = contextManager.getCachedImage();
              let explicitImageCount = 0;
              if (state.sourceImagesForBlending.length > 0) {
                explicitImageCount += state.sourceImagesForBlending.length;
              }
              if (state.sourceImageForEditing) {
                explicitImageCount += 1;
              }
              if (state.sourceImageForAnalysis) {
                explicitImageCount += 1;
              }
              const totalImageCount =
                explicitImageCount + (cachedImage ? 1 : 0);
              const toolSelectionContext =
                contextManager.buildContextPrompt(input);

              const toolSelectionRequest = {
                userInput: input,
                hasImages: totalImageCount > 0,
                imageCount: explicitImageCount,
                hasCachedImage: !!cachedImage,
                availableTools: [
                  "generateImage",
                  "editImage",
                  "blendImages",
                  "analyzeImage",
                  "chatResponse",
                  "generateVideo",
                  "generatePaperJS",
                ],
                aiProvider: state.aiProvider,
                context: toolSelectionContext,
              };

              try {
                const toolSelectionResult = await aiImageService.selectTool(
                  toolSelectionRequest
                );
                if (toolSelectionResult.success && toolSelectionResult.data) {
                  selectedTool = toolSelectionResult.data
                    .selectedTool as AvailableTool;
                  console.log(`🎯 [工具选择] AI 选择了: ${selectedTool}`);
                } else {
                  console.warn("⚠️ 工具选择失败，默认使用 chatResponse");
                  selectedTool = "chatResponse";
                }
              } catch (error) {
                console.error("❌ 工具选择异常:", error);
                selectedTool = "chatResponse";
              }
            }
          }

          // 🔥 第二步：根据选择的工具决定是否应用 multiplier
          // 只有图片生成相关工具才支持并行生成
          const imageGenerationTools: AvailableTool[] = [
            "generateImage",
            "editImage",
            "blendImages",
          ];
          const isImageGenerationTool =
            selectedTool && imageGenerationTools.includes(selectedTool);

          const multiplier: AutoModeMultiplier = isImageGenerationTool
            ? state.autoModeMultiplier
            : 1;

          console.log(
            `🔧 [处理流程] 工具: ${selectedTool}, multiplier: ${multiplier}`
          );

          // 🔥 第三步：根据 multiplier 决定是单次还是并行执行
          if (multiplier === 1) {
            // 单次执行 - 使用完整的 executeProcessFlow（会跳过重复的工具选择）
            try {
              await get().executeProcessFlow(input, false);
            } catch (error) {
              let errorMessage =
                error instanceof Error ? error.message : "处理失败";

              if (
                errorMessage &&
                errorMessage.length > 1000 &&
                errorMessage.includes("iVBORw0KGgo")
              ) {
                console.warn(
                  "⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息"
                );
                errorMessage = "图像处理失败，请重试";
              }

              const messages = get().messages;
              const hasErrorSurface = messages.some(
                (msg) =>
                  msg.type === "ai" &&
                  msg.generationStatus?.stage === "已终止" &&
                  msg.generationStatus?.error === errorMessage
              );
              if (!hasErrorSurface) {
                get().addMessage({
                  type: "error",
                  content: `处理失败: ${errorMessage}`,
                });
              }

              console.error("❌ 智能处理异常:", error);
            }
          } else {
            // 🔥 并行生成 - 只有图片相关工具才会走到这里
            const groupId = `group-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 6)}`;
            console.log(
              `🚀 [并行生成] 开始并行生成 ${multiplier} 张图片，groupId: ${groupId}, 工具: ${selectedTool}`
            );

            // 🔥 先创建用户消息，避免竞态条件
            const userMessage = get().addMessage({
              type: "user",
              content: input,
              groupId,
              groupIndex: 0,
              groupTotal: multiplier,
            });

            // 🔥 预先创建所有 AI 占位消息
            const aiMessageIds: string[] = [];
            for (let i = 0; i < multiplier; i++) {
              const aiMsg = get().addMessage({
                type: "ai",
                content: `正在生成第 ${i + 1}/${multiplier} 张...`,
                generationStatus: {
                  isGenerating: true,
                  progress: 5,
                  error: null,
                  stage: "准备中",
                },
                groupId,
                groupIndex: i,
                groupTotal: multiplier,
                expectsImageOutput: true,
              });
              aiMessageIds.push(aiMsg.id);
            }

            // ⚠️ 这里不要真正 Promise.all 并发：多张大图同时解码/转码会造成瞬时内存峰值。
            // 改为限制并发执行（仍保留“批量生成”的 UX：先占位，后逐个完成）。
            const deviceMemory =
              typeof navigator !== "undefined"
                ? (navigator as any).deviceMemory
                : undefined;
            const imageSize = state.imageSize ?? "1K";
            const suggestedConcurrency =
              imageSize === "4K" ||
              (typeof deviceMemory === "number" && deviceMemory <= 4)
                ? 1
                : 2;
            const concurrency = Math.max(
              1,
              Math.min(multiplier, suggestedConcurrency)
            );

            void (async () => {
              const results = await mapWithLimit(
                aiMessageIds,
                concurrency,
                async (aiMessageId, index) => {
                  try {
                    await get().executeParallelImageGeneration(input, {
                      groupId,
                      groupIndex: index,
                      groupTotal: multiplier,
                      userMessageId: userMessage.id,
                      aiMessageId,
                    });
                    return true;
                  } catch (error) {
                    console.error(
                      `❌ [并行生成] 第 ${index + 1} 个任务失败:`,
                      error
                    );
                    get().updateMessageStatus(aiMessageId, {
                      isGenerating: false,
                      error:
                        error instanceof Error ? error.message : "生成失败",
                    });
                    return false;
                  }
                }
              );

              const successCount = results.filter(Boolean).length;
              console.log(
                `✅ [并行生成] 完成，成功 ${successCount}/${multiplier} (concurrency=${concurrency})`
              );
            })().catch((error) => {
              console.error("❌ [并行生成] 执行队列异常:", error);
            });
          }
        },

        // 🔥 并行图片生成 - 使用预创建的消息，直接调用 generateImage
        executeParallelImageGeneration: async (
          input: string,
          options: {
            groupId: string;
            groupIndex: number;
            groupTotal: number;
            userMessageId: string;
            aiMessageId: string;
          }
        ) => {
          const { aiMessageId, userMessageId, groupIndex } = options;
          const metrics = createProcessMetrics();
          metrics.messageId = aiMessageId;
          logProcessStep(
            metrics,
            `parallel generation ${options.groupIndex + 1}/${
              options.groupTotal
            } start`
          );

          // 🔥 为每个并行任务添加递增的启动延迟，避免占位符位置计算冲突
          // 第一个立即开始，后续每个延迟 200ms
          if (groupIndex > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, groupIndex * 200)
            );
          }

          const messageOverride: MessageOverride = {
            userMessageId,
            aiMessageId,
          };

          // 读取当前模式与素材，决定到底是生成、编辑还是融合
          const stateSnapshot = get();
          const manualMode = stateSnapshot.manualAIMode;
          const sourceImageForEditing = stateSnapshot.sourceImageForEditing;
          const blendSources = stateSnapshot.sourceImagesForBlending
            ? [...stateSnapshot.sourceImagesForBlending]
            : [];
          const hasBlendSources = blendSources.length >= 2;

          const decideParallelTool = (): "generate" | "edit" | "blend" => {
            if (manualMode === "edit") return "edit";
            if (manualMode === "blend") return "blend";

            // Auto 模式：优先融合，其次编辑，最后生成
            if (manualMode === "auto") {
              if (hasBlendSources) return "blend";
              if (sourceImageForEditing) return "edit";
              return "generate";
            }

            // 其它模式默认仍然走生成
            return "generate";
          };

          const selectedTool = decideParallelTool();

          try {
            if (selectedTool === "edit") {
              const cached = contextManager.getCachedImage();
              const cachedSource = cached
                ? await resolveCachedImageForImageTools(cached)
                : null;
              const editSource = sourceImageForEditing || cachedSource;

              if (!editSource) {
                console.warn("⚠️ [并行编辑] 未找到可编辑的源图，退回生成逻辑");
                await get().generateImage(input, {
                  override: messageOverride,
                  metrics,
                });
              } else {
                await get().editImage(input, editSource, true, {
                  override: messageOverride,
                  metrics,
                });
              }
              logProcessStep(
                metrics,
                `parallel edit ${options.groupIndex + 1}/${
                  options.groupTotal
                } done`
              );
            } else if (selectedTool === "blend") {
              if (!hasBlendSources) {
                console.warn("⚠️ [并行融合] 源图不足，退回生成逻辑");
                await get().generateImage(input, {
                  override: messageOverride,
                  metrics,
                });
              } else {
                await get().blendImages(input, blendSources, {
                  override: messageOverride,
                  metrics,
                });
                // 并行融合完成后不立即清空源图，由外层流程统一处理
              }
              logProcessStep(
                metrics,
                `parallel blend ${options.groupIndex + 1}/${
                  options.groupTotal
                } done`
              );
            } else {
              // 直接调用 generateImage
              await get().generateImage(input, {
                override: messageOverride,
                metrics,
              });
              logProcessStep(
                metrics,
                `parallel generation ${options.groupIndex + 1}/${
                  options.groupTotal
                } done`
              );
            }
          } catch (error) {
            logProcessStep(
              metrics,
              `parallel generation ${options.groupIndex + 1}/${
                options.groupTotal
              } error`
            );
            throw error;
          }
        },

        getAIMode: () => {
          const state = get();
          if (state.manualAIMode && state.manualAIMode !== "auto") {
            if (state.manualAIMode === "text") return "text";
            return state.manualAIMode;
          }
          if (state.sourceImagesForBlending.length >= 2) return "blend";
          if (state.sourceImageForEditing) return "edit";
          if (state.sourcePdfForAnalysis) return "analyzePdf";
          if (state.sourceImageForAnalysis) return "analyze";
          return "generate";
        },

        // 配置管理
        toggleAutoDownload: () =>
          set((state) => ({ autoDownload: !state.autoDownload })),
        setAutoDownload: (value: boolean) => set({ autoDownload: value }),
        toggleWebSearch: () =>
          set((state) => ({ enableWebSearch: !state.enableWebSearch })),
        setWebSearch: (value: boolean) => set({ enableWebSearch: value }),
        toggleImageOnly: () =>
          set((state) => ({ imageOnly: !state.imageOnly })),
        setImageOnly: (value: boolean) => set({ imageOnly: value }),
        setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
        setImageSize: (size) => {
          console.log("📐 [Image Size] 切换分辨率:", {
            from: get().imageSize || "自动(1K)",
            to: size || "自动(1K)",
            currentProvider: get().aiProvider,
            warning: size === "4K" && get().aiProvider === "banana-2.5" ? "⚠️ Fast模式不支持4K，建议切换到Pro" : null,
          });
          set({ imageSize: size });
        },
        setThinkingLevel: (level) => set({ thinkingLevel: level }),
        setManualAIMode: (mode) => set({ manualAIMode: mode }),
        setAIProvider: (provider) => {
          console.log("🔄 [AI Provider] 切换模式:", {
            from: get().aiProvider,
            to: provider,
            label: provider === "banana-2.5" ? "Fast (极速版)" : provider === "banana" ? "Pro (Pro版)" : provider,
          });
          set({ aiProvider: provider });
        },
        setAutoModeMultiplier: (multiplier) => {
          const allowed: AutoModeMultiplier[] = [1, 2, 4, 8];
          const next = allowed.includes(multiplier) ? multiplier : 1;
          set({ autoModeMultiplier: next });
        },
        setSendShortcut: (shortcut) => {
          const next = shortcut === "enter" ? "enter" : "mod-enter";
          set({ sendShortcut: next });
        },
        setExpandedPanelStyle: (style) => {
          const next = style === "solid" ? "solid" : "transparent";
          set({ expandedPanelStyle: next });
        },

        // 重置状态
        resetState: () => {
          set({
            isVisible: false,
            isMaximized: false,
            currentInput: "",
            generationStatus: {
              isGenerating: false,
              progress: 0,
              error: null,
            },
            messages: [],
            lastGeneratedImage: null,
            sourceImageForEditing: null,
            sourceImagesForBlending: [],
            sourceImageForAnalysis: null,
            sourcePdfForAnalysis: null,
            sourcePdfFileName: null,
          });
        },

        // 🧠 上下文管理方法实现
        initializeContext: () => {
          // 异步加载本地会话（IndexedDB 优先，兼容 localStorage）
          if (!hasHydratedSessions) {
            loadLocalSessions().then((stored) => {
              if (
                stored &&
                stored.sessions.length > 0 &&
                !hasHydratedSessions
              ) {
                get().hydratePersistedSessions(
                  stored.sessions,
                  stored.activeSessionId,
                  { markProjectDirty: false }
                );
              }
            });
          }

          let sessionId = contextManager.getCurrentSessionId();
          if (!sessionId) {
            const existingSessions = contextManager.listSessions();
            if (existingSessions.length > 0) {
              sessionId = existingSessions[0].sessionId;
              contextManager.switchSession(sessionId);
            } else {
              sessionId = contextManager.createSession();
            }
          }

          const context = sessionId
            ? contextManager.getSession(sessionId)
            : null;
          set({
            currentSessionId: sessionId,
            messages: context ? [...context.messages] : [],
          });
          hasHydratedSessions = true;
          get().refreshSessions({ markProjectDirty: false });
        },

        getContextSummary: () => {
          return contextManager.getSessionSummary();
        },

        isIterativeMode: () => {
          const context = contextManager.getCurrentContext();
          return context ? context.contextInfo.iterationCount > 0 : false;
        },

        enableIterativeMode: () => {
          contextManager.incrementIteration();
        },

        disableIterativeMode: () => {
          contextManager.resetIteration();
        },
      };
    },
    {
      name: "ai-chat-preferences",
      storage: createJSONStorage<Partial<AIChatState>>(() =>
        createSafeStorage({ storageName: "ai-chat-preferences" })
      ),
      partialize: (state) => ({
        manualAIMode: state.manualAIMode,
        aiProvider: state.aiProvider,
        autoDownload: state.autoDownload,
        enableWebSearch: state.enableWebSearch,
        imageOnly: state.imageOnly,
        aspectRatio: state.aspectRatio,
        imageSize: state.imageSize,
        thinkingLevel: state.thinkingLevel,
        autoModeMultiplier: state.autoModeMultiplier,
        sendShortcut: state.sendShortcut,
        expandedPanelStyle: state.expandedPanelStyle,
      }),
      // 确保新字段能正确合并，使用初始状态的默认值填充缺失字段
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<AIChatState>),
      }),
    }
  )
);

if (typeof window !== "undefined") {
  try {
    // 订阅 messages 变化并记录对话快照
    let previousMessages = useAIChatStore.getState().messages;

    // Vite/React Fast Refresh 下，模块可能被多次重新执行；清理旧订阅，避免重复订阅导致内存增长
    const globalAny = window as any;
    const prevUnsub = globalAny.__tanvaAIChatDebugUnsubscribe;
    if (typeof prevUnsub === "function") {
      try {
        prevUnsub();
      } catch {}
    }

    globalAny.__tanvaAIChatDebugUnsubscribe = useAIChatStore.subscribe(
      (state) => {
      const messages = state.messages;
      if (messages === previousMessages) return;
      previousMessages = messages;
      logChatConversationSnapshot(messages);
      }
    );

    (window as any).tanvaDebugConversation = () => {
      const messages = useAIChatStore.getState().messages;
      logChatConversationSnapshot(messages);
      return messages;
    };
  } catch (error) {
    console.warn("⚠️ 初始化AI对话调试订阅失败:", error);
  }
}

try {
  const hot = (import.meta as any)?.hot;
  if (hot) {
    hot.dispose(() => {
      try {
        const globalAny = window as any;
        const unsub = globalAny.__tanvaAIChatDebugUnsubscribe;
        if (typeof unsub === "function") {
          try {
            unsub();
          } catch {}
        }
        globalAny.__tanvaAIChatDebugUnsubscribe = null;
      } catch {}
    });
  }
} catch {}

/**
 * 上传音频到 OSS
 */
export async function uploadAudioToOSS(
  audioDataOrUrl: string,
  projectId?: string | null
): Promise<string | null> {
  try {
    if (!audioDataOrUrl) return null;
    if (/^https?:\/\//.test(audioDataOrUrl)) return audioDataOrUrl;
    if (!audioDataOrUrl.includes("base64,")) {
      console.warn("⚠️ 非支持的音频数据格式，跳过上传");
      return null;
    }

    const blob = dataURLToBlob(audioDataOrUrl);
    const mimeMatch = audioDataOrUrl.match(/^data:([^;]+);/);
    const contentType = mimeMatch ? mimeMatch[1] : "audio/mpeg";

    const result = await ossUploadService.uploadToOSS(blob, {
      dir: "ai-chat-audios/",
      projectId,
      fileName: `ai-audio-${Date.now()}.mp3`,
      contentType,
      maxSize: 15 * 1024 * 1024,
    });

    if (result.success && result.url) {
      return result.url;
    } else {
      const errMsg = result.error || "音频上传失败";
      console.error("❌ 音频上传失败:", errMsg);
      throw new Error(errMsg);
    }
  } catch (error: any) {
    console.error("❌ 音频上传异常:", error);
    throw error;
  }
}
