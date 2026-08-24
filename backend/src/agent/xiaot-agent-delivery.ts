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

export const XIAOT_INTERRUPTED_STREAM_CODE =
  'agents_bridge_stream_interrupted';

const XIAOT_HOST_HANDOFF_REASONS = new Set([
  'host_execution_required',
  // TapCanvas uses this reason when the root physical turn has exhausted its
  // own execution window after already projecting work to the desktop host.
  'root_physical_execution_budget_exhausted',
]);

const readRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function readXiaotOpenAiTurnId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.startsWith('chatcmpl-') && id.length > 'chatcmpl-'.length
    ? id.slice('chatcmpl-'.length)
    : null;
}

export function isXiaotInterruptedStreamEnvelope(value: unknown): boolean {
  return readRecord(value)?.code === XIAOT_INTERRUPTED_STREAM_CODE;
}

export function buildXiaotDurableSessionKey(openAiUser: string): string {
  return `host:${openAiUser.slice(0, 120)}`;
}

/**
 * TapCanvas deliberately suspends a physical turn after emitting host canvas
 * commands. Tanva must execute those commands and verify their evidence; the
 * suspension is a host hand-off rather than an upstream failure.
 */
export function isXiaotHostExecutionSuspension(error: unknown): boolean {
  const payload = readRecord(error);
  const details = readRecord(payload?.details);
  const terminal = readRecord(details?.requestTerminal);
  return (
    payload?.code === 'xiaot_turn_suspended' &&
    terminal?.status === 'suspended' &&
    typeof terminal?.reason === 'string' &&
    XIAOT_HOST_HANDOFF_REASONS.has(terminal.reason)
  );
}

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
