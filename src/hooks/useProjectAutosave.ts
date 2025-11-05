import { useEffect, useRef } from 'react';
import { projectApi } from '@/services/projectApi';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';
import { AutoScreenshotService } from '@/services/AutoScreenshotService';
import { imageUploadService } from '@/services/imageUploadService';
import { useProjectStore } from '@/stores/projectStore';
import { logger } from '@/utils/logger';

const AUTOSAVE_DELAY = 60000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000;
const THUMBNAIL_MIN_INTERVAL = 30000;

export function useProjectAutosave(projectId: string | null) {
  const content = useProjectContentStore((state) => state.content);
  const version = useProjectContentStore((state) => state.version);
  const dirty = useProjectContentStore((state) => state.dirty);
  const dirtyCounter = useProjectContentStore((state) => state.dirtyCounter);
  const dirtySince = useProjectContentStore((state) => state.dirtySince);
  const saving = useProjectContentStore((state) => state.saving);
  const setSaving = useProjectContentStore((state) => state.setSaving);
  const markSaved = useProjectContentStore((state) => state.markSaved);
  const setError = useProjectContentStore((state) => state.setError);

  const timerRef = useRef<number | null>(null);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<number | null>(null);
  const thumbnailInFlightRef = useRef(false);
  const lastThumbnailAtRef = useRef(0);

  useEffect(() => () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const maybeRefreshProjectThumbnail = async (currentProjectId: string) => {
    if (!currentProjectId || typeof window === 'undefined') {
      return;
    }
    if (thumbnailInFlightRef.current) {
      logger.debug?.('🔄 缩略图刷新正在进行中，跳过本次请求');
      return;
    }
    const now = Date.now();
    if (now - lastThumbnailAtRef.current < THUMBNAIL_MIN_INTERVAL) {
      logger.debug?.('⏱️ 缩略图刷新过于频繁，跳过本次');
      return;
    }

    const imageInstances = Array.isArray((window as any).tanvaImageInstances)
      ? (window as any).tanvaImageInstances
      : [];
    const model3DInstances = Array.isArray((window as any).tanvaModel3DInstances)
      ? (window as any).tanvaModel3DInstances
      : [];
    const storeState = useProjectContentStore.getState();
    const hasLayerContent = Boolean(storeState.content?.layers?.length);

    if (imageInstances.length === 0 && model3DInstances.length === 0 && !hasLayerContent) {
      logger.debug?.('🪄 当前画布为空，暂不生成缩略图');
      lastThumbnailAtRef.current = now;
      return;
    }

    thumbnailInFlightRef.current = true;
    try {
      const screenshot = await AutoScreenshotService.captureAutoScreenshot(
        imageInstances,
        model3DInstances,
        {
          format: 'png',
          scale: 1,
          padding: 20,
          includeBackground: true,
          autoDownload: false,
          quality: 0.9,
        }
      );

      if (!screenshot.success || !screenshot.dataUrl) {
        logger.warn('缩略图截图失败:', screenshot.error);
        return;
      }

      const upload = await imageUploadService.uploadImageDataUrl(screenshot.dataUrl, {
        dir: `projects/${currentProjectId}/thumbnails/`,
        fileName: `thumbnail_${Date.now()}.png`,
        projectId: currentProjectId,
        maxFileSize: 3 * 1024 * 1024,
      });

      if (!upload.success || !upload.asset?.url) {
        logger.warn('缩略图上传失败:', upload.error);
        return;
      }

      await useProjectStore.getState().updateMeta(currentProjectId, {
        thumbnailUrl: upload.asset.url,
      });
      logger.debug?.('✅ 项目缩略图已更新');
    } catch (error) {
      logger.warn('刷新项目缩略图失败:', error);
    } finally {
      thumbnailInFlightRef.current = false;
      lastThumbnailAtRef.current = Date.now();
    }
  };

  const performSave = async (currentProjectId: string, currentContent: any, currentVersion: number, attempt: number = 1) => {
    try {
      setSaving(true);
      const result = await projectApi.saveContent(currentProjectId, { content: currentContent, version: currentVersion });

      markSaved(result.version, result.updatedAt ?? new Date().toISOString());
      retryCountRef.current = 0; // 重置重试计数

      // 记录事件并写入本地良好快照（兜底恢复用）
      try {
        saveMonitor.push(currentProjectId, 'save_success', {
          version: result.version,
          updatedAt: result.updatedAt,
          paperJsonLen: (currentContent as any)?.meta?.paperJsonLen || (currentContent as any)?.paperJson?.length || 0,
          layerCount: (currentContent as any)?.layers?.length || 0,
          attempt,
        });
        const paperJson = (currentContent as any)?.paperJson as string | undefined;
        if (paperJson && paperJson.length > 0) {
          const backup = { version: result.version, updatedAt: result.updatedAt, paperJson };
          localStorage.setItem(`tanva_last_good_snapshot_${currentProjectId}`, JSON.stringify(backup));
        }
      } catch {}

      // 成功保存后尝试刷新缩略图（异步执行，避免阻塞主流程）
      void maybeRefreshProjectThumbnail(currentProjectId);

      console.log(`✅ 项目保存成功 (尝试 ${attempt}/${MAX_RETRY_ATTEMPTS})`);

    } catch (err: any) {
      console.warn(`❌ 项目保存失败 (尝试 ${attempt}/${MAX_RETRY_ATTEMPTS}):`, err);

      const rawMessage = err?.message || '';
      const errorMessage = rawMessage.includes('413') || rawMessage.toLowerCase().includes('too large')
        ? '内容过大，无法保存，请尝试清理或拆分项目'
        : (rawMessage || '自动保存失败');
      saveMonitor.push(currentProjectId, 'save_error', {
        message: errorMessage,
        attempt,
        maxAttempts: MAX_RETRY_ATTEMPTS
      });

      // 如果还有重试机会，则安排重试
      if (attempt < MAX_RETRY_ATTEMPTS) {
        console.log(`⏰ 将在 ${RETRY_DELAY}ms 后重试保存 (${attempt + 1}/${MAX_RETRY_ATTEMPTS})`);

        retryTimerRef.current = window.setTimeout(() => {
          // 重新检查当前状态，确保项目和内容没有变化
          const store = useProjectContentStore.getState();
          if (store.projectId === currentProjectId && store.dirty && !store.saving) {
            performSave(currentProjectId, store.content, store.version, attempt + 1);
          }
        }, RETRY_DELAY * attempt); // 渐进式延迟

      } else {
        // 重试次数用尽，设置错误状态
        setError(`${errorMessage} (已重试 ${MAX_RETRY_ATTEMPTS} 次)`);
        setSaving(false);
        retryCountRef.current = 0;
      }
    }
  };

  useEffect(() => {
    if (!projectId || !dirty || !dirtySince || !content || saving) {
      return undefined;
    }

    const now = Date.now();
    const delay = Math.max(0, AUTOSAVE_DELAY - (now - dirtySince));

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      // 再次检查状态，确保仍然需要保存
      const currentStore = useProjectContentStore.getState();
      if (currentStore.projectId === projectId && currentStore.dirty && !currentStore.saving) {
        performSave(projectId, currentStore.content, currentStore.version);
      }
    }, delay);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [projectId, dirty, dirtyCounter, dirtySince, content, version, saving]);
}
