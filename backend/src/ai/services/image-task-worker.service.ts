import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import os from 'os';
import { IMAGE_TASK_QUEUE } from './image-task-queue.service';
import { ImageTaskService } from './image-task.service';

@Injectable()
export class ImageTaskWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageTaskWorkerService.name);
  private worker!: Worker;
  private memCheckTimer?: NodeJS.Timeout;

  // Absolute MB values — machine-agnostic, no percentage nonsense.
  private static readonly MEM_PER_TASK_MB  = Number(process.env.IMAGE_TASK_MEM_PER_MB       ?? 300);
  private static readonly MAX_CONCURRENT   = Number(process.env.IMAGE_TASK_MAX_CONCURRENT    ?? 12);
  private static readonly MEM_RESERVE_MB   = Number(process.env.IMAGE_TASK_MEM_RESERVE_MB    ?? 500); // keep 500 MB free
  private static readonly LIMITER_MAX      = Number(process.env.IMAGE_TASK_LIMITER_MAX        ?? 60);
  private static readonly LIMITER_DURATION = Number(process.env.IMAGE_TASK_LIMITER_DURATION   ?? 15_000);

  constructor(
    private readonly config: ConfigService,
    private readonly imageTaskService: ImageTaskService,
  ) {}

  /** Compute desired concurrency from current free memory. Always at least 1. */
  private computeConcurrency(): number {
    const freeMB = os.freemem() / 1024 / 1024;
    const usable = freeMB - ImageTaskWorkerService.MEM_RESERVE_MB;
    const computed = Math.floor(usable / ImageTaskWorkerService.MEM_PER_TASK_MB);
    // max(1, ...) — always run at least one task regardless of memory pressure
    return Math.min(Math.max(1, computed), ImageTaskWorkerService.MAX_CONCURRENT);
  }

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';
    const concurrency = this.computeConcurrency();

    this.worker = new Worker(
      IMAGE_TASK_QUEUE,
      async (job) => {
        await this.imageTaskService.executeTaskFromJob(job.data);
      },
      {
        connection: { url },
        concurrency,
        limiter: {
          max: ImageTaskWorkerService.LIMITER_MAX,
          duration: ImageTaskWorkerService.LIMITER_DURATION,
        },
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log(
      `Image task worker started` +
      ` — concurrency=${concurrency}` +
      ` reserve=${ImageTaskWorkerService.MEM_RESERVE_MB}MB` +
      ` limiter=${ImageTaskWorkerService.LIMITER_MAX}/${ImageTaskWorkerService.LIMITER_DURATION}ms` +
      ` freeMem=${Math.round(os.freemem() / 1024 / 1024)}MB`,
    );

    // Every 30s: dynamically adjust concurrency based on free memory.
    // Never pauses fully — minimum concurrency is always 1.
    this.memCheckTimer = setInterval(() => this.adjustConcurrency(), 30_000);
  }

  private adjustConcurrency(): void {
    const freeMB = Math.round(os.freemem() / 1024 / 1024);
    const desired = this.computeConcurrency();
    const current = this.worker.concurrency;

    if (desired !== current) {
      this.worker.concurrency = desired;
      this.logger.log(
        `Concurrency adjusted: ${current} → ${desired} (free=${freeMB}MB, reserve=${ImageTaskWorkerService.MEM_RESERVE_MB}MB)`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.memCheckTimer) clearInterval(this.memCheckTimer);
    await this.worker.close();
  }
}
