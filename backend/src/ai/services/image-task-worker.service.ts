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

  private static readonly MEM_PER_TASK_MB = Number(process.env.IMAGE_TASK_MEM_PER_MB ?? 300);
  private static readonly MAX_CONCURRENT = Number(process.env.IMAGE_TASK_MAX_CONCURRENT ?? 12);
  private static readonly MEM_RESERVE_RATIO = 0.25;
  private static readonly MEM_PAUSE_THRESHOLD = 0.15;  // 可用内存 < 15% 时暂停
  private static readonly MEM_RESUME_THRESHOLD = 0.25; // 可用内存 > 25% 时恢复

  constructor(
    private readonly config: ConfigService,
    private readonly imageTaskService: ImageTaskService,
  ) {}

  private computeConcurrency(): number {
    const freeMB = os.freemem() / 1024 / 1024;
    const usableMB = freeMB * (1 - ImageTaskWorkerService.MEM_RESERVE_RATIO);
    const computed = Math.floor(usableMB / ImageTaskWorkerService.MEM_PER_TASK_MB);
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
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log(
      `Image task worker started — concurrency=${concurrency}` +
      ` (可用内存 ${Math.round(os.freemem() / 1024 / 1024)}MB)`,
    );

    // 每 30 秒检测内存，低于阈值时暂停 worker
    this.memCheckTimer = setInterval(() => this.checkMemory(), 30_000);
  }

  private async checkMemory(): Promise<void> {
    const freePct = os.freemem() / os.totalmem();
    const isPaused = await this.worker.isPaused();

    if (freePct < ImageTaskWorkerService.MEM_PAUSE_THRESHOLD && !isPaused) {
      this.logger.warn(
        `内存紧张 (可用 ${(freePct * 100).toFixed(1)}%)，暂停图片任务 worker`,
      );
      await this.worker.pause();
    } else if (freePct >= ImageTaskWorkerService.MEM_RESUME_THRESHOLD && isPaused) {
      this.logger.log(
        `内存恢复 (可用 ${(freePct * 100).toFixed(1)}%)，恢复图片任务 worker`,
      );
      await this.worker.resume();
    }
  }

  async onModuleDestroy() {
    if (this.memCheckTimer) clearInterval(this.memCheckTimer);
    await this.worker.close();
  }
}
