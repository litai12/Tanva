/**
 * AI聊天对话框状态管理
 * 管理对话框显示、输入内容和生成状态
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { aiImageService } from '@/services/aiImageService';
import sora2Service from '@/services/sora2Service';
import {
  generateImageViaAPI,
  editImageViaAPI,
  blendImagesViaAPI,
  analyzeImageViaAPI,
  generateTextResponseViaAPI,
  midjourneyActionViaAPI,
} from '@/services/aiBackendAPI';
import { useUIStore } from '@/stores/uiStore';
import { contextManager } from '@/services/contextManager';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { ossUploadService, dataURLToBlob } from '@/services/ossUploadService';
import { createSafeStorage } from '@/stores/storageUtils';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import { useImageHistoryStore } from '@/stores/imageHistoryStore';
import { createImagePreviewDataUrl } from '@/utils/imagePreview';
import type {
  AIImageResult,
  RunningHubGenerateOptions,
  AIProviderOptions,
  SupportedAIProvider,
  MidjourneyMetadata,
} from '@/types/ai';
import type {
  ConversationContext,
  OperationHistory,
  SerializedConversationContext,
  SerializedChatMessage
} from '@/types/context';

// 本地存储会话的读取工具（用于无项目或早期回退场景）
const LOCAL_SESSIONS_KEY = 'tanva_aiChat_sessions';
const LOCAL_ACTIVE_KEY = 'tanva_aiChat_activeSessionId';

// 🔥 全局待生成图片计数器（防止连续快速生成时重叠）
let generatingImageCount = 0;

function readSessionsFromLocalStorage(): { sessions: SerializedConversationContext[]; activeSessionId: string | null } | null {
  try {
    if (typeof localStorage === 'undefined') return null;
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

export interface ChatMessage {
  id: string;
  type: 'user' | 'ai' | 'error';
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
}

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

const toISOString = (value: Date | string | number | null | undefined): string => {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const cloneSafely = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) ?? (value as T);

export type ManualAIMode = 'auto' | 'text' | 'generate' | 'edit' | 'blend' | 'analyze' | 'video';
type AvailableTool = 'generateImage' | 'editImage' | 'blendImages' | 'analyzeImage' | 'chatResponse' | 'generateVideo';

type AIProviderType = SupportedAIProvider;

const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash';
const BANANA_TEXT_MODEL = 'banana-gemini-2.5-flash';
const SORA2_VIDEO_MODEL = 'sora-2-reverse';
const RUNNINGHUB_IMAGE_MODEL = 'runninghub-su-effect';
const MIDJOURNEY_IMAGE_MODEL = 'midjourney-fast';
const RUNNINGHUB_PRIMARY_NODE_ID =
  import.meta.env?.VITE_RUNNINGHUB_PRIMARY_NODE_ID ?? '112';
const RUNNINGHUB_REFERENCE_NODE_ID =
  import.meta.env?.VITE_RUNNINGHUB_REFERENCE_NODE_ID ?? '158';
const RUNNINGHUB_WEBAPP_ID = import.meta.env?.VITE_RUNNINGHUB_WEBAPP_ID;
const RUNNINGHUB_WEBHOOK_URL = import.meta.env?.VITE_RUNNINGHUB_WEBHOOK_URL;
const SORA2_API_KEY = import.meta.env?.VITE_SORA2_API_KEY ?? '';

const SORA2_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
const SORA2_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const SORA2_ASYNC_HOST_HINTS = ['asyncdata.', 'asyncndata.'];
const SORA2_MAX_FOLLOW_DEPTH = 2;
const SORA2_FETCH_TIMEOUT_MS = 8000;
const ENABLE_VIDEO_CANVAS_PLACEMENT = false;
const SORA2_MAX_RETRY = 3;
const SORA2_RETRY_BASE_DELAY_MS = 1200;

type Sora2ResolvedMedia = {
  videoUrl?: string;
  thumbnailUrl?: string;
  referencedUrls: string[];
  taskInfo?: Record<string, any> | null;
  taskId?: string;
  status?: string;
  errorMessage?: string;
};

type VideoPosterBuildResult = {
  dataUrl: string;
  origin: 'thumbnail' | 'videoFrame' | 'placeholder';
  sourceImageUrl?: string;
};

const tryParseJson = (raw: string): any | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const normalizeUrlCandidate = (value: string): string => {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[,.;)\]\s]+$/g, '');
};

const isLikelyVideoUrl = (url: string): boolean => {
  const lower = url.toLowerCase();
  return SORA2_VIDEO_EXTENSIONS.some((ext) => lower.includes(ext));
};

const isLikelyImageUrl = (url: string): boolean => {
  const lower = url.toLowerCase();
  return SORA2_IMAGE_EXTENSIONS.some((ext) => lower.includes(ext));
};

const isAsyncTaskUrl = (url: string): boolean =>
  SORA2_ASYNC_HOST_HINTS.some((mark) => url.includes(mark));

const extractUrlsFromText = (text: string): string[] => {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return matches.map(normalizeUrlCandidate);
};

const collectUrlsFromObject = (value: unknown, bucket: Set<string>) => {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.startsWith('http')) {
      bucket.add(normalizeUrlCandidate(value));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrlsFromObject(item, bucket));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => collectUrlsFromObject(item, bucket));
  }
};

const pickFirstMatchingUrl = (urls: Iterable<string>, matcher: (url: string) => boolean): string | undefined => {
  for (const url of urls) {
    if (matcher(url)) {
      return url;
    }
  }
  return undefined;
};

const safeFetchTextWithTimeout = async (url: string, timeoutMs: number = SORA2_FETCH_TIMEOUT_MS): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn('⚠️ Sora2 任务跟进请求失败:', { url, status: response.status });
      return null;
    }
    const text = await response.text();
    return text;
  } catch (error) {
    console.warn('⚠️ 无法访问 Sora2 任务地址:', url, error);
    return null;
  }
};

const resolveSora2Response = async (rawContent: string): Promise<Sora2ResolvedMedia> => {
  const referencedUrls = new Set<string>();
  const visitedTaskUrls = new Set<string>();
  let videoUrl: string | undefined;
  let thumbnailUrl: string | undefined;
  let taskInfo: Record<string, any> | null = null;
  let status: string | undefined;
  let taskId: string | undefined;
  let errorMessage: string | undefined;

  type QueueEntry = { type: 'text' | 'url'; payload: string; depth: number };
  const queue: QueueEntry[] = [{ type: 'text', payload: rawContent, depth: 0 }];

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth > SORA2_MAX_FOLLOW_DEPTH) {
      continue;
    }

    if (current.type === 'url') {
      if (visitedTaskUrls.has(current.payload)) continue;
      visitedTaskUrls.add(current.payload);
      const payload = await safeFetchTextWithTimeout(current.payload);
      if (payload) {
        queue.push({ type: 'text', payload, depth: current.depth + 1 });
      }
      continue;
    }

    const parsed = tryParseJson(current.payload);
    if (parsed) {
      taskInfo = { ...(taskInfo || {}), ...parsed };
      if (!status && typeof parsed.status === 'string') {
        status = parsed.status;
      }
      if (!taskId && typeof parsed.id === 'string') {
        taskId = parsed.id;
      }
      if (!errorMessage) {
        errorMessage =
          typeof parsed.error?.message === 'string'
            ? parsed.error.message
            : typeof parsed.message === 'string'
              ? parsed.message
              : undefined;
      }
      collectUrlsFromObject(parsed, referencedUrls);
    } else {
      extractUrlsFromText(current.payload).forEach((url) => referencedUrls.add(url));
    }

    if (!videoUrl) {
      videoUrl = pickFirstMatchingUrl(referencedUrls, isLikelyVideoUrl);
    }
    if (!thumbnailUrl) {
      thumbnailUrl = pickFirstMatchingUrl(referencedUrls, isLikelyImageUrl);
    }

    if (!videoUrl) {
      const taskCandidates = Array.from(referencedUrls).filter(
        (url) => isAsyncTaskUrl(url) && !visitedTaskUrls.has(url)
      );
      taskCandidates.slice(0, 2).forEach((url) => {
        queue.push({ type: 'url', payload: url, depth: current.depth + 1 });
      });
    }
  }

  return {
    videoUrl,
    thumbnailUrl,
    referencedUrls: Array.from(referencedUrls),
    taskInfo,
    status,
    taskId,
    errorMessage,
  };
};

export const getImageModelForProvider = (provider: AIProviderType): string => {
  if (provider === 'runninghub') {
    return RUNNINGHUB_IMAGE_MODEL;
  }
  if (provider === 'midjourney') {
    return MIDJOURNEY_IMAGE_MODEL;
  }
  return DEFAULT_IMAGE_MODEL;
};

const TEXT_MODEL_BY_PROVIDER: Record<AIProviderType, string> = {
  gemini: DEFAULT_TEXT_MODEL,
  banana: BANANA_TEXT_MODEL,
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
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const createProcessMetrics = (): ProcessMetrics => {
  const now = getTimestamp();
  return {
    startTime: now,
    lastStepTime: now,
    traceId: `flow-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  };
};

const getResultImageRemoteUrl = (result?: AIImageResult | null): string | undefined => {
  if (!result?.metadata) return undefined;
  const midMeta = result.metadata.midjourney as MidjourneyMetadata | undefined;
  if (midMeta?.imageUrl) return midMeta.imageUrl;
  if (typeof result.metadata.imageUrl === 'string') return result.metadata.imageUrl;
  return undefined;
};

const logProcessStep = (metrics: ProcessMetrics | undefined, label: string) => {
  if (!metrics) return;
  const now = getTimestamp();
  metrics.lastStepTime = now;
  if (!label.includes('API response received')) {
    return;
  }

  const totalSeconds = ((now - metrics.startTime) / 1000).toFixed(2);
  const idPart = metrics.messageId ? `${metrics.traceId}/${metrics.messageId}` : metrics.traceId;
  const apiLabel = label.replace(' API response received', '').trim();
  console.log(`⏱️ [${idPart}] ${apiLabel} API 耗时 ${totalSeconds}s`);
};

const ensureDataUrl = (imageData: string): string =>
  imageData.startsWith('data:image') ? imageData : `data:image/png;base64,${imageData}`;

const MAX_IMAGE_PREVIEW_SIZE = 512;
const buildImagePreviewSafely = async (dataUrl: string): Promise<string | null> => {
  if (!dataUrl) return null;
  try {
    return await createImagePreviewDataUrl(dataUrl, {
      maxSize: MAX_IMAGE_PREVIEW_SIZE,
      mimeType: 'image/webp',
      quality: 0.82,
    });
  } catch (error) {
    console.warn('⚠️ 生成图像缩略图失败:', error);
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
    console.warn('⚠️ 缓存最新生成图像失败:', error);
  }
};

const LEGACY_INLINE_IMAGE_THRESHOLD = 350_000;
const isRemoteUrl = (value?: string | null): boolean =>
  typeof value === 'string' && /^https?:\/\//i.test(value);
const normalizeInlineImageData = (value?: string | null): string | null => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  const compact = trimmed.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 120) {
    return `data:image/png;base64,${compact}`;
  }
  return null;
};
const shouldUploadLegacyInline = (inline: string | null, remote?: string | null) =>
  Boolean(
    inline &&
      !isRemoteUrl(remote) &&
      inline.length > LEGACY_INLINE_IMAGE_THRESHOLD
  );

const migrateMessageImagePayload = async (
  message: ChatMessage,
  projectId: string | null,
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
    typeof message.imageData === 'string' &&
    message.imageData.startsWith('data:image') &&
    message.imageData !== preview
  ) {
    message.imageData = preview;
    mutated = true;
  }
  if (shouldUploadLegacyInline(inlineCandidate, message.imageRemoteUrl)) {
    const remoteUrl = await uploadImageToOSS(preview ?? inlineCandidate, projectId);
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
  projectId: string | null,
): Promise<boolean> => {
  if (!context.cachedImages) {
    return false;
  }

  const inlineCandidate = normalizeInlineImageData(context.cachedImages.latest ?? null);
  if (!inlineCandidate) {
    return false;
  }
  let mutated = false;
  const preview = await buildImagePreviewSafely(inlineCandidate);
  if (preview && context.cachedImages.latest !== preview) {
    context.cachedImages.latest = preview;
    mutated = true;
  }
  if (shouldUploadLegacyInline(inlineCandidate, context.cachedImages.latestRemoteUrl)) {
    const remoteUrl = await uploadImageToOSS(preview ?? inlineCandidate, projectId);
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
  projectId: string | null,
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

    if (inlineCandidate && shouldUploadLegacyInline(inlineCandidate, entry.imageRemoteUrl)) {
      const remoteUrl = await uploadImageToOSS(preview ?? inlineCandidate, projectId);
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
        src: entry.imageRemoteUrl || entry.thumbnail || entry.imageData || undefined,
      });
    } catch {
      // ignore history update failure
    }
  }

  return mutated;
};

const migrateLegacySessions = async (
  contexts: ConversationContext[],
  projectId: string | null,
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

/**
 * 初始化 Sora2 服务（只执行一次）
 */
let sora2Initialized = false;
function initializeSora2Service() {
  if (!sora2Initialized && SORA2_API_KEY) {
    sora2Service.setApiKey(SORA2_API_KEY);
    sora2Initialized = true;
    console.log('✅ Sora2 服务已初始化');
  }
}

