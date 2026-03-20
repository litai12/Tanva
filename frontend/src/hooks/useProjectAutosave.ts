import { useEffect, useRef } from 'react';
import { projectApi } from '@/services/projectApi';
import { paperSaveService } from '@/services/paperSaveService';
import { flowSaveService } from '@/services/flowSaveService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';
import { refreshProjectThumbnail } from '@/services/projectThumbnailService';
import { setProjectCache } from '@/services/projectCacheStore';
import {
  getNonRemoteImageAssetIds,
  getNonPersistableFlowImageNodeIds,
  sanitizeProjectContentForCloudSave,
} from '@/utils/projectContentValidation';

const AUTOSAVE_INTERVAL = 60 * 1000;
const DEBOUNCE_DELAY = 5 * 1000;
const MIN_SAVE_INTERVAL_MS = 15 * 1000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000;
const MAX_LOCAL_SNAPSHOT_LENGTH = 2 * 1024 * 1024;

export function useProjectAutosave(projectId: string | null) {
  const content = useProjectContentStore((state) => state.content);
  const version = useProjectContentStore((state) => state.version);
  const dirty = useProjectContentStore((state) => state.dirty);
  const dirtyCounter = useProjectContentStore((state) => state.dirtyCounter);
  const setSaving = useProjectContentStore((state) => state.setSaving);
  const markSaved = useProjectContentStore((state) => state.markSaved);
  const setError = useProjectContentStore((state) => state.setError);
  const setWarning = useProjectContentStore((state) => state.setWarning);

  const intervalTimerRef = useRef<number | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const minIntervalTimerRef = useRef<number | null>(null);
  const savingLockRef = useRef(false);
  const lastPersistedAtRef = useRef(0);

  useEffect(
    () => () => {
      if (intervalTimerRef.current) {
        window.clearInterval(intervalTimerRef.current);
        intervalTimerRef.current = null;
      }
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (minIntervalTimerRef.current) {
        window.clearTimeout(minIntervalTimerRef.current);
        minIntervalTimerRef.current = null;
      }
    },
    []
  );

  const performSave = async (
    currentProjectId: string,
    currentContent: any,
    currentVersion: number,
    savedAtCounter: number,
    attempt = 1
  ) => {
    if (attempt === 1 && lastPersistedAtRef.current > 0) {
      const elapsed = Date.now() - lastPersistedAtRef.current;
      if (elapsed < MIN_SAVE_INTERVAL_MS) {
        const waitMs = MIN_SAVE_INTERVAL_MS - elapsed;
        if (minIntervalTimerRef.current) {
          window.clearTimeout(minIntervalTimerRef.current);
        }
        minIntervalTimerRef.current = window.setTimeout(() => {
          minIntervalTimerRef.current = null;
          const store = useProjectContentStore.getState();
          if (store.projectId === currentProjectId && store.dirty && !store.saving && store.content) {
            void performSave(currentProjectId, store.content, store.version, store.dirtyCounter, 1);
          }
        }, waitMs);
        return;
      }
    }

    if (savingLockRef.current) {
      console.log('save in progress, skip current trigger');
      return;
    }

    try {
      savingLockRef.current = true;
      let contentToSave = currentContent;
      let versionToSave = currentVersion;
      let counterToSave = savedAtCounter;

      if (getNonRemoteImageAssetIds(contentToSave).length > 0) {
        try {
          await paperSaveService.saveImmediately();
          const storeAfterFlush = useProjectContentStore.getState();
          if (storeAfterFlush.projectId === currentProjectId && storeAfterFlush.content) {
            contentToSave = storeAfterFlush.content;
            versionToSave = storeAfterFlush.version;
            counterToSave = storeAfterFlush.dirtyCounter;
          }
        } catch {
          // noop
        }
      }

      if (getNonPersistableFlowImageNodeIds(contentToSave).length > 0) {
        try {
          await flowSaveService.flushImageSplitInputImages();
          const storeAfterFlush = useProjectContentStore.getState();
          if (storeAfterFlush.projectId === currentProjectId && storeAfterFlush.content) {
            contentToSave = storeAfterFlush.content;
            versionToSave = storeAfterFlush.version;
            counterToSave = storeAfterFlush.dirtyCounter;
          }
        } catch {
          // noop
        }
      }

      const sanitizeResult = sanitizeProjectContentForCloudSave(contentToSave);
      const invalidCanvasImageIds = sanitizeResult?.dropped.canvasImageIds ?? [];
      const invalidFlowNodeIds = sanitizeResult?.dropped.flowNodeIds ?? [];
      const contentForCloudSave = sanitizeResult?.sanitized ?? contentToSave;

      if (invalidCanvasImageIds.length > 0 || invalidFlowNodeIds.length > 0) {
        const message = `Found non-persistable images (Canvas ${invalidCanvasImageIds.length}, Flow ${invalidFlowNodeIds.length}), cloud save blocked.`;
        saveMonitor.push(currentProjectId, 'save_blocked_local_assets', {
          canvasCount: invalidCanvasImageIds.length,
          flowCount: invalidFlowNodeIds.length,
          attempt,
        });
        setWarning(message);
        return;
      }
      setWarning(null);

      setSaving(true);
      const result = await projectApi.saveContent(currentProjectId, {
        content: contentForCloudSave,
        version: versionToSave,
      });

      markSaved(result.version, result.updatedAt ?? new Date().toISOString(), counterToSave);

      try {
        saveMonitor.push(currentProjectId, 'save_success', {
          version: result.version,
          updatedAt: result.updatedAt,
          paperJsonLen:
            (contentToSave as any)?.meta?.paperJsonLen ||
            (contentToSave as any)?.paperJson?.length ||
            0,
          layerCount: (contentToSave as any)?.layers?.length || 0,
          attempt,
        });

        const paperJson = (contentToSave as any)?.paperJson as string | undefined;
        if (paperJson && paperJson.length > 0) {
          if (paperJson.length <= MAX_LOCAL_SNAPSHOT_LENGTH) {
            const backup = { version: result.version, updatedAt: result.updatedAt, paperJson };
            localStorage.setItem(
              `tanva_last_good_snapshot_${currentProjectId}`,
              JSON.stringify(backup)
            );
          } else {
            console.warn('skip local snapshot: paperJson too large', {
              length: paperJson.length,
              projectId: currentProjectId,
            });
          }
        }
      } catch {
        // noop
      }

      void refreshProjectThumbnail(currentProjectId);

      setProjectCache({
        projectId: currentProjectId,
        content: contentToSave,
        version: result.version,
        updatedAt: result.updatedAt ?? new Date().toISOString(),
        cachedAt: new Date().toISOString(),
      }).catch(() => {});

      lastPersistedAtRef.current = Date.now();
      console.log(`autosave success (${attempt}/${MAX_RETRY_ATTEMPTS})`);
    } catch (err: any) {
      console.warn(`autosave failed (${attempt}/${MAX_RETRY_ATTEMPTS}):`, err);

      const rawMessage = err?.message || '';
      const errorMessage =
        rawMessage.includes('413') || rawMessage.toLowerCase().includes('too large')
          ? 'Content is too large to save. Please simplify and try again.'
          : rawMessage || 'Autosave failed';

      saveMonitor.push(currentProjectId, 'save_error', {
        message: errorMessage,
        attempt,
        maxAttempts: MAX_RETRY_ATTEMPTS,
      });

      if (attempt < MAX_RETRY_ATTEMPTS) {
        if (retryTimerRef.current) {
          window.clearTimeout(retryTimerRef.current);
        }

        retryTimerRef.current = window.setTimeout(() => {
          const store = useProjectContentStore.getState();
          if (store.projectId === currentProjectId && store.dirty && !store.saving && store.content) {
            void performSave(
              currentProjectId,
              store.content,
              store.version,
              store.dirtyCounter,
              attempt + 1
            );
          }
        }, RETRY_DELAY * attempt);
      } else {
        setError(`${errorMessage} (retried ${MAX_RETRY_ATTEMPTS} times)`);
      }
    } finally {
      savingLockRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!projectId) return undefined;

    intervalTimerRef.current = window.setInterval(() => {
      const store = useProjectContentStore.getState();
      if (store.projectId === projectId && store.dirty && !store.saving && store.content) {
        void performSave(projectId, store.content, store.version, store.dirtyCounter);
      }
    }, AUTOSAVE_INTERVAL);

    return () => {
      if (intervalTimerRef.current) {
        window.clearInterval(intervalTimerRef.current);
        intervalTimerRef.current = null;
      }
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !dirty || !content) return undefined;

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      const store = useProjectContentStore.getState();
      if (store.projectId === projectId && store.dirty && !store.saving && store.content) {
        void performSave(projectId, store.content, store.version, store.dirtyCounter);
      }
    }, DEBOUNCE_DELAY);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [projectId, dirty, dirtyCounter, content]);
}
