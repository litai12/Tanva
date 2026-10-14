import type { ImagePreviewCrop, PreviewGalleryImage } from '../ui/ImagePreviewGalleryContext';

export type GalleryNode = {
  id: string;
  type?: string;
  data: Record<string, unknown>;
  position: { x: number; y: number };
  parentId?: string;
  parentNode?: string;
  measured?: { height?: number };
  height?: number;
};
export type GalleryEdge = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const IMAGE_NODE_TYPES = new Set(['image', 'imagePro', 'generate', 'generatePro', 'generateRef', 'generate4', 'generatePro4', 'nano2', 'gptImage2', 'seedream5', 'midjourneyV7', 'niji7', 'three', 'threePathTracer', 'camera', 'viewAngle', 'analysis', 'imageGrid', 'imageSplit', 'imageCompress']);

function readCrop(value: unknown, dimensions?: Record<string, unknown>): ImagePreviewCrop | undefined {
  if (!value || typeof value !== 'object') return;
  const crop = value as Record<string, unknown>;
  const x = Number(crop.x ?? 0), y = Number(crop.y ?? 0);
  const width = Number(crop.width), height = Number(crop.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
  const sourceWidth = Number(crop.sourceWidth ?? dimensions?.sourceWidth);
  const sourceHeight = Number(crop.sourceHeight ?? dimensions?.sourceHeight);
  return { x, y, width, height, sourceWidth: sourceWidth > 0 ? sourceWidth : undefined, sourceHeight: sourceHeight > 0 ? sourceHeight : undefined };
}

export function primaryImage(node: GalleryNode, nodes: Map<string, GalleryNode>, edges: GalleryEdge[], visited = new Set<string>(), sourceHandle?: string | null): { src: string; crop?: ImagePreviewCrop } | null {
  if (visited.has(node.id) || node.type === 'nodeGroup') return null;
  visited.add(node.id);
  const data = node.data;
  // ImageProNode displays its own asset; its input is not a rendered passthrough.
  if (node.type === 'imagePro') {
    const src = text(data.imageUrl) || text(data.imageData);
    return src ? { src } : null;
  }
  if (node.type === 'videoFrameExtract' && sourceHandle === 'image') {
    const frames = Array.isArray(data.frames) ? data.frames : [];
    const frame = frames[Number(data.selectedFrameIndex ?? 1) - 1] as Record<string, unknown> | undefined;
    const src = text(frame?.imageUrl) || text(frame?.thumbnailDataUrl);
    return src ? { src } : null;
  }
  if (node.type === 'imageSplit') {
    const match = /^(?:image|img)(\d+)$/i.exec(sourceHandle || '');
    const index = match ? Number(match[1]) - 1 : 0;
    const src = text(data.inputImageUrl) || text(data.inputImage);
    const rects = Array.isArray(data.splitRects) ? data.splitRects : [];
    const crop = readCrop(rects[index], data);
    const slices = Array.isArray(data.splitImages) ? data.splitImages : [];
    const slice = slices[index] as Record<string, unknown> | undefined;
    if (src && crop) return { src, crop };
    // Historical split nodes may store each slice directly on its output key.
    const direct = text(data[`image${index + 1}`]) || text(data[`img${index + 1}`]);
    if (direct) return { src: direct };
    return slice && text(slice.imageData) ? { src: text(slice.imageData), crop: readCrop(slice.crop) } : null;
  }
  const values = Array.isArray(data.imageUrls) && data.imageUrls.length ? data.imageUrls : Array.isArray(data.images) ? data.images : [];
  if (['generate4', 'generatePro4', 'midjourneyV7', 'niji7'].includes(node.type || '')) {
    const match = /^img(\d+)$/i.exec(sourceHandle || '');
    const index = match ? Math.max(0, Math.min(3, Number(match[1]) - 1)) : 0;
    const urls = Array.isArray(data.imageUrls) ? data.imageUrls : [];
    const images = Array.isArray(data.images) ? data.images : [];
    const src = text(urls[index]) || text(images[index]) || text(data.imageUrl) || text(data.imageData);
    return src ? { src } : null;
  }
  const src = text(data.outputImage) || text(data.imageUrl) || text(data.imageData) || text(values[0]);
  // Image nodes can display a connected source, including a split crop, before
  // they have any independent stored image. Match that rendered resource.
  if (node.type === 'image') {
    const input = edges.find((edge) => edge.target === node.id && (!edge.targetHandle || edge.targetHandle === 'img' || edge.targetHandle === 'image'));
    const upstream = input && nodes.get(input.source);
    const resource = upstream && primaryImage(upstream, nodes, edges, visited, input?.sourceHandle);
    if (resource) return { ...resource, crop: readCrop(data.crop) || resource.crop };
  }
  return src ? { src, crop: readCrop(data.crop) } : null;
}

/** Current canvas only: same group/parent, TapCanvasPro reading order. */
export function buildFlowPreviewGallery(nodes: GalleryNode[], nodeId: string, edges: GalleryEdge[] = []): PreviewGalleryImage[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const current = byId.get(nodeId);
  if (!current) return [];
  const memberParents = new Map<string, string>();
  for (const node of nodes) {
    if (node.type !== 'nodeGroup' || !Array.isArray(node.data.childNodeIds)) continue;
    for (const child of node.data.childNodeIds) if (typeof child === 'string' && !memberParents.has(child)) memberParents.set(child, node.id);
  }
  const parent = (node: GalleryNode) => memberParents.get(node.id) || text(node.parentId) || text(node.parentNode) || null;
  const scope = parent(current);
  const absPosition = (node: GalleryNode) => {
    const pos = { ...node.position };
    const seen = new Set([node.id]);
    let parentId = text(node.parentId) || text(node.parentNode);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const ancestor = byId.get(parentId);
      if (!ancestor) break;
      pos.x += ancestor.position.x; pos.y += ancestor.position.y;
      parentId = text(ancestor.parentId) || text(ancestor.parentNode);
    }
    return pos;
  };
  const placed = nodes.filter((node) => IMAGE_NODE_TYPES.has(node.type || '') && parent(node) === scope)
    .flatMap((node) => {
      const resource = primaryImage(node, byId, edges);
      return resource ? [{ node, resource, pos: absPosition(node), height: node.measured?.height || node.height || Number(node.data.boxH) || 200 }] : [];
    }).sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  const rows: (typeof placed)[] = [];
  let rowLimit = -Infinity;
  for (const item of placed) {
    if (!rows.length || item.pos.y > rowLimit) {
      rows.push([item]);
      rowLimit = item.pos.y + Math.max(1, item.height) / 2;
    } else rows[rows.length - 1].push(item);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.pos.x - b.pos.x).map(({ node, resource }) => ({
    id: node.id, ...resource,
    title: text(node.data.imageName) || text(node.data.label) || text(node.data.name) || undefined,
  })));
}
