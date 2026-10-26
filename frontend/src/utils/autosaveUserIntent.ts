/**
 * 自动保存的用户意图门禁。
 *
 * 打开/切换项目后，系统自身会持续改写内容 store：水合、画板恢复、图片解码、节点重排、
 * 协作补丁、缓存校验等。这些都不是用户操作；若加载或恢复没有成功，它们触发的自动保存会把
 * 不完整的运行时内容写回云端，永久覆盖已有数据（2026-10-24 项目 40993338 的图层图片即如此丢失）。
 *
 * 因此每次加载项目都重新计时：只有用户在本次加载之后产生过真实输入（浏览器 isTrusted 的
 * 指针 / 键盘 / 粘贴 / 拖放 / 输入事件），自动保存才允许写云端。手动保存由调用方显式标记。
 */
const USER_INTENT_EVENTS = ['pointerdown', 'keydown', 'paste', 'drop', 'input'];

type IntentTarget = Pick<EventTarget, 'addEventListener'>;

let armedProjectId: string | null = null;
let intended = false;
const installedTargets = new WeakSet<object>();

const onUserEvent = (event: Event) => {
  // 代码派发的事件（dispatchEvent / element.click()）不是用户操作。
  if (!event.isTrusted) return;
  if (armedProjectId) intended = true;
};

export function installAutosaveUserIntentListener(target?: IntentTarget): void {
  const host = target ?? (typeof window !== 'undefined' ? window : undefined);
  if (!host || installedTargets.has(host)) return;
  installedTargets.add(host);
  // 捕获阶段：先于 Ctrl+S 等快捷键处理函数记下意图。
  USER_INTENT_EVENTS.forEach((type) => host.addEventListener(type, onUserEvent, { capture: true, passive: true }));
}

/** 开始加载（或清空）项目时调用：此前的操作不代表对新内容的意图。 */
export function armAutosaveUserIntent(projectId: string | null): void {
  installAutosaveUserIntentListener();
  armedProjectId = projectId;
  intended = false;
}

/** 手动保存等明确的用户动作，不依赖输入事件监听。 */
export function markAutosaveUserIntent(projectId: string | null | undefined): void {
  if (!projectId || projectId !== armedProjectId) return;
  intended = true;
}

export function hasAutosaveUserIntent(projectId: string | null | undefined): boolean {
  return !!projectId && armedProjectId === projectId && intended;
}
