import React from 'react';
import { Handle, Position } from 'reactflow';
import { Send as SendIcon } from 'lucide-react';
import ImagePreviewModal from '../../ui/ImagePreviewModal';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    error?: string;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

export default function GenerateNode({ id, data }: Props) {
  const { status, error } = data;
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;
  const [hover, setHover] = React.useState<string | null>(null);

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);
  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);
  const [preview, setPreview] = React.useState(false);
  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  return (
    <div style={{
      width: 260,
      padding: 8,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      position: 'relative'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>Generate</div>
        <div style={{ display: 'flex', gap: 6 }}>
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
          <button
            onClick={onSend}
            disabled={!data.imageData}
            title={!data.imageData ? '无可发送的图像' : '发送到画布'}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: !data.imageData ? '#e5e7eb' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: !data.imageData ? 'not-allowed' : 'pointer'
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div
        onDoubleClick={() => src && setPreview(true)}
        style={{
          width: '100%', height: 160, background: '#fff', borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          border: '1px solid #eef0f2'
        }}
        title={src ? '双击预览' : undefined}
      >
        {src ? (
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>等待生成</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>Status: {status || 'idle'}</div>
      {status === 'failed' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      {/* 输入：img 在上，text 在下；输出：img */}
      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: 30 }}
        onMouseEnter={() => setHover('img-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: 70 }}
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="img"
        onMouseEnter={() => setHover('img-out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'img-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: 30, transform: 'translate(-100%, -50%)' }}>image</div>
      )}
      {hover === 'prompt-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: 70, transform: 'translate(-100%, -50%)' }}>prompt</div>
      )}
      {hover === 'img-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>image</div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={src || ''}
        imageTitle="Generate 节点预览"
        onClose={() => setPreview(false)}
      />
    </div>
  );
}
