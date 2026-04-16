import React from 'react';

type GenerationStatus = 'idle' | 'running' | 'succeeded' | 'failed';

type Props = {
  status?: GenerationStatus;
  progress?: number | null;
  simulateDurationMs?: number;
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));

export default function GenerationProgressBar({ status, progress, simulateDurationMs }: Props) {
  const statusKey: GenerationStatus = status ?? 'idle';
  const numericProgress = typeof progress === 'number' ? clampProgress(progress) : null;
  const simulatedDurationMs =
    typeof simulateDurationMs === 'number' && Number.isFinite(simulateDurationMs)
      ? Math.max(1000, simulateDurationMs)
      : 300 * 1000;
  const baseProgress =
    numericProgress ??
    (statusKey === 'succeeded' || statusKey === 'failed'
      ? 100
      : statusKey === 'running'
        ? 8
        : 0);
  const targetVisible = statusKey === 'running' || statusKey === 'succeeded' || statusKey === 'failed';

  const [displayedProgress, setDisplayedProgress] = React.useState(baseProgress);
  const [visible, setVisible] = React.useState(targetVisible);

  React.useEffect(() => {
    setDisplayedProgress(baseProgress);
  }, [baseProgress]);

  React.useEffect(() => {
    if (!targetVisible) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (statusKey === 'succeeded' || statusKey === 'failed') {
      const timeout = window.setTimeout(() => setVisible(false), 1500);
      return () => window.clearTimeout(timeout);
    }
    return;
  }, [statusKey, targetVisible]);

  // Simulate progress from 0% to 95% over configured duration.
  // Update once per second.
  React.useEffect(() => {
    if (statusKey !== 'running' || numericProgress !== null) return;
    const MAX_PROGRESS = 95; // Cap at 95% until real completion
    const UPDATE_INTERVAL_MS = 1000; // once per second
    const TOTAL_UPDATES = Math.max(1, Math.round(simulatedDurationMs / UPDATE_INTERVAL_MS));
    const INCREMENT_PER_UPDATE = MAX_PROGRESS / TOTAL_UPDATES;

    const interval = window.setInterval(() => {
      setDisplayedProgress((prev) => {
        if (prev >= MAX_PROGRESS) return prev;
        return Math.min(prev + INCREMENT_PER_UPDATE, MAX_PROGRESS);
      });
    }, UPDATE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [statusKey, numericProgress, simulatedDurationMs]);

  React.useEffect(() => {
    if (statusKey === 'running' && numericProgress !== null) {
      setDisplayedProgress(numericProgress);
    }
  }, [statusKey, numericProgress]);

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
