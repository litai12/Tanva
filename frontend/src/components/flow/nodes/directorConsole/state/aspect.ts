import type { AspectKey } from '../types'

const RATIOS: Record<Exclude<AspectKey, 'auto'>, number> = {
  '21:9': 21 / 9,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
}

/** 返回画幅宽高比（auto 时用传入的视口比值） */
export function aspectRatio(key: AspectKey, viewportRatio: number): number {
  return key === 'auto' ? viewportRatio : RATIOS[key]
}

const LONG_EDGE = 1280

/** 按画幅算截图像素尺寸，长边固定 1280 */
export function captureSize(key: AspectKey, viewportRatio: number): { width: number; height: number } {
  const r = aspectRatio(key, viewportRatio)
  if (r >= 1) return { width: LONG_EDGE, height: Math.round(LONG_EDGE / r) }
  return { width: Math.round(LONG_EDGE * r), height: LONG_EDGE }
}
