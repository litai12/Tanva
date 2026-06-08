// backend/src/volc-asset/volc-asset-scheduler.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VolcAssetService } from './volc-asset.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';

@Injectable()
export class VolcAssetSchedulerService {
  private readonly logger = new Logger(VolcAssetSchedulerService.name);
  private cleanupRunning = false;

  constructor(
    private readonly volcAssetService: VolcAssetService,
    private readonly tenantIteration: TenantIterationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleExpiredGroupCleanup() {
    if (this.cleanupRunning) {
      this.logger.warn('跳过素材组清理：上一次任务尚未完成');
      return;
    }
    this.cleanupRunning = true;
    try {
      // 每个 active 租户在自己的 CLS 内清理；只有 default 时 = 原逻辑跑一次。
      await this.tenantIteration.forEachTenant(() => this.cleanupOneTenant());
    } catch (err: any) {
      this.logger.error('素材组清理失败:', err);
    } finally {
      this.cleanupRunning = false;
    }
  }

  private async cleanupOneTenant(): Promise<void> {
    const result = await this.volcAssetService.cleanupExpiredGroup();
    if (result.deleted) {
      this.logger.log(`素材组清理完成: 已删除 ${result.date} 的素材组`);
    } else {
      this.logger.log(`素材组清理：${result.date} 无需清理`);
    }
  }
}
