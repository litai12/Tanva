import { imageUploadService } from '@/services/imageUploadService';
import type { ImageHistoryItem } from '@/stores/imageHistoryStore';
import { useImageHistoryStore } from '@/stores/imageHistoryStore';
import { useGlobalImageHistoryStore } from '@/stores/globalImageHistoryStore';
import type { CreateGlobalImageHistoryDto } from '@/services/globalImageHistoryApi';
import {
  isLikelyManagedAssetUrl,
  isRemoteUrl,
  looksLikeSignedAssetUrl,
  resolveImageToBlob,
} from '@/utils/imageSource';

const PENDING_GLOBAL_HISTORY_KEY = 'tanva-global-image-history-pending-v1';
const MAX_PENDING_GLOBAL_HISTORY = 120;

type PendingGlobalHistoryWrite = {
  dto: CreateGlobalImageHistoryDto;
  attempts: number;
  queuedAt: number;
};

let pendingGlobalHistoryQueue: PendingGlobalHistoryWrite[] | null = null;
let pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushingPendingWrites = false;
let queueListenersAttached = false;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parsePendingQueue = (raw: string | null): PendingGlobalHistoryWrite[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!isObjectRecord(item)) return null;
        const dto = item.dto;
        if (!isObjectRecord(dto)) return null;
        const imageUrl = typeof dto.imageUrl === 'string' ? dto.imageUrl.trim() : '';
        const sourceType = typeof dto.sourceType === 'string' ? dto.sourceType.trim() : '';
        if (!imageUrl || !sourceType) return null;
        return {
          dto: {
            imageUrl,
            sourceType,
            prompt: typeof dto.prompt === 'string' ? dto.prompt : undefined,
            sourceProjectId:
              typeof dto.sourceProjectId === 'string' ? dto.sourceProjectId : undefined,
            sourceProjectName:
              typeof dto.sourceProjectName === 'string'
                ? dto.sourceProjectName
                : undefined,
            metadata: isObjectRecord(dto.metadata) ? dto.metadata : undefined,
          },
          attempts:
            typeof item.attempts === 'number' && Number.isFinite(item.attempts)
              ? Math.max(0, Math.floor(item.attempts))
              : 0,
          queuedAt:
            typeof item.queuedAt === 'number' && Number.isFinite(item.queuedAt)
              ? item.queuedAt
              : Date.now(),
        } satisfies PendingGlobalHistoryWrite;
      })
      .filter(Boolean) as PendingGlobalHistoryWrite[];
  } catch {
    return [];
  }
};

const persistPendingQueue = (queue: PendingGlobalHistoryWrite[]) => {
  if (typeof window === 'undefined') return;
  try {
    if (queue.length === 0) {
      window.localStorage.removeItem(PENDING_GLOBAL_HISTORY_KEY);
      return;
    }
    window.localStorage.setItem(PENDING_GLOBAL_HISTORY_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
};

const isSamePendingWrite = (
  a: CreateGlobalImageHistoryDto,
  b: CreateGlobalImageHistoryDto
): boolean => {
  return (
    a.imageUrl === b.imageUrl &&
    a.sourceType === b.sourceType &&
    (a.prompt || '') === (b.prompt || '') &&
    (a.sourceProjectId || '') === (b.sourceProjectId || '')
  );
};

const ensurePendingQueueInitialized = () => {
  if (!pendingGlobalHistoryQueue) {
    let raw: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        raw = window.localStorage.getItem(PENDING_GLOBAL_HISTORY_KEY);
      } catch {
        raw = null;
      }
    }
    pendingGlobalHistoryQueue = parsePendingQueue(raw);
  }

  if (typeof window === 'undefined' || queueListenersAttached) return;
  queueListenersAttached = true;

  const triggerFlush = () => {
    void flushPendingGlobalHistoryWrites();
  };
  window.addEventListener('online', triggerFlush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      triggerFlush();
    }
  });
};

const schedulePendingFlush = (delayMs: number) => {
  if (pendingFlushTimer) {
    clearTimeout(pendingFlushTimer);
  }
  pendingFlushTimer = setTimeout(() => {
    pendingFlushTimer = null;
    void flushPendingGlobalHistoryWrites();
  }, Math.max(0, delayMs));
};

