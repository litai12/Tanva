/**
 * Creates the transient runtime patch for a new Flow run.
 * Always replace an existing timestamp: it belongs to the previous run and
 * would otherwise make a rerun jump directly to the simulated 95% ceiling.
 */
export const startFlowProgressRun = <TData extends object>(
  data: TData,
  startedAt = Date.now(),
): TData & { progressStartedAt: number } => ({
  ...data,
  progressStartedAt: startedAt,
});

export const SINGLE_IMAGE_TASK_NODE_TYPES = new Set([
  "generate", "generatePro", "generateRef", "viewAngle", "nano2", "gptImage2",
]);

/** Clear the previous task before making this run visible to recovery effects. */
export const startFlowImageRun = <TData extends object>(data: TData, startedAt = Date.now()):
  Omit<TData, 'status' | 'error' | 'taskId' | 'taskPhase' | 'progressStartedAt'> & {
    status: 'running'; error: undefined; taskId: undefined; taskPhase: undefined; progressStartedAt: number;
  } => ({
  ...startFlowProgressRun(data, startedAt),
  status: "running" as const,
  error: undefined,
  taskId: undefined,
  taskPhase: undefined,
});
