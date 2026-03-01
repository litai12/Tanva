import { create } from 'zustand';

type UploadTask = {
  label: string;
  startedAt: number;
};

type UploadTaskState = {
  inFlight: Record<string, UploadTask>;
  begin: (label: string) => string;
  end: (taskId: string) => void;
  reset: () => void;
};

function createTaskId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useUploadTaskStore = create<UploadTaskState>((set) => ({
  inFlight: {},
  begin: (label) => {
    const taskId = createTaskId('upload');
    set((state) => ({
      inFlight: {
        ...state.inFlight,
        [taskId]: {
          label,
          startedAt: Date.now(),
        },
      },
    }));
    return taskId;
  },
  end: (taskId) => {
    set((state) => {
      if (!state.inFlight[taskId]) {
        return state;
      }
      const next = { ...state.inFlight };
      delete next[taskId];
      return { inFlight: next };
    });
  },
  reset: () => set({ inFlight: {} }),
}));

export function getInFlightUploadCount(): number {
  return Object.keys(useUploadTaskStore.getState().inFlight).length;
}

