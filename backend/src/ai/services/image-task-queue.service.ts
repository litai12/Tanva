import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

export const IMAGE_TASK_QUEUE = 'image-tasks';

@Injectable()
export class ImageTaskQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageTaskQueueService.name);
  private queue!: Queue;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';
    this.queue = new Queue(IMAGE_TASK_QUEUE, {
      connection: { url },
      defaultJobOptions: {
        attempts: 1,          // 重试由业务层控制，不依赖 BullMQ
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
    this.logger.log(`Image task queue initialized (Redis: ${url})`);
  }

  async addJob(taskId: string): Promise<void> {
    await this.queue.add('execute', { taskId }, { jobId: taskId });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
