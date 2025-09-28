import { useEffect, useRef } from 'react';
import { projectApi } from '@/services/projectApi';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';

const AUTOSAVE_DELAY = 1500;

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

  useEffect(() => () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!projectId || !dirty || !dirtySince || !content || saving) {
      return undefined;
    }

    const now = Date.now();
    const delay = Math.max(0, AUTOSAVE_DELAY - (now - dirtySince));

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(async () => {
      try {
        setSaving(true);
        const result = await projectApi.saveContent(projectId, { content, version });
        markSaved(result.version, result.updatedAt ?? new Date().toISOString());
        // 记录事件并写入本地良好快照（兜底恢复用）
        try {
          saveMonitor.push(projectId, 'save_success', {
            version: result.version,
            updatedAt: result.updatedAt,
            paperJsonLen: (content as any)?.meta?.paperJsonLen || (content as any)?.paperJson?.length || 0,
            layerCount: (content as any)?.layers?.length || 0,
          });
          const paperJson = (content as any)?.paperJson as string | undefined;
          if (paperJson && paperJson.length > 0) {
            const backup = { version: result.version, updatedAt: result.updatedAt, paperJson };
            localStorage.setItem(`tanva_last_good_snapshot_${projectId}`, JSON.stringify(backup));
          }
        } catch {}
      } catch (err: any) {
        setError(err?.message || '自动保存失败');
        saveMonitor.push(projectId, 'save_error', { message: err?.message });
      }
    }, delay);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [projectId, dirty, dirtyCounter, dirtySince, content, version, saving, setSaving, markSaved, setError]);
}
