import { Handle, Position } from 'reactflow';

type Props = {
  id: string;
  data: { imageData?: string; label?: string };
  selected?: boolean;
};

export default function ImageNode({ data }: Props) {
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;
  return (
    <div style={{
      width: 220,
      padding: 8,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{data.label || 'Image'}</div>
      <div style={{
        width: '100%', height: 140, background: '#f3f4f6', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
      }}>
        {src ? (
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>无图像</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="img" />
    </div>
  );
}
