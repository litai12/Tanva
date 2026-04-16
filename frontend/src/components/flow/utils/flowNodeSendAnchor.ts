type FlowNodeSendAnchorParams = {
  nodeId?: string;
  triggerTarget?: EventTarget | null;
  offsetY?: number;
};

const DEFAULT_OFFSET_Y = 16;

const escapeNodeIdForSelector = (value: string): string => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
};

export const resolveFlowNodeSendAnchorClient = ({
  nodeId,
  triggerTarget,
  offsetY = DEFAULT_OFFSET_Y,
}: FlowNodeSendAnchorParams): { x: number; y: number } | undefined => {
  const triggerEl =
    triggerTarget instanceof HTMLElement ? triggerTarget : null;
  const triggerNodeEl = triggerEl?.closest?.(".react-flow__node") as
    | HTMLElement
    | null;

  let nodeEl = triggerNodeEl;
  if (!nodeEl && nodeId && typeof document !== "undefined") {
    const escapedId = escapeNodeIdForSelector(nodeId);
    nodeEl = document.querySelector(
      `.react-flow__node[data-id="${escapedId}"]`
    ) as HTMLElement | null;
  }

  const rect = (nodeEl || triggerEl)?.getBoundingClientRect();
  if (!rect) return undefined;

  return {
    x: rect.left + rect.width / 2,
    y: rect.bottom + offsetY,
  };
};
