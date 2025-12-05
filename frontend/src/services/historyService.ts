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

    // 通知 UI 覆盖层回填
    try { window.dispatchEvent(new CustomEvent('history-restore', { detail: { assets: s.content.assets } })); } catch {}

    try { await paperSaveService.saveImmediately(); } catch {}
  } finally {
    st.restoring = false;
  }
}

export const historyService = {
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

