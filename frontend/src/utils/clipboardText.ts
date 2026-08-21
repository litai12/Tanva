type DesktopClipboardBridge = {
  writeText: (text: string) => Promise<boolean>;
};

const desktopClipboard = (): DesktopClipboardBridge | null => {
  if (typeof window === "undefined") return null;
  return window.tanvaDesktop?.clipboard || null;
};

const writeWithLegacySelection = (text: string): boolean => {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  return copied;
};

/**
 * Copy text in browsers and packaged Electron builds.
 * `navigator.clipboard` is unavailable on some `file://` renderers, so the
 * desktop bridge is authoritative there and the selection fallback covers
 * older browser contexts.
 */
export const writeClipboardText = async (text: string): Promise<void> => {
  if (!text) throw new Error("没有可复制的内容");

  const desktop = desktopClipboard();
  if (desktop) {
    const copied = await desktop.writeText(text);
    if (!copied) throw new Error("系统剪贴板写入失败");
    return;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (!writeWithLegacySelection(text)) {
    throw new Error("当前环境不支持复制，请手动选择内容");
  }
};
