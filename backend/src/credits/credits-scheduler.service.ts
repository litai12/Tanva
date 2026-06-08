import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreditsService } from './credits.service';
import { CreditsAnomalyService } from './credits-anomaly.service';
import { TenantIterationService } from '../tenancy/tenant-iteration.service';

@Injectable()
export class CreditsSchedulerService {
  private readonly logger = new Logger(CreditsSchedulerService.name);
  private stalePendingAutoRefundRunning = false;
  private anomalyDetectionRunning = false;

  constructor(
    private readonly creditsService: CreditsService,
    private readonly creditsAnomalyService: CreditsAnomalyService,
    private readonly tenantIteration: TenantIterationService,
  ) {}

  /**
   * 每天凌晨 2 点执行过期积分清理
   *
   * 多租户：对每个 active 租户在其 CLS 内各跑一次清理；
   * 只有 default 一个租户时 = 原逻辑跑一次（回归安全）。
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleExpiredCreditsCleanup() {
    await this.tenantIteration.forEachTenant(() => this.runExpiredCreditsCleanup());
  }

  private async runExpiredCreditsCleanup() {
    this.logger.log('开始执行签到积分过期清理任务...');

    try {
      const result = await this.creditsService.cleanupExpiredDailyRewards();
      this.logger.log(
        `签到积分过期清理完成: 处理 ${result.processedUsers} 个用户, 清除 ${result.totalExpiredCredits} 积分`
      );

      const freeQuotaResult = await this.creditsService.cleanupExpiredFreeUserMonthlyQuotaCredits();
      if (freeQuotaResult.expiredLots > 0 || freeQuotaResult.expiredCredits > 0) {
        this.logger.log(
          `免费用户一次性额度过期清理完成: accounts=${freeQuotaResult.processedAccounts}, lots=${freeQuotaResult.expiredLots}, credits=${freeQuotaResult.expiredCredits}`,
        );
      }
    } catch (error) {
      this.logger.error('签到积分过期清理失败:', error);
    }
  }

  /**
   * 每 5 分钟执行一次：处理长时间 pending 的异步调用并自动退款
   *
   * 多租户：对每个 active 租户在其 CLS 内各跑一次退款扫描；
   * 只有 default 一个租户时 = 原逻辑跑一次（回归安全）。
   * Running 守卫保持进程级（per-process），避免上一轮全租户未跑完时重入。
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleStalePendingAutoRefund() {
    if (this.stalePendingAutoRefundRunning) {
      this.logger.warn('跳过 pending 超时自动退款：上一次任务尚未完成');
      return;
    }

    this.stalePendingAutoRefundRunning = true;
    try {
      await this.tenantIteration.forEachTenant(() => this.runStalePendingAutoRefund());
    } finally {
      this.stalePendingAutoRefundRunning = false;
    }
  }

  private async runStalePendingAutoRefund() {
    try {
      const [imageResult, videoResult] = await Promise.all([
        this.creditsService.autoRefundStalePendingImageUsages(),
        this.creditsService.autoRefundStalePendingVideoUsages(),
      ]);

      if (
        imageResult.scanned > 0 ||
        imageResult.errors > 0 ||
        videoResult.scanned > 0 ||
        videoResult.errors > 0
      ) {
        this.logger.log(
          `pending超时自动退款完成: image(scanned=${imageResult.scanned}, refunded=${imageResult.refunded}, skippedSuccess=${imageResult.skippedSuccess}, errors=${imageResult.errors}, timeoutMinutes=${imageResult.timeoutMinutes}) video(scanned=${videoResult.scanned}, refunded=${videoResult.refunded}, skippedSuccess=${videoResult.skippedSuccess}, errors=${videoResult.errors}, timeoutMinutes=${videoResult.timeoutMinutes})`,
        );
      }
    } catch (error) {
      this.logger.error('pending超时自动退款任务失败:', error);
    }
  }

  /**
   * 每小时执行一次：检测当天积分异常
   *
   * 多租户：对每个 active 租户在其 CLS 内各跑一次异常检测；
   * 只有 default 一个租户时 = 原逻辑跑一次（回归安全）。
   * Running 守卫保持进程级（per-process），避免上一轮全租户未跑完时重入。
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCreditAnomalyDetection() {
    if (this.anomalyDetectionRunning) {
      this.logger.warn('跳过积分异常检测：上一次任务尚未完成');
      return;
    }

    this.anomalyDetectionRunning = true;
    try {
      await this.tenantIteration.forEachTenant(() => this.runCreditAnomalyDetection());
    } finally {
      this.anomalyDetectionRunning = false;
    }
  }

  private async runCreditAnomalyDetection() {
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
