type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface XiaotReplayFrame {
  event: string;
  id: string | null;
  data: Record<string, unknown>;
}

export interface ReplayXiaotTurnInput {
  gatewayBaseUrl: string;
  apiKey: string;
  sessionKey: string;
  turnId: string;
  signal: AbortSignal;
  onFrame: (frame: XiaotReplayFrame) => void | Promise<void>;
  fetchImpl?: FetchLike;
  maxConnections?: number;
  replayResyncDelayMs?: number;
}

export class XiaotTurnReplayError extends Error {
  constructor(
    message: string,
    readonly diagnostic: string,
  ) {
    super(message);
    this.name = 'XiaotTurnReplayError';
  }
}

// A physical continuation can legitimately wait behind other durable work for
// several minutes.  The enclosing AbortSignal owns the 15-minute wall clock;
// this limit only prevents an accidental infinite reconnect loop after that
// contract is bypassed in a test or a future caller.
const DEFAULT_MAX_REPLAY_CONNECTIONS = 900;
const DEFAULT_REPLAY_RESYNC_DELAY_MS = 1_000;

export const XIAOT_DURABLE_CONTINUATION_PLACEHOLDER =
  '任务仍在处理中，系统会自动继续，无需重复提交。';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseReplayFrame(chunk: string): XiaotReplayFrame | null {
  let event = 'message';
  let id: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of chunk.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    if (rawLine.startsWith('event:')) {
      event = rawLine.slice(6).trim();
      continue;
    }
    if (rawLine.startsWith('id:')) {
      id = rawLine.slice(3).trim() || null;
      continue;
    }
    if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join('\n')) as unknown;
  } catch {
    throw new Error('小T任务续接返回了无法解析的事件数据');
  }
  const data = readRecord(parsed);
  if (!data) {
    throw new Error('小T任务续接返回了无效事件');
  }
  return { event, id, data };
}

function readReplayRequestTerminalStatus(frame: XiaotReplayFrame): string | null {
  if (frame.event !== 'result') return null;
  const response = readRecord(frame.data.response);
  const trace = readRecord(response?.trace);
  const terminal = readRecord(trace?.requestTerminal);
  return typeof terminal?.status === 'string' ? terminal.status : null;
}

export function isXiaotDeferredReplayFrame(frame: XiaotReplayFrame): boolean {
  if (readReplayRequestTerminalStatus(frame) === 'suspended') return true;
  return frame.event === 'done' && frame.data.reason === 'physical_suspended';
}

export function isXiaotDurableContinuationPlaceholder(text: string): boolean {
  return text.trim().endsWith(XIAOT_DURABLE_CONTINUATION_PLACEHOLDER);
}

function frameIsTerminal(frame: XiaotReplayFrame): boolean {
  if (isXiaotDeferredReplayFrame(frame)) return false;
  if (frame.event === 'result' || frame.event === 'done') return true;
  return frame.event === 'error' && frame.data.terminal === true;
}

function readReplayResyncCursor(frame: XiaotReplayFrame): string | null {
  if (frame.event !== 'resync') return null;
  const recovery = readRecord(frame.data.recovery);
  const latestEventId =
    typeof frame.data.latestEventId === 'string'
      ? frame.data.latestEventId.trim()
      : '';
  if (
    recovery?.kind !== 'status_reconcile' ||
    frame.data.publicTurnId !== undefined &&
      frame.data.publicTurnId !== recovery.referenceId ||
    !latestEventId
  ) {
    return null;
  }
  return latestEventId;
}

async function waitForReplayResync(
  signal: AbortSignal,
  delayMs: number,
): Promise<void> {
  if (signal.aborted) throw signal.reason;
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    setTimeout(() => signal.removeEventListener('abort', abort), delayMs);
  });
}

function assertReplayIdentity(input: ReplayXiaotTurnInput): void {
  if (!input.sessionKey.trim() || !input.turnId.trim()) {
    throw new Error('小T任务缺少安全续接所需的同回合标识');
  }
}

/**
 * Replays one already accepted TapCanvas turn through Tanva's authenticated
 * channel proxy. It never submits the original prompt again, so reconnecting
 * cannot create a second paid generation.
 */
export async function replayXiaotTurn(
  input: ReplayXiaotTurnInput,
): Promise<XiaotReplayFrame> {
  assertReplayIdentity(input);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const maxConnections = Math.max(
    1,
    Math.trunc(input.maxConnections ?? DEFAULT_MAX_REPLAY_CONNECTIONS),
  );
  const replayResyncDelayMs = Math.max(
    0,
    Math.trunc(
      input.replayResyncDelayMs ?? DEFAULT_REPLAY_RESYNC_DELAY_MS,
    ),
  );
  const endpoint = `${input.gatewayBaseUrl.replace(/\/+$/, '')}/proxy/xiaot-agent/agents/chat/status`;
  let afterEventId: string | null = null;

  for (let connection = 0; connection < maxConnections; connection += 1) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        sessionKey: input.sessionKey,
        turnId: input.turnId,
        streamEvents: true,
        ...(afterEventId ? { afterEventId } : {}),
      }),
      signal: input.signal,
    });
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new XiaotTurnReplayError(
        `小T任务续接失败（HTTP ${response.status}）`,
        `status=${response.status} body=${detail.slice(0, 500)}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let readFailure: string | null = null;
    let resyncCursor: string | null = null;
    try {
      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (error: unknown) {
          if (input.signal.aborted) throw error;
          readFailure = error instanceof Error ? error.message : String(error);
          break;
        }
        const { done, value } = readResult;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const frame = parseReplayFrame(chunk);
          if (!frame) continue;
          if (frame.event === 'resync') {
            resyncCursor = readReplayResyncCursor(frame);
            if (!resyncCursor) {
              throw new Error('小T任务事件日志出现缺口，无法安全续接');
            }
            afterEventId = resyncCursor;
            break;
          }
          await input.onFrame(frame);
          if (frame.id) afterEventId = frame.id;
          if (frameIsTerminal(frame)) return frame;
        }
      }
      buffer += decoder.decode();
      const tail = parseReplayFrame(buffer);
      if (tail && !resyncCursor) {
        if (tail.event === 'resync') {
          resyncCursor = readReplayResyncCursor(tail);
          if (!resyncCursor) {
            throw new Error('小T任务事件日志出现缺口，无法安全续接');
          }
          afterEventId = resyncCursor;
        } else {
          await input.onFrame(tail);
          if (tail.id) afterEventId = tail.id;
          if (frameIsTerminal(tail)) return tail;
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
    if (resyncCursor) {
      // `terminal_projection_missing + status_reconcile` is the public
      // facade's normal hand-off while the trace is `waiting_async`.  It is not
      // a retention gap: resume from the server-asserted latest cursor and let
      // the already registered continuation append the next physical run.
      await waitForReplayResync(input.signal, replayResyncDelayMs);
      continue;
    }
    if (readFailure && connection + 1 >= maxConnections) {
      throw new XiaotTurnReplayError(
        '小T任务续接流在返回终态前多次中断',
        `lastEventId=${afterEventId || 'none'} readError=${readFailure}`,
      );
    }
  }

  throw new Error('小T任务续接流在返回终态前多次中断');
}

export const xiaotAgentRecoveryTestExports = {
  parseReplayFrame,
  frameIsTerminal,
  readReplayRequestTerminalStatus,
  readReplayResyncCursor,
};
