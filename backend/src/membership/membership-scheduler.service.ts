import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MembershipService } from './membership.service';

@Injectable()
export class MembershipSchedulerService {
  private readonly logger = new Logger(MembershipSchedulerService.name);
  private expiryJobRunning = false;

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
}
