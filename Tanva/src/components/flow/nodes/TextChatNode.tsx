import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow, useStore, type ReactFlowState, type Edge } from 'reactflow';
import { aiImageService } from '@/services/aiImageService';

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
  };
  selected?: boolean;
};

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

const TextChatNode: React.FC<Props> = ({ id, data }) => {
  const rf = useReactFlow();
  const edges = useStore((state: ReactFlowState) => state.edges);

  const [manualInput, setManualInput] = React.useState<string>(data.manualInput || '');
  const [isInvoking, setIsInvoking] = React.useState(false);
  const [hover, setHover] = React.useState<string | null>(null);

  React.useEffect(() => {
    if ((data.manualInput || '') !== manualInput) {
      setManualInput(data.manualInput || '');
    }
  }, [data.manualInput, manualInput]);

  const status: TextChatStatus = data.status || 'idle';
  const responseText = data.responseText || '';
  const errorText = data.error || '';
  const enableWebSearch = Boolean(data.enableWebSearch);

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
  }, [enableWebSearch, id, incomingTexts, manualInput]);

  const onManualInputChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setManualInput(value);
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { manualInput: value } }
    }));
  }, [id]);

  const toggleWebSearch = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { enableWebSearch: event.target.checked } }
    }));
  }, [id]);

  const contentStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
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
    minHeight: 60,
    maxHeight: 140,
    overflowY: 'auto',
  };

  const responseStyle: React.CSSProperties = {
    ...panelStyle,
    flex: 1,
    minHeight: 120,
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
        height: data.boxH || 540,
        padding: 12,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
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
        minHeight={400}
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
      <div style={contentStyle}>
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
            placeholder="输入附加提示信息"
            style={{
              width: '100%',
              minHeight: 96,
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
          <div style={labelStyle}>回复</div>
          <div style={{ ...responseStyle, color: responseText ? '#1f2937' : '#94a3b8' }}>
            {responseText || '执行后将显示模型的纯文本回复'}
          </div>
        </div>

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
