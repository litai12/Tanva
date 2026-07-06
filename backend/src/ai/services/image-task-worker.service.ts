import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { IMAGE_TASK_QUEUE, ImageTaskJobPayload } from './image-task-queue.service';
import { ImageTaskService } from './image-task.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import { PLATFORM_TENANT_ID } from '../../tenancy/tenant.constants';

@Injectable()
export class ImageTaskWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageTaskWorkerService.name);
  private worker!: Worker;

  // 固定并发：不再按内存动态夹取（旧逻辑在容器里常被夹到 1，导致任务全部卡在 queued）。
  // 也不再挂 BullMQ 限流器——并发只由这个固定值决定。
  // 兜底默认从 1000000(等于不限,一波并发任务会同时占堆→V8 堆 OOM,incident 2026-06-25)
  // 收敛为 200。超出并发的任务在 Redis 排队,不丢不拒;只有"同时在跑"的这些占 Node 堆。
  // 200 偏激进:大部分时间 job 在等上游(占内存少),只有结果下载+base64 那段吃堆,
  // 风险是峰值叠加。务必配 --max-old-space-size + 看 pm2 monit,RSS 逼近 4G 就调低
  // IMAGE_TASK_MAX_CONCURRENT(改 env 重启即可,见 ecosystem.config.js)。
  private static readonly CONCURRENCY = Number(
    process.env.IMAGE_TASK_MAX_CONCURRENT ?? 200,
  );

  constructor(
    private readonly config: ConfigService,
    private readonly imageTaskService: ImageTaskService,
    private readonly tenantContext: TenantContextService,
  ) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379';

    this.worker = new Worker(
      IMAGE_TASK_QUEUE,
      async (job) => {
        // worker 回调脱离请求期 CLS：用入队时捕获的 tenantId 回到对应租户 CLS，
        // 预扣积分/状态/落结果都写到正确租户。旧任务/缺省回退到默认租户（行为不变）。
        const payload = job.data as ImageTaskJobPayload;
        const tenantId = payload.tenantId ?? PLATFORM_TENANT_ID;
        await this.tenantContext.runAsTenant(tenantId, () =>
          this.imageTaskService.executeTaskFromJob(payload),
        );
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
