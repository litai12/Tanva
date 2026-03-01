import type { DrawMode } from '@/stores/toolStore';

const CUSTOM_CURSOR_MARKER = 'data:image/svg+xml';

export const getCursorForDrawMode = (_mode?: DrawMode | string | null): string | null => {
  // 图像工具和3D模型工具使用默认光标
  return null;
};

export const applyCursorForDrawMode = (canvas: HTMLCanvasElement | null, mode?: DrawMode | string | null) => {
  if (!canvas) return;
  const cursor = getCursorForDrawMode(mode);

  if (cursor) {
    canvas.style.cursor = cursor;
    return;
  }

  // 离开自定义光标时，如果当前是自定义图标则恢复默认
  if (canvas.style.cursor.includes(CUSTOM_CURSOR_MARKER)) {
    canvas.style.cursor = 'default';
  }
};
