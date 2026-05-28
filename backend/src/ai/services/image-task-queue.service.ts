import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { ImageTaskType } from './image-task.service';

export const IMAGE_TASK_QUEUE = 'image-tasks';

/** Full payload stored in the BullMQ job — no DB read needed at the start of execution. */
export interface ImageTaskJobPayload {
  taskId: string;
  userId: string;
  type: ImageTaskType;
  prompt: string;
  requestData: Record<string, any>;
  aiProvider?: string;
  nodeId?: string | null;
}

// ── Queue depth two-watermark (backpressure, NOT admission rate-limiting) ─────
// High watermark: start rejecting new submissions when queue reaches this depth.
// Low watermark:  resume accepting once queue drains below this level.
// These only protect against unbounded Redis growth, NOT normal burst traffic.
const QUEUE_HIGH_WATERMARK = Number(process.env.IMAGE_TASK_QUEUE_HIGH ?? 200_000_000);
const QUEUE_LOW_WATERMARK  = Number(process.env.IMAGE_TASK_QUEUE_LOW  ?? 100_000_000);

@Injectable()
export class ImageTaskQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageTaskQueueService.name);
  private queue!: Queue;
  /** True while queue depth is above high watermark — latched until it drops to low watermark */
  private backpressureActive = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';
    this.queue = new Queue(IMAGE_TASK_QUEUE, {
      connection: { url },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    this.logger.log(
      `Image task queue initialized` +
      ` — highWatermark=${QUEUE_HIGH_WATERMARK} lowWatermark=${QUEUE_LOW_WATERMARK}`,
    );
  }

  /**
   * Enqueue a task.
   * Only rejects (503) when queue depth is above the high watermark AND
   * has not yet drained back to the low watermark — normal burst traffic
   * is always accepted.
   */
  async addJob(payload: ImageTaskJobPayload): Promise<void> {
    await this.checkBackpressure();
    await this.queue.add('execute', payload, { jobId: payload.taskId });
  }

  /** Returns true if the job is still waiting/active (DB record not yet written). */
  async hasJob(taskId: string): Promise<boolean> {
    const job = await this.queue.getJob(taskId);
    return job != null;
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async checkBackpressure(): Promise<void> {
    const counts = await this.queue.getJobCounts('waiting', 'active');
    const depth = (counts.waiting ?? 0) + (counts.active ?? 0);

    if (!this.backpressureActive && depth >= QUEUE_HIGH_WATERMARK) {
      this.backpressureActive = true;
      this.logger.warn(
        `Queue backpressure ON: depth=${depth} >= high=${QUEUE_HIGH_WATERMARK}`,
      );
    } else if (this.backpressureActive && depth <= QUEUE_LOW_WATERMARK) {
      this.backpressureActive = false;
      this.logger.log(
        `Queue backpressure OFF: depth=${depth} <= low=${QUEUE_LOW_WATERMARK}`,
      );
    }

    if (this.backpressureActive) {
      throw new HttpException(
        `服务器任务队列繁忙（积压 ${depth} 个），请稍后重试`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
