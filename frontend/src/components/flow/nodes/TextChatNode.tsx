import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow, useStore, type ReactFlowState, type Edge } from 'reactflow';
import { aiImageService } from '@/services/aiImageService';
import { useAIChatStore, getTextModelForProvider } from '@/stores/aiChatStore';

type TextChatStatus = 'idle' | 'running' | 'succeeded' | 'failed';

type Props = {
  id: string;
  data: {
    status?: TextChatStatus;
    error?: string;
    responseText?: string;
    manualInput?: string;
    enableWebSearch?: boolean;
    lastPrompt?: string;
    boxW?: number;
    boxH?: number;
    sizeVersion?: number;
  };
  selected?: boolean;
};

const TEXT_CHAT_NODE_SIZE_VERSION = 2;
const DEFAULT_NODE_HEIGHT = 300;
const MIN_NODE_HEIGHT = 260;
const LEGACY_NODE_HEIGHT = 540;
const NODE_VERTICAL_PADDING = 24;

const pickTextFromNode = (edge: Edge, rfInstance: ReturnType<typeof useReactFlow>): string | undefined => {
  const source = rfInstance.getNode(edge.source);
  if (!source) return undefined;
  const sourceData = (source.data || {}) as Record<string, unknown>;
  const candidates = [
    typeof sourceData.text === 'string' ? sourceData.text : undefined,
    typeof sourceData.prompt === 'string' ? sourceData.prompt : undefined,
    typeof sourceData.expandedText === 'string' ? sourceData.expandedText : undefined,
    typeof sourceData.responseText === 'string' ? sourceData.responseText : undefined,
  ];
  const value = candidates.find((text) => typeof text === 'string' && text.trim().length);
  return value ? value.trim() : undefined;
};

const stopFlowPan = (event: React.SyntheticEvent<Element, Event>) => {
  event.stopPropagation();
  const native = event.nativeEvent as any;
  if (native?.stopImmediatePropagation) {
    native.stopImmediatePropagation();
  }
};

