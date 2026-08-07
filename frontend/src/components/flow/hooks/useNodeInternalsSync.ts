import React from "react";
import { useUpdateNodeInternals } from "@xyflow/react";

const isFlowNodeDragging = (): boolean =>
  typeof document !== "undefined" &&
  Boolean(document.body?.classList.contains("tanva-flow-node-dragging"));

export const useNodeInternalsSync = (
  id: string,
  rootRef: React.RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown> = [],
  options: { disabled?: boolean } = {}
) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const rafRef = React.useRef<number | null>(null);
  const layoutRevisionRef = React.useRef(0);
  const lastSyncedSignatureRef = React.useRef<string | null>(null);
  const disabled = Boolean(options.disabled);
  const disabledRef = React.useRef(disabled);
  disabledRef.current = disabled;

  const scheduleSync = React.useCallback(() => {
    if (!id || disabledRef.current) return;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (disabledRef.current || isFlowNodeDragging()) return;

      const element = rootRef.current;
      if (!element) return;
      const { width, height } = element.getBoundingClientRect();
      const signature = `${id}:${Math.round(width * 10)}:${Math.round(height * 10)}:${layoutRevisionRef.current}`;
      if (signature === lastSyncedSignatureRef.current) return;

      lastSyncedSignatureRef.current = signature;
      try {
        updateNodeInternals(id);
      } catch {
        // The node can unmount between the observer callback and this frame.
      }
    });
  }, [id, rootRef, updateNodeInternals]);

  React.useEffect(() => {
    layoutRevisionRef.current += 1;
    scheduleSync();
    // Caller-controlled dependency list allows syncing after logical layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, scheduleSync, ...deps]);

  React.useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver !== "function") return;

    let observedWidth = -1;
    let observedHeight = -1;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round((entry?.contentRect.width ?? 0) * 10);
      const height = Math.round((entry?.contentRect.height ?? 0) * 10);
      if (width === observedWidth && height === observedHeight) return;
      observedWidth = width;
      observedHeight = height;
      scheduleSync();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [rootRef, scheduleSync]);
};

export const scheduleReactFlowNodeInternalsSync = (
  updateNodeInternals: ((ids: string | string[]) => void) | null | undefined,
  nodeIds: Iterable<string | null | undefined>
) => {
  if (!updateNodeInternals || typeof requestAnimationFrame !== "function") return;

  const ids = Array.from(
    new Set(
      Array.from(nodeIds)
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean)
    )
  );
  if (ids.length === 0) return;

  requestAnimationFrame(() => {
    if (isFlowNodeDragging()) return;
    try {
      updateNodeInternals(ids);
    } catch {
      // ReactFlow can skip internals updates for nodes that unmounted between frames.
    }
  });
};

export default useNodeInternalsSync;
