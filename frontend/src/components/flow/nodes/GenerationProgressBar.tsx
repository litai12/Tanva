import React from 'react';

type GenerationStatus = 'idle' | 'running' | 'succeeded' | 'failed';

type Props = {
  status?: GenerationStatus;
  progress?: number | null;
  simulateDurationMs?: number;
  startedAt?: number | string | null;
  runKey?: string;
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));
const SIMULATED_MAX_PROGRESS = 95;
const SIMULATED_MIN_PROGRESS = 8;
const UPDATE_INTERVAL_MS = 1000;
const TERMINAL_VISIBLE_MS = 1500;
const runningProgressStartedAt = new Map<string, number>();

const normalizeStartedAt = (value: number | string | null | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
};

export default function GenerationProgressBar({
  status,
  progress,
  simulateDurationMs,
  startedAt,
  runKey,
}: Props) {
  const statusKey: GenerationStatus = status ?? 'idle';
  const numericProgress = typeof progress === 'number' ? clampProgress(progress) : null;
  const simulatedDurationMs =
    typeof simulateDurationMs === 'number' && Number.isFinite(simulateDurationMs)
      ? Math.max(1000, simulateDurationMs)
      : 300 * 1000;
  const normalizedStartedAt = normalizeStartedAt(startedAt);
  const sessionKey = typeof runKey === 'string' && runKey.trim() ? runKey.trim() : null;
  const shouldSimulate = statusKey === 'running' && numericProgress === null;
  const isTerminal = statusKey === 'succeeded' || statusKey === 'failed';

  const [fallbackStartedAt, setFallbackStartedAt] = React.useState<number | null>(() => {
    if (!shouldSimulate || normalizedStartedAt !== null) return null;
    if (!sessionKey) return Date.now();
    const existing = runningProgressStartedAt.get(sessionKey);
    if (existing) return existing;
    const next = Date.now();
    runningProgressStartedAt.set(sessionKey, next);
    return next;
  });
  const [now, setNow] = React.useState(() => Date.now());
  const [terminalVisible, setTerminalVisible] = React.useState(() => isTerminal && !sessionKey);
  const previousStatusRef = React.useRef<GenerationStatus>(statusKey);

  React.useEffect(() => {
    if (shouldSimulate && normalizedStartedAt === null) {
      if (!sessionKey) {
        setFallbackStartedAt((prev) => prev ?? Date.now());
        return;
      }
      const existing = runningProgressStartedAt.get(sessionKey);
      if (existing) {
        setFallbackStartedAt(existing);
        return;
      }
      const next = Date.now();
      runningProgressStartedAt.set(sessionKey, next);
      setFallbackStartedAt(next);
      return;
    }
    setFallbackStartedAt(null);
  }, [shouldSimulate, normalizedStartedAt, sessionKey]);

  React.useEffect(() => {
    if (sessionKey && statusKey !== 'running') {
      runningProgressStartedAt.delete(sessionKey);
    }
  }, [sessionKey, statusKey]);

  React.useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = statusKey;

    if (isTerminal && previousStatus === 'running') {
      setTerminalVisible(true);
      return;
    }

    if (statusKey === 'idle' || statusKey === 'running') {
      setTerminalVisible(false);
    }
    return;
  }, [isTerminal, statusKey]);

  React.useEffect(() => {
    if (!terminalVisible) return;
    const timeout = window.setTimeout(() => setTerminalVisible(false), TERMINAL_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [terminalVisible]);

  React.useEffect(() => {
    if (!shouldSimulate) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), UPDATE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [shouldSimulate]);

  const simulationStartedAt = normalizedStartedAt ?? fallbackStartedAt;
  const simulatedProgress =
    shouldSimulate && simulationStartedAt !== null
      ? clampProgress(
          Math.max(
            SIMULATED_MIN_PROGRESS,
            Math.min(
              SIMULATED_MAX_PROGRESS,
              ((now - simulationStartedAt) / simulatedDurationMs) * SIMULATED_MAX_PROGRESS
            )
          )
        )
      : null;
  const displayedProgress =
    numericProgress ??
    (isTerminal
      ? 100
      : statusKey === 'running'
        ? simulatedProgress ?? SIMULATED_MIN_PROGRESS
        : 0);
  const visible = statusKey === 'running' || terminalVisible;

  if (!visible) {
    return null;
  }

  const stateClass = `flow-node-progress flow-node-progress--${statusKey}`;
  const isDeterminate = statusKey !== 'running' || numericProgress !== null;
  const width = clampProgress(displayedProgress);

  return (
    <div className={stateClass} data-active="true" data-indeterminate={isDeterminate ? 'false' : 'true'}>
      <div className="flow-node-progress__fill" style={{ width: `${width}%` }} />
    </div>
  );
}
