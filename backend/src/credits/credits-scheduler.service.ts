import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditsService } from './credits.service';
import { CreditsAnomalyService } from './credits-anomaly.service';

@Injectable()
export class CreditsSchedulerService {
  private readonly logger = new Logger(CreditsSchedulerService.name);

  constructor(
    private readonly creditsService: CreditsService,
    private readonly creditsAnomalyService: CreditsAnomalyService,
  ) {}

  /**
   * 每天凌晨 2 点执行过期积分清理
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleExpiredCreditsCleanup() {
    this.logger.log('开始执行签到积分过期清理任务...');

    try {
      const result = await this.creditsService.cleanupExpiredDailyRewards();
      this.logger.log(
        `签到积分过期清理完成: 处理 ${result.processedUsers} 个用户, 清除 ${result.totalExpiredCredits} 积分`
      );
    } catch (error) {
      this.logger.error('签到积分过期清理失败:', error);
    }
  }

  /**
   * 每 5 分钟执行一次：处理长时间 pending 的生图调用并自动退款
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleStalePendingAutoRefund() {
    try {
      const result = await this.creditsService.autoRefundStalePendingImageUsages();

      if (result.scanned > 0 || result.errors > 0) {
        this.logger.log(
          `pending超时自动退款完成: scanned=${result.scanned}, refunded=${result.refunded}, skippedSuccess=${result.skippedSuccess}, errors=${result.errors}, timeoutMinutes=${result.timeoutMinutes}`,
        );
      }
    } catch (error) {
      this.logger.error('pending超时自动退款任务失败:', error);
    }

    try {
      const anomalyResult = await this.creditsAnomalyService.detectDailyCreditAnomalies();
      if (anomalyResult.upsertedRecords > 0) {
        this.logger.log(
          `积分异常检测完成: day=${anomalyResult.dayLabel}, scannedTransactions=${anomalyResult.scannedTransactions}, scannedUsers=${anomalyResult.scannedUsers}, upserted=${anomalyResult.upsertedRecords}`,
        );
      }
    } catch (error) {
      this.logger.error('积分异常检测任务失败:', error);
    }
  }
}
