import { useEffect } from 'react';
import { projectApi } from '@/services/projectApi';
import { paperSaveService } from '@/services/paperSaveService';
import { flowSaveService } from '@/services/flowSaveService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';
import { historyService } from '@/services/historyService';
import { getNonRemoteImageAssetIds, getNonPersistableFlowImageNodeIds } from '@/utils/projectContentValidation';

export default function KeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      const active = document.activeElement as Element | null;
      const isEditable = !!active && ((active.tagName?.toLowerCase() === 'input') || (active.tagName?.toLowerCase() === 'textarea') || (active as any).isContentEditable);

      // Undo / Redo
      if (!isEditable && (e.ctrlKey || e.metaKey)) {
        // Redo: Ctrl+Y or Shift+Ctrl+Z
        if ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          await historyService.redo();
          return;
        }
        // Undo: Ctrl+Z
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          await historyService.undo();
          return;
        }
      }
      // Ctrl/Cmd + S 保存
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        const storeBefore = useProjectContentStore.getState();
        if (!storeBefore.projectId || storeBefore.saving) return;
        try {
          await paperSaveService.saveImmediately();
          await flowSaveService.flushImageSplitInputImages();
          const store = useProjectContentStore.getState();
          const { projectId, content, version } = store;
          if (!projectId || !content) return;
          const invalidCanvasImageIds = getNonRemoteImageAssetIds(content);
          const invalidFlowNodeIds = getNonPersistableFlowImageNodeIds(content);
          if (invalidCanvasImageIds.length > 0 || invalidFlowNodeIds.length > 0) {
            try {
              useProjectContentStore
                .getState()
                .setError(
                  `存在未上传到 OSS 的图片（画布 ${invalidCanvasImageIds.length} 张，Flow ${invalidFlowNodeIds.length} 处），上传完成前无法保存`
                );
            } catch {}
            return;
          }
          store.setSaving(true);
          const result = await projectApi.saveContent(projectId, { content, version, createWorkflowHistory: true });
          store.markSaved(result.version, result.updatedAt ?? new Date().toISOString());
          try {
            saveMonitor.push(projectId, 'kb_save_success', {
              version: result.version,
              updatedAt: result.updatedAt,
              paperJsonLen: (content as any)?.meta?.paperJsonLen || (content as any)?.paperJson?.length || 0,
              layerCount: (content as any)?.layers?.length || 0,
            });
          } catch {}
        } catch (err: any) {
          const raw = err?.message || '';
          const msg = raw.includes('413') || raw.toLowerCase().includes('too large')
            ? '保存失败：内容过大，请尝试清理或拆分项目'
            : (raw || '保存失败');
          try { useProjectContentStore.getState().setError(msg); } catch {}
        } finally {
          const store = useProjectContentStore.getState();
          if (store.projectId === storeBefore.projectId) {
            store.setSaving(false);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    historyService.captureInitialIfEmpty().catch(() => {});
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
