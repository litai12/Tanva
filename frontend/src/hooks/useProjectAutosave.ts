import { useEffect, useRef } from 'react';
import { projectApi } from '@/services/projectApi';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';
import { refreshProjectThumbnail } from '@/services/projectThumbnailService';

const AUTOSAVE_INTERVAL = 60 * 1000; // 1 分钟定时保存
const DEBOUNCE_DELAY = 5 * 1000; // 5 秒防抖保存（用户停止操作后）
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000;
const MAX_LOCAL_SNAPSHOT_LENGTH = 2 * 1024 * 1024; // ~2MB，防止占用过多内存

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

  const intervalTimerRef = useRef<number | null>(null); // 定时保存
  const debounceTimerRef = useRef<number | null>(null); // 防抖保存
  const retryTimerRef = useRef<number | null>(null);
  const savingLockRef = useRef<boolean>(false); // 保存锁，防止并发保存

  useEffect(() => () => {
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
  }, []);

  const performSave = async (currentProjectId: string, currentContent: any, currentVersion: number, savedAtCounter: number, attempt: number = 1) => {
    // 检查保存锁，防止并发保存
    if (savingLockRef.current) {
      console.log('⏸️ 保存已在进行中，跳过本次保存');
      return;
    }

    try {
      savingLockRef.current = true;
      setSaving(true);
      const result = await projectApi.saveContent(currentProjectId, { content: currentContent, version: currentVersion });

      // 传递保存时的 dirtyCounter，让 markSaved 判断是否有新修改
      markSaved(result.version, result.updatedAt ?? new Date().toISOString(), savedAtCounter);

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
          if (paperJson.length <= MAX_LOCAL_SNAPSHOT_LENGTH) {
            const backup = { version: result.version, updatedAt: result.updatedAt, paperJson };
            localStorage.setItem(`tanva_last_good_snapshot_${currentProjectId}`, JSON.stringify(backup));
          } else {
            console.warn('跳过本地快照：paperJson 过大，避免内存占用', {
              length: paperJson.length,
              projectId: currentProjectId,
            });
          }
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
            performSave(currentProjectId, store.content, store.version, store.dirtyCounter, attempt + 1);
          }
        }, RETRY_DELAY * attempt); // 渐进式延迟

      } else {
        // 重试次数用尽，设置错误状态
        setError(`${errorMessage} (已重试 ${MAX_RETRY_ATTEMPTS} 次)`);
      }
    } finally {
      savingLockRef.current = false;
      setSaving(false);
    }
  };

  // 定时保存：每 1 分钟检查一次，如果有未保存的修改则保存
  useEffect(() => {
    if (!projectId) {
      return undefined;
    }

    intervalTimerRef.current = window.setInterval(() => {
      const store = useProjectContentStore.getState();
      if (store.projectId === projectId && store.dirty && !store.saving && store.content) {
        console.log('⏰ 定时自动保存触发');
        performSave(projectId, store.content, store.version, store.dirtyCounter);
      }
    }, AUTOSAVE_INTERVAL);

    return () => {
      if (intervalTimerRef.current) {
        window.clearInterval(intervalTimerRef.current);
        intervalTimerRef.current = null;
      }
    };
  }, [projectId]);

  // 防抖保存：用户停止操作 5 秒后自动保存
  useEffect(() => {
    if (!projectId || !dirty || !content) {
      return undefined;
    }

    // 清除之前的防抖定时器
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(() => {
      const store = useProjectContentStore.getState();
      if (store.projectId === projectId && store.dirty && !store.saving && store.content) {
        console.log('🔄 防抖自动保存触发（用户停止操作 5 秒）');
        performSave(projectId, store.content, store.version, store.dirtyCounter);
      }
    }, DEBOUNCE_DELAY);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [projectId, dirty, dirtyCounter, content]); // 移除 saving 依赖
}
