// 最近一次「保存成功」的 paperJson 本地备份：云端加载失败时用于兜底恢复画布
// （见 ProjectAutosaveManager 的 tanva_last_good_snapshot_ 读取分支）。
// 保存成功的三条路径（自动保存 / 保存按钮 / Ctrl+S）共用此处，避免各写一份后分叉。

// 超过此长度不写本地备份：localStorage 配额有限，大快照写入必失败，
// 反而会把该项目已有的、可用的旧备份挤掉。
const MAX_LOCAL_SNAPSHOT_LENGTH = 2 * 1024 * 1024;

export function writeLastGoodSnapshot(
  projectId: string,
  snapshot: { version: number; updatedAt: string | null; paperJson?: string }
): void {
  try {
    const paperJson = snapshot.paperJson;
    if (!paperJson || paperJson.length === 0) return;
    if (paperJson.length > MAX_LOCAL_SNAPSHOT_LENGTH) {
      console.warn('skip local snapshot: paperJson too large', {
        length: paperJson.length,
        projectId,
      });
      return;
    }
    localStorage.setItem(
      `tanva_last_good_snapshot_${projectId}`,
      JSON.stringify({
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        paperJson,
      })
    );
  } catch {
    // 配额/隐私模式等写入失败不影响保存主流程
  }
}
