import {
  assertXiaotUpstreamDelivery,
  buildXiaotDurableSessionKey,
  isXiaotInterruptedStreamEnvelope,
  readXiaotOpenAiTurnId,
} from '../../agent/xiaot-agent-delivery';
import {
  isXiaotDeferredReplayFrame,
  isXiaotDurableContinuationPlaceholder,
  replayXiaotTurn,
  XiaotReplayFrame,
} from '../../agent/xiaot-agent-recovery';

type AgentTextStreamUsage = Record<string, unknown> | null;

export type AgentTextStreamResult = {
  text: string;
  usage: AgentTextStreamUsage;
  turnId: string | null;
};

export type CollectAgentTextStreamInput = {
  response: Response;
  gatewayBaseUrl: string;
  apiKey: string;
  openAiUser: string;
  signal: AbortSignal;
};

class AgentTextStreamInterruptedError extends Error {
  constructor() {
    super('xiaot-agent upstream stream interrupted');
    this.name = 'AgentTextStreamInterruptedError';
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readErrorMessage(error: unknown): string {
  const payload = readRecord(error);
  const message = payload?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  const code = payload?.code;
  if (typeof code === 'string' && code.trim()) return code.trim();
  try {
    return JSON.stringify(error).slice(0, 300);
  } catch {
    return 'unreadable stream error';
  }
}

function parseDataPayload(payload: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    throw new Error('xiaot-agent protocol error: invalid JSON data frame');
  }
  const record = readRecord(value);
  if (!record) {
    throw new Error('xiaot-agent protocol error: data frame must be an object');
  }
  return record;
}

/**
 * Collects one no-tool OpenAI facade stream into a verified terminal text.
 * If the physical stream is interrupted after the durable turn id is known,
 * it follows that same accepted turn through the journal instead of submitting
 * the prompt again.
 */
export async function collectAgentTextStream(
  input: CollectAgentTextStreamInput,
): Promise<AgentTextStreamResult> {
  if (!input.response.body) {
    throw new Error('xiaot-agent protocol error: upstream stream has no body');
  }

  const reader = input.response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';
  let finishReason: string | null = null;
  let doneReceived = false;
  let turnId: string | null = null;
  let usage: AgentTextStreamUsage = null;

  const handleLine = (rawLine: string): void => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') {
      doneReceived = true;
      return;
    }
    if (doneReceived) {
      throw new Error('xiaot-agent protocol error: received data after [DONE]');
    }

    const frame = parseDataPayload(payload);
    turnId = readXiaotOpenAiTurnId(frame.id) || turnId;
    if (frame.error) {
      if (isXiaotInterruptedStreamEnvelope(frame.error)) {
        throw new AgentTextStreamInterruptedError();
      }
      throw new Error(
        `xiaot-agent stream error: ${readErrorMessage(frame.error)}`,
      );
    }

    const choices = Array.isArray(frame.choices) ? frame.choices : [];
    const choice = readRecord(choices[0]);
    const delta = readRecord(choice?.delta);
    if (typeof delta?.content === 'string') text += delta.content;
    if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
      throw new Error(
        'xiaot-agent protocol error: no-tool text request returned tool calls',
      );
    }
    if (
      typeof choice?.finish_reason === 'string' &&
      choice.finish_reason.trim()
    ) {
      finishReason = choice.finish_reason.trim();
    }
    const nextUsage = readRecord(frame.usage);
    if (nextUsage) usage = nextUsage;
  };

  let interrupted = false;
  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (error: unknown) {
        if (input.signal.aborted) throw error;
        interrupted = true;
        break;
      }
      const { done, value } = readResult;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } catch (error: unknown) {
    if (!(error instanceof AgentTextStreamInterruptedError)) throw error;
    interrupted = true;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  const durableContinuationPending =
    isXiaotDurableContinuationPlaceholder(text);
  if ((interrupted || !doneReceived || durableContinuationPending) && turnId) {
    text = '';
    doneReceived = false;
    finishReason = null;
    await replayXiaotTurn({
      gatewayBaseUrl: input.gatewayBaseUrl,
      apiKey: input.apiKey,
      sessionKey: buildXiaotDurableSessionKey(input.openAiUser),
      turnId,
      signal: input.signal,
      onFrame: (frame: XiaotReplayFrame): void => {
        if (isXiaotDeferredReplayFrame(frame)) {
          if (frame.event === 'result') text = '';
          doneReceived = false;
          finishReason = null;
          return;
        }
        if (frame.event === 'content') {
          if (typeof frame.data.delta === 'string') text += frame.data.delta;
          return;
        }
        if (frame.event === 'result') {
          const response = readRecord(frame.data.response);
          if (!text && typeof response?.text === 'string') {
            text = response.text;
          }
          finishReason = 'stop';
          doneReceived = true;
          return;
        }
        if (frame.event === 'done') {
          finishReason = 'stop';
          doneReceived = true;
          return;
        }
        if (frame.event === 'error' && frame.data.terminal === true) {
          throw new Error(
            `xiaot-agent replay error: ${readErrorMessage(frame.data)}`,
          );
        }
        if (frame.event === 'tool') {
          throw new Error(
            'xiaot-agent protocol error: no-tool text replay returned tool calls',
          );
        }
      },
    });
  } else if (interrupted || durableContinuationPending) {
    throw new Error(
      'xiaot-agent stream requires recovery but has no durable turn identifier',
    );
  }

  assertXiaotUpstreamDelivery({
    text,
    patchCount: 0,
    hostToolCount: 0,
    hostUiCount: 0,
    incompleteToolCallCount: 0,
    finishReason,
    doneReceived,
  });

  return { text: text.trim(), usage, turnId };
}
