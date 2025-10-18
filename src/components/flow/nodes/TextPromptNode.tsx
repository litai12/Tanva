import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow, useStore, type ReactFlowState, type Edge } from 'reactflow';

type Props = {
  id: string;
  data: { text?: string; boxW?: number; boxH?: number };
  selected?: boolean;
};

export default function TextPromptNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const [value, setValue] = React.useState<string>(data.text || '');
  const [hover, setHover] = React.useState<string | null>(null);
  const edgesRef = React.useRef<Edge[]>(edges);

  const applyIncomingText = React.useCallback((incoming: string) => {
    setValue((prev) => (prev === incoming ? prev : incoming));
    const currentDataText = typeof data.text === 'string' ? data.text : '';
    if (currentDataText !== incoming) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { text: incoming } }
      }));
    }
  }, [data.text, id]);

  const syncFromSource = React.useCallback((sourceId: string) => {
    const srcNode = rf.getNode(sourceId);
    if (!srcNode) return;
    const srcData = (srcNode.data as any) || {};
    const candidateText = typeof srcData.text === 'string' ? srcData.text : undefined;
    const fallbackPrompt = typeof srcData.prompt === 'string' ? srcData.prompt : '';
    const upstream = typeof candidateText === 'string' ? candidateText : fallbackPrompt;
    applyIncomingText(upstream);
  }, [rf, applyIncomingText]);

  React.useEffect(() => {
    // keep internal state in sync if external changes happen
    if ((data.text || '') !== value) setValue(data.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.text]);

  React.useEffect(() => {
    edgesRef.current = edges;
    const incoming = edges.find((e) => e.target === id && e.targetHandle === 'text');
    if (incoming?.source) {
      syncFromSource(incoming.source);
    }
  }, [edges, id, syncFromSource]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch: Record<string, unknown> }>).detail;
      if (!detail?.id || detail.id === id) return;
      const incoming = edgesRef.current.find((e) => e.target === id && e.targetHandle === 'text');
      if (!incoming || incoming.source !== detail.id) return;

      const patch = detail.patch || {};
      const textPatch = typeof patch.text === 'string' ? patch.text : undefined;
      if (typeof textPatch === 'string') return applyIncomingText(textPatch);
      const promptPatch = typeof patch.prompt === 'string' ? patch.prompt : undefined;
      if (typeof promptPatch === 'string') return applyIncomingText(promptPatch);
      syncFromSource(detail.id);
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [id, applyIncomingText, syncFromSource]);

  return (
    <div style={{
      width: data.boxW || 240,
      height: data.boxH || 180,
      padding: 8,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
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
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0, cursor: 'nwse-resize' }}
        onResize={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } } : n));
        }}
        onResizeEnd={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } } : n));
        }}
      />
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Prompt</div>
      <textarea
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          // write through to node data via DOM event (handled in FlowOverlay)
          const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch: { text: v } } });
          window.dispatchEvent(ev);
        }}
        placeholder="输入提示词"
        style={{
          width: '100%',
          flex: 1,
          resize: 'none',
          fontSize: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 6,
          outline: 'none'
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
