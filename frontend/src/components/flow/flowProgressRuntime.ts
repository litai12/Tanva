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
