import { create } from 'zustand';

export type PendingUploadSummary = {
  inFlightUploads: number;
  pendingImageAssets: number;
  pendingFlowNodes: number;
  runningFlowNodes: number;
  runningChatMessages: number;
  aiDialogGenerating: boolean;
  globalFlowRunning: boolean;
  hasRunning: boolean;
  hasPending: boolean;
  hasRisk: boolean;
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

const DEFAULT_TITLE = '当前画板仍有任务在运行或上传';
const DEFAULT_MESSAGE = '请勿轻易离开页面；如执意离开，运行或上传中的数据可能丢失。';

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
