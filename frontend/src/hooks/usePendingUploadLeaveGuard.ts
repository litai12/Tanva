import { useCallback } from 'react';

type GuardOptions = {
  title?: string;
  message?: string;
};

export function usePendingUploadLeaveGuard() {
  return useCallback(
    (action: () => void | Promise<void>, _options?: GuardOptions) => {
      void action();
    },
    []
  );
}

