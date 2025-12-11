import type { DrawMode } from '@/stores/toolStore';

const createCursorUrl = (
  svg: string,
  hotspot: { x: number; y: number } = { x: 12, y: 12 },
  fallback: string = 'auto'
) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot.x} ${hotspot.y}, ${fallback}`;

// 图片工具光标
const IMAGE_CURSOR = createCursorUrl(`
  <svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48' fill='none'>
    <rect x='1' y='1' width='22' height='22' rx='5' ry='5' fill='white' fill-opacity='0.92' stroke='%23333' stroke-width='1.2'/>
    <line x1='3.5' y1='12' x2='20.5' y2='12' stroke='%23333' stroke-width='1.6' stroke-linecap='round'/>
    <line x1='12' y1='3.5' x2='12' y2='20.5' stroke='%23333' stroke-width='1.6' stroke-linecap='round'/>
    <circle cx='12' cy='12' r='2' fill='%23333'/>
    <g transform='translate(21,6)'>
      <rect x='0' y='0' width='18' height='14' rx='3' ry='3' fill='white' fill-opacity='0.96' stroke='%23333' stroke-width='1.3'/>
      <rect x='2.4' y='2.8' width='13.2' height='8.6' rx='2.2' ry='2.2' fill='none' stroke='%23333' stroke-width='1.2'/>
      <circle cx='6.3' cy='5.6' r='1.4' fill='%23333'/>
      <path d='M4.2 10l2.8-3.1 2.4 2.3 2.2-2.7 2.4 2.8' stroke='%23333' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/>
    </g>
  </svg>
`, { x: 12, y: 12 }, 'crosshair');

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
