import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useTranslation } from 'react-i18next';

function formatSavedTime(iso: string, locale?: string) {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function AutosaveStatus() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const locale = isZh ? 'zh-CN' : 'en-US';
  const lt = (zhText: string, enText: string) => (isZh ? zhText : enText);
  const saving = useProjectContentStore((state) => state.saving);
  const dirty = useProjectContentStore((state) => state.dirty);
  const lastSavedAt = useProjectContentStore((state) => state.lastSavedAt);
  const lastError = useProjectContentStore((state) => state.lastError);
  const lastWarning = useProjectContentStore((state) => state.lastWarning);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const [visibleLabel, setVisibleLabel] = useState<string>('\u00A0'); // 保留占位防止跳动

  const { label, className } = useMemo(() => {
    if (saving) {
      return { label: lt('保存中…', 'Saving...'), className: 'text-sky-600' };
    }
    if (lastError) {
      return { label: lt(`保存失败：${lastError}`, `Save failed: ${lastError}`), className: 'text-red-500' };
    }
    if (lastWarning) {
      return { label: lt(`提示：${lastWarning}`, `Notice: ${lastWarning}`), className: 'text-amber-700' };
    }
    if (dirty) {
      return { label: lt('有未保存更改', 'Unsaved changes'), className: 'text-amber-600' };
    }
    if (lastSavedAt) {
      return { label: lt(`已保存 ${formatSavedTime(lastSavedAt, locale)}`, `Saved ${formatSavedTime(lastSavedAt, locale)}`), className: 'text-emerald-600' };
    }
    return { label: '', className: '' };
  }, [dirty, lastError, lastSavedAt, lastWarning, locale, lt, saving]);

  useEffect(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (saving || dirty || lastError || lastWarning) {
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
  }, [saving, dirty, lastError, lastSavedAt, lastWarning, label]);

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
