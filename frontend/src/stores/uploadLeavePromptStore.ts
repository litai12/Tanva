import { create } from 'zustand';

export type PendingUploadSummary = {
  inFlightUploads: number;
  pendingImageAssets: number;
  pendingFlowNodes: number;
  hasPending: boolean;
};

type UploadLeavePromptState = {
  open: boolean;
  title: string;
  message: string;
  summary: PendingUploadSummary | null;
  onConfirm: (() => void) | null;
  openPrompt: (payload: {
    summary: PendingUploadSummary;
    onConfirm: () => void;
    title?: string;
    message?: string;
  }) => void;
  closePrompt: () => void;
};

const DEFAULT_TITLE = '还有图片未上传完成';
const DEFAULT_MESSAGE = '离开将中断上传，可能导致图片丢失。';

export const useUploadLeavePromptStore = create<UploadLeavePromptState>((set, get) => ({
  open: false,
  title: DEFAULT_TITLE,
  message: DEFAULT_MESSAGE,
  summary: null,
  onConfirm: null,
  openPrompt: ({ summary, onConfirm, title, message }) => {
    if (get().open) {
      return;
    }
    set({
      open: true,
      title: title || DEFAULT_TITLE,
      message: message || DEFAULT_MESSAGE,
      summary,
      onConfirm,
    });
  },
  closePrompt: () => set({ open: false, summary: null, onConfirm: null }),
}));

