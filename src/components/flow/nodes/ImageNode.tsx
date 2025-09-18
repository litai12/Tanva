import React from 'react';
import { Handle, Position } from 'reactflow';

type Props = {
  id: string;
  data: { imageData?: string; label?: string };
  selected?: boolean;
};

export default function ImageNode({ id, data }: Props) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;

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

  return (
    <div style={{
      width: 240,
      padding: 8,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>{data.label || 'Image'}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => inputRef.current?.click()}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}
          >上传</button>
          {data.imageData && (
            <button
              onClick={() => {
                const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch: { imageData: undefined } } });
                window.dispatchEvent(ev);
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
        style={{
          width: '100%', height: 160, background: '#f3f4f6', borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          border: '1px dashed #e5e7eb'
        }}
        title="拖拽图片到此或点击上传"
      >
        {src ? (
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>拖拽图片到此或点击上传</span>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="img" />
    </div>
  );
}
