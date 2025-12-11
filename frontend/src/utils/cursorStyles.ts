import type { DrawMode } from '@/stores/toolStore';

const createCursorUrl = (svg: string, hotspot: { x: number; y: number } = { x: 12, y: 12 }) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot.x} ${hotspot.y}, auto`;

// 图片工具光标
const IMAGE_CURSOR = createCursorUrl(`
  <svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none'>
    <circle cx='12' cy='12' r='11' fill='white' fill-opacity='0.95' stroke='%23222' stroke-width='1.4'/>
    <rect x='6.25' y='7' width='11.5' height='9.5' rx='2.1' ry='2.1' stroke='%23222' stroke-width='1.6'/>
    <circle cx='10' cy='10.2' r='1.2' fill='%23222'/>
    <path d='M8.3 14.4l2.7-3.1 2.1 2.3 2.6-3 2.3 2.8' stroke='%23222' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/>
  </svg>
`);

// 3D 模型工具光标
const MODEL_CURSOR = createCursorUrl(`
  <svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none'>
    <circle cx='12' cy='12' r='11' fill='white' fill-opacity='0.95' stroke='%23222' stroke-width='1.4'/>
    <path d='M7.5 8.8l4.5-2.4 4.5 2.4v6.5l-4.5 2.4-4.5-2.4z' stroke='%23222' stroke-width='1.6' stroke-linejoin='round'/>
    <path d='M7.5 8.8l4.5 2.3 4.5-2.3m-4.5 2.3v6.6' stroke='%23222' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/>
  </svg>
`);

const CUSTOM_CURSOR_MARKER = 'data:image/svg+xml';

export const getCursorForDrawMode = (mode?: DrawMode | string | null): string | null => {
  if (mode === 'image') return IMAGE_CURSOR;
  if (mode === '3d-model') return MODEL_CURSOR;
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
