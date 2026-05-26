import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { ToastKind } from '@/collab/types';

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

export interface CollabToastApi {
  show: (text: string, kind: ToastKind) => void;
}

const KIND_COLOR: Record<ToastKind, string> = {
  upload: '#3b82f6',
  generate: '#10b981',
  delete: '#ef4444',
  share: '#8b5cf6',
  info: '#6b7280',
};

const TOAST_TTL = 4000;

interface Props {
  apiRef: (api: CollabToastApi) => void;
}

const CollabToastHost: React.FC<Props> = ({ apiRef }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const show = useCallback((text: string, kind: ToastKind) => {
    const id = ++idRef.current;
    setItems((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TTL);
  }, []);

  useEffect(() => {
    apiRef({ show });
  }, [apiRef, show]);

  if (items.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 9100,
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'rgba(17,24,39,0.92)',
            color: 'white',
            fontSize: 12,
            borderLeft: `4px solid ${KIND_COLOR[t.kind] ?? KIND_COLOR.info}`,
            maxWidth: 320,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            pointerEvents: 'auto',
            animation: 'collabToastEnter 180ms ease-out',
          }}
        >
          {t.text}
        </div>
      ))}
      <style>{`
        @keyframes collabToastEnter {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default CollabToastHost;
