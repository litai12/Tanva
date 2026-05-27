import React from 'react';
import type { PeerCursor } from '@/hooks/usePresence';

interface Props {
  cursors: Record<string, PeerCursor>;
}

/**
 * Renders other collaborators' cursors as fixed-position DOM overlays.
 *
 * NOTE: v1 uses raw screen coordinates from the sender's viewport, so cursors
 * will appear at the same pixel position regardless of the local zoom/pan.
 * For pixel-perfect alignment across zoomed canvases we would need to send
 * world coordinates and project them through the local Paper.js viewport.
 */
const CollabCursorLayer: React.FC<Props> = ({ cursors }) => {
  const entries = Object.values(cursors);
  if (entries.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9000]"
      style={{ position: 'fixed', inset: 0 }}
    >
      {entries.map((c) => (
        <div
          key={c.userId}
          style={{
            position: 'absolute',
            left: c.x,
            top: c.y,
            transform: 'translate(-2px, -2px)',
            pointerEvents: 'none',
            transition: 'left 80ms linear, top 80ms linear',
          }}
        >
          <svg width="20" height="22" viewBox="0 0 20 22">
            <path
              d="M2 1 L18 11 L11 13 L8 20 Z"
              fill={c.color ?? '#3b82f6'}
              stroke="white"
              strokeWidth="1.5"
            />
          </svg>
          <div
            style={{
              marginTop: 2,
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 11,
              color: 'white',
              background: c.color ?? '#3b82f6',
              whiteSpace: 'nowrap',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
            }}
          >
            {c.name}
          </div>
        </div>
      ))}
    </div>
  );
};

export default CollabCursorLayer;
