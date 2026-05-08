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

export type FlowViewportAnchor = {
  x?: number;
  y?: number;
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
  state: CanvasViewportState,
  anchor?: FlowViewportAnchor | null
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
  const anchorX =
    typeof anchor?.x === "number" && Number.isFinite(anchor.x) ? anchor.x : 0;
  const anchorY =
    typeof anchor?.y === "number" && Number.isFinite(anchor.y) ? anchor.y : 0;
  return {
    x: snapFlowViewportTranslate((panX * zoom) / dpr, {
      anchor: anchorX,
      dpr,
      zoom,
    }),
    y: snapFlowViewportTranslate((panY * zoom) / dpr, {
      anchor: anchorY,
      dpr,
      zoom,
    }),
    zoom,
  };
};

export const snapFlowViewportTranslate = (
  value: number,
  options?: {
    anchor?: number;
    dpr?: number;
    zoom?: number;
  }
): number => {
  if (!Number.isFinite(value)) return 0;
  const dpr = getDevicePixelRatio(options?.dpr);
  const zoom =
    typeof options?.zoom === "number" &&
    Number.isFinite(options.zoom) &&
    options.zoom > 0
      ? options.zoom
      : 1;
  const anchor =
    typeof options?.anchor === "number" && Number.isFinite(options.anchor)
      ? options.anchor
      : 0;
  return Math.round((value + anchor * zoom) * dpr) / dpr - anchor * zoom;
};
