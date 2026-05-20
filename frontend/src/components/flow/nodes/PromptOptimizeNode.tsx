import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';
import { Check } from 'lucide-react';
// no Button/Textarea components needed here
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import usePromptOptimization from '@/hooks/usePromptOptimization';
import type { PromptOptimizationRequest } from '@/services/promptOptimizationService';
import { useAIChatStore, getTextModelForProvider } from '@/stores/aiChatStore';
import { resolveFlowModelProvider, type FlowModelProvider } from '@/utils/flowModelProvider';
import { resolveTextFromSourceNode } from '../utils/textSource';
import { usePromptSiblingImages } from '../hooks/usePromptSiblingImages';
import PromptImageStrip from './PromptImageStrip';
import { useLocaleText } from '@/utils/localeText';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import RunCreditBadge from './RunCreditBadge';
import { useBackendCreditsPreview } from '../hooks/useBackendCreditsPreview';

// 已去除可视化设置面板，采用内部默认参数
type Props = {
  id: string;
  data: {
    text?: string;
    expandedText?: string;
    boxW?: number;
    boxH?: number;
    modelProvider?: FlowModelProvider;
    creditsPerCall?: number;
  };
  selected?: boolean;
};

type FlowUpdatePatch = Record<string, unknown>;

function PromptOptimizeNodeInner({ id, data, selected }: Props) {
  const { lt, isZh } = useLocaleText();
  const rf = useReactFlow();
  const [upstreamText, setUpstreamText] = React.useState<string>('');
  const [hover, setHover] = React.useState<string | null>(null);
  const [expandedText, setExpandedText] = React.useState<string>(data.expandedText || '');
  const isComposingRef = React.useRef(false);
  const expandedTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const siblingImages = usePromptSiblingImages(id);
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : 'none';

  const { optimize, loading, result, error, reset } = usePromptOptimization();
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const effectiveProvider = React.useMemo<FlowModelProvider>(
    () => resolveFlowModelProvider(data.modelProvider, aiProvider),
    [aiProvider, data.modelProvider]
  );
  const providerToggleOptions = React.useMemo<Array<{
    value: FlowModelProvider;
    label: string;
    description: string;
  }>>(
    () => [
      {
        value: 'banana-2.5',
        label: 'Fast',
        description: lt('Nano Banana/Gemini 2.5', 'Nano Banana/Gemini 2.5'),
      },
      {
        value: 'banana',
        label: 'Pro',
        description: lt('Nano Banana Pro/Gemini 3 Pro', 'Nano Banana Pro/Gemini 3 Pro'),
      },
      {
        value: 'banana-3.1',
        label: 'Ultra',
        description: lt('Nano Banana 2/Gemini 3.1', 'Nano Banana 2/Gemini 3.1'),
      },
    ],
    [lt]
  );
  const currentProviderValue = effectiveProvider;
  const currentProviderOption = React.useMemo(
    () =>
      providerToggleOptions.find((option) => option.value === currentProviderValue) ??
      providerToggleOptions[1],
    [currentProviderValue, providerToggleOptions]
  );
  const textModel = React.useMemo(
    () => getTextModelForProvider(effectiveProvider),
    [effectiveProvider]
  );
  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: 'gemini-prompt-optimize',
    model: textModel,
    requestParams: {
      aiProvider: effectiveProvider,
      channelHint: bananaImageRoute === 'stable' ? 'tencent' : 'apimart',
    },
    enabled: true,
  });
  const resolvedRunCredits = backendCredits ?? data.creditsPerCall;

  const readUpstreamText = React.useCallback((optimisticSource?: {
    sourceId: string;
    patch: FlowUpdatePatch;
  } | null) => {
    try {
      const edges = rf.getEdges();
      const incoming = edges.find(e => e.target === id && e.targetHandle === 'text');
      if (incoming?.source) {
        const src = rf.getNode(incoming.source);
        const sourceForRead = src && optimisticSource?.sourceId === incoming.source
          ? {
              ...src,
              data: { ...(src.data as FlowUpdatePatch), ...optimisticSource.patch },
            }
          : src;
        const value = resolveTextFromSourceNode(sourceForRead, incoming.sourceHandle);
        return value?.trim() || '';
      }
    } catch {}
    return '';
  }, [id, rf]);

  // 初始化时尝试读取上游文本
  React.useEffect(() => {
    setUpstreamText(readUpstreamText());
  }, [readUpstreamText]);

  const updateNodeData = React.useCallback((patch: FlowUpdatePatch) => {
    const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch } });
    window.dispatchEvent(ev);
  }, [id]);

  const commitExpandedText = React.useCallback((value: string) => {
    updateNodeData({ expandedText: value, text: value });
  }, [updateNodeData]);

  React.useEffect(() => {
    if (isComposingRef.current) return;
    const next = data.expandedText || '';
    setExpandedText((prev) => (prev === next ? prev : next));
  }, [data.expandedText]);

  React.useEffect(() => {
    if (result?.optimizedPrompt) {
      setExpandedText(result.optimizedPrompt);
      commitExpandedText(result.optimizedPrompt);
    }
  }, [commitExpandedText, result]);

  const handleInsert = React.useCallback((text: string) => {
    if (isComposingRef.current) return;
    const el = expandedTextareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = expandedText.slice(0, start) + text + expandedText.slice(end);
    setExpandedText(next);
    commitExpandedText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }, [commitExpandedText, expandedText]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const native = (event as React.SyntheticEvent<unknown, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    native.stopImmediatePropagation?.();
  }, []);

  React.useEffect(() => {
    if (
      typeof data.modelProvider === 'string' &&
      data.modelProvider.trim().length > 0
    ) {
      return;
    }
    updateNodeData({ modelProvider: effectiveProvider });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.modelProvider, effectiveProvider, id]);

  // 监听上游输入节点文本变化
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; patch: FlowUpdatePatch }>).detail;
      if (!detail?.id) return;
      try {
        const edges = rf.getEdges();
        const incoming = edges.find(ed => ed.target === id && ed.targetHandle === 'text');
        if (!incoming || incoming.source !== detail.id) return;
        if (detail.patch && typeof detail.patch === 'object') {
          setUpstreamText(readUpstreamText({ sourceId: detail.id, patch: detail.patch }));
          return;
        }
        window.setTimeout(() => setUpstreamText(readUpstreamText()), 0);
      } catch {}
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [rf, id, readUpstreamText]);

  // 已移除设置面板，无需处理设置变更

  const handleOptimize = React.useCallback(async (inputText?: string) => {
    let text = inputText || readUpstreamText() || upstreamText.trim();
    // 再次兜底：使用当前预览/编辑内容
    if (!text && expandedText?.trim()) text = expandedText.trim();
    if (!text) return;

    reset();
    await optimize({
      input: text,
      language: isZh ? '中文' : 'English',
      tone: undefined,
      focus: undefined,
      lengthPreference: 'balanced',
      aiProvider: effectiveProvider,
      model: textModel,
      providerOptions: {
        banana: {
          imageRoute: bananaImageRoute,
        },
        bananaImageRoute,
      }
    } satisfies PromptOptimizationRequest);
  }, [
    bananaImageRoute,
    effectiveProvider,
    expandedText,
    isZh,
    optimize,
    readUpstreamText,
    reset,
    textModel,
    upstreamText,
  ]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>
      ).detail;
      if (!detail || detail.id !== id) return;
      void (async () => {
        try {
          await handleOptimize();
          detail.done?.(true);
        } catch {
          detail.done?.(false);
        }
      })();
    };
    window.addEventListener('flow:run-node', handler as EventListener);
    return () =>
      window.removeEventListener('flow:run-node', handler as EventListener);
  }, [id, handleOptimize]);

  // 不需要中间激活按钮；Run 后即写入 expandedText 与 text

  const handlePreviewChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const nativeEvent = event.nativeEvent as InputEvent & { isComposing?: boolean };
    setExpandedText(value);
    if (!isComposingRef.current && !nativeEvent.isComposing) {
      commitExpandedText(value);
    }
  }, [commitExpandedText]);

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = React.useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    const value = event.currentTarget.value;
    setExpandedText(value);
    commitExpandedText(value);
  }, [commitExpandedText]);

  return (
    <div style={{
      width: data.boxW || 360,
      height: data.boxH || 300,
      padding: 12,
      background: '#fff',
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      boxShadow,
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <NodeResizer
        isVisible
        minWidth={300}
        minHeight={220}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0 }}
        onResize={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } } : n));
        }}
        onResizeEnd={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } } : n));
        }}
      />

      {/* 标题栏（英文标题，其它中文） */}
      <div style={{ 
        fontWeight: 600, 
        marginBottom: 12, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Prompt Optimizer</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onPointerDownCapture={stopNodeDrag}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                className='nodrag nopan tanva-flow-provider-mode-badge'
                title={lt('切换模型模式', 'Switch model mode')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1px 8px',
                  borderRadius: 50,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color:
                    currentProviderValue === 'banana-3.1'
                      ? '#0f172a'
                      : '#475569',
                  background:
                    currentProviderValue === 'banana-3.1'
                      ? '#e2e8f0'
                      : '#f1f5f9',
                  border: '1px solid #e2e8f0',
                }}
              >
                {currentProviderOption.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side='bottom'
              sideOffset={8}
              className='min-w-[200px] rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur-md'
            >
              <DropdownMenuLabel className='px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400'>
                {lt('模型切换', 'Model switch')}
              </DropdownMenuLabel>
              {providerToggleOptions.map((option) => {
                const isActive = currentProviderValue === option.value;
                return (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (currentProviderValue !== option.value) {
                        updateNodeData({ modelProvider: option.value });
                      }
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                      isActive ? 'bg-gray-100 text-gray-800' : 'text-slate-600'
                    }`}
                  >
                    <div className='flex-1 space-y-0.5'>
                      <div className='font-medium leading-none'>{option.label}</div>
                      <div className='text-[11px] leading-snug text-slate-400'>{option.description}</div>
                    </div>
                    {isActive && <Check className='h-3.5 w-3.5 text-slate-700' />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => handleOptimize()}
            disabled={loading}
            className='run-btn-with-credit'
            title={
              loading
                ? 'Generating...'
                : resolvedRunCredits
                ? `${lt('Cost', 'Cost')}: ${resolvedRunCredits} ${lt('credits', 'credits')}`
                : lt('Run optimization', 'Run optimization')
            }
            style={{
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              minHeight: 30,
              padding: '0 10px',
              background: loading ? '#e5e7eb' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              gap: 6,
            }}
          >
            {loading ? (
              <span className='run-text-trigger'>{lt('Generating...', 'Generating...')}</span>
            ) : (
              <>
                <span className='run-text-trigger'>Run</span>
                <RunCreditBadge credits={resolvedRunCredits} runButton />
              </>
            )}
          </button>
        </div>
      </div>
      {/* 省略输入面板，文本从上游连线进入 */}

      {/* 已移除详细设置，仅保留关键运行与预览部分 */}

      {/* 预览输出 */}
      <div style={{ marginBottom: 12, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' }}>{lt('优化预览', 'Optimized preview')}</label>
        <div style={{ position: 'relative', flex: 1 }}>
          <textarea
            ref={expandedTextareaRef}
            className="nodrag nopan nowheel"
            value={loading ? '' : expandedText}
            onChange={handlePreviewChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onPointerDownCapture={(event) => {
              event.stopPropagation();
              if (event.nativeEvent?.stopImmediatePropagation) {
                event.nativeEvent.stopImmediatePropagation();
              }
            }}
            onMouseDownCapture={(event) => {
              event.stopPropagation();
            }}
            onWheelCapture={(event) => {
              event.stopPropagation();
              if (event.nativeEvent?.stopImmediatePropagation) {
                event.nativeEvent.stopImmediatePropagation();
              }
            }}
            placeholder={loading ? '' : lt('生成预览后将在此处展示扩写结果', 'Expanded result will appear here after generation')}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 100,
              resize: 'none',
              fontSize: 12,
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: 8,
              background: '#fff',
              outline: 'none',
              cursor: 'text'
            }}
          />
          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.8)',
              borderRadius: 6
            }}>
              <LoadingSpinner size="md" />
            </div>
          )}
        </div>
      </div>

      <PromptImageStrip images={siblingImages} onInsert={handleInsert} />

      {/* 错误显示 */}
      {error && (
        <div style={{
          fontSize: 11,
          color: '#dc2626',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          padding: 8,
          marginBottom: 12
        }}>
          {error.message}
        </div>
      )}

      {/* 输入和输出端点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        onMouseEnter={() => setHover('text-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        onMouseEnter={() => setHover('text-out')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 工具提示 */}
      {hover === 'text-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          {lt('文本输入', 'Text input')}
        </div>
      )}
      {hover === 'text-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          {lt('优化文本', 'Optimized text')}
        </div>
      )}
    </div>
  );
}

export default React.memo(PromptOptimizeNodeInner);
