import React from 'react';

type GenerationStatus = 'idle' | 'running' | 'succeeded' | 'failed';

type Props = {
  status?: GenerationStatus;
  progress?: number | null;
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));

export default function GenerationProgressBar({ status, progress }: Props) {
  const statusKey: GenerationStatus = status ?? 'idle';
  const numericProgress = typeof progress === 'number' ? clampProgress(progress) : null;
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

  React.useEffect(() => {
    if (statusKey !== 'running' || numericProgress !== null) return;
    const interval = window.setInterval(() => {
      setDisplayedProgress((prev) => {
        if (prev >= 92) return prev;
        const increment = prev < 30 ? 10 : prev < 60 ? 6 : 3;
        return Math.min(prev + increment, 92);
      });
    }, 450);
    return () => window.clearInterval(interval);
  }, [statusKey, numericProgress]);

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
