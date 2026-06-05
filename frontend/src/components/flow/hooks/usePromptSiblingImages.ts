import React from 'react';
import { useStore, type ReactFlowState, type Node as FlowNode } from 'reactflow';

export type SiblingImage = {
  index: number;   // 1-based: @图1 = index 1
  url: string;
  isVideo: boolean;
  nodeId: string;
  title?: string;
};

function parseHandleIndex(sourceHandle: string | null | undefined): number {
  if (!sourceHandle) return 0;
  // "images-2" → 2 (0-based, dash suffix used as-is)
  // "img3" → 2 (1-based trail digit, subtract 1 to get 0-based index)
  // "images" or null → 0
  const dashMatch = /^[a-z]+-(\d+)$/i.exec(sourceHandle);
  if (dashMatch) return Number(dashMatch[1]);
  const trailMatch = /(\d+)$/.exec(sourceHandle);
  if (trailMatch) return Number(trailMatch[1]) - 1; // img1 → index 0
  return 0;
}

function resolveActiveImageUrl(
  node: FlowNode,
  sourceHandle: string | null | undefined
): { url: string; isVideo: boolean } | null {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const isVideo =
    typeof node.type === 'string' &&
    (node.type.toLowerCase().includes('video') || node.type.toLowerCase().includes('sora'));

  if (isVideo) {
    const url =
      (typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl : null) ??
      (typeof d.videoUrl === 'string' ? d.videoUrl : null);
    return url ? { url, isVideo: true } : null;
  }

  const idx = parseHandleIndex(sourceHandle);

  // Mirrors GenerateNode's normalizeImageValue: handles both plain strings and
  // object entries like { imageData: '...', url: '...' } that some node types produce.
  // flow-asset: refs are IndexedDB handles and cannot be used as <img src>, so skip them.
  const normalizeVal = (v: unknown): string | null => {
    if (typeof v === 'string') {
      const s = v.trim();
      return s && !s.startsWith('flow-asset:') ? s : null;
    }
    if (v && typeof v === 'object') {
      const rec = v as Record<string, unknown>;
      const imageData = typeof rec.imageData === 'string' ? rec.imageData.trim() : null;
      if (imageData && !imageData.startsWith('flow-asset:')) return imageData;
      const url = typeof rec.url === 'string' ? rec.url.trim() : null;
      if (url && !url.startsWith('flow-asset:')) return url;
    }
    return null;
  };

  const getAt = (field: unknown): string | null => {
    if (!Array.isArray(field)) return null;
    return normalizeVal(field[idx]);
  };

  const url =
    getAt(d.imageUrls) ??
    getAt(d.images) ??
    getAt(d.thumbnails) ??
    normalizeVal(d.thumbnail) ??
    normalizeVal(d.thumbnailDataUrl) ??
    normalizeVal(d.imageData) ??
    normalizeVal(d.imageUrl) ??
    normalizeVal(d.outputImage) ??
    normalizeVal(d.inputImageUrl);

  return url ? { url, isVideo: false } : null;
}

function resolveNodeTitle(node: FlowNode): string | undefined {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const candidates = [
    data.title,
    data.name,
    data.label,
    data.fileName,
    data.imageName,
  ];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

const EMPTY: SiblingImage[] = [];

export function usePromptSiblingImages(nodeId: string): SiblingImage[] {
  return useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edges = state.edges;

        // 1. Find downstream node IDs (where this prompt node outputs to)
        const downstreamIds = new Set<string>();
        for (const edge of edges) {
          if (edge.source === nodeId) {
            downstreamIds.add(edge.target);
          }
        }
        if (downstreamIds.size === 0) return EMPTY;

        // 2. Resolve node lookup (supports both ReactFlow v11 nodeLookup and v10 nodes array)
        const nodeLookup = (
          state as ReactFlowState & { nodeLookup?: Map<string, FlowNode> }
        ).nodeLookup;
        const hasNodeLookup = nodeLookup && typeof nodeLookup.get === 'function';
        const fallbackNodes = hasNodeLookup
          ? null
          : ((state as ReactFlowState & { nodes?: FlowNode[] }).nodes || state.getNodes());
        const fallbackById = fallbackNodes
          ? new Map(fallbackNodes.map((n) => [n.id, n]))
          : null;
        const getNode = (id: string): FlowNode | undefined =>
          hasNodeLookup ? nodeLookup!.get(id) : fallbackById?.get(id);

        // Mirrors FlowOverlay's image-edge filter. Covers all known image input handles:
        //   "img"        – generate / generatePro / imagePro
        //   "img1…"      – generate4 / generatePro4 indexed outputs
        //   "image"      – Seedance 2.0 primary, sora2Video
        //   "image-2…"   – Seedance 2.0 secondary (image-2, image-3…)
        //   "image2…"    – generateRef (no dash variant)
        //   "images"     – imageGrid
        const isImgTargetHandle = (h: string | null | undefined): boolean => {
          if (!h) return false;
          if (h === 'img' || h === 'image' || h === 'images') return true;
          if (/^img\d+$/.test(h)) return true;      // img1, img2…
          if (/^image-?\d+$/.test(h)) return true;  // image2, image-2, image-3…
          return false;
        };

        // 3. Collect sibling image edges: connected to any downstream node via an image handle.
        //    Deduplicate by sourceNodeId — the same image node may connect to multiple
        //    downstream nodes (e.g. when prompt feeds two generate nodes sharing the same
        //    reference image). Preserve order by edges array position.
        const result: SiblingImage[] = [];
        const seenSourceIds = new Set<string>();
        let idx = 1;

        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          if (!downstreamIds.has(edge.target)) continue;
          if (edge.source === nodeId) continue; // skip our own edge
          if (!isImgTargetHandle(edge.targetHandle)) continue; // only image-input handles
          if (seenSourceIds.has(edge.source)) continue; // deduplicate same source node

          const sourceNode = getNode(edge.source);
          if (!sourceNode) continue;

          const resolved = resolveActiveImageUrl(sourceNode, edge.sourceHandle);
          if (!resolved) continue;

          seenSourceIds.add(edge.source);
          result.push({
            index: idx++,
            url: resolved.url,
            isVideo: resolved.isVideo,
            nodeId: edge.source,
            title: resolveNodeTitle(sourceNode),
          });
        }

        return result.length === 0 ? EMPTY : result;
      },
      [nodeId]
    )
  );
}
