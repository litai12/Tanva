import React, { useEffect, useMemo, useState } from 'react';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { saveMonitor } from '@/utils/saveMonitor';

export default function SaveDebugPanel() {
  const projectId = useProjectContentStore((s) => s.projectId);
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    if (!projectId) return;
    const update = () => setEvents(saveMonitor.get(projectId));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [projectId]);

  const show = useMemo(() => {
    try {
      const search = typeof window !== 'undefined' ? window.location.search : '';
      return search.includes('save-debug=1');
    } catch { return false; }
  }, []);

  if (!show || !projectId) return null;

  return (
    <div style={{ position: 'fixed', right: 10, bottom: 10, zIndex: 9999 }}>
      <div style={{ background: 'rgba(0,0,0,0.75)', color: '#0f0', fontFamily: 'monospace', fontSize: 11, padding: 8, borderRadius: 6, maxHeight: 240, width: 360, overflow: 'auto' }}>
        <div style={{ marginBottom: 6 }}>SaveDebug project={projectId}</div>
        {events.slice(-40).map((e, i) => (
          <div key={i}>
            {new Date(e.ts).toLocaleTimeString()} | {e.t} | {JSON.stringify(e.data)}
          </div>
        ))}
      </div>
    </div>
  );
}

