export type CanvasViewportState = {
  panX?: number;
  panY?: number;
  zoom?: number;
};

export type FlowViewport = {
  x: number;
  y: number;
  zoom: number;
};

export const getDevicePixelRatio = (explicitDpr?: number): number => {
  const dpr =
    typeof explicitDpr === "number" && Number.isFinite(explicitDpr)
      ? explicitDpr
      : typeof window !== "undefined"
      ? window.devicePixelRatio || 1
      : 1;
  return dpr > 0 ? dpr : 1;
};

export const canvasStateToFlowViewport = (
  state: CanvasViewportState
): FlowViewport => {
  const zoom =
    typeof state.zoom === "number" && Number.isFinite(state.zoom) && state.zoom > 0
      ? state.zoom
      : 1;
  const panX =
    typeof state.panX === "number" && Number.isFinite(state.panX)
      ? state.panX
      : 0;
  const panY =
    typeof state.panY === "number" && Number.isFinite(state.panY)
      ? state.panY
      : 0;
  const dpr = getDevicePixelRatio();
  return {
    x: (panX * zoom) / dpr,
    y: (panY * zoom) / dpr,
    zoom,
  };
};

