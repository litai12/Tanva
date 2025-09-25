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
  return paper.view.viewToProject(new paper.Point(vx, vy));
}

// 将 Paper 的 project 点转换为浏览器屏幕的 client 坐标
export function projectToClient(canvas: HTMLCanvasElement, projectPoint: paper.Point): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = getDpr();
  const v = paper.view.projectToView(projectPoint);
  return { x: rect.left + v.x / dpr, y: rect.top + v.y / dpr };
}

// 将 Paper 的矩形（project 坐标）转换为 CSS 像素矩形
export function projectRectToClient(canvas: HTMLCanvasElement, rectInProject: paper.Rectangle) {
  const tl = projectToClient(canvas, rectInProject.topLeft);
  const br = projectToClient(canvas, rectInProject.bottomRight);
  return { left: tl.x, top: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

