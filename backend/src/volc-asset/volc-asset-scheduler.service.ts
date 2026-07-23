// backend/src/volc-asset/volc-asset-scheduler.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VolcAssetService } from './volc-asset.service';

@Injectable()
export class VolcAssetSchedulerService {
  private readonly logger = new Logger(VolcAssetSchedulerService.name);
  private cleanupRunning = false;
  private taskCleanupRunning = false;

  constructor(private readonly volcAssetService: VolcAssetService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleExpiredGroupCleanup() {
    if (this.cleanupRunning) {
      this.logger.warn('跳过素材组清理：上一次任务尚未完成');
      return;
    }
    this.cleanupRunning = true;
    try {
      const result = await this.volcAssetService.cleanupExpiredGroup();
      if (result.deleted) {
        this.logger.log(`素材组清理完成: 已删除 ${result.date} 的素材组`);
      } else {
        this.logger.log(`素材组清理：${result.date} 无需清理`);
      }
    } catch (err: any) {
      this.logger.error('素材组清理失败:', err);
    } finally {
      this.cleanupRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredTaskGroupCleanup() {
    if (this.taskCleanupRunning) return;
    this.taskCleanupRunning = true;
    try {
      const result = await this.volcAssetService.cleanupExpiredTaskAssetGroups();
      if (result.deleted || result.failed) {
        this.logger.log(`一次性素材组兜底清理: deleted=${result.deleted}, failed=${result.failed}`);
      }
    } catch (err: any) {
      this.logger.error('一次性素材组兜底清理失败:', err);
    } finally {
      this.taskCleanupRunning = false;
    }
  }
}
