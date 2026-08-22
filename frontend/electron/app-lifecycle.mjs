const DEFAULT_CLEANUP_TIMEOUT_MS = 1_500;

export const createQuitCoordinator = ({
  cleanup,
  quit,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
}) => {
  let state = 'idle';
  let pendingQuit = null;

  const requestQuit = () => {
    if (state === 'ready') {
      quit();
      return Promise.resolve();
    }
    if (pendingQuit) return pendingQuit;

    state = 'cleaning';

    let timeoutId;
    const cleanupTimeout = new Promise((resolve) => {
      timeoutId = setTimeout(resolve, cleanupTimeoutMs);
    });

    pendingQuit = Promise.race([
      Promise.resolve().then(cleanup),
      cleanupTimeout,
    ])
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeoutId);
        state = 'ready';
        quit();
      });

    return pendingQuit;
  };

  return {
    isQuitPending: () => state !== 'idle',
    isReadyToQuit: () => state === 'ready',
    requestQuit,
  };
};
