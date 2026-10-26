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

/**
 * 节点的运行态只属于发起运行的那个客户端：协作补丁若带上它，对端会显示别人的「生成中」，
 * 而同步生图的完成只写在发起端，对端永远停在模拟进度 95%（僵尸节点）。运行进度与结果
 * 统一走后端按 nodeId 广播的 task_status。
 */
const FLOW_RUN_STATE_KEYS = [
  "status", "error", "progress", "progressStartedAt", "taskPhase", "taskId",
  "apiUsageId", "videoTaskProvider", "videoTaskStartedAt", "pendingVideoPrompt",
] as const;

export const stripFlowRunStateForCollab = <TData extends Record<string, unknown>>(data: TData): TData => {
  if (!data || typeof data !== "object") return data;
  if (!FLOW_RUN_STATE_KEYS.some((key) => key in data)) return data;
  const next: Record<string, unknown> = { ...data };
  FLOW_RUN_STATE_KEYS.forEach((key) => { delete next[key]; });
  return next as TData;
};

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