/**
 * 生成视频 - 支持文本提示词和参考图像
 * @param prompt 视频描述提示词
 * @param referenceImageUrl 可选的参考图像 URL（来自 OSS 上传）
 * @param onProgress 进度回调函数
 */
async function generateVideoResponse(
  prompt: string,
  referenceImageUrl?: string | null,
  onProgress?: (stage: string, progress: number) => void
): Promise<{
  videoUrl: string;
  content: string;
  thumbnailUrl?: string;
  referencedUrls: string[];
  status?: string;
  taskId?: string;
  taskInfo?: Record<string, any> | null;
}> {
  initializeSora2Service();

  if (!SORA2_API_KEY) {
    throw new Error('Sora2 API Key 未配置，无法生成视频');
  }

  onProgress?.('初始化 Sora2 视频生成', 10);

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < SORA2_MAX_RETRY) {
    attempt += 1;
    try {
      onProgress?.(attempt === 1 ? '发送视频生成请求' : `网络波动，重试第 ${attempt} 次`, Math.min(30 + (attempt - 1) * 10, 80));
      console.log('🎬 开始 Sora2 视频生成', {
        prompt: prompt.substring(0, 50) + '...',
        hasReference: !!referenceImageUrl,
        attempt,
      });

      const result = await sora2Service.generateVideoStream(
        prompt,
        referenceImageUrl || undefined,
        (chunk) => {
          console.log('📹 视频生成进度:', chunk.substring(0, 50) + '...');
        }
      );

      if (!result.success || !result.data?.fullContent) {
        const errMessage = result.error?.message || '视频生成失败';
        const errCode = result.error?.code;
        const retryable = isRetryableVideoError({ message: errMessage, code: errCode });
        if (retryable) {
          throw new Error(errMessage);
        }
        throw new Error(errMessage);
      }

      onProgress?.('解析视频响应', 80);

      const rawContent = result.data.fullContent.trim();
      console.log('📄 Sora2 原始响应:', rawContent);

      const resolved = await resolveSora2Response(rawContent);

      if (resolved.status && ['failed', 'error', 'blocked'].includes(resolved.status)) {
        const errorType = resolved.taskInfo?.error?.type || resolved.status;
        const message =
          resolved.taskInfo?.error?.message ||
          resolved.errorMessage ||
          'Sora2 返回失败状态';
        throw new Error(`Sora2 生成失败 [${errorType}]: ${message}`);
      }

      if (resolved.status && ['queued', 'processing'].includes(resolved.status)) {
        throw new Error(
          `任务正在处理中（ID: ${resolved.taskId || 'unknown'}）\n` +
          `当前状态: ${resolved.status}\n` +
          `请稍后查看数据预览链接或重试`
        );
      }

      const videoUrl = resolved.videoUrl;

      if (!videoUrl) {
        console.error('❌ 未找到视频 URL，原始响应:', rawContent);
        const urlPreview = resolved.referencedUrls.slice(0, 5).map((url) => `- ${url}`).join('\n') || '无';
        throw new Error(
          `API 未返回有效的视频 URL\n\n` +
          `响应内容：\n${rawContent.substring(0, 500)}${rawContent.length > 500 ? '\n...(截断)' : ''}\n\n` +
          `已解析链接：\n${urlPreview}`
        );
      }

      onProgress?.('视频生成完成', 100);

      console.log('✅ Sora2 视频生成成功', {
        videoUrl,
        isHttpUrl: videoUrl.startsWith('http'),
        thumbnailUrl: resolved.thumbnailUrl,
        referencedUrls: resolved.referencedUrls
      });

      return {
        videoUrl,
        content: resolved.taskInfo
          ? `视频已生成（任务 ID: ${resolved.taskId || resolved.taskInfo?.id || 'unknown'}）`
          : `视频已生成，可在下方预览。`,
        thumbnailUrl: resolved.thumbnailUrl,
        referencedUrls: resolved.referencedUrls,
        status: resolved.status,
        taskId: resolved.taskId,
        taskInfo: resolved.taskInfo
      };
    } catch (error) {
      lastError = error;
      const retryable = isRetryableVideoError(error);
      if (retryable && attempt < SORA2_MAX_RETRY) {
        const wait = SORA2_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`⚠️ Sora2 调用失败，准备重试第 ${attempt + 1} 次，等待 ${wait}ms`, error);
        onProgress?.(`网络波动，重试第 ${attempt + 1} 次`, Math.min(60 + attempt * 10, 90));
        await delay(wait);
        continue;
      }

      const errorMsg = error instanceof Error ? error.message : '未知错误';
      console.error('❌ Sora2 视频生成失败:', errorMsg);
      throw new Error(`视频生成失败: ${errorMsg}`);
    }
  }

  const fallbackMessage = lastError instanceof Error ? lastError.message : '未知错误';
  throw new Error(`视频生成失败: ${fallbackMessage}`);
}

export async function requestSora2VideoGeneration(
  prompt: string,
  referenceImageUrl?: string | null,
  onProgress?: (stage: string, progress: number) => void
) {
  return generateVideoResponse(prompt, referenceImageUrl, onProgress);
}

/**
 * 智能识别是否为视频生成意图
 */
function detectVideoIntent(input: string): boolean {
  const videoKeywords = ['视频', 'video', '动画', 'animation', '动态', '运动', 'motion', '生成视频', '制作视频'];
  return videoKeywords.some(kw =>
    input.toLowerCase().includes(kw.toLowerCase())
  );
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('读取 Blob 失败'));
    reader.readAsDataURL(blob);
  });

const downloadUrlAsDataUrl = async (url: string): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SORA2_FETCH_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn('⚠️ 下载缩略图失败:', url, response.status);
      return null;
    }
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch (error) {
    console.warn('⚠️ 无法下载缩略图:', url, error);
    return null;
  }
};

const fetchVideoBlob = async (url: string): Promise<Blob | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(SORA2_FETCH_TIMEOUT_MS, 12000));
    const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn('⚠️ 下载视频失败:', url, response.status);
      return null;
    }
    return await response.blob();
  } catch (error) {
    console.warn('⚠️ 无法下载视频:', url, error);
    return null;
  }
};

const captureVideoPosterFromBlob = async (blob: Blob): Promise<string | null> => {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
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

    video.addEventListener('error', fail);
    video.addEventListener('loadeddata', () => {
      try {
        const seekTime = Math.min(0.2, (video.duration || 1) * 0.1);
        const handleSeeked = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 960;
            canvas.height = video.videoHeight || 540;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              fail();
              return;
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            cleanup();
            resolve(dataUrl);
          } catch (error) {
            console.warn('⚠️ 无法捕获视频帧:', error);
            fail();
          }
        };
        if (seekTime > 0) {
          video.currentTime = seekTime;
          video.addEventListener('seeked', handleSeeked, { once: true });
        } else {
          handleSeeked();
        }
      } catch (error) {
        console.warn('⚠️ 设置视频截帧失败:', error);
        fail();
      }
    }, { once: true });

    video.src = objectUrl;
  });
};

const buildPlaceholderPoster = (prompt: string, videoUrl: string): string | null => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(1, '#1e293b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(40, 40, canvas.width - 80, canvas.height - 80);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px "Inter", sans-serif';
  ctx.fillText('🎬 视频占位', 80, 120);

  ctx.font = '24px "Inter", sans-serif';
  const maxWidth = canvas.width - 160;
  const words = `${prompt}\n${videoUrl}`.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
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

  return canvas.toDataURL('image/png');
};

const buildVideoPoster = async (params: { prompt: string; videoUrl: string; thumbnailUrl?: string }): Promise<VideoPosterBuildResult | null> => {
  if (params.thumbnailUrl) {
    const downloaded = await downloadUrlAsDataUrl(params.thumbnailUrl);
    if (downloaded) {
      return { dataUrl: downloaded, origin: 'thumbnail', sourceImageUrl: params.thumbnailUrl };
    }
  }

  const blob = await fetchVideoBlob(params.videoUrl);
  if (blob) {
    const captured = await captureVideoPosterFromBlob(blob);
    if (captured) {
      return { dataUrl: captured, origin: 'videoFrame', sourceImageUrl: params.videoUrl };
    }
  }

  const placeholder = buildPlaceholderPoster(params.prompt, params.videoUrl);
  if (!placeholder) return null;
  return { dataUrl: placeholder, origin: 'placeholder' };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableVideoError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message : String(error || '');
  const code = (error as any)?.code as string | undefined;
  if (code?.startsWith('HTTP_5')) return true;
  if (code === 'NETWORK_ERROR') return true;
  if (/load failed/i.test(msg)) return true;
  if (/failed to fetch/i.test(msg)) return true;
  if (/network.*error/i.test(msg)) return true;
  if (/timeout/i.test(msg)) return true;
  return false;
};

const computeVideoSmartPosition = (): { x: number; y: number } | undefined => {
  try {
    const cached = contextManager.getCachedImage();
    if (cached?.bounds) {
      const offset = useUIStore.getState().smartPlacementOffset || 778;
      return {
        x: cached.bounds.x + cached.bounds.width / 2,
        y: cached.bounds.y + cached.bounds.height / 2 + offset
      };
    }
  } catch (error) {
    console.warn('⚠️ 计算视频智能位置失败:', error);
  }
  return undefined;
};

const autoPlaceVideoOnCanvas = async (params: { prompt: string; videoUrl: string; thumbnailUrl?: string }) => {
  if (typeof window === 'undefined') return null;
  try {
    const poster = await buildVideoPoster(params);
    if (!poster) return null;
    const smartPosition = computeVideoSmartPosition();
    window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
      detail: {
        imageData: poster.dataUrl,
        fileName: `sora-video-${Date.now()}.png`,
        operationType: 'video',
        smartPosition,
        videoInfo: {
          videoUrl: params.videoUrl,
          sourceUrl: params.videoUrl,
          thumbnailUrl: poster.sourceImageUrl ?? params.thumbnailUrl,
          prompt: params.prompt
        }
      }
    }));
    return poster.dataUrl;
  } catch (error) {
    console.warn('⚠️ 自动投放视频缩略图失败:', error);
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

  onStageUpdate?.('上传SU截图', 25);
  const primaryUrl = await uploadImageToOSS(ensureDataUrl(primaryImage), projectId);
  if (!primaryUrl) {
    throw new Error('SU 截图上传失败，请稍后重试。');
  }

  const nodeInfoList: RunningHubGenerateOptions['nodeInfoList'] = [
    {
      nodeId: RUNNINGHUB_PRIMARY_NODE_ID,
      fieldName: 'image',
      fieldValue: primaryUrl,
      description: 'SU截图',
    },
  ];

  if (referenceImage) {
    onStageUpdate?.('上传参考图', 30);
    const referenceUrl = await uploadImageToOSS(ensureDataUrl(referenceImage), projectId);
    if (!referenceUrl) {
      throw new Error('参考图上传失败，请稍后重试。');
    }
    nodeInfoList.push({
      nodeId: RUNNINGHUB_REFERENCE_NODE_ID,
      fieldName: 'image',
      fieldValue: referenceUrl,
      description: '参考图',
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

  console.log('📤 RunningHub 节点参数', {
    nodeInfoList,
    projectId,
  });

  return {
    runningHub: runningHubOptions,
  };
}

// 🔥 图片上传到 OSS 的辅助函数
export async function uploadImageToOSS(imageData: string, projectId?: string | null): Promise<string | null> {
  try {
    if (!imageData || !imageData.includes('base64,')) {
      console.warn('⚠️ 无效的图片数据，跳过上传');
      return null;
    }

    const blob = dataURLToBlob(imageData);
    const result = await ossUploadService.uploadToOSS(blob, {
      dir: 'ai-chat-images/',
      projectId,
      fileName: `ai-chat-${Date.now()}.png`,
      contentType: 'image/png',
      maxSize: 10 * 1024 * 1024, // 10MB
    });

    if (result.success && result.url) {
      console.log('✅ 图片上传成功:', result.url);
      return result.url;
    } else {
      console.error('❌ 图片上传失败:', result.error);
      return null;
    }
  } catch (error) {
    console.error('❌ 图片上传异常:', error);
    return null;
  }
}

const serializeConversation = async (context: ConversationContext): Promise<SerializedConversationContext> => {
  const projectId = useProjectContentStore.getState().projectId;

  const isRemoteUrl = (value: string | undefined): boolean =>
    !!value && /^https?:\/\//.test(value);

  const messagesNeedingUpload = context.messages.filter(
    msg =>
      !!msg.imageData &&
      !isRemoteUrl(msg.imageData) &&
      !isRemoteUrl(msg.imageRemoteUrl) &&
      msg.imageData.trim().length > 0
  );

  const uploadResults = await Promise.all(
    messagesNeedingUpload.map(async (msg) => {
      try {
        const dataUrl = ensureDataUrl(msg.imageData!);
        const ossUrl = await uploadImageToOSS(dataUrl, projectId);
        return { messageId: msg.id, ossUrl };
      } catch (error) {
        console.warn('⚠️ 上传消息图片失败，使用本地数据回退:', error);
        return { messageId: msg.id, ossUrl: null };
      }
    })
  );

  const imageUrlMap = new Map<string, string | null>();
  uploadResults.forEach(({ messageId, ossUrl }) => {
    if (ossUrl) {
      imageUrlMap.set(messageId, ossUrl);
      const target = context.messages.find(m => m.id === messageId);
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
        (isRemoteUrl(message.imageRemoteUrl) ? message.imageRemoteUrl : undefined) ||
        (isRemoteUrl(message.imageData) ? message.imageData : undefined);

      const fallbackThumbnail =
        message.thumbnail ??
        (!remoteUrl && message.imageData
          ? ensureDataUrl(message.imageData)
          : undefined);

      const serialized: SerializedChatMessage = {
        id: message.id,
        type: message.type,
        content: message.content,
        timestamp: toISOString(message.timestamp),
        webSearchResult: cloneSafely(message.webSearchResult),
        imageRemoteUrl: remoteUrl || undefined,
        imageUrl: remoteUrl || undefined,
        imageData: !remoteUrl ? message.imageData : undefined,
        thumbnail: fallbackThumbnail,
        expectsImageOutput: message.expectsImageOutput,
        sourceImageData: message.sourceImageData,
        sourceImagesData: message.sourceImagesData,
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
      metadata: operation.metadata ? cloneSafely(operation.metadata) : null
    })),
    cachedImages: {
      latest: null,
      latestId: context.cachedImages.latestId ?? null,
      latestPrompt: context.cachedImages.latestPrompt ?? null,
      timestamp: context.cachedImages.timestamp ? toISOString(context.cachedImages.timestamp) : null,
      latestBounds: context.cachedImages.latestBounds ?? null,
      latestLayerId: context.cachedImages.latestLayerId ?? null,
      latestRemoteUrl: context.cachedImages.latestRemoteUrl ?? null
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
        thumbnail: item.thumbnail ?? null,
        imageRemoteUrl: item.imageRemoteUrl ?? null,
        imageData: item.imageData ?? null
      })),
      iterationCount: context.contextInfo.iterationCount,
      lastOperationType: context.contextInfo.lastOperationType
    }
  };
};

