import React from 'react';
import { Handle, Position } from 'reactflow';
import { AlertTriangle, Send as SendIcon, Video, Share2, Download } from 'lucide-react';
import GenerationProgressBar from './GenerationProgressBar';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
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
  const [hover, setHover] = React.useState<string | null>(null);
  const [previewAspect, setPreviewAspect] = React.useState<string>('16/9');

  const onRun = React.useCallback(() => data.onRun?.(id), [data, id]);
  const onSend = React.useCallback(() => data.onSend?.(id), [data, id]);

  const renderPreview = () => {
    const commonMediaStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      borderRadius: 6,
      background: '#000'
    };

    if (data.videoUrl) {
      return (
        <video
          controls
          poster={data.thumbnail}
          style={commonMediaStyle}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setPreviewAspect(`${v.videoWidth}/${v.videoHeight}`);
            }
          }}
        >
          <source src={data.videoUrl} type="video/mp4" />
          您的浏览器不支持 video 标签
        </video>
      );
    }
    if (data.thumbnail) {
      return (
        <img
          src={data.thumbnail}
          alt="video thumbnail"
          style={commonMediaStyle}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setPreviewAspect(`${img.naturalWidth}/${img.naturalHeight}`);
            }
          }}
        />
      );
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
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '32%' }}
        onMouseEnter={() => setHover('text-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: '60%' }}
        onMouseEnter={() => setHover('image-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('video-out')}
        onMouseLeave={() => setHover(null)}
      />
      {hover === 'text-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '32%', transform: 'translate(-100%, -50%)' }}>prompt</div>
      )}
      {hover === 'image-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '60%', transform: 'translate(-100%, -50%)' }}>image</div>
      )}
      {hover === 'video-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>video</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Video size={18} />
          <span>Sora2</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onRun}
            disabled={data.status === 'running'}
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: 'none',
              background: data.status === 'running' ? '#e5e7eb' : '#111827',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: data.status === 'running' ? 'not-allowed' : 'pointer',
              fontSize: 12,
              opacity: data.status === 'running' ? 0.6 : 1
            }}
          >
            Run
          </button>
          <button
            onClick={async () => {
              if (!data.videoUrl) return;
              try {
                await navigator.clipboard.writeText(data.videoUrl);
                alert('已复制视频链接');
              } catch (error) {
                console.error('复制失败:', error);
                alert('复制失败，请手动复制链接');
              }
            }}
            title="复制链接"
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: 'none',
              background: '#111827',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: data.videoUrl ? 'pointer' : 'not-allowed',
              color: '#fff',
              opacity: data.videoUrl ? 1 : 0.35
            }}
            disabled={!data.videoUrl}
          >
            <Share2 size={14} />
          </button>
          <button
            onClick={async () => {
              if (!data.videoUrl) return;
              try {
                const response = await fetch(data.videoUrl, { mode: 'cors', credentials: 'omit' });
                if (response.ok) {
                  const blob = await response.blob();
                  const downloadUrl = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = downloadUrl;
                  link.download = `video-${new Date().toISOString().split('T')[0]}.mp4`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  setTimeout(() => URL.revokeObjectURL(downloadUrl), 200);
                } else {
                  const link = document.createElement('a');
                  link.href = data.videoUrl;
                  link.target = '_blank';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }
              } catch (error) {
                console.error('下载失败:', error);
                alert('下载失败，请尝试在浏览器中打开链接');
              }
            }}
            title="下载视频"
            style={{
              width: 36,
              height: 32,
              borderRadius: 8,
              border: 'none',
              background: '#111827',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: data.videoUrl ? 'pointer' : 'not-allowed',
              color: '#fff',
              opacity: data.videoUrl ? 1 : 0.35
            }}
            disabled={!data.videoUrl}
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      <div
        style={{
          width: '100%',
          aspectRatio: previewAspect,
          minHeight: 140,
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
