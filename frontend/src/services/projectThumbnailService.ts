import { AutoScreenshotService } from '@/services/AutoScreenshotService';
import { imageUploadService } from '@/services/imageUploadService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useProjectStore } from '@/stores/projectStore';
import { logger } from '@/utils/logger';

type RefreshOptions = {
  force?: boolean;
};

const COOLDOWN_MS = 30000;
const inFlight = new Set<string>();
const lastTriggerAt = new Map<string, number>();

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

  try {
    const screenshot = await AutoScreenshotService.captureAutoScreenshot(
      imageInstances,
      model3DInstances,
      {
        format: 'png',
        scale: 2,
        padding: 0,
        includeBackground: true,
        backgroundColor: '#ffffff',
        autoDownload: false,
        quality: 0.92,
      }
    );

    if (!screenshot.success || !screenshot.dataUrl) {
      logger.warn?.('⚠️ Thumbnail capture failed', { projectId, error: screenshot.error });
      return;
    }

    let thumbnailUrl: string | null = null;

    const upload = await imageUploadService.uploadImageDataUrl(screenshot.dataUrl, {
      dir: `projects/${projectId}/thumbnails/`,
      fileName: `thumbnail_${Date.now()}.png`,
      projectId,
      maxFileSize: 3 * 1024 * 1024,
    });

    if (upload.success && upload.asset?.url) {
      thumbnailUrl = upload.asset.url;
    } else {
      logger.warn?.('⚠️ Thumbnail upload failed, skipping thumbnail update', { projectId, error: upload.error });
      return;
    }

    await useProjectStore.getState().updateMeta(projectId, {
      thumbnailUrl,
    });

    logger.debug?.('✅ Project thumbnail refreshed', { projectId });
  } catch (error) {
    logger.warn?.('⚠️ Thumbnail refresh error', { projectId, error });
  } finally {
    inFlight.delete(projectId);
    lastTriggerAt.set(projectId, Date.now());
  }
}
