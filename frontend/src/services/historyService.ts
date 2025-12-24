import { useProjectContentStore } from '@/stores/projectContentStore';
import { paperSaveService } from '@/services/paperSaveService';
import type { ProjectContentSnapshot } from '@/types/project';

type Snapshot = {
  content: ProjectContentSnapshot;
  version: number;
  savedAt: string | null;
  label?: string;
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

async function captureCurrentSnapshot(
  label?: string,
  options?: { skipSave?: boolean },
): Promise<Snapshot | null> {
  if (!options?.skipSave) {
    try { await paperSaveService.saveImmediately(); } catch {}
  }
  const store = useProjectContentStore.getState();
  if (!store.projectId || !store.content) return null;
  return {
    content: cloneContent(store.content),
    version: store.version,
    savedAt: store.lastSavedAt,
    label,
  };
}

function sameIdSet(a: Array<{ id: string }> = [], b: Array<{ id: string }> = []) {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((x) => x.id).filter(Boolean));
  if (setA.size !== a.length) return false;
  for (const item of b) {
    if (!item?.id || !setA.has(item.id)) return false;
  }
  return true;
}

function shouldFastRestoreImages(from: Snapshot | null | undefined, to: Snapshot): boolean {
  const label = from?.label;
  if (label !== 'move-image' && label !== 'resize-image') return false;
  const fromImages = from?.content.assets?.images;
  const toImages = to.content.assets?.images;
  if (!Array.isArray(fromImages) || !Array.isArray(toImages)) return false;
  return sameIdSet(fromImages, toImages);
}

async function restoreSnapshot(to: Snapshot, opts?: { from?: Snapshot | null; op?: 'undo' | 'redo' }) {
  const store = useProjectContentStore.getState();
  if (!store.projectId) return;
  const pid = store.projectId;
  const st = getOrInitState(pid);
  st.restoring = true;
  try {
    // 恢复 store 内容
    useProjectContentStore.getState().hydrate(to.content, to.version, to.savedAt ?? undefined);

    // 撤销/重做属于“未保存变更”，不应因为 hydrate 被标记为 clean
    try {
      const now = Date.now();
      useProjectContentStore.setState((state) => ({
        ...state,
        dirty: true,
        dirtySince: state.dirtySince ?? now,
        dirtyCounter: state.dirtyCounter + 1,
      }));
    } catch {}

    // ✅ 快速路径：仅回放图片 bounds，避免全量 importJSON 导致全图闪烁/重载
    if (shouldFastRestoreImages(opts?.from, to)) {
      try {
        window.dispatchEvent(new CustomEvent('history:apply-image-snapshot', {
          detail: { images: to.content.assets?.images ?? [], reason: opts?.op ?? 'restore' },
        }));
      } catch {}
      try { paperSaveService.triggerAutoSave('history-fast-restore'); } catch {}
      return;
    }

    // 恢复 Paper 项目
    if (to.content.paperJson && to.content.paperJson.length > 0) {
      try { paperSaveService.deserializePaperProject(to.content.paperJson); } catch {}
    } else {
      try { paperSaveService.clearCanvasContent(); } catch {}
      // clearCanvasContent 只发 paper-project-cleared，这里补一个 changed 让 UI 重建实例
      try { window.dispatchEvent(new CustomEvent('paper-project-changed')); } catch {}
    }

    // deserializePaperProject 内部会自行 dispatch paper-project-changed（延迟），避免这里重复触发导致全量闪烁
    try { paperSaveService.triggerAutoSave('history-restore'); } catch {}
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
      // 初始快照通常已包含 paperJson/资产信息；避免强制 saveImmediately 造成首次 Ctrl+Z 卡顿
      const snap = await captureCurrentSnapshot('initial', { skipSave: true });
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
    const snap = await captureCurrentSnapshot(label);
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
    const from = st.present;
    const prev = st.past.pop()!;
    st.future.push(st.present);
    st.present = prev;
    await restoreSnapshot(prev, { from, op: 'undo' });
  },

  async redo() {
    const pid = getProjectId();
    if (!pid) return;
    const st = getOrInitState(pid);
    if (st.future.length === 0 || !st.present) return;
    const from = st.present;
    const next = st.future.pop()!;
    st.past.push(st.present);
    st.present = next;
    await restoreSnapshot(next, { from, op: 'redo' });
  }
};
