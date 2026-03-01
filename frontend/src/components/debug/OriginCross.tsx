import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

interface OriginCrossProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const lineStyle: React.CSSProperties = {
  position: 'absolute',
  backgroundColor: 'rgba(59, 130, 246, 0.6)',
  boxShadow: '0 0 4px rgba(59, 130, 246, 0.4)',
  pointerEvents: 'none',
};

const OriginCross: React.FC<OriginCrossProps> = ({ canvasRef }) => {
  const zoom = useCanvasStore((state) => state.zoom);
  const panX = useCanvasStore((state) => state.panX);
  const panY = useCanvasStore((state) => state.panY);
  const [devicePixelRatioState, setDevicePixelRatioState] = useState(() => window.devicePixelRatio || 1);

  useEffect(() => {
    const handleChange = () => {
      setDevicePixelRatioState(window.devicePixelRatio || 1);
    };
    window.addEventListener('resize', handleChange);
    return () => window.removeEventListener('resize', handleChange);
  }, []);

  const canvas = canvasRef.current;
  if (!canvas) return null;

  const dpr = devicePixelRatioState || 1;
  const left = (panX * zoom) / dpr;
  const top = (panY * zoom) / dpr;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        transform: 'translate(-50%, -50%)',
        width: 0,
        height: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          ...lineStyle,
          width: 120,
          height: 2,
          left: -60,
          top: -1,
        }}
      />
      <div
        style={{
          ...lineStyle,
          width: 2,
          height: 120,
          left: -1,
          top: -60,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: '2px solid rgba(59, 130, 246, 0.8)',
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

export default OriginCross;
