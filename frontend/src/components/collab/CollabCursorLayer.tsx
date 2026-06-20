import React from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import { projectToClient } from '@/utils/paperCoords';
import type { PeerCursor } from '@/hooks/usePresence';

interface Props {
  cursors: Record<string, PeerCursor>;
}

/**
 * Renders other collaborators' cursors as fixed-position DOM overlays.
 *
 * Cursor positions arrive as canvas world coordinates (Paper project coords),
 * which are identical for every client regardless of their pan/zoom/window.
 * We project them back through THIS client's viewport so the cursor lands on
 * the same canvas content the sender was pointing at — true cross-viewport
 * alignment. Subscribing to the local viewport (zoom/panX/panY) re-projects
 * the cursors whenever the local user pans or zooms.
 */
const CollabCursorLayer: React.FC<Props> = ({ cursors }) => {
  // 订阅本地视口：平移/缩放时触发重渲染，从而重新投影对端光标。
  const viewportKey = useCanvasStore((s) => `${s.zoom}:${s.panX}:${s.panY}`);

  const entries = Object.values(cursors);
  if (entries.length === 0) return null;

  const canvas = (paper?.view?.element as HTMLCanvasElement | undefined) ?? null;
  const project = (c: PeerCursor): { x: number; y: number } => {
    if (canvas && paper?.view) {
      try {
        return projectToClient(canvas, new paper.Point(c.x, c.y));
      } catch {
        /* fall through */
      }
    }
    return { x: c.x, y: c.y };
  };

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9000]"
      style={{ position: 'fixed', inset: 0 }}
      data-viewport={viewportKey}
    >
      {entries.map((c) => {
        const screen = project(c);
        return (
          <div
            key={c.userId}
            style={{
              position: 'absolute',
              left: screen.x,
              top: screen.y,
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
        );
      })}
    </div>
  );
};

export default CollabCursorLayer;
