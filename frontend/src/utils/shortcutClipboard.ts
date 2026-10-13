import { isShortcutSuppressed } from '@/stores/shortcutStore';

/** Browser clipboard shortcuts still dispatch native events; remapped keys need an explicit bridge. */
export const isNativeClipboardShortcut = (event: KeyboardEvent, kind: 'copy' | 'paste'): boolean =>
  (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey &&
  event.key.toLowerCase() === (kind === 'copy' ? 'c' : 'v');

export const writeShortcutClipboard = (type: string, data: unknown): void => {
  const serialized = JSON.stringify({ type, version: 1, data });
  void navigator.clipboard?.writeText(serialized).catch(() => {});
};

/** Read the current system clipboard and reuse the existing file/structured-payload paste handlers. */
export const pasteShortcutClipboard = async (beforePaste?: () => void): Promise<void> => {
  const target = document.activeElement || document.body;
  try {
    const transfer = new DataTransfer();
    const setText = (type: string, value: string) => {
      transfer.setData(type, value);
      if (type === 'text/plain') {
        try {
          const payload = JSON.parse(value);
          if (payload && typeof payload === 'object' && ['tanva-canvas', 'tanva-flow'].includes(payload.type) && payload.data) {
            transfer.setData('application/json', value);
          }
        } catch { /* Plain text remains available to the existing paste handlers. */ }
      }
    };
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type.startsWith('text/') || type === 'application/json' || type.startsWith('application/x-tanva-')) {
            setText(type.startsWith('application/x-tanva-') ? 'application/json' : type, await blob.text());
          } else if (type.startsWith('image/')) {
            transfer.items.add(new File([blob], `clipboard.${type.split('/')[1] || 'png'}`, { type }));
          }
        }
      }
    } else if (navigator.clipboard?.readText) {
      setText('text/plain', await navigator.clipboard.readText());
    } else {
      throw new Error('Clipboard API unavailable');
    }
    // An asynchronous browser permission prompt may have moved focus into settings.
    if (isShortcutSuppressed() || document.activeElement !== target) return;
    if (!transfer.items.length) return;
    beforePaste?.();
    target.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: transfer, bubbles: true, cancelable: true,
    }));
  } catch {
    if (isShortcutSuppressed() || document.activeElement !== target) return;
    window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '无法读取系统剪贴板，请允许剪贴板访问后重试，或使用浏览器粘贴菜单', type: 'error' },
    }));
  }
};
