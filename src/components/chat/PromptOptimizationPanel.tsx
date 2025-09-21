import React, {
  useEffect,
  useMemo,
  useState,
  useImperativeHandle,
  useRef,
  useLayoutEffect
} from 'react';
import { Button } from '@/components/ui/button';
import usePromptOptimization from '@/hooks/usePromptOptimization';
import type { PromptOptimizationRequest } from '@/services/promptOptimizationService';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { createPortal } from 'react-dom';

export interface PromptOptimizationSettings {
  language: '中文' | 'English';
  tone: string;
  focus: string;
  lengthPreference: 'concise' | 'balanced' | 'detailed';
}

interface PromptOptimizationPanelProps {
  isOpen: boolean;
  currentInput: string;
  onApplyToInput: (optimized: string) => void;
  onSendOptimized: (optimized: string) => Promise<void>;
  settings: PromptOptimizationSettings;
  onSettingsChange: (settings: PromptOptimizationSettings) => void;
  autoOptimizeEnabled: boolean;
  anchorRef?: React.RefObject<HTMLElement>;
  containerRef?: React.RefObject<HTMLElement>;
}

const PromptOptimizationPanel = React.forwardRef<HTMLDivElement, PromptOptimizationPanelProps>((props, ref) => {
  const {
    isOpen,
    currentInput,
    onApplyToInput,
    onSendOptimized,
    settings,
    onSettingsChange,
    autoOptimizeEnabled,
    anchorRef,
    containerRef
  } = props;

  const { optimize, loading, result, error, reset } = usePromptOptimization();
  const [formError, setFormError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      reset();
      setFormError(null);
      setReady(false);
    }
  }, [isOpen, reset]);

  useImperativeHandle(ref, () => panelRef.current, [isOpen, position]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const anchorEl = anchorRef?.current;
      const containerEl = containerRef?.current;
      const panelEl = panelRef.current;
      if (!anchorEl || !panelEl) return;

      const anchorRect = anchorEl.getBoundingClientRect();
      const containerRect = containerEl?.getBoundingClientRect();
      const panelWidth = panelEl.offsetWidth;
      const panelHeight = panelEl.offsetHeight;
      const offset = 12;

      let top: number;
      if (containerRect) {
        top = containerRect.top - panelHeight - offset;
      } else {
        top = anchorRect.top - panelHeight - offset;
      }

      let left: number;
      if (containerRect) {
        left = containerRect.left + containerRect.width / 2 - panelWidth / 2;
      } else {
        left = anchorRect.right - panelWidth;
      }

      if (top < 12) {
        top = (containerRect ? containerRect.bottom : anchorRect.bottom) + offset;
      }

      const maxLeft = window.innerWidth - panelWidth - 12;
      if (left > maxLeft) {
        left = maxLeft;
      }
      if (left < 12) {
        left = 12;
      }

      setPosition({ top, left });
      setReady(true);
    };

    const frame = requestAnimationFrame(updatePosition);

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, anchorRef, containerRef, result]);

  const handleOptimize = async () => {
    const trimmed = currentInput.trim();
    if (!trimmed) {
      setFormError('请输入需要扩写的提示词');
      return;
    }
    setFormError(null);
    await optimize({
      input: trimmed,
      language: settings.language,
      tone: settings.tone || undefined,
      focus: settings.focus || undefined,
      lengthPreference: settings.lengthPreference
    } satisfies PromptOptimizationRequest);
  };

  const optimizedText = useMemo(() => result?.optimizedPrompt ?? '', [result]);

  const handleApply = () => {
    if (!optimizedText) return;
    onApplyToInput(optimizedText);
  };

  const handleSend = async () => {
    if (!optimizedText) return;
    await onSendOptimized(optimizedText);
  };

  const handleSettingsFieldChange = <K extends keyof PromptOptimizationSettings>(key: K, value: PromptOptimizationSettings[K]) => {
    onSettingsChange({
      ...settings,
      [key]: value
    });
  };

  if (!isOpen) {
    return null;
  }

  if (typeof document === 'undefined') {
    return null;
  }

  const panelNode = (
    <div
      ref={panelRef}
      className="w-[360px] rounded-2xl bg-white/95 backdrop-blur-md shadow-2xl border border-slate-200"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 9999,
        visibility: ready ? 'visible' : 'hidden'
      }}
    >
      <div className="px-4 pt-4 pb-3 space-y-4 text-sm text-slate-700">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs">
            <span className="text-slate-500">输出语言</span>
            <select
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={settings.language}
              onChange={(event) => handleSettingsFieldChange('language', event.target.value as PromptOptimizationSettings['language'])}
            >
              <option value="中文">中文</option>
              <option value="English">English</option>
            </select>
          </label>

          <label className="space-y-1 text-xs">
            <span className="text-slate-500">长度倾向</span>
            <select
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={settings.lengthPreference}
              onChange={(event) => handleSettingsFieldChange('lengthPreference', event.target.value as PromptOptimizationSettings['lengthPreference'])}
            >
              <option value="concise">简洁</option>
              <option value="balanced">均衡</option>
              <option value="detailed">细节丰富</option>
            </select>
          </label>

          <label className="col-span-2 space-y-1 text-xs">
            <span className="text-slate-500">语气 / 风格</span>
            <input
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="例如：沉浸式、叙事感强"
              value={settings.tone}
              onChange={(event) => handleSettingsFieldChange('tone', event.target.value)}
            />
          </label>

          <label className="col-span-2 space-y-1 text-xs">
            <span className="text-slate-500">重点补充方向</span>
            <input
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="例如：目标受众、光影、镜头语言"
              value={settings.focus}
              onChange={(event) => handleSettingsFieldChange('focus', event.target.value)}
            />
          </label>
        </div>

        {formError && (
          <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
            {formError}
          </div>
        )}

        {error && (
          <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
            {error.message}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>扩写预览</span>
            {autoOptimizeEnabled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 text-sky-600 px-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
                自动扩写开启
              </span>
            )}
          </div>
          <div className="relative">
            <Textarea
              readOnly
              value={loading ? '' : optimizedText}
              className="min-h-[120px] resize-none bg-slate-50/70 border border-slate-200 text-sm text-slate-700"
              placeholder={loading ? '' : '生成预览后将在此处展示扩写结果'}
            />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-md">
                <LoadingSpinner size="md" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-slate-600 hover:text-slate-800"
          onClick={handleOptimize}
          disabled={loading}
        >
          {loading ? '生成中...' : '生成扩写'}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleApply}
            disabled={!optimizedText || loading}
          >
            回填输入框
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!optimizedText || loading}
          >
            应用并生成
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(panelNode, document.body);
});

PromptOptimizationPanel.displayName = 'PromptOptimizationPanel';

export default PromptOptimizationPanel;
