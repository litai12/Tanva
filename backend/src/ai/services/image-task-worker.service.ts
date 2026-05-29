import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { IMAGE_TASK_QUEUE } from './image-task-queue.service';
import { ImageTaskService } from './image-task.service';

@Injectable()
export class ImageTaskWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageTaskWorkerService.name);
  private worker!: Worker;

  // 固定并发：不再按内存动态夹取（旧逻辑在容器里常被夹到 1，导致任务全部卡在 queued）。
  // 也不再挂 BullMQ 限流器——并发只由这个固定值决定。
  private static readonly CONCURRENCY = Number(
    process.env.IMAGE_TASK_MAX_CONCURRENT ?? 1000000,
  );

  constructor(
    private readonly config: ConfigService,
    private readonly imageTaskService: ImageTaskService,
  ) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';

    this.worker = new Worker(
      IMAGE_TASK_QUEUE,
      async (job) => {
        await this.imageTaskService.executeTaskFromJob(job.data);
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
      `Image task worker started — concurrency=${ImageTaskWorkerService.CONCURRENCY} (fixed, no limiter)`,
    );
  }

  async onModuleDestroy() {
    await this.worker.close();
  }
}
