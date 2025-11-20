import React from 'react';
import { Handle, Position } from 'reactflow';
import { Send as SendIcon } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import GenerationProgressBar from './GenerationProgressBar';
import { useProjectContentStore } from '@/stores/projectContentStore';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    error?: string;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

export default function GenerateNode({ id, data, selected }: Props) {
  const { status, error } = data;
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';
  
  // 使用全局图片历史记录
  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const projectHistory = React.useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);
  const allImages = React.useMemo(
    () =>
      projectHistory.map(
        (item) =>
          ({
            id: item.id,
            src: item.src,
            title: item.title,
            timestamp: item.timestamp,
          }) as ImageItem,
      ),
    [projectHistory],
  );

  const updateAspectRatio = React.useCallback((ratio: string) => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: {
          id,
          patch: {
            aspectRatio: ratio || undefined
          }
        }
      })
    );
  }, [id]);

  const aspectRatioValue = data.aspectRatio ?? '';
  const aspectOptions: Array<{ label: string; value: string }> = React.useMemo(() => ([
    { label: '自动', value: '' },
    { label: '1:1', value: '1:1' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '2:3', value: '2:3' },
    { label: '3:2', value: '3:2' },
    { label: '4:5', value: '4:5' },
    { label: '5:4', value: '5:4' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
    { label: '21:9', value: '21:9' },
  ]), []);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

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
      setCurrentImageId(newImageId);
      void recordImageHistoryEntry({
        id: newImageId,
        base64: data.imageData,
        title: `Generate节点 ${new Date().toLocaleTimeString()}`,
        nodeId: id,
        nodeType: 'generate',
        fileName: `flow_generate_${newImageId}.png`,
        projectId,
      });
    }
  }, [data.imageData, status, id, projectId]);

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
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      boxShadow,
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label className="nodrag nopan" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
          尺寸
          <select
            value={aspectRatioValue}
            onChange={(e) => updateAspectRatio(e.target.value)}
            onPointerDown={stopNodeDrag}
            onPointerDownCapture={stopNodeDrag}
            onMouseDown={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            onClick={stopNodeDrag}
            onClickCapture={stopNodeDrag}
            className="nodrag nopan"
            style={{
              fontSize: 12,
              padding: '2px 6px',
              borderRadius: 6,
              border: '1px solid #e5e7eb',
              background: '#fff',
              color: '#111827',
            }}
          >
            {aspectOptions.map(opt => (
              <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
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
      <GenerationProgressBar status={status} />
      {status === 'failed' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      {/* 输入：img 在上，text 在下；输出：img */}
      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: '35%' }}
        onMouseEnter={() => setHover('img-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '65%' }}
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="img"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('img-out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'img-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '35%', transform: 'translate(-100%, -50%)' }}>image</div>
      )}
      {hover === 'prompt-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '65%', transform: 'translate(-100%, -50%)' }}>prompt</div>
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
