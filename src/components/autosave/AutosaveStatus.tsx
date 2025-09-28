import { useMemo } from 'react';
import { useProjectContentStore } from '@/stores/projectContentStore';

function formatSavedTime(iso: string) {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function AutosaveStatus() {
  const saving = useProjectContentStore((state) => state.saving);
  const dirty = useProjectContentStore((state) => state.dirty);
  const lastSavedAt = useProjectContentStore((state) => state.lastSavedAt);
  const lastError = useProjectContentStore((state) => state.lastError);

  const { label, className } = useMemo(() => {
    if (saving) {
      return { label: '自动保存中…', className: 'text-sky-600' };
    }
    if (lastError) {
      return { label: `保存失败：${lastError}`, className: 'text-red-500' };
    }
    if (dirty) {
      return { label: '有未保存更改', className: 'text-amber-600' };
    }
    if (lastSavedAt) {
      return { label: `已保存 ${formatSavedTime(lastSavedAt)}`, className: 'text-emerald-600' };
    }
    return { label: '', className: '' };
  }, [saving, dirty, lastSavedAt, lastError]);

  if (!label) return null;

  return <span className={`text-xs ${className}`}>{label}</span>;
}
