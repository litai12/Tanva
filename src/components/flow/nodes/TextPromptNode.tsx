import React from 'react';
import { Handle, Position } from 'reactflow';

type Props = {
  id: string;
  data: { text?: string };
  selected?: boolean;
};

export default function TextPromptNode({ id, data }: Props) {
  const [value, setValue] = React.useState<string>(data.text || '');

  React.useEffect(() => {
    // keep internal state in sync if external changes happen
    if ((data.text || '') !== value) setValue(data.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.text]);

  return (
    <div style={{
      width: 240,
      padding: 8,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Text Prompt</div>
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
        rows={4}
        style={{ width: '100%', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, padding: 6, outline: 'none' }}
      />
      <Handle type="source" position={Position.Right} id="text" />
    </div>
  );
}

