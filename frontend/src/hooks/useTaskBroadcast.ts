import { useEffect, useState } from 'react';
import type { CanvasCollabHandle } from './useCanvasCollab';
import type { CollabEnvelope, TaskStatusPayload } from '../collab/types';

export interface TaskBroadcastEntry extends TaskStatusPayload {
  receivedAt: number;
}

export interface UseTaskBroadcastOptions {
  /**
   * Called whenever a task status event arrives. Useful for triggering
   * downstream node refresh / cache invalidation.
   */
  onTaskStatus?: (entry: TaskBroadcastEntry) => void;
}

/**
 * Subscribe to project-scoped task status broadcasts. Keeps the latest entry
 * per taskId so consumers can render running tasks without polling.
 */
export function useTaskBroadcast(
  collab: CanvasCollabHandle,
  options: UseTaskBroadcastOptions = {},
): { tasks: Record<string, TaskBroadcastEntry> } {
  const [tasks, setTasks] = useState<Record<string, TaskBroadcastEntry>>({});
  const { onTaskStatus } = options;

  useEffect(() => {
    const off = collab.subscribe('task_status', (env: CollabEnvelope) => {
      const p = env.payload as TaskStatusPayload;
      const entry: TaskBroadcastEntry = { ...p, receivedAt: Date.now() };
      setTasks((prev) => ({ ...prev, [p.taskId]: entry }));
      try {
        onTaskStatus?.(entry);
      } catch {}
    });
    return off;
  }, [collab, onTaskStatus]);

  return { tasks };
}
