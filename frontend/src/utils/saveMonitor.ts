type SaveEvent = {
  t: string; // event type
  ts: number; // timestamp
  data?: any;
};

const MAX_EVENTS = 200;
const KEY_PREFIX = 'tanva_save_events_';

function getKey(projectId: string) {
  return `${KEY_PREFIX}${projectId}`;
}

export const saveMonitor = {
  push(projectId: string | null, type: string, data?: any) {
    if (!projectId) return;
    try {
      const key = getKey(projectId);
      const raw = localStorage.getItem(key);
      const arr: SaveEvent[] = raw ? JSON.parse(raw) : [];
      arr.push({ t: type, ts: Date.now(), data });
      while (arr.length > MAX_EVENTS) arr.shift();
      localStorage.setItem(key, JSON.stringify(arr));
      // also expose to window for quick debugging
      (window as any).__saveEvents = (window as any).__saveEvents || {};
      const perProject = (window as any).__saveEvents;
      perProject[projectId] = arr;
    } catch {}
  },
  get(projectId: string | null): SaveEvent[] {
    if (!projectId) return [];
    try {
      const key = getKey(projectId);
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
};

export function attachGlobalDump() {
  try {
    (window as any).dumpSaveLog = (projectId: string) => {
       
      console.log('SaveEvents', saveMonitor.get(projectId));
    };
  } catch {}
}

