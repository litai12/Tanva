import type { Node } from 'reactflow';

type NodeData = Record<string, unknown>;

const STORYBOARD_HANDLE_PREFIX = 'prompt';

const TEXT_KEYS = ['text', 'prompt', 'expandedText', 'responseText', 'manualInput', 'presetPrompt'];

const toNodeData = (node?: Node | null): NodeData => (node?.data as NodeData) || {};

const getStoryboardSegment = (data: NodeData, handleId?: string | null): string | undefined => {
  if (!handleId || typeof handleId !== 'string') return undefined;
  if (!handleId.startsWith(STORYBOARD_HANDLE_PREFIX)) return undefined;
  const index = Number(handleId.substring(STORYBOARD_HANDLE_PREFIX.length)) - 1;
  if (!Number.isFinite(index) || index < 0) return undefined;
  const segments = Array.isArray(data.segments) ? data.segments : [];
  const direct = segments[index];
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }
  const fallback = data[`prompt${index + 1}`];
  if (typeof fallback === 'string' && fallback.trim().length > 0) {
    return fallback.trim();
  }
  return undefined;
};

export const resolveTextFromSourceNode = (node: Node | null | undefined, handleId?: string | null): string | undefined => {
  if (!node) return undefined;
  const data = toNodeData(node);

  if (node.type === 'storyboardSplit') {
    const segment = getStoryboardSegment(data, handleId);
    if (segment) return segment;
  }

  for (const key of TEXT_KEYS) {
    const value = data[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};
