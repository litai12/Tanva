import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { IMAGE_TASK_QUEUE } from './image-task-queue.service';
import { ImageTaskService } from './image-task.service';
import {
  resolveImageTaskRuntimeConfig,
  shouldRecycleIdleImageTaskProcess,
} from './image-task-runtime.config';

const RUNTIME_CONFIG = resolveImageTaskRuntimeConfig();

@Injectable()
export class ImageTaskWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageTaskWorkerService.name);
  private worker: Worker | null = null;
  private recycleTimer: NodeJS.Timeout | null = null;
  private activeJobs = 0;
  private recycleRequested = false;

  // 固定并发：不再按内存动态夹取（旧逻辑在容器里常被夹到 1，导致任务全部卡在 queued）。
  // 也不再挂 BullMQ 限流器——并发只由这个固定值决定。
  // 兜底默认从 1000000(等于不限,一波并发任务会同时占堆→V8 堆 OOM,incident 2026-06-25)
  // 维持业务既有的 1000 并发上限；生产环境通过统一配置解析器把范围固定为
  // 1..1000。结果字节上限、Sharp 约束、jemalloc 与空闲回收独立治理 native RSS。
  private static readonly CONCURRENCY = RUNTIME_CONFIG.maxConcurrent;

  constructor(
    private readonly config: ConfigService,
    private readonly imageTaskService: ImageTaskService,
  ) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';

    this.worker = new Worker(
      IMAGE_TASK_QUEUE,
      async (job) => {
        this.activeJobs += 1;
        try {
          await this.imageTaskService.executeTaskFromJob(job.data);
        } finally {
          this.activeJobs = Math.max(0, this.activeJobs - 1);
        }
      },
      {
        connection: { url },
        concurrency: ImageTaskWorkerService.CONCURRENCY,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log(
      `Image task worker started — concurrency=${ImageTaskWorkerService.CONCURRENCY}` +
        ` idleRecycleRss=${RUNTIME_CONFIG.idleRecycleRssBytes || 'disabled'}`,
    );

    if (RUNTIME_CONFIG.idleRecycleRssBytes > 0) {
      this.recycleTimer = setInterval(
        () => this.checkIdleRecycle(),
        RUNTIME_CONFIG.idleRecycleCheckMs,
      );
      this.recycleTimer.unref?.();
    }
  }

  async onModuleDestroy() {
    if (this.recycleTimer) clearInterval(this.recycleTimer);
    this.recycleTimer = null;
    await this.worker?.close();
    this.worker = null;
  }

  private checkIdleRecycle(): void {
    if (this.recycleRequested) return;
    const memory = process.memoryUsage();
    if (
      !shouldRecycleIdleImageTaskProcess({
        rssBytes: memory.rss,
        activeJobs: this.activeJobs,
        uptimeSec: process.uptime(),
        config: RUNTIME_CONFIG,
      })
    ) {
      return;
    }

    this.recycleRequested = true;
    this.logger.warn(
      `Image worker idle RSS recycle requested — rss=${memory.rss}` +
        ` threshold=${RUNTIME_CONFIG.idleRecycleRssBytes}`,
    );

    // Only reached with activeJobs=0. Close the BullMQ consumer first so no new
    // job can be claimed between the idle check and exit; PM2 then starts a
    // fresh allocator without interrupting a billed generation task.
    void this.worker
      ?.close()
      .catch((error) => {
        this.logger.error(
          `Image worker close before recycle failed: ${(error as Error).message}`,
        );
      })
      .finally(() => {
        // Nest's shutdown hook stops Fastify from accepting new requests and
        // drains the other providers. Keep a bounded fallback in case a native
        // handle refuses to close; PM2 will start the replacement process.
        const forceExitTimer = setTimeout(() => {
          this.logger.error('Graceful idle RSS recycle timed out; forcing exit');
          process.exit(0);
        }, 30_000);
        forceExitTimer.unref?.();
        process.kill(process.pid, 'SIGTERM');
      });
  }
}
