import { AutoScreenshotService } from '@/services/AutoScreenshotService';
import { imageUploadService } from '@/services/imageUploadService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useProjectStore } from '@/stores/projectStore';
import { logger } from '@/utils/logger';

type RefreshOptions = {
  force?: boolean;
};

const COOLDOWN_MS = 30000;
const MAX_THUMBNAIL_SIZE = 500 * 1024; // 500KB 上限，缩略图应该尽量小以加快加载
const TARGET_THUMBNAIL_WIDTH = 600; // 目标宽度，足够在项目列表中清晰显示
const inFlight = new Set<string>();
const lastTriggerAt = new Map<string, number>();

function estimateDataUrlBytes(dataUrl?: string | null): number {
  if (!dataUrl || typeof dataUrl !== 'string') return 0;
  const [, base64] = dataUrl.split(',');
  return Math.ceil(((base64?.length || 0) * 3) / 4);
}

export async function refreshProjectThumbnail(
  projectId: string,
  options: RefreshOptions = {}
): Promise<void> {
  if (!projectId || typeof window === 'undefined') {
    return;
  }

  if (!options.force) {
    const last = lastTriggerAt.get(projectId) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) {
      logger.debug?.('⏱️ Thumbnail refresh skipped due to cooldown', { projectId });
      return;
    }
  }

  if (inFlight.has(projectId)) {
    logger.debug?.('🔄 Thumbnail refresh already in progress, skipping', { projectId });
    return;
  }

  const imageInstances = Array.isArray((window as any).tanvaImageInstances)
    ? (window as any).tanvaImageInstances
    : [];
  const model3DInstances = Array.isArray((window as any).tanvaModel3DInstances)
    ? (window as any).tanvaModel3DInstances
    : [];

  const hasLayerContent = Boolean(useProjectContentStore.getState().content?.layers?.length);
  const hasRenderableContent =
    imageInstances.length > 0 ||
    model3DInstances.length > 0 ||
    hasLayerContent;

  if (!hasRenderableContent) {
    logger.debug?.('🪄 Canvas empty, skip thumbnail refresh', { projectId });
    lastTriggerAt.set(projectId, Date.now());
    return;
  }

  inFlight.add(projectId);
  const startTime = performance.now();

  try {
    let thumbnailUrl: string | null = null;
    const captureAttempts = [
      { format: 'jpeg' as const, quality: 0.7, scale: 0.5 },
      { format: 'jpeg' as const, quality: 0.5, scale: 0.4 },
    ];

    for (const attempt of captureAttempts) {
      const screenshot = await AutoScreenshotService.captureAutoScreenshot(
        imageInstances,
        model3DInstances,
        {
          format: attempt.format,
          scale: attempt.scale,
          padding: 0,
          includeBackground: true,
          backgroundColor: '#ffffff',
          autoDownload: false,
          quality: attempt.quality,
          filename: 'artboard-thumbnail',
        }
      );

      if (!screenshot.success || !screenshot.dataUrl) {
        logger.warn?.('⚠️ Thumbnail capture failed', { projectId, error: screenshot.error, attempt });
        continue;
      }

      const estimatedBytes = estimateDataUrlBytes(screenshot.dataUrl);

      const upload = await imageUploadService.uploadImageDataUrl(screenshot.dataUrl, {
        dir: `projects/${projectId}/thumbnails/`,
        fileName: `thumbnail_${Date.now()}.${attempt.format === 'jpeg' ? 'jpg' : 'png'}`,
        projectId,
        maxFileSize: MAX_THUMBNAIL_SIZE,
      });

      if (upload.success && upload.asset?.url) {
        thumbnailUrl = upload.asset.url;
        if (estimatedBytes > MAX_THUMBNAIL_SIZE * 0.9) {
          logger.debug?.('🧹 Thumbnail auto-compressed', { projectId, estimatedBytes, attempt });
        }
        break;
      }

      logger.warn?.('⚠️ Thumbnail upload failed, trying fallback', {
        projectId,
        error: upload.error,
        estimatedBytes,
        attempt,
      });
    }

    if (!thumbnailUrl) {
      logger.warn?.('⚠️ Thumbnail upload failed after fallbacks', { projectId });
      return;
    }

    await useProjectStore.getState().updateMeta(projectId, {
      thumbnailUrl,
    });

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(
      `%c🖼️ THUMBNAIL GENERATED | ${elapsed}s | Project: ${projectId.slice(0, 8)}...`,
      'background: #4CAF50; color: white; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px;'
    );
  } catch (error) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(
      `%c❌ THUMBNAIL FAILED | ${elapsed}s | Project: ${projectId.slice(0, 8)}...`,
      'background: #f44336; color: white; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px;'
    );
    logger.warn?.('⚠️ Thumbnail refresh error', { projectId, error });
  } finally {
    inFlight.delete(projectId);
    lastTriggerAt.set(projectId, Date.now());
  }
}
