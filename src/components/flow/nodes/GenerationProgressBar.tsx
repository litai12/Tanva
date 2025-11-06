import React from 'react';

type GenerationStatus = 'idle' | 'running' | 'succeeded' | 'failed';

type Props = {
  status?: GenerationStatus;
  progress?: number | null;
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));

export default function GenerationProgressBar({ status, progress }: Props) {
  const [visible, setVisible] = React.useState(false);
  const [displayedProgress, setDisplayedProgress] = React.useState(0);
  const numericProgress = typeof progress === 'number' ? clampProgress(progress) : null;

  React.useEffect(() => {
    if (status === 'running') {
      setVisible(true);
      if (numericProgress !== null) {
        setDisplayedProgress(numericProgress);
        return;
      }

      setDisplayedProgress((prev) => (prev <= 8 ? 8 : prev));
      const interval = window.setInterval(() => {
        setDisplayedProgress((prev) => {
          if (prev >= 92) return prev;
          const increment = prev < 30 ? 10 : prev < 60 ? 6 : 3;
          return Math.min(prev + increment, 92);
        });
      }, 450);

      return () => window.clearInterval(interval);
    }

    if (status === 'succeeded' || status === 'failed') {
      setVisible(true);
      setDisplayedProgress(100);
      const timeout = window.setTimeout(() => {
        setVisible(false);
        setDisplayedProgress(0);
      }, 1500);
      return () => window.clearTimeout(timeout);
    }

    setVisible(false);
    setDisplayedProgress(0);
  }, [status]);

  React.useEffect(() => {
    if (status === 'running' && numericProgress !== null) {
      setVisible(true);
      setDisplayedProgress(numericProgress);
    }
  }, [status, numericProgress]);

  const stateClass = `flow-node-progress flow-node-progress--${status ?? 'idle'}`;
  const isActive = status === 'running' || visible;
  const fillWidth = isActive ? displayedProgress : 0;

  return (
    <div className={stateClass} data-active={isActive ? 'true' : 'false'}>
      <div className="flow-node-progress__fill" style={{ width: `${fillWidth}%` }} />
    </div>
  );
}
