// 画板（Paper.js 图层）图片骤降判定。画板内容只存在 project.json 里、没有任何历史，
// 一次「画板未恢复就保存」会把全部图层图片永久覆盖掉（2026-10-24 项目 40993338）。
// 骤降时先把旧 project.json 复制一份，事故后可人工找回。

/** project.json 中画板图片数：assets.images 由前端按画板实际图片生成。 */
export function countPaperImages(content: unknown): number {
  const images = (content as any)?.assets?.images;
  return Array.isArray(images) ? images.length : 0;
}

/** 清空全部图片，或一次性减少过半且至少 3 张，视为疑似误覆盖。 */
export function isPaperImagePlunge(previous: number | undefined, incoming: number): boolean {
  if (typeof previous !== 'number' || previous <= 0) return false;
  if (incoming === 0) return true;
  return previous - incoming >= 3 && incoming < previous * 0.5;
}

export function paperBackupKey(prefix: string, previousVersion: number, now = Date.now()): string {
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return `${base}backups/paper-v${previousVersion}-${now}.json`;
}
