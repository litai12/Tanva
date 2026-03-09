const SKIP_BEFORE_UNLOAD_KEY = '__tanvaSkipBeforeUnloadCount__';
const SKIP_BEFORE_UNLOAD_EXPIRE_MS = 1500;

type WindowWithBeforeUnloadSkip = Window & {
  [SKIP_BEFORE_UNLOAD_KEY]?: number;
};

const getWindowRef = (): WindowWithBeforeUnloadSkip | null => {
  if (typeof window === 'undefined') return null;
  return window as WindowWithBeforeUnloadSkip;
};

export const requestSkipNextBeforeUnloadPrompt = () => {
  const win = getWindowRef();
  if (!win) return;

  win[SKIP_BEFORE_UNLOAD_KEY] = (win[SKIP_BEFORE_UNLOAD_KEY] ?? 0) + 1;

  // 下载触发失败时兜底清理，避免标记长期残留。
  window.setTimeout(() => {
    const current = win[SKIP_BEFORE_UNLOAD_KEY] ?? 0;
    if (current <= 0) return;
    win[SKIP_BEFORE_UNLOAD_KEY] = current - 1;
  }, SKIP_BEFORE_UNLOAD_EXPIRE_MS);
};

export const consumeBeforeUnloadPromptSkip = (): boolean => {
  const win = getWindowRef();
  if (!win) return false;
  const current = win[SKIP_BEFORE_UNLOAD_KEY] ?? 0;
  if (current <= 0) return false;
  win[SKIP_BEFORE_UNLOAD_KEY] = current - 1;
  return true;
};
