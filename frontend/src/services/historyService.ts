import { useProjectContentStore } from '@/stores/projectContentStore';
import { paperSaveService } from '@/services/paperSaveService';
import type { ProjectContentSnapshot } from '@/types/project';

type Snapshot = {
  content: ProjectContentSnapshot;
  version: number;
  savedAt: string | null;
  label?: string;
  // 增量存储相关字段
  isIncremental?: boolean;           // 是否为增量快照
  baseSnapshotIndex?: number;        // 基准快照索引（用于增量恢复）
  paperJsonDelta?: string;           // paperJson 的增量数据（如果是增量快照）
};

type HistoryState = {
  past: Snapshot[];
  present: Snapshot | null;
  future: Snapshot[];
  restoring: boolean;
  // 增量存储：保留最近一个完整快照作为基准
  lastFullSnapshot?: Snapshot | null;
  lastFullSnapshotIndex?: number;
};

// ============ 内存优化配置 ============
const MAX_DEPTH = 30;                          // 降低最大深度：50 -> 30
const MAX_TOTAL_PAPER_JSON_CHARS = 15_000_000; // 降低预算：30MB -> 15MB
const FULL_SNAPSHOT_INTERVAL = 5;              // 每 5 个快照保存一个完整快照
const INCREMENTAL_THRESHOLD = 50_000;          // paperJson 超过 50KB 才使用增量存储
const projectHistory = new Map<string, HistoryState>();

function getProjectId(): string | null {
  try { return useProjectContentStore.getState().projectId; } catch { return null; }
}

function getOrInitState(pid: string): HistoryState {
  let st = projectHistory.get(pid);
  if (!st) {
    st = { past: [], present: null, future: [], restoring: false, lastFullSnapshot: null, lastFullSnapshotIndex: -1 };
    projectHistory.set(pid, st);
  }
  return st;
}

// ============ 增量存储工具函数 ============

/**
 * 计算两个字符串的简单差异（轻量级实现）
 * 返回: { type: 'full' | 'delta', data: string, savings: number }
 */
function computeStringDelta(base: string | undefined, current: string | undefined): {
  type: 'full' | 'delta';
  data: string;
  savings: number;
} {
  if (!base || !current) {
    return { type: 'full', data: current || '', savings: 0 };
  }

  // 如果当前字符串较小，直接存储完整版本
  if (current.length < INCREMENTAL_THRESHOLD) {
    return { type: 'full', data: current, savings: 0 };
  }

  // 简单的前缀/后缀匹配压缩
  let prefixLen = 0;
  let suffixLen = 0;
  const minLen = Math.min(base.length, current.length);

  // 找共同前缀
  while (prefixLen < minLen && base[prefixLen] === current[prefixLen]) {
    prefixLen++;
  }

  // 找共同后缀（避免与前缀重叠）
  const maxSuffixLen = minLen - prefixLen;
  while (suffixLen < maxSuffixLen &&
         base[base.length - 1 - suffixLen] === current[current.length - 1 - suffixLen]) {
    suffixLen++;
  }

  // 提取差异部分
  const diffStart = prefixLen;
  const diffEnd = current.length - suffixLen;
  const diff = current.slice(diffStart, diffEnd);

  // 构建增量数据: "prefixLen|suffixLen|diff"
  const deltaData = `${prefixLen}|${suffixLen}|${diff}`;

  // 只有当增量数据明显小于原数据时才使用增量存储（至少节省 30%）
  const savings = current.length - deltaData.length;
  if (savings > current.length * 0.3) {
    return { type: 'delta', data: deltaData, savings };
  }

  return { type: 'full', data: current, savings: 0 };
}

/**
 * 从增量数据恢复完整字符串
 */
