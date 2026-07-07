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
  // 兜底默认从 1000000(等于不限,一波并发任务会同时占堆→V8 堆 OOM,incident 2026-06-25)
  // 收敛为 1000(2026-07-07 从 200 提高:200 在高峰会造成任务排队数分钟,前端在排队期就把
  // 15min 表走完误报超时;OOM 真因已由缓冲字节上限治本)。
  // 大部分时间 job 在等上游(占内存少),只有结果下载+base64 那段吃堆,风险是峰值叠加。
  // 务必配 --max-old-space-size + 看 pm2 monit,RSS 逼近 4G 就调低
  // IMAGE_TASK_MAX_CONCURRENT(改 env 重启即可,见 ecosystem.config.js)。
  private static readonly CONCURRENCY = Number(
    process.env.IMAGE_TASK_MAX_CONCURRENT ?? 1000,
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
