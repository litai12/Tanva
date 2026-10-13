import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Keyboard, Pencil, RotateCcw, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useShortcutStore } from '@/stores/shortcutStore';
import {
  SHORTCUT_ACTIONS,
  formatShortcut,
  getEffectiveBindings,
  normalizeShortcut,
  type ShortcutActionId,
} from '@/utils/keyboardShortcuts';

const CATEGORIES = ['general', 'canvas', 'flow'] as const;
const PREFIX = 'workspace.settings.shortcutsTab';

export default function ShortcutSettings() {
  const { t, i18n } = useTranslation();
  const overrides = useShortcutStore((state) => state.overrides);
  const recordingActionId = useShortcutStore((state) => state.recordingActionId);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<{ id: ShortcutActionId; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const recorderRefs = useRef(new Map<ShortcutActionId, HTMLButtonElement>());
  const isEnglish = i18n.resolvedLanguage?.startsWith('en');
  const labelFor = (action: (typeof SHORTCUT_ACTIONS)[number]) =>
    t(`${PREFIX}.actions.${action.id}`, { defaultValue: isEnglish ? action.labelEn : action.labelZh });

  useEffect(() => () => useShortcutStore.getState().setRecordingActionId(null), []);

  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(() => setSaved(false), 2400);
    return () => window.clearTimeout(timeout);
  }, [saved, overrides]);

  useEffect(() => {
    if (!recordingActionId) return;
    const stopRecording = () => {
      useShortcutStore.getState().setRecordingActionId(null);
      setDraft('');
    };
    const captureKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        stopRecording();
        setFeedback(null);
        return;
      }
      if (event.repeat || event.isComposing) return;
      const binding = normalizeShortcut(event);
      if (!binding) {
        setDraft([
          event.metaKey || event.ctrlKey ? 'Mod' : '',
          event.altKey ? 'Alt' : '',
          event.shiftKey ? 'Shift' : '',
        ].filter(Boolean).join('+'));
        return;
      }
      setDraft(binding);
      const result = useShortcutStore.getState().setBinding(recordingActionId, binding);
      if (!result.ok) {
        setFeedback({
          id: recordingActionId,
          message: result.conflict
            ? t(`${PREFIX}.conflict`, {
                action: t(`${PREFIX}.actions.${result.conflict.id}`, {
                  defaultValue: isEnglish ? result.conflict.labelEn : result.conflict.labelZh,
                }),
              })
            : t(`${PREFIX}.invalid`),
        });
        return;
      }
      stopRecording();
      setFeedback(null);
      setSaved(true);
    };
    const captureKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (useShortcutStore.getState().recordingActionId) setDraft('');
    };
    const cancelOnBlur = () => {
      stopRecording();
      setFeedback(null);
    };
    // Capture before document/canvas handlers so recording cannot execute an action.
    window.addEventListener('keydown', captureKey, true);
    window.addEventListener('keyup', captureKeyUp, true);
    window.addEventListener('blur', cancelOnBlur);
    recorderRefs.current.get(recordingActionId)?.focus();
    return () => {
      window.removeEventListener('keydown', captureKey, true);
      window.removeEventListener('keyup', captureKeyUp, true);
      window.removeEventListener('blur', cancelOnBlur);
    };
  }, [recordingActionId, t, isEnglish]);

  const filteredActions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return SHORTCUT_ACTIONS.filter((action) => !needle || [
      t(`${PREFIX}.actions.${action.id}`, { defaultValue: isEnglish ? action.labelEn : action.labelZh }),
      t(`${PREFIX}.groups.${action.category}`),
      ...getEffectiveBindings(action.id, overrides).map((binding) => formatShortcut(binding)),
    ].join(' ').toLocaleLowerCase().includes(needle));
  }, [query, overrides, t, isEnglish]);

  const cancelRecording = () => {
    useShortcutStore.getState().setRecordingActionId(null);
    setDraft('');
    setFeedback(null);
  };

  return (
    <div className='space-y-5 pb-6' data-shortcut-settings-panel>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0 flex-1'>
          <div className='mb-2 flex items-center gap-2'>
            <Keyboard className='h-5 w-5 text-slate-600 dark:text-slate-300' />
            <h2 className='text-lg font-semibold text-slate-800 dark:text-slate-100'>{t(`${PREFIX}.title`)}</h2>
          </div>
          <p className='max-w-lg text-xs leading-5 text-slate-500 dark:text-slate-400'>{t(`${PREFIX}.description`)}</p>
        </div>
        <button
          type='button'
          className='inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
          onClick={() => {
            cancelRecording();
            useShortcutStore.getState().resetAll();
            setSaved(true);
          }}
        >
          <RotateCcw className='h-3.5 w-3.5' />
          {t(`${PREFIX}.resetAll`)}
        </button>
      </div>

      <div className='flex min-h-5 items-center gap-1.5 text-xs text-slate-500' role='status' aria-live='polite'>
        <Check className={cn('h-3.5 w-3.5', saved ? 'text-emerald-500' : 'text-slate-400')} />
        {t(`${PREFIX}.${saved ? 'saved' : 'localOnly'}`)}
      </div>

      <label className='relative block'>
        <Search className='pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
        <input
          type='search'
          value={query}
          onChange={(event) => { cancelRecording(); setQuery(event.target.value); }}
          onFocus={cancelRecording}
          aria-label={t(`${PREFIX}.search`)}
          placeholder={t(`${PREFIX}.search`)}
          className='h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
        />
      </label>

      {CATEGORIES.map((category) => {
        const actions = filteredActions.filter((action) => action.category === category);
        if (!actions.length) return null;
        return (
          <section key={category} aria-label={t(`${PREFIX}.groups.${category}`)}>
            <h3 className='mb-2 px-1 text-xs font-medium text-slate-500 dark:text-slate-400'>{t(`${PREFIX}.groups.${category}`)}</h3>
            <div className='overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/90'>
              {actions.map((action) => {
                const bindings = getEffectiveBindings(action.id, overrides);
                const isRecording = recordingActionId === action.id;
                const isCustomized = Object.prototype.hasOwnProperty.call(overrides, action.id);
                const error = feedback?.id === action.id ? feedback.message : null;
                const label = labelFor(action);
                return (
                  <div key={action.id} data-shortcut-action={action.id} className='border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-700'>
                    <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
                      <div className='min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200'>
                        {label}
                        {isCustomized && <span className='ml-2 text-[10px] text-slate-400'>{t(`${PREFIX}.customized`)}</span>}
                      </div>
                      <div className='flex shrink-0 items-center gap-1'>
                        <button
                          type='button'
                          ref={(element) => {
                            if (element) recorderRefs.current.set(action.id, element);
                            else recorderRefs.current.delete(action.id);
                          }}
                          data-shortcut-recorder={isRecording ? 'true' : undefined}
                          aria-label={t(`${PREFIX}.editAction`, { action: label })}
                          title={t(`${PREFIX}.editAction`, { action: label })}
                          aria-pressed={isRecording}
                          onClick={() => {
                            setFeedback(null);
                            setDraft('');
                            useShortcutStore.getState().setRecordingActionId(isRecording ? null : action.id);
                          }}
                          className={cn(
                            'inline-flex min-h-9 min-w-[148px] max-w-[260px] items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                            isRecording
                              ? 'border-blue-400 bg-blue-50 text-blue-600 ring-2 ring-blue-500/15 dark:bg-blue-950/30 dark:text-blue-300'
                              : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300',
                          )}
                        >
                          {isRecording ? (
                            <span>{draft ? formatShortcut(draft) : t(`${PREFIX}.recording`)}</span>
                          ) : bindings.length ? (
                            <span className='flex flex-wrap items-center justify-center gap-1.5'>
                              {bindings.map((binding, index) => (
                                <span key={binding} className='inline-flex items-center gap-1.5'>
                                  {index > 0 && <span className='text-slate-400'>/</span>}
                                  <kbd className='font-sans'>{formatShortcut(binding)}</kbd>
                                </span>
                              ))}
                            </span>
                          ) : <span className='text-slate-400'>{t(`${PREFIX}.unassigned`)}</span>}
                          {!isRecording && <Pencil className='h-3 w-3 shrink-0 opacity-50' />}
                        </button>
                        <button
                          type='button'
                          disabled={!bindings.length && !isRecording}
                          aria-label={t(`${PREFIX}.clearAction`, { action: label })}
                          title={t(`${PREFIX}.clearAction`, { action: label })}
                          onClick={() => {
                            cancelRecording();
                            useShortcutStore.getState().clearBinding(action.id);
                            setSaved(true);
                          }}
                          className='rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default disabled:opacity-25 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                        ><X className='h-3.5 w-3.5' /></button>
                        <button
                          type='button'
                          disabled={!isCustomized}
                          aria-label={t(`${PREFIX}.resetAction`, { action: label })}
                          title={t(`${PREFIX}.resetAction`, { action: label })}
                          onClick={() => {
                            cancelRecording();
                            const result = useShortcutStore.getState().resetBinding(action.id);
                            if (!result.ok && result.conflict) {
                              setFeedback({ id: action.id, message: t(`${PREFIX}.conflict`, { action: labelFor(result.conflict) }) });
                            } else setSaved(true);
                          }}
                          className='rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default disabled:opacity-25 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                        ><RotateCcw className='h-3.5 w-3.5' /></button>
                      </div>
                    </div>
                    {(isRecording || error) && (
                      <p className={cn('mt-2 text-xs leading-5', error ? 'text-red-500' : 'text-blue-500')} role={error ? 'alert' : 'status'}>
                        {error || t(`${PREFIX}.recordingHint`)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {!filteredActions.length && <p className='py-8 text-center text-sm text-slate-400'>{t(`${PREFIX}.noResults`)}</p>}
      <p className='px-1 text-xs leading-5 text-slate-400'>{t(`${PREFIX}.systemHint`)}</p>
    </div>
  );
}
