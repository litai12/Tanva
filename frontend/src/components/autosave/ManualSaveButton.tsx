import { useCallback } from 'react';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useTranslation } from 'react-i18next';
import { performManualSave } from '@/services/manualSaveService';

export default function ManualSaveButton() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);
  const projectId = useProjectContentStore((state) => state.projectId);
  const manualSaving = useProjectContentStore((state) => state.manualSaving);
  const cacheValidationPending = useProjectContentStore((state) => state.cacheValidationPending);
  const staleContent = useProjectContentStore((state) => state.staleContent);

  // 保存语义统一在 manualSaveService，Ctrl+S 与此按钮共用，不要在这里复制一份。
  const handleSave = useCallback(() => {
    void performManualSave({ origin: 'button', lt });
  }, [lt]);

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={!projectId || manualSaving || cacheValidationPending || staleContent}
      className="rounded border border-sky-500 bg-sky-50 px-2 py-1 text-xs text-sky-600 hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
    >
      {manualSaving ? lt('保存中…', 'Saving...') : lt('保存', 'Save')}
    </button>
  );
}
