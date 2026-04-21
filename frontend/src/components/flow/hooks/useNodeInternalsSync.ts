import React from "react";
import { useUpdateNodeInternals } from "reactflow";

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
        if (
          typeof document !== "undefined" &&
          document.body?.classList.contains("tanva-flow-node-dragging")
        ) {
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

export default useNodeInternalsSync;
