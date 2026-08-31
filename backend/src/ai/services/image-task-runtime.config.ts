const MIB = 1024 * 1024;

export interface ImageTaskRuntimeConfig {
  maxConcurrent: number;
  idleRecycleRssBytes: number;
  idleRecycleCheckMs: number;
  idleRecycleMinUptimeSec: number;
  outputMaxBytes: number;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function resolveImageTaskRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ImageTaskRuntimeConfig {
  const idleRecycleMb = boundedInteger(
    env.IMAGE_TASK_IDLE_RECYCLE_MB,
    0,
    0,
    64 * 1024,
  );
  const outputMaxMb = boundedInteger(
    env.IMAGE_TASK_OUTPUT_MAX_MB,
    64,
    1,
    1024,
  );

  return {
    // Keep the established production throughput ceiling. Native-memory
    // governance is handled independently through byte caps, Sharp limits,
    // allocator tuning and idle-only recycling.
    maxConcurrent: boundedInteger(
      env.IMAGE_TASK_MAX_CONCURRENT,
      1000,
      1,
      1000,
    ),
    // Disabled by default outside an explicitly managed production process.
    // PM2 config enables it; recycle only happens while this worker is idle.
    idleRecycleRssBytes: idleRecycleMb * MIB,
    idleRecycleCheckMs: boundedInteger(
      env.IMAGE_TASK_IDLE_RECYCLE_CHECK_MS,
      30_000,
      5_000,
      10 * 60_000,
    ),
    idleRecycleMinUptimeSec: boundedInteger(
      env.IMAGE_TASK_IDLE_RECYCLE_MIN_UPTIME_SEC,
      300,
      60,
      24 * 60 * 60,
    ),
    outputMaxBytes: outputMaxMb * MIB,
  };
}

export function shouldRecycleIdleImageTaskProcess(input: {
  rssBytes: number;
  activeJobs: number;
  uptimeSec: number;
  config: ImageTaskRuntimeConfig;
}): boolean {
  const { config } = input;
  return (
    config.idleRecycleRssBytes > 0 &&
    input.activeJobs === 0 &&
    input.uptimeSec >= config.idleRecycleMinUptimeSec &&
    input.rssBytes >= config.idleRecycleRssBytes
  );
}
