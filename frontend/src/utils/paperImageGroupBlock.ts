import paper from 'paper';
import { isGroup, isPath, isRaster } from '@/utils/paperCoords';

export const IMAGE_GROUP_BLOCK_TYPE = 'image-group';

export interface CreateImageGroupBlockOptions {
  padding?: number;
  radius?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  title?: string;
}

const DEFAULT_PADDING = 20;
const DEFAULT_RADIUS = 16;
const DEFAULT_FILL = '#e5e7eb';
const DEFAULT_STROKE = '#d1d5db';
const DEFAULT_STROKE_WIDTH = 1;
const TITLE_HEIGHT = 32;
const TITLE_FONT_SIZE = 24;
const TITLE_COLOR = '#374151';
const IMAGE_FILE_EXTENSION_RE = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;

export const formatImageGroupTitle = (rawTitle: string | null | undefined): string => {
  if (typeof rawTitle !== 'string') return '未命名组';
  let title = rawTitle.trim();
  if (!title) return '未命名组';

  // Remove URL query/hash and keep basename (in case a path is passed).
  title = title.split(/[?#]/)[0] || title;
  const parts = title.split(/[\\/]/);
  title = parts[parts.length - 1] || title;

  // Strip common image extension.
  title = title.replace(IMAGE_FILE_EXTENSION_RE, '');

  // Strip ai-generated prefix like:
  // - ai_generated_xxx
  // - ai-generated-xxx
  // - ai generate(d) xxx
  title = title.replace(/^ai\s*[_-\s]*generate(?:d)?\s*[_-\s]*/i, '');
  title = title.replace(/^[_-\s]+/, '');

  title = title.trim();
  return title || '未命名组';
};

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

export const findImagePaperItem = (imageId: string): paper.Item | null => {
  if (!paper.project || !imageId) return null;
  try {
    const matches = paper.project.getItems({
      match: (item: any) => item?.data?.type === 'image' && item?.data?.imageId === imageId,
    }) as paper.Item[];
    if (matches.length > 0) {
      // 兼容：同一个 imageId 可能同时标在 Group 与其内部 Raster 上。
      // 这里必须优先返回顶层 Group，否则后续 insertChild 会拿到 -1 导致组块被插到最上层，
      // 从而出现“打组不整齐/拖不动/点击错对象”等问题（X2 更容易触发）。
      // 同时要避免返回“无 Raster 的孤儿组”（可能由 source 切换触发重复初始化造成）。
      const groupWithRaster = matches.find((item) => {
        if (!isGroup(item)) return false;
        const children = (item as paper.Group).children || [];
        return children.some((child) => isRaster(child));
      });
      if (groupWithRaster) return groupWithRaster;

      const group = matches.find((item) => isGroup(item));
      if (group) return group;
      const raster = matches.find((item) => isRaster(item));
      if (raster) return raster;
      return matches[0] ?? null;
    }
  } catch {}
  return null;
};

export const getImagePaperBounds = (imageId: string): paper.Rectangle | null => {
  const item = findImagePaperItem(imageId);
  if (!item) return null;

  const readCachedBounds = (data: any): paper.Rectangle | null => {
    const raw = data?.__tanvaBounds;
    if (!raw || typeof raw !== 'object') return null;
    const x = (raw as any)?.x;
    const y = (raw as any)?.y;
    const width = (raw as any)?.width;
    const height = (raw as any)?.height;
    const valid =
      typeof x === 'number' && Number.isFinite(x) &&
      typeof y === 'number' && Number.isFinite(y) &&
      typeof width === 'number' && Number.isFinite(width) &&
      typeof height === 'number' && Number.isFinite(height) &&
      width > 0 &&
      height > 0;
    if (!valid) return null;
    try {
      return new paper.Rectangle(x, y, width, height);
    } catch {
      return null;
    }
  };

  if (isGroup(item)) {
    const raster = item.children.find((child) => isRaster(child)) as paper.Raster | undefined;
    const rect = raster?.bounds || item.bounds;
    if (rect && rect.width > 0 && rect.height > 0) {
      return rect.clone();
    }
    const cached = readCachedBounds((raster as any)?.data) || readCachedBounds((item as any)?.data);
    if (cached) return cached;
    return rect ? rect.clone() : null;
  }

  if (isRaster(item)) {
    const rect = item.bounds;
    if (rect && rect.width > 0 && rect.height > 0) {
      return rect.clone();
    }
    const cached = readCachedBounds((item as any)?.data) || readCachedBounds((item as any)?.parent?.data);
    if (cached) return cached;
    return rect ? rect.clone() : null;
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

// 获取第一个图片的文件名作为默认标题
const getFirstImageFileName = (imageIds: string[]): string => {
  if (!imageIds || imageIds.length === 0) return '未命名组';
  const firstId = imageIds[0];
  const item = findImagePaperItem(firstId);
  if (!item) return '未命名组';

  // 尝试从 raster 的 data 中获取 fileName
  if (isGroup(item)) {
    const raster = item.children.find((child) => isRaster(child)) as paper.Raster | undefined;
    if (raster?.data?.fileName) {
      return formatImageGroupTitle(String(raster.data.fileName));
    }
  }

  // 尝试从 item 的 data 中获取 fileName
  if ((item.data as any)?.fileName) {
    return formatImageGroupTitle(String((item.data as any).fileName));
  }

  return '未命名组';
};

// 查找组块关联的标题文本
export const findGroupBlockTitle = (groupId: string): paper.PointText | null => {
  if (!paper.project || !groupId) return null;
  try {
    const matches = paper.project.getItems({
      match: (item: any) => item?.data?.type === 'image-group-title' && item?.data?.groupId === groupId,
    }) as paper.Item[];
    // 使用 className 检查以兼容生产环境（instanceof 在压缩后可能失效）
    if (matches.length > 0 && (matches[0].className === 'PointText' || matches[0] instanceof paper.PointText)) {
      return matches[0] as paper.PointText;
    }
  } catch {}
  return null;
};

const findGroupBlockTitleCandidates = (groupId: string): paper.PointText[] => {
  if (!paper.project || !groupId) return [];
  try {
    const matches = paper.project.getItems({
      match: (item: any) => item?.data?.groupId === groupId,
    }) as paper.Item[];
    return matches.filter((item): item is paper.PointText =>
      !!item && (item.className === 'PointText' || item instanceof paper.PointText)
    );
  } catch {}
  return [];
};

// 创建或更新组块标题
export const createOrUpdateGroupBlockTitle = (
  block: paper.Path,
  title?: string
): paper.PointText | null => {
  if (!block || !isPath(block)) return null;

  const groupId = (block.data as any)?.groupId;
  if (!groupId) return null;

  const imageIds = normalizeImageIdList((block.data as any)?.imageIds);
  const displayTitle = formatImageGroupTitle(title ?? (block.data as any)?.title ?? getFirstImageFileName(imageIds));

  const bounds = block.bounds;
  if (!bounds) return null;

  // 标题位置：组块上方
  const titleX = bounds.left;
  const titleY = bounds.top - 8; // 在组块上方 8px

  // 查找/去重现有标题（兼容历史 bug：标题被误标记为普通 text）
  const candidates = findGroupBlockTitleCandidates(groupId);
  const expectedPoint = new paper.Point(titleX, titleY);

  let titleText: paper.PointText | null = null;
  if (candidates.length > 0) {
    const preferred = block.layer
      ? candidates.filter((candidate) => candidate.layer === block.layer)
      : candidates;
    const source = preferred.length > 0 ? preferred : candidates;

    titleText = source.reduce((best, candidate) => {
      const bestIsTitle = (best.data as any)?.type === 'image-group-title';
      const candidateIsTitle = (candidate.data as any)?.type === 'image-group-title';
      if (bestIsTitle !== candidateIsTitle) {
        return candidateIsTitle ? candidate : best;
      }
      const bestPoint = best.point || best.position;
      const candidatePoint = candidate.point || candidate.position;
      const bestDist = bestPoint ? bestPoint.getDistance(expectedPoint, true) : Number.POSITIVE_INFINITY;
      const candidateDist = candidatePoint ? candidatePoint.getDistance(expectedPoint, true) : Number.POSITIVE_INFINITY;
      return candidateDist < bestDist ? candidate : best;
    }, source[0]);

    candidates.forEach((candidate) => {
      if (candidate === titleText) return;
      try { candidate.remove(); } catch {}
    });
  }

  if (!titleText) {
    titleText = new paper.PointText({
      point: expectedPoint,
      content: displayTitle,
      fontSize: TITLE_FONT_SIZE,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fillColor: new paper.Color(TITLE_COLOR),
      fontWeight: 500,
      insert: false,
    });
  }

  try {
    titleText.data = {
      ...(titleText.data || {}),
      type: 'image-group-title',
      groupId,
      isHelper: false,
    };
  } catch {}

  // 统一刷新样式 + 位置
  try { titleText.content = displayTitle; } catch {}
  try { titleText.point = expectedPoint; } catch {}
  try { titleText.fontSize = TITLE_FONT_SIZE; } catch {}
  try { titleText.fontFamily = 'system-ui, -apple-system, sans-serif'; } catch {}
  try { titleText.fillColor = new paper.Color(TITLE_COLOR); } catch {}
  try { (titleText as any).fontWeight = 500; } catch {}

  // 插入到与组块相同的图层（并放在组块之后）
  const layer = block.layer;
  if (layer) {
    try {
      const blockIndex = layer.children.indexOf(block);
      if (blockIndex >= 0) {
        layer.insertChild(blockIndex + 1, titleText);
      } else {
        layer.addChild(titleText);
      }
    } catch {
      try { layer.addChild(titleText); } catch {}
    }
  }

  // 保存标题到组块数据
  try {
    (block.data as any).title = displayTitle;
  } catch {}

  return titleText;
};

// 更新组块标题内容
export const updateGroupBlockTitle = (groupId: string, newTitle: string): boolean => {
  if (!groupId || !newTitle) return false;

  // 查找组块
  const blocks = getImageGroupBlocks();
  const block = blocks.find((b) => (b.data as any)?.groupId === groupId);
  if (!block) return false;

  // 更新标题
  const titleTexts = findGroupBlockTitleCandidates(groupId);
  titleTexts.forEach((titleText) => {
    try { titleText.content = newTitle; } catch {}
  });

  // 保存到组块数据
  try {
    (block.data as any).title = newTitle;
  } catch {}

  return true;
};

// 删除组块标题
export const removeGroupBlockTitle = (groupId: string): boolean => {
  const titleTexts = findGroupBlockTitleCandidates(groupId);
  if (!titleTexts.length) return false;
  let removed = false;
  titleTexts.forEach((titleText) => {
    try {
      titleText.remove();
      removed = true;
    } catch {}
  });
  return removed;
};

// 删除整个组（包括组块、标题和所有图片）
// 返回被删除的图片ID列表，供外部清理图片状态
export const deleteImageGroupBlock = (block: paper.Path): string[] => {
  if (!block || !isPath(block)) return [];
  if ((block.data as any)?.type !== IMAGE_GROUP_BLOCK_TYPE) return [];

  const groupId = (block.data as any)?.groupId;
  const imageIds = normalizeImageIdList((block.data as any)?.imageIds);

  // 1. 删除组内所有图片的 Paper.js 对象
  const deletedImageIds: string[] = [];
  imageIds.forEach((imageId) => {
    const item = findImagePaperItem(imageId);
    if (item) {
      try {
        item.remove();
        deletedImageIds.push(imageId);
      } catch {}
    }
  });

  // 2. 删除组块标题
  if (groupId) {
    removeGroupBlockTitle(groupId);
  }

  // 3. 删除组块本身
  try {
    block.remove();
  } catch {}

  return deletedImageIds;
};

// 根据 groupId 查找并删除整个组
export const deleteImageGroupBlockByGroupId = (groupId: string): string[] => {
  if (!groupId) return [];
  const blocks = getImageGroupBlocks();
  const block = blocks.find((b) => (b.data as any)?.groupId === groupId);
  if (!block) return [];
  return deleteImageGroupBlock(block);
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
  const groupId = (block.data as any)?.groupId;
  if (imageIds.length === 0) {
    // 删除关联的标题
    if (groupId) removeGroupBlockTitle(groupId);
    try { block.remove(); } catch {}
    return false;
  }

  const rects = imageIds
    .map((id) => getImagePaperBounds(id))
    .filter((rect): rect is paper.Rectangle => !!rect);
  const validImageIds = imageIds.filter((id) => !!getImagePaperBounds(id));

  if (validImageIds.length < 2 || rects.length < 2) {
    // 删除关联的标题
    if (groupId) removeGroupBlockTitle(groupId);
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

  // 同步更新标题位置
  createOrUpdateGroupBlockTitle(block);

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
    .map((item) => {
      // item 可能是 Raster（嵌在 Group 内），此时用它的顶层 parent(Group) 来计算插入顺序
      // 以保证组块始终位于图片下方。
      const direct = targetLayer.children.indexOf(item);
      if (direct >= 0) return direct;

      const parent = (item.parent as any) ?? null;
      if (parent && parent.layer === targetLayer && targetLayer.children.includes(parent)) {
        return targetLayer.children.indexOf(parent);
      }
      return -1;
    })
    .filter((idx) => idx >= 0);
  if (indices.length > 0) {
    insertIndex = Math.min(...indices);
  }

  try {
    targetLayer.insertChild(insertIndex, block);
  } catch {
    try { targetLayer.addChild(block); } catch {}
  }

  // 创建标题（使用传入的 title 或默认使用第一个图片的文件名）
  createOrUpdateGroupBlockTitle(block, options?.title);

  return { block, reason: undefined };
};
