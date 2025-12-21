import paper from 'paper';

export function getDpr(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

// 将浏览器事件的 client 坐标转换为 Paper 的 project 坐标
export function clientToProject(canvas: HTMLCanvasElement, clientX: number, clientY: number): paper.Point {
  const rect = canvas.getBoundingClientRect();
  const dpr = getDpr();
  const vx = (clientX - rect.left) * dpr;
  const vy = (clientY - rect.top) * dpr;
  try {
    if (paper && paper.view && (paper.view as any).viewToProject) {
      return (paper.view as any).viewToProject(new paper.Point(vx, vy));
    }
  } catch {}
  return new paper.Point(vx, vy);
}

// 将 Paper 的 project 点转换为浏览器屏幕的 client 坐标
export function projectToClient(canvas: HTMLCanvasElement, projectPoint: paper.Point): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = getDpr();
  let v = { x: projectPoint.x, y: projectPoint.y } as any;
  try {
    if (paper && paper.view && (paper.view as any).projectToView) {
      v = (paper.view as any).projectToView(projectPoint);
    }
  } catch {}
  return { x: rect.left + v.x / dpr, y: rect.top + v.y / dpr };
}

// 将 Paper 的矩形（project 坐标）转换为 CSS 像素矩形
export function projectRectToClient(canvas: HTMLCanvasElement, rectInProject: paper.Rectangle) {
  const tl = projectToClient(canvas, rectInProject.topLeft);
  const br = projectToClient(canvas, rectInProject.bottomRight);
  return { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

/**
 * 检查 Paper.js Item 是否为 Raster 类型
 * 兼容生产环境代码压缩后 instanceof 失效的问题
 */
export function isRaster(item: paper.Item | null | undefined): item is paper.Raster {
  if (!item) return false;
  return item.className === 'Raster' || item instanceof paper.Raster;
}

/**
 * 检查 Paper.js Item 是否为 Path 类型
 * 兼容生产环境代码压缩后 instanceof 失效的问题
 */
export function isPath(item: paper.Item | null | undefined): item is paper.Path {
  if (!item) return false;
  return item.className === 'Path' || item instanceof paper.Path;
}

/**
 * 检查 Paper.js Item 是否为 PointText 类型
 * 兼容生产环境代码压缩后 instanceof 失效的问题
 */
export function isPointText(item: paper.Item | null | undefined): item is paper.PointText {
  if (!item) return false;
  return item.className === 'PointText' || item instanceof paper.PointText;
}

/**
 * 检查 Paper.js Item 是否为 Group 类型
 * 兼容生产环境代码压缩后 instanceof 失效的问题
 */
export function isGroup(item: paper.Item | null | undefined): item is paper.Group {
  if (!item) return false;
  return item.className === 'Group' || item instanceof paper.Group;
}
