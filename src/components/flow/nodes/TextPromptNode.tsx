import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';

type Props = {
  id: string;
  data: { text?: string; boxW?: number; boxH?: number };
  selected?: boolean;
};

export default function TextPromptNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const [value, setValue] = React.useState<string>(data.text || '');
  const [hover, setHover] = React.useState<string | null>(null);

  React.useEffect(() => {
    // keep internal state in sync if external changes happen
    if ((data.text || '') !== value) setValue(data.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.text]);

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
        handleStyle={{ background: 'transparent', border: 'none', width: 12, height: 12, opacity: 0, cursor: 'nwse-resize' }}
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
        type="source"
        position={Position.Right}
        id="text"
        onMouseEnter={() => setHover('prompt-out')}
        onMouseLeave={() => setHover(null)}
      />
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>prompt</div>
      )}
    </div>
  );
}
