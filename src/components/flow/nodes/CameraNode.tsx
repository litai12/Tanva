import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';
import { Send as SendIcon, Camera } from 'lucide-react';
import { AutoScreenshotService } from '@/services/AutoScreenshotService';
import ImagePreviewModal from '../../ui/ImagePreviewModal';

type Props = {
  id: string;
  data: { imageData?: string; boxW?: number; boxH?: number; };
  selected?: boolean;
};

export default function CameraNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;

  const capture = async () => {
    try {
      const imgs = (window as any).tanvaImageInstances || [];
      const models = (window as any).tanvaModel3DInstances || [];
      const res = await AutoScreenshotService.captureAutoScreenshot(imgs, models, { format: 'png', scale: 2, includeBackground: true, backgroundColor: '#ffffff', autoDownload: false });
      if (res.success && res.dataUrl) {
        const base64 = res.dataUrl.split(',')[1];
        rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, imageData: base64 } } : n));
        // 向下游 Image 节点传播
        try {
          const outs = rf.getEdges().filter(e => e.source === id);
          if (outs.length) {
            rf.setNodes(ns => ns.map(n => {
              const hits = outs.filter(e => e.target === n.id);
              if (!hits.length) return n;
              if (n.type === 'image') {
                return { ...n, data: { ...n.data, imageData: base64 } };
              }
              return n;
            }));
          }
        } catch {}
      }
    } catch (e) { console.error('capture failed', e); }
  };

  const sendToCanvas = () => {
    const img = data.imageData;
    if (!img) return;
    const dataUrl = `data:image/png;base64,${img}`;
    const fileName = `capture_${Date.now()}.png`;
    window.dispatchEvent(new CustomEvent('triggerQuickImageUpload', { detail: { imageData: dataUrl, fileName, operationType: 'generate' } }));
  };

  React.useEffect(() => {
    if (!preview) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [preview]);

  return (
    <div style={{ width: data.boxW || 260, height: data.boxH || 220, padding: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <NodeResizer isVisible={!!selected} minWidth={220} minHeight={180} color="transparent" lineStyle={{ display: 'none' }} handleStyle={{ background: 'transparent', border: 'none', width: 12, height: 12, opacity: 0 }}
        onResize={(e, p) => rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: p.width, boxH: p.height } } : n))}
        onResizeEnd={(e, p) => rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: p.width, boxH: p.height } } : n))}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>Camera</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={capture} style={{ fontSize: 12, padding: '4px 8px', background: '#111827', color: '#fff', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Camera size={14} /> Capture
          </button>
          <button onClick={sendToCanvas} disabled={!data.imageData} title={!data.imageData ? '无可发送的图像' : '发送到画布'} style={{ fontSize: 12, padding: '4px 8px', background: !data.imageData ? '#e5e7eb' : '#111827', color: '#fff', borderRadius: 6 }}>
            <SendIcon size={14} />
          </button>
        </div>
      </div>
      <div onDoubleClick={() => src && setPreview(true)} style={{ flex: 1, background: '#fff', borderRadius: 6, border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {src ? <img src={src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 12, color: '#9ca3af' }}>点击 Capture 拍摄</span>}
      </div>
      <Handle type="source" position={Position.Right} id="img" onMouseEnter={() => setHover('img-out')} onMouseLeave={() => setHover(null)} />
      {hover === 'img-out' && (<div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>image</div>)}
      <ImagePreviewModal
        isOpen={preview}
        imageSrc={src || ''}
        imageTitle="Camera 节点预览"
        onClose={() => setPreview(false)}
      />
    </div>
  );
}
