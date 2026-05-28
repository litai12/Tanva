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

// ── Rate-limit tunables (override via env) ────────────────────────────────────
// Per-user: max N task submissions per window
const USER_LIMIT         = Number(process.env.IMAGE_TASK_USER_LIMIT          ?? 20);
const USER_WINDOW_SEC    = Number(process.env.IMAGE_TASK_USER_WINDOW_SEC      ?? 60);
// Global: max total jobs waiting+active before new submissions are rejected
const GLOBAL_QUEUE_LIMIT = Number(process.env.IMAGE_TASK_GLOBAL_QUEUE_LIMIT  ?? 500);

@Injectable()
export class ImageTaskQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageTaskQueueService.name);
  private queue!: Queue;
  private redis!: {
    incr(key: string): Promise<number>;
    expire(key: string, ttl: number): Promise<number>;
    ttl(key: string): Promise<number>;
    on(event: string, handler: (...args: any[]) => void): void;
    disconnect(): void;
  };

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';

    // Reuse ioredis (already a dep via bullmq)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require('ioredis');
    this.redis = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false });
    this.redis.on('error', (err: Error) => this.logger.warn(`Rate-limiter redis error: ${err.message}`));

    this.queue = new Queue(IMAGE_TASK_QUEUE, {
      connection: { url },
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    this.logger.log(
      `Image task queue initialized — userLimit=${USER_LIMIT}/${USER_WINDOW_SEC}s globalLimit=${GLOBAL_QUEUE_LIMIT}`,
    );
  }

  /**
   * Check rate limits then enqueue.
   * Throws TooManyRequestsException (HTTP 429) when either limit is exceeded.
   */
  async addJob(payload: ImageTaskJobPayload): Promise<void> {
    await this.checkRateLimits(payload.userId);
    await this.queue.add('execute', payload, { jobId: payload.taskId });
  }

  /** Returns true if the job is still waiting/active (DB record not yet written). */
  async hasJob(taskId: string): Promise<boolean> {
    const job = await this.queue.getJob(taskId);
    return job != null;
  }

  async onModuleDestroy() {
    await this.queue.close();
    this.redis.disconnect();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async checkRateLimits(userId: string): Promise<void> {
    // 1. Global queue depth — fast: single LLEN via BullMQ counts
    const counts = await this.queue.getJobCounts('waiting', 'active');
    const depth = (counts.waiting ?? 0) + (counts.active ?? 0);
    if (depth >= GLOBAL_QUEUE_LIMIT) {
      this.logger.warn(`Global queue limit hit: depth=${depth}/${GLOBAL_QUEUE_LIMIT}`);
      throw new HttpException(
        `系统任务队列已满（${depth}/${GLOBAL_QUEUE_LIMIT}），请稍后重试`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Per-user sliding window (Redis INCR + EXPIRE)
    const key = `rl:img:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      // First request in this window — set expiry
      await this.redis.expire(key, USER_WINDOW_SEC);
    }
    if (count > USER_LIMIT) {
      const ttl = await this.redis.ttl(key);
      this.logger.warn(`User rate limit hit: userId=${userId} count=${count}/${USER_LIMIT} ttl=${ttl}s`);
      throw new HttpException(
        `提交过于频繁，${USER_WINDOW_SEC} 秒内最多 ${USER_LIMIT} 个任务（当前 ${count}），请 ${ttl} 秒后重试`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