function applyStringDelta(base: string | undefined, deltaData: string): string {
  if (!base || !deltaData) return deltaData || '';

  const firstPipe = deltaData.indexOf('|');
  const secondPipe = deltaData.indexOf('|', firstPipe + 1);

  if (firstPipe === -1 || secondPipe === -1) {
    // 无效的增量格式，返回原数据
    return deltaData;
  }

  const prefixLen = parseInt(deltaData.slice(0, firstPipe), 10);
  const suffixLen = parseInt(deltaData.slice(firstPipe + 1, secondPipe), 10);
  const diff = deltaData.slice(secondPipe + 1);

  if (isNaN(prefixLen) || isNaN(suffixLen)) {
    return deltaData;
  }

  const prefix = base.slice(0, prefixLen);
  const suffix = suffixLen > 0 ? base.slice(-suffixLen) : '';

  return prefix + diff + suffix;
}

/**
 * 创建增量快照（如果适用）
 */
function createIncrementalSnapshot(
  content: ProjectContentSnapshot,
  st: HistoryState,
  currentIndex: number
): { content: ProjectContentSnapshot; isIncremental: boolean; baseIndex?: number; delta?: string } {
  const paperJson = content.paperJson;

  // 检查是否应该创建完整快照
  const shouldCreateFullSnapshot =
    !st.lastFullSnapshot ||
    currentIndex % FULL_SNAPSHOT_INTERVAL === 0 ||
    !paperJson ||
    paperJson.length < INCREMENTAL_THRESHOLD;

  if (shouldCreateFullSnapshot) {
    return { content, isIncremental: false };
  }

  // 尝试创建增量快照
  const basePaperJson = st.lastFullSnapshot?.content.paperJson;
  const deltaResult = computeStringDelta(basePaperJson, paperJson);

  if (deltaResult.type === 'delta' && deltaResult.savings > 0) {
    // 创建不含 paperJson 的内容副本
    const lightContent: ProjectContentSnapshot = {
      ...content,
      paperJson: undefined, // 移除完整 paperJson
      meta: {
        ...content.meta,
        paperJsonLen: paperJson.length,
        isIncremental: true,
      },
    };

    return {
      content: lightContent,
      isIncremental: true,
      baseIndex: st.lastFullSnapshotIndex,
      delta: deltaResult.data,
    };
  }

  return { content, isIncremental: false };
}

/**
 * 恢复增量快照为完整快照
 */
function resolveIncrementalSnapshot(snapshot: Snapshot, st: HistoryState): Snapshot {
  if (!snapshot.isIncremental || !snapshot.paperJsonDelta) {
    return snapshot;
  }

  // 找到基准快照
  const baseSnapshot = st.lastFullSnapshot;
  if (!baseSnapshot?.content.paperJson) {
    console.warn('[History] 无法找到基准快照，返回原快照');
    return snapshot;
  }

  // 恢复完整 paperJson
  const fullPaperJson = applyStringDelta(baseSnapshot.content.paperJson, snapshot.paperJsonDelta);

  return {
    ...snapshot,
    content: {
      ...snapshot.content,
      paperJson: fullPaperJson,
    },
    isIncremental: false,
    paperJsonDelta: undefined,
  };
}

function cloneContent(content: ProjectContentSnapshot): ProjectContentSnapshot {
  // structuredClone 对大型字符串更友好（避免 JSON.parse/stringify 带来的额外复制与峰值内存）
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(content);
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(content));
}

/**
 * 获取快照的实际内存占用（考虑增量存储）
 */
function getSnapshotMemorySize(snapshot: Snapshot | null | undefined): number {
  if (!snapshot) return 0;
  // 增量快照只计算 delta 大小
  if (snapshot.isIncremental && snapshot.paperJsonDelta) {
    return snapshot.paperJsonDelta.length;
  }
  return snapshot.content.paperJson?.length ?? 0;
}

function getPaperJsonLen(snapshot: Snapshot | null | undefined): number {
  if (!snapshot) return 0;
  return snapshot.content.paperJson?.length ?? 0;
}