const TextChatNode: React.FC<Props> = ({ id, data, selected }) => {
  const rf = useReactFlow();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const textModel = React.useMemo(
    () => getTextModelForProvider(aiProvider),
    [aiProvider]
  );
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  const [manualInput, setManualInput] = React.useState<string>(data.manualInput || '');
  const [isInvoking, setIsInvoking] = React.useState(false);
  const [hover, setHover] = React.useState<string | null>(null);
  const isComposingRef = React.useRef(false);

  React.useEffect(() => {
    if (isComposingRef.current) return;
    const next = data.manualInput || '';
    setManualInput((prev) => (prev === next ? prev : next));
  }, [data.manualInput]);

  React.useEffect(() => {
    if (data.sizeVersion === TEXT_CHAT_NODE_SIZE_VERSION) return;
    const patch: Record<string, unknown> = { sizeVersion: TEXT_CHAT_NODE_SIZE_VERSION };
    if (typeof data.boxH !== 'number' || data.boxH === LEGACY_NODE_HEIGHT) {
      patch.boxH = DEFAULT_NODE_HEIGHT;
    }
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch }
    }));
  }, [data.boxH, data.sizeVersion, id]);

  const commitManualInput = React.useCallback((value: string) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { manualInput: value } }
    }));
  }, [id]);

  const status: TextChatStatus = data.status || 'idle';
  const errorText = data.error || '';
  const enableWebSearch = Boolean(data.enableWebSearch);
  const normalizedHeight = typeof data.boxH === 'number'
    ? (data.boxH === LEGACY_NODE_HEIGHT ? DEFAULT_NODE_HEIGHT : data.boxH)
    : DEFAULT_NODE_HEIGHT;
  const nodeHeight = Math.max(MIN_NODE_HEIGHT, normalizedHeight);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = React.useState(nodeHeight);

  const updateAutoHeight = React.useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    const measured = element.scrollHeight + NODE_VERTICAL_PADDING;
    const nextHeight = Math.max(MIN_NODE_HEIGHT, Math.ceil(measured));
    setContentHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  }, []);

  React.useLayoutEffect(() => {
    updateAutoHeight();
    const element = contentRef.current;
    if (!element) return;

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => updateAutoHeight());
      observer.observe(element);
      return () => observer.disconnect();
    }

    const handler = () => updateAutoHeight();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handler);
      }
    };
  }, [updateAutoHeight]);

  const computedHeight = Math.max(nodeHeight, contentHeight);

  const incomingTexts = React.useMemo(() => {
    return edges
      .filter((edge) => edge.target === id && edge.targetHandle === 'text')
      .map((edge) => pickTextFromNode(edge, rf))
      .filter((text): text is string => typeof text === 'string' && text.length > 0);
  }, [edges, id, rf]);

  const runChat = React.useCallback(async () => {
    const sources = [...incomingTexts];
    const typed = manualInput.trim();
    if (typed.length) sources.push(typed);
    const payload = sources.join('\n\n').trim();
    if (!payload.length) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: '请输入或连接至少一个提示文本' } }
      }));
      return;
    }

    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { status: 'running', error: undefined } }
    }));
    setIsInvoking(true);

    try {
      const result = await aiImageService.generateTextResponse({
        prompt: payload,
        enableWebSearch,
        aiProvider,
        model: textModel,
      });

      if (!result.success || !result.data) {
        const message = result.error?.message || '文本生成失败';
        throw new Error(message);
      }

      const text = (result.data.text || '').trim();
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: {
          id,
          patch: {
            status: 'succeeded',
            responseText: text,
            text,
            lastPrompt: payload,
            error: undefined,
          }
        }
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { status: 'failed', error: message } }
      }));
    } finally {
      setIsInvoking(false);
    }
  }, [aiProvider, enableWebSearch, id, incomingTexts, manualInput, textModel]);

  const onManualInputChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setManualInput(value);
    if (!isComposingRef.current) {
      commitManualInput(value);
    }
  }, [commitManualInput]);

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = React.useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    const value = event.currentTarget.value;
    setManualInput(value);
    commitManualInput(value);
  }, [commitManualInput]);

  const toggleWebSearch = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { enableWebSearch: event.target.checked } }
    }));
  }, [id]);

  const contentStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingTop: 4,
    paddingBottom: 4,
  };

  const panelStyle: React.CSSProperties = {
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    padding: '10px 12px',
    fontSize: 12,
    color: '#1f2937',
    whiteSpace: 'pre-wrap',
  };

  const connectionStyle: React.CSSProperties = {
    ...panelStyle,
    minHeight: 48,
    maxHeight: 140,
    overflowY: 'auto',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: '#1e293b',
  };

  const statusStyle: React.CSSProperties = {
    fontSize: 11,
    color: status === 'failed' && errorText ? '#ef4444' : '#4b5563',
    borderTop: '1px solid #e2e8f0',
    paddingTop: 8,
    marginTop: 'auto',
  };

  return (
    <div
      style={{
        width: data.boxW || 320,
        height: computedHeight,
        padding: 12,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        boxSizing: 'border-box',
      }}
    >
      <NodeResizer
        isVisible
        minWidth={260}
        minHeight={MIN_NODE_HEIGHT}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0, cursor: 'nwse-resize' }}
        onResizeEnd={(_, params) => {
          rf.setNodes((nodes) => nodes.map((node) => node.id === id
            ? { ...node, data: { ...node.data, boxW: params.width, boxH: params.height } }
            : node));
        }}
        onResize={(_, params) => {
          rf.setNodes((nodes) => nodes.map((node) => node.id === id
            ? { ...node, data: { ...node.data, boxW: params.width, boxH: params.height } }
            : node));
        }}
      />
      <div style={contentStyle} ref={contentRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>Text Chat</div>
          <button
            onClick={runChat}
            disabled={status === 'running' || isInvoking}
            style={{
              fontSize: 12,
              padding: '4px 12px',
              background: status === 'running' || isInvoking ? '#cbd5f5' : '#111827',
              color: '#fff',
              borderRadius: 8,
              border: 'none',
              cursor: status === 'running' || isInvoking ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {status === 'running' || isInvoking ? 'Running...' : 'Run'}
          </button>
        </div>

        <div style={{ fontSize: 11, color: '#64748b' }}>已连接提示：{incomingTexts.length} 条</div>
        <div style={{ ...connectionStyle, display: 'flex', flexDirection: 'column', gap: 8, color: incomingTexts.length ? '#1f2937' : '#94a3b8' }}>
          {incomingTexts.length
            ? incomingTexts.map((text, index) => (
              <div key={`${index}-${text.slice(0, 12)}`} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <span style={{ color: '#94a3b8', fontWeight: 600, minWidth: 26 }}>#{index + 1}</span>
                <span style={{ flex: 1 }}>{text}</span>
              </div>
            ))
            : <span>连接多个 Prompt 节点以聚合输入</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={labelStyle}>追加描述</div>
          <textarea
            value={manualInput}
            onChange={onManualInputChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="输入附加提示信息"
            style={{
              width: '100%',
              minHeight: 80,
              resize: 'vertical',
              fontSize: 12,
              lineHeight: 1.4,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #d7dce5',
              background: '#fff',
              color: '#111827',
              fontFamily: 'inherit',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
            onWheelCapture={stopFlowPan}
            onPointerDownCapture={stopFlowPan}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#4b5563' }}>
          <input type="checkbox" checked={enableWebSearch} onChange={toggleWebSearch} />
          启用联网搜索
        </label>

        <div style={statusStyle}>
          状态：{status}
          {status === 'failed' && errorText ? ` - ${errorText}` : ''}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'prompt-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          prompt
        </div>
      )}
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>
          prompt
        </div>
      )}
    </div>
  );
};

export default TextChatNode;
