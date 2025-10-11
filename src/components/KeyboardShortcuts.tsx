import { useEffect } from 'react';
import { projectApi } from '@/services/projectApi';
import { paperSaveService } from '@/services/paperSaveService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';

export default function KeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      // Ctrl/Cmd + S 保存
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        const storeBefore = useProjectContentStore.getState();
        if (!storeBefore.projectId || storeBefore.saving) return;
        try {
          await paperSaveService.saveImmediately();
          const store = useProjectContentStore.getState();
          const { projectId, content, version } = store;
          if (!projectId || !content) return;
          store.setSaving(true);
          const result = await projectApi.saveContent(projectId, { content, version });
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
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}