function trimHistoryByBudget(st: HistoryState): void {
  // 使用新的内存计算方式
  let total = getSnapshotMemorySize(st.present);
  for (const s of st.past) total += getSnapshotMemorySize(s);
  for (const s of st.future) total += getSnapshotMemorySize(s);

  if (total <= MAX_TOTAL_PAPER_JSON_CHARS) return;

  // 优先丢弃最老的 undo 历史
  while (st.past.length > 0 && total > MAX_TOTAL_PAPER_JSON_CHARS) {
    const removed = st.past.shift();
    if (!removed) break;
    total -= getSnapshotMemorySize(removed);

    // 如果移除的是基准快照，需要更新基准
    if (!removed.isIncremental && st.past.length > 0) {
      // 找到下一个完整快照作为新基准
      for (let i = 0; i < st.past.length; i++) {
        if (!st.past[i].isIncremental) {
          st.lastFullSnapshot = st.past[i];
          st.lastFullSnapshotIndex = i;
          break;
        }
      }
    }
  }

  // 仍超预算时，丢弃最老的 redo 历史
  while (st.future.length > 0 && total > MAX_TOTAL_PAPER_JSON_CHARS) {
    const removed = st.future.shift();
    if (!removed) break;
    total -= getSnapshotMemorySize(removed);
  }
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
        // 初始快照作为基准快照
        st.lastFullSnapshot = snap;
        st.lastFullSnapshotIndex = 0;
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

    // 计算当前快照索引
    const currentIndex = st.past.length + 1;

    // 尝试创建增量快照
    const incrementalResult = createIncrementalSnapshot(snap.content, st, currentIndex);

    // 构建最终快照
    const finalSnap: Snapshot = {
      ...snap,
      content: incrementalResult.content,
      isIncremental: incrementalResult.isIncremental,
      baseSnapshotIndex: incrementalResult.baseIndex,
      paperJsonDelta: incrementalResult.delta,
    };

    if (st.present) {
      st.past.push(st.present);
      if (st.past.length > MAX_DEPTH) st.past.shift();
    }
    st.present = finalSnap;
    st.future = [];

    // 更新基准快照（如果是完整快照）
    if (!incrementalResult.isIncremental && snap.content.paperJson) {
      st.lastFullSnapshot = snap;
      st.lastFullSnapshotIndex = currentIndex;
    }

    trimHistoryByBudget(st);
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
    trimHistoryByBudget(st);
    // 恢复增量快照为完整快照后再应用
    const resolvedPrev = resolveIncrementalSnapshot(prev, st);
    await restoreSnapshot(resolvedPrev, { from, op: 'undo' });
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
    trimHistoryByBudget(st);
    // 恢复增量快照为完整快照后再应用
    const resolvedNext = resolveIncrementalSnapshot(next, st);
    await restoreSnapshot(resolvedNext, { from, op: 'redo' });
  },

  // 新增：获取内存使用统计
  getMemoryStats(): { totalChars: number; snapshotCount: number; incrementalCount: number } {
    const pid = getProjectId();
    if (!pid) return { totalChars: 0, snapshotCount: 0, incrementalCount: 0 };
    const st = projectHistory.get(pid);
    if (!st) return { totalChars: 0, snapshotCount: 0, incrementalCount: 0 };

    let totalChars = getPaperJsonLen(st.present);
    let incrementalCount = st.present?.isIncremental ? 1 : 0;

    for (const s of st.past) {
      totalChars += s.isIncremental ? (s.paperJsonDelta?.length ?? 0) : getPaperJsonLen(s);
      if (s.isIncremental) incrementalCount++;
    }
    for (const s of st.future) {
      totalChars += s.isIncremental ? (s.paperJsonDelta?.length ?? 0) : getPaperJsonLen(s);
      if (s.isIncremental) incrementalCount++;
    }

    return {
      totalChars,
      snapshotCount: st.past.length + st.future.length + (st.present ? 1 : 0),
      incrementalCount,
    };
  },

  // 新增：清理历史记录释放内存
  clearHistory() {
    const pid = getProjectId();
    if (!pid) return;
    const st = projectHistory.get(pid);
    if (!st) return;
    st.past = [];
    st.future = [];
    st.lastFullSnapshot = st.present;
    st.lastFullSnapshotIndex = 0;
    console.log('[History] 历史记录已清理');
  }
};
