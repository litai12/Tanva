const DEFAULT_MIN_ZOOM = 0.1;
const DEFAULT_MAX_ZOOM = 3;
const DEFAULT_SMOOTHING = 0.55;
const DEFAULT_MAX_SMOOTHING = 0.85;
const DEFAULT_SENSITIVITY = 10; // 提升双指缩放的敏捷度
const RESPONSIVE_DELTA = 120;
const DELTA_CLAMP = 240;
const EXP_FACTOR = 0.0015;

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
  /**
   * >1 提升缩放力度，<1 降低缩放力度。
   */
  sensitivity?: number;
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
  const {
    minZoom = DEFAULT_MIN_ZOOM,
    maxZoom = DEFAULT_MAX_ZOOM,
    smoothing = DEFAULT_SMOOTHING,
    sensitivity = DEFAULT_SENSITIVITY,
  } = options;

  const clampedDelta = Math.max(-DELTA_CLAMP, Math.min(DELTA_CLAMP, delta));
  const sensitivityFactor = Math.max(0.1, sensitivity);
  const scaledDelta = clampedDelta * sensitivityFactor;
  const targetZoom = currentZoom * Math.exp(-scaledDelta * EXP_FACTOR);
  const baseSmoothing = Math.max(0, Math.min(0.95, smoothing));
  const deltaMagnitude = Math.abs(scaledDelta);
  const smoothingBoost =
    DEFAULT_MAX_SMOOTHING <= baseSmoothing
      ? 0
      : (DEFAULT_MAX_SMOOTHING - baseSmoothing) *
        Math.min(1, deltaMagnitude / RESPONSIVE_DELTA);
  const effectiveSmoothing = Math.min(
    DEFAULT_MAX_SMOOTHING,
    baseSmoothing + smoothingBoost,
  );
  const smoothedZoom =
    currentZoom + (targetZoom - currentZoom) * effectiveSmoothing;

  if (Math.abs(smoothedZoom - currentZoom) < 1e-4) {
    return currentZoom;
  }

  return Math.max(minZoom, Math.min(maxZoom, smoothedZoom));
}
