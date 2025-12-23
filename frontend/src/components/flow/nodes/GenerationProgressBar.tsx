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

  // 5分钟（300秒）内从0%到95%的进度模拟
  // 每秒更新一次，总共300次更新，每次增加约0.317%
  React.useEffect(() => {
    if (statusKey !== 'running' || numericProgress !== null) return;
    const TOTAL_DURATION_MS = 300 * 1000; // 5分钟
    const MAX_PROGRESS = 95; // 最大到95%，等待实际完成
    const UPDATE_INTERVAL_MS = 1000; // 每秒更新一次
    const TOTAL_UPDATES = TOTAL_DURATION_MS / UPDATE_INTERVAL_MS;
    const INCREMENT_PER_UPDATE = MAX_PROGRESS / TOTAL_UPDATES; // 约0.317%每秒

    const interval = window.setInterval(() => {
      setDisplayedProgress((prev) => {
        if (prev >= MAX_PROGRESS) return prev;
        return Math.min(prev + INCREMENT_PER_UPDATE, MAX_PROGRESS);
      });
    }, UPDATE_INTERVAL_MS);
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