const deserializeConversation = (data: SerializedConversationContext): ConversationContext => {
  const messages: ChatMessage[] = data.messages.map((message) => {
    const remoteUrl = (message as any).imageRemoteUrl || (message as any).imageUrl;
    const baseImage = message.imageData;
    const thumbnail = message.thumbnail;
    return {
      id: message.id,
      type: message.type,
      content: message.content,
      timestamp: new Date(message.timestamp),
      webSearchResult: message.webSearchResult,
      imageData: baseImage,
      imageRemoteUrl: remoteUrl,
      thumbnail,
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
    };
  });

  const operations: OperationHistory[] = data.operations.map((operation) => ({
    id: operation.id,
    type: operation.type,
    timestamp: new Date(operation.timestamp),
    input: operation.input,
    output: operation.output,
    success: operation.success,
    metadata: operation.metadata ?? undefined
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
      timestamp: data.cachedImages.timestamp ? new Date(data.cachedImages.timestamp) : null,
      latestBounds: data.cachedImages.latestBounds ?? null,
      latestLayerId: data.cachedImages.latestLayerId ?? null,
      latestRemoteUrl: data.cachedImages.latestRemoteUrl ?? null
    },
    contextInfo: {
      userPreferences: cloneSafely(data.contextInfo.userPreferences ?? {}),
      recentPrompts: [...data.contextInfo.recentPrompts],
      imageHistory: data.contextInfo.imageHistory.map((item) => ({
        id: item.id,
        imageData: item.imageRemoteUrl || item.imageData || item.thumbnail || '',
        imageRemoteUrl: item.imageRemoteUrl || undefined,
        prompt: item.prompt,
        timestamp: new Date(item.timestamp),
        operationType: item.operationType,
        parentImageId: item.parentImageId ?? undefined,
        thumbnail: item.thumbnail ?? undefined
      })),
      iterationCount: data.contextInfo.iterationCount,
      lastOperationType: data.contextInfo.lastOperationType
    }
  };
};

const sessionsEqual = (
  a: SerializedConversationContext[] | undefined,
  b: SerializedConversationContext[]
): boolean => JSON.stringify(a ?? []) === JSON.stringify(b);

interface AIChatState {
  // 对话框状态
  isVisible: boolean;

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

  // 配置选项
  autoDownload: boolean;  // 是否自动下载生成的图片
  enableWebSearch: boolean;  // 是否启用联网搜索
  imageOnly: boolean;  // 仅返回图像，不返回文本（适用于图像生成/编辑/融合）
  aspectRatio: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' | null;  // 图像长宽比
  manualAIMode: ManualAIMode;
  aiProvider: AIProviderType;  // AI提供商选择 (gemini: Google Gemini, banana: 147 API, runninghub: SU截图转效果, midjourney: 147 Midjourney)

  // 操作方法
  showDialog: () => void;
  hideDialog: () => void;
  toggleDialog: () => void;

  // 输入管理
  setCurrentInput: (input: string) => void;
  clearInput: () => void;

  // 消息管理
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => ChatMessage;
  clearMessages: () => void;
  updateMessageStatus: (messageId: string, status: Partial<ChatMessage['generationStatus']>) => void;
  updateMessage: (messageId: string, updater: (message: ChatMessage) => ChatMessage) => void;
  refreshSessions: (options?: { persistToLocal?: boolean; markProjectDirty?: boolean }) => Promise<void>;
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
  generateImage: (prompt: string, options?: { override?: MessageOverride; metrics?: ProcessMetrics }) => Promise<void>;

  // 图生图功能
  editImage: (prompt: string, sourceImage: string, showImagePlaceholder?: boolean, options?: { override?: MessageOverride; metrics?: ProcessMetrics }) => Promise<void>;
  setSourceImageForEditing: (imageData: string | null) => void;

  // 多图融合功能
  blendImages: (prompt: string, sourceImages: string[], options?: { override?: MessageOverride; metrics?: ProcessMetrics }) => Promise<void>;
  addImageForBlending: (imageData: string) => void;
  removeImageFromBlending: (index: number) => void;
  clearImagesForBlending: () => void;
  executeMidjourneyAction: (options: MidjourneyActionOptions) => Promise<void>;

  // 图像分析功能
  analyzeImage: (prompt: string, sourceImage: string, options?: { override?: MessageOverride; metrics?: ProcessMetrics }) => Promise<void>;
  setSourceImageForAnalysis: (imageData: string | null) => void;

  // 文本对话功能
  generateTextResponse: (prompt: string, options?: { override?: MessageOverride; metrics?: ProcessMetrics }) => Promise<void>;

  // 视频生成功能
  generateVideo: (prompt: string, referenceImage?: string | null, options?: { override?: MessageOverride; metrics?: ProcessMetrics }) => Promise<void>;

  // 智能工具选择功能
  processUserInput: (input: string) => Promise<void>;
  
  // 核心处理流程
  executeProcessFlow: (input: string, isRetry?: boolean) => Promise<void>;

  // 智能模式检测
  getAIMode: () => 'generate' | 'edit' | 'blend' | 'analyze' | 'text' | 'video';

  // 配置管理
  toggleAutoDownload: () => void;
  setAutoDownload: (value: boolean) => void;
  toggleWebSearch: () => void;
  setWebSearch: (value: boolean) => void;
  toggleImageOnly: () => void;  // 切换仅图像模式
  setImageOnly: (value: boolean) => void;
  setAspectRatio: (ratio: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9' | null) => void;  // 设置长宽比
  setManualAIMode: (mode: ManualAIMode) => void;
  setAIProvider: (provider: AIProviderType) => void;  // 设置AI提供商

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
        operationType
      }: {
        aiMessageId: string;
        prompt: string;
        result: AIImageResult;
        operationType: 'generate' | 'edit' | 'blend';
      }): Promise<{ remoteUrl?: string; thumbnail?: string }> => {
        if (!result.imageData) {
          return {};
        }

        const dataUrl = ensureDataUrl(result.imageData);
        const previewDataUrl = await buildImagePreviewSafely(dataUrl);
        const projectId = useProjectContentStore.getState().projectId;
        let remoteUrl: string | undefined;
        try {
          const historyRecord = await recordImageHistoryEntry({
            dataUrl,
            title: prompt,
            nodeId: aiMessageId,
            nodeType: 'generate',
            projectId,
            dir: 'ai-chat-history/',
            keepThumbnail: Boolean(previewDataUrl),
            thumbnailDataUrl: previewDataUrl ?? undefined
          });
          remoteUrl = historyRecord.remoteUrl;
        } catch (error) {
          console.warn('⚠️ 记录AI图像历史失败:', error);
        }

        const historyEntry = {
          prompt,
          operationType,
          imageData: previewDataUrl ?? (remoteUrl ? undefined : dataUrl),
          parentImageId: undefined,
          thumbnail: previewDataUrl ?? dataUrl,
          imageRemoteUrl: remoteUrl
        };

        const storedHistory = contextManager.addImageHistory(historyEntry);

        try {
          useImageHistoryStore.getState().addImage({
            id: storedHistory.id,
            src: remoteUrl || dataUrl,
            remoteUrl: remoteUrl ?? undefined,
            thumbnail: previewDataUrl ?? dataUrl,
            title: prompt,
            nodeId: aiMessageId,
            nodeType: 'generate',
            projectId,
            timestamp: storedHistory.timestamp.getTime()
          });
        } catch (error) {
          console.warn('⚠️ 更新图片历史Store失败:', error);
        }

        const assets = {
          remoteUrl: remoteUrl ?? undefined,
          thumbnail: previewDataUrl ?? dataUrl
        };

        if (assets.remoteUrl || assets.thumbnail) {
          get().updateMessage(aiMessageId, (msg) => ({
            ...msg,
            imageRemoteUrl: assets.remoteUrl || msg.imageRemoteUrl,
            thumbnail: assets.thumbnail ?? msg.thumbnail,
            imageData: assets.remoteUrl ? undefined : msg.imageData
          }));

          const context = contextManager.getCurrentContext();
          if (context) {
            const target = context.messages.find((m) => m.id === aiMessageId);
            if (target) {
              target.imageRemoteUrl = assets.remoteUrl || target.imageRemoteUrl;
              target.thumbnail = assets.thumbnail ?? target.thumbnail;
              if (assets.remoteUrl) {
                target.imageData = undefined;
              }
            }
          }
        }

        return assets;
      };

      const triggerLegacyMigration = (reason: string, markProjectDirty: boolean) => {
        if (legacyMigrationInProgress) {
          return;
        }
        legacyMigrationInProgress = true;
        void (async () => {
          try {
            const contexts = contextManager.getAllSessions();
            const projectId = useProjectContentStore.getState().projectId ?? null;
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
            console.log(`🧹 ${reason} 已触发旧版会话轻量化并同步`);
          } catch (error) {
            console.error(`❌ ${reason} 会话迁移失败:`, error);
          } finally {
            legacyMigrationInProgress = false;
          }
        })();
      };

      return {
  // 初始状态
  isVisible: true,
  currentInput: '',
  currentSessionId: null,
  sessions: [],
  generationStatus: {
    isGenerating: false,
    progress: 0,
    error: null
  },
  messages: [],
  lastGeneratedImage: null,
  sourceImageForEditing: null,  // 图生图源图像
  sourceImagesForBlending: [],  // 多图融合源图像数组
  sourceImageForAnalysis: null, // 图像分析源图像
  autoDownload: false,  // 默认不自动下载
  enableWebSearch: false,  // 默认关闭联网搜索
  imageOnly: false,  // 默认允许返回文本
  aspectRatio: null,  // 默认不指定长宽比
  manualAIMode: 'auto',
  aiProvider: 'gemini',  // 默认使用 Google Gemini

  // 对话框控制
  showDialog: () => set({ isVisible: true }),
  hideDialog: () => set({ isVisible: false }),
  toggleDialog: () => set((state) => ({ isVisible: !state.isVisible })),

  // 输入管理
  setCurrentInput: (input) => set({ currentInput: input }),
  clearInput: () => set({ currentInput: '' }),

  // 消息管理
  addMessage: (message) => {
    let sessionId = get().currentSessionId;

    if (!sessionId) {
      sessionId = contextManager.getCurrentSessionId() || contextManager.createSession();
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

    console.log('📨 添加新消息:', {
      type: storedMessage.type,
      content: storedMessage.content.substring(0, 50) + (storedMessage.content.length > 50 ? '...' : ''),
      id: storedMessage.id
    });

    set((state) => ({
      messages: state.messages.some((msg) => msg.id === storedMessage!.id)
        ? state.messages
        : [...state.messages, storedMessage!]
    }));

    console.log('📊 消息列表更新后长度:', get().messages.length);
    return storedMessage!;
  },

  clearMessages: () => {
    const state = get();
    const sessionId = state.currentSessionId || contextManager.getCurrentSessionId();
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
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? { ...msg, generationStatus: { ...msg.generationStatus, ...status } as any }
          : msg
      )
    }));

    // 同步更新到 contextManager
    const context = contextManager.getCurrentContext();
    if (context) {
      const message = context.messages.find(m => m.id === messageId);
      if (message) {
        message.generationStatus = { ...message.generationStatus, ...status } as any;
      }
    }
  },
  updateMessage: (messageId, updater) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId ? updater({ ...msg }) : msg
      )
    }));

    const context = contextManager.getCurrentContext();
    if (context) {
      const index = context.messages.findIndex((msg) => msg.id === messageId);
      if (index >= 0) {
        context.messages[index] = updater({ ...context.messages[index] });
      }
    }
  },

  refreshSessions: async (options) => {
    // 🔥 防止在水合过程中调用
    if (isHydratingNow) {
      console.log('⏸️ 跳过refreshSessions：正在进行水合操作');
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
            preview: session.preview
          }));

          // 🔥 异步序列化会话（上传图片到 OSS）
          const serializedSessionsPromises = listedSessions
            .map((session) => contextManager.getSession(session.sessionId))
            .filter((context): context is ConversationContext => !!context)
            .map((context) => serializeConversation(context));

          const serializedSessions = await Promise.all(serializedSessionsPromises);

          set({ sessions: sessionSummaries });

          const activeSessionId =
            get().currentSessionId ?? contextManager.getCurrentSessionId() ?? null;

          if (markProjectDirty) {
            const projectStore = useProjectContentStore.getState();
            if (projectStore.projectId && projectStore.hydrated) {
              const previousSessions = projectStore.content?.aiChatSessions ?? [];
              const previousActive = projectStore.content?.aiChatActiveSessionId ?? null;
              if (
                !sessionsEqual(previousSessions, serializedSessions) ||
                (previousActive ?? null) !== (activeSessionId ?? null)
              ) {
                projectStore.updatePartial({
                  aiChatSessions: serializedSessions,
                  aiChatActiveSessionId: activeSessionId ?? null
                }, { markDirty: true });
              }
            } else {
              // 无项目场景：把会话持久化到本地
              try {
                if (typeof localStorage !== 'undefined') {
                  localStorage.setItem('tanva_aiChat_sessions', JSON.stringify(serializedSessions));
                  localStorage.setItem('tanva_aiChat_activeSessionId', activeSessionId ?? '');
                }
              } catch {}
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
      messages: context ? [...context.messages] : []
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
      messages: context ? [...context.messages] : []
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
      messages: nextMessages
    });
    get().refreshSessions();
  },

  hydratePersistedSessions: (sessions, activeSessionId = null, options) => {
    const markProjectDirty = options?.markProjectDirty ?? false;

    // 🔥 设置hydrating标记，防止refreshSessions被调用
    isHydratingNow = true;

    try {
      hasHydratedSessions = true;

      contextManager.resetSessions();
      try {
        useImageHistoryStore.getState().clearHistory();
      } catch (error) {
        console.warn('⚠️ 清空图片历史失败:', error);
      }

      sessions.forEach((session) => {
        try {
          const context = deserializeConversation(session);
          contextManager.importSessionData(context);
        } catch (error) {
          console.error('❌ 导入会话失败:', error);
        }
      });

      try {
        const imageHistoryStore = useImageHistoryStore.getState();
        const projectId = useProjectContentStore.getState().projectId;
        const contexts = contextManager.getAllSessions();
        contexts.forEach((context) => {
          context.contextInfo.imageHistory.forEach((item) => {
            const src = item.imageRemoteUrl || item.imageData || item.thumbnail;
            if (!src) return;
            imageHistoryStore.addImage({
              id: item.id,
              src,
              remoteUrl: item.imageRemoteUrl ?? undefined,
              thumbnail: item.thumbnail ?? undefined,
              title: item.prompt || '图片',
              nodeId: item.parentImageId || item.id,
              nodeType: 'generate',
              projectId,
              timestamp: item.timestamp.getTime()
            });
          });
        });
      } catch (error) {
        console.warn('⚠️ 回填图片历史失败:', error);
      }

      const availableSessions = contextManager.listSessions();
      const candidateIds = new Set(availableSessions.map((session) => session.sessionId));

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

      const context = targetSessionId ? contextManager.getSession(targetSessionId) : null;
      set({
        currentSessionId: targetSessionId,
        messages: context ? [...context.messages] : []
      });

      triggerLegacyMigration('hydratePersistedSessions', markProjectDirty);

      console.log('✅ 水合操作完成，现在允许refreshSessions调用');
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
      console.log('⏸️ 跳过resetSessions：正在进行水合操作');
      return;
    }

    contextManager.resetSessions();

    const sessionId = contextManager.createSession();
    const context = contextManager.getSession(sessionId);
    set({
      currentSessionId: sessionId,
      messages: context ? [...context.messages] : []
    });
    hasHydratedSessions = true;
    get().refreshSessions({ markProjectDirty: false });
  },

  // 图像生成主函数（支持并行）
  generateImage: async (prompt: string, options?: { override?: MessageOverride; metrics?: ProcessMetrics }) => {
    const state = get();
    const metrics = options?.metrics;
    logProcessStep(metrics, 'generateImage entered');

    // 🔥 并行模式：不检查全局状态，每个请求独立
    // 🔥 立即增加正在生成的图片计数
    generatingImageCount++;
    console.log('🔥 开始生成，当前生成计数:', generatingImageCount);

    const override = options?.override;
    let aiMessageId: string | undefined;

    if (override) {
      aiMessageId = override.aiMessageId;
      get().updateMessage(override.aiMessageId, (msg) => ({
        ...msg,
        content: '正在生成图像...',
        expectsImageOutput: true,
        generationStatus: {
          ...(msg.generationStatus || { isGenerating: true, progress: 0, error: null }),
          isGenerating: true,
          error: null,
          stage: '准备中'
        }
      }));
    } else {
      // 添加用户消息
      state.addMessage({
        type: 'user',
        content: prompt
      });

      // 🔥 创建占位 AI 消息，带有初始生成状态
      const placeholderMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
        type: 'ai',
        content: '正在生成图像...',
        generationStatus: {
          isGenerating: true,
          progress: 0,
          error: null,
          stage: '准备中'
        },
        expectsImageOutput: true,
        provider: state.aiProvider
      };

      const storedPlaceholder = state.addMessage(placeholderMessage);
      aiMessageId = storedPlaceholder.id;
    }

    if (!aiMessageId) {
      console.error('❌ 无法获取AI消息ID');
      return;
    }

    console.log('🎨 开始生成图像，消息ID:', aiMessageId);

    let progressInterval: ReturnType<typeof setInterval> | null = null;
    try {
      // 🔥 使用消息级别的进度更新
      get().updateMessageStatus(aiMessageId, {
        isGenerating: true,
        progress: 15,
        error: null,
        stage: '正在生成'
      });

      // 模拟进度更新
      logProcessStep(metrics, 'generateImage progress interval start');
      progressInterval = setInterval(() => {
        const currentMessage = get().messages.find(m => m.id === aiMessageId);
        const currentProgress = currentMessage?.generationStatus?.progress ?? 0;

        if (currentProgress >= 92) {
          if (progressInterval) clearInterval(progressInterval);
          return;
        }

        let increment = 2;
        if (currentProgress < 30) {
          increment = 8;
        } else if (currentProgress < 60) {
          increment = 6;
        } else if (currentProgress < 80) {
          increment = 4;
        }

        const nextProgress = Math.min(92, currentProgress + increment);

        get().updateMessageStatus(aiMessageId, {
          isGenerating: true,
          progress: nextProgress,
          error: null
        });
      }, 600);

      // 调用后端API生成图像
      const modelToUse = getImageModelForProvider(state.aiProvider);
      console.log('🤖 [AI Provider] generateImage', {
        aiProvider: state.aiProvider,
        model: modelToUse,
        prompt: prompt.substring(0, 50) + '...'
      });
      logProcessStep(metrics, `generateImage calling API (${modelToUse})`);

      let providerOptions: AIProviderOptions | undefined;

      if (state.aiProvider === 'runninghub') {
        const suSource = state.sourceImageForEditing;
        if (!suSource) {
          throw new Error('运行 RunningHub 转换前请先提供一张 SU 截图作为源图像。');
        }

        const projectId = useProjectContentStore.getState().projectId;
        const stageUpdater: RunningHubStageUpdater = (stage, progress) => {
          const statusUpdate: Partial<ChatMessage['generationStatus']> = {
            isGenerating: true,
            error: null,
            stage,
          };
          if (typeof progress === 'number') {
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

      const result = await generateImageViaAPI({
        prompt,
        model: modelToUse,
        aiProvider: state.aiProvider,
        providerOptions,
        outputFormat: 'png',
        aspectRatio: state.aspectRatio || undefined,
        imageOnly: state.imageOnly
      });
      logProcessStep(metrics, 'generateImage API response received');

      if (progressInterval) clearInterval(progressInterval);

      if (result.success && result.data) {
        // 生成成功 - 更新消息内容和状态
        const messageContent = result.data.textResponse ||
          (result.data.hasImage ? `已生成图像: ${prompt}` : `无法生成图像: ${prompt}`);

        const imageRemoteUrl = getResultImageRemoteUrl(result.data);
        const inlineImageData = result.data.imageData;

        // 🔥 更新消息内容和完成状态
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === aiMessageId
              ? {
                  ...msg,
                  content: messageContent,
                  imageData: inlineImageData,
                  thumbnail: inlineImageData ? ensureDataUrl(inlineImageData) : msg.thumbnail,
                  imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                  metadata: result.data?.metadata,
                  provider: state.aiProvider,
                  generationStatus: {
                    isGenerating: false,
                    progress: 100,
                    error: null
                  }
                }
              : msg
          )
        }));
        logProcessStep(metrics, 'editImage message updated');
        logProcessStep(metrics, 'generateImage message updated');

        // 同步到 contextManager
        const context = contextManager.getCurrentContext();
        if (context) {
          const message = context.messages.find(m => m.id === aiMessageId);
          if (message) {
            message.content = messageContent;
            message.imageData = inlineImageData;
            if (inlineImageData) {
              message.thumbnail = ensureDataUrl(inlineImageData);
            }
            message.imageRemoteUrl = imageRemoteUrl || message.imageRemoteUrl;
            message.metadata = result.data?.metadata;
            message.provider = state.aiProvider;
            message.generationStatus = {
              isGenerating: false,
              progress: 100,
              error: null
            };
          }
        }

        let uploadedAssets: { remoteUrl?: string; thumbnail?: string } | undefined;
        if (inlineImageData) {
          uploadedAssets = await registerMessageImageHistory({
            aiMessageId,
            prompt,
            result: result.data,
            operationType: 'generate'
          });
        }

        if (uploadedAssets?.remoteUrl) {
          result.data.metadata = {
            ...result.data.metadata,
            imageUrl: uploadedAssets.remoteUrl
          };
          result.data.imageData = undefined;
        }

        set({ lastGeneratedImage: result.data });

        cacheGeneratedImageResult({
          messageId: aiMessageId,
          prompt,
          result: result.data,
          assets: uploadedAssets,
          inlineImageData,
        });

        cacheGeneratedImageResult({
          messageId: aiMessageId,
          prompt,
          result: result.data,
          assets: uploadedAssets,
          inlineImageData,
        });

        cacheGeneratedImageResult({
          messageId: aiMessageId,
          prompt,
          result: result.data,
          assets: uploadedAssets,
          inlineImageData,
        });

        await get().refreshSessions();
        logProcessStep(metrics, 'generateImage history recorded');

        // 如果没有图像，记录详细原因并返回
        if (!result.data.hasImage) {
          console.warn('⚠️ API返回了文本回复但没有图像，详细信息:', {
            文本回复: result.data.textResponse,
            图像数据存在: !!inlineImageData,
            图像数据长度: inlineImageData?.length || 0,
            hasImage标志: result.data.hasImage,
            生成提示: result.data.prompt
          });
          return;
        }

        // 可选：自动下载图片到用户的默认下载文件夹
        const downloadImageData = (imageData: string, prompt: string, autoDownload: boolean = false) => {
          if (!autoDownload) {
            console.log('⏭️ 跳过自动下载，图片将直接添加到画布');
            return;
          }

          try {
            const mimeType = `image/${result.data?.metadata?.outputFormat || 'png'}`;
            const imageDataUrl = `data:${mimeType};base64,${imageData}`;

            const link = document.createElement('a');
            link.href = imageDataUrl;

            // 生成文件名
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const promptSafeString = prompt.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').substring(0, 30);
            const extension = result.data?.metadata?.outputFormat || 'png';

            link.download = `ai_generated_${promptSafeString}_${timestamp}.${extension}`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            console.log('✅ 图像下载已开始:', link.download);
          } catch (error) {
            console.error('❌ 下载图像失败:', error);
          }
        };

        // 根据配置决定是否自动下载（仅当有图像时）
        const currentState = get();
        if (inlineImageData) {
          downloadImageData(inlineImageData, prompt, currentState.autoDownload);
        }

        // 自动添加到画布中央 - 使用快速上传工具的逻辑（仅当有图像时）
        const addImageToCanvas = (aiResult: AIImageResult, inlineData?: string | null) => {
          if (!inlineData) {
            console.log('⚠️ 跳过画布添加：没有图像数据');
            return;
          }
          
          // 构建图像数据URL
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${inlineData}`;
          const fileName = `ai_generated_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          // 计算智能位置：基于缓存图片中心 → 向下（偏移量由 smartPlacementOffset 决定）
          let smartPosition: { x: number; y: number } | undefined = undefined;
          try {
            const cached = contextManager.getCachedImage();
            if (cached?.bounds) {
              const cx = cached.bounds.x + cached.bounds.width / 2;
              const cy = cached.bounds.y + cached.bounds.height / 2;
              const offset = useUIStore.getState().smartPlacementOffset || 778;
              // 回归原始逻辑：直接向下排列，保证连续性
              smartPosition = { x: cx, y: cy + offset };
              console.log('📍 生成图智能位置(相对缓存 → 下移)', offset, 'px, 位置:', smartPosition);
            } else {
              console.log('📍 无缓存位置，按默认策略放置');
            }
          } catch (e) {
            console.warn('计算生成图智能位置失败:', e);
          }

          // 直接触发快速上传事件，复用现有的上传逻辑，添加智能排版信息
          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName,
              operationType: 'generate',
              smartPosition,
              sourceImageId: undefined,
              sourceImages: undefined
            }
          }));
          console.log('📋 已触发快速图片上传事件，使用智能排版 (操作类型: generate)');
        };

        // 自动添加到画布
        setTimeout(() => {
          if (result.data) {
            addImageToCanvas(result.data, inlineImageData);
          }
        }, 100); // 短暂延迟，确保UI更新

        console.log('✅ 图像生成成功，已自动添加到画布', {
          imageDataLength: inlineImageData?.length,
          prompt: result.data.prompt,
          model: result.data.model,
          id: result.data.id,
          createdAt: result.data.createdAt,
          metadata: result.data.metadata
        });
        logProcessStep(metrics, 'generateImage completed');

        // 取消自动关闭对话框 - 保持对话框打开状态
        // setTimeout(() => {
        //   get().hideDialog();
        //   console.log('🔄 AI对话框已自动关闭');
        // }, 100); // 延迟0.1秒关闭，让用户看到生成完成的消息

      } else {
        // 生成失败 - 更新消息状态为错误
        const errorMessage = result.error?.message || '图像生成失败';

        get().updateMessageStatus(aiMessageId, {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        });

        console.error('❌ 图像生成失败:', errorMessage);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      // 🔥 更新消息状态为错误
      get().updateMessageStatus(aiMessageId, {
        isGenerating: false,
        progress: 0,
        error: errorMessage
      });

      console.error('❌ 图像生成异常:', error);
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      // 🔥 无论成功失败，都减少正在生成的图片计数
      generatingImageCount--;
      console.log('✅ 生成结束，当前生成计数:', generatingImageCount);
      logProcessStep(metrics, 'generateImage finished (finally)');
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
    logProcessStep(metrics, 'editImage entered');

    // 🔥 并行模式：不检查全局状态
    const normalizedSourceImage = ensureDataUrl(sourceImage);

    const override = options?.override;
    let aiMessageId: string | undefined;

    if (override) {
      aiMessageId = override.aiMessageId;
      get().updateMessage(override.userMessageId, (msg) => ({
        ...msg,
        content: `编辑图像: ${prompt}`,
        sourceImageData: showImagePlaceholder ? normalizedSourceImage : msg.sourceImageData
      }));
      get().updateMessage(aiMessageId, (msg) => ({
        ...msg,
        content: '正在编辑图像...',
        expectsImageOutput: true,
        sourceImageData: showImagePlaceholder ? normalizedSourceImage : msg.sourceImageData,
        generationStatus: {
          ...(msg.generationStatus || { isGenerating: true, progress: 0, error: null }),
          isGenerating: true,
          error: null,
          stage: '准备中'
        }
      }));
    } else {
      // 添加用户消息
      const messageData: any = {
        type: 'user',
        content: `编辑图像: ${prompt}`,
      };

      if (showImagePlaceholder) {
        messageData.sourceImageData = normalizedSourceImage;
      }

      state.addMessage(messageData);

      // 🔥 创建占位 AI 消息
      const placeholderMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
        type: 'ai',
        content: '正在编辑图像...',
        generationStatus: {
          isGenerating: true,
          progress: 0,
          error: null,
          stage: '准备中'
        },
        expectsImageOutput: true,
        sourceImageData: showImagePlaceholder ? normalizedSourceImage : undefined,
        provider: state.aiProvider
      };

      const storedPlaceholder = state.addMessage(placeholderMessage);
      aiMessageId = storedPlaceholder.id;
    }

    if (!aiMessageId) {
      console.error('❌ 无法获取AI消息ID');
      return;
    }

    console.log('🖌️ 开始编辑图像，消息ID:', aiMessageId);
    logProcessStep(metrics, 'editImage message prepared');

    try {
      // 🔥 使用消息级别的进度更新
      get().updateMessageStatus(aiMessageId, {
        isGenerating: true,
        progress: 15,
        error: null,
        stage: '正在编辑'
      });

      // 模拟进度更新
      logProcessStep(metrics, 'editImage progress interval start');
      const progressInterval = setInterval(() => {
        const currentMessage = get().messages.find(m => m.id === aiMessageId);
        const currentProgress = currentMessage?.generationStatus?.progress ?? 0;

        if (currentProgress >= 92) {
          clearInterval(progressInterval);
          return;
        }

        let increment = 2;
        if (currentProgress < 30) {
          increment = 8;
        } else if (currentProgress < 60) {
          increment = 6;
        } else if (currentProgress < 80) {
          increment = 4;
        }

        const nextProgress = Math.min(92, currentProgress + increment);

        get().updateMessageStatus(aiMessageId, {
          isGenerating: true,
          progress: nextProgress,
          error: null
        });
      }, 600);

      // 调用后端API编辑图像
      const modelToUse = getImageModelForProvider(state.aiProvider);
      console.log('🤖 [AI Provider] editImage', {
        aiProvider: state.aiProvider,
        model: modelToUse,
        prompt: prompt.substring(0, 50) + '...'
      });
      logProcessStep(metrics, `editImage calling API (${modelToUse})`);

      let providerOptions: AIProviderOptions | undefined;

      if (state.aiProvider === 'runninghub') {
        const projectId = useProjectContentStore.getState().projectId;
        const stageUpdater: RunningHubStageUpdater = (stage, progress) => {
          const statusUpdate: Partial<ChatMessage['generationStatus']> = {
            isGenerating: true,
            error: null,
            stage,
          };
          if (typeof progress === 'number') {
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

      const result = await editImageViaAPI({
        prompt,
        sourceImage: normalizedSourceImage,
        model: modelToUse,
        aiProvider: state.aiProvider,
        providerOptions,
        outputFormat: 'png',
        aspectRatio: state.aspectRatio || undefined,
        imageOnly: state.imageOnly
      });

      clearInterval(progressInterval);

      logProcessStep(metrics, 'editImage API response received');

      if (result.success && result.data) {
        const imageRemoteUrl = getResultImageRemoteUrl(result.data);
        const inlineImageData = result.data.imageData;
        // 编辑成功 - 更新消息内容和状态
        const messageContent = result.data.textResponse ||
          (result.data.hasImage ? `已编辑图像: ${prompt}` : `无法编辑图像: ${prompt}`);

        // 🔥 更新消息内容和完成状态
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === aiMessageId
              ? {
                  ...msg,
                  content: messageContent,
                  imageData: inlineImageData,
                  thumbnail: inlineImageData ? ensureDataUrl(inlineImageData) : msg.thumbnail,
                  imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                  metadata: result.data?.metadata,
                  provider: state.aiProvider,
                  generationStatus: {
                    isGenerating: false,
                    progress: 100,
                    error: null
                  }
                }
              : msg
          )
        }));

        // 同步到 contextManager
        const context = contextManager.getCurrentContext();
        if (context) {
          const message = context.messages.find(m => m.id === aiMessageId);
          if (message) {
            message.content = messageContent;
            message.imageData = inlineImageData;
            if (inlineImageData) {
              message.thumbnail = ensureDataUrl(inlineImageData);
            }
            message.imageRemoteUrl = imageRemoteUrl || message.imageRemoteUrl;
            message.metadata = result.data?.metadata;
            message.provider = state.aiProvider;
            message.generationStatus = {
              isGenerating: false,
              progress: 100,
              error: null
            };
          }
        }

        let uploadedAssets: { remoteUrl?: string; thumbnail?: string } | undefined;
        if (inlineImageData) {
          uploadedAssets = await registerMessageImageHistory({
            aiMessageId,
            prompt,
            result: result.data,
            operationType: 'edit'
          });
        }

        if (uploadedAssets?.remoteUrl) {
          result.data.metadata = {
            ...result.data.metadata,
            imageUrl: uploadedAssets.remoteUrl
          };
          result.data.imageData = undefined;
        }

        set({ lastGeneratedImage: result.data });

        cacheGeneratedImageResult({
          messageId: aiMessageId,
          prompt,
          result: result.data,
          assets: uploadedAssets,
          inlineImageData,
        });

        await get().refreshSessions();
        logProcessStep(metrics, 'editImage history recorded');

        // 如果没有图像，记录原因并返回
        if (!result.data.hasImage) {
          console.log('⚠️ 编辑API返回了文本回复但没有图像:', result.data.textResponse);
          return;
        }

        // 自动添加到画布
        const addImageToCanvas = (aiResult: AIImageResult, inlineData?: string | null) => {
          if (!inlineData) {
            console.log('⚠️ 跳过编辑图像画布添加：没有图像数据');
            return;
          }
          
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${inlineData}`;
          const fileName = `ai_edited_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          // 🎯 获取当前选中图片的ID和边界信息用于智能排版
          let selectedImageBounds = null;
          let sourceImageId = null;
          try {
            if ((window as any).tanvaImageInstances) {
              const selectedImage = (window as any).tanvaImageInstances.find((img: any) => img.isSelected);
              if (selectedImage) {
                selectedImageBounds = selectedImage.bounds;
                sourceImageId = selectedImage.id;
                console.log('🎯 发现选中图片，ID:', sourceImageId, '边界:', selectedImageBounds);
              }
            }
          } catch (error) {
            console.warn('获取选中图片信息失败:', error);
          }

          // 计算智能位置：基于缓存图片中心 → 向右（偏移量由 smartPlacementOffset 决定）
          let smartPosition: { x: number; y: number } | undefined = undefined;
          try {
            const cached = contextManager.getCachedImage();
            if (cached?.bounds) {
              const cx = cached.bounds.x + cached.bounds.width / 2;
              const cy = cached.bounds.y + cached.bounds.height / 2;
              const offset = useUIStore.getState().smartPlacementOffset || 778;
              smartPosition = { x: cx + offset, y: cy };
              console.log('📍 编辑产出智能位置(相对缓存 → 右移)', offset, 'px:', smartPosition);
            } else if (selectedImageBounds) {
              // 兼容：若无缓存但传入了选中图片边界，则基于选中图向右
              const cx = selectedImageBounds.x + selectedImageBounds.width / 2;
              const cy = selectedImageBounds.y + selectedImageBounds.height / 2;
              const offset = useUIStore.getState().smartPlacementOffset || 778;
              smartPosition = { x: cx + offset, y: cy };
              console.log('📍 编辑产出智能位置(相对选中图 → 右移)', offset, 'px:', smartPosition);
            } else {
              console.log('📍 无缓存和选中边界，按默认策略放置');
            }
          } catch (e) {
            console.warn('计算编辑产出智能位置失败:', e);
          }

          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName,
              selectedImageBounds: selectedImageBounds,  // 保持兼容性
              operationType: 'edit',
              smartPosition,
              sourceImageId: sourceImageId,
              sourceImages: undefined
            }
          }));

          const targetInfo = sourceImageId ? `选中图片${sourceImageId}下方` : '默认位置';
          console.log(`📋 已触发快速图片上传事件，使用智能排版 (操作类型: edit, 目标位置: ${targetInfo})`);
        };

        setTimeout(() => {
          if (result.data) {
            addImageToCanvas(result.data, inlineImageData);
          }
        }, 100);

        console.log('✅ 图像编辑成功，已自动添加到画布', {
          imageDataLength: inlineImageData?.length,
          prompt: result.data.prompt,
          model: result.data.model,
          id: result.data.id
        });
        logProcessStep(metrics, 'editImage completed');

        // 取消自动关闭对话框 - 保持对话框打开状态
        // setTimeout(() => {
        //   get().hideDialog();
        //   console.log('🔄 AI对话框已自动关闭');
        // }, 100); // 延迟0.1秒关闭，让用户看到编辑完成的消息

      } else {
        // 编辑失败 - 更新消息状态为错误
        const errorMessage = result.error?.message || '图像编辑失败';

        get().updateMessageStatus(aiMessageId, {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        });

        console.error('❌ 图像编辑失败:', errorMessage);
      }

    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : '未知错误';

      // 🔒 安全检查：防止Base64图像数据被当作错误消息
      if (errorMessage && errorMessage.length > 1000 && errorMessage.includes('iVBORw0KGgo')) {
        console.warn('⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息');
        errorMessage = '图像编辑失败，请重试';
      }

      // 🔥 更新消息状态为错误
      get().updateMessageStatus(aiMessageId, {
        isGenerating: false,
        progress: 0,
        error: errorMessage
      });

      console.error('❌ 图像编辑异常:', error);
      logProcessStep(metrics, 'editImage failed');
    }
  },

  setSourceImageForEditing: (imageData: string | null) => {
    set({ sourceImageForEditing: imageData });
    
    // 🔥 立即缓存用户上传的图片
    if (imageData) {
      const imageId = `user_upload_${Date.now()}`;
      contextManager.cacheLatestImage(imageData, imageId, '用户上传的图片');
      console.log('📸 用户上传图片已缓存:', imageId);
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
    logProcessStep(metrics, 'blendImages entered');

    // 🔥 并行模式：不检查全局状态

    const override = options?.override;
    let aiMessageId: string | undefined;

    if (override) {
      aiMessageId = override.aiMessageId;
      get().updateMessage(override.userMessageId, (msg) => ({
        ...msg,
        content: `融合图像: ${prompt}`,
        sourceImagesData: sourceImages
      }));
      get().updateMessage(aiMessageId, (msg) => ({
        ...msg,
        content: '正在融合图像...',
        expectsImageOutput: true,
        sourceImagesData: sourceImages,
        generationStatus: {
          ...(msg.generationStatus || { isGenerating: true, progress: 0, error: null }),
          isGenerating: true,
          error: null,
          stage: '准备中'
        }
      }));
    } else {
      state.addMessage({
        type: 'user',
        content: `融合图像: ${prompt}`,
        sourceImagesData: sourceImages
      });

      // 🔥 创建占位 AI 消息
      const placeholderMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
        type: 'ai',
        content: '正在融合图像...',
        generationStatus: {
          isGenerating: true,
          progress: 0,
          error: null,
          stage: '准备中'
        },
        expectsImageOutput: true,
        sourceImagesData: sourceImages,
        provider: state.aiProvider
      };

      const storedPlaceholder = state.addMessage(placeholderMessage);
      aiMessageId = storedPlaceholder.id;
    }

    if (!aiMessageId) {
      console.error('❌ 无法获取AI消息ID');
      return;
    }

    console.log('🔀 开始融合图像，消息ID:', aiMessageId);
    logProcessStep(metrics, 'blendImages message prepared');

    try {
      // 🔥 使用消息级别的进度更新
      get().updateMessageStatus(aiMessageId, {
        isGenerating: true,
        progress: 15,
        error: null,
        stage: '正在融合'
      });

      logProcessStep(metrics, 'blendImages progress interval start');
      const progressInterval = setInterval(() => {
        const currentMessage = get().messages.find(m => m.id === aiMessageId);
        const currentProgress = currentMessage?.generationStatus?.progress ?? 0;

        if (currentProgress >= 92) {
          clearInterval(progressInterval);
          return;
        }

        let increment = 2;
        if (currentProgress < 30) {
          increment = 8;
        } else if (currentProgress < 60) {
          increment = 6;
        } else if (currentProgress < 80) {
          increment = 4;
        }

        const nextProgress = Math.min(92, currentProgress + increment);

        get().updateMessageStatus(aiMessageId, {
          isGenerating: true,
          progress: nextProgress,
          error: null
        });
      }, 600);

      const modelToUse = getImageModelForProvider(state.aiProvider);
      console.log('🤖 [AI Provider] blendImages', {
        aiProvider: state.aiProvider,
        model: modelToUse,
        imageCount: sourceImages.length,
        prompt: prompt.substring(0, 50) + '...'
      });

      const result = await blendImagesViaAPI({
        prompt,
        sourceImages,
        model: modelToUse,
        aiProvider: state.aiProvider,
        outputFormat: 'png',
        aspectRatio: state.aspectRatio || undefined,
        imageOnly: state.imageOnly
      });
      logProcessStep(metrics, 'blendImages API response received');

      clearInterval(progressInterval);

      if (result.success && result.data) {
        const imageRemoteUrl = getResultImageRemoteUrl(result.data);
        const inlineImageData = result.data.imageData;
        const messageContent = result.data.textResponse ||
          (result.data.hasImage ? `已融合图像: ${prompt}` : `无法融合图像: ${prompt}`);

        // 🔥 更新消息内容和完成状态
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === aiMessageId
              ? {
                  ...msg,
                  content: messageContent,
                  imageData: inlineImageData,
                  thumbnail: inlineImageData ? ensureDataUrl(inlineImageData) : msg.thumbnail,
                  imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                  metadata: result.data?.metadata,
                  provider: state.aiProvider,
                  generationStatus: {
                    isGenerating: false,
                    progress: 100,
                    error: null
                  }
                }
              : msg
          )
        }));
        logProcessStep(metrics, 'blendImages message updated');

        // 同步到 contextManager
        const context = contextManager.getCurrentContext();
        if (context) {
          const message = context.messages.find(m => m.id === aiMessageId);
          if (message) {
            message.content = messageContent;
            message.imageData = inlineImageData;
            if (inlineImageData) {
              message.thumbnail = ensureDataUrl(inlineImageData);
            }
            message.imageRemoteUrl = imageRemoteUrl || message.imageRemoteUrl;
            message.metadata = result.data?.metadata;
            message.provider = state.aiProvider;
            message.generationStatus = {
              isGenerating: false,
              progress: 100,
              error: null
            };
          }
        }

        let uploadedAssets: { remoteUrl?: string; thumbnail?: string } | undefined;
        if (inlineImageData) {
          uploadedAssets = await registerMessageImageHistory({
            aiMessageId,
            prompt,
            result: result.data,
            operationType: 'blend'
          });
        }

        if (uploadedAssets?.remoteUrl) {
          result.data.metadata = {
            ...result.data.metadata,
            imageUrl: uploadedAssets.remoteUrl
          };
          result.data.imageData = undefined;
        }

        set({ lastGeneratedImage: result.data });

        await get().refreshSessions();
        logProcessStep(metrics, 'blendImages history recorded');

        if (!result.data.hasImage) {
          console.log('⚠️ 融合API返回了文本回复但没有图像:', result.data.textResponse);
          return;
        }

        const addImageToCanvas = (aiResult: AIImageResult, inlineData?: string | null) => {
          if (!inlineData) {
            console.log('⚠️ 跳过融合图像画布添加：没有图像数据');
            return;
          }
          
          const mimeType = `image/${aiResult.metadata?.outputFormat || 'png'}`;
          const imageDataUrl = `data:${mimeType};base64,${inlineData}`;
          const fileName = `ai_blended_${prompt.substring(0, 20)}.${aiResult.metadata?.outputFormat || 'png'}`;

          // 🎯 获取源图像ID列表用于智能排版
          let sourceImageIds: string[] = [];
          try {
            if ((window as any).tanvaImageInstances) {
              const selectedImages = (window as any).tanvaImageInstances.filter((img: any) => img.isSelected);
              sourceImageIds = selectedImages.map((img: any) => img.id);
              console.log('🎯 发现选中的源图像IDs:', sourceImageIds);
            }
          } catch (error) {
            console.warn('获取源图像IDs失败:', error);
          }

          window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', {
            detail: {
              imageData: imageDataUrl,
              fileName: fileName,
              operationType: 'blend',
              smartPosition: (() => {
                try {
                  const cached = contextManager.getCachedImage();
                  if (cached?.bounds) {
                    const cx = cached.bounds.x + cached.bounds.width / 2;
                    const cy = cached.bounds.y + cached.bounds.height / 2;
                    const offset = useUIStore.getState().smartPlacementOffset || 778;
                    const pos = { x: cx + offset, y: cy };
                    console.log('📍 融合产出智能位置(相对缓存 → 右移)', offset, 'px:', pos);
                    return pos;
                  }
                } catch (e) {
                  console.warn('计算融合产出智能位置失败:', e);
                }
                return undefined;
              })(),
              sourceImageId: undefined,
              sourceImages: sourceImageIds.length > 0 ? sourceImageIds : undefined
            }
          }));
          
          const targetInfo = sourceImageIds.length > 0 ? `第一张源图像${sourceImageIds[0]}下方` : '默认位置';
          console.log(`📋 已触发快速图片上传事件，使用智能排版 (操作类型: blend, 目标位置: ${targetInfo})`);
        };

        setTimeout(() => {
          if (result.data) {
            addImageToCanvas(result.data, inlineImageData);
          }
        }, 100);

        console.log('✅ 图像融合成功，已自动添加到画布');
        logProcessStep(metrics, 'blendImages completed');

        // 取消自动关闭对话框 - 保持对话框打开状态
        // setTimeout(() => {
        //   get().hideDialog();
        //   console.log('🔄 AI对话框已自动关闭');
        // }, 100); // 延迟0.1秒关闭，让用户看到融合完成的消息

      } else {
        const errorMessage = result.error?.message || '图像融合失败';

        get().updateMessageStatus(aiMessageId, {
          isGenerating: false,
          progress: 0,
          error: errorMessage
        });

        console.error('❌ 图像融合失败:', errorMessage);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      get().updateMessageStatus(aiMessageId, {
        isGenerating: false,
        progress: 0,
        error: errorMessage
      });

      console.error('❌ 图像融合异常:', error);
      logProcessStep(metrics, 'blendImages failed');
    }
  },

  addImageForBlending: (imageData: string) => {
    set((state) => ({
      sourceImagesForBlending: [...state.sourceImagesForBlending, imageData]
    }));
    
    // 🔥 立即缓存用户上传的融合图片（缓存最后一张）
    const imageId = `user_blend_upload_${Date.now()}`;
    contextManager.cacheLatestImage(imageData, imageId, '用户上传的融合图片');
    console.log('📸 用户融合图片已缓存:', imageId);
  },

  removeImageFromBlending: (index: number) => {
    set((state) => ({
      sourceImagesForBlending: state.sourceImagesForBlending.filter((_, i) => i !== index)
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
    const actionLabel = buttonLabel || 'Midjourney 操作';
    const parentMessage = state.messages.find((msg) => msg.id === parentMessageId);
    const prompt =
      displayPrompt ||
      (parentMessage?.metadata?.midjourney?.prompt as string | undefined) ||
      parentMessage?.content ||
      actionLabel;

    const placeholderMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
      type: 'ai',
      content: `正在执行 ${actionLabel}...`,
      generationStatus: {
        isGenerating: true,
        progress: 0,
        error: null,
        stage: '准备中',
      },
      expectsImageOutput: true,
      provider: 'midjourney',
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
          (result.data.hasImage ? `已生成图像: ${prompt}` : `无法生成图像: ${prompt}`);

        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === aiMessage.id
              ? {
                  ...msg,
                  content: messageContent,
                  imageData: inlineImageData,
                  thumbnail: inlineImageData
                    ? ensureDataUrl(inlineImageData)
                    : msg.thumbnail,
                  imageRemoteUrl: imageRemoteUrl || msg.imageRemoteUrl,
                  metadata: result.data?.metadata,
                  provider: 'midjourney',
                  generationStatus: {
                    isGenerating: false,
                    progress: 100,
                    error: null,
                  },
                }
              : msg
          ),
        }));

        const context = contextManager.getCurrentContext();
        if (context) {
            const messageRef = context.messages.find((m) => m.id === aiMessage.id);
            if (messageRef) {
              messageRef.content = messageContent;
              messageRef.imageData = inlineImageData;
              if (inlineImageData) {
                messageRef.thumbnail = ensureDataUrl(inlineImageData);
              }
              messageRef.imageRemoteUrl = imageRemoteUrl || messageRef.imageRemoteUrl;
              messageRef.metadata = result.data?.metadata;
            messageRef.provider = 'midjourney';
            messageRef.generationStatus = {
              isGenerating: false,
              progress: 100,
              error: null,
            };
          }
        }

        let uploadedAssets: { remoteUrl?: string; thumbnail?: string } | undefined;
        if (inlineImageData) {
          uploadedAssets = await registerMessageImageHistory({
            aiMessageId: aiMessage.id,
            prompt,
            result: result.data,
            operationType: 'generate',
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
        const errorMessage = result.error?.message || 'Midjourney 操作失败';
        get().updateMessageStatus(aiMessage.id, {
          isGenerating: false,
          progress: 0,
          error: errorMessage,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Midjourney 操作失败';
      get().updateMessageStatus(aiMessage.id, {
        isGenerating: false,
        progress: 0,
        error: errorMessage,
      });
      console.error('❌ Midjourney action异常:', error);
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
    logProcessStep(metrics, 'analyzeImage entered');

    // 🔥 并行模式：不检查全局状态

    // 确保图像数据有正确的data URL前缀
    const formattedImageData = sourceImage.startsWith('data:image')
      ? sourceImage
      : `data:image/png;base64,${sourceImage}`;
    const override = options?.override;
    let aiMessageId: string | undefined;

    if (override) {
      aiMessageId = override.aiMessageId;
      get().updateMessage(override.userMessageId, (msg) => ({
        ...msg,
        content: prompt ? `分析图片: ${prompt}` : '分析这张图片',
        sourceImageData: formattedImageData
      }));
      get().updateMessage(aiMessageId, (msg) => ({
        ...msg,
        content: '正在分析图片...',
        sourceImageData: formattedImageData,
        generationStatus: {
          ...(msg.generationStatus || { isGenerating: true, progress: 0, error: null }),
          isGenerating: true,
          error: null,
          stage: '准备中'
        }
      }));
    } else {
      state.addMessage({
        type: 'user',
        content: prompt ? `分析图片: ${prompt}` : '分析这张图片',
        sourceImageData: formattedImageData
      });

      // 🔥 创建占位 AI 消息
      const placeholderMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
        type: 'ai',
        content: '正在分析图片...',
        generationStatus: {
          isGenerating: true,
          progress: 0,
          error: null,
          stage: '准备中'
        },
        sourceImageData: formattedImageData,
        provider: state.aiProvider
      };

      const storedPlaceholder = state.addMessage(placeholderMessage);
      aiMessageId = storedPlaceholder.id;
    }

    if (!aiMessageId) {
      console.error('❌ 无法获取AI消息ID');
      return;
    }

    console.log('🔍 开始分析图片，消息ID:', aiMessageId);
    logProcessStep(metrics, 'analyzeImage message prepared');

    try {
      // 🔥 使用消息级别的进度更新
      get().updateMessageStatus(aiMessageId, {
        isGenerating: true,
        progress: 15,
        error: null,
        stage: '正在分析'
      });

      logProcessStep(metrics, 'analyzeImage progress interval start');
      const progressInterval = setInterval(() => {
        const currentMessage = get().messages.find(m => m.id === aiMessageId);
        const currentProgress = currentMessage?.generationStatus?.progress ?? 0;

        if (currentProgress >= 92) {
          clearInterval(progressInterval);
          return;
        }

        let increment = 3;
        if (currentProgress < 30) {
          increment = 8;
        } else if (currentProgress < 60) {
          increment = 6;
        } else if (currentProgress < 80) {
          increment = 4;
        }

        const nextProgress = Math.min(92, currentProgress + increment);

        get().updateMessageStatus(aiMessageId, {
          isGenerating: true,
          progress: nextProgress,
          error: null
        });
      }, 500);

      // 调用后端API分析图像
      const modelToUse = getImageModelForProvider(state.aiProvider);
      console.log('🤖 [AI Provider] analyzeImage', {
        aiProvider: state.aiProvider,
        model: modelToUse,
        prompt: prompt || '默认分析'
      });

      const result = await analyzeImageViaAPI({
        prompt: prompt || '请详细分析这张图片的内容',
        sourceImage: formattedImageData,
        model: modelToUse,
        aiProvider: state.aiProvider,
      });

      clearInterval(progressInterval);
      logProcessStep(metrics, 'analyzeImage API response received');

      if (result.success && result.data) {
        // 🔥 更新消息内容和完成状态
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === aiMessageId
              ? {
                  ...msg,
                  content: result.data!.analysis,
                  generationStatus: {
                    isGenerating: false,
                    progress: 100,
                    error: null
                  }
                }
              : msg
          )
        }));

        // 同步到 contextManager
        const context = contextManager.getCurrentContext();
        if (context) {
          const message = context.messages.find(m => m.id === aiMessageId);
          if (message) {
            message.content = result.data!.analysis;
            message.generationStatus = {
              isGenerating: false,
              progress: 100,
              error: null
            };
          }
        }

        console.log('✅ 图片分析成功');
        logProcessStep(metrics, 'analyzeImage completed');

      } else {
        throw new Error(result.error?.message || '图片分析失败');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      get().updateMessageStatus(aiMessageId, {
        isGenerating: false,
        progress: 0,
        error: errorMessage
      });

      console.error('❌ 图片分析异常:', error);
      logProcessStep(metrics, 'analyzeImage failed');
    }
  },

  setSourceImageForAnalysis: (imageData: string | null) => {
    set({ sourceImageForAnalysis: imageData });
    
    // 🔥 立即缓存用户上传的分析图片
    if (imageData) {
      const imageId = `user_analysis_upload_${Date.now()}`;
      contextManager.cacheLatestImage(imageData, imageId, '用户上传的分析图片');
      console.log('📸 用户分析图片已缓存:', imageId);
    }
  },

  // 文本对话功能（支持并行）
  generateTextResponse: async (
    prompt: string,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => {
    // 🔥 并行模式：不检查全局状态

    const metrics = options?.metrics;
    logProcessStep(metrics, 'generateTextResponse entered');

    const override = options?.override;
    let aiMessageId: string | undefined;

    if (override) {
      aiMessageId = override.aiMessageId;
      get().updateMessage(aiMessageId, (msg) => ({
        ...msg,
        content: '正在生成文本回复...',
        generationStatus: {
          ...(msg.generationStatus || { isGenerating: true, progress: 0, error: null }),
          isGenerating: true,
          error: null,
          stage: '准备中'
        }
      }));
    } else {
      // 添加用户消息
      get().addMessage({
        type: 'user',
        content: prompt
      });

      // 🔥 创建占位 AI 消息
      const placeholderMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
        type: 'ai',
        content: '正在生成文本回复...',
        generationStatus: {
          isGenerating: true,
          progress: 0,
          error: null,
          stage: '准备中'
        },
        provider: get().aiProvider
      };

      const storedPlaceholder = get().addMessage(placeholderMessage);
      aiMessageId = storedPlaceholder.id;
    }

    if (!aiMessageId) {
      console.error('❌ 无法获取AI消息ID');
      return;
    }

    console.log('💬 开始生成文本回复，消息ID:', aiMessageId);
    logProcessStep(metrics, 'generateTextResponse message prepared');

    try {
      // 🔥 使用消息级别的进度更新
      get().updateMessageStatus(aiMessageId, {
        isGenerating: true,
        progress: 50,
        error: null,
        stage: '正在生成文本回复...'
      });

      // 调用后端API生成文本
      const state = get();
      const modelToUse = getTextModelForProvider(state.aiProvider);
      const contextPrompt = contextManager.buildContextPrompt(prompt);
      console.log('🤖 [AI Provider] generateTextResponse', {
        aiProvider: state.aiProvider,
        model: modelToUse,
        enableWebSearch: state.enableWebSearch,
        prompt: prompt.substring(0, 50) + '...',
        contextPreview: contextPrompt.substring(0, 80) + (contextPrompt.length > 80 ? '...' : '')
      });

      logProcessStep(metrics, `generateTextResponse calling API (${modelToUse})`);
      const result = await generateTextResponseViaAPI({
        prompt: contextPrompt,
        model: modelToUse,
        aiProvider: state.aiProvider,
        enableWebSearch: state.enableWebSearch
      });
      logProcessStep(metrics, 'generateTextResponse API response received');

      if (result.success && result.data) {
        // 🔥 更新消息内容和完成状态
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === aiMessageId
              ? {
                  ...msg,
                  content: result.data!.text,
                  webSearchResult: result.data!.webSearchResult,
                  generationStatus: {
                    isGenerating: false,
                    progress: 100,
                    error: null
                  }
                }
              : msg
          )
        }));

        // 同步到 contextManager
        const context = contextManager.getCurrentContext();
        if (context) {
          const message = context.messages.find(m => m.id === aiMessageId);
          if (message) {
            message.content = result.data!.text;
            message.webSearchResult = result.data!.webSearchResult;
            message.generationStatus = {
              isGenerating: false,
              progress: 100,
              error: null
            };
          }
        }

        await get().refreshSessions();

        console.log('✅ 文本回复成功:', result.data.text);
        logProcessStep(metrics, 'generateTextResponse completed');
      } else {
        throw new Error(result.error?.message || '文本生成失败');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';

      get().updateMessageStatus(aiMessageId, {
        isGenerating: false,
        progress: 0,
        error: errorMessage
      });

      console.error('❌ 文本生成失败:', errorMessage);
      logProcessStep(metrics, 'generateTextResponse failed');
    }
  },

  // 🎬 视频生成方法
  generateVideo: async (
    prompt: string,
    referenceImage?: string | null,
    options?: { override?: MessageOverride; metrics?: ProcessMetrics }
  ) => {
    const metrics = options?.metrics;
    logProcessStep(metrics, 'generateVideo entered');

    const override = options?.override;
    let aiMessageId: string | undefined;

    if (override) {
      aiMessageId = override.aiMessageId;
      get().updateMessage(aiMessageId, (msg) => ({
        ...msg,
        content: '正在生成视频...',
        expectsVideoOutput: true,
        generationStatus: {
          ...(msg.generationStatus || { isGenerating: true, progress: 0, error: null }),
          isGenerating: true,
          error: null,
          stage: '准备视频生成'
        }
      }));
    } else {
      // 添加用户消息
      get().addMessage({
        type: 'user',
        content: prompt
      });

      // 🔥 创建占位 AI 消息
      const placeholderMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
        type: 'ai',
        content: '正在生成视频...',
        expectsVideoOutput: true,
        generationStatus: {
          isGenerating: true,
          progress: 0,
          error: null,
          stage: '准备视频生成'
        },
        provider: get().aiProvider
      };

      const storedPlaceholder = get().addMessage(placeholderMessage);
      aiMessageId = storedPlaceholder.id;
    }

    if (!aiMessageId) {
      console.error('❌ 无法获取AI消息ID');
      return;
    }

    console.log('🎬 开始生成视频，消息ID:', aiMessageId);
    logProcessStep(metrics, 'generateVideo message prepared');

    try {
      // 处理参考图像上传（如果有）
      let referenceImageUrl: string | undefined;
      if (referenceImage) {
        get().updateMessageStatus(aiMessageId, {
          isGenerating: true,
          progress: 15,
          error: null,
          stage: '上传参考图像'
        });

        const projectId = useProjectContentStore.getState().projectId;
        const uploadedUrl = await uploadImageToOSS(ensureDataUrl(referenceImage), projectId);

        if (!uploadedUrl) {
          console.warn('⚠️ 参考图像上传失败，继续生成视频');
        } else {
          referenceImageUrl = uploadedUrl;
        }
      }

      // 🔥 使用消息级别的进度更新
      get().updateMessageStatus(aiMessageId, {
        isGenerating: true,
        progress: 30,
        error: null,
        stage: '发送请求到 Sora2'
      });

      // 调用视频生成函数
      logProcessStep(metrics, 'generateVideo calling Sora2');
      const videoResult = await generateVideoResponse(
        prompt,
        referenceImageUrl,
        (stage, progress) => {
          get().updateMessageStatus(aiMessageId!, {
            isGenerating: true,
            progress: Math.min(95, progress),
            error: null,
            stage
          });
        }
      );

      logProcessStep(metrics, 'generateVideo API response received');

      // 更新消息，包含视频信息
      get().updateMessage(aiMessageId, (msg) => ({
        ...msg,
        type: 'ai',
        content: videoResult.content,
        videoUrl: videoResult.videoUrl,
        videoSourceUrl: videoResult.videoUrl,
        videoReferencedUrls: videoResult.referencedUrls,
        videoTaskId: videoResult.taskId ?? null,
        videoStatus: videoResult.status ?? null,
        videoThumbnail: msg.videoThumbnail || videoResult.thumbnailUrl,
        videoMetadata: {
          ...(msg.videoMetadata || {}),
          taskInfo: videoResult.taskInfo,
          referencedUrls: videoResult.referencedUrls
        },
        expectsVideoOutput: false,
        generationStatus: {
          isGenerating: false,
          progress: 100,
          error: null,
          stage: '完成'
        }
      }));

      console.log('✅ 视频生成完成');
      logProcessStep(metrics, 'generateVideo finished');

      if (ENABLE_VIDEO_CANVAS_PLACEMENT) {
        void (async () => {
          const placedPoster = await autoPlaceVideoOnCanvas({
            prompt,
            videoUrl: videoResult.videoUrl,
            thumbnailUrl: videoResult.thumbnailUrl
          });
          if (placedPoster && aiMessageId) {
            get().updateMessage(aiMessageId, (msg) => ({
              ...msg,
              videoThumbnail: msg.videoThumbnail || placedPoster
            }));
          }
        })();
      }

      // 🧠 记录到上下文
      contextManager.recordOperation({
        type: 'generateVideo',
        input: prompt,
        output: videoResult.videoUrl,
        success: true,
        metadata: {
          referencedUrls: videoResult.referencedUrls,
          taskId: videoResult.taskId,
          status: videoResult.status
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '视频生成失败';
      console.error('❌ 视频生成异常:', error);

      // 更新消息状态为错误
      get().updateMessage(aiMessageId, (msg) => ({
        ...msg,
        content: `视频生成失败: ${errorMessage}`,
        expectsVideoOutput: false,
        generationStatus: {
          ...(msg.generationStatus || { isGenerating: true, progress: 0, error: null }),
          isGenerating: false,
          progress: 0,
          error: errorMessage,
          stage: '已终止'
        }
      }));

      // 🧠 记录失败
      contextManager.recordOperation({
        type: 'generateVideo',
        input: prompt,
        output: undefined,
        success: false
      });

      logProcessStep(metrics, 'generateVideo failed');
    }
  },

  // 🔄 核心处理流程 - 可重试的执行逻辑
  executeProcessFlow: async (input: string, isRetry: boolean = false) => {
    const state = get();
    const metrics = createProcessMetrics();
    logProcessStep(metrics, 'executeProcessFlow start');

    // 检测迭代意图
    const isIterative = contextManager.detectIterativeIntent(input);
    if (isIterative && !isRetry) {
      contextManager.incrementIteration();
      console.log('🔄 检测到迭代优化意图');
    }

    // 预先创建用户消息与占位AI消息，提供即时反馈
    const pendingUserMessage = get().addMessage({
      type: 'user',
      content: input
    });

    const pendingAiMessage = get().addMessage({
      type: 'ai',
      content: '正在准备处理您的请求...',
      generationStatus: {
        isGenerating: true,
        progress: 5,
        error: null,
        stage: '准备中'
      }
    });

    const messageOverride: MessageOverride = {
      userMessageId: pendingUserMessage.id,
      aiMessageId: pendingAiMessage.id
    };

    metrics.messageId = messageOverride.aiMessageId;
    logProcessStep(metrics, 'messages prepared');

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
      hasCachedImage: !!cachedImage,  // 单独标记是否有缓存图片
      availableTools: ['generateImage', 'editImage', 'blendImages', 'analyzeImage', 'chatResponse', 'generateVideo'],
      aiProvider: state.aiProvider,
      context: toolSelectionContext
    };

    console.log('🔍 工具选择调试信息:', {
      userInput: input,
      hasImages: toolSelectionRequest.hasImages,
      显式图片数量: explicitImageCount,
      总图片数量: totalImageCount,
      isRetry: isRetry,
      详细: {
        融合图片数量: state.sourceImagesForBlending.length,
        编辑图片: state.sourceImageForEditing ? '有' : '无',
        分析图片: state.sourceImageForAnalysis ? '有' : '无',
        缓存图片: cachedImage ? `ID: ${cachedImage.imageId}` : '无'
      }
    });

    // 根据手动模式或AI选择工具
    const manualMode = state.manualAIMode;
    const manualToolMap: Record<ManualAIMode, AvailableTool | null> = {
      auto: null,
      text: 'chatResponse',
      generate: 'generateImage',
      edit: 'editImage',
      blend: 'blendImages',
      analyze: 'analyzeImage',
      video: 'generateVideo'
    };

    let selectedTool: AvailableTool | null = null;
    let parameters: { prompt: string } = { prompt: input };

    if (manualMode !== 'auto') {
      selectedTool = manualToolMap[manualMode];
      console.log('🎛️ 手动模式直接选择工具:', manualMode, '→', selectedTool);
    } else {
      // 🎬 在 Auto 模式下智能检测视频意图
      if (state.aiProvider === 'banana' && detectVideoIntent(input)) {
        selectedTool = 'generateVideo';
        console.log('🧠 智能检测到视频生成意图，自动选择 generateVideo 工具');
      } else {
        logProcessStep(metrics, 'tool selection start');
        const toolSelectionResult = await aiImageService.selectTool(toolSelectionRequest);
        logProcessStep(metrics, 'tool selection completed');

        if (!toolSelectionResult.success || !toolSelectionResult.data) {
          const errorMsg = toolSelectionResult.error?.message || '工具选择失败';
          console.error('❌ 工具选择失败:', errorMsg);
          throw new Error(errorMsg);
        }

        selectedTool = toolSelectionResult.data.selectedTool as AvailableTool | null;
        parameters = { prompt: (toolSelectionResult.data.parameters?.prompt || input) };

        console.log('🎯 AI选择工具:', selectedTool);
        logProcessStep(metrics, `tool decided: ${selectedTool ?? 'none'}`);
      }
    }

    if (!selectedTool) {
      throw new Error('未选择执行工具');
    }

    // 根据选择的工具执行相应操作
    // 获取最新的 store 实例来调用方法
    const store = get();

    try {
      switch (selectedTool) {
        case 'generateImage':
          logProcessStep(metrics, 'invoking generateImage');
          await store.generateImage(parameters.prompt, { override: messageOverride, metrics });
          logProcessStep(metrics, 'generateImage finished');
          break;

        case 'editImage':
          if (state.sourceImageForEditing) {
            console.log('🖼️ 使用显式图像进行编辑:', {
              imageDataLength: state.sourceImageForEditing.length,
              imageDataPrefix: state.sourceImageForEditing.substring(0, 50),
              isBase64: state.sourceImageForEditing.startsWith('data:image')
            });
            logProcessStep(metrics, 'invoking editImage with explicit image');
            await store.editImage(parameters.prompt, state.sourceImageForEditing, true, { override: messageOverride, metrics });
            logProcessStep(metrics, 'editImage finished');

            // 🧠 检测是否需要保持编辑状态
            if (!isIterative) {
              store.setSourceImageForEditing(null);
              contextManager.resetIteration();
            }
          } else {
            // 🖼️ 检查是否有缓存的图像可以编辑
            const cachedImage = contextManager.getCachedImage();
            console.log('🔍 editImage case 调试:', {
              hasSourceImage: !!state.sourceImageForEditing,
              cachedImage: cachedImage ? `ID: ${cachedImage.imageId}` : 'none',
              input: input
            });
            
            if (cachedImage) {
              console.log('🖼️ 使用缓存的图像进行编辑:', {
                imageId: cachedImage.imageId,
                imageDataLength: cachedImage.imageData.length,
                imageDataPrefix: cachedImage.imageData.substring(0, 50),
                isBase64: cachedImage.imageData.startsWith('data:image')
              });
              logProcessStep(metrics, 'invoking editImage with cached image');
              await store.editImage(parameters.prompt, cachedImage.imageData, false, { override: messageOverride, metrics }); // 不显示图片占位框
              logProcessStep(metrics, 'editImage finished');
            } else {
              console.error('❌ 无法编辑图像的原因:', {
                cachedImage: cachedImage ? 'exists' : 'null',
                input: input
              });
              throw new Error('没有可编辑的图像');
            }
          }
          break;

        case 'blendImages':
          if (state.sourceImagesForBlending.length >= 2) {
            logProcessStep(metrics, 'invoking blendImages');
            await store.blendImages(parameters.prompt, state.sourceImagesForBlending, { override: messageOverride, metrics });
            logProcessStep(metrics, 'blendImages finished');
            store.clearImagesForBlending();
          } else {
            throw new Error('需要至少2张图像进行融合');
          }
          break;

        case 'analyzeImage':
          if (state.sourceImageForAnalysis) {
            logProcessStep(metrics, 'invoking analyzeImage (analysis source)');
            await store.analyzeImage(parameters.prompt || input, state.sourceImageForAnalysis, { override: messageOverride, metrics });
            logProcessStep(metrics, 'analyzeImage finished');
            store.setSourceImageForAnalysis(null);
          } else if (state.sourceImageForEditing) {
            logProcessStep(metrics, 'invoking analyzeImage (editing source)');
            await store.analyzeImage(parameters.prompt || input, state.sourceImageForEditing, { override: messageOverride, metrics });
            logProcessStep(metrics, 'analyzeImage finished');
            // 分析后不清除图像，用户可能还想编辑
          } else {
            // 🖼️ 检查是否有缓存的图像可以分析
            const cachedImage = contextManager.getCachedImage();
            if (cachedImage) {
              console.log('🖼️ 使用缓存的图像进行分析:', cachedImage.imageId);
              logProcessStep(metrics, 'invoking analyzeImage (cached image)');
              await store.analyzeImage(parameters.prompt || input, cachedImage.imageData, { override: messageOverride, metrics });
              logProcessStep(metrics, 'analyzeImage finished');
            } else {
              throw new Error('没有可分析的图像');
            }
          }
          break;

        case 'chatResponse':
          console.log('🎯 执行文本对话，参数:', parameters.prompt);
          console.log('🔧 调用 generateTextResponse 方法...');
          console.log('🔧 store 对象:', store);
          console.log('🔧 generateTextResponse 方法存在:', typeof store.generateTextResponse);
          try {
            logProcessStep(metrics, 'invoking generateTextResponse');
            const result = await store.generateTextResponse(parameters.prompt, { override: messageOverride, metrics });
            logProcessStep(metrics, 'generateTextResponse finished');
            console.log('✅ generateTextResponse 执行完成，返回值:', result);
          } catch (error) {
            console.error('❌ generateTextResponse 执行失败:', error);
            if (error instanceof Error) {
              console.error('❌ 错误堆栈:', error.stack);
            }
            throw error;
          }
          break;

        case 'generateVideo':
          console.log('🎬 执行视频生成，参数:', parameters.prompt);
          try {
            logProcessStep(metrics, 'invoking generateVideo');
            await store.generateVideo(parameters.prompt, state.sourceImageForEditing, { override: messageOverride, metrics });
            logProcessStep(metrics, 'generateVideo finished');
            console.log('✅ generateVideo 执行完成');
            // 清理源图像
            if (state.sourceImageForEditing) {
              store.setSourceImageForEditing(null);
            }
          } catch (error) {
            console.error('❌ generateVideo 执行失败:', error);
            if (error instanceof Error) {
              console.error('❌ 错误堆栈:', error.stack);
            }
            throw error;
          }
          break;

        default:
          throw new Error(`未知工具: ${selectedTool}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '处理失败';
      get().updateMessage(messageOverride.aiMessageId, (msg) => ({
        ...msg,
        content: `处理失败: ${errorMessage}`,
        generationStatus: {
          ...(msg.generationStatus || { isGenerating: true, progress: 0, error: null }),
          isGenerating: false,
          progress: 0,
          error: errorMessage,
          stage: '已终止'
        }
      }));
      logProcessStep(metrics, 'executeProcessFlow encountered error');
      throw err;
    }
    logProcessStep(metrics, 'executeProcessFlow done');
  },

  // 智能工具选择功能 - 统一入口（支持并行生成）
  processUserInput: async (input: string) => {
    const state = get();
    console.log('🤖 [AI Provider] processUserInput started', {
      aiProvider: state.aiProvider,
      manualAIMode: state.manualAIMode,
      input: input.substring(0, 50) + '...'
    });

    // 🔥 移除全局锁定检查，允许并行生成
    // if (state.generationStatus.isGenerating) return;

    // 🧠 确保有活跃的会话并同步状态
    let sessionId = state.currentSessionId || contextManager.getCurrentSessionId();
    if (!sessionId) {
      sessionId = contextManager.createSession();
    } else if (contextManager.getCurrentSessionId() !== sessionId) {
      contextManager.switchSession(sessionId);
    }

    if (sessionId !== state.currentSessionId) {
      const context = contextManager.getSession(sessionId);
      set({
        currentSessionId: sessionId,
        messages: context ? [...context.messages] : []
      });
    }

    get().refreshSessions();

    console.log('🤖 智能处理用户输入（并行模式）...');

    // 🔥 不再设置全局生成状态，而是直接执行处理流程
    // 每个消息会有自己的生成状态

    try {
      // 执行核心处理流程（每个请求独立）
      await get().executeProcessFlow(input, false);

    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : '处理失败';

      // 🔒 安全检查：防止Base64图像数据被当作错误消息
      if (errorMessage && errorMessage.length > 1000 && errorMessage.includes('iVBORw0KGgo')) {
        console.warn('⚠️ 检测到Base64图像数据被当作错误消息，使用默认错误信息');
        errorMessage = '图像处理失败，请重试';
      }

      // 如果占位消息尚未写入错误，则补充一条错误提示
      const messages = get().messages;
      const hasErrorSurface = messages.some((msg) =>
        msg.type === 'ai' &&
        msg.generationStatus?.stage === '已终止' &&
        msg.generationStatus?.error === errorMessage
      );
      if (!hasErrorSurface) {
        get().addMessage({
          type: 'error',
          content: `处理失败: ${errorMessage}`
        });
      }

      console.error('❌ 智能处理异常:', error);
    }
  },

  getAIMode: () => {
    const state = get();
    if (state.manualAIMode && state.manualAIMode !== 'auto') {
      if (state.manualAIMode === 'text') return 'text';
      return state.manualAIMode;
    }
    if (state.sourceImagesForBlending.length >= 2) return 'blend';
    if (state.sourceImageForEditing) return 'edit';
    if (state.sourceImageForAnalysis) return 'analyze';
    return 'generate';
  },

  // 配置管理
  toggleAutoDownload: () => set((state) => ({ autoDownload: !state.autoDownload })),
  setAutoDownload: (value: boolean) => set({ autoDownload: value }),
  toggleWebSearch: () => set((state) => ({ enableWebSearch: !state.enableWebSearch })),
  setWebSearch: (value: boolean) => set({ enableWebSearch: value }),
  toggleImageOnly: () => set((state) => ({ imageOnly: !state.imageOnly })),
  setImageOnly: (value: boolean) => set({ imageOnly: value }),
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
  setManualAIMode: (mode) => set({ manualAIMode: mode }),
  setAIProvider: (provider) => set({ aiProvider: provider }),

  // 重置状态
  resetState: () => {
    set({
      isVisible: false,
      currentInput: '',
      generationStatus: {
        isGenerating: false,
        progress: 0,
        error: null
      },
      messages: [],
      lastGeneratedImage: null,
      sourceImageForEditing: null,
      sourceImagesForBlending: [],
      sourceImageForAnalysis: null
    });
  },

  // 🧠 上下文管理方法实现
  initializeContext: () => {
    if (!hasHydratedSessions) {
      const stored = readSessionsFromLocalStorage();
      if (stored && stored.sessions.length > 0) {
        get().hydratePersistedSessions(stored.sessions, stored.activeSessionId, { markProjectDirty: false });
      }
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

    const context = sessionId ? contextManager.getSession(sessionId) : null;
    set({
      currentSessionId: sessionId,
      messages: context ? [...context.messages] : []
    });
    hasHydratedSessions = true;
    get().refreshSessions({ markProjectDirty: false });
    console.log('🧠 初始化上下文会话:', sessionId);
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
    console.log('🔄 启用迭代模式');
  },

  disableIterativeMode: () => {
    contextManager.resetIteration();
    console.log('🔄 禁用迭代模式');
  },
      };
    },
    {
      name: 'ai-chat-preferences',
      storage: createJSONStorage<Partial<AIChatState>>(() =>
        createSafeStorage({ storageName: 'ai-chat-preferences' })
      ),
      partialize: (state) => ({
        manualAIMode: state.manualAIMode,
        aiProvider: state.aiProvider,
        autoDownload: state.autoDownload,
        enableWebSearch: state.enableWebSearch,
        imageOnly: state.imageOnly,
        aspectRatio: state.aspectRatio,
      })
    }
  )
);
