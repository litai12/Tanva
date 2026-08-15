export interface XiaotUpstreamDeliveryEvidence {
  text: string;
  patchCount: number;
  hostToolCount: number;
  hostUiCount: number;
  incompleteToolCallCount: number;
  finishReason: string | null;
  doneReceived: boolean;
}

export const XIAOT_UPSTREAM_SESSION_PROTOCOL_VERSION = 'v2';

export function buildXiaotUpstreamSessionUser(
  sessionId: string | null | undefined,
  userId: string,
): string {
  const stableSession = typeof sessionId === 'string' ? sessionId.trim() : '';
  const identity = stableSession || `tanva:${userId}`;
  return `xiaot-${XIAOT_UPSTREAM_SESSION_PROTOCOL_VERSION}:${identity}`;
}

/**
 * The upstream stream ending is only transport completion. A successful XiaoT
 * turn must expose at least one host-consumable delivery channel, and every
 * streamed tool call must be complete JSON before the run can be settled.
 */
export function assertXiaotUpstreamDelivery(
  evidence: XiaotUpstreamDeliveryEvidence,
): void {
  if (!evidence.doneReceived) {
    throw new Error('xiaot-agent protocol error: upstream stream ended without [DONE]');
  }

  const expectedFinishReason =
    evidence.patchCount + evidence.hostToolCount + evidence.hostUiCount > 0
      ? 'tool_calls'
      : 'stop';
  if (evidence.finishReason !== expectedFinishReason) {
    throw new Error(
      `xiaot-agent protocol error: finish_reason=${evidence.finishReason ?? 'missing'}; expected=${expectedFinishReason}`,
    );
  }

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
