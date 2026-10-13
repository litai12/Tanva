/**
 * Global keyboard shortcuts for undo/redo, save, and clipboard JSON helpers.
 */
import { useCallback, useEffect } from 'react';
import { historyService } from '@/services/historyService';
import { performManualSave } from '@/services/manualSaveService';
import { clipboardJsonService } from '@/services/clipboardJsonService';
import { clipboardService } from '@/services/clipboardService';
import { useTranslation } from 'react-i18next';
import { isShortcutSuppressed, useShortcutStore } from '@/stores/shortcutStore';
import type { ShortcutActionId } from '@/utils/keyboardShortcuts';

export default function KeyboardShortcuts() {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);

  useEffect(() => {
    const showToast = (message: string, type: "success" | "error" = "success") => {
      try {
        window.dispatchEvent(
          new CustomEvent("toast", { detail: { message, type } })
        );
      } catch {
        if (type === "error") {
          console.error(message);
        } else {
          console.log(message);
        }
      }
    };

    const onKeyDown = async (e: KeyboardEvent) => {
      if (e.defaultPrevented || isShortcutSuppressed(e)) return;
      const matches = (id: ShortcutActionId) => useShortcutStore.getState().matchesShortcut(id, e);
      const target = e.target as HTMLElement | null;
      const inChat = !!target?.closest?.("[data-chat-content]");
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      const inFlow = path.some(
        (el) =>
          el instanceof Element &&
          el.classList?.contains("tanva-flow-overlay")
      );

      if (matches('copyJson') || matches('pasteJson')) {
        const hasFlowPayload = !!clipboardService.getFlowData()?.nodes?.length;
        const shouldDelegateFlowShiftPaste =
          matches('pasteKeepLinks') &&
          (inFlow ||
            (clipboardService.getZone() === "flow" && hasFlowPayload));
        if (shouldDelegateFlowShiftPaste) return;

        if (matches('copyJson')) {
          e.preventDefault();
          try {
            if (inChat) {
              await clipboardJsonService.copyChatSessionsToClipboard();
              showToast(lt('已复制对话 JSON', 'Chat JSON copied'));
            } else {
              await clipboardJsonService.copyProjectContentToClipboard();
              showToast(lt('已复制画布 JSON', 'Canvas JSON copied'));
            }
          } catch (error) {
            console.error("快捷键复制 JSON 失败:", error);
            showToast(lt('复制失败，请重试', 'Copy failed, please try again'), "error");
          }
          return;
        }
        if (matches('pasteJson')) {
          e.preventDefault();
          try {
            if (inChat) {
              await clipboardJsonService.importChatSessionsFromClipboard();
              showToast(lt('已导入对话 JSON', 'Chat JSON imported'));
            } else {
              await clipboardJsonService.importProjectContentFromClipboard();
              showToast(lt('已导入画布 JSON', 'Canvas JSON imported'));
            }
          } catch (error) {
            console.error("快捷键导入 JSON 失败:", error);
            showToast(lt('导入失败，请检查剪贴板内容', 'Import failed. Please check clipboard content'), "error");
          }
          return;
        }
      }

      // Undo / Redo
      {
        if (matches('redo')) {
          e.preventDefault();
          await historyService.redo();
          return;
        }
        if (matches('undo')) {
          e.preventDefault();
          await historyService.undo();
          return;
        }
      }
      // Ctrl/Cmd + S 保存：与「保存」按钮共用 manualSaveService，
      // 不要在这里复制保存逻辑（历史上复制过一份，分叉后漏掉写缓存与 stale 判定，
      // 导致 Ctrl+S 后刷新必弹「内容已过期」、且服务端拒收时谎报保存成功）。
      if (matches('save')) {
        e.preventDefault();
        await performManualSave({ origin: 'keyboard', lt });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    historyService.captureInitialIfEmpty().catch(() => {});
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lt]);

  return null;
}
