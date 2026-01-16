import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, RefreshCw, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { projectApi, type WorkflowHistoryEntry } from "@/services/projectApi";
import { paperSaveService } from "@/services/paperSaveService";
import { flowSaveService } from "@/services/flowSaveService";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { getNonPersistableFlowImageNodeIds, getNonRemoteImageAssetIds } from "@/utils/projectContentValidation";

type WorkflowHistoryButtonProps = {
  projectId: string | null;
};

const PANEL_WIDTH = 360;

function formatZhDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export default function WorkflowHistoryButton({ projectId }: WorkflowHistoryButtonProps) {
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
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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

  const restore = useCallback(async (updatedAt: string) => {
    const storeBefore = useProjectContentStore.getState();
    if (!projectId || storeBefore.projectId !== projectId || storeBefore.saving) return;

    const confirmed = window.confirm("将覆盖当前工作流图并立即保存，是否继续？");
    if (!confirmed) return;

    setRestoring(updatedAt);
    try {
      const detail = await projectApi.getWorkflowHistory(projectId, updatedAt);
      const flow = detail?.flow;
      if (!flow || typeof flow !== "object") {
        throw new Error("历史版本缺少有效的 Flow 数据");
      }

      useProjectContentStore.getState().updatePartial({ flow: flow as any }, { markDirty: true });

      // 保存前补传/替换本地图片引用，避免把 blob:/data:/base64 落库
      await paperSaveService.saveImmediately();
      await flowSaveService.flushImageSplitInputImages();

      const store = useProjectContentStore.getState();
      if (!store.projectId || store.projectId !== projectId || !store.content) return;

      const invalidCanvasImageIds = getNonRemoteImageAssetIds(store.content);
      const invalidFlowNodeIds = getNonPersistableFlowImageNodeIds(store.content);
      if (invalidCanvasImageIds.length > 0 || invalidFlowNodeIds.length > 0) {
        const message = `存在未上传到 OSS 的图片（画布 ${invalidCanvasImageIds.length} 张，Flow ${invalidFlowNodeIds.length} 处），上传完成前无法保存`;
        try { store.setError(message); } catch {}
        return;
      }

      store.setSaving(true);
      const result = await projectApi.saveContent(projectId, {
        content: store.content,
        version: store.version,
        createWorkflowHistory: true,
      });
      store.markSaved(result.version, result.updatedAt ?? new Date().toISOString());

      await refresh();
      close();
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "恢复失败";
      try {
        useProjectContentStore.getState().setError(msg);
      } catch {}
    } finally {
      const storeAfter = useProjectContentStore.getState();
      if (storeAfter.projectId === projectId) {
        storeAfter.setSaving(false);
      }
      setRestoring(null);
    }
  }, [close, projectId, refresh]);

  const content = useMemo(() => {
    if (!projectId) {
      return <div className="p-3 text-xs text-slate-500">未打开项目</div>;
    }
    if (loading) {
      return <div className="p-3 text-xs text-slate-500">加载中...</div>;
    }
    if (error) {
      return <div className="p-3 text-xs text-red-600">{error}</div>;
    }
    if (items.length === 0) {
      return <div className="p-3 text-xs text-slate-500">暂无历史版本（手动保存会生成）</div>;
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
                {formatZhDateTime(item.updatedAt)}
              </div>
              <div className="text-xs text-slate-800">
                v{item.version} · 节点 {item.nodeCount} · 连线 {item.edgeCount}
              </div>
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
              onClick={() => restore(item.updatedAt)}
              title="恢复并保存"
            >
              <RotateCcw className="h-3 w-3" />
              恢复
            </button>
          </div>
        ))}
      </div>
    );
  }, [error, items, loading, projectId, restore, restoring]);

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
        title={canOpen ? "工作流历史" : "未打开项目"}
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
              <div className="text-sm font-medium text-slate-800">工作流历史</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                  onClick={() => refresh()}
                  title="刷新"
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "opacity-60")} />
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
                  onClick={close}
                  title="关闭"
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
