import React from 'react';
import { Handle, Position } from 'reactflow';
import { AlertTriangle, Play, Send as SendIcon, Video } from 'lucide-react';
import GenerationProgressBar from './GenerationProgressBar';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    prompt?: string;
    videoUrl?: string;
    thumbnail?: string;
    error?: string;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

export default function Sora2VideoNode({ id, data, selected }: Props) {
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  const onRun = React.useCallback(() => data.onRun?.(id), [data, id]);
  const onSend = React.useCallback(() => data.onSend?.(id), [data, id]);

  const renderPreview = () => {
    if (data.videoUrl) {
      return (
        <video
          controls
          poster={data.thumbnail}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, background: '#000' }}
        >
          <source src={data.videoUrl} type="video/mp4" />
          您的浏览器不支持 video 标签
        </video>
      );
    }
    if (data.thumbnail) {
      return <img src={data.thumbnail} alt="video thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
        <Video size={24} strokeWidth={2} />
        <div style={{ fontSize: 11 }}>等待生成...</div>
      </div>
    );
  };

  return (
    <div style={{
      width: 280,
      padding: 10,
      background: '#fff',
      border: `1px solid ${borderColor}`,
      borderRadius: 10,
      boxShadow,
      position: 'relative'
    }}>
      <Handle type="target" position={Position.Left} id="image" style={{ background: '#94a3b8' }} />
      <Handle type="source" position={Position.Right} id="video" style={{ background: '#2563eb' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Video size={18} />
          <span>Sora2 Video</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onRun}
            disabled={data.status === 'running'}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: data.status === 'running' ? '#e5e7eb' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: data.status === 'running' ? 'not-allowed' : 'pointer'
            }}
          >
            {data.status === 'running' ? 'Running...' : 'Run'}
          </button>
          <button
            onClick={onSend}
            disabled={!data.videoUrl}
            title={!data.videoUrl ? '无可发送的视频' : '发送到画布/下游'}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: !data.videoUrl ? '#e5e7eb' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: !data.videoUrl ? 'not-allowed' : 'pointer'
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label className="nodrag nopan" style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>提示词</label>
        <textarea
          className="nodrag nopan"
          value={data.prompt || ''}
          onChange={(e) => {
            const value = e.target.value;
            window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch: { prompt: value } } }));
          }}
          style={{
            width: '100%',
            minHeight: 60,
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid #e5e7eb',
            padding: 6,
            resize: 'vertical',
          }}
          placeholder="请输入视频提示词"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>

      <div
        style={{
          width: '100%',
          height: 140,
          background: '#f8fafc',
          borderRadius: 6,
          border: '1px solid #eef0f2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        {renderPreview()}
      </div>

      <GenerationProgressBar
        status={data.status || 'idle'}
        progress={data.status === 'running' ? 30 : data.status === 'succeeded' ? 100 : 0}
      />

      {data.error && (
        <div style={{
          marginTop: 6,
          padding: '6px 8px',
          background: '#fef2f2',
          border: '1px solid #fecdd3',
          borderRadius: 6,
          color: '#b91c1c',
          fontSize: 12,
          display: 'flex',
          gap: 6,
          alignItems: 'center'
        }}>
          <AlertTriangle size={14} />
          <span>{data.error}</span>
        </div>
      )}
    </div>
  );
}
