import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const [visibleLabel, setVisibleLabel] = useState<string>('\u00A0'); // 保留占位防止跳动

  const { label, className } = useMemo(() => {
    if (saving) {
      return { label: '保存中…', className: 'text-sky-600' };
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

  useEffect(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (saving || dirty || lastError) {
      setVisible(true);
      return;
    }

    if (lastSavedAt) {
      if (label) {
        setVisibleLabel(label);
      }
      setVisible(true);
      hideTimerRef.current = window.setTimeout(() => setVisible(false), 5000);
      return;
    }

    setVisible(false);
  }, [saving, dirty, lastError, lastSavedAt, label]);

  useEffect(() => {
    if (label) {
      setVisibleLabel(label);
    }
  }, [label]);

  return (
    <span
      className={`text-xs transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'} ${className}`}
    >
      {visibleLabel}
    </span>
  );
}
