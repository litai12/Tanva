import React from 'react';
import { useStore, type ReactFlowState, type Node as FlowNode } from 'reactflow';

export type SiblingImage = {
  index: number;   // 1-based: @图1 = index 1
  url: string;
  isVideo: boolean;
  nodeId: string;
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
  const getAt = (field: unknown): string | null => {
    if (!Array.isArray(field)) return null;
    const v = field[idx];
    return typeof v === 'string' && v ? v : null;
  };

  const url =
    getAt(d.imageUrls) ??
    getAt(d.images) ??
    getAt(d.thumbnails) ??
    (typeof d.imageData === 'string' && d.imageData ? d.imageData : null) ??
    (typeof d.imageUrl === 'string' && d.imageUrl ? d.imageUrl : null) ??
    (typeof d.outputImage === 'string' && d.outputImage ? d.outputImage : null) ??
    (typeof d.inputImageUrl === 'string' && d.inputImageUrl ? d.inputImageUrl : null);

  return url ? { url, isVideo: false } : null;
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

        // 3. Collect sibling image edges: connected to any downstream node, not a text input
        //    Preserve order by edges array position.
        const result: SiblingImage[] = [];
        let idx = 1;

        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          if (!downstreamIds.has(edge.target)) continue;
          if (edge.source === nodeId) continue; // skip our own edge
          if (edge.targetHandle === 'text') continue; // skip text inputs

          const sourceNode = getNode(edge.source);
          if (!sourceNode) continue;

          const resolved = resolveActiveImageUrl(sourceNode, edge.sourceHandle);
          if (!resolved) continue;

          result.push({
            index: idx++,
            url: resolved.url,
            isVideo: resolved.isVideo,
            nodeId: edge.source,
          });
        }

        return result.length === 0 ? EMPTY : result;
      },
      [nodeId]
    )
  );
}
