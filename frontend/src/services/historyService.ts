import { useProjectContentStore } from '@/stores/projectContentStore';
import { paperSaveService } from '@/services/paperSaveService';
import type { ProjectContentSnapshot } from '@/types/project';

type Snapshot = {
  content: ProjectContentSnapshot;
  version: number;
  savedAt: string | null;
};

type HistoryState = {
  past: Snapshot[];
  present: Snapshot | null;
  future: Snapshot[];
  restoring: boolean;
};

const MAX_DEPTH = 50;
const projectHistory = new Map<string, HistoryState>();

function getProjectId(): string | null {
  try { return useProjectContentStore.getState().projectId; } catch { return null; }
}

function getOrInitState(pid: string): HistoryState {
  let st = projectHistory.get(pid);
  if (!st) {
    st = { past: [], present: null, future: [], restoring: false };
    projectHistory.set(pid, st);
  }
  return st;
}

function cloneContent(content: ProjectContentSnapshot): ProjectContentSnapshot {
  return JSON.parse(JSON.stringify(content));
}

async function captureCurrentSnapshot(): Promise<Snapshot | null> {
  try { await paperSaveService.saveImmediately(); } catch {}
  const store = useProjectContentStore.getState();
  if (!store.projectId || !store.content) return null;
  return {
    content: cloneContent(store.content),
    version: store.version,
    savedAt: store.lastSavedAt,
  };
}

async function restoreSnapshot(s: Snapshot) {
  const store = useProjectContentStore.getState();
  if (!store.projectId) return;
  const pid = store.projectId;
  const st = getOrInitState(pid);
  st.restoring = true;
  try {
    // 恢复 store 内容
    useProjectContentStore.getState().hydrate(s.content, s.version, s.savedAt ?? undefined);

    // 恢复 Paper 项目
    if (s.content.paperJson && s.content.paperJson.length > 0) {
      try { paperSaveService.deserializePaperProject(s.content.paperJson); } catch {}
    } else {
      try { paperSaveService.clearCanvasContent(); } catch {}
    }

    // 触发 paper-project-changed 事件，让 DrawingController 从 Paper.js 对象重建 React 状态
    // 这比 history-restore + hydrateFromSnapshot 更可靠，因为不会重建 Paper.js 对象
    try { window.dispatchEvent(new CustomEvent('paper-project-changed')); } catch {}

    try { await paperSaveService.saveImmediately(); } catch {}
  } finally {
    st.restoring = false;
  }
}

export type HistoryDebugInfo = {
  pastCount: number;
  futureCount: number;
  present: {
    version: number;
    savedAt: string | null;
    layerCount: number;
    assetCount: { images: number; models: number; texts: number };
    hasFlow: boolean;
    hasPaperJson: boolean;
    paperJsonLen: number;
  } | null;
  pastSnapshots: Array<{
    index: number;
    version: number;
    savedAt: string | null;
    layerCount: number;
    assetCount: { images: number; models: number; texts: number };
    hasFlow: boolean;
    hasPaperJson: boolean;
    paperJsonLen: number;
  }>;
  futureSnapshots: Array<{
    index: number;
    version: number;
    savedAt: string | null;
    layerCount: number;
    assetCount: { images: number; models: number; texts: number };
    hasFlow: boolean;
    hasPaperJson: boolean;
    paperJsonLen: number;
  }>;
};

function snapshotToDebugInfo(s: Snapshot, index: number) {
  return {
    index,
    version: s.version,
    savedAt: s.savedAt,
    layerCount: s.content.layers?.length ?? 0,
    assetCount: {
      images: s.content.assets?.images?.length ?? 0,
      models: s.content.assets?.models?.length ?? 0,
      texts: s.content.assets?.texts?.length ?? 0,
    },
    hasFlow: !!(s.content.flow?.nodes?.length || s.content.flow?.edges?.length),
    hasPaperJson: !!(s.content.paperJson && s.content.paperJson.length > 0),
    paperJsonLen: s.content.paperJson?.length ?? 0,
  };
}

export const historyService = {
  getDebugInfo(): HistoryDebugInfo | null {
    const pid = getProjectId();
    if (!pid) return null;
    const st = projectHistory.get(pid);
    if (!st) return { pastCount: 0, futureCount: 0, present: null, pastSnapshots: [], futureSnapshots: [] };

    return {
      pastCount: st.past.length,
      futureCount: st.future.length,
      present: st.present ? {
        version: st.present.version,
        savedAt: st.present.savedAt,
        layerCount: st.present.content.layers?.length ?? 0,
        assetCount: {
          images: st.present.content.assets?.images?.length ?? 0,
          models: st.present.content.assets?.models?.length ?? 0,
          texts: st.present.content.assets?.texts?.length ?? 0,
        },
        hasFlow: !!(st.present.content.flow?.nodes?.length || st.present.content.flow?.edges?.length),
        hasPaperJson: !!(st.present.content.paperJson && st.present.content.paperJson.length > 0),
        paperJsonLen: st.present.content.paperJson?.length ?? 0,
      } : null,
      pastSnapshots: st.past.map((s, i) => snapshotToDebugInfo(s, i)),
      futureSnapshots: st.future.map((s, i) => snapshotToDebugInfo(s, i)),
    };
  },

  async captureInitialIfEmpty() {
    const pid = getProjectId();
    if (!pid) return;
    const st = getOrInitState(pid);
    if (!st.present) {
      const snap = await captureCurrentSnapshot();
      if (snap) {
        st.present = snap;
        st.past = [];
        st.future = [];
      }
    }
  },

  async commit(label?: string) {
    const pid = getProjectId();
    if (!pid) return;
    const st = getOrInitState(pid);
    if (st.restoring) return;
    const snap = await captureCurrentSnapshot();
    if (!snap) return;
    if (st.present) {
      st.past.push(st.present);
      if (st.past.length > MAX_DEPTH) st.past.shift();
    }
    st.present = snap;
    st.future = [];
  },

  async undo() {
    const pid = getProjectId();
    if (!pid) return;
    const st = getOrInitState(pid);
    if (!st.present) await this.captureInitialIfEmpty();
    if (st.past.length === 0 || !st.present) return;
    const prev = st.past.pop()!;
    st.future.push(st.present);
    st.present = prev;
    await restoreSnapshot(prev);
  },

  async redo() {
    const pid = getProjectId();
    if (!pid) return;
    const st = getOrInitState(pid);
    if (st.future.length === 0 || !st.present) return;
    const next = st.future.pop()!;
    st.past.push(st.present);
    st.present = next;
    await restoreSnapshot(next);
  }
};

