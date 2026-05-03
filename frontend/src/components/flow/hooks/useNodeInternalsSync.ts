import React from "react";
import { useUpdateNodeInternals } from "reactflow";

const isFlowNodeDragging = (): boolean =>
  typeof document !== "undefined" &&
  Boolean(document.body?.classList.contains("tanva-flow-node-dragging"));

export const useNodeInternalsSync = (
  id: string,
  rootRef: React.RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown> = []
) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const rafRef = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    if (!id) return;
    updateNodeInternals(id);
    // Caller-controlled dependency list allows syncing after logical layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, updateNodeInternals, ...deps]);

  React.useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver !== "function") return;

    const observer = new ResizeObserver(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (isFlowNodeDragging()) {
          return;
        }
        updateNodeInternals(id);
      });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [id, rootRef, updateNodeInternals]);
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
