import React from 'react';
import { Handle, Position } from 'reactflow';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    error?: string;
    onRun?: (id: string) => void;
  };
  selected?: boolean;
};

export default function GenerateNode({ id, data }: Props) {
  const { status, error } = data;
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  return (
    <div style={{
      width: 260,
      padding: 8,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>Generate</div>
        <button
          onClick={onRun}
          disabled={status === 'running'}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            background: status === 'running' ? '#e5e7eb' : '#111827',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: status === 'running' ? 'not-allowed' : 'pointer'
          }}
        >
          {status === 'running' ? 'Running...' : 'Run'}
        </button>
      </div>
      <div style={{
        width: '100%', height: 160, background: '#f3f4f6', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
      }}>
        {src ? (
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>等待生成</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Status: {status || 'idle'}</div>
      {status === 'failed' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      {/* 输入：text + img[], 输出：img */}
      <Handle type="target" position={Position.Left} id="text" style={{ top: 30 }} />
      <Handle type="target" position={Position.Left} id="img" style={{ top: 70 }} />
      <Handle type="source" position={Position.Right} id="img" />
    </div>
  );
}

