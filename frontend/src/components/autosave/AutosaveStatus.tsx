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

// dirty 持续超过该时长仍未落云端,状态条升级为醒目红色警告(覆盖保存被阻断/持续失败被忽视的场景)。
const STALL_ALERT_MS = 3 * 60 * 1000;
const STALL_TICK_MS = 30 * 1000;

export default function AutosaveStatus() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const locale = isZh ? 'zh-CN' : 'en-US';
  const lt = (zhText: string, enText: string) => (isZh ? zhText : enText);
  const saving = useProjectContentStore((state) => state.saving);
  const dirty = useProjectContentStore((state) => state.dirty);
  const dirtySince = useProjectContentStore((state) => state.dirtySince);
  const lastSavedAt = useProjectContentStore((state) => state.lastSavedAt);
  const lastError = useProjectContentStore((state) => state.lastError);
  const lastWarning = useProjectContentStore((state) => state.lastWarning);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const [visibleLabel, setVisibleLabel] = useState<string>('\u00A0'); // 保留占位防止跳动

  const [nowTick, setNowTick] = useState(() => Date.now());

  // dirty 期间低频刷新当前时间,驱动「已 X 分钟未保存」的停滞判定与文案。
  useEffect(() => {
    if (!dirty || !dirtySince) return undefined;
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), STALL_TICK_MS);
    return () => window.clearInterval(timer);
  }, [dirty, dirtySince]);

  const stalledMinutes = dirty && dirtySince && nowTick - dirtySince >= STALL_ALERT_MS
    ? Math.floor((nowTick - dirtySince) / 60000)
    : 0;

  const { label, className } = useMemo(() => {
    if (stalledMinutes > 0 && !saving) {
      // 长时间未落云端:无论卡在哪个环节(保存被阻断/持续失败/一直没触发),都必须显性告警。
      const reason = lastWarning || lastError;
      return {
        label: lt(
          `⚠ 内容已 ${stalledMinutes} 分钟未保存到云端${reason ? `：${reason}` : '，请手动保存(Ctrl+S)或检查网络'}`,
          `⚠ Unsaved to cloud for ${stalledMinutes} min${reason ? `: ${reason}` : '. Save manually (Ctrl+S) or check your network'}`,
        ),
        className: 'text-red-600 font-medium bg-red-50 border border-red-200 rounded px-2 py-0.5',
      };
    }
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
  }, [dirty, lastError, lastSavedAt, lastWarning, locale, lt, saving, stalledMinutes]);

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
