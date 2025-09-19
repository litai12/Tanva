import React from 'react';
import { Handle, Position } from 'reactflow';
import { Send as SendIcon } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';

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
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  
  // 使用全局图片历史记录
  const { history, addImage } = useImageHistoryStore();
  const allImages = React.useMemo(() => 
    history.map(item => ({
      id: item.id,
      src: item.src,
      title: item.title
    } as ImageItem)), 
    [history]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);
  
  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 当图片数据更新时，添加到全局历史记录
  React.useEffect(() => {
    if (data.imageData && status === 'succeeded') {
      const newImageId = `${id}-${Date.now()}`;
      addImage({
        id: newImageId,
        src: `data:image/png;base64,${data.imageData}`,
        title: `Generate节点 ${new Date().toLocaleTimeString()}`,
        nodeId: id,
        nodeType: 'generate'
      });
      setCurrentImageId(newImageId);
    }
  }, [data.imageData, status, id, addImage]);

  // 处理图片切换
  const handleImageChange = React.useCallback((imageId: string) => {
    const selectedImage = allImages.find(item => item.id === imageId);
    if (selectedImage) {
      setCurrentImageId(imageId);
      // 这里可以选择是否更新节点的图片数据
      // 暂时只更新预览，不更新节点数据
    }
  }, [allImages]);

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
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find(item => item.id === currentImageId)?.src || src || ''
            : src || ''
        }
        imageTitle="全局图片预览"
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
    </div>
  );
}
