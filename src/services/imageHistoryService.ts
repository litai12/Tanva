import { imageUploadService } from '@/services/imageUploadService';
import type { ImageHistoryItem } from '@/stores/imageHistoryStore';
import { useImageHistoryStore } from '@/stores/imageHistoryStore';

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
  dir?: string;
  timestamp?: number;
  skipInitialStoreUpdate?: boolean;
  keepThumbnail?: boolean;
  mimeType?: string;
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
}> {
  const {
    nodeId,
    nodeType,
    projectId,
    dir,
    skipInitialStoreUpdate,
    keepThumbnail,
    mimeType,
  } = options;

  let { id } = options;
  if (!id) {
    id = `history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const store = useImageHistoryStore.getState();
  const existing = store.history.find((item) => item.id === id);

  const dataUrl =
    options.dataUrl ??
    (options.base64 ? ensureDataUrl(options.base64, mimeType) : undefined);

  const initialSrc =
    options.remoteUrl && options.remoteUrl.startsWith('http')
      ? options.remoteUrl
      : dataUrl;

  if (!skipInitialStoreUpdate && initialSrc) {
    store.addImage({
      id,
      src: initialSrc,
      remoteUrl: options.remoteUrl,
      thumbnail:
        dataUrl && dataUrl.startsWith('data:') ? dataUrl : options.remoteUrl,
      title: options.title ?? '图片',
      nodeId,
      nodeType,
      timestamp: options.timestamp ?? existing?.timestamp,
    });
  }

  if (options.remoteUrl && options.remoteUrl.startsWith('http')) {
    return { id, remoteUrl: options.remoteUrl };
  }

  if (!dataUrl || dataUrl.startsWith('http')) {
    return { id, remoteUrl: dataUrl?.startsWith('http') ? dataUrl : undefined };
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
        thumbnail: keepThumbnail ? dataUrl : undefined,
      });
      return { id, remoteUrl };
    }
  } catch (error) {
    console.warn('[ImageHistory] 上传图片至 OSS 失败:', error);
  }

  return { id, remoteUrl: undefined };
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
