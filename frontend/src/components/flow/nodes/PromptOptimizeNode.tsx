import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';
// no Button/Textarea components needed here
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import usePromptOptimization from '@/hooks/usePromptOptimization';
import type { PromptOptimizationRequest } from '@/services/promptOptimizationService';
import { useAIChatStore, getTextModelForProvider } from '@/stores/aiChatStore';
import { resolveTextFromSourceNode } from '../utils/textSource';

// 已去除可视化设置面板，采用内部默认参数

type Props = {
  id: string;
  data: {
    text?: string;
    expandedText?: string;
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

export default function PromptOptimizeNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const [upstreamText, setUpstreamText] = React.useState<string>('');
  const [hover, setHover] = React.useState<string | null>(null);
  const [expandedText, setExpandedText] = React.useState<string>(data.expandedText || '');
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : 'none';

  const { optimize, loading, result, error, reset } = usePromptOptimization();
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const textModel = React.useMemo(() => getTextModelForProvider(aiProvider), [aiProvider]);

  const readUpstreamText = React.useCallback(() => {
    try {
      const edges = rf.getEdges();
      const incoming = edges.find(e => e.target === id && e.targetHandle === 'text');
      if (incoming?.source) {
        const src = rf.getNode(incoming.source);
        const value = resolveTextFromSourceNode(src, incoming.sourceHandle);
        return value?.trim() || '';
      }
    } catch {}
    return '';
  }, [id, rf]);

  // 初始化时尝试读取上游文本
  React.useEffect(() => {
    setUpstreamText(readUpstreamText());
  }, [readUpstreamText]);

  React.useEffect(() => {
    if ((data.expandedText || '') !== expandedText) setExpandedText(data.expandedText || '');
  }, [data.expandedText]);

  React.useEffect(() => {
    if (result?.optimizedPrompt) {
      setExpandedText(result.optimizedPrompt);
      updateNodeData({ expandedText: result.optimizedPrompt, text: result.optimizedPrompt });
    }
  }, [result]);

  const updateNodeData = (patch: Record<string, any>) => {
    const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch } });
    window.dispatchEvent(ev);
  };

  // 监听上游输入节点文本变化
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; patch: Record<string, any> };
      if (!detail?.id) return;
      try {
        const edges = rf.getEdges();
        const incoming = edges.find(ed => ed.target === id && ed.targetHandle === 'text');
        if (!incoming || incoming.source !== detail.id) return;
        setUpstreamText(readUpstreamText());
      } catch {}
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [rf, id, readUpstreamText]);

  // 已移除设置面板，无需处理设置变更

  const handleOptimize = async (inputText?: string) => {
    let text = inputText || upstreamText.trim();
    // 若本地输入为空，尝试读取上游 text 输入
    if (!text) {
      text = readUpstreamText();
    }
    // 再次兜底：使用当前预览/编辑内容
    if (!text && expandedText?.trim()) text = expandedText.trim();
    if (!text) return;

    reset();
    await optimize({
      input: text,
      language: '中文',
      tone: undefined,
      focus: undefined,
      lengthPreference: 'balanced',
      aiProvider,
      model: textModel
    } satisfies PromptOptimizationRequest);
  };

  // 不需要中间激活按钮；Run 后即写入 expandedText 与 text

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
      position: 'relative'
    }}>
      <NodeResizer
        isVisible
        minWidth={300}
        minHeight={220}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0, cursor: 'nwse-resize' }}
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
        <span>Prompt Optimizer</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => handleOptimize()}
            disabled={loading}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: loading ? '#e5e7eb' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? '生成中...' : 'Run'}
          </button>
        </div>
      </div>
      {/* 省略输入面板，文本从上游连线进入 */}

      {/* 已移除详细设置，仅保留关键运行与预览部分 */}

      {/* 预览输出 */}
      <div style={{ marginBottom: 12, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' }}>优化预览</label>
        <div style={{ position: 'relative', flex: 1 }}>
          <textarea
            className="nodrag nopan nowheel"
            value={loading ? '' : expandedText}
            onChange={(e) => {
              const v = e.target.value;
              setExpandedText(v);
              // 编辑即生效：向右输出编辑后的文本
              updateNodeData({ expandedText: v, text: v });
            }}
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
            placeholder={loading ? '' : '生成预览后将在此处展示扩写结果'}
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
          文本输入
        </div>
      )}
      {hover === 'text-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          优化文本
        </div>
      )}
    </div>
  );
}
