import paper from 'paper';

export interface ImageGroupMetadata {
  originalWidth?: number;
  originalHeight?: number;
  fileName?: string;
  uploadMethod?: string;
  aspectRatio?: number;
  remoteUrl?: string;
  [key: string]: unknown;
}

export interface EnsureImageGroupStructureOptions {
  raster: paper.Raster;
  imageId: string;
  group?: paper.Group | null;
  bounds?: paper.Rectangle;
  ensureImageRect?: boolean;
  ensureSelectionArea?: boolean;
  handleSize?: number;
  metadata?: ImageGroupMetadata;
}

export interface EnsureImageGroupStructureResult {
  group: paper.Group;
  raster: paper.Raster;
  imageRect: paper.Path.Rectangle | null;
  selectionArea: paper.Path.Rectangle | null;
  selectionBorder: paper.Path.Rectangle;
  handles: paper.Path[];
}

const DEFAULT_HANDLE_SIZE = 12;

const createImageRect = (
  group: paper.Group,
  raster: paper.Raster,
  bounds: paper.Rectangle
): paper.Path.Rectangle => {
  const existing = group.children.find(
    item => item instanceof paper.Path && item.data?.isImageHitRect
  ) as paper.Path.Rectangle | undefined;

  if (existing) {
    existing.remove();
  }

  const rectangle = new paper.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);

  const imageRect = new paper.Path.Rectangle({
    rectangle,
    strokeColor: null,
    fillColor: null
  });
  imageRect.data = {
    isImageHitRect: true,
    isHelper: true
  };

  imageRect.insertBelow(raster);
  return imageRect;
};

const createSelectionArea = (
  group: paper.Group,
  raster: paper.Raster,
  bounds: paper.Rectangle
): paper.Path.Rectangle => {
  const existing = group.children.find(
    item => item instanceof paper.Path && item.data?.type === 'image-selection-area'
  ) as paper.Path.Rectangle | undefined;

  if (existing) {
    existing.remove();
  }

  const rectangle = new paper.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);

  const selectionArea = new paper.Path.Rectangle({
    rectangle,
    fillColor: new paper.Color(0, 0, 0, 0.001),
    strokeColor: null,
    visible: true,
    selected: false
  });
  selectionArea.data = {
    type: 'image-selection-area',
    imageId: raster.data?.imageId,
    isHelper: true
  };

  selectionArea.insertAbove(raster);
  return selectionArea;
};

const createSelectionBorder = (
  group: paper.Group,
  raster: paper.Raster,
  selectionArea: paper.Path.Rectangle | null,
  bounds: paper.Rectangle
): paper.Path.Rectangle => {
  const existing = group.children.find(
    item => item instanceof paper.Path && item.data?.isSelectionBorder
  ) as paper.Path.Rectangle | undefined;

  if (existing) {
    existing.remove();
  }

  const rectangle = new paper.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);

  const selectionBorder = new paper.Path.Rectangle({
    rectangle,
    strokeColor: new paper.Color('#3b82f6'),
    strokeWidth: 2,
    fillColor: null,
    selected: false,
    visible: false
  });
  selectionBorder.data = {
    isSelectionBorder: true,
    isHelper: true
  };

  if (selectionArea) {
    selectionBorder.insertAbove(selectionArea);
  } else {
    selectionBorder.insertAbove(raster);
  }

  return selectionBorder;
};

const createHandles = (
  group: paper.Group,
  selectionBorder: paper.Path.Rectangle,
  bounds: paper.Rectangle,
  imageId: string,
  handleSize: number
): paper.Path[] => {
  const existingHandles = group.children.filter(
    item => item instanceof paper.Path && item.data?.isResizeHandle
  ) as paper.Path[];
  existingHandles.forEach(handle => handle.remove());

  const halfSize = handleSize / 2;
  const handleColor = new paper.Color('#3b82f6');

  const positions: Array<{ direction: string; point: [number, number] }> = [
    { direction: 'nw', point: [bounds.left, bounds.top] },
    { direction: 'ne', point: [bounds.right, bounds.top] },
    { direction: 'sw', point: [bounds.left, bounds.bottom] },
    { direction: 'se', point: [bounds.right, bounds.bottom] }
  ];

  const handles = positions.map(({ direction, point }) => {
    const handle = new paper.Path.Rectangle({
      point: [point[0] - halfSize, point[1] - halfSize],
      size: [handleSize, handleSize],
      fillColor: 'white',
      strokeColor: handleColor,
      strokeWidth: 2,
      selected: false,
      visible: false
    });
    handle.data = {
      isResizeHandle: true,
      direction,
      imageId,
      isHelper: true
    };
    handle.insertAbove(selectionBorder);
    return handle;
  });

  return handles;
};

export const ensureImageGroupStructure = (
  options: EnsureImageGroupStructureOptions
): EnsureImageGroupStructureResult => {
  const {
    raster,
    imageId,
    group: maybeGroup,
    bounds,
    ensureImageRect = true,
    ensureSelectionArea = true,
    handleSize = DEFAULT_HANDLE_SIZE,
    metadata
  } = options;

  const rasterParent = raster.parent;
  let group = maybeGroup || (rasterParent instanceof paper.Group ? rasterParent : null);
  if (!group) {
    group = new paper.Group([raster]);
  } else if (!group.children.includes(raster)) {
    group.addChild(raster);
  }

  const resolvedBounds = bounds || raster.bounds;
  const rectangle = new paper.Rectangle(
    resolvedBounds.x,
    resolvedBounds.y,
    resolvedBounds.width,
    resolvedBounds.height
  );

  const mergedRasterData = {
    ...(raster.data || {}),
    type: 'image',
    imageId,
    ...metadata
  };
  raster.data = mergedRasterData;

  group.data = {
    ...(group.data || {}),
    type: 'image',
    imageId,
    isHelper: false
  };

  let imageRect: paper.Path.Rectangle | null = null;
  if (ensureImageRect) {
    imageRect = createImageRect(group, raster, rectangle);
  }

  const selectionArea = ensureSelectionArea ? createSelectionArea(group, raster, rectangle) : null;

  const selectionBorder = createSelectionBorder(group, raster, selectionArea, rectangle);

  const handles = createHandles(group, selectionBorder, rectangle, imageId, handleSize);

  return {
    group,
    raster,
    imageRect,
    selectionArea,
    selectionBorder,
    handles
  };
};