const enqueuePendingGlobalHistoryWrite = (dto: CreateGlobalImageHistoryDto) => {
  ensurePendingQueueInitialized();
  const queue = pendingGlobalHistoryQueue || [];

  if (queue.some((item) => isSamePendingWrite(item.dto, dto))) {
    schedulePendingFlush(200);
    return;
  }

  queue.push({
    dto,
    attempts: 0,
    queuedAt: Date.now(),
  });
  if (queue.length > MAX_PENDING_GLOBAL_HISTORY) {
    queue.splice(0, queue.length - MAX_PENDING_GLOBAL_HISTORY);
  }
  pendingGlobalHistoryQueue = queue;
  persistPendingQueue(queue);
  schedulePendingFlush(80);
};

async function flushPendingGlobalHistoryWrites(): Promise<void> {
  ensurePendingQueueInitialized();
  if (isFlushingPendingWrites) return;
  const queue = pendingGlobalHistoryQueue || [];
  if (queue.length === 0) return;

  isFlushingPendingWrites = true;
  try {
    while (queue.length > 0) {
      const current = queue[0];
      const created = await useGlobalImageHistoryStore.getState().addItem(current.dto);
      if (created) {
        queue.shift();
        persistPendingQueue(queue);
        continue;
      }

      current.attempts += 1;
      persistPendingQueue(queue);

      const backoffMs = Math.min(30_000, 500 * 2 ** Math.max(0, current.attempts - 1));
      schedulePendingFlush(backoffMs);
      return;
    }
  } finally {
    isFlushingPendingWrites = false;
    persistPendingQueue(queue);
  }
}

