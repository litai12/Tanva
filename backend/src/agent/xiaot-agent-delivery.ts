export interface XiaotUpstreamDeliveryEvidence {
  text: string;
  patchCount: number;
  hostToolCount: number;
  hostUiCount: number;
  incompleteToolCallCount: number;
}

/**
 * The upstream stream ending is only transport completion. A successful XiaoT
 * turn must expose at least one host-consumable delivery channel, and every
 * streamed tool call must be complete JSON before the run can be settled.
 */
export function assertXiaotUpstreamDelivery(
  evidence: XiaotUpstreamDeliveryEvidence,
): void {
  if (evidence.incompleteToolCallCount > 0) {
    throw new Error(
      `xiaot-agent protocol error: ${evidence.incompleteToolCallCount} incomplete tool call(s)`,
    );
  }

  const hasDelivery =
    evidence.text.trim().length > 0 ||
    evidence.patchCount > 0 ||
    evidence.hostToolCount > 0 ||
    evidence.hostUiCount > 0;
  if (!hasDelivery) {
    throw new Error(
      'xiaot-agent protocol error: upstream completed without text, flow_patch, host_tool, or host_ui delivery',
    );
  }
}
