import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow, useStore, type ReactFlowState, type Edge } from 'reactflow';
import { resolveTextFromSourceNode } from '../utils/textSource';

type Props = {
  id: string;
  data: { text?: string; boxW?: number; boxH?: number; title?: string };
  selected?: boolean;
};

const DEFAULT_TITLE = 'Prompt';

function TextPromptNodeInner({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const [value, setValue] = React.useState<string>(data.text || '');
  const [hover, setHover] = React.useState<string | null>(null);
  const [incomingTexts, setIncomingTexts] = React.useState<string[]>([]);
  const edgesRef = React.useRef<Edge[]>(edges);
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';
  const normalizedTitle = typeof data.title === 'string' && data.title.trim().length
    ? data.title.trim()
    : DEFAULT_TITLE;
  const [title, setTitle] = React.useState<string>(normalizedTitle);
  const [titleDraft, setTitleDraft] = React.useState<string>(normalizedTitle);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const incomingCount = incomingTexts.length;
  const hasIncoming = incomingCount > 0;

  const applyIncomingText = React.useCallback((incoming: string) => {
    setValue((prev) => (prev === incoming ? prev : incoming));
    const currentDataText = typeof data.text === 'string' ? data.text : '';
    if (currentDataText !== incoming) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { text: incoming } }
      }));
    }
  }, [data.text, id]);

  const syncFromSource = React.useCallback((sourceId: string, sourceHandle?: string | null) => {
    const srcNode = rf.getNode(sourceId);
    const upstream = resolveTextFromSourceNode(srcNode, sourceHandle) || '';
    applyIncomingText(upstream);
  }, [rf, applyIncomingText]);

  const handleDisconnectInputs = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const currentEdges = rf.getEdges();
    const remain = currentEdges.filter(edge => !(edge.target === id && edge.targetHandle === 'text'));
    if (remain.length === currentEdges.length) return;
    setIncomingTexts([]);
    rf.setEdges(remain);
  }, [rf, id]);

  const collectIncomingTexts = React.useCallback((edgeList: Edge[]) => {
    const incomingEdges = edgeList
      .filter((edge) => edge.target === id && edge.targetHandle === 'text');
    if (!incomingEdges.length) return [];

    const decorated = incomingEdges.map((edge, index) => {
      const handle = (edge as any).sourceHandle as string | undefined;
      let order = 1000 + index;
      if (typeof handle === 'string') {
        const promptMatch = handle.match(/^prompt(\d+)$/);
        if (promptMatch) {
          order = Number(promptMatch[1]);
        } else {
          const numericMatch = handle.match(/(\d+)/);
          if (numericMatch) {
            order = Number(numericMatch[1]);
          }
        }
      }
      return { edge, order, index };
    });

    decorated.sort((a, b) => (a.order - b.order) || (a.index - b.index));

    return decorated
      .map(({ edge }) => {
        const node = rf.getNode(edge.source);
        const resolved = resolveTextFromSourceNode(node, (edge as any).sourceHandle);
        return typeof resolved === 'string' && resolved.trim().length ? resolved.trim() : '';
      })
      .filter((text) => text.length > 0);
  }, [id, rf]);

  React.useEffect(() => {
    // keep internal state in sync if external changes happen
    if ((data.text || '') !== value) setValue(data.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.text]);

  React.useEffect(() => {
    setTitle(normalizedTitle);
    if (!isEditingTitle) {
      setTitleDraft(normalizedTitle);
    }
  }, [normalizedTitle, isEditingTitle]);

  React.useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  React.useEffect(() => {
    edgesRef.current = edges;
    const texts = collectIncomingTexts(edges);
    setIncomingTexts(texts);
    if (texts.length) {
      applyIncomingText(texts.join('\n\n'));
    }
  }, [edges, collectIncomingTexts, applyIncomingText]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch: Record<string, unknown> }>).detail;
      if (!detail?.id || detail.id === id) return;
      const isSourceLinked = edgesRef.current.some(
        (edge) => edge.target === id && edge.targetHandle === 'text' && edge.source === detail.id
      );
      if (!isSourceLinked) return;

      const texts = collectIncomingTexts(edgesRef.current);
      setIncomingTexts(texts);
      if (texts.length) {
        applyIncomingText(texts.join('\n\n'));
        return;
      }

      const incoming = edgesRef.current.find((edge) => edge.target === id && edge.targetHandle === 'text' && edge.source === detail.id);
      const patch = detail.patch || {};
      const textPatch = typeof patch.text === 'string' ? patch.text : undefined;
      if (typeof textPatch === 'string') return applyIncomingText(textPatch);
      const promptPatch = typeof patch.prompt === 'string' ? patch.prompt : undefined;
      if (typeof promptPatch === 'string') return applyIncomingText(promptPatch);
      if (incoming) {
        syncFromSource(detail.id, incoming.sourceHandle);
      }
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [id, applyIncomingText, syncFromSource, collectIncomingTexts]);

  const startTitleEditing = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setTitleDraft(title);
    setIsEditingTitle(true);
  }, [title]);

  const commitTitle = React.useCallback((raw: string) => {
    const trimmed = raw.trim();
    const nextTitle = trimmed.length ? trimmed : DEFAULT_TITLE;
    setTitle(nextTitle);
    setTitleDraft(nextTitle);
    setIsEditingTitle(false);
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { title: nextTitle } }
    }));
  }, [id]);

  const cancelTitleEditing = React.useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft(title);
  }, [title]);

  return (
    <div style={{
      width: data.boxW || 240,
      height: data.boxH || 180,
      padding: 8,
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
        minWidth={180}
        minHeight={120}
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
      <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => commitTitle(titleDraft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitle(titleDraft);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelTitleEditing();
              }
            }}
            style={{
              fontWeight: 600,
              fontSize: 13,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
              width: '100%'
            }}
          />
        ) : (
          <span
            onDoubleClick={startTitleEditing}
            title="双击编辑标题"
            style={{ cursor: 'text', userSelect: 'none' }}
          >
            {title}
          </span>
        )}
        {hasIncoming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>已拼接 {incomingCount} 条输入</span>
            <button
              onClick={handleDisconnectInputs}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                border: '1px solid #e5e7eb',
                background: '#fff',
                color: '#374151',
                cursor: 'pointer'
              }}
            >
              内置
            </button>
          </div>
        )}
      </div>
      <textarea
        className="nodrag nopan nowheel"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          // write through to node data via DOM event (handled in FlowOverlay)
          const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch: { text: v } } });
          window.dispatchEvent(ev);
        }}
        onWheelCapture={(event) => {
          event.stopPropagation();
          if (event.nativeEvent?.stopImmediatePropagation) {
            event.nativeEvent.stopImmediatePropagation();
          }
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
        placeholder="输入提示词"
        style={{
          width: '100%',
          flex: 1,
          resize: 'vertical',
          maxHeight: '100%',
          minHeight: 60,
          overflowY: 'auto',
          fontSize: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 6,
          outline: 'none',
          pointerEvents: 'auto',
          background: 'rgba(255,255,255,0.92)',
          cursor: 'text'
        }}
      />
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
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>prompt</div>
      )}
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>prompt</div>
      )}
    </div>
  );
}

export default React.memo(TextPromptNodeInner);
