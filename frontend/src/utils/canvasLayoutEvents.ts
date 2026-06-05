export const TANVA_CANVAS_LAYOUT_CHANGED_EVENT = "tanva:canvas-layout-changed";
export const TANVA_PAPER_VIEW_RESIZED_EVENT = "tanva:paper-view-resized";

export const dispatchCanvasLayoutChanged = (detail?: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(TANVA_CANVAS_LAYOUT_CHANGED_EVENT, { detail })
    );
  } catch {}
};

export const dispatchPaperViewResized = (detail?: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(TANVA_PAPER_VIEW_RESIZED_EVENT, { detail })
    );
  } catch {}
};
