import { useCallback } from 'react';
import { useUploadLeavePromptStore } from '@/stores/uploadLeavePromptStore';
import { getPendingUploadSummary } from '@/utils/pendingUploadSummary';

type GuardOptions = {
  title?: string;
  message?: string;
};

export function usePendingUploadLeaveGuard() {
  const openPrompt = useUploadLeavePromptStore((state) => state.openPrompt);

  return useCallback(
    (action: () => void | Promise<void>, options?: GuardOptions) => {
      const summary = getPendingUploadSummary();
      if (!summary.hasPending) {
        void action();
        return;
      }

      openPrompt({
        summary,
        title: options?.title,
        message: options?.message,
        onConfirm: () => {
          void action();
        },
      });
    },
    [openPrompt]
  );
}

