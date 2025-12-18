import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createSafeStorage } from "./storageUtils";

export type AITaskKind = "chat" | "flow-image" | "flow-video";
export type AITaskStatus = "running" | "succeeded" | "failed";

export type AITaskResultSummary = Record<string, unknown>;

export interface AITask {
  id: string;
  kind: AITaskKind;
  status: AITaskStatus;
  createdAt: number;
  updatedAt: number;
  payload?: Record<string, unknown>;
  result?: AITaskResultSummary;
  error?: string | null;
}

type TaskInput = Omit<AITask, "status" | "createdAt" | "updatedAt"> & {
  status?: AITaskStatus;
};

interface AITaskState {
  tasks: Record<string, AITask>;
  startTask: (task: TaskInput) => string;
  finishTask: (id: string, result?: AITaskResultSummary) => void;
  failTask: (id: string, error?: string) => void;
  removeTask: (id: string) => void;
  clearStaleTasks: (maxAgeMs?: number) => void;
}

const STORAGE_NAME = "ai-task-store";

const safeClone = <T,>(value: T): T =>
  JSON.parse(JSON.stringify(value ?? null)) ?? (value as T);

const buildId = (seed?: string) =>
  seed
    ? seed
    : `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useAITaskStore = create<AITaskState>()(
  persist(
    (set, get) => ({
      tasks: {},
      startTask: (task) => {
        const id = buildId(task.id);
        const now = Date.now();
        set((state) => ({
          tasks: {
            ...state.tasks,
            [id]: {
              id,
              kind: task.kind,
              status: task.status ?? "running",
              payload: safeClone(task.payload),
              result: safeClone(task.result),
              error: task.error ?? null,
              createdAt: now,
              updatedAt: now,
            },
          },
        }));
        return id;
      },
      finishTask: (id, result) => {
        set((state) => {
          const existing = state.tasks[id];
          if (!existing) return state;
          return {
            tasks: {
              ...state.tasks,
              [id]: {
                ...existing,
                status: "succeeded",
                result: result ? safeClone(result) : existing.result,
                error: null,
                updatedAt: Date.now(),
              },
            },
          };
        });
      },
      failTask: (id, error) => {
        set((state) => {
          const existing = state.tasks[id];
          if (!existing) return state;
          return {
            tasks: {
              ...state.tasks,
              [id]: {
                ...existing,
                status: "failed",
                error: error ?? existing.error ?? "执行失败",
                updatedAt: Date.now(),
              },
            },
          };
        });
      },
      removeTask: (id) => {
        set((state) => {
          const next = { ...state.tasks };
          delete next[id];
          return { tasks: next };
        });
      },
      clearStaleTasks: (maxAgeMs = 1000 * 60 * 60 * 12) => {
        const cutoff = Date.now() - maxAgeMs;
        set((state) => {
          const next: Record<string, AITask> = {};
          Object.entries(state.tasks).forEach(([id, task]) => {
            if (task.updatedAt >= cutoff) {
              next[id] = task;
            }
          });
          return { tasks: next };
        });
      },
    }),
    {
      name: STORAGE_NAME,
      storage: createJSONStorage(() =>
        createSafeStorage({ storageName: STORAGE_NAME })
      ),
      partialize: (state) => ({
        tasks: state.tasks,
      }),
    }
  )
);