const ensurePersistableRemoteHistoryUrl = async (
  remoteUrl: string,
  options: {
    projectId?: string | null;
    dir?: string;
    fileName?: string;
    nodeType: ImageHistoryItem['nodeType'];
  }
): Promise<string> => {
  const trimmed = remoteUrl.trim();
  if (!isRemoteUrl(trimmed)) return remoteUrl;

  // 托管 OSS/CDN 的稳定 URL 直接使用；签名链接或第三方外链尝试转存。
  if (isLikelyManagedAssetUrl(trimmed) && !looksLikeSignedAssetUrl(trimmed)) {
    return trimmed;
  }

  try {
    const blob = await resolveImageToBlob(trimmed, { preferProxy: true });
    if (!blob) return trimmed;
    const upload = await imageUploadService.uploadImageSource(blob, {
      projectId: options.projectId ?? undefined,
      dir: options.dir ?? 'uploads/history/',
      fileName:
        options.fileName ??
        `${options.nodeType}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      contentType: blob.type || 'image/png',
    });
    if (upload.success && upload.asset?.url && upload.asset.url.startsWith('http')) {
      return upload.asset.url;
    }
  } catch (error) {
    console.warn('[ImageHistory] 远程 URL 转存失败，保留原链接:', error);
  }

  return trimmed;
};

interface RecordImageHistoryOptions {
  id?: string;
  dataUrl?: string;
  base64?: string;
  remoteUrl?: string;
  fileName?: string;
  title?: string;
  nodeId: string;
  nodeType: ImageHistoryItem['nodeType'];
  projectId?: string | null;
  projectName?: string;
  dir?: string;
  timestamp?: number;
  skipInitialStoreUpdate?: boolean;
  keepThumbnail?: boolean;
  mimeType?: string;
  thumbnailDataUrl?: string;
  skipGlobalHistory?: boolean;
  metadata?: Record<string, any>;
}

const ensureDataUrl = (value: string, mimeType: string = 'png'): string => {
  if (value.startsWith('data:') || value.startsWith('http')) {
    return value;
  }
  return `data:image/${mimeType};base64,${value}`;
};

/**
 * 记录一条图片历史，自动将 base64 上传到 OSS，并在成功后把历史记录的 src 更新为远程链接。
 */
export async function recordImageHistoryEntry(options: RecordImageHistoryOptions): Promise<{
  id: string;
  remoteUrl?: string;
  thumbnail?: string;
}> {
  const {
    nodeId,
    nodeType,
    projectId,
    projectName,
    dir,
    skipInitialStoreUpdate,
    keepThumbnail,
    mimeType,
    skipGlobalHistory,
  } = options;

  const enqueueGlobalHistoryWrite = (imageUrl?: string) => {
    if (skipGlobalHistory) return;
    if (!imageUrl || !imageUrl.startsWith('http')) return;
    enqueuePendingGlobalHistoryWrite({
      imageUrl,
      prompt: options.title,
      sourceType: nodeType,
      sourceProjectId: projectId ?? undefined,
      sourceProjectName: projectName,
      metadata: options.metadata,
    });
  };

  let { id } = options;
  if (!id) {
    id = `history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const store = useImageHistoryStore.getState();
  const existing = store.history.find((item) => item.id === id);

  const normalizedRemoteUrl =
    options.remoteUrl && options.remoteUrl.startsWith('http')
      ? options.remoteUrl.trim()
      : undefined;

  const dataUrl =
    options.dataUrl ??
    (options.base64 ? ensureDataUrl(options.base64, mimeType) : undefined);
  const resolvedThumbnail =
    options.thumbnailDataUrl ??
    (options.keepThumbnail && dataUrl?.startsWith('data:')
      ? dataUrl
      : undefined);

  const initialSrc =
    normalizedRemoteUrl
      ? normalizedRemoteUrl
      : dataUrl;

  if (!skipInitialStoreUpdate && initialSrc) {
    store.addImage({
      id,
      src: initialSrc,
      remoteUrl: normalizedRemoteUrl,
      thumbnail: resolvedThumbnail,
      title: options.title ?? '图片',
      nodeId,
      nodeType,
      projectId,
      timestamp: options.timestamp ?? existing?.timestamp,
    });
  }

  if (normalizedRemoteUrl) {
    const persistedRemoteUrl = await ensurePersistableRemoteHistoryUrl(normalizedRemoteUrl, {
      projectId,
      dir,
      fileName: options.fileName,
      nodeType,
    });
    if (!skipInitialStoreUpdate && persistedRemoteUrl !== normalizedRemoteUrl) {
      store.updateImage(id, {
        src: persistedRemoteUrl,
        remoteUrl: persistedRemoteUrl,
        projectId,
      });
    }
    enqueueGlobalHistoryWrite(persistedRemoteUrl);
    return { id, remoteUrl: persistedRemoteUrl, thumbnail: resolvedThumbnail };
  }

  if (!dataUrl || dataUrl.startsWith('http')) {
    const url = dataUrl?.startsWith('http') ? dataUrl : undefined;
    const persistedRemoteUrl = url
      ? await ensurePersistableRemoteHistoryUrl(url, {
          projectId,
          dir,
          fileName: options.fileName,
          nodeType,
        })
      : undefined;
    if (!skipInitialStoreUpdate && persistedRemoteUrl && persistedRemoteUrl !== url) {
      store.updateImage(id, {
        src: persistedRemoteUrl,
        remoteUrl: persistedRemoteUrl,
        projectId,
      });
    }
    enqueueGlobalHistoryWrite(persistedRemoteUrl);
    return { id, remoteUrl: persistedRemoteUrl, thumbnail: resolvedThumbnail };
  }

  try {
    const uploadResult = await imageUploadService.uploadImageDataUrl(dataUrl, {
      projectId: projectId ?? undefined,
      dir: dir ?? 'uploads/history/',
      fileName:
        options.fileName ??
        `${nodeType}_${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
    });

    if (uploadResult.success && uploadResult.asset?.url) {
      const remoteUrl = uploadResult.asset.url;
      store.updateImage(id, {
        src: remoteUrl,
        remoteUrl,
        thumbnail: keepThumbnail ? resolvedThumbnail ?? dataUrl : undefined,
        projectId,
      });

      // 同步写入全局历史（异步，不阻塞返回）
      enqueueGlobalHistoryWrite(remoteUrl);

      return {
        id,
        remoteUrl,
        thumbnail: keepThumbnail ? resolvedThumbnail ?? dataUrl : resolvedThumbnail,
      };
    }
  } catch (error) {
    console.warn('[ImageHistory] 上传图片至 OSS 失败:', error);
  }

  return { id, remoteUrl: undefined, thumbnail: resolvedThumbnail };
}

/**
 * 将历史记录中仍为 base64 的图片尝试上传到 OSS。
 */
export async function migrateImageHistoryToRemote(options?: {
  projectId?: string | null;
  dir?: string;
}) {
  const store = useImageHistoryStore.getState();
  const { history } = store;

  for (const item of history) {
    const isRemote = item.remoteUrl && item.remoteUrl.startsWith('http');
    const isDataUrl = item.src.startsWith('data:image');
    if (isRemote || !isDataUrl) {
      continue;
    }

    await recordImageHistoryEntry({
      id: item.id,
      dataUrl: item.src,
      title: item.title,
      nodeId: item.nodeId,
      nodeType: item.nodeType,
      projectId: options?.projectId ?? null,
      dir: options?.dir,
      timestamp: item.timestamp,
      skipInitialStoreUpdate: true,
    });
  }
}

if (typeof window !== 'undefined') {
  setTimeout(() => {
    ensurePendingQueueInitialized();
    void flushPendingGlobalHistoryWrites();
  }, 150);
}
