import paper from 'paper';
import { isGroup, isPath, isRaster } from '@/utils/paperCoords';

export const IMAGE_GROUP_BLOCK_TYPE = 'image-group';

export interface CreateImageGroupBlockOptions {
  padding?: number;
  radius?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

const DEFAULT_PADDING = 20;
const DEFAULT_RADIUS = 16;
const DEFAULT_FILL = '#e5e7eb';
const DEFAULT_STROKE = '#d1d5db';
const DEFAULT_STROKE_WIDTH = 1;

const applyBlockStyle = (block: paper.Path) => {
  if (!block) return;
  const data = (block.data || {}) as any;
  const fillColor = typeof data.fillColor === 'string' && data.fillColor.trim() ? data.fillColor.trim() : DEFAULT_FILL;
  const strokeColor =
    typeof data.strokeColor === 'string' && data.strokeColor.trim() ? data.strokeColor.trim() : DEFAULT_STROKE;
  const strokeWidthRaw = typeof data.strokeWidth === 'number' ? data.strokeWidth : DEFAULT_STROKE_WIDTH;
  const strokeWidth = Number.isFinite(strokeWidthRaw) ? Math.max(0, strokeWidthRaw) : DEFAULT_STROKE_WIDTH;

  try { block.fillColor = fillColor ? new paper.Color(fillColor) : null; } catch {}
  try { block.strokeColor = strokeWidth > 0 ? new paper.Color(strokeColor) : null; } catch {}
  try { block.strokeWidth = strokeWidth; } catch {}
};

const uniqStrings = (values: unknown[]): string[] => {
  const set = new Set<string>();
  values.forEach((value) => {
    if (typeof value === 'string' && value.trim()) set.add(value.trim());
  });
  return Array.from(set);
};

const normalizeImageIdList = (value: unknown): string[] => {
  if (Array.isArray(value)) return uniqStrings(value);
  return [];
};

const findImagePaperItem = (imageId: string): paper.Item | null => {
  if (!paper.project || !imageId) return null;
  try {
    const matches = paper.project.getItems({
      match: (item: any) => item?.data?.type === 'image' && item?.data?.imageId === imageId,
    }) as paper.Item[];
    if (matches.length > 0) return matches[0] ?? null;
  } catch {}
  return null;
};

export const getImagePaperBounds = (imageId: string): paper.Rectangle | null => {
  const item = findImagePaperItem(imageId);
  if (!item) return null;

  if (isGroup(item)) {
    const raster = item.children.find((child) => isRaster(child)) as paper.Raster | undefined;
    const rect = raster?.bounds || item.bounds;
    return rect ? rect.clone() : null;
  }

  if (isRaster(item)) {
    return item.bounds.clone();
  }

  return item.bounds ? item.bounds.clone() : null;
};

const calculateUnionBounds = (rects: paper.Rectangle[]): paper.Rectangle | null => {
  let union: paper.Rectangle | null = null;
  rects.forEach((rect) => {
    if (!rect) return;
    union = union ? union.unite(rect) : rect.clone();
  });
  return union;
};

const getGroupBlockPadding = (item: paper.Item): number => {
  const value = (item.data as any)?.padding;
  const num = typeof value === 'number' ? value : DEFAULT_PADDING;
  return Number.isFinite(num) ? Math.max(0, num) : DEFAULT_PADDING;
};

const getGroupBlockRadius = (item: paper.Item): number => {
  const value = (item.data as any)?.radius;
  const num = typeof value === 'number' ? value : DEFAULT_RADIUS;
  return Number.isFinite(num) ? Math.max(0, num) : DEFAULT_RADIUS;
};

export const getImageGroupBlocks = (): paper.Path[] => {
  if (!paper.project) return [];
  try {
    const items = paper.project.getItems({
      match: (item: any) => item?.data?.type === IMAGE_GROUP_BLOCK_TYPE,
    }) as paper.Item[];
    return items.filter((item): item is paper.Path => isPath(item));
  } catch {
    return [];
  }
};

export const updateImageGroupBlockBounds = (block: paper.Path): boolean => {
  if (!block || !isPath(block)) return false;
  const imageIds = normalizeImageIdList((block.data as any)?.imageIds);
  if (imageIds.length === 0) {
    try { block.remove(); } catch {}
    return false;
  }

  const rects = imageIds
    .map((id) => getImagePaperBounds(id))
    .filter((rect): rect is paper.Rectangle => !!rect);
  const validImageIds = imageIds.filter((id) => !!getImagePaperBounds(id));

  if (validImageIds.length < 2 || rects.length < 2) {
    try { block.remove(); } catch {}
    return false;
  }

  const union = calculateUnionBounds(rects);
  if (!union || union.isEmpty()) return false;

  const padding = getGroupBlockPadding(block);
  const padded = new paper.Rectangle(
    union.x - padding,
    union.y - padding,
    union.width + padding * 2,
    union.height + padding * 2
  );

  try {
    (block.data as any).imageIds = validImageIds;
  } catch {}

  try {
    block.bounds = padded;
  } catch {}

  applyBlockStyle(block);
  return true;
};

export const syncImageGroupBlocksForImageIds = (changedImageIds: string[]) => {
  const ids = uniqStrings(changedImageIds);
  if (ids.length === 0) return;

  getImageGroupBlocks().forEach((block) => {
    const imageIds = normalizeImageIdList((block.data as any)?.imageIds);
    if (imageIds.some((id) => ids.includes(id))) {
      updateImageGroupBlockBounds(block);
    }
  });
};

export const createImageGroupBlock = (
  imageIdsInput: string[],
  options?: CreateImageGroupBlockOptions
): { block: paper.Path.Rectangle | null; reason?: string } => {
  const imageIds = uniqStrings(imageIdsInput);
  if (imageIds.length < 2) {
    return { block: null, reason: 'need-2-images' };
  }

  const paperItems = imageIds
    .map((id) => findImagePaperItem(id))
    .filter((item): item is paper.Item => !!item);
  if (paperItems.length < 2) {
    return { block: null, reason: 'missing-images' };
  }

  const layers = uniqStrings(paperItems.map((item) => (item.layer?.name ? String(item.layer.name) : '')));
  const uniqueLayers = layers.filter((name) => !!name);
  if (uniqueLayers.length !== 1) {
    return { block: null, reason: 'different-layers' };
  }

  const targetLayer = paperItems[0].layer;
  if (!targetLayer) {
    return { block: null, reason: 'no-layer' };
  }

  const rects = imageIds
    .map((id) => getImagePaperBounds(id))
    .filter((rect): rect is paper.Rectangle => !!rect);
  const union = calculateUnionBounds(rects);
  if (!union || union.isEmpty()) {
    return { block: null, reason: 'invalid-bounds' };
  }

  const padding = Math.max(0, options?.padding ?? DEFAULT_PADDING);
  const radius = Math.max(0, options?.radius ?? DEFAULT_RADIUS);
  const fillColor = options?.fillColor ?? DEFAULT_FILL;
  const strokeColor = options?.strokeColor ?? DEFAULT_STROKE;
  const strokeWidth = Math.max(0, options?.strokeWidth ?? DEFAULT_STROKE_WIDTH);

  const padded = new paper.Rectangle(
    union.x - padding,
    union.y - padding,
    union.width + padding * 2,
    union.height + padding * 2
  );

  const groupId = `image_group_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const block = new paper.Path.Rectangle({
    rectangle: padded,
    radius,
    fillColor: new paper.Color(fillColor),
    strokeColor: strokeWidth > 0 ? new paper.Color(strokeColor) : null,
    strokeWidth,
    selected: false,
    visible: true,
    insert: false,
  }) as paper.Path.Rectangle;

  block.data = {
    ...(block.data || {}),
    type: IMAGE_GROUP_BLOCK_TYPE,
    groupId,
    imageIds,
    padding,
    radius,
    fillColor,
    strokeColor,
    strokeWidth,
    isHelper: false,
  };

  // Insert behind all selected images within the same layer.
  let insertIndex = targetLayer.children.length;
  const indices = paperItems
    .map((item) => targetLayer.children.indexOf(item))
    .filter((idx) => idx >= 0);
  if (indices.length > 0) {
    insertIndex = Math.min(...indices);
  }

  try {
    targetLayer.insertChild(insertIndex, block);
  } catch {
    try { targetLayer.addChild(block); } catch {}
  }

  return { block, reason: undefined };
};
