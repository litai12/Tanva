import paper from 'paper';

export const PAPER_ERASER_TRAIL_TYPE = 'eraser-trail';

let paperEraserTrailSerial = 0;

export const markPaperEraserTrail = (path: paper.Path) => {
  paperEraserTrailSerial += 1;
  path.data = {
    ...(path.data || {}),
    type: PAPER_ERASER_TRAIL_TYPE,
    isEraserTrail: true,
    isActiveEraserTrail: true,
    isHelper: true,
    transient: true,
    createdAt: Date.now(),
    serial: paperEraserTrailSerial,
  };
};

export const isPaperEraserTrail = (item: paper.Item | null | undefined): item is paper.Path => {
  if (!item || !(item instanceof paper.Path)) return false;
  const data = item.data || {};
  if (data.type === PAPER_ERASER_TRAIL_TYPE || data.isEraserTrail === true) {
    return true;
  }

  const strokeColor = item.strokeColor;
  if (!strokeColor) return false;

  const isEraserRed =
    strokeColor.red > 0.95 &&
    strokeColor.green > 0.35 &&
    strokeColor.green < 0.48 &&
    strokeColor.blue > 0.35 &&
    strokeColor.blue < 0.48;
  const hasEraserDash =
    Array.isArray(item.dashArray) &&
    item.dashArray.length === 2 &&
    Math.abs(Number(item.dashArray[0]) - 5) < 0.6 &&
    Math.abs(Number(item.dashArray[1]) - 5) < 0.6;
  const isEraserOpacity = Number(item.opacity ?? 1) <= 0.75;
  return isEraserRed && hasEraserDash && isEraserOpacity;
};

export const hasActivePaperEraserTrail = () => {
  const project = paper.project;
  if (!project) return false;

  return project.getItems({
    match: (item: paper.Item) =>
      isPaperEraserTrail(item) && item.data?.isActiveEraserTrail === true,
  }).length > 0;
};

export const isActivePaperEraserTrail = (item: paper.Item | null | undefined) =>
  isPaperEraserTrail(item) && item.data?.isActiveEraserTrail === true;

export const getPaperEraserTrailSerialSnapshot = () => paperEraserTrailSerial;

export const clearPaperEraserTrails = (options?: {
  createdBeforeOrAt?: number;
  serialBeforeOrAt?: number;
  skipIfActive?: boolean;
}) => {
  const project = paper.project;
  if (!project) return 0;
  if (options?.skipIfActive && hasActivePaperEraserTrail()) return 0;
  const cutoff = options?.createdBeforeOrAt;
  const serialCutoff = options?.serialBeforeOrAt;

  const trails = project.getItems({
    match: (item: paper.Item) => {
      if (!isPaperEraserTrail(item)) return false;
      if (typeof serialCutoff === 'number') {
        const serial = Number(item.data?.serial || 0);
        return !Number.isFinite(serial) || serial <= serialCutoff;
      }
      if (typeof cutoff !== 'number') return true;
      const createdAt = Number(item.data?.createdAt || 0);
      return !Number.isFinite(createdAt) || createdAt <= cutoff;
    },
  }) as paper.Path[];

  trails.forEach((trail) => {
    try {
      trail.remove();
    } catch {
      // Ignore Paper cleanup errors for stale transient paths.
    }
  });

  if (trails.length > 0) {
    try {
      paper.view.update();
    } catch {
      // Ignore view update failures during teardown.
    }
  }

  return trails.length;
};
