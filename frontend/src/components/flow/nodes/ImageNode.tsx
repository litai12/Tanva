// @ts-nocheck
import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import { useProjectContentStore } from '@/stores/projectContentStore';

type Props = {
  id: string;
  data: { imageData?: string; label?: string; boxW?: number; boxH?: number };
  selected?: boolean;
};

export default function ImageNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;
  const projectId = useProjectContentStore((state) => state.projectId);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [hasInputConnection, setHasInputConnection] = React.useState(false);
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';
  
  // 检查输入连线状态
  React.useEffect(() => {
    const checkConnections = () => {
      const edges = rf.getEdges();
      const hasConnection = edges.some(edge => edge.target === id && edge.targetHandle === 'img');
      setHasInputConnection(hasConnection);
    };
    
    // 初始检查
    checkConnections();
    
    // 设置定期检查（简单方案）
    const interval = setInterval(checkConnections, 100);
    return () => clearInterval(interval);
  }, [rf, id]);
  
  // 使用全局图片历史记录
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
  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch: { imageData: base64 } } });
      window.dispatchEvent(ev);
      
      const newImageId = `${id}-${Date.now()}`;
      setCurrentImageId(newImageId);
      void recordImageHistoryEntry({
        id: newImageId,
        base64,
        title: `Image节点上传 ${new Date().toLocaleTimeString()}`,
        nodeId: id,
        nodeType: 'image',
        fileName: file.name || `flow_image_${newImageId}.png`,
        projectId,
      });
    };
    reader.readAsDataURL(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const items = e.clipboardData?.items;
    if (!items) return;

    // 遍历剪贴板项，查找图片
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const fileList = new DataTransfer();
          fileList.items.add(file);
          handleFiles(fileList.files);
          return;
        }
      }
    }
  };

  const headerHeight = 34; // 顶部标题+按钮区域高度

  return (
    <div
      onPaste={onPaste}
      tabIndex={0}
      style={{
        width: data.boxW || 260,
        height: data.boxH || 240,
        padding: 8,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        outline: 'none'
      }}>
      <NodeResizer
        isVisible
        minWidth={200}
        minHeight={160}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handlePositions={['top-left','top','top-right','right','bottom-right','bottom','bottom-left','left'] as any}
        handleComponent={(props: any) => {
          const { position, ...rest } = props || {};
          const common: React.CSSProperties = { background: 'transparent', opacity: 0, position: 'absolute', pointerEvents: 'auto' };
          const edgeThickness = 12; // 可抓取厚度
          // 边角小区
          if (position === 'top-left' || position === 'top-right' || position === 'bottom-left' || position === 'bottom-right') {
            const style: React.CSSProperties = { ...common, ...((rest as any).style || {}), width: edgeThickness, height: edgeThickness };
            if (position === 'top-left') style.cursor = 'nwse-resize';
            if (position === 'top-right') style.cursor = 'nesw-resize';
            if (position === 'bottom-left') style.cursor = 'nesw-resize';
            if (position === 'bottom-right') style.cursor = 'nwse-resize';
            return <div {...rest} style={style} />;
          }
          // 四条边
          if (position === 'top' || position === 'bottom') {
            const style: React.CSSProperties = { ...common, ...((rest as any).style || {}), width: '100%', height: edgeThickness, left: 0, cursor: 'ns-resize' };
            if (position === 'top') style.top = 0; else style.bottom = 0;
            return <div {...rest} style={style} />;
          }
          if (position === 'left' || position === 'right') {
            const style: React.CSSProperties = { ...common, ...((rest as any).style || {}), height: '100%', width: edgeThickness, top: 0, cursor: 'ew-resize' };
            if (position === 'left') style.left = 0; else style.right = 0;
            return <div {...rest} style={style} />;
          }
          return null;
        }}
        onResize={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? {
            ...n,
            data: { ...n.data, boxW: params.width, boxH: params.height }
          } : n));
        }}
        onResizeEnd={(evt, params) => {
          // 将节点尺寸持久到 data，保证重渲染后保持
          rf.setNodes(ns => ns.map(n => n.id === id ? {
            ...n,
            data: { ...n.data, boxW: params.width, boxH: params.height }
          } : n));
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>{data.label || 'Image'}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasInputConnection && (
          <button
            onClick={() => {
              // 只断开输入连线，不清空图片数据
              try {
                const edges = rf.getEdges();
                const remain = edges.filter(e => !(e.target === id && e.targetHandle === 'img'));
                rf.setEdges(remain);
              } catch {}
            }}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}
          >内置</button>
          )}
          {data.imageData && (
          <button
            onClick={() => {
              const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch: { imageData: undefined } } });
              window.dispatchEvent(ev);
              // 同步断开输入连线
              try {
                const edges = rf.getEdges();
                const remain = edges.filter(e => !(e.target === id && e.targetHandle === 'img'));
                rf.setEdges(remain);
              } catch {}
            }}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}
          >清空</button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDoubleClick={() => src && setPreview(true)}
        onClick={() => {
          if (!src) {
            inputRef.current?.click();
          }
        }}
        style={{
          flex: 1,
          minHeight: 120,
          background: '#fff',
          borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          border: '1px solid #e5e7eb',
          cursor: src ? 'default' : 'pointer'
        }}
        title="拖拽图片到此或点击上传"
      >
        {src ? (
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>拖拽图片到此或点击上传</span>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="img"
        onMouseEnter={() => setHover('img-in')}
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
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>image</div>
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
        onImageChange={(imageId: string) => {
          const selectedImage = allImages.find(item => item.id === imageId);
          if (selectedImage) {
            setCurrentImageId(imageId);
          }
        }}
      />
    </div>
  );
}
