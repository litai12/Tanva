import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MembershipService } from './membership.service';

@Injectable()
export class MembershipSchedulerService {
  private readonly logger = new Logger(MembershipSchedulerService.name);
  private expiryJobRunning = false;
  private giftDecayJobRunning = false;
  private yearlyRefreshJobRunning = false;

  constructor(private readonly membershipService: MembershipService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleMembershipExpiry() {
    if (this.expiryJobRunning) {
      this.logger.warn('跳过会员到期扫描：上一次任务尚未完成');
      return;
    }

    this.expiryJobRunning = true;
    try {
      const result = await this.membershipService.expireElapsedMemberships();
      if (
        result.expiredSubscriptions > 0 ||
        result.expiredLots > 0 ||
        result.resetSnapshots > 0
      ) {
        this.logger.log(
          `会员到期扫描完成: subscriptions=${result.expiredSubscriptions}, lots=${result.expiredLots}, resetSnapshots=${result.resetSnapshots}, expiredCredits=${result.expiredCredits}`,
        );
      }
    } catch (error) {
      this.logger.error('会员到期扫描失败:', error);
    } finally {
      this.expiryJobRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleGiftDecay() {
    if (this.giftDecayJobRunning) {
      this.logger.warn('跳过赠送积分衰减：上一次任务尚未完成');
      return;
    }

    this.giftDecayJobRunning = true;
    try {
      const result = await this.membershipService.decayDailyGiftCredits();
      if (result.affectedUsers > 0 || result.decayedCredits > 0) {
        this.logger.log(
          `赠送积分衰减完成: users=${result.affectedUsers}, decayedCredits=${result.decayedCredits}, updatedLots=${result.updatedLots}`,
        );
      }
    } catch (error) {
      this.logger.error('赠送积分衰减失败:', error);
    } finally {
      this.giftDecayJobRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handleYearlyQuotaRefresh() {
    if (this.yearlyRefreshJobRunning) {
      this.logger.warn('跳过年费会员月度额度刷新：上一次任务尚未完成');
      return;
    }

    this.yearlyRefreshJobRunning = true;
    try {
      const result = await this.membershipService.refreshYearlySubscriptionQuotaLots();
      if (result.refreshedSubscriptions > 0 || result.grantedCredits > 0) {
        this.logger.log(
          `年费会员月度额度刷新完成: subscriptions=${result.refreshedSubscriptions}, grantedCredits=${result.grantedCredits}, createdLots=${result.createdLots}`,
        );
      }
    } catch (error) {
      this.logger.error('年费会员月度额度刷新失败:', error);
    } finally {
      this.yearlyRefreshJobRunning = false;
    }
  }
}
