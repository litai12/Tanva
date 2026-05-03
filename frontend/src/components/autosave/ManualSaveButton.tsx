import { useCallback } from 'react';
import { projectApi } from '@/services/projectApi';
import { paperSaveService } from '@/services/paperSaveService';
import { flowSaveService } from '@/services/flowSaveService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';
import { sanitizeProjectContentForCloudSave } from '@/utils/projectContentValidation';
import { useTranslation } from 'react-i18next';

export default function ManualSaveButton() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);
  const projectId = useProjectContentStore((state) => state.projectId);
  const manualSaving = useProjectContentStore((state) => state.manualSaving);
  const setManualSaving = useProjectContentStore((state) => state.setManualSaving);
  const markSaved = useProjectContentStore((state) => state.markSaved);
  const setError = useProjectContentStore((state) => state.setError);
  const setWarning = useProjectContentStore((state) => state.setWarning);

  const handleSave = useCallback(async () => {
    const storeBefore = useProjectContentStore.getState();
    if (!storeBefore.projectId || storeBefore.saving || storeBefore.manualSaving) {
      return;
    }

    try {
      await paperSaveService.saveImmediately();
      await flowSaveService.flushFlowNodeImageRefs();

      const store = useProjectContentStore.getState();
      const { projectId: currentProjectId, content, version } = store;
      if (!currentProjectId || !content) {
        setError(lt('当前没有可以保存的内容', 'No content available to save'));
        return;
      }

      const sanitizeResult = sanitizeProjectContentForCloudSave(content);
      const invalidCanvasImageIds = sanitizeResult?.dropped.canvasImageIds ?? [];
      const invalidFlowNodeIds = sanitizeResult?.dropped.flowNodeIds ?? [];
      const contentForCloudSave = sanitizeResult?.sanitized ?? content;
      if (invalidCanvasImageIds.length > 0 || invalidFlowNodeIds.length > 0) {
        setWarning(
          lt(
            `存在未上传到 OSS 的图片（画布 ${invalidCanvasImageIds.length} 张，Flow ${invalidFlowNodeIds.length} 处），已阻止云端保存，请重试上传后再保存`,
            `Found images not uploaded to OSS (Canvas ${invalidCanvasImageIds.length}, Flow ${invalidFlowNodeIds.length}); cloud save is blocked. Please upload and retry.`
          )
        );
        return;
      } else {
        setWarning(null);
      }

      setManualSaving(true);

      const result = await projectApi.saveContent(currentProjectId, { content: contentForCloudSave, version, createWorkflowHistory: true });

      markSaved(result.version, result.updatedAt ?? new Date().toISOString());

      try {
        saveMonitor.push(currentProjectId, 'manual_save_success', {
          version: result.version,
          updatedAt: result.updatedAt,
          paperJsonLen: content.meta?.paperJsonLen || content.paperJson?.length || 0,
          layerCount: content.layers.length || 0,
        });
        const paperJson = content.paperJson;
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
        ? lt('保存失败：内容过大，请尝试清理或拆分项目', 'Save failed: content is too large. Try cleaning or splitting the project')
        : (rawMessage || lt('保存失败', 'Save failed'));
      if (currentProjectId) {
        try {
          saveMonitor.push(currentProjectId, 'manual_save_error', { message });
        } catch {}
      }
      setError(message);
      console.error('手动保存失败:', error);
    } finally {
      setManualSaving(false);
    }
  }, [lt, markSaved, setError, setManualSaving, setWarning]);

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={!projectId || manualSaving}
      className="rounded border border-sky-500 bg-sky-50 px-2 py-1 text-xs text-sky-600 hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
    >
      {manualSaving ? lt('保存中…', 'Saving...') : lt('保存', 'Save')}
    </button>
  );
}
