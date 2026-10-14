import { primaryImage, type GalleryNode, type GalleryEdge } from '../flowPreviewGallery.ts';
import type { ImagePreviewCrop } from '../../ui/ImagePreviewGalleryContext';

export type ImageCompareSource = {
  nodeId: string;
  inputId: string;
  label: string;
  src: string;
  crop?: ImagePreviewCrop;
};

/** Read the resource at each connected output, never copy it into compare data. */
export function resolveImageCompareInputs(
  nodes: GalleryNode[],
  edges: GalleryEdge[],
  nodeId: string,
): ImageCompareSource[] {
  const incoming = edges.filter((edge) => edge.target === nodeId && (!edge.targetHandle || edge.targetHandle === 'images'));
  if (!incoming.length) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const position = (node: GalleryNode) => {
    const result = { ...node.position };
    const seen = new Set([node.id]);
    let parentId = node.parentId || node.parentNode;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      result.x += parent.position.x;
      result.y += parent.position.y;
      parentId = parent.parentId || parent.parentNode;
    }
    return result;
  };
  return incoming.flatMap((edge, index) => {
    const node = byId.get(edge.source);
    if (!node) return [];
    const resource = primaryImage(node, byId, edges, new Set(), edge.sourceHandle);
    if (!resource) return [];
    const label = [node.data.imageName, node.data.label, node.data.name]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim())) || node.id;
    return [{ source: { nodeId: node.id, inputId: `${node.id}:${edge.sourceHandle || ''}:${index}`, label, ...resource }, position: position(node), index }];
  }).sort((a, b) => {
    const dx = a.position.x - b.position.x;
    return (Math.abs(dx) > 1 ? dx : a.position.y - b.position.y) || a.index - b.index;
  }).map((entry) => entry.source);
}
