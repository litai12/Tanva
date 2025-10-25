import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';

type Props = {
  id: string;
  data: { prompt?: string; boxW?: number; boxH?: number };
  selected?: boolean;
};

export default function AnalysisNode({ id, data }: Props) {
  const rf = useReactFlow();
  const [hover, setHover] = React.useState<string | null>(null);

  return (
    <div
      style={{
        width: data.boxW || 240,
        height: data.boxH || 160,
        padding: 8,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        gap: 6,
      }}
    >
      <NodeResizer
        isVisible
        minWidth={180}
        minHeight={120}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0, cursor: 'nwse-resize' }}
        onResize={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id
            ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } }
            : n));
        }}
        onResizeEnd={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id
            ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } }
            : n));
        }}
      />

      <div style={{ fontWeight: 600 }}>提示词输出</div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 8,
          fontSize: 12,
          color: data.prompt ? '#374151' : '#9ca3af',
          background: '#f9fafb',
          whiteSpace: 'pre-wrap',
        }}
      >
        {data.prompt && data.prompt.trim().length ? data.prompt : '分析结果将显示在这里'}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="prompt"
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
