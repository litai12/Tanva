import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Trash2, Loader2, Copy, RefreshCw, Sparkles, Terminal, X, MousePointer2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useUIStore, useSandboxStore } from '@/stores';
import { paperSandboxService } from '@/services/paperSandboxService';

const CodeEditor: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  disabled?: boolean;
}> = ({ value, onChange, onRun, disabled }) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onRun?.();
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.max(280, textarea.scrollHeight) + 'px';
    };
    resize();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      spellCheck={false}
      className="w-full min-h-[320px] flex-1 rounded-lg border border-slate-700 bg-slate-950/90 p-3 font-mono text-sm text-slate-100 shadow-inner focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      placeholder="// 输入 Paper.js 代码，Cmd/Ctrl + Enter 立即运行"
    />
  );
};

const LogEntry: React.FC<{
  type: 'info' | 'success' | 'error';
  message: string;
  timestamp: number;
}> = ({ type, message, timestamp }) => {
  const date = useMemo(() => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
  }, [timestamp]);

  const color =
    type === 'success' ? 'text-emerald-300' : type === 'error' ? 'text-rose-300' : 'text-slate-300';

  return (
    <div className="flex flex-col gap-0.5 rounded border border-slate-800 bg-slate-950/70 p-2">
      <div className="flex justify-between text-[10px] uppercase text-slate-500">
        <span>{date}</span>
        <span className={cn('font-semibold tracking-wide', color)}>
          {type === 'success' ? 'SUCCESS' : type === 'error' ? 'ERROR' : 'INFO'}
        </span>
      </div>
      <div className={cn('text-xs leading-relaxed', color)}>{message}</div>
    </div>
  );
};

