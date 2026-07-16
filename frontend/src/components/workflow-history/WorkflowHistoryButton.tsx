import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, RefreshCw, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { projectApi, type WorkflowHistoryEntry } from "@/services/projectApi";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { performManualSave } from "@/services/manualSaveService";
import { useTranslation } from "react-i18next";

type WorkflowHistoryButtonProps = {
  projectId: string | null;
};

const PANEL_WIDTH = 360;

function formatDateTime(value: string, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(locale, { hour12: false });
}

export default function WorkflowHistoryButton({ projectId }: WorkflowHistoryButtonProps) {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || "")
    .toLowerCase()
    .startsWith("zh");
  const locale = isZh ? "zh-CN" : "en-US";
  const lt = useCallback((zhText: string, enText: string) => (isZh ? zhText : enText), [isZh]);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WorkflowHistoryEntry[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const canOpen = Boolean(projectId);

  const cancelClose = useCallback(() => {
    if (!closeTimerRef.current) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    if (pinned) return;
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 180);
  }, [cancelClose, pinned]);

  const updatePanelPos = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 12;
    const top = rect.bottom + 8;
    let left = rect.right - PANEL_WIDTH;
    left = Math.min(left, window.innerWidth - PANEL_WIDTH - margin);
    left = Math.max(margin, left);
    setPanelPos({ top, left });
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await projectApi.listWorkflowHistory(projectId, { limit: 50 });
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : lt("加载失败", "Load failed"));
    } finally {
      setLoading(false);
    }
  }, [lt, projectId]);

  const close = useCallback(() => {
    cancelClose();
    setOpen(false);
    setPinned(false);
  }, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    updatePanelPos();
    const onMove = () => updatePanelPos();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, updatePanelPos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [close, open]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const restore = useCallback(async (entry: WorkflowHistoryEntry) => {
    const storeBefore = useProjectContentStore.getState();
    if (!projectId || storeBefore.projectId !== projectId || storeBefore.saving || storeBefore.manualSaving) return;

    const confirmed = window.confirm(
      lt(
        "将覆盖当前工作流图并立即保存，是否继续？",
        "This will overwrite the current workflow and save immediately. Continue?"
      )
    );
    if (!confirmed) return;

    setRestoring(entry.updatedAt);
    try {
      const detail = await projectApi.getWorkflowHistory(projectId, entry.updatedAt);
      const flow = detail?.flow;
      if (!flow || typeof flow !== "object") {
        throw new Error(
          lt(
            "历史版本缺少有效的 Flow 数据",
            "Selected history version is missing valid Flow data"
          )
        );
      }

      useProjectContentStore.getState().updatePartial({ flow: flow as any }, { markDirty: true });

      // 落盘走 manualSaveService（与保存按钮/Ctrl+S 同一实现）：图片 flush、sanitize、
      // stale 判定、写本地缓存、跨 tab 广播都在里面，不要在这里复制。
      const outcome = await performManualSave({
        origin: 'history-restore',
        lt,
        workflowHistoryMeta: {
          restoredFromUpdatedAt: entry.updatedAt,
          restoredFromVersion: entry.version,
        },
      });
      // 未落盘（被拒/被阻止/出错）时不关面板，让用户看到 store 里的告警并可重试。
      if (outcome !== 'saved') return;

      await refresh();
      close();
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : lt("恢复失败", "Restore failed");
      try {
        useProjectContentStore.getState().setError(msg);
      } catch {}
    } finally {
      // manualSaving 由 manualSaveService 自行置位/复位，这里不要越俎代庖清它，
      // 否则会误清掉其它在途保存的标志。
      setRestoring(null);
    }
  }, [close, lt, projectId, refresh]);

  const content = useMemo(() => {
    if (!projectId) {
      return <div className="p-3 text-xs text-slate-500">{lt("未打开项目", "No project opened")}</div>;
    }
    if (loading) {
      return <div className="p-3 text-xs text-slate-500">{lt("加载中...", "Loading...")}</div>;
    }
    if (error) {
      return <div className="p-3 text-xs text-red-600">{error}</div>;
    }
    if (items.length === 0) {
      return <div className="p-3 text-xs text-slate-500">{lt("暂无历史版本（手动保存会生成）", "No history versions yet (created by manual save)")}</div>;
    }

    return (
      <div className="max-h-[360px] overflow-y-auto p-2">
        {items.map((item) => (
          <div
            key={`${item.updatedAt}_${item.version}`}
            className="group flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-slate-50"
          >
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500">
                {formatDateTime(item.updatedAt, locale)}
              </div>
              <div className="text-xs text-slate-800">
                {lt(
                  `v${item.version} · 节点 ${item.nodeCount} · 连线 ${item.edgeCount}`,
                  `v${item.version} · Nodes ${item.nodeCount} · Edges ${item.edgeCount}`
                )}
              </div>
              {item.restoredFromUpdatedAt && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {lt("恢复记录", "Restored")}
                  </span>
                  <span className="text-[11px] text-amber-700">
                    {lt(
                      `来源 v${item.restoredFromVersion ?? "?"} · ${formatDateTime(item.restoredFromUpdatedAt, locale)}`,
                      `From v${item.restoredFromVersion ?? "?"} · ${formatDateTime(item.restoredFromUpdatedAt, locale)}`
                    )}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs",
                "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                "opacity-0 group-hover:opacity-100 transition-opacity",
                restoring === item.updatedAt && "opacity-100 cursor-not-allowed"
              )}
              disabled={Boolean(restoring)}
              onClick={() => restore(item)}
              title={lt("恢复并保存", "Restore and save")}
            >
              <RotateCcw className="h-3 w-3" />
              {lt("恢复", "Restore")}
            </button>
          </div>
        ))}
      </div>
    );
  }, [error, items, loading, locale, lt, projectId, restore, restoring]);

  return (
    <>
      <Button
        ref={anchorRef}
        variant="ghost"
        size="sm"
        disabled={!canOpen}
        className={cn(
          "p-0 text-gray-600 transition-all duration-200 border rounded-full h-7 w-7",
          "bg-liquid-glass-light backdrop-blur-minimal border-liquid-glass-light hover:bg-liquid-glass-hover",
          pinned && "bg-liquid-glass-hover"
        )}
        title={canOpen ? lt("工作流历史", "Workflow history") : lt("未打开项目", "No project opened")}
        onMouseEnter={() => {
          if (!canOpen) return;
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={() => {
          if (!canOpen) return;
          scheduleClose();
        }}
        onClick={() => {
          if (!canOpen) return;
          cancelClose();
          setOpen(true);
          setPinned((prev) => {
            const next = !prev;
            if (!next) setOpen(false);
            return next;
          });
        }}
      >
        <History className="w-4 h-4" />
      </Button>

      {open && panelPos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[1000] overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur-xl"
            style={{ top: panelPos.top, left: panelPos.left, width: PANEL_WIDTH }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2">
              <div className="text-sm font-medium text-slate-800">
                {lt("工作流历史", "Workflow history")}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                  onClick={() => refresh()}
                  title={lt("刷新", "Refresh")}
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "opacity-60")} />
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                  onClick={close}
                  title={lt("关闭", "Close")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
