import { useCallback } from 'react';
import { projectApi } from '@/services/projectApi';
import { paperSaveService } from '@/services/paperSaveService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';
import { refreshProjectThumbnail } from '@/services/projectThumbnailService';

export default function ManualSaveButton() {
  const projectId = useProjectContentStore((state) => state.projectId);
  const saving = useProjectContentStore((state) => state.saving);
  const setSaving = useProjectContentStore((state) => state.setSaving);
  const markSaved = useProjectContentStore((state) => state.markSaved);
  const setError = useProjectContentStore((state) => state.setError);

  const handleSave = useCallback(async () => {
    const storeBefore = useProjectContentStore.getState();
    if (!storeBefore.projectId || storeBefore.saving) {
      return;
    }

    try {
      await paperSaveService.saveImmediately();

      const store = useProjectContentStore.getState();
      const { projectId: currentProjectId, content, version } = store;
      if (!currentProjectId || !content) {
        setError('当前没有可以保存的内容');
        return;
      }

      setSaving(true);

      const result = await projectApi.saveContent(currentProjectId, { content, version });

      markSaved(result.version, result.updatedAt ?? new Date().toISOString());
      void refreshProjectThumbnail(currentProjectId, { force: true });

      try {
        saveMonitor.push(currentProjectId, 'manual_save_success', {
          version: result.version,
          updatedAt: result.updatedAt,
          paperJsonLen: (content as any)?.meta?.paperJsonLen || (content as any)?.paperJson?.length || 0,
          layerCount: (content as any)?.layers?.length || 0,
        });
        const paperJson = (content as any)?.paperJson as string | undefined;
        if (paperJson && paperJson.length > 0) {
          const backup = { version: result.version, updatedAt: result.updatedAt, paperJson };
          localStorage.setItem(`tanva_last_good_snapshot_${currentProjectId}`, JSON.stringify(backup));
        }
      } catch {}
    } catch (error) {
      const store = useProjectContentStore.getState();
      const currentProjectId = store.projectId;
      const rawMessage = error instanceof Error ? error.message : '';
      const message = rawMessage.includes('413') || rawMessage.toLowerCase().includes('too large')
        ? '保存失败：内容过大，请尝试清理或拆分项目'
        : (rawMessage || '保存失败');
      if (currentProjectId) {
        try {
          saveMonitor.push(currentProjectId, 'manual_save_error', { message });
        } catch {}
      }
      setError(message);
      console.error('手动保存失败:', error);
    } finally {
      setSaving(false);
    }
  }, [markSaved, setError, setSaving]);

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={!projectId || saving}
      className="rounded border border-sky-500 bg-sky-50 px-2 py-1 text-xs text-sky-600 hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
    >
      {saving ? '保存中…' : '保存'}
    </button>
  );
}
