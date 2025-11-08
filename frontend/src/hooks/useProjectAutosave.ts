import { useEffect, useRef } from 'react';
import { projectApi } from '@/services/projectApi';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';
import { refreshProjectThumbnail } from '@/services/projectThumbnailService';

const AUTOSAVE_DELAY = 5 * 60 * 1000; // 5 分钟
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000;

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
      void refreshProjectThumbnail(currentProjectId);

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
