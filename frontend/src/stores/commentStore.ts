import { create } from 'zustand';
import { useAIChatStore } from './aiChatStore';

// 开启评论模式时确保对话框以「底部紧凑栏」形式可见（右侧展开面板由 AIChatDialog 监听 active 收起）。
const ensureChatAtBottom = () => {
  try {
    useAIChatStore.getState().showDialog();
  } catch {}
};

export interface DraftPin {
  /** flow 坐标 */
  x: number;
  y: number;
}

interface CommentUIState {
  /** 评论模式：开启后右侧评论抽屉显示，点击画布空白可落 pin。与 AI 对话框互斥（后开覆盖先开）。 */
  active: boolean;
  /** 画布上当前展开的线程 popup（pin 被点开）。 */
  openThreadId: string | null;
  /** 待创建的新评论 pin（点击空白后出现，提交即转为正式线程）。 */
  draftPin: DraftPin | null;
  /** 抽屉点击某条评论 → 请求画布把该 pin 居中/聚焦。消费后清空。 */
  focusThreadId: string | null;

  enter: () => void;
  exit: () => void;
  toggle: () => void;
  /** 由 AI 对话框打开时调用：评论模式让位（后开覆盖先开）。 */
  forceClose: () => void;

  openThread: (threadId: string) => void;
  closeThread: () => void;
  setDraftPin: (pin: DraftPin | null) => void;
  requestFocus: (threadId: string) => void;
  consumeFocus: () => void;
}

export const useCommentStore = create<CommentUIState>((set) => ({
  active: false,
  openThreadId: null,
  draftPin: null,
  focusThreadId: null,

  // 评论模式与对话框右侧展开面板互斥（后触发覆盖先触发），但对话框底部紧凑栏始终保留。
  enter: () => {
    ensureChatAtBottom();
    set({ active: true });
  },
  exit: () => set({ active: false, draftPin: null, openThreadId: null }),
  toggle: () => {
    const { active } = useCommentStore.getState();
    if (active) {
      set({ active: false, draftPin: null, openThreadId: null });
    } else {
      ensureChatAtBottom();
      set({ active: true });
    }
  },
  forceClose: () => set({ active: false, draftPin: null, openThreadId: null }),

  openThread: (threadId) => set({ openThreadId: threadId, draftPin: null }),
  closeThread: () => set({ openThreadId: null }),
  setDraftPin: (pin) => set(pin ? { draftPin: pin, openThreadId: null } : { draftPin: null }),
  requestFocus: (threadId) => set({ focusThreadId: threadId, openThreadId: threadId }),
  consumeFocus: () => set({ focusThreadId: null }),
}));
