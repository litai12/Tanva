const DEFAULT_MIN_ZOOM = 0.1;
const DEFAULT_MAX_ZOOM = 3;
const DEFAULT_SMOOTHING = 0.35;
const DELTA_CLAMP = 240;
const EXP_FACTOR = 0.0012;

/**
 * Normalize wheel delta values across different deltaModes.
 * deltaMode: 0 => pixel, 1 => line, 2 => page.
 */
export function normalizeWheelDelta(delta: number, deltaMode?: number): number {
  if (deltaMode === 1) {
    return delta * 16;
  }
  if (deltaMode === 2) {
    return delta * 360;
  }
  return delta;
}

interface SmoothZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  smoothing?: number;
}

/**
 * Apply an exponential zoom response with damping so large deltas
 * (from trackpads or tablets) feel smoother.
 */
export function computeSmoothZoom(
  currentZoom: number,
  delta: number,
  options: SmoothZoomOptions = {},
): number {
  const { minZoom = DEFAULT_MIN_ZOOM, maxZoom = DEFAULT_MAX_ZOOM, smoothing = DEFAULT_SMOOTHING } = options;

  const clampedDelta = Math.max(-DELTA_CLAMP, Math.min(DELTA_CLAMP, delta));
  const targetZoom = currentZoom * Math.exp(-clampedDelta * EXP_FACTOR);
  const smoothedZoom = currentZoom + (targetZoom - currentZoom) * smoothing;

  if (Math.abs(smoothedZoom - currentZoom) < 1e-4) {
    return currentZoom;
  }

  return Math.max(minZoom, Math.min(maxZoom, smoothedZoom));
}