const CodeSandboxPanel: React.FC = () => {
  const { showSandboxPanel, toggleSandboxPanel } = useUIStore();
  const {
    code,
    setCode,
    autoRun,
    setAutoRun,
    autoRunDelay,
    logs,
    addLog,
    clearLogs,
    isExecuting,
    setExecuting,
    reset,
  } = useSandboxStore();
  const [paperReady, setPaperReady] = useState(() => paperSandboxService.isReady());
  const [copyHint, setCopyHint] = useState<'idle' | 'copied'>('idle');
  const examples = useMemo(() => Object.entries(paperSandboxService.getCodeExamples()), []);

  const runCode = useCallback(
    (payload?: string) => {
      const source = typeof payload === 'string' ? payload : code;
      if (!source.trim()) {
        addLog({ type: 'info', message: '请输入代码后再运行' });
        return;
      }
      if (!paperSandboxService.isReady()) {
        addLog({ type: 'error', message: 'Paper.js 画布尚未就绪，请稍后再试' });
        return;
      }
      setExecuting(true);
      addLog({ type: 'info', message: '开始执行代码...' });
      const result = paperSandboxService.executeCode(source);
      if (result.success) {
        const duration = result.durationMs ? `（${result.durationMs} ms）` : '';
        addLog({
          type: 'success',
          message: result.message ? `${result.message}${duration}` : `执行完成${duration}`,
        });
      } else {
        addLog({ type: 'error', message: result.error || '执行失败' });
      }
      setExecuting(false);
    },
    [code, addLog, setExecuting]
  );

  const handleClearSandbox = () => {
    paperSandboxService.clearCanvas();
    addLog({ type: 'info', message: '沙盒图层已清空' });
  };

  const handleApplyToCanvas = () => {
    const result = paperSandboxService.applyOutputToActiveLayer();
    if (result.success) {
      addLog({
        type: 'success',
        message: result.message || '已将沙盒图形应用到当前图层，可直接编辑/移动/复制',
      });
    } else {
      addLog({ type: 'error', message: result.error || '应用到画布失败' });
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyHint('copied');
      addLog({ type: 'success', message: '代码已复制到剪贴板' });
      setTimeout(() => setCopyHint('idle'), 1800);
    } catch (error) {
      addLog({
        type: 'error',
        message: error instanceof Error ? error.message : '复制失败',
      });
    }
  };

  const handleLoadExample = (label: string, snippet: string) => {
    setCode(snippet);
    addLog({ type: 'info', message: `已载入示例「${label}」` });
  };

  useEffect(() => {
    const handleReady = () => setPaperReady(true);
    window.addEventListener('paper-ready', handleReady);
    return () => window.removeEventListener('paper-ready', handleReady);
  }, []);

  useEffect(() => {
    if (!showSandboxPanel || !autoRun) return;
    if (!code.trim()) return;
    if (isExecuting) return;
    const timer = window.setTimeout(() => {
      runCode();
    }, autoRunDelay);
    return () => window.clearTimeout(timer);
  }, [autoRun, autoRunDelay, code, isExecuting, runCode, showSandboxPanel]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if (!showSandboxPanel) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        runCode();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        toggleSandboxPanel();
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [runCode, showSandboxPanel, toggleSandboxPanel]);

  if (!showSandboxPanel) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 z-[1090] bg-slate-900/50 backdrop-blur-sm" onClick={toggleSandboxPanel} />
      <div className="fixed right-6 top-16 bottom-10 z-[1100] flex w-[min(1100px,_calc(100%-3rem))] flex-col rounded-2xl border border-slate-700/70 bg-slate-900/95 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-slate-800/80 px-5 py-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">Paper.js 沙盒工作台</h2>
              <Badge variant={paperReady ? 'default' : 'secondary'} className={paperReady ? 'bg-emerald-600/80' : 'bg-amber-500/80'}>
                {paperReady ? '已连接画布' : '等待画布...'}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">在右侧画布实时试验 Paper.js 代码，满意后点击“应用到画布”即可获得完整的编辑、移动和复制能力</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>自动运行</span>
              <Switch checked={autoRun} onCheckedChange={(checked) => setAutoRun(Boolean(checked))} />
            </div>
            <Button variant="ghost" size="icon" onClick={toggleSandboxPanel} className="text-slate-200 hover:text-white">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Cmd/Ctrl + Enter 运行</span>
            <span>•</span>
            <span>Esc 关闭面板</span>
            <span>•</span>
            <span>自动运行延迟 {autoRunDelay}ms</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => runCode()} disabled={isExecuting} className="gap-2">
              {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isExecuting ? '执行中...' : '运行代码'}
            </Button>
            <Button variant="outline" onClick={handleClearSandbox} className="gap-2">
              <Trash2 className="h-4 w-4" />
              清空沙盒
            </Button>
            <Button variant="outline" onClick={handleApplyToCanvas} className="gap-2">
              <MousePointer2 className="h-4 w-4" />
              应用到画布
            </Button>
            <Button variant="outline" onClick={handleCopyCode} className="gap-2">
              <Copy className="h-4 w-4" />
              {copyHint === 'copied' ? '已复制' : '复制代码'}
            </Button>
            <Button variant="outline" onClick={() => { reset(); addLog({ type: 'info', message: '已恢复默认示例' }); }} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              重置
            </Button>
          </div>
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden px-5 pb-5">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <CodeEditor value={code} disabled={isExecuting} onChange={setCode} onRun={runCode} />
          </div>

          <div className="flex w-72 min-w-[260px] flex-col gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
                <Sparkles className="h-4 w-4 text-amber-300" />
                示例片段
              </div>
              <div className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
                {examples.map(([label, snippet]) => (
                  <button
                    key={label}
                    onClick={() => handleLoadExample(label, snippet)}
                    className="rounded border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-left text-xs text-slate-200 transition hover:border-sky-500 hover:bg-slate-900/90"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-1 flex-col rounded-xl border border-slate-800 bg-slate-950/80 p-3">
              <div className="mb-2 flex items-center justify-between text-sm font-medium text-white">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-sky-300" />
                  执行日志
                </div>
                <button onClick={clearLogs} className="text-xs text-slate-400 transition hover:text-white">
                  清空
                </button>
              </div>
              <div className="flex-1 overflow-y-auto pr-1">
                {logs.length === 0 ? (
                  <div className="rounded border border-dashed border-slate-800/80 px-3 py-5 text-center text-xs text-slate-500">
                    尚无日志，运行代码后查看输出
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {logs.map((entry) => (
                      <LogEntry key={entry.id} type={entry.type} message={entry.message} timestamp={entry.timestamp} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CodeSandboxPanel;
